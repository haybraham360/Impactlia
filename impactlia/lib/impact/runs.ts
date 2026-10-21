import "server-only";
import type { PullRequest } from "@/lib/github/pull-request";
import { ISSUE_LIMIT } from "@/lib/impact/code-issues";
import {
  RISK_FACTOR_IDS,
  type CodeCheck,
  type CodeIssue,
  type Confidence,
  type FileReference,
  type ImpactReport,
  type Limitation,
  type RelatedFile,
  type RiskAssessment,
  type RiskFactor,
  type RiskLevel,
  type RiskScoreLevel,
  type SignalDetail,
  type TestDiscovery,
  type TestFileReference,
  type TestRecommendation,
} from "@/lib/impact/report";
import {
  STALE_AFTER_MS,
  isAnalysisStale,
  type AnalysisStageId,
} from "@/lib/impact/stages";
import { RunSuperseded } from "@/lib/ingestion/runs";
import type { Database, Json } from "@/lib/supabase/database.types";
import { createSupabaseClient, type SupabaseClient } from "@/lib/supabase/server";

// Every read and write of pull requests, their analyses and the results. None
// of the queries filters by organization: the request carries the member's
// token and the database policies return, and accept, only that
// organization's rows.

type Enums = Database["public"]["Enums"];
export type AnalysisStatus = Enums["analysis_status"];

// A completed analysis has a score, or, if it was completed before scores
// existed, the three-level label it was given then. null is "Insufficient
// evidence" on a completed run, and no result yet on any other.
export type RunRisk =
  | { kind: "score"; score: number; level: RiskScoreLevel; confidence: Confidence }
  | { kind: "label"; level: RiskLevel }
  | null;

export type AnalysisRun = {
  id: string;
  status: AnalysisStatus;
  stage: AnalysisStageId;
  lastCompletedStage: AnalysisStageId | null;
  // Unfinished, with no progress recorded inside the stale window, as of the
  // moment the row was read.
  stale: boolean;
  risk: RunRisk;
  changedFileCount: number | null;
  affectedFileCount: number | null;
  failureReason: string | null;
  baseSha: string | null;
  headSha: string;
  graphSha: string | null;
  createdAt: string;
  progressedAt: string;
  completedAt: string | null;
  pullRequest: {
    id: string;
    number: number;
    title: string;
    authorLogin: string;
    baseRef: string;
    headRef: string;
  };
  repository: { id: string; owner: string; name: string; isSeed: boolean };
};

const RUN_COLUMNS = `id, status, stage, last_completed_stage, risk_level,
  risk_score, risk_score_level, risk_confidence,
  changed_file_count, affected_file_count, failure_reason, base_sha, head_sha,
  graph_sha, created_at, progressed_at, completed_at,
  pull_request:pull_requests!inner (
    id, number, title, author_login, base_ref, head_ref,
    repository:repositories!inner (id, owner, name, is_seed)
  )` as const;

type RunRow = {
  id: string;
  status: AnalysisStatus;
  stage: AnalysisStageId;
  last_completed_stage: AnalysisStageId | null;
  risk_level: RiskLevel | null;
  risk_score: number | null;
  risk_score_level: RiskScoreLevel | null;
  risk_confidence: Confidence | null;
  changed_file_count: number | null;
  affected_file_count: number | null;
  failure_reason: string | null;
  base_sha: string | null;
  head_sha: string;
  graph_sha: string | null;
  created_at: string;
  progressed_at: string;
  completed_at: string | null;
  pull_request: {
    id: string;
    number: number;
    title: string;
    author_login: string;
    base_ref: string;
    head_ref: string;
    repository: { id: string; owner: string; name: string; is_seed: boolean };
  };
};

