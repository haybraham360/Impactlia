import "server-only";
import type { PublicRepository } from "@/lib/github/public-repository";
import { STALE_AFTER_MS, isStale, type RunStatus, type StageId } from "@/lib/ingestion/stages";
import { createSupabaseClient, type SupabaseClient } from "@/lib/supabase/server";
import type { ParserOutput } from "@/parser/contract";

// Every read and write of repositories, their runs and their graphs. None of
// the queries filters by organization: the request carries the member's token
// and the database policies return, and accept, only that organization's rows.

export type RepositoryRun = {
  id: string;
  repositoryId: string | null;
  requestedUrl: string;
  status: RunStatus;
  stage: StageId;
  lastCompletedStage: StageId | null;
  sourceSha: string | null;
  failureReason: string | null;
  fileCount: number | null;
  edgeCount: number | null;
  unresolvedCount: number | null;
  createdAt: string;
  progressedAt: string;
  completedAt: string | null;
  // Still running, with no progress recorded inside the stale window, as of
  // the moment the row was read.
  stale: boolean;
};

const RUN_COLUMNS = `id, repository_id, requested_url, status, stage,
  last_completed_stage, source_sha, failure_reason, file_count, edge_count,
  unresolved_count, created_at, progressed_at, completed_at` as const;

type RunRow = {
  id: string;
  repository_id: string | null;
  requested_url: string;
  status: RunStatus;
  stage: StageId;
  last_completed_stage: StageId | null;
  source_sha: string | null;
  failure_reason: string | null;
  file_count: number | null;
  edge_count: number | null;
  unresolved_count: number | null;
  created_at: string;
  progressed_at: string;
  completed_at: string | null;
};

const toRun = (row: RunRow): RepositoryRun => ({
  id: row.id,
  repositoryId: row.repository_id,
  requestedUrl: row.requested_url,
  status: row.status,
  stage: row.stage,
  lastCompletedStage: row.last_completed_stage,
  sourceSha: row.source_sha,
  failureReason: row.failure_reason,
  fileCount: row.file_count,
  edgeCount: row.edge_count,
  unresolvedCount: row.unresolved_count,
  createdAt: row.created_at,
  progressedAt: row.progressed_at,
  completedAt: row.completed_at,
  stale: isStale({ status: row.status, progressedAt: row.progressed_at }, Date.now()),
});

// Ids arrive from the address bar. Anything that is not a uuid cannot be a
// row, and asking the database about it would be an error rather than a miss.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Reads ──────────────────────────────────────────────────────────────────

export type RunWithRepository = RepositoryRun & {
  repository: { owner: string; name: string; hasGraph: boolean } | null;
};

export async function getRun(runId: string): Promise<RunWithRepository | null> {
  if (!UUID.test(runId)) return null;
  const { data, error } = await createSupabaseClient()
    .from("repository_runs")
    .select(
      `${RUN_COLUMNS},
       repository:repositories!repository_runs_repository_fkey (
         owner, name,
         graph:repository_graphs!repository_graphs_repository_fkey (run_id)
       )`,
    )
    .eq("id", runId)
    .maybeSingle();
  if (error) throw new Error(`The run could not be read: ${error.message}`);
  if (!data) return null;
  return {
    ...toRun(data),
    repository: data.repository && {
      owner: data.repository.owner,
      name: data.repository.name,
      hasGraph: data.repository.graph.length > 0,
    },
  };
}

export type RepositoryEntry = {
  id: string;
  owner: string;
  name: string;
  // Whether there is a stored graph to open, whatever the latest run did.
  hasGraph: boolean;
  latestRun: RepositoryRun | null;
};

// The dashboard shows the most recent repositories, not all of them.
export const REPOSITORY_LIMIT = 50;
const FAILED_SUBMISSION_LIMIT = 10;

