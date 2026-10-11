import { createHash } from "node:crypto";
import type {
  DependencyEdge,
  FileNode,
  ParserOutput,
  ReferenceKind,
  ResolutionMethod,
} from "../../parser/contract";
import { MODEL, PROMPT_VERSIONS, type AiTask } from "./config";

// What a model is given about a file or a folder. Every relationship in here
// is copied from the parser output: an edge, its evidence, a count of edges.
// Nothing is inferred, and a model never sees a file path this module did not
// take from the analysis.
//
// The objects are built with their keys and lists in a fixed order, so the
// same analysis always serialises to the same bytes and hashes to the same
// key.

// Size limits. Whatever they cut is named in `omitted`, which goes to the
// model and is shown with the explanation.
const NEIGHBOR_LIMIT = 40;
const REFERENCES_PER_NEIGHBOR = 3;
const BETWEEN_NEIGHBORS_LIMIT = 60;
const FOLDER_FILE_LIMIT = 80;
const FOLDER_EDGE_LIMIT = 60;
const FOLDER_GROUP_LIMIT = 25;
const EXAMPLES_PER_GROUP = 3;
const LIMITATION_LIMIT = 20;

export const ROOT_FOLDER = "(repository root)";

// Plain code-point order, so the result does not depend on locale.
const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

type Role = { id: string; reason: string };

export type Neighbor = {
  path: string;
  role: string;
  typeOnly: boolean;
  // The statements that make this relationship, as the parser read them.
  references: { kind: ReferenceKind; specifier: string; line: number; via: ResolutionMethod }[];
};

export type Pair = { from: string; imports: string };

export type FileEvidence = {
  subject: "file";
  commitSha: string | null;
  framework: string;
  file: {
    path: string;
    language: string;
    lineCount: number;
    contentHash: string;
    role: Role;
    parsed: boolean;
    routes: { kind: string; method: string | null; pattern: string }[];
  };
  // Files this one imports, and files that import it. Resolved edges only.
  imports: Neighbor[];
  importedBy: Neighbor[];
  // Edges that run between two of the neighbours above.
  betweenNeighbors: Pair[];
  limitations: {
    parseErrors: { line: number; message: string }[];
    unresolvedImports: { specifier: string | null; line: number; reason: string }[];
    importsOfExcludedFiles: { specifier: string | null; target: string }[];
    unresolvedImportsInRepository: number;
    filesThatFailedToParseInRepository: number;
  };
  omitted: string[];
};

export type FolderGroup = { folder: string; dependencies: number; examples: Pair[] };

export type FolderEvidence = {
  subject: "folder";
  commitSha: string | null;
  framework: string;
  folder: {
    path: string;
    fileCount: number;
    dependenciesBetweenItsFiles: number;
    dependenciesComingIn: number;
    dependenciesGoingOut: number;
  };
  files: { path: string; role: string; lineCount: number; importedBy: number; imports: number }[];
  roleCounts: { role: string; files: number }[];
  internalDependencies: Pair[];
  // Grouped by the folder on the other side, largest first.
  incoming: FolderGroup[];
  outgoing: FolderGroup[];
  limitations: {
    filesThatFailedToParse: string[];
    unresolvedImports: number;
    unresolvedImportsInRepository: number;
    filesThatFailedToParseInRepository: number;
  };
  omitted: string[];
};

export type Evidence = FileEvidence | FolderEvidence;

// A folder as the graph draws it: a directory and every file folded into it.
export type FoldedFolder = { id: string; files: string[] };

function capped<T>(items: T[], limit: number, omitted: string[], what: string): T[] {
  if (items.length <= limit) return items;
  omitted.push(`${items.length - limit} of ${items.length} ${what} were left out for size.`);
  return items.slice(0, limit);
}

function neighbor(edge: DependencyEdge, other: FileNode): Neighbor {
  return {
    path: other.path,
    role: other.role.id,
    typeOnly: edge.typeOnly,
    references: edge.evidence
      .slice(0, REFERENCES_PER_NEIGHBOR)
      .map(({ kind, specifier, line, via }) => ({ kind, specifier, line, via })),
  };
}

const pair = (edge: DependencyEdge): Pair => ({ from: edge.source, imports: edge.target });
const byPair = (a: Pair, b: Pair) => byText(a.from, b.from) || byText(a.imports, b.imports);

