import "server-only";
import type { AutomationConfig } from "@/lib/env";
import {
  COMMENT_LIMIT,
  GitHubAppError,
  createInstallationToken,
  publishManagedComment,
} from "@/lib/github/app";
import { findPublicRepository } from "@/lib/github/public-repository";
import { findPullRequest } from "@/lib/github/pull-request";
import type { RepositoryAccess } from "@/lib/github/repository-url";
import { runImpactPipeline } from "@/lib/impact/pipeline";
import {
  closeStaleAnalysis,
  findCompletedAnalysis,
  findUnfinishedAnalysis,
  insertAnalysis,
  readCodeCheck,
  readLimitations,
  readRiskAssessment,
  upsertPullRequest,
} from "@/lib/impact/runs";
import { IngestionError } from "@/lib/ingestion/errors";
import { AUTOMATION_SWEEP_PATH, analysisPath } from "@/lib/routes";
import type { Database } from "@/lib/supabase/database.types";
import { createServiceSupabaseClient, type ServiceSupabaseClient } from "@/lib/supabase/service";
import {
  AFFECTED_SHOWN,
  ISSUES_SHOWN,
  TESTS_SHOWN,
  buildComment,
  type CommentSummary,
} from "./comment";
import { MAX_ATTEMPTS, nextAttemptAt, publicationOf } from "./policy";

// Runs automatic analysis jobs. A job is one pull request at one head
// commit; one attempt claims it, analyses that commit with the same pipeline
// a member's analysis uses (or reuses a stored analysis of that commit),
// checks the pull request has not moved on, and publishes the comment.
//
// Every attempt ends by writing the job's status and a message for the
// member. An attempt that dies without writing is found by the sweep once the
// claim window has passed and is tried again, up to MAX_ATTEMPTS.

type Job = Database["public"]["Tables"]["automatic_analyses"]["Row"];
type Status = Database["public"]["Enums"]["automatic_analysis_status"];

const MESSAGE_LENGTH = 500;
// How many due jobs one sweep starts. They run side by side, one per
// repository at most, so a burst of pushes is worked through over a few
// minutes instead of all at once.
export const SWEEP_LIMIT = 3;

const timeFormat = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
});

// Thrown to end an attempt early with a status that is not a failure.
class Settled extends Error {
  constructor(
    readonly status: Exclude<Status, "queued" | "running">,
    message: string,
  ) {
    super(message);
    this.name = "Settled";
  }
}

// Only the attempt that holds the claim may write: a reclaim after an
// abandoned attempt bumps `attempts`, so a late write from the old one
// matches nothing.
async function settle(
  db: ServiceSupabaseClient,
  job: Job,
  fields: Partial<Pick<Job, "status" | "message" | "next_attempt_at" | "comment_id" | "comment_published_at" | "analysis_id">>,
): Promise<void> {
  const { error } = await db
    .from("automatic_analyses")
    .update({
      ...fields,
      message: fields.message?.slice(0, MESSAGE_LENGTH) ?? null,
      locked_at: null,
    })
    .eq("id", job.id)
    .eq("status", "running")
    .eq("attempts", job.attempts);
  if (error) throw new Error(`Automatic analysis ${job.id} could not be updated: ${error.message}`);
}

async function retryLater(
  db: ServiceSupabaseClient,
  job: Job,
  reason: string,
  retryAt: number | null,
): Promise<string> {
  const at = nextAttemptAt(job.attempts, retryAt, Date.now());
  if (at === null) {
    await settle(db, job, {
      status: "failed",
      message: `${reason} Stopped after ${MAX_ATTEMPTS} attempts.`,
    });
    return "failed";
  }
  await settle(db, job, {
    status: "queued",
    next_attempt_at: at.toISOString(),
    // The sweep runs every half hour, so this is the earliest, not a promise.
    message: `${reason} Retrying after ${timeFormat.format(at)} UTC.`,
  });
  return "retry";
}

