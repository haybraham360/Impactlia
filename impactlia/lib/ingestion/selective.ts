import fs from "node:fs";
import path from "node:path";
import { compareCommits, fetchFilesAtCommit } from "../github/commits";
import type { RepositoryAccess } from "../github/repository-url";
import { BUDGETS } from "./budgets";
import { frameworkAdapters } from "../../parser/adapters";
import type { ParserOutput } from "../../parser/contract";
import { oversizedFileRule } from "../../parser/exclusions";
import { OverlayUnsupported } from "../../parser/languages/adapter";
import { supportedLanguageOf } from "../../parser/languages/registry";
import type { Grammars } from "../../parser/languages/tree-sitter";
import { parseRepository } from "../../parser/parse-repository";

// The selective path: the graph of a commit, built from the repository's
// stored graph of an earlier commit (the index) and the files that changed
// between the two, instead of from a download of the whole commit.
//
//   1. GitHub compares the index's commit with the one wanted. The index
//      must be an ancestor of it, so the files listed are every file that
//      differs; GitHub's git history says which, not a guess from paths.
//   2. The commit's file tree is laid out on disk from the index's paths
//      and the comparison: every path, but only changed source files and
//      the project files the resolvers read (package.json, tsconfig.json,
//      go.mod, …) have their contents, downloaded one by one.
//   3. The parser updates the index (parse-repository.ts, overlay): changed
//      files are parsed and every stored reference is resolved again.
//
// It is used only where it saves real work (a repository of at least
// BUDGETS.selectiveFromFiles source files), and declines, with a reason,
// whenever its result could differ from reading the whole commit. The
// caller then reads the whole commit.

export type StoredIndex = { output: ParserOutput; commitSha: string };

export type SelectiveGraph = {
  output: ParserOutput;
  // Where the commit's file tree was laid out.
  source: string;
  // Paths whose contents are on disk; every other file there is empty.
  readable: Set<string>;
  // Files changed between the index's commit and this one.
  changedSinceIndex: number;
  // Downloads more files of the commit into the tree, within the budget,
  // and returns the ones now readable.
  fetchMore: (paths: readonly string[]) => Promise<string[]>;
};

export type SelectiveOutcome =
  | { kind: "updated"; graph: SelectiveGraph }
  | { kind: "declined"; reason: string };

// Files whose change alters how every import resolves or which framework
// is read: any change to one sends the run down the full path.
const RESOLUTION_FILE = /(^|\/)(package\.json|[jt]sconfig[\w.-]*\.json|go\.mod|go\.work|Cargo\.toml|composer\.json|pyproject\.toml|setup\.cfg|setup\.py)$/;
// Project files whose contents the resolvers and the test search read.
const READ_PROJECT_FILE = /(^|\/)(package\.json|[jt]sconfig[\w.-]*\.json|go\.mod|Cargo\.toml|composer\.json|pyproject\.toml|setup\.cfg|pytest\.ini|tox\.ini)$/;
// A framework's configuration, which the parser always reads.
const FRAMEWORK_CONFIG = /(^|\/)[^/]+\.config\.[cm]?[jt]s$/;

// A repository path that is safe to write under the tree's root.
function safe(relative: string): boolean {
  return (
    relative !== "" &&
    !relative.startsWith("/") &&
    !relative.includes("\\") &&
    !relative.includes("\0") &&
    relative.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..")
  );
}

