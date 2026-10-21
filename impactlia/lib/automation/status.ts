import "server-only";
import type { Database } from "@/lib/supabase/database.types";
import { createSupabaseClient } from "@/lib/supabase/server";

// What a member sees of automatic analysis. Every read goes through the
// member's token, so the policies return only this organization's rows.

export type AutomaticAnalysisStatus = Database["public"]["Enums"]["automatic_analysis_status"];

// How returning from GitHub's installation page ended, as a fixed code in
// the address. The page turns it into words; nothing else from the address
// is shown back.
export const CONNECT_OUTCOMES = {
  connected: "GitHub is connected. Turn automatic analysis on below for this repository.",
  "not-set-up": "Automatic analysis is not set up on this server.",
  "not-started-here":
    "That GitHub installation was not started from Impactlia, or took too long. Use \"Connect GitHub\" here and try again.",
  "no-sign-in":
    "GitHub did not confirm your account, so the installation could not be connected. Try again, and approve the request when GitHub asks.",
  "not-yours": "GitHub says your account cannot see that installation, so it was not connected.",
  taken: "That installation is already connected to another Impactlia organization.",
  failed: "The installation could not be connected. Try again in a moment.",
} as const;
export type ConnectOutcome = keyof typeof CONNECT_OUTCOMES;
export const isConnectOutcome = (value: unknown): value is ConnectOutcome =>
  typeof value === "string" && Object.hasOwn(CONNECT_OUTCOMES, value);

export type ConnectedInstallation = {
  installationId: number;
  accountLogin: string;
  suspended: boolean;
  removed: boolean;
};

export type RepositoryAutomation = {
  enabled: boolean;
  installationId: number | null;
};

export type AutomaticRun = {
  id: string;
  pullRequestNumber: number;
  headSha: string;
  status: AutomaticAnalysisStatus;
  attempts: number;
  message: string | null;
  analysisId: string | null;
  commentPublished: boolean;
  nextAttemptAt: string;
  updatedAt: string;
};

// An organization has a handful of installations at most.
const INSTALLATION_LIMIT = 20;
// The page shows the most recent jobs, not the history.
export const AUTOMATIC_RUN_LIMIT = 10;

export async function listInstallations(): Promise<ConnectedInstallation[]> {
  const { data, error } = await createSupabaseClient()
    .from("github_installations")
    .select("installation_id, account_login, suspended_at, removed_at")
    .order("created_at", { ascending: false })
    .limit(INSTALLATION_LIMIT);
  if (error) throw new Error(`GitHub installations could not be read: ${error.message}`);
  return data.map((row) => ({
    installationId: row.installation_id,
    accountLogin: row.account_login,
    suspended: row.suspended_at !== null,
    removed: row.removed_at !== null,
  }));
}

export async function getRepositoryAutomation(repositoryId: string): Promise<RepositoryAutomation | null> {
  const { data, error } = await createSupabaseClient()
    .from("repositories")
    .select("automatic_analysis, github_installation_id")
    .eq("id", repositoryId)
    .maybeSingle();
  if (error) throw new Error(`The repository could not be read: ${error.message}`);
  return data && { enabled: data.automatic_analysis, installationId: data.github_installation_id };
}

export async function listAutomaticRuns(repositoryId: string): Promise<AutomaticRun[]> {
  const { data, error } = await createSupabaseClient()
    .from("automatic_analyses")
    .select(
      "id, pull_request_number, head_sha, status, attempts, message, analysis_id, comment_published_at, next_attempt_at, updated_at",
    )
    .eq("repository_id", repositoryId)
    .order("created_at", { ascending: false })
    .limit(AUTOMATIC_RUN_LIMIT);
  if (error) throw new Error(`Automatic analyses could not be read: ${error.message}`);
  return data.map((row) => ({
    id: row.id,
    pullRequestNumber: row.pull_request_number,
    headSha: row.head_sha,
    status: row.status,
    attempts: row.attempts,
    message: row.message,
    analysisId: row.analysis_id,
    commentPublished: row.comment_published_at !== null,
    nextAttemptAt: row.next_attempt_at,
    updatedAt: row.updated_at,
  }));
}
