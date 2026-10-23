import "server-only";
import fs from "node:fs";
import {
  findPullRequest,
  listPullRequestFiles,
  type PullRequest,
} from "@/lib/github/pull-request";
import type { RepositoryAccess } from "@/lib/github/repository-url";
import { calculateBlastRadius, mapChangedFiles, scoreImpact } from "@/lib/impact/analyze";
import { collectCodeIssues, planCodeCheck } from "@/lib/impact/code-issues";
import type { ImpactReport, Limitation } from "@/lib/impact/report";
import { repositoryFiles } from "@/lib/impact/repository-files";
import { advanceAnalysis, completeAnalysis, failAnalysis } from "@/lib/impact/runs";
import { assessRisk } from "@/lib/impact/score";
import { recommendTests } from "@/lib/impact/tests";
import { typeCheckFiles, type TypeCheckOutcome } from "@/lib/impact/type-check";
import {
  PROCESSING_LIMIT_MS,
  analysisStageOf,
  type AnalysisStageId,
} from "@/lib/impact/stages";
import { IngestionError } from "@/lib/ingestion/errors";
import { RunSuperseded } from "@/lib/ingestion/runs";
import { BUDGETS } from "@/lib/ingestion/budgets";
import { buildCommitGraph, createWorkDirectory } from "@/lib/ingestion/source";
import type { SupabaseClient } from "@/lib/supabase/server";
import { loadGrammars } from "@/parser/languages/tree-sitter";

const SELECTIVE_TYPE_CHECK =
  "Not type-checked: this analysis downloaded only the files that changed, and the compiler needs every file the changed code imports.";

// How the graph was built, when it was not from the whole commit. Said in
// the report, because what was read and what was taken from earlier differ.
function selectiveLimitation(indexSha: string, changedSinceIndex: number): Limitation {
  return {
    id: "selective-analysis",
    detail: `Dependencies come from the stored analysis of commit ${indexSha.slice(0, 7)}, updated with the ${changedSinceIndex} ${changedSinceIndex === 1 ? "file" : "files"} GitHub lists as changed between it and this pull request's head. Only those files, the changed files and the tests importing them were downloaded; every other file's imports were taken from the stored analysis and resolved again against this commit's files. Changed TypeScript was not type-checked.`,
    files: [],
  };
}

function reasonFor(error: unknown, stage: AnalysisStageId, analysisId: string): string {
  if (error instanceof IngestionError) return error.message;
  // The real error stays on the server. What is shown names only the stage.
  console.error(`Analysis ${analysisId} failed while ${stage}:`, error);
  return `Something went wrong in the "${analysisStageOf(stage).label}" stage. The details were logged on the server; nothing was saved from this analysis.`;
}

// How a run ended, for a caller that acts on it. A member's run ignores it:
// everything is already written to the analysis. An automatic analysis uses
// it to decide whether to retry.
export type PipelineOutcome =
  | { kind: "completed" }
  | { kind: "failed"; reason: string; retryable: boolean; retryAt: number | null }
  // Someone closed it as stale and started another.
  | { kind: "superseded" };

