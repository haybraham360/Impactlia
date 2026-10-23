import "server-only";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openArchive } from "@/lib/github/public-repository";
import type { RepositoryAccess } from "@/lib/github/repository-url";
import { summariseCoverage } from "@/lib/graph/coverage";
import { buildGraphModel } from "@/lib/graph/model";
import { extractArchive, type ArchiveLimits } from "@/lib/ingestion/archive";
import { BUDGETS } from "@/lib/ingestion/budgets";
import { IngestionError } from "@/lib/ingestion/errors";
import { readStoredIndex } from "@/lib/ingestion/runs";
import { buildSelectively } from "@/lib/ingestion/selective";
import type { SupabaseClient } from "@/lib/supabase/server";
import { frameworkAdapters } from "@/parser/adapters";
import type { ParserOutput } from "@/parser/contract";
import { SUPPORTED_LANGUAGE_NAMES } from "@/parser/languages/registry";
import type { Grammars } from "@/parser/languages/tree-sitter";
import { coreExclusionRules, oversizedFileRule } from "@/parser/exclusions";
import { parseRepository } from "@/parser/parse-repository";
import { readParserOutput } from "@/parser/validate";

// Turning one commit of a public repository into a graph. Shared by the two
// things that do it: a repository run, for the default branch, and a pull
// request analysis, for the pull request's head.

// What downloading one commit may use (budgets.ts). A repository over any of
// these fails with a message naming the limit, except a source file over the
// size limit, which is left out of the graph and named.
const LIMITS: ArchiveLimits = {
  unpackedBytes: BUDGETS.unpackedBytes,
  writtenBytes: BUDGETS.writtenBytes,
  entries: BUDGETS.entries,
  sourceFiles: BUDGETS.sourceFiles,
  typescriptFiles: BUDGETS.typescriptFiles,
  sourceFileBytes: BUDGETS.sourceFileBytes,
};

// A private directory for one run. The caller removes it.
export function createWorkDirectory(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "impactlia-run-"));
}

export type CommitSource = {
  // Where the commit's files were written.
  source: string;
  // The commit the archive says it was built from: that, not the one asked
  // for, is what gets recorded. null when the archive does not say.
  commitSha: string | null;
  // Source files left out for their size, by repository path.
  oversized: string[];
};

// Downloads one commit and unpacks it for the parser as it arrives. If the
// archive says it is of a different commit from the one asked for, it is
// not what the run is about, and the run stops.
export async function fetchCommit(
  repository: RepositoryAccess,
  requestedSha: string,
  directory: string,
): Promise<CommitSource> {
  const source = path.join(directory, "source");
  const archive = await openArchive(repository, requestedSha, BUDGETS.archiveBytes);
  const extracted = await extractArchive(archive, source, coreExclusionRules, LIMITS);
  if (extracted.commitSha !== null && extracted.commitSha !== requestedSha) {
    throw new IngestionError(
      "GitHub returned an archive of a different commit from the one requested. Try again.",
    );
  }
  if (extracted.sourceFiles === 0) {
    throw new IngestionError(
      `${repository.owner}/${repository.name} has no source files in a supported language outside excluded folders at that commit. The languages analysed so far are ${SUPPORTED_LANGUAGE_NAMES}.`,
    );
  }
  return { source, commitSha: extracted.commitSha, oversized: extracted.oversized };
}

// Parsing is synchronous and holds this server process while it runs; the
// source-file limits above are what keep that bounded.
export function parseSource(commit: CommitSource, grammars: Grammars): ParserOutput {
  return parseRepository(commit.source, grammars, frameworkAdapters, {
    excludedFiles: new Map(commit.oversized.map((file) => [file, oversizedFileRule.id])),
  });
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

export type CommitGraph = {
  graph: ParserOutput;
  // Where the commit's files are on disk.
  source: string;
  commitSha: string | null;
  // Set when the graph was built by updating the stored index rather than
  // from the whole commit; see lib/ingestion/selective.ts.
  selective: {
    indexSha: string;
    changedSinceIndex: number;
    readable: Set<string>;
    fetchMore: (paths: readonly string[]) => Promise<string[]>;
  } | null;
};

// The one way a run turns a commit into a checked graph: by updating the
// repository's stored index where that is exact and worth it, otherwise by
// downloading the whole commit. Either way the graph is read back through
// the parser contract before it is used. `useIndex: false` is a clean
// rebuild, for when a stored index is in doubt.
export async function buildCommitGraph(
  client: SupabaseClient,
  repositoryId: string,
  repository: RepositoryAccess,
  commitSha: string,
  directory: string,
  grammars: Grammars,
  { useIndex = true }: { useIndex?: boolean } = {},
): Promise<CommitGraph> {
  const index = useIndex ? await readStoredIndex(client, repositoryId) : null;
  if (index) {
    const outcome = await buildSelectively(repository, index, commitSha, directory, grammars);
    if (outcome.kind === "updated") {
      const { graph } = outcome;
      try {
        return {
          graph: checkedGraph(graph.output),
          source: graph.source,
          commitSha,
          selective: {
            indexSha: index.commitSha,
            changedSinceIndex: graph.changedSinceIndex,
            readable: graph.readable,
            fetchMore: graph.fetchMore,
          },
        };
      } catch (error) {
        // An update that does not hold together is never used. The whole
        // commit is read instead, from a clean directory.
        console.error(`The stored index of ${repository.owner}/${repository.name} could not be updated:`, error);
        fs.rmSync(graph.source, { recursive: true, force: true });
      }
    }
  }
  const commit = await fetchCommit(repository, commitSha, directory);
  return {
    graph: checkedGraph(parseSource(commit, grammars)),
    source: commit.source,
    commitSha: commit.commitSha,
    selective: null,
  };
}
