import type { SupportedLanguage } from "./languages/registry";
import type { FrameworkName, RoleId } from "./roles";

// The data contract every later phase consumes. Nothing in it is specific to
// one machine or one run: paths are repository-relative with forward slashes
// and there are no timestamps, so the same repository state always serialises
// to the same bytes.
//
// Extending it: add optional fields freely. Renaming, removing or changing
// the meaning of a field means bumping SCHEMA_VERSION.

export const SCHEMA_VERSION = 3;
// Version 3 only added values to the lists below (more languages, and their
// reference kinds and resolution methods), so a version 2 document is still a
// valid one.
export const READABLE_SCHEMA_VERSIONS: readonly number[] = [2, 3];

export const REFERENCE_KINDS = [
  "import",
  "re-export",
  "dynamic-import",
  "require",
  "import-type",
  "reference-path",
  "reference-types",
  // Python's `from module import name`. A plain `import module` is "import".
  "from-import",
  // C and C++ #include.
  "include",
  // Rust and PHP `use`, C# `using`.
  "use",
  // Rust `mod name;`, which makes another file a child module.
  "mod",
  // A Java, C# or PHP type named in the file and declared by another file in
  // a package or namespace the file can see without an import.
  "type-reference",
  // A Go test file, compiled together with the other files of its folder.
  "same-package",
] as const;
export type ReferenceKind = (typeof REFERENCE_KINDS)[number];

// How a specifier was turned into a file inside the repository.
export const RESOLUTION_METHODS = [
  "relative",
  "absolute",
  "path-alias",
  "base-url",
  "package-imports",
  "workspace-package",
  // An absolute Python module path, found under one of the repository's
  // source roots.
  "source-root",
  // A C or C++ header found in one of the repository's include folders.
  "include-directory",
  // A Java, C# or PHP name matched to the file that declares it.
  "declaration-index",
  // A Go import path under a module a go.mod in the repository declares.
  "go-module",
  // A Rust path followed through the crate's module files.
  "module-tree",
  // A PHP class found through a PSR-4 prefix in composer.json.
  "psr-4",
] as const;
export type ResolutionMethod = (typeof RESOLUTION_METHODS)[number];

export const UNRESOLVED_REASONS = [
  "file-not-found",
  "alias-target-not-found",
  "alias-not-configured",
  "workspace-package-not-linked",
  "non-literal-specifier",
] as const;
export type UnresolvedReason = (typeof UNRESOLVED_REASONS)[number];

export const EXTERNAL_KINDS = ["package", "builtin", "outside-repository"] as const;
export type ExternalKind = (typeof EXTERNAL_KINDS)[number];

export const LANGUAGES = [
  "typescript",
  "javascript",
  "python",
  "java",
  "go",
  "csharp",
  "c",
  "cpp",
  "rust",
  "php",
] as const satisfies readonly SupportedLanguage[];
export type Language = (typeof LANGUAGES)[number];

export const PARSE_STATUSES = ["parsed", "failed"] as const;
export type ParseStatus = (typeof PARSE_STATUSES)[number];

export const EXCLUDED_PATH_TYPES = ["file", "directory"] as const;
export type ExcludedPathType = (typeof EXCLUDED_PATH_TYPES)[number];

// Why a file has the role it has. `line` is where the syntax that decided it
// sits, and null when the file's path alone decided it.
export type FileRole = { id: RoleId; reason: string; line: number | null };

export const ROUTE_KINDS = ["page", "http"] as const;
// "page" is an address a browser opens; "http" is an endpoint a request calls.
export type RouteKind = (typeof ROUTE_KINDS)[number];

// One route an adapter read out of the repository. A record exists only when
// both the pattern and, for an endpoint, the method were stated by the source
// or by a documented file convention. Anything less is an OmittedRoute.
export type RouteRecord = {
  framework: FrameworkName;
  kind: RouteKind;
  // null for a page. "ANY" when the handler receives every method.
  method: string | null;
  // In the framework's own syntax, parameter names untouched.
  pattern: string;
  file: string;
  // The exported symbol or Class.method that handles it.
  handler: string | null;
  // Where the handler or its decorator is. null when the path alone is the
  // evidence.
  line: number | null;
  evidence: string;
};

// Something that looks like a route by convention or decorator, for which no
// record was made because part of it could not be read from the source.
export type OmittedRoute = {
  file: string;
  line: number | null;
  handler: string | null;
  reason: string;
};