export function buildFileEvidence(
  output: ParserOutput,
  fileId: string,
  commitSha: string | null,
): FileEvidence | null {
  const fileById = new Map(output.files.map((file) => [file.id, file]));
  const file = fileById.get(fileId);
  if (!file) return null;
  const omitted: string[] = [];

  const neighbors = (end: "source" | "target", what: string) =>
    capped(
      output.edges
        .filter((edge) => edge[end === "source" ? "target" : "source"] === fileId && edge[end] !== fileId)
        .flatMap((edge) => {
          const other = fileById.get(edge[end]);
          return other ? [neighbor(edge, other)] : [];
        })
        .sort((a, b) => byText(a.path, b.path)),
      NEIGHBOR_LIMIT,
      omitted,
      what,
    );
  const imports = neighbors("target", "files this file imports");
  const importedBy = neighbors("source", "files that import this file");

  const around = new Set([...imports, ...importedBy].map((entry) => entry.path));
  const betweenNeighbors = capped(
    output.edges
      .filter((edge) => around.has(edge.source) && around.has(edge.target))
      .map(pair)
      .sort(byPair),
    BETWEEN_NEIGHBORS_LIMIT,
    omitted,
    "dependencies between this file's neighbours",
  );

  const unlinked = output.unlinkedReferences.filter((reference) => reference.source === fileId);

  return {
    subject: "file",
    commitSha,
    framework: output.adapter,
    file: {
      path: file.path,
      language: file.language,
      lineCount: file.lineCount,
      contentHash: file.contentHash,
      role: { id: file.role.id, reason: file.role.reason },
      parsed: file.parseStatus === "parsed",
      routes: output.routes
        .filter((route) => route.file === fileId)
        .map(({ kind, method, pattern }) => ({ kind, method, pattern })),
    },
    imports,
    importedBy,
    betweenNeighbors,
    limitations: {
      parseErrors: capped(file.parseErrors, LIMITATION_LIMIT, omitted, "parse errors"),
      unresolvedImports: capped(
        unlinked.flatMap((reference) =>
          reference.status === "unresolved"
            ? [{ specifier: reference.specifier, line: reference.line, reason: reference.reason }]
            : [],
        ),
        LIMITATION_LIMIT,
        omitted,
        "unresolved imports",
      ),
      importsOfExcludedFiles: capped(
        unlinked.flatMap((reference) =>
          reference.status === "excluded"
            ? [{ specifier: reference.specifier, target: reference.target }]
            : [],
        ),
        LIMITATION_LIMIT,
        omitted,
        "imports of excluded files",
      ),
      unresolvedImportsInRepository: output.coverage.references.unresolved,
      filesThatFailedToParseInRepository: output.coverage.files.failed,
    },
    omitted,
  };
}

export function buildFolderEvidence(
  output: ParserOutput,
  folders: FoldedFolder[],
  folderId: string,
  commitSha: string | null,
): FolderEvidence | null {
  const folder = folders.find((entry) => entry.id === folderId);
  if (!folder) return null;
  const omitted: string[] = [];
  const name = (id: string) => (id === "" ? ROOT_FOLDER : id);

  const folderOf = new Map<string, string>();
  for (const entry of folders) for (const file of entry.files) folderOf.set(file, entry.id);
  const fileById = new Map(output.files.map((file) => [file.id, file]));
  const metrics = new Map(output.metrics.map((metric) => [metric.file, metric]));
  const members = new Set(folder.files);

  const internal: Pair[] = [];
  const crossing = { incoming: new Map<string, Pair[]>(), outgoing: new Map<string, Pair[]>() };
  for (const edge of output.edges) {
    const fromInside = members.has(edge.source);
    const toInside = members.has(edge.target);
    if (fromInside && toInside) {
      internal.push(pair(edge));
    } else if (fromInside || toInside) {
      const groups = fromInside ? crossing.outgoing : crossing.incoming;
      const other = folderOf.get(fromInside ? edge.target : edge.source);
      if (other === undefined) continue;
      const list = groups.get(other);
      if (list) list.push(pair(edge));
      else groups.set(other, [pair(edge)]);
    }
  }
  const grouped = (groups: Map<string, Pair[]>, what: string): FolderGroup[] =>
    capped(
      [...groups]
        .map(([id, pairs]) => ({
          folder: name(id),
          dependencies: pairs.length,
          examples: pairs.sort(byPair).slice(0, EXAMPLES_PER_GROUP),
        }))
        .sort((a, b) => b.dependencies - a.dependencies || byText(a.folder, b.folder)),
      FOLDER_GROUP_LIMIT,
      omitted,
      what,
    );
  const count = (groups: Map<string, Pair[]>) =>
    [...groups.values()].reduce((sum, pairs) => sum + pairs.length, 0);

  const files = [...folder.files].sort(byText).flatMap((id) => fileById.get(id) ?? []);
  const roles = new Map<string, number>();
  for (const file of files) roles.set(file.role.id, (roles.get(file.role.id) ?? 0) + 1);

  return {
    subject: "folder",
    commitSha,
    framework: output.adapter,
    folder: {
      path: name(folder.id),
      fileCount: files.length,
      dependenciesBetweenItsFiles: internal.length,
      dependenciesComingIn: count(crossing.incoming),
      dependenciesGoingOut: count(crossing.outgoing),
    },
    files: capped(
      files.map((file) => ({
        path: file.path,
        role: file.role.id,
        lineCount: file.lineCount,
        importedBy: metrics.get(file.id)?.fanIn ?? 0,
        imports: metrics.get(file.id)?.fanOut ?? 0,
      })),
      FOLDER_FILE_LIMIT,
      omitted,
      "files in this folder",
    ),
    roleCounts: [...roles]
      .map(([role, total]) => ({ role, files: total }))
      .sort((a, b) => b.files - a.files || byText(a.role, b.role)),
    internalDependencies: capped(
      internal.sort(byPair),
      FOLDER_EDGE_LIMIT,
      omitted,
      "dependencies between this folder's own files",
    ),
    incoming: grouped(crossing.incoming, "folders that depend on this folder"),
    outgoing: grouped(crossing.outgoing, "folders this folder depends on"),
    limitations: {
      filesThatFailedToParse: capped(
        files.filter((file) => file.parseStatus === "failed").map((file) => file.path),
        LIMITATION_LIMIT,
        omitted,
        "files that failed to parse",
      ),
      unresolvedImports: output.unlinkedReferences.filter(
        (reference) => reference.status === "unresolved" && members.has(reference.source),
      ).length,
      unresolvedImportsInRepository: output.coverage.references.unresolved,
      filesThatFailedToParseInRepository: output.coverage.files.failed,
    },
    omitted,
  };
}