// Runs an analysis from "fetching" to its end. Validation has already
// happened: `pullRequest` is what GitHub said when the run was created, and
// its head commit is the one revision this run is about.
//
// Never throws. Every outcome is written to the analysis, and the temporary
// directory is removed whatever happens. If even the failure cannot be
// written, the analysis stays 'running' with no further progress, which is
// exactly what the dashboard shows as stale.
//
// Nothing from the repository is executed: the archive is unpacked as data
// and read by the parser.
export async function runImpactPipeline(
  client: SupabaseClient,
  analysisId: string,
  repositoryId: string,
  repository: RepositoryAccess,
  pullRequest: PullRequest,
): Promise<PipelineOutcome> {
  const startedAt = Date.now();
  let stage: AnalysisStageId = "fetching";
  // The one way an analysis moves on: the stage just finished is recorded
  // with the one starting, and one past its time limit goes no further.
  async function enter(next: AnalysisStageId): Promise<void> {
    if (Date.now() - startedAt > PROCESSING_LIMIT_MS) {
      throw new IngestionError(
        `The analysis passed its limit of ${PROCESSING_LIMIT_MS / 60_000} minutes and was stopped. This repository is too large to analyse at the moment.`,
      );
    }
    await advanceAnalysis(client, analysisId, next, stage);
    stage = next;
  }

  let directory: string | null = null;
  try {
    const changes = await listPullRequestFiles(
      repository,
      pullRequest.number,
      pullRequest.changedFileCount,
    );
    // The file list is of the pull request as it is now. If it has been
    // pushed to since this run was created, the list belongs to a different
    // commit from the one being analysed, and using it would mix two
    // revisions.
    const current = await findPullRequest(repository, pullRequest.number);
    if (current.headSha !== pullRequest.headSha || current.baseSha !== pullRequest.baseSha) {
      throw new IngestionError(
        "The pull request changed on GitHub while it was being analysed. Analyze it again to use its current commits.",
      );
    }

    await enter("preparing");
    directory = createWorkDirectory();
    const grammars = await loadGrammars();
    const { graph, source, commitSha, selective } = await buildCommitGraph(
      client,
      repositoryId,
      repository,
      pullRequest.headSha,
      directory,
      grammars,
    );

    await enter("mapping");
    const mapping = mapChangedFiles(graph, changes);

    await enter("calculating");
    const radius = calculateBlastRadius(graph, mapping.starts);

    // On the selective path only the files that changed since the index are
    // on disk. The pull request's own changed files, and the tests that
    // import them directly, are downloaded too, so their declarations and
    // imports can be read; anything else reads as unavailable.
    if (selective) {
      const pathOf = new Map(graph.files.map((file) => [file.id, file.path]));
      const directTests = radius.traversal.reached
        .filter((entry) => entry.depth === 1)
        .map((entry) => pathOf.get(entry.file) ?? entry.file)
        .filter((file) => graph.files.find((node) => node.path === file)?.role.id === "test")
        .slice(0, BUDGETS.fetchedTests);
      await selective.fetchMore([...mapping.changed.map((file) => file.path), ...directTests]);
    }
    const files = repositoryFiles(source, selective?.readable);

    await enter("scoring");
    const analysis = scoreImpact(graph, changes, mapping, radius, commitSha);

    // Only the head commit is checked, and only lines the pull request adds
    // count, so an issue found is one the change introduces or touches.
    await enter("checking");
    const plan = planCodeCheck(graph, changes, mapping);
    const outcomes: TypeCheckOutcome[] = selective
      ? plan.targets.map((path) => ({ path, state: "skipped", reason: SELECTIVE_TYPE_CHECK }))
      : typeCheckFiles(source, plan.targets);
    const code = collectCodeIssues(graph, changes, radius.index, plan, outcomes);

    // Test files are read as text from the same commit, and the score is
    // weighed last, once every factor it uses is known.
    await enter("recommending");
    const tests = recommendTests(graph, changes, mapping, radius, files, grammars);
    const limitations = [
      ...(selective ? [selectiveLimitation(selective.indexSha, selective.changedSinceIndex)] : []),
      ...analysis.limitations,
      ...code.limitations,
      ...tests.limitations,
    ];
    const risk = assessRisk({
      changes,
      mapping,
      signals: analysis.signals,
      codeIssues: code.issues,
      codeCheck: code.check,
      tests: tests.evidence,
      limitations,
    });
    const report: ImpactReport = {
      ...analysis,
      limitations,
      codeIssues: code.issues,
      codeCheck: code.check,
      testRecommendations: tests.recommendations,
      testDiscovery: tests.discovery,
      risk,
    };

    await enter("saving");
    await completeAnalysis(client, analysisId, report);
    return { kind: "completed" };
  } catch (error) {
    if (error instanceof RunSuperseded) return { kind: "superseded" };
    const reason = reasonFor(error, stage, analysisId);
    try {
      await failAnalysis(client, analysisId, reason);
    } catch (unrecorded) {
      console.error(
        `Analysis ${analysisId} failed and the failure could not be recorded:`,
        unrecorded,
      );
    }
    const known = error instanceof IngestionError ? error : null;
    return {
      kind: "failed",
      reason,
      retryable: known?.retryable ?? false,
      retryAt: known?.retryAt ?? null,
    };
  } finally {
    if (directory !== null) fs.rmSync(directory, { recursive: true, force: true });
  }
}