const toRun = (row: RunRow): AnalysisRun => ({
  id: row.id,
  status: row.status,
  stage: row.stage,
  lastCompletedStage: row.last_completed_stage,
  stale: isAnalysisStale({ status: row.status, progressedAt: row.progressed_at }, Date.now()),
  risk:
    row.risk_score !== null && row.risk_score_level !== null
      ? {
          kind: "score",
          score: row.risk_score,
          level: row.risk_score_level,
          confidence: row.risk_confidence ?? "low",
        }
      : row.risk_level !== null
        ? { kind: "label", level: row.risk_level }
        : null,
  changedFileCount: row.changed_file_count,
  affectedFileCount: row.affected_file_count,
  failureReason: row.failure_reason,
  baseSha: row.base_sha,
  headSha: row.head_sha,
  graphSha: row.graph_sha,
  createdAt: row.created_at,
  progressedAt: row.progressed_at,
  completedAt: row.completed_at,
  pullRequest: {
    id: row.pull_request.id,
    number: row.pull_request.number,
    title: row.pull_request.title,
    authorLogin: row.pull_request.author_login,
    baseRef: row.pull_request.base_ref,
    headRef: row.pull_request.head_ref,
  },
  repository: {
    id: row.pull_request.repository.id,
    owner: row.pull_request.repository.owner,
    name: row.pull_request.repository.name,
    isSeed: row.pull_request.repository.is_seed,
  },
});

// Ids arrive from the address bar and from forms. Anything that is not a uuid
// cannot be a row, and asking the database about it would be an error rather
// than a miss.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Reads ──────────────────────────────────────────────────────────────────

// The dashboard shows the most recent runs, not the full history.
export const RUN_LIMIT = 50;

// Real analyses only. Rows under a seeded repository are development fixtures
// and are never listed, counted or opened.
export async function listAnalysisRuns(): Promise<AnalysisRun[]> {
  const { data, error } = await createSupabaseClient()
    .from("analyses")
    .select(RUN_COLUMNS)
    .eq("pull_request.repository.is_seed", false)
    .order("created_at", { ascending: false })
    .limit(RUN_LIMIT);
  if (error) throw new Error(`Analysis runs could not be read: ${error.message}`);
  // The filter above is what keeps fixtures out. This is the check that it
  // did: a fixture row getting through is an error, not something to hide.
  const runs = data.map(toRun);
  if (runs.some((run) => run.repository.isSeed)) {
    throw new Error("The analysis run list returned a development fixture row.");
  }
  return runs;
}

// An analysis in another organization is not found, the same as one that does
// not exist: the database returns neither.
export async function getAnalysis(analysisId: string): Promise<AnalysisRun | null> {
  if (!UUID.test(analysisId)) return null;
  const { data, error } = await createSupabaseClient()
    .from("analyses")
    .select(RUN_COLUMNS)
    .eq("id", analysisId)
    .maybeSingle();
  if (error) throw new Error(`The analysis could not be read: ${error.message}`);
  if (!data) return null;
  const run = toRun(data);
  return run.repository.isSeed ? null : run;
}

export type StoredChangedFile = {
  path: string;
  changeType: Enums["file_change_type"];
  previousPath: string | null;
  additions: number;
  deletions: number;
  patchAvailable: boolean;
  analysed: boolean;
  stateReason: string | null;
};

export type StoredAffectedFile = {
  path: string;
  impactDepth: number;
  dependencyPath: string[];
  routeCount: number;
};

export type StoredSignal = {
  signal: string;
  level: RiskLevel;
  detail: SignalDetail;
  evidence: string[];
};

export type StoredRecommendation = {
  body: string;
  reason: string | null;
  origin: Enums["finding_origin"];
  evidence: string[];
};

export type StoredReport = {
  // Each list is the first so many rows; the run's own counts are the totals.
  changed: StoredChangedFile[];
  affected: StoredAffectedFile[];
  signals: StoredSignal[];
  recommendations: StoredRecommendation[];
  limitations: Limitation[];
  codeIssues: CodeIssue[];
  // null for an analysis completed before code checks existed: nothing was
  // checked, which is not the same as nothing found.
  codeCheck: CodeCheck | null;
  // Both null for an analysis completed before they existed.
  risk: RiskAssessment | null;
  testDiscovery: TestDiscovery | null;
  testRecommendations: TestRecommendation[];
  // Earlier and later analyses of the same pull request, newest first.
  otherRuns: {
    id: string;
    status: AnalysisStatus;
    headSha: string;
    createdAt: string;
  }[];
};

// How many file rows the report page reads. The API returns at most 1000 rows
// to one request, so anything longer is shown as its nearest part, and says so.
export const CHANGED_FILE_LIMIT = 1000;
export const AFFECTED_FILE_LIMIT = 500;
const FINDING_LIMIT = 50;
// Every stored recommendation: the analysis keeps at most 30 + 1 + 12 + 15.
const TEST_RECOMMENDATION_LIMIT = 100;
const EVIDENCE_LIMIT = 1000;
const OTHER_RUN_LIMIT = 10;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

