"use server";

import { auth, clerkClient } from "@clerk/nextjs/server";
import { ensureOrganization } from "@/lib/ingestion/runs";
import { createSupabaseClient } from "@/lib/supabase/server";
import { getWorkspace } from "@/lib/workspace";
import { workspaceNameFor } from "./start";

// The two server steps of the start page. Identity comes only from the
// session Clerk verified on this request; nothing the browser sends names a
// user or an organization.

export type StartFailure = { message: string };

// Makes a workspace for someone who has none, and returns it for the
// browser to make active. If they already belong to one, that one is
// returned instead, so pressing twice or retrying never makes a second.
export async function createWorkspace(): Promise<{ organizationId: string } | StartFailure> {
  const { userId } = await auth();
  if (!userId) return { message: "Your session has ended. Sign in again to continue." };

  try {
    const clerk = await clerkClient();
    const existing = await clerk.users.getOrganizationMembershipList({ userId, limit: 1 });
    const first = existing.data[0];
    if (first) return { organizationId: first.organization.id };

    const user = await clerk.users.getUser(userId);
    const organization = await clerk.organizations.createOrganization({
      name: workspaceNameFor(user.firstName),
      createdBy: userId,
    });
    return { organizationId: organization.id };
  } catch (error) {
    console.error("A workspace could not be created:", error);
    return { message: "Your workspace could not be set up. Try again in a moment." };
  }
}

// Records that this verified person reached a workspace, once; the browser
// then opens the app. Called with a workspace active, so the database
// policies see the person's own user id and organization in the token and
// accept nothing else.
export async function finishStart(): Promise<StartFailure | null> {
  const workspace = await getWorkspace();
  const client = createSupabaseClient();
  try {
    await ensureOrganization(client, workspace.organizationId);
    const { error } = await client
      .from("members")
      .upsert(
        { user_id: workspace.userId, organization_id: workspace.organizationId },
        { onConflict: "user_id", ignoreDuplicates: true },
      );
    if (error) throw new Error(error.message);
  } catch (error) {
    console.error("A member could not be recorded:", error);
    return { message: "Your workspace could not be opened. Try again in a moment." };
  }
  return null;
}
