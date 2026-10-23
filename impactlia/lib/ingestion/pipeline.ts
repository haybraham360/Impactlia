import "server-only";
import fs from "node:fs";
import { findHeadCommit, type PublicRepository } from "@/lib/github/public-repository";
import { IngestionError } from "@/lib/ingestion/errors";
import {
  RunSuperseded,
  advanceRun,
  completeRun,
  failRun,
} from "@/lib/ingestion/runs";
import { buildCommitGraph, createWorkDirectory } from "@/lib/ingestion/source";
import { loadGrammars } from "@/parser/languages/tree-sitter";
import { PROCESSING_LIMIT_MS, stageOf, type StageId } from "@/lib/ingestion/stages";
import type { SupabaseClient } from "@/lib/supabase/server";

function reasonFor(error: unknown, stage: StageId, runId: string): string {
  if (error instanceof IngestionError) return error.message;
  // The real error stays on the server. What is shown names only the stage.
  console.error(`Repository run ${runId} failed while ${stage}:`, error);
  return `Something went wrong in the "${stageOf(stage).label}" stage. The details were logged on the server; nothing was saved from this run.`;
}

// Runs a repository run from "fetching" to its end. Validation has already
// happened: `repository` is what GitHub says is there.
//
// Never throws. Every outcome is written to the run, and the temporary
// directory is removed whatever happens. If even the failure cannot be
// written, the run stays 'running' with no further progress, which is exactly
// what the dashboard shows as stale.
export async function runPipeline(
  client: SupabaseClient,
  runId: string,
  repositoryId: string,
  repository: PublicRepository,
  { useIndex }: { useIndex: boolean },
): Promise<void> {
  const startedAt = Date.now();
  let stage: StageId = "fetching";
  // The one way a run moves on: the stage just finished is recorded with the
  // one starting, and a run past its time limit goes no further.
  async function enter(next: StageId): Promise<void> {
    if (Date.now() - startedAt > PROCESSING_LIMIT_MS) {
      throw new IngestionError(
        `The analysis passed its limit of ${PROCESSING_LIMIT_MS / 60_000} minutes and was stopped. This repository is too large to analyse at the moment.`,
      );
    }
    await advanceRun(client, runId, next, stage);
    stage = next;
  }

  let directory: string | null = null;
  try {
    directory = createWorkDirectory();
    const requestedSha = await findHeadCommit(repository);

    await enter("preparing");
    const grammars = await loadGrammars();

    // Reading the files and parsing them happen together: the selective path
    // downloads only what it parses.
    await enter("parsing");
    const { graph: stored, commitSha } = await buildCommitGraph(
      client,
      repositoryId,
      repository,
      requestedSha,
      directory,
      grammars,
      { useIndex },
    );

    await enter("calculating");

    await enter("saving");
    await completeRun(client, runId, commitSha, stored);
  } catch (error) {
    if (error instanceof RunSuperseded) return;
    try {
      await failRun(client, runId, reasonFor(error, stage, runId));
    } catch (unrecorded) {
      console.error(`Repository run ${runId} failed and the failure could not be recorded:`, unrecorded);
    }
  } finally {
    if (directory !== null) fs.rmSync(directory, { recursive: true, force: true });
  }
}
