import crypto from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { linkInstallation } from "@/lib/automation/installations";
import type { ConnectOutcome } from "@/lib/automation/status";
import { automation } from "@/lib/env";
import { confirmInstallationAccess } from "@/lib/github/app";
import { IngestionError } from "@/lib/ingestion/errors";
import { ensureOrganization } from "@/lib/ingestion/runs";
import {
  GITHUB_INSTALLED_PATH,
  GITHUB_INSTALL_COOKIE,
  PULL_REQUESTS_PATH,
  pullRequestsPath,
} from "@/lib/routes";
import { createSupabaseClient } from "@/lib/supabase/server";
import { getWorkspace } from "@/lib/workspace";

// Where GitHub sends a member back after installing the Impactlia GitHub App
// or changing its repositories. Behind the sign-in like the rest of /app.
//
// Nothing in the address is trusted on its own. The state must match the
// cookie set when the member pressed "Connect GitHub" here, and the
// installation id is linked only after GitHub confirms, through the member's
// own one-time sign-in, that the member can see that installation.
//
// GitHub includes that sign-in's code when the App asks for it during
// installation. When it does not (an existing installation whose
// repositories were changed, or the App setting is off) the member is sent
// through GitHub's sign-in once more, with the installation id kept in the
// cookie, and comes back here with a code.

const STATE = /^[A-Za-z0-9_-]{32}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE = /^[A-Za-z0-9_-]{1,100}$/;

function sameState(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export async function GET(request: NextRequest): Promise<Response> {
  const workspace = await getWorkspace();
  const jar = await cookies();
  const cookie = jar.get(GITHUB_INSTALL_COOKIE)?.value ?? "";
  jar.delete(GITHUB_INSTALL_COOKIE);
  // state.repositoryId, and the installation id while a sign-in is pending.
  const [expectedState = "", repositoryId = "", pendingInstallation = ""] = cookie.split(".");

  const back = (outcome: ConnectOutcome) => {
    const page = UUID.test(repositoryId)
      ? `${pullRequestsPath(repositoryId)}&github=${outcome}`
      : `${PULL_REQUESTS_PATH}?github=${outcome}`;
    return NextResponse.redirect(new URL(page, request.url));
  };

  const config = automation.config;
  if (!config) return back("not-set-up");

  const params = request.nextUrl.searchParams;
  const state = params.get("state") ?? "";
  if (!STATE.test(expectedState) || !sameState(state, expectedState)) return back("not-started-here");

  const code = params.get("code") ?? "";
  const installationId = Number(params.get("installation_id") ?? pendingInstallation);
  if (!Number.isSafeInteger(installationId) || installationId <= 0) return back("failed");

  if (code === "") {
    // A second trip without a code means the sign-in did not happen.
    if (pendingInstallation !== "") return back("no-sign-in");
    jar.set(GITHUB_INSTALL_COOKIE, `${expectedState}.${repositoryId}.${installationId}`, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: GITHUB_INSTALLED_PATH,
      maxAge: 15 * 60,
    });
    const signIn = new URL("https://github.com/login/oauth/authorize");
    signIn.searchParams.set("client_id", config.clientId);
    signIn.searchParams.set("redirect_uri", `${config.appUrl}${GITHUB_INSTALLED_PATH}`);
    signIn.searchParams.set("state", expectedState);
    return NextResponse.redirect(signIn);
  }
  if (!CODE.test(code)) return back("failed");

  try {
    const visible = await confirmInstallationAccess(config, code, installationId);
    if (!visible) return back("not-yours");
    await ensureOrganization(createSupabaseClient(), workspace.organizationId);
    const linked = await linkInstallation(config, workspace.organizationId, visible);
    return back(linked === "taken" ? "taken" : "connected");
  } catch (error) {
    if (!(error instanceof IngestionError)) {
      console.error("A GitHub installation could not be connected:", error);
    }
    return back("failed");
  }
}