export async function buildSelectively(
  repository: RepositoryAccess,
  index: StoredIndex,
  headSha: string,
  directory: string,
  grammars: Grammars,
): Promise<SelectiveOutcome> {
  const declined = (reason: string): SelectiveOutcome => ({ kind: "declined", reason });
  const { output: base } = index;
  if (base.files.length < BUDGETS.selectiveFromFiles) {
    return declined(`The repository has fewer than ${BUDGETS.selectiveFromFiles.toLocaleString("en")} source files, so it is read in full.`);
  }

  const comparison = index.commitSha === headSha
    ? { status: "identical" as const, files: [], complete: true }
    : await compareCommits(repository, index.commitSha, headSha);
  if (comparison.status !== "ahead" && comparison.status !== "identical") {
    return declined(`The stored analysis is of commit ${index.commitSha.slice(0, 7)}, which is not an ancestor of this one.`);
  }
  if (!comparison.complete || comparison.files.length > BUDGETS.changedFiles) {
    return declined(`More than ${BUDGETS.changedFiles} files changed since the stored analysis.`);
  }
  const resolutionChange = comparison.files.find(
    (file) => RESOLUTION_FILE.test(file.path) || (file.previousPath !== null && RESOLUTION_FILE.test(file.previousPath)),
  );
  if (resolutionChange) {
    return declined(`${resolutionChange.path} changed, which can change how every import resolves.`);
  }

  // The commit's paths: the index's, less what was removed or renamed away,
  // plus what was added. Paths under an excluded folder are not listed,
  // exactly as when a whole commit is unpacked.
  const excludedFolders = base.excluded.filter((entry) => entry.type === "directory").map((entry) => entry.path);
  const underExcluded = (file: string) => excludedFolders.some((folder) => file.startsWith(`${folder}/`));
  const paths = new Set([
    ...base.files.map((file) => file.path),
    ...base.excluded.filter((entry) => entry.type === "file").map((entry) => entry.path),
  ]);
  const changed = new Set<string>();
  for (const file of comparison.files) {
    if (file.previousPath !== null) paths.delete(file.previousPath);
    if (file.status === "removed") {
      paths.delete(file.path);
      continue;
    }
    if (file.status === "unchanged" || underExcluded(file.path)) continue;
    paths.add(file.path);
    if (supportedLanguageOf(file.path)) changed.add(file.path);
  }
  for (const file of paths) {
    if (!safe(file)) return declined(`${file} is not a path that can be written safely.`);
  }
  // A framework's configuration is always read; see parse-repository.ts.
  for (const file of paths) if (FRAMEWORK_CONFIG.test(file) && supportedLanguageOf(file)) changed.add(file);
  const projectFiles = [...paths].filter((file) => READ_PROJECT_FILE.test(file));
  const wanted = [...new Set([...changed, ...projectFiles])].sort();
  if (wanted.length > BUDGETS.fetchedFiles) {
    return declined(`Updating the stored analysis needs more than ${BUDGETS.fetchedFiles} files downloaded.`);
  }

  const source = path.join(directory, "source");
  fs.mkdirSync(source, { recursive: true });
  for (const folder of excludedFolders) {
    if (safe(folder)) fs.mkdirSync(path.join(source, folder), { recursive: true });
  }
  for (const file of paths) {
    fs.mkdirSync(path.dirname(path.join(source, file)), { recursive: true });
    fs.writeFileSync(path.join(source, file), "", { mode: 0o644 });
  }

  const readable = new Set<string>();
  const oversized = new Map<string, string>();
  let fetched = 0;
  async function download(files: readonly string[]): Promise<string[]> {
    const allowed = files.filter((file) => paths.has(file) && !readable.has(file)).slice(0, Math.max(0, BUDGETS.fetchedFiles - fetched));
    fetched += allowed.length;
    const contents = await fetchFilesAtCommit(repository, headSha, allowed, {
      maxBytes: BUDGETS.sourceFileBytes,
      concurrency: BUDGETS.fetchConcurrency,
    });
    const now: string[] = [];
    for (const [file, content] of contents) {
      if (content === "missing") {
        throw new OverlayUnsupported(`GitHub has no ${file} at this commit, though the comparison lists it.`);
      }
      if (content === "oversized") {
        if (supportedLanguageOf(file)) oversized.set(file, oversizedFileRule.id);
        continue;
      }
      fs.writeFileSync(path.join(source, file), content, { mode: 0o644 });
      readable.add(file);
      now.push(file);
    }
    return now;
  }

  try {
    await download(wanted);
    const output = parseRepository(source, grammars, frameworkAdapters, {
      overlay: { base, changed: new Set([...changed].filter((file) => !oversized.has(file))) },
      excludedFiles: oversized,
    });
    return {
      kind: "updated",
      graph: { output, source, readable, changedSinceIndex: comparison.files.length, fetchMore: download },
    };
  } catch (error) {
    if (error instanceof OverlayUnsupported) return declined(error.message);
    throw error;
  }
}