async function recordAnalysis(db: ServiceSupabaseClient, job: Job, analysisId: string) {
  const { error } = await db
    .from("automatic_analyses")
    .update({ analysis_id: analysisId })
    .eq("id", job.id)
    .eq("attempts", job.attempts);
  if (error) throw new Error(`The analysis could not be linked to job ${job.id}: ${error.message}`);
}

async function readRepository(db: ServiceSupabaseClient, job: Job) {
  const { data, error } = await db
    .from("repositories")
    .select("owner, name, provider_repository_id, automatic_analysis, github_installation_id")
    .eq("id", job.repository_id)
    .eq("organization_id", job.organization_id)
    .maybeSingle();
  if (error) throw new Error(`The repository could not be read: ${error.message}`);
  return data;
}

const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;

// What the comment shows, read from the stored result. Each list is limited
// to what the comment shows; the counts are the totals.
async function readCommentSummary(
  db: ServiceSupabaseClient,
  analysisId: string,
  headSha: string,
  analysisUrl: string,
): Promise<CommentSummary> {
  const [analysis, affected, issues, tests, areas] = await Promise.all([
    db
      .from("analyses")
      .select("status, changed_file_count, affected_file_count, limitations, code_check, risk_assessment")
      .eq("id", analysisId)
      .single(),
    db
      .from("analysis_files")
      .select("path, impact_depth")
      .eq("analysis_id", analysisId)
      .eq("kind", "affected")
      .order("impact_depth")
      .order("path")
      .limit(AFFECTED_SHOWN),
    db
      .from("analysis_code_issues")
      .select("title, start_line, file:analysis_files!inner (path)", { count: "exact" })
      .eq("analysis_id", analysisId)
      .order("position")
      .limit(ISSUES_SHOWN),
    db
      .from("analysis_test_recommendations")
      .select("kind, title", { count: "exact" })
      .eq("analysis_id", analysisId)
      .order("position")
      .limit(TESTS_SHOWN),
    db
      .from("analysis_recommendations")
      .select("body")
      .eq("analysis_id", analysisId)
      .order("position")
      .limit(10),
  ]);
  const failed = [analysis, affected, issues, tests, areas].find((result) => result.error);
  if (failed?.error) throw new Error(`The analysis could not be read: ${failed.error.message}`);
  const run = analysis.data;
  if (!run || run.status !== "completed" || !isCount(run.changed_file_count) || !isCount(run.affected_file_count)) {
    throw new Error(`Analysis ${analysisId} is not a completed analysis.`);
  }

  const codeCheck = readCodeCheck(run.code_check);
  const risk = readRiskAssessment(run.risk_assessment);
  return {
    status: "completed",
    headSha,
    analysisUrl,
    changedFileCount: run.changed_file_count,
    affectedFileCount: run.affected_file_count,
    affected: (affected.data ?? []).map((row) => ({ path: row.path, depth: row.impact_depth ?? 1 })),
    codeCheck: codeCheck && { checked: codeCheck.checked.length, skipped: codeCheck.skipped.length },
    codeIssues: (issues.data ?? []).map((row) => ({
      title: row.title,
      path: row.file.path,
      line: row.start_line,
    })),
    codeIssueCount: issues.count ?? 0,
    tests: (tests.data ?? []).map((row) => ({ kind: row.kind, title: row.title })),
    testCount: tests.count ?? 0,
    areas: (areas.data ?? []).map((row) => row.body),
    risk: risk && {
      score: risk.score,
      level: risk.level,
      confidence: risk.confidence,
      summary: risk.summary,
    },
    limitations: readLimitations(run.limitations).map((limitation) => limitation.detail),
  };
}

