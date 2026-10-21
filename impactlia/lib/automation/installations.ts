import "server-only";
import type { AutomationConfig } from "@/lib/env";
import type { VisibleInstallation } from "@/lib/github/app";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

// Links an installation GitHub has confirmed the member can see to the
// member's organization. Members cannot write this table themselves: the
// confirmation happens on the server, so the write does too.
//
// An installation belongs to one organization. One already linked elsewhere
// is not moved.
export async function linkInstallation(
  config: AutomationConfig,
  organizationId: string,
  installation: VisibleInstallation,
): Promise<"linked" | "taken"> {
  const db = createServiceSupabaseClient(config);
  const { data: existing, error: readError } = await db
    .from("github_installations")
    .select("organization_id")
    .eq("installation_id", installation.installationId)
    .maybeSingle();
  if (readError) throw new Error(`The installation could not be read: ${readError.message}`);
  if (existing && existing.organization_id !== organizationId) return "taken";

  const { error } = await db.from("github_installations").upsert(
    {
      installation_id: installation.installationId,
      organization_id: organizationId,
      account_login: installation.accountLogin,
    },
    { onConflict: "installation_id" },
  );
  if (error) throw new Error(`The installation could not be linked: ${error.message}`);
  return "linked";
}
