// What a pull request is, as far as the analysis is concerned, and what the
// analysis says about it. Plain data with no imports: GitHub's responses are
// turned into the first half before they reach lib/impact, and the second half
// is exactly the document the database function complete_analysis stores.

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
};

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

export type ImpactReport = {
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