export async function listRepositories(): Promise<RepositoryEntry[]> {
  const { data, error } = await createSupabaseClient()
    .from("repositories")
    .select(
      `id, owner, name,
       graph:repository_graphs!repository_graphs_repository_fkey (run_id),
       runs:repository_runs!repository_runs_repository_fkey (${RUN_COLUMNS})`,
    )
    .eq("is_seed", false)
    .order("created_at", { ascending: false })
    .order("created_at", { referencedTable: "runs", ascending: false })
    .limit(1, { referencedTable: "runs" })
    .limit(REPOSITORY_LIMIT);
  if (error) throw new Error(`Repositories could not be read: ${error.message}`);

  return data.map((row) => ({
    id: row.id,
    owner: row.owner,
    name: row.name,
    hasGraph: row.graph.length > 0,
    latestRun: row.runs.length > 0 ? toRun(row.runs[0]) : null,
  }));
}

// Submissions that failed before a repository could be identified, so they
// belong to no repository row.
export async function listFailedSubmissions(): Promise<RepositoryRun[]> {
  const { data, error } = await createSupabaseClient()
    .from("repository_runs")
    .select(RUN_COLUMNS)
    .is("repository_id", null)
    .order("created_at", { ascending: false })
    .limit(FAILED_SUBMISSION_LIMIT);
  if (error) throw new Error(`Failed submissions could not be read: ${error.message}`);
  return data.map(toRun);
}

export type StoredAnalysis = {
  repository: { id: string; owner: string; name: string; defaultBranch: string };
  // The stored document and the run that produced it. null until a run of
  // this repository has completed.
  graph: {
    parserOutput: unknown;
    sourceSha: string | null;
    completedAt: string | null;
  } | null;
  latestRun: RepositoryRun | null;
};

export async function getStoredAnalysis(repositoryId: string): Promise<StoredAnalysis | null> {
  if (!UUID.test(repositoryId)) return null;
  const { data, error } = await createSupabaseClient()
    .from("repositories")
    .select(
      `id, owner, name, default_branch,
       graph:repository_graphs!repository_graphs_repository_fkey (
         parser_output,
         run:repository_runs!repository_graphs_run_fkey (source_sha, completed_at)
       ),
       runs:repository_runs!repository_runs_repository_fkey (${RUN_COLUMNS})`,
    )
    .eq("id", repositoryId)
    .order("created_at", { referencedTable: "runs", ascending: false })
    .limit(1, { referencedTable: "runs" })
    .maybeSingle();
  if (error) throw new Error(`The repository could not be read: ${error.message}`);
  if (!data) return null;
  // A repository has at most one graph, but the API returns it as a list: the
  // relationship's key includes organization_id, so it is not recognised as
  // one-to-one.
  const graph = data.graph.length > 0 ? data.graph[0] : null;

  return {
    repository: {
      id: data.id,
      owner: data.owner,
      name: data.name,
      defaultBranch: data.default_branch,
    },
    graph: graph && {
      parserOutput: graph.parser_output,
      sourceSha: graph.run.source_sha,
      completedAt: graph.run.completed_at,
    },
    latestRun: data.runs.length > 0 ? toRun(data.runs[0]) : null,
  };
}

// ── Writes ─────────────────────────────────────────────────────────────────
// These take the client to use, because a run keeps writing after the request
// that started it has ended.

// Raised when a run stopped being 'running' underneath the pipeline: someone
// closed it as stale and started another. The pipeline stops without a word.
export class RunSuperseded extends Error {}

const UNIQUE_VIOLATION = "23505";

export async function ensureOrganization(
  client: SupabaseClient,
  organizationId: string,
): Promise<void> {
  const { error } = await client
    .from("organizations")
    .upsert({ id: organizationId }, { onConflict: "id", ignoreDuplicates: true });
  if (error) throw new Error(`The organization could not be registered: ${error.message}`);
}

// One row per repository per organization, whatever it is called today. The
// unique constraint on GitHub's own id is what makes two simultaneous
// submissions land on the same row.
export async function upsertRepository(
  client: SupabaseClient,
  organizationId: string,
  repository: PublicRepository,
): Promise<string> {
  const { data, error } = await client
    .from("repositories")
    .upsert(
      {
        organization_id: organizationId,
        provider: "github",
        provider_repository_id: repository.providerRepositoryId,
        owner: repository.owner,
        name: repository.name,
        default_branch: repository.defaultBranch,
      },
      { onConflict: "organization_id,provider,provider_repository_id" },
    )
    .select("id")
    .single();
  if (error) throw new Error(`The repository could not be saved: ${error.message}`);
  return data.id;
}

