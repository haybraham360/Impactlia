import "server-only";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { CHOOSE_ORGANIZATION_PATH } from "@/lib/routes";

export type Workspace = {
  userId: string;
  organizationId: string;
  organizationName: string;
  organizationRole: string;
};

// The current organization comes from the session token's claims and nowhere
// else. Nothing here calls Clerk's API, so anything downstream that decides
// what someone can see is reading the same claim the database policies will.
export async function getWorkspace(): Promise<Workspace> {
  const { userId, orgId, orgRole, sessionClaims, redirectToSignIn } =
    await auth();

  if (!userId) {
    return redirectToSignIn();
  }

  // A signed-in session can have no active organization. Sign-in has nothing
  // to offer it and would bounce it straight back here.
  if (!orgId || !orgRole) {
    redirect(CHOOSE_ORGANIZATION_PATH);
  }

  const organizationName = sessionClaims.org_name;
  if (!organizationName) {
    throw new Error(
      'The session token has no "org_name" claim. In the Clerk dashboard, ' +
        'open Sessions → Customize session token and add {"org_name": "{{org.name}}"}.',
    );
  }

  return {
    userId,
    organizationId: orgId,
    organizationName,
    organizationRole: orgRole,
  };
}