// ── Keys ───────────────────────────────────────────────────────────────────

// What a result is stored under and what it depends on. `inputHash` is the
// cache key. The other two are kept beside it so that, when the key no longer
// matches, the result can say whether the content or the context changed.
export type InputIdentity = {
  inputHash: string;
  contentHash: string;
  contextHash: string;
  sourceSha: string | null;
  model: string;
  promptVersion: string;
};

function identity(
  task: AiTask,
  repositoryId: string,
  sourceSha: string | null,
  contentHash: string,
  context: unknown,
  // Left out for a result that does not depend on which commit was analysed.
  keyedByCommit: boolean,
): InputIdentity {
  const model = MODEL;
  const promptVersion = PROMPT_VERSIONS[task];
  const contextHash = sha256(JSON.stringify(context));
  return {
    inputHash: sha256(
      JSON.stringify({
        task,
        // A result is never shared between repositories, even identical ones.
        repositoryId,
        model,
        promptVersion,
        commit: keyedByCommit ? sourceSha : null,
        contentHash,
        contextHash,
      }),
    ),
    contentHash,
    contextHash,
    sourceSha,
    model,
    promptVersion,
  };
}

// The file's source is in the key through its hash, which the parser took
// from the same bytes the model is later given.
export function fileIdentity(repositoryId: string, evidence: FileEvidence): InputIdentity {
  const { commitSha, file, ...rest } = evidence;
  const { contentHash, ...described } = file;
  return identity(
    "file-explanation",
    repositoryId,
    commitSha,
    contentHash,
    { file: described, ...rest },
    true,
  );
}

// A folder's "content" is every file folded into it, by path and hash.
export function folderIdentity(
  repositoryId: string,
  evidence: FolderEvidence,
  output: ParserOutput,
  folder: FoldedFolder,
): InputIdentity {
  const members = new Set(folder.files);
  const contents = output.files
    .filter((file) => members.has(file.id))
    .map((file) => `${file.path}\n${file.contentHash}`)
    .sort(byText);
  const { commitSha, ...context } = evidence;
  return identity(
    "folder-explanation",
    repositoryId,
    commitSha,
    sha256(contents.join("\n")),
    context,
    true,
  );
}

// A role is suggested from the file alone, so its key is the file alone: a
// re-analysis at a new commit that left the file untouched keeps the answer.
export function roleIdentity(
  repositoryId: string,
  file: { path: string; contentHash: string },
  sourceSha: string | null,
): InputIdentity {
  return identity(
    "role-classification",
    repositoryId,
    sourceSha,
    file.contentHash,
    { path: file.path },
    false,
  );
}

// ── Staleness ──────────────────────────────────────────────────────────────

// Why a stored result no longer answers for the current analysis. Empty means
// it does. Each reason is something Impactlia compared, not something assumed.
export function staleReasons(stored: InputIdentity, current: InputIdentity): string[] {
  if (stored.inputHash === current.inputHash) return [];
  const reasons: string[] = [];
  if (stored.contentHash !== current.contentHash) {
    reasons.push("The source it was written from has changed.");
  }
  if (stored.contextHash !== current.contextHash) {
    reasons.push("The dependencies or analysis details around it have changed.");
  }
  if (stored.sourceSha !== current.sourceSha) {
    reasons.push(
      stored.sourceSha && current.sourceSha
        ? `It was written for commit ${stored.sourceSha.slice(0, 7)}; the current analysis is of ${current.sourceSha.slice(0, 7)}.`
        : "It was written for a different analysis of this repository.",
    );
  }
  if (stored.model !== current.model) {
    reasons.push(`It was written by ${stored.model}; the pinned model is now ${current.model}.`);
  }
  if (stored.promptVersion !== current.promptVersion) {
    reasons.push("It was written with an earlier version of the prompt.");
  }
  return reasons;
}