export async function hasStoredGraph(
  client: SupabaseClient,
  repositoryId: string,
): Promise<boolean> {
  const { data, error } = await client
    .from("repository_graphs")
    .select("run_id")
    .eq("repository_id", repositoryId)
    .maybeSingle();
  if (error) throw new Error(`The stored analysis could not be checked: ${error.message}`);
  return data !== null;
}

export async function findRunningRun(
  client: SupabaseClient,
  repositoryId: string,
): Promise<string | null> {
  const { data, error } = await client
    .from("repository_runs")
    .select("id")
    .eq("repository_id", repositoryId)
    .eq("status", "running")
    .maybeSingle();
  if (error) throw new Error(`Running analyses could not be checked: ${error.message}`);
  return data?.id ?? null;
}

// Starts a run with validation already behind it. Returns null when another
// run of the same repository is already running, which the database decides.
export async function insertRun(
  client: SupabaseClient,
  organizationId: string,
  repositoryId: string,
  requestedUrl: string,
): Promise<string | null> {
  const { data, error } = await client
    .from("repository_runs")
    .insert({
      organization_id: organizationId,
      repository_id: repositoryId,
      requested_url: requestedUrl,
      stage: "fetching",
      last_completed_stage: "validating",
    })
    .select("id")
    .single();
  if (error?.code === UNIQUE_VIOLATION) return null;
  if (error) throw new Error(`The run could not be started: ${error.message}`);
  return data.id;
}

// A submission that never got as far as a repository is still recorded, as a
// run that failed while validating.
export async function insertFailedSubmission(
  client: SupabaseClient,
  organizationId: string,
  requestedUrl: string,
  failureReason: string,
): Promise<string> {
  const { data, error } = await client
    .from("repository_runs")
    .insert({
      organization_id: organizationId,
      requested_url: requestedUrl,
      status: "failed",
      stage: "validating",
      failure_reason: failureReason,
      completed_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error) throw new Error(`The failed submission could not be recorded: ${error.message}`);
  return data.id;
}

export async function advanceRun(
  client: SupabaseClient,
  runId: string,
  stage: StageId,
  completed: StageId,
): Promise<void> {
  const { data, error } = await client
    .from("repository_runs")
    .update({ stage, last_completed_stage: completed })
    .eq("id", runId)
    .eq("status", "running")
    .select("id");
  if (error) throw new Error(`Progress could not be recorded: ${error.message}`);
  if (data.length === 0) throw new RunSuperseded();
}

// Does nothing to a run that has already finished.
export async function failRun(
  client: SupabaseClient,
  runId: string,
  failureReason: string,
): Promise<void> {
  const { error } = await client
    .from("repository_runs")
    .update({ status: "failed", failure_reason: failureReason })
    .eq("id", runId)
    .eq("status", "running");
  if (error) throw new Error(`The failure could not be recorded: ${error.message}`);
}

// Closes a running run only if it has recorded no progress within the stale
// window, so a run that is still moving is never closed from under itself.
export async function closeStaleRun(client: SupabaseClient, runId: string): Promise<void> {
  const { error } = await client
    .from("repository_runs")
    .update({
      status: "failed",
      failure_reason: `No progress was recorded for ${STALE_AFTER_MS / 60_000} minutes, so this run was closed when it was retried.`,
    })
    .eq("id", runId)
    .eq("status", "running")
    .lt("progressed_at", new Date(Date.now() - STALE_AFTER_MS).toISOString());
  if (error) throw new Error(`The stale run could not be closed: ${error.message}`);
}

export async function completeRun(
  client: SupabaseClient,
  runId: string,
  sourceSha: string | null,
  output: ParserOutput,
): Promise<void> {
  const { error } = await client.rpc("complete_repository_run", {
    run_id: runId,
    parser_output: output,
    ...(sourceSha === null ? {} : { source_sha: sourceSha }),
  });
  if (error) throw new Error(`The analysis could not be saved: ${error.message}`);
}
