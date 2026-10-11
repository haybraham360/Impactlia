import "server-only";
import type { AiTask } from "@/lib/ai/config";
import type { InputIdentity } from "@/lib/ai/evidence";
import type { CacheStatus, Outcome, TraceRecord } from "@/lib/ai/traced";
import { createSupabaseClient } from "@/lib/supabase/server";

// Every read and write of the AI cache and the AI trace. As everywhere else,
// no query filters by organization: the request carries the member's token and
// the policies return, and accept, only that organization's rows.

export type StoredResult = InputIdentity & {
  task: AiTask;
  subject: string;
  body: string;
  omitted: string[];
  createdAt: string;
};

const RESULT_COLUMNS = `task, subject, input_hash, model, prompt_version, source_sha,
  content_hash, context_hash, body, omitted, created_at` as const;

type ResultRow = {
  task: AiTask;
  subject: string;
  input_hash: string;
  model: string;
  prompt_version: string;
  source_sha: string | null;
  content_hash: string;
  context_hash: string;
  body: string;
  omitted: string[];
  created_at: string;
};

const toResult = (row: ResultRow): StoredResult => ({
  task: row.task,
  subject: row.subject,
  inputHash: row.input_hash,
  model: row.model,
  promptVersion: row.prompt_version,
  sourceSha: row.source_sha,
  contentHash: row.content_hash,
  contextHash: row.context_hash,
  body: row.body,
  omitted: row.omitted,
  createdAt: row.created_at,
});

export async function readResult(
  repositoryId: string,
  task: AiTask,
  inputHash: string,
): Promise<StoredResult | null> {
  const { data, error } = await createSupabaseClient()
    .from("ai_results")
    .select(RESULT_COLUMNS)
    .eq("repository_id", repositoryId)
    .eq("task", task)
    .eq("input_hash", inputHash)
    .maybeSingle();
  if (error) throw new Error(`The AI cache could not be read: ${error.message}`);
  return data && toResult(data);
}

// Two requests for the same input can both miss and both write; the second
// leaves the first in place.
export async function writeResult(
  organizationId: string,
  repositoryId: string,
  result: Omit<StoredResult, "createdAt">,
): Promise<void> {
  const { error } = await createSupabaseClient()
    .from("ai_results")
    .upsert(
      {
        organization_id: organizationId,
        repository_id: repositoryId,
        task: result.task,
        subject: result.subject,
        input_hash: result.inputHash,
        model: result.model,
        prompt_version: result.promptVersion,
        source_sha: result.sourceSha,
        content_hash: result.contentHash,
        context_hash: result.contextHash,
        body: result.body,
        omitted: result.omitted,
      },
      { onConflict: "repository_id,task,input_hash", ignoreDuplicates: true },
    );
  if (error) throw new Error(`The AI result could not be cached: ${error.message}`);
}

// The pane shows what is already stored when a repository is opened. Newest
// first, so when a subject has several results the first one met is the latest.
const STORED_RESULT_LIMIT = 300;

export async function listResults(repositoryId: string): Promise<StoredResult[]> {
  const { data, error } = await createSupabaseClient()
    .from("ai_results")
    .select(RESULT_COLUMNS)
    .eq("repository_id", repositoryId)
    .order("created_at", { ascending: false })
    .limit(STORED_RESULT_LIMIT);
  if (error) throw new Error(`Stored explanations could not be read: ${error.message}`);
  return data.map(toResult);
}

export async function recordRun(
  organizationId: string,
  repositoryId: string,
  trace: TraceRecord,
): Promise<void> {
  const { error } = await createSupabaseClient().from("ai_runs").insert({
    organization_id: organizationId,
    repository_id: repositoryId,
    task: trace.task,
    subject: trace.subject,
    model: trace.model,
    prompt_version: trace.promptVersion,
    input_hash: trace.inputHash,
    cache_status: trace.cacheStatus,
    outcome: trace.outcome,
    model_called: trace.modelCalled,
    input_tokens: trace.inputTokens,
    output_tokens: trace.outputTokens,
    error_summary: trace.errorSummary,
    external_trace: trace.externalTrace,
    started_at: trace.startedAt,
    finished_at: trace.finishedAt,
  });
  if (error) throw new Error(`The AI run could not be recorded: ${error.message}`);
}

export type AiRun = TraceRecord & {
  id: string;
  repository: { id: string; owner: string; name: string };
};

export type RunFilter = { outcome: Outcome | null; cacheStatus: CacheStatus | null };

const RUN_LIMIT = 100;

export async function listRuns(filter: RunFilter): Promise<AiRun[]> {
  let query = createSupabaseClient()
    .from("ai_runs")
    .select(
      `id, task, subject, model, prompt_version, input_hash, cache_status, outcome,
       model_called, input_tokens, output_tokens, error_summary, external_trace,
       started_at, finished_at,
       repository:repositories!ai_runs_repository_fkey (id, owner, name)`,
    )
    .order("started_at", { ascending: false })
    .limit(RUN_LIMIT);
  if (filter.outcome) query = query.eq("outcome", filter.outcome);
  if (filter.cacheStatus) query = query.eq("cache_status", filter.cacheStatus);
  const { data, error } = await query;
  if (error) throw new Error(`AI runs could not be read: ${error.message}`);
  return data.map((row) => ({
    id: row.id,
    task: row.task,
    subject: row.subject,
    model: row.model,
    promptVersion: row.prompt_version,
    inputHash: row.input_hash,
    cacheStatus: row.cache_status,
    outcome: row.outcome,
    modelCalled: row.model_called,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    errorSummary: row.error_summary,
    externalTrace: row.external_trace,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    repository: row.repository,
  }));
}
