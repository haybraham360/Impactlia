// What a pull request is, as far as the analysis is concerned, and what the
// analysis says about it. Plain data with no imports: GitHub's responses are
// turned into the first half before they reach lib/impact, and the second half
// is the document the database function complete_analysis stores.

export type ChangeType = "added" | "modified" | "removed" | "renamed";
export type RiskLevel = "low" | "medium" | "high";

export type PullRequestFile = {
  path: string;
  changeType: ChangeType;
  // The path a renamed file had before.
  previousPath: string | null;
  additions: number;
  deletions: number;
  // Whether GitHub returned the file's patch.
  patchAvailable: boolean;
  // The head-revision lines the patch adds. null when there is no patch or it
  // could not be read; for an added file every line is new either way.
  addedLines: LineRange[] | null;
};

// Inclusive, 1-based line numbers.
export type LineRange = { start: number; end: number };

export type PullRequestChanges = {
  files: PullRequestFile[];
  // False when GitHub did not return every changed file.
  complete: boolean;
  // How many files GitHub says the pull request changes.
  reportedFileCount: number;
};

export type ChangedReportFile = {
  kind: "changed";
  path: string;
  changeType: ChangeType;
  previousPath: string | null;
  additions: number;
  deletions: number;
  patchAvailable: boolean;
  // "analysed": the file is a node in the graph, so what imports it was
  // traced. "unanalysed": it is not, and nothing is claimed about it.
  analysisState: "analysed" | "unanalysed";
  stateReason: string | null;
};

export type AffectedReportFile = {
  kind: "affected";
  path: string;
  // The fewest imports between this file and any changed file.
  impactDepth: number;
  // One shortest chain, from a changed file to this one. Each file imports
  // the one before it.
  dependencyPath: string[];
  // How many files one step closer this file imports.
  routeCount: number;
};

export type ReportFile = ChangedReportFile | AffectedReportFile;

// `source` contains the import and `target` is the imported file, the same
// direction as everywhere else.
export type ReportDependency = {
  source: string;
  target: string;
  kind: string;
  typeOnly: boolean;
};

export const SIGNAL_IDS = [
  "direct-dependents",
  "transitive-reach",
  "shared-module-reached",
  "critical-role",
  "incomplete-coverage",
] as const;
export type SignalId = (typeof SIGNAL_IDS)[number];

export type SignalDetail = {
  // The rule as it applied, with its thresholds.
  rule: string;
  // The measurements that triggered it, one sentence each.
  facts: string[];
};

export type ReportSignal = {
  signal: SignalId;
  level: RiskLevel;
  detail: SignalDetail;
  // Paths of files in this report that the facts are about.
  evidence: string[];
};

export type ReportRecommendation = {
  body: string;
  // The computed fact behind it.
  reason: string;
  evidence: string[];
};

export type Limitation = { id: string; detail: string; files: string[] };

// ── Code issues ──────────────────────────────────────────────────────────────
// Problems a tool found in the changed code itself, as opposed to what the
// change could reach. Each one is a diagnostic a tool actually reported, at
// a location in the head commit; none is written by a model.

export type CodeIssueCategory = "syntax" | "type";
// Only "confirmed" exists so far: every issue is a compiler diagnostic. The
// conditions it was confirmed under are part of the issue.
export type CodeIssueStatus = "confirmed";
export type CodeIssueSource = "compiler";

// A file that imports the file an issue is in. That is a relationship in the
// graph, not evidence that the issue reaches it.
export type RelatedFile = {
  path: string;
  // How the import is written, as the graph records it ("import", "re-export",
  // …) and whether it imports types only.
  relationship: string;
  typeOnly: boolean;
};

export type CodeIssue = {
  title: string;
  category: CodeIssueCategory;
  severity: RiskLevel;
  status: CodeIssueStatus;
  source: CodeIssueSource;
  // The tool's own identifier for the rule, like "TS2322". null when the tool
  // did not give one.
  ruleId: string | null;
  // A changed file of this report.
  path: string;
  startLine: number;
  // null when the tool gave only a line.
  startColumn: number | null;
  endLine: number | null;
  endColumn: number | null;
  // The tool's message, as it gave it.
  message: string;
  // What the issue was confirmed under, and why it matters.
  conditions: string;
  // Direct importers of `path`, at most RELATED_FILE_LIMIT of them.
  relatedFiles: RelatedFile[];
  // How many direct importers there are in all.
  relatedFileCount: number;
};

// What the checks covered, so that no issues can be told apart from nothing
// checked.
export type CodeCheck = {
  // Changed files the compiler type-checked.
  checked: string[];
  // Changed source files it did not, and why.
  skipped: { path: string; reason: string }[];
  // Diagnostics on added lines that were left out because they can come from
  // the repository's packages not being installed, by code.
  setAside: { ruleId: string; reason: string; count: number }[];
  // Issues found beyond the stored limit.
  omitted: number;
};

// What the graph says about a pull request.
export type ImpactAnalysis = {
  // The commit the graph was built from, as the archive stated it.
  graphSha: string | null;
  // null is "Insufficient evidence": no changed file could be matched to the
  // graph, so there was nothing to measure.
  riskLevel: RiskLevel | null;
  limitations: Limitation[];
  files: ReportFile[];
  dependencies: ReportDependency[];
  signals: ReportSignal[];
  recommendations: ReportRecommendation[];
};

// Everything one analysis stores: exactly the document the database function
// complete_analysis takes.
export type ImpactReport = ImpactAnalysis & {
  codeIssues: CodeIssue[];
  codeCheck: CodeCheck;
};
