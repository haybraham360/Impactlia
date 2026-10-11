import "server-only";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  downloadArchive,
  findHeadCommit,
  type PublicRepository,
} from "@/lib/github/public-repository";
import { summariseCoverage } from "@/lib/graph/coverage";
import { buildGraphModel } from "@/lib/graph/model";
import { extractArchive, type ArchiveLimits } from "@/lib/ingestion/archive";
import { IngestionError } from "@/lib/ingestion/errors";
import {
  RunSuperseded,
  advanceRun,
  completeRun,
  failRun,
} from "@/lib/ingestion/runs";
import { PROCESSING_LIMIT_MS, stageOf, type StageId } from "@/lib/ingestion/stages";
import type { SupabaseClient } from "@/lib/supabase/server";
import { frameworkAdapters } from "@/parser/adapters";
import { coreExclusionRules } from "@/parser/exclusions";
import { parseRepository } from "@/parser/parse-repository";
import { readParserOutput } from "@/parser/validate";

// What one analysis may use. A repository over any of these fails with a
// message naming the limit; nothing is analysed in part.
const MEGABYTE = 1024 * 1024;
const ARCHIVE_BYTES = 100 * MEGABYTE;
const LIMITS: ArchiveLimits = {
  unpackedBytes: 1024 * MEGABYTE,
  writtenBytes: 200 * MEGABYTE,
  entries: 100_000,
  sourceFiles: 5_000,
};

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
//
// Parsing is synchronous and holds this server process while it runs; the
// source-file limit above is what keeps that bounded.
export async function runPipeline(
  client: SupabaseClient,
  runId: string,
  repository: PublicRepository,
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
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "impactlia-run-"));
    const requestedSha = await findHeadCommit(repository);
    const archive = path.join(directory, "archive.tar.gz");
    await downloadArchive(repository, requestedSha, archive, ARCHIVE_BYTES);

    await enter("preparing");
    const source = path.join(directory, "source");
    const extracted = await extractArchive(
      archive,
      source,
      coreExclusionRules,
      LIMITS,
    );
    // The archive names the commit it was built from. That, not the commit
    // that was asked for, is what gets recorded; if they differ the archive is
    // not what this run is about.
    if (extracted.commitSha !== null && extracted.commitSha !== requestedSha) {
      throw new IngestionError(
        "GitHub returned an archive of a different commit from the one requested. Try again.",
      );
    }
    if (extracted.sourceFiles === 0) {
      throw new IngestionError(
        `${repository.owner}/${repository.name} has no TypeScript or JavaScript files outside excluded folders. Those are the only languages analysed so far.`,
      );
    }

    await enter("parsing");
    const output = parseRepository(source, frameworkAdapters);

    await enter("calculating");
    // What is stored is what the explorer will read back, so it goes through
    // the same contract check and the same model build the explorer uses. A
    // graph that would not open is refused here rather than saved.
    const stored = readParserOutput(JSON.parse(JSON.stringify(output)));
    buildGraphModel(stored);
    summariseCoverage(stored);

    await enter("saving");
    await completeRun(client, runId, extracted.commitSha, stored);
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
