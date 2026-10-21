import "server-only";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { downloadArchive } from "@/lib/github/public-repository";
import type { RepositoryAccess } from "@/lib/github/repository-url";
import { summariseCoverage } from "@/lib/graph/coverage";
import { buildGraphModel } from "@/lib/graph/model";
import { extractArchive, type ArchiveLimits } from "@/lib/ingestion/archive";
import { IngestionError } from "@/lib/ingestion/errors";
import { frameworkAdapters } from "@/parser/adapters";
import type { ParserOutput } from "@/parser/contract";
import { coreExclusionRules } from "@/parser/exclusions";
import { parseRepository } from "@/parser/parse-repository";
import { readParserOutput } from "@/parser/validate";

// Turning one commit of a public repository into a graph. Shared by the two
// things that do it: a repository run, for the default branch, and a pull
// request analysis, for the pull request's head.

// What one commit may use. A repository over any of these fails with a
// message naming the limit; nothing is analysed in part.
const MEGABYTE = 1024 * 1024;
const ARCHIVE_BYTES = 100 * MEGABYTE;
const LIMITS: ArchiveLimits = {
  unpackedBytes: 1024 * MEGABYTE,
  writtenBytes: 200 * MEGABYTE,
  entries: 100_000,
  sourceFiles: 5_000,
};

// A private directory for one run. The caller removes it.
export function createWorkDirectory(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "impactlia-run-"));
}

export async function downloadCommit(
  repository: RepositoryAccess,
  commitSha: string,
  directory: string,
): Promise<string> {
  const archive = path.join(directory, "archive.tar.gz");
  await downloadArchive(repository, commitSha, archive, ARCHIVE_BYTES);
  return archive;
}

// Unpacks the archive for the parser. Returns where, and the commit the
// archive says it was built from: that, not the commit that was asked for, is
// what gets recorded, and if they differ the archive is not what the run is
// about. null when the archive does not say.
export async function unpackCommit(
  archive: string,
  directory: string,
  requestedSha: string,
  repository: RepositoryAccess,
): Promise<{ source: string; commitSha: string | null }> {
  const source = path.join(directory, "source");
  const extracted = await extractArchive(archive, source, coreExclusionRules, LIMITS);
  if (extracted.commitSha !== null && extracted.commitSha !== requestedSha) {
    throw new IngestionError(
      "GitHub returned an archive of a different commit from the one requested. Try again.",
    );
  }
  if (extracted.sourceFiles === 0) {
    throw new IngestionError(
      `${repository.owner}/${repository.name} has no TypeScript or JavaScript files outside excluded folders at that commit. Those are the only languages analysed so far.`,
    );
  }
  return { source, commitSha: extracted.commitSha };
}

// Parsing is synchronous and holds this server process while it runs; the
// source-file limit above is what keeps that bounded.
export function parseSource(source: string): ParserOutput {
  return parseRepository(source, frameworkAdapters);
}

// The graph as it will be read back: through the same contract check and the
// same model build the explorer uses. One that would not open is refused here
// rather than used or saved.
export function checkedGraph(output: ParserOutput): ParserOutput {
  const stored = readParserOutput(JSON.parse(JSON.stringify(output)));
  buildGraphModel(stored);
  summariseCoverage(stored);
  return stored;
}