// Stored documents are checked for shape when they are read, like every other
// stored document. Anything that is not the expected shape is left out rather
// than shown.
function readDetail(value: Json): SignalDetail {
  if (!isRecord(value)) return { rule: "", facts: [] };
  return { rule: typeof value.rule === "string" ? value.rule : "", facts: strings(value.facts) };
}

export function readLimitations(value: Json): Limitation[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) =>
    isRecord(entry) && typeof entry.id === "string" && typeof entry.detail === "string"
      ? [{ id: entry.id, detail: entry.detail, files: strings(entry.files) }]
      : [],
  );
}

function readRelatedFiles(value: Json): RelatedFile[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) =>
    isRecord(entry) && typeof entry.path === "string" && typeof entry.relationship === "string"
      ? [{ path: entry.path, relationship: entry.relationship, typeOnly: entry.typeOnly === true }]
      : [],
  );
}

const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;

export function readCodeCheck(value: Json | null): CodeCheck | null {
  if (!isRecord(value)) return null;
  const skipped = Array.isArray(value.skipped) ? value.skipped : [];
  const setAside = Array.isArray(value.setAside) ? value.setAside : [];
  return {
    checked: strings(value.checked),
    skipped: skipped.flatMap((entry) =>
      isRecord(entry) && typeof entry.path === "string" && typeof entry.reason === "string"
        ? [{ path: entry.path, reason: entry.reason }]
        : [],
    ),
    setAside: setAside.flatMap((entry) =>
      isRecord(entry) &&
      typeof entry.ruleId === "string" &&
      typeof entry.reason === "string" &&
      isCount(entry.count)
        ? [{ ruleId: entry.ruleId, reason: entry.reason, count: entry.count }]
        : [],
    ),
    omitted: isCount(value.omitted) ? value.omitted : 0,
  };
}

const isLine = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 1;
const textOrNull = (value: unknown): string | null => (typeof value === "string" ? value : null);

function readFileReferences(value: Json): TestFileReference[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) =>
    isRecord(entry) && typeof entry.path === "string"
      ? [
          {
            path: entry.path,
            startLine: isLine(entry.startLine) ? entry.startLine : null,
            endLine: isLine(entry.endLine) ? entry.endLine : null,
            relationshipEvidence: textOrNull(entry.relationshipEvidence),
          },
        ]
      : [],
  );
}

const changedReferences = (value: Json): FileReference[] =>
  readFileReferences(value).map(({ path, startLine, endLine }) => ({ path, startLine, endLine }));

const CONFIDENCES: readonly Confidence[] = ["high", "medium", "low"];
const SCORE_LEVELS: readonly RiskScoreLevel[] = ["low", "moderate", "high", "very_high"];
const DIRECTIONS: readonly RiskFactor["direction"][] = [
  "increases_risk",
  "none_found",
  "reduces_uncertainty",
  "unknown",
];
const oneOf = <T extends string>(values: readonly T[], value: unknown): T | null =>
  values.find((known) => known === value) ?? null;

export function readRiskAssessment(value: Json | null): RiskAssessment | null {
  if (!isRecord(value) || typeof value.summary !== "string" || !Array.isArray(value.factors)) {
    return null;
  }
  const score = typeof value.score === "number" ? value.score : null;
  const level = oneOf(SCORE_LEVELS, value.level);
  const factors: RiskFactor[] = value.factors.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const factor = oneOf(RISK_FACTOR_IDS, entry.factor);
    const direction = oneOf(DIRECTIONS, entry.direction);
    if (!factor || !direction || typeof entry.explanation !== "string") return [];
    return [
      {
        factor,
        direction,
        explanation: entry.explanation,
        evidence: strings(entry.evidence),
        contribution: typeof entry.contribution === "number" ? entry.contribution : null,
      },
    ];
  });
  return {
    method: typeof value.method === "number" ? value.method : 0,
    score: level ? score : null,
    level: score !== null ? level : null,
    summary: value.summary,
    factors,
    confidence: oneOf(CONFIDENCES, value.confidence) ?? "low",
    limitations: strings(value.limitations),
  };
}

