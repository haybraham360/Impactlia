import "server-only";
import { createSupabaseClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

type Enums = Database["public"]["Enums"];

export type AnalysisStatus = Enums["analysis_status"];
export type RiskLevel = Enums["risk_level"];

export type AnalysisRun = {
  id: string;
  status: AnalysisStatus;
  riskLevel: RiskLevel | null;
  changedFileCount: number | null;
  affectedFileCount: number | null;
  failureReason: string | null;
  createdAt: string;
  completedAt: string | null;
  pullRequest: { number: number; title: string; authorLogin: string };
  repository: { owner: string; name: string; isSeed: boolean };
};

// The dashboard shows the most recent runs, not the full history.
const RUN_LIMIT = 50;

// There is deliberately no organization filter here. The request carries the
// signed-in token and the database policy returns only the current
// organization's rows, so the same query serves every organization.
export async function listAnalysisRuns(): Promise<AnalysisRun[]> {
  const { data, error } = await createSupabaseClient()
    .from("analyses")
    .select(
      `id, status, risk_level, changed_file_count, affected_file_count,
       failure_reason, created_at, completed_at,
       pull_request:pull_requests!inner (
         number, title, author_login,
         repository:repositories!inner (owner, name, is_seed)
       )`,
    )
    .order("created_at", { ascending: false })
    .limit(RUN_LIMIT);

  if (error) {
    throw new Error(`Analysis runs could not be read: ${error.message}`);
  }

  return data.map((row) => ({
    id: row.id,
    status: row.status,
    riskLevel: row.risk_level,
    changedFileCount: row.changed_file_count,
    affectedFileCount: row.affected_file_count,
    failureReason: row.failure_reason,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    pullRequest: {
      number: row.pull_request.number,
      title: row.pull_request.title,
      authorLogin: row.pull_request.author_login,
    },
    repository: {
      owner: row.pull_request.repository.owner,
      name: row.pull_request.repository.name,
      isSeed: row.pull_request.repository.is_seed,
    },
  }));
}