export type FrameworkEvidence = {
  // The package.json that names the framework, and the folder it governs.
  file: string;
  root: string;
  detail: string;
};

// Something the adapter saw and does not model, which a reader of the route
// table should know about.
export type FrameworkNote = { file: string | null; line: number | null; detail: string };

export type FileNode = {
  // Today this is the repository-relative path. Treat it as opaque: it is the
  // key edges and metrics use, and it may stop being a path.
  id: string;
  path: string;
  name: string;
  extension: string;
  language: Language;
  declaration: boolean;
  // "" for files at the repository root.
  folder: string;
  folderSegments: string[];
  // The nearest enclosing package.json, when there is one.
  package: { name: string | null; root: string } | null;
  sizeBytes: number;
  lineCount: number;
  // SHA-256 of the file's bytes.
  contentHash: string;
  // A file that failed to parse stays a node, so edges into it survive, but
  // no references are read out of it.
  parseStatus: ParseStatus;
  parseErrors: { line: number; message: string }[];
  role: FileRole;
};

export type ExclusionRuleSummary = { id: string; description: string };

// An excluded directory is listed once and never descended into, so the files
// beneath it are not counted anywhere.
export type ExcludedPath = { path: string; type: ExcludedPathType; rule: string };

export type EdgeEvidence = {
  kind: ReferenceKind;
  specifier: string;
  line: number;
  typeOnly: boolean;
  via: ResolutionMethod;
};

// One edge per source/target pair, however many statements produced it.
export type DependencyEdge = {
  source: string;
  target: string;
  kinds: ReferenceKind[];
  // True only when every piece of evidence is type-only.
  typeOnly: boolean;
  evidence: EdgeEvidence[];
};

type ReferenceOrigin = {
  source: string;
  kind: ReferenceKind;
  // null when the specifier is an expression rather than a string literal.
  specifier: string | null;
  line: number;
  typeOnly: boolean;
};

export type ExternalReference = ReferenceOrigin & {
  status: "external";
  externalKind: ExternalKind;
  packageName: string | null;
};

// Resolved to something inside the repository that an exclusion rule kept
// out of the graph.
export type ExcludedReference = ReferenceOrigin & {
  status: "excluded";
  target: string;
  rule: string;
};

export type UnresolvedReference = ReferenceOrigin & {
  status: "unresolved";
  reason: UnresolvedReason;
  detail: string;
};

// Every reference that did not become an edge. Together with the evidence on
// the edges this accounts for every reference the parser encountered.
export type UnlinkedReference = ExternalReference | ExcludedReference | UnresolvedReference;

export type FileMetrics = { file: string; fanIn: number; fanOut: number };

export type ReferenceCounts = {
  encountered: number;
  internal: number;
  external: number;
  excluded: number;
  unresolved: number;
};

export type Coverage = {
  files: {
    encountered: number;
    included: number;
    parsed: number;
    failed: number;
    excluded: number;
  };
  directoriesExcluded: number;
  excludedByRule: { rule: string; files: number; directories: number }[];
  references: ReferenceCounts;
  referencesByKind: ({ kind: ReferenceKind } & ReferenceCounts)[];
  edges: number;
  unresolvedByReason: {
    reason: UnresolvedReason;
    count: number;
    examples: { source: string; line: number; specifier: string | null; detail: string }[];
  }[];
};

// A tsconfig/jsconfig that steered resolution, and anything wrong with it.
// A config that could not be fully read is the usual cause of aliases showing
// up as unresolved.
export type ResolutionConfig = { path: string; problems: string[] };

// Which parser logic built a graph. A stored graph is only updated in place
// (parse-repository.ts, overlay) by the logic that built it; raise this
// whenever what is read from a file, or how a reference resolves, changes.
// Absent from graphs built before it existed, which are never updated.
export const ANALYZER_VERSION = 1;

export type ParserOutput = {
  schemaVersion: typeof SCHEMA_VERSION;
  analyzerVersion?: number;
  adapter: FrameworkName;
  // What selected the adapter; empty when none matched.
  framework: { evidence: FrameworkEvidence[]; notes: FrameworkNote[] };
  exclusionRules: ExclusionRuleSummary[];
  resolutionConfigs: ResolutionConfig[];
  files: FileNode[];
  excluded: ExcludedPath[];
  edges: DependencyEdge[];
  unlinkedReferences: UnlinkedReference[];
  metrics: FileMetrics[];
  routes: RouteRecord[];
  omittedRoutes: OmittedRoute[];
  coverage: Coverage;
};