function readTestDiscovery(value: Json | null): TestDiscovery | null {
  if (!isRecord(value)) return null;
  const conventions = Array.isArray(value.conventions) ? value.conventions : [];
  const omitted = isRecord(value.omitted) ? value.omitted : {};
  const command = isRecord(value.command) ? value.command : {};
  const unread = Array.isArray(value.symbolsUnread) ? value.symbolsUnread : [];
  return {
    testFileCount: isCount(value.testFileCount) ? value.testFileCount : 0,
    conventions: conventions.flatMap((entry) =>
      isRecord(entry) && typeof entry.rule === "string" && isCount(entry.count)
        ? [{ rule: entry.rule, count: entry.count }]
        : [],
    ),
    frameworks: strings(value.frameworks),
    omitted: {
      existing: isCount(omitted.existing) ? omitted.existing : 0,
      scenarios: isCount(omitted.scenarios) ? omitted.scenarios : 0,
      coverageUnknown: isCount(omitted.coverageUnknown) ? omitted.coverageUnknown : 0,
    },
    coverageData: typeof value.coverageData === "string" ? value.coverageData : "",
    command: {
      found: command.found === true,
      detail: typeof command.detail === "string" ? command.detail : "",
    },
    symbolsUnread: unread.flatMap((entry) =>
      isRecord(entry) && typeof entry.path === "string" && typeof entry.reason === "string"
        ? [{ path: entry.path, reason: entry.reason }]
        : [],
    ),
  };
}

