// The data contract every later phase consumes. Nothing in it is specific to
// one machine or one run: paths are repository-relative with forward slashes
// and there are no timestamps, so the same repository state always serialises
// to the same bytes.
//
// Extending it: add optional fields freely. Renaming, removing or changing
// the meaning of a field means bumping SCHEMA_VERSION.

export const SCHEMA_VERSION = 1;

export const REFERENCE_KINDS = [
  "import",
  "re-export",
  "dynamic-import",
  "require",
  "import-type",
  "reference-path",
  "reference-types",
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

export const LANGUAGES = ["typescript", "javascript"] as const;
export type Language = (typeof LANGUAGES)[number];

export const PARSE_STATUSES = ["parsed", "failed"] as const;
export type ParseStatus = (typeof PARSE_STATUSES)[number];

export const EXCLUDED_PATH_TYPES = ["file", "directory"] as const;
export type ExcludedPathType = (typeof EXCLUDED_PATH_TYPES)[number];

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

export type ParserOutput = {
  schemaVersion: typeof SCHEMA_VERSION;
  adapter: string;
  exclusionRules: ExclusionRuleSummary[];
  resolutionConfigs: ResolutionConfig[];
  files: FileNode[];
  excluded: ExcludedPath[];
  edges: DependencyEdge[];
  unlinkedReferences: UnlinkedReference[];
  metrics: FileMetrics[];
  coverage: Coverage;
};
