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
  // Where the patch removed lines, as head line numbers (see patch.ts). null
  // exactly when addedLines is.
  removedAt: number[] | null;
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

// ── Test recommendations ─────────────────────────────────────────────────────
// Which existing tests relate to the change, what is worth testing, and where
// no test was found. Nothing here was run: an existing test is a file found
// through the graph or by name, and a scenario is inferred from the syntax on
// changed lines.

export type TestRecommendationKind =
  | "existing_test"
  | "suggested_scenario"
  | "coverage_unknown"
  | "test_command";
export type Priority = "high" | "medium" | "low";
export type Confidence = "high" | "medium" | "low";
// "found": a test file that exists at the head commit. "suggested": a test
// that may not exist. "unknown": nothing was found, which is not proof that
// nothing exists.
export type TestRecommendationStatus = "found" | "suggested" | "unknown";

// How an existing test relates to the change, strongest first.
export const TEST_RELATIONSHIPS = [
  "imports-changed-symbol",
  "imports-changed-file",
  "changed-in-pull-request",
  "imports-indirectly",
  "name-only",
] as const;
export type TestRelationship = (typeof TEST_RELATIONSHIPS)[number];

// Line numbers are of the head commit; null when no line applies.
export type FileReference = { path: string; startLine: number | null; endLine: number | null };
export type TestFileReference = FileReference & { relationshipEvidence: string | null };

export type TestRecommendation = {
  kind: TestRecommendationKind;
  title: string;
  description: string;
  rationale: string;
  priority: Priority;
  status: TestRecommendationStatus;
  confidence: Confidence;
  // Existing tests only.
  relationship: TestRelationship | null;
  // A declaration read from the changed file, like "format" or "Cart.total".
  symbol: string | null;
  // What a scenario guards against, like "error handling".
  riskAddressed: string | null;
  // Changed files of this report.
  relatedChangedFiles: FileReference[];
  // Test files at the head commit.
  relatedTestFiles: TestFileReference[];
  // A command from the repository's own package.json, never run here.
  command: string | null;
  // Where to run it, repository-relative; "" is the root.
  workingDirectory: string | null;
  evidence: string[];
};

// What the search for tests covered, so that "none found" can be told apart
// from "not looked for".
export type TestDiscovery = {
  // Files at the head commit treated as tests, and by which rule.
  testFileCount: number;
  conventions: { rule: string; count: number }[];
  // Test runner packages those files import.
  frameworks: string[];
  // Found or suggested beyond the stored limits, by kind. The counts are
  // complete; only the entries are left out.
  omitted: { existing: number; scenarios: number; coverageUnknown: number };
  // Why no coverage figures are used.
  coverageData: string;
  command: { found: boolean; detail: string };
  // Changed files whose declarations could not be read, so that tests could
  // be matched to the file but not to what in it changed.
  symbolsUnread: { path: string; reason: string }[];
};

// ── Risk score ───────────────────────────────────────────────────────────────

export type RiskScoreLevel = "low" | "moderate" | "high" | "very_high";

export const RISK_FACTOR_IDS = [
  "dependency-reach",
  "critical-role",
  "code-issues",
  "test-evidence",
  "change-size",
  "config-or-schema",
  "analysis-completeness",
] as const;
export type RiskFactorId = (typeof RISK_FACTOR_IDS)[number];

// "increases_risk": measured, and it adds points. "none_found": measured,
// and nothing was there. "reduces_uncertainty": measured, adds nothing, and
// makes the picture clearer. "unknown": could not be measured, so it adds
// nothing and is not treated as either good or bad.
export type RiskFactorDirection =
  | "increases_risk"
  | "none_found"
  | "reduces_uncertainty"
  | "unknown";

export type RiskFactor = {
  factor: RiskFactorId;
  direction: RiskFactorDirection;
  explanation: string;
  evidence: string[];
  // Points added to the score. null when the factor was not measured.
  contribution: number | null;
};

export type RiskAssessment = {
  // Which version of the rules in score.ts produced this.
  method: number;
  // null with level null is "Insufficient evidence": no changed file could
  // be matched to the graph, so there was nothing to measure.
  score: number | null;
  level: RiskScoreLevel | null;
  summary: string;
  factors: RiskFactor[];
  confidence: Confidence;
  // What lowered the confidence, one sentence each.
  limitations: string[];
};

// What the graph says about a pull request.
export type ImpactAnalysis = {
  // The commit the graph was built from, as the archive stated it.
  graphSha: string | null;
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
  testRecommendations: TestRecommendation[];
  testDiscovery: TestDiscovery;
  risk: RiskAssessment;
};