export async function getStoredReport(run: AnalysisRun): Promise<StoredReport> {
  const client = createSupabaseClient();
  const [
    analysis,
    changed,
    affected,
    signals,
    recommendations,
    evidence,
    codeIssues,
    testRecommendations,
    otherRuns,
  ] = await Promise.all([
      client
        .from("analyses")
        .select("limitations, code_check, risk_assessment, test_discovery")
        .eq("id", run.id)
        .single(),
      client
        .from("analysis_files")
        .select(
          "path, change_type, previous_path, additions, deletions, patch_available, analysis_state, state_reason",
        )
        .eq("analysis_id", run.id)
        .eq("kind", "changed")
        .order("path")
        .limit(CHANGED_FILE_LIMIT),
      client
        .from("analysis_files")
        .select("path, impact_depth, dependency_path, route_count")
        .eq("analysis_id", run.id)
        .eq("kind", "affected")
        .order("impact_depth")
        .order("path")
        .limit(AFFECTED_FILE_LIMIT),
      client
        .from("analysis_risk_signals")
        .select("id, signal, level, detail")
        .eq("analysis_id", run.id)
        .order("signal")
        .limit(FINDING_LIMIT),
      client
        .from("analysis_recommendations")
        .select("id, position, body, reason, origin")
        .eq("analysis_id", run.id)
        .order("position")
        .limit(FINDING_LIMIT),
      client
        .from("analysis_evidence")
        .select("risk_signal_id, recommendation_id, file:analysis_files (path)")
        .eq("analysis_id", run.id)
        .not("file_id", "is", null)
        .limit(EVIDENCE_LIMIT),
      client
        .from("analysis_code_issues")
        .select(
          "title, category, severity, status, source, rule_id, start_line, start_column, end_line, end_column, message, conditions, related_files, related_file_count, file:analysis_files!inner (path)",
        )
        .eq("analysis_id", run.id)
        .order("position")
        .limit(ISSUE_LIMIT),
      client
        .from("analysis_test_recommendations")
        .select(
          "kind, title, description, rationale, priority, status, confidence, relationship, symbol, risk_addressed, related_changed_files, related_test_files, command, working_directory, evidence",
        )
        .eq("analysis_id", run.id)
        .order("position")
        .limit(TEST_RECOMMENDATION_LIMIT),
      client
        .from("analyses")
        .select("id, status, head_sha, created_at")
        .eq("pull_request_id", run.pullRequest.id)
        .neq("id", run.id)
        .order("created_at", { ascending: false })
        .limit(OTHER_RUN_LIMIT),
    ]);
  const failed = [
    analysis,
    changed,
    affected,
    signals,
    recommendations,
    evidence,
    codeIssues,
    testRecommendations,
    otherRuns,
  ].find(
    (result) => result.error,
  );
  if (failed?.error) throw new Error(`The report could not be read: ${failed.error.message}`);

  const evidenceFor = new Map<string, string[]>();
  for (const row of evidence.data ?? []) {
    const finding = row.risk_signal_id ?? row.recommendation_id;
    if (!finding || !row.file) continue;
    const list = evidenceFor.get(finding);
    if (list) list.push(row.file.path);
    else evidenceFor.set(finding, [row.file.path]);
  }
  const evidenceOf = (id: string) => (evidenceFor.get(id) ?? []).sort();

  return {
    changed: (changed.data ?? []).map((row) => ({
      path: row.path,
      changeType: row.change_type ?? "modified",
      previousPath: row.previous_path,
      additions: row.additions ?? 0,
      deletions: row.deletions ?? 0,
      patchAvailable: row.patch_available ?? false,
      analysed: row.analysis_state === "analysed",
      stateReason: row.state_reason,
    })),
    affected: (affected.data ?? []).map((row) => ({
      path: row.path,
      impactDepth: row.impact_depth ?? 0,
      dependencyPath: row.dependency_path ?? [],
      routeCount: row.route_count ?? 0,
    })),
    signals: (signals.data ?? []).map((row) => ({
      signal: row.signal,
      level: row.level,
      detail: readDetail(row.detail),
      evidence: evidenceOf(row.id),
    })),
    recommendations: (recommendations.data ?? []).map((row) => ({
      body: row.body,
      reason: row.reason,
      origin: row.origin,
      evidence: evidenceOf(row.id),
    })),
    limitations: readLimitations(analysis.data?.limitations ?? []),
    codeIssues: (codeIssues.data ?? []).map((row) => ({
      title: row.title,
      category: row.category,
      severity: row.severity,
      status: row.status,
      source: row.source,
      ruleId: row.rule_id,
      path: row.file.path,
      startLine: row.start_line,
      startColumn: row.start_column,
      endLine: row.end_line,
      endColumn: row.end_column,
      message: row.message,
      conditions: row.conditions,
      relatedFiles: readRelatedFiles(row.related_files),
      relatedFileCount: row.related_file_count,
    })),
    codeCheck: readCodeCheck(analysis.data?.code_check ?? null),
    risk: readRiskAssessment(analysis.data?.risk_assessment ?? null),
    testDiscovery: readTestDiscovery(analysis.data?.test_discovery ?? null),
    testRecommendations: (testRecommendations.data ?? []).map((row) => ({
      kind: row.kind,
      title: row.title,
      description: row.description,
      rationale: row.rationale,
      priority: row.priority,
      status: row.status,
      confidence: row.confidence,
      relationship: row.relationship,
      symbol: row.symbol,
      riskAddressed: row.risk_addressed,
      relatedChangedFiles: changedReferences(row.related_changed_files),
      relatedTestFiles: readFileReferences(row.related_test_files),
      command: row.command,
      workingDirectory: row.working_directory,
      evidence: strings(row.evidence),
    })),
    otherRuns: (otherRuns.data ?? []).map((row) => ({
      id: row.id,
      status: row.status,
      headSha: row.head_sha,
      createdAt: row.created_at,
    })),
  };
}

export type RepositoryIdentity = {
  id: string;
  providerRepositoryId: string;
  owner: string;
  name: string;
  isSeed: boolean;
};

export async function getRepositoryIdentity(
  client: SupabaseClient,
  repositoryId: string,
): Promise<RepositoryIdentity | null> {
  if (!UUID.test(repositoryId)) return null;
  const { data, error } = await client
    .from("repositories")
    .select("id, provider_repository_id, owner, name, is_seed")
    .eq("id", repositoryId)
    .maybeSingle();
  if (error) throw new Error(`The repository could not be read: ${error.message}`);
  return (
    data && {
      id: data.id,
      providerRepositoryId: data.provider_repository_id,
      owner: data.owner,
      name: data.name,
      isSeed: data.is_seed,
    }
  );
}

// ── Writes ─────────────────────────────────────────────────────────────────
// These take the client to use, because an analysis keeps writing after the
// request that started it has ended.

const UNIQUE_VIOLATION = "23505";