// One attempt, up to the point the comment is published. Returns the
// outcome for the log line.
async function attempt(config: AutomationConfig, db: ServiceSupabaseClient, job: Job): Promise<string> {
  if (job.attempts > MAX_ATTEMPTS) {
    throw new Settled(
      "failed",
      `The analysis stopped without finishing ${MAX_ATTEMPTS} times, so it was not tried again.`,
    );
  }
  const repository = await readRepository(db, job);
  if (!repository) throw new Settled("skipped", "The repository was removed from Impactlia.");
  if (!repository.automatic_analysis || repository.github_installation_id !== job.installation_id) {
    throw new Settled("skipped", "Automatic analysis was turned off for this repository before it ran.");
  }

  const token = await createInstallationToken(
    config,
    job.installation_id,
    repository.provider_repository_id,
    repository,
  );
  const current = await findPublicRepository({ ...repository, token });
  if (current.providerRepositoryId !== repository.provider_repository_id) {
    throw new Settled(
      "failed",
      `${repository.owner}/${repository.name} on GitHub is now a different repository from the one added to Impactlia.`,
    );
  }
  if (current.isPrivate) {
    throw new Settled("skipped", "The repository is now private. Only public repositories are analysed.");
  }
  // GitHub's spelling now, which follows a rename.
  const access: RepositoryAccess = { owner: current.owner, name: current.name, token };

  const pullRequest = await findPullRequest(access, job.pull_request_number);
  const before = publicationOf(job.head_sha, pullRequest);
  if (before === "closed") {
    throw new Settled("skipped", "The pull request was closed before it was analysed.");
  }
  if (before === "stale") {
    throw new Settled("stale", "A newer commit was pushed before this one was analysed.");
  }

  const pullRequestId = await upsertPullRequest(db, job.organization_id, job.repository_id, pullRequest);
  // The analysis of a commit does not change, so one already stored is used
  // as it is, whoever started it. Only the comment is redone.
  let analysisId = await findCompletedAnalysis(db, pullRequestId, job.head_sha);
  let failure: string | null = null;
  if (analysisId === null) {
    if (job.analysis_id !== null) await closeStaleAnalysis(db, job.analysis_id);
    const running = await findUnfinishedAnalysis(db, pullRequestId, job.head_sha);
    const started = running === null
      ? await insertAnalysis(db, job.organization_id, pullRequestId, pullRequest)
      : null;
    if (started === null) {
      return retryLater(db, job, "Another analysis of this commit is still running.", null);
    }
    analysisId = started;
    await recordAnalysis(db, job, analysisId);
    const outcome = await runImpactPipeline(db, analysisId, access, pullRequest);
    if (outcome.kind === "superseded") {
      return retryLater(db, job, "The analysis was closed while it ran.", null);
    }
    if (outcome.kind === "failed") {
      if (outcome.retryable) return retryLater(db, job, outcome.reason, outcome.retryAt);
      failure = outcome.reason;
    }
  }

  // The last word on staleness: whatever happened above, only the commit
  // that is the pull request's head right now is published.
  const latest = await findPullRequest(access, job.pull_request_number);
  const after = publicationOf(job.head_sha, latest);
  if (after === "closed") {
    await settle(db, job, {
      status: "skipped",
      analysis_id: analysisId,
      message: "The pull request was closed while it was analysed, so no comment was published.",
    });
    return "closed";
  }
  if (after === "stale") {
    await settle(db, job, {
      status: "stale",
      analysis_id: analysisId,
      message: "A newer commit was pushed while this one was analysed, so its result was not published. The newer commit is analysed on its own.",
    });
    return "stale";
  }

  const analysisUrl = `${config.appUrl}${analysisPath(analysisId)}`;
  const summary: CommentSummary = failure !== null
    ? { status: "failed", headSha: job.head_sha, analysisUrl, reason: failure }
    : await readCommentSummary(db, analysisId, job.head_sha, analysisUrl);
  const body = buildComment(summary).slice(0, COMMENT_LIMIT);
  const status: Status = failure !== null ? "failed" : "completed";

  let commentId: number;
  try {
    commentId = await publishManagedComment(config, access, job.pull_request_number, body);
  } catch (error) {
    if (!(error instanceof GitHubAppError)) throw error;
    await settle(db, job, {
      status,
      analysis_id: analysisId,
      message: failure ?? error.message,
    });
    return "comment-refused";
  }

  await settle(db, job, {
    status,
    analysis_id: analysisId,
    comment_id: commentId,
    comment_published_at: new Date().toISOString(),
    message:
      failure ??
      (summary.status === "completed" && summary.limitations.length > 0
        ? "Analysed with limitations; the comment says which."
        : "Analysed, and the comment is up to date."),
  });
  return status;
}

