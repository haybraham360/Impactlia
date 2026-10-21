"use server";

import crypto from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { automation } from "@/lib/env";
import { GitHubAppError, createInstallationToken, findRepositoryInstallation } from "@/lib/github/app";
import { findPublicRepository } from "@/lib/github/public-repository";
import { getRepositoryIdentity } from "@/lib/impact/runs";
import { IngestionError } from "@/lib/ingestion/errors";
import {
  GITHUB_INSTALLED_PATH,
  GITHUB_INSTALL_COOKIE,
  PULL_REQUESTS_PATH,
  pullRequestsPath,
} from "@/lib/routes";
import { createSupabaseClient } from "@/lib/supabase/server";
import { getWorkspace } from "@/lib/workspace";
import { listInstallations } from "./status";

const field = (form: FormData, name: string): string => {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type AutomationState = { message: string } | null;

// Sends the member to GitHub to install the App, or to change which
// repositories it covers. The state value, kept in a short-lived cookie only
// this browser has, is how the return trip is known to have started here.
export async function connectGitHub(form: FormData): Promise<void> {
  await getWorkspace();
  const config = automation.config;
  const repositoryId = field(form, "repositoryId");
  if (!config) redirect(PULL_REQUESTS_PATH);

  const state = crypto.randomBytes(24).toString("base64url");
  (await cookies()).set(GITHUB_INSTALL_COOKIE, `${state}.${UUID.test(repositoryId) ? repositoryId : ""}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: GITHUB_INSTALLED_PATH,
    maxAge: 15 * 60,
  });
  redirect(
    `https://github.com/apps/${encodeURIComponent(config.appSlug)}/installations/new?state=${state}`,
  );
}

// Turns automatic analysis on or off for one repository. On is checked with
// GitHub every time: the App must be installed on the repository through an
// installation this organization connected, the repository must still be
// the same one and still public. The setting itself is written with the
// member's token, so the policy decides it like any other change.
export async function setAutomaticAnalysis(
  _previous: AutomationState,
  form: FormData,
): Promise<AutomationState> {
  await getWorkspace();
  const client = createSupabaseClient();
  const repository = await getRepositoryIdentity(client, field(form, "repositoryId"));
  if (!repository || repository.isSeed) {
    return { message: "That repository is not in this organization." };
  }
  const enable = field(form, "enabled") === "true";

  if (!enable) {
    const { error } = await client
      .from("repositories")
      .update({ automatic_analysis: false })
      .eq("id", repository.id);
    if (error) throw new Error(`Automatic analysis could not be turned off: ${error.message}`);
    redirect(pullRequestsPath(repository.id));
  }

  const config = automation.config;
  if (!config) return { message: "Automatic analysis is not set up on this server." };

  const installations = (await listInstallations()).filter((installation) => !installation.removed);
  if (installations.length === 0) {
    return { message: "Connect GitHub first, and choose this repository when GitHub asks which ones." };
  }

  const label = `${repository.owner}/${repository.name}`;
  let installationId: number | null;
  try {
    installationId = await findRepositoryInstallation(config, repository);
    if (installationId === null) {
      return {
        message: `The Impactlia GitHub App is not installed on ${label}. Use "Connect GitHub" to add it to the installation, then try again.`,
      };
    }
    const connected = installations.find((installation) => installation.installationId === installationId);
    if (!connected) {
      return {
        message: `${label} is covered by an installation of the App that is not connected to this organization. Use "Connect GitHub" from this organization to connect it.`,
      };
    }
    if (connected.suspended) {
      return { message: `The Impactlia GitHub App is suspended on ${connected.accountLogin}.` };
    }
    const token = await createInstallationToken(
      config,
      installationId,
      repository.providerRepositoryId,
      repository,
    );
    const current = await findPublicRepository({ ...repository, token });
    if (current.providerRepositoryId !== repository.providerRepositoryId) {
      return {
        message: `${label} on GitHub is now a different repository from the one added here. Add it again from its address.`,
      };
    }
    if (current.isPrivate) {
      return { message: `${label} is private. Only public repositories can be analysed.` };
    }
  } catch (error) {
    if (error instanceof GitHubAppError || error instanceof IngestionError) {
      return { message: error.message };
    }
    console.error("Automatic analysis could not be checked with GitHub:", error);
    return {
      message: "Something went wrong while checking with GitHub. The details were logged on the server.",
    };
  }

  const { error } = await client
    .from("repositories")
    .update({ automatic_analysis: true, github_installation_id: installationId })
    .eq("id", repository.id);
  if (error) throw new Error(`Automatic analysis could not be turned on: ${error.message}`);
  redirect(pullRequestsPath(repository.id));
}