// One row per pull request per repository. What GitHub says about it now
// replaces what was stored: a title or a branch can change between analyses.
export async function upsertPullRequest(
  client: SupabaseClient,
  organizationId: string,
  repositoryId: string,
  pullRequest: PullRequest,
): Promise<string> {
  const { data, error } = await client
    .from("pull_requests")
    .upsert(
      {
        organization_id: organizationId,
        repository_id: repositoryId,
        number: pullRequest.number,
        title: pullRequest.title,
        author_login: pullRequest.authorLogin,
        base_ref: pullRequest.baseRef,
        head_ref: pullRequest.headRef,
      },
      { onConflict: "repository_id,number" },
    )
    .select("id")
    .single();
  if (error) throw new Error(`The pull request could not be saved: ${error.message}`);
  return data.id;
}

// The newest completed analysis of this pull request at this commit.
export async function findCompletedAnalysis(
  client: SupabaseClient,
  pullRequestId: string,
  headSha: string,
): Promise<string | null> {
  const { data, error } = await client
    .from("analyses")
    .select("id")
    .eq("pull_request_id", pullRequestId)
    .eq("head_sha", headSha)
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Earlier analyses could not be checked: ${error.message}`);
  return data?.id ?? null;
}

export async function findUnfinishedAnalysis(
  client: SupabaseClient,
  pullRequestId: string,
  headSha: string,
): Promise<string | null> {
  const { data, error } = await client
    .from("analyses")
    .select("id")
    .eq("pull_request_id", pullRequestId)
    .eq("head_sha", headSha)
    .in("status", ["pending", "running"])
    .maybeSingle();
  if (error) throw new Error(`Running analyses could not be checked: ${error.message}`);
  return data?.id ?? null;
}

// Starts an analysis with validation already behind it. Returns null when
// another analysis of the same pull request at the same commit is already
// unfinished, which the database decides.
export async function insertAnalysis(
  client: SupabaseClient,
  organizationId: string,
  pullRequestId: string,
  pullRequest: PullRequest,
): Promise<string | null> {
  const { data, error } = await client
    .from("analyses")
    .insert({
      organization_id: organizationId,
      pull_request_id: pullRequestId,
      status: "running",
      stage: "fetching",
      last_completed_stage: "validating",
      base_sha: pullRequest.baseSha,
      head_sha: pullRequest.headSha,
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error?.code === UNIQUE_VIOLATION) return null;
  if (error) throw new Error(`The analysis could not be started: ${error.message}`);
  return data.id;
}

export async function advanceAnalysis(
  client: SupabaseClient,
  analysisId: string,
  stage: AnalysisStageId,
  completed: AnalysisStageId,
): Promise<void> {
  const { data, error } = await client
    .from("analyses")
    .update({ stage, last_completed_stage: completed })
    .eq("id", analysisId)
    .eq("status", "running")
    .select("id");
  if (error) throw new Error(`Progress could not be recorded: ${error.message}`);
  // Someone closed it as stale and started another. The pipeline stops.
  if (data.length === 0) throw new RunSuperseded();
}

// Does nothing to an analysis that has already finished.
export async function failAnalysis(
  client: SupabaseClient,
  analysisId: string,
  failureReason: string,
): Promise<void> {
  const { error } = await client
    .from("analyses")
    .update({ status: "failed", failure_reason: failureReason.slice(0, 500) })
    .eq("id", analysisId)
    .eq("status", "running");
  if (error) throw new Error(`The failure could not be recorded: ${error.message}`);
}

// Closes an unfinished analysis only if it has recorded no progress within the
// stale window, so one that is still moving is never closed from under itself.
export async function closeStaleAnalysis(client: SupabaseClient, analysisId: string): Promise<void> {
  const { error } = await client
    .from("analyses")
    .update({
      status: "failed",
      failure_reason: `No progress was recorded for ${STALE_AFTER_MS / 60_000} minutes, so this analysis was closed when it was retried.`,
    })
    .eq("id", analysisId)
    .eq("status", "running")
    .lt("progressed_at", new Date(Date.now() - STALE_AFTER_MS).toISOString());
  if (error) throw new Error(`The stale analysis could not be closed: ${error.message}`);
}

// The status change and every result row, in one transaction.
export async function completeAnalysis(
  client: SupabaseClient,
  analysisId: string,
  report: ImpactReport,
): Promise<void> {
  const { error } = await client.rpc("complete_analysis", { run_id: analysisId, report });
  if (error) throw new Error(`The report could not be saved: ${error.message}`);
}