async function settleError(db: ServiceSupabaseClient, job: Job, error: unknown): Promise<string> {
  if (error instanceof Settled) {
    await settle(db, job, { status: error.status, message: error.message });
    return error.status;
  }
  if (error instanceof GitHubAppError) {
    await settle(db, job, { status: "failed", message: error.message });
    return "failed";
  }
  if (error instanceof IngestionError) {
    if (error.retryable) return retryLater(db, job, error.message, error.retryAt);
    await settle(db, job, { status: "failed", message: error.message });
    return "failed";
  }
  // Not a failure anyone wrote a message for. It may be passing (a database
  // blip), so it is retried like one, within the same limit.
  console.error(`Automatic analysis ${job.id} failed unexpectedly:`, error);
  return retryLater(
    db,
    job,
    "Something went wrong on Impactlia's side. The details were logged on the server.",
    null,
  );
}

// Claims the job and runs one attempt. Does nothing if the job is not due,
// is already running, or another job of its repository is running. Never
// throws.
export async function processAutomaticAnalysis(config: AutomationConfig, jobId: string): Promise<void> {
  const db = createServiceSupabaseClient(config);
  const startedAt = Date.now();
  const { data, error } = await db.rpc("claim_automatic_analysis", { job: jobId });
  if (error) {
    console.error(`Automatic analysis ${jobId} could not be claimed:`, error.message);
    return;
  }
  const job = data[0];
  if (!job) return;

  let outcome: string;
  try {
    outcome = await attempt(config, db, job);
  } catch (failure) {
    try {
      outcome = await settleError(db, job, failure);
    } catch (unrecorded) {
      // Left 'running'; the sweep reclaims it after the claim window.
      console.error(`Automatic analysis ${job.id} could not record its outcome:`, unrecorded);
      outcome = "unrecorded";
    }
  }
  // One line per attempt, for duration, failure and retry rates. Ids only:
  // no token, payload or repository content.
  console.info(
    JSON.stringify({
      event: "automatic_analysis_attempt",
      job: job.id,
      attempt: job.attempts,
      outcome,
      durationMs: Date.now() - startedAt,
    }),
  );
  await startDueAnalyses(config);
}

// Asks the sweep to start whatever is due now, so a job that waited behind
// this one starts when this one ends rather than at the next scheduled
// sweep. It is a request to the sweep, not a call, so that job gets a
// function invocation and a time limit of its own. Best effort: the
// schedule picks up anything this misses. It ends: only jobs due now start,
// and a job's retry is never due at once.
async function startDueAnalyses(config: AutomationConfig): Promise<void> {
  await fetch(`${config.appUrl}${AUTOMATION_SWEEP_PATH}`, {
    headers: { Authorization: `Bearer ${config.cronSecret}` },
    signal: AbortSignal.timeout(10_000),
  }).catch(() => undefined);
}

// The jobs that are due, or whose attempt went silent, oldest first. The
// claim decides again with the database's clock, so the cut-off here only
// keeps the list short.
export async function listDueAnalyses(config: AutomationConfig): Promise<string[]> {
  const db = createServiceSupabaseClient(config);
  const now = new Date();
  const abandoned = new Date(now.getTime() - 10 * 60 * 1000);
  const { data, error } = await db
    .from("automatic_analyses")
    .select("id")
    .or(
      `and(status.eq.queued,next_attempt_at.lte.${now.toISOString()}),and(status.eq.running,locked_at.lt.${abandoned.toISOString()})`,
    )
    .order("next_attempt_at")
    .limit(SWEEP_LIMIT);
  if (error) throw new Error(`Due automatic analyses could not be listed: ${error.message}`);
  return data.map((row) => row.id);
}
