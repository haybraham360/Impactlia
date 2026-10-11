import "server-only";
import fs from "node:fs";
import {
  findPullRequest,
  listPullRequestFiles,
  type PullRequest,
} from "@/lib/github/pull-request";
import type { RepositoryReference } from "@/lib/github/repository-url";
import { calculateBlastRadius, mapChangedFiles, scoreImpact } from "@/lib/impact/analyze";
import { advanceAnalysis, completeAnalysis, failAnalysis } from "@/lib/impact/runs";
import {
  PROCESSING_LIMIT_MS,
  analysisStageOf,
  type AnalysisStageId,
} from "@/lib/impact/stages";
import { IngestionError } from "@/lib/ingestion/errors";
import { RunSuperseded } from "@/lib/ingestion/runs";
import {
  checkedGraph,
  createWorkDirectory,
  downloadCommit,
  parseSource,
  unpackCommit,
} from "@/lib/ingestion/source";
import type { SupabaseClient } from "@/lib/supabase/server";

function reasonFor(error: unknown, stage: AnalysisStageId, analysisId: string): string {
  if (error instanceof IngestionError) return error.message;
  // The real error stays on the server. What is shown names only the stage.
  console.error(`Analysis ${analysisId} failed while ${stage}:`, error);
  return `Something went wrong in the "${analysisStageOf(stage).label}" stage. The details were logged on the server; nothing was saved from this analysis.`;
}

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
  repository: RepositoryReference,
  pullRequest: PullRequest,
): Promise<void> {
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
    const archive = await downloadCommit(repository, pullRequest.headSha, directory);
    const { source, commitSha } = await unpackCommit(
      archive,
      directory,
      pullRequest.headSha,
      repository,
    );
    const graph = checkedGraph(parseSource(source));

    await enter("mapping");
    const mapping = mapChangedFiles(graph, changes);

    await enter("calculating");
    const radius = calculateBlastRadius(graph, mapping.starts);

    await enter("scoring");
    const report = scoreImpact(graph, changes, mapping, radius, commitSha);

    await enter("saving");
    await completeAnalysis(client, analysisId, report);
  } catch (error) {
    if (error instanceof RunSuperseded) return;
    try {
      await failAnalysis(client, analysisId, reasonFor(error, stage, analysisId));
    } catch (unrecorded) {
      console.error(
        `Analysis ${analysisId} failed and the failure could not be recorded:`,
        unrecorded,
      );
    }
  } finally {
    if (directory !== null) fs.rmSync(directory, { recursive: true, force: true });
  }
}
