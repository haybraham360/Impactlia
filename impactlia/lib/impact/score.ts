import { supportedLanguageOf } from "../../parser/languages/registry";
import { byText } from "../graph/traverse";
import type { ChangeMapping } from "./analyze";
import type {
  CodeCheck,
  CodeIssue,
  Confidence,
  Limitation,
  PullRequestChanges,
  ReportSignal,
  RiskAssessment,
  RiskFactor,
  RiskFactorId,
  RiskLevel,
  RiskScoreLevel,
  SignalId,
} from "./report";
import { SIGNALS } from "./risk";
import type { TestEvidence } from "./tests";

// The whole risk-score methodology. Every weight and threshold is a number
// written here, the report page prints these rules next to the score, and
// SCORE_METHOD changes whenever one of them does, so a stored score says
// which rules produced it. Pure: the same inputs always give the same score.
//
// The score is a way to decide where to look first. It is not calibrated
// against real outcomes, it is not a probability, and a low score does not
// mean a change is safe.
//
// Four rules shape it:
// - A factor adds points only when it was measured. Something that could not
//   be measured adds nothing and lowers the confidence instead.
// - Signals that measure the same thing are counted once: the three reach
//   signals share one factor, which takes the strongest.
// - Size is capped, so a large repository or a large pull request is not
//   pushed to the top by its size alone.
// - Only issues a tool reported count. A suggestion, a scenario or an
//   AI-written finding never adds points.

export const SCORE_METHOD = 1;

export const LEVEL_THRESHOLDS: { level: RiskScoreLevel; from: number; label: string }[] = [
  { level: "very_high", from: 75, label: "Very high risk" },
  { level: "high", from: 50, label: "High risk" },
  { level: "moderate", from: 25, label: "Moderate risk" },
  { level: "low", from: 0, label: "Low risk" },
];

export function levelOf(score: number): RiskScoreLevel {
  return (LEVEL_THRESHOLDS.find((threshold) => score >= threshold.from) ?? LEVEL_THRESHOLDS[3]).level;
}

export const levelLabel = (level: RiskScoreLevel) =>
  LEVEL_THRESHOLDS.find((threshold) => threshold.level === level)?.label ?? level;

// The signals that all measure how far the change reaches.
const REACH_SIGNALS: readonly SignalId[] = [
  "direct-dependents",
  "transitive-reach",
  "shared-module-reached",
];
const REACH_POINTS: Record<RiskLevel, number> = { low: 10, medium: 20, high: 30 };
const CRITICAL_ROLE_POINTS = 15;
const SYNTAX_POINTS = 25;
const TYPE_POINTS = 15;
const NO_TEST_POINTS = 15;
const SOME_UNTESTED_POINTS = 8;
const SIZE = { large: { files: 25, lines: 1000, points: 10 }, medium: { files: 8, lines: 300, points: 5 } };
const CONFIG_POINTS = 10;

// Files whose type, not their name, says they configure the build, the
// dependencies or the stored data. Matched on the path as GitHub lists it,
// whether or not the file is in the graph.
const CONFIG_OR_SCHEMA: { label: string; test: RegExp }[] = [
  { label: "package manifest", test: /(^|\/)package\.json$/ },
  { label: "lockfile", test: /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lockb?)$/ },
  {
    label: "Python dependency manifest",
    test: /(^|\/)(pyproject\.toml|setup\.cfg|setup\.py|requirements[\w.-]*\.txt|Pipfile)$/,
  },
  { label: "Python lockfile", test: /(^|\/)(poetry\.lock|Pipfile\.lock|uv\.lock|pdm\.lock)$/ },
  { label: "Go module file", test: /(^|\/)go\.(mod|sum|work)$/ },
  { label: "Cargo manifest or lockfile", test: /(^|\/)Cargo\.(toml|lock)$/ },
  {
    label: "Java build file",
    test: /(^|\/)(pom\.xml|build\.gradle(\.kts)?|settings\.gradle(\.kts)?|gradle\.properties)$/,
  },
  { label: ".NET project file", test: /\.(csproj|sln|props|targets)$/ },
  { label: "Composer manifest or lockfile", test: /(^|\/)composer\.(json|lock)$/ },
  { label: "C or C++ build file", test: /(^|\/)(CMakeLists\.txt|[^/]+\.cmake|Makefile|meson\.build|BUILD(\.bazel)?)$/ },
  { label: "TypeScript or JavaScript config", test: /(^|\/)[jt]sconfig(\.[\w-]+)?\.json$/ },
  { label: "tool config", test: /(^|\/)[^/]+\.config\.[cm]?[jt]s$/ },
  { label: "environment file", test: /(^|\/)\.env(\.[\w-]+)?$/ },
  { label: "SQL", test: /\.sql$/ },
  { label: "Prisma schema", test: /\.prisma$/ },
  { label: "CI workflow", test: /^\.github\/workflows\/[^/]+\.ya?ml$/ },
];

const isSourceFile = (path: string) => supportedLanguageOf(path) !== null;

export const FACTOR_RULES: Record<RiskFactorId, { label: string; rule: string }> = {
  "dependency-reach": {
    label: "Dependency reach",
    rule: `The strongest of the three reach signals (${REACH_SIGNALS.map((id) => SIGNALS[id].label.toLowerCase()).join("; ")}), counted once because they measure the same thing: ${REACH_POINTS.low} points at low, ${REACH_POINTS.medium} at medium, ${REACH_POINTS.high} at high.`,
  },
  "critical-role": {
    label: "Request-handling or data-model file",
    rule: `${CRITICAL_ROLE_POINTS} points when the critical-role signal was raised: a changed file has a role a framework adapter assigned from its path or syntax. Never from a file name alone.`,
  },
  "code-issues": {
    label: "Code issues on added lines",
    rule: `${SYNTAX_POINTS} points when the compiler reported a syntax error on a line the pull request adds, otherwise ${TYPE_POINTS} for a type error. Only diagnostics a tool reported count.`,
  },
  "test-evidence": {
    label: "Tests found for the changed code",
    rule: `${NO_TEST_POINTS} points when no test file imports any changed source file, ${SOME_UNTESTED_POINTS} when some changed source files have none. None when every one has a test importing it; that reduces uncertainty, it does not prove the change is tested.`,
  },
  "change-size": {
    label: "Size of the change",
    rule: `${SIZE.large.points} points from ${SIZE.large.files} changed source files or ${SIZE.large.lines} changed lines in them, ${SIZE.medium.points} from ${SIZE.medium.files} files or ${SIZE.medium.lines} lines. Capped there, so size alone cannot make a change high risk.`,
  },
  "config-or-schema": {
    label: "Configuration or schema files",
    rule: `${CONFIG_POINTS} points when a changed file is one of: ${CONFIG_OR_SCHEMA.map((entry) => entry.label).join(", ")}.`,
  },
  "analysis-completeness": {
    label: "Completeness of the analysis",
    rule: "Adds no points. Gaps in the analysis lower the confidence shown with the score instead, because missing information is not evidence of risk or of safety.",
  },
};

export const SCORE_RULE = `The score is the sum of the factors' points, at most 100. ${LEVEL_THRESHOLDS.map((threshold) => `${threshold.label} from ${threshold.from}`).join(", ")}. When no changed file could be matched to the graph there was nothing to measure, and the result is “Insufficient evidence” instead.`;

export const CONFIDENCE_RULE =
  "High when every changed source file was analysed with its patch and the graph is complete. Medium when part of the graph or of the change could not be read: unresolved imports, a removed, unparsed or missing changed file, a patch GitHub did not return, files not type-checked, or imports followed to the depth limit. Low when GitHub did not return every changed file, or fewer than half of the changed source files could be analysed. A low-confidence score is shown as provisional.";

export type ScoreInput = {
  changes: PullRequestChanges;
  mapping: ChangeMapping;
  signals: readonly ReportSignal[];
  codeIssues: readonly CodeIssue[];
  codeCheck: CodeCheck;
  tests: TestEvidence;
  limitations: readonly Limitation[];
};

const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

function named(paths: readonly string[], limit = 5): string {
  const shown = paths.slice(0, limit).join(", ");
  return paths.length > limit ? `${shown} and ${paths.length - limit} more` : shown;
}

export function assessRisk(input: ScoreInput): RiskAssessment {
  const { changes, mapping, signals, codeIssues, codeCheck, tests, limitations } = input;
  const factors: RiskFactor[] = [];
  const signal = (id: SignalId) => signals.find((entry) => entry.signal === id);

  // ── Dependency reach ─────────────────────────────────────────────────────
  const reach = REACH_SIGNALS.map(signal).filter((entry) => entry !== undefined);
  if (reach.length > 0) {
    const strongest = reach.reduce((best, entry) =>
      REACH_POINTS[entry.level] > REACH_POINTS[best.level] ? entry : best,
    );
    factors.push({
      factor: "dependency-reach",
      direction: "increases_risk",
      explanation: `${SIGNALS[strongest.signal].label}, at ${strongest.level}.${reach.length > 1 ? ` ${plural(reach.length - 1, "other reach signal was", "other reach signals were")} also raised and counted with it, not again.` : ""}`,
      evidence: reach.flatMap((entry) => entry.detail.facts).slice(0, 6),
      contribution: REACH_POINTS[strongest.level],
    });
  } else {
    factors.push({
      factor: "dependency-reach",
      direction: "none_found",
      explanation: "No file in the graph imports the changed files.",
      evidence: [],
      contribution: 0,
    });
  }

  // ── Critical roles ───────────────────────────────────────────────────────
  const critical = signal("critical-role");
  factors.push(
    critical
      ? {
          factor: "critical-role",
          direction: "increases_risk",
          explanation: "A changed file handles requests or defines stored data, by its framework role.",
          evidence: critical.detail.facts.slice(0, 6),
          contribution: CRITICAL_ROLE_POINTS,
        }
      : {
          factor: "critical-role",
          direction: "none_found",
          explanation: "No changed file has a request-handling or data-model role.",
          evidence: [],
          contribution: 0,
        },
  );

  // ── Code issues ──────────────────────────────────────────────────────────
  const syntax = codeIssues.filter((issue) => issue.category === "syntax");
  const types = codeIssues.filter((issue) => issue.category === "type");
  const checkedAnything = codeCheck.checked.length > 0 || syntax.length > 0;
  if (syntax.length > 0 || types.length > 0) {
    factors.push({
      factor: "code-issues",
      direction: "increases_risk",
      explanation: `The compiler reported ${[
        syntax.length > 0 ? plural(syntax.length, "syntax error", "syntax errors") : null,
        types.length > 0 ? plural(types.length, "type error", "type errors") : null,
      ]
        .filter(Boolean)
        .join(" and ")} on added lines.`,
      evidence: [...syntax, ...types]
        .slice(0, 6)
        .map((issue) => `${issue.path}:${issue.startLine} ${issue.ruleId ?? issue.title}: ${issue.message}`),
      contribution: syntax.length > 0 ? SYNTAX_POINTS : TYPE_POINTS,
    });
  } else if (checkedAnything) {
    factors.push({
      factor: "code-issues",
      direction: "none_found",
      explanation: `No issue was reported on added lines of the ${plural(codeCheck.checked.length, "file", "files")} checked. That is not proof the code is free of defects.`,
      evidence: [],
      contribution: 0,
    });
  } else {
    factors.push({
      factor: "code-issues",
      direction: "unknown",
      explanation: "No changed file could be type-checked, so nothing is known about issues in the code.",
      evidence: codeCheck.skipped.slice(0, 6).map((entry) => `${entry.path}: ${entry.reason}`),
      contribution: null,
    });
  }

  // ── Tests ────────────────────────────────────────────────────────────────
  const untested = tests.changedCode.filter((path) => !tests.directlyTested.includes(path));
  if (tests.changedCode.length === 0) {
    factors.push({
      factor: "test-evidence",
      direction: "unknown",
      explanation: "No changed source file outside tests, configuration and type declarations was analysed, so there was nothing to look for tests of.",
      evidence: [],
      contribution: null,
    });
  } else if (untested.length === tests.changedCode.length) {
    factors.push({
      factor: "test-evidence",
      direction: "increases_risk",
      explanation:
        tests.testFileCount === 0
          ? "No file in the repository was identified as a test."
          : `No test file imports any of the ${plural(tests.changedCode.length, "changed source file", "changed source files")}. That is not proof they are untested.`,
      evidence: [`Without a test importing them: ${named(untested)}.`],
      contribution: NO_TEST_POINTS,
    });
  } else if (untested.length > 0) {
    factors.push({
      factor: "test-evidence",
      direction: "increases_risk",
      explanation: `${plural(untested.length, "changed source file has", "changed source files have")} no test importing ${untested.length === 1 ? "it" : "them"}; ${tests.directlyTested.length} ${tests.directlyTested.length === 1 ? "has" : "have"} one.`,
      evidence: [`Without a test importing them: ${named(untested)}.`],
      contribution: SOME_UNTESTED_POINTS,
    });
  } else {
    factors.push({
      factor: "test-evidence",
      direction: "reduces_uncertainty",
      explanation: `Every changed source file is imported by a test file. That does not show the changed lines are tested.`,
      evidence: [`With a test importing them: ${named(tests.directlyTested)}.`],
      contribution: 0,
    });
  }

  // ── Size ─────────────────────────────────────────────────────────────────
  const source = changes.files.filter((file) => isSourceFile(file.path));
  const lines = source.reduce((sum, file) => sum + file.additions + file.deletions, 0);
  const size =
    source.length >= SIZE.large.files || lines >= SIZE.large.lines
      ? SIZE.large.points
      : source.length >= SIZE.medium.files || lines >= SIZE.medium.lines
        ? SIZE.medium.points
        : 0;
  factors.push({
    factor: "change-size",
    direction: size > 0 ? "increases_risk" : "none_found",
    explanation: `${plural(source.length, "source file", "source files")} changed, ${plural(lines, "line", "lines")} added or removed in them.`,
    evidence: [],
    contribution: size,
  });

  // ── Configuration and schema ─────────────────────────────────────────────
  const configuration = changes.files
    .flatMap((file) => {
      const kind = CONFIG_OR_SCHEMA.find((entry) => entry.test.test(file.path));
      return kind ? [`${file.path} (${kind.label})`] : [];
    })
    .sort(byText);
  factors.push(
    configuration.length > 0
      ? {
          factor: "config-or-schema",
          direction: "increases_risk",
          explanation: `${plural(configuration.length, "changed file configures", "changed files configure")} the build, dependencies or stored data, which can change behaviour beyond the files that import ${configuration.length === 1 ? "it" : "them"}.`,
          evidence: configuration.slice(0, 10),
          contribution: CONFIG_POINTS,
        }
      : {
          factor: "config-or-schema",
          direction: "none_found",
          explanation: "No configuration, lockfile, schema or CI workflow was changed.",
          evidence: [],
          contribution: 0,
        },
  );

  // ── Confidence ───────────────────────────────────────────────────────────
  // Each gap lowers the confidence to at most the level beside it.
  const found: { to: Exclude<Confidence, "high">; reason: string }[] = [];
  const lower = (to: Exclude<Confidence, "high">, reason: string) => found.push({ to, reason });
  const sourceChanged = mapping.changed.filter((file) => isSourceFile(file.path));
  const sourceAnalysed = sourceChanged.filter((file) => file.analysisState === "analysed");
  if (!changes.complete) {
    lower("low", `GitHub returned ${changes.files.length} of the ${changes.reportedFileCount} changed files; the rest were not analysed.`);
  }
  if (sourceChanged.length > 0 && sourceAnalysed.length * 2 < sourceChanged.length) {
    lower("low", `Only ${sourceAnalysed.length} of the ${sourceChanged.length} changed source files could be analysed.`);
  }
  const reasons: Record<string, string> = {
    "removed-files": "Removed files cannot be traced in the head commit's graph.",
    "missing-from-graph": "Changed files are missing from the graph.",
    "changed-file-unparsed": "Changed files could not be parsed.",
    "patch-unavailable": "GitHub returned no patch for some changed files.",
    "graph-incomplete": "Some imports in the repository could not be resolved.",
    "depth-limit": "Imports were followed only to the depth limit.",
    "code-check-partial": "Some changed files were not type-checked.",
    "test-symbols-unread": "For some changed files, which declarations changed could not be read.",
  };
  for (const limitation of limitations) {
    const reason = reasons[limitation.id];
    if (reason) lower("medium", reason);
  }
  const gaps = found.map((gap) => gap.reason);
  const confidence: Confidence = found.some((gap) => gap.to === "low")
    ? "low"
    : found.length > 0
      ? "medium"
      : "high";
  const completeness = signal("incomplete-coverage");
  factors.push({
    factor: "analysis-completeness",
    direction: gaps.length > 0 ? "unknown" : "none_found",
    explanation:
      gaps.length > 0
        ? `Parts of the change or the graph could not be analysed, so the confidence is ${confidence}. They add no points.`
        : "No gap in the analysis was recorded.",
    evidence: completeness ? completeness.detail.facts.slice(0, 6) : [],
    contribution: null,
  });

  // ── Score ────────────────────────────────────────────────────────────────
  if (mapping.starts.length === 0) {
    return {
      method: SCORE_METHOD,
      score: null,
      level: null,
      summary:
        "Insufficient evidence: no changed file could be matched to the graph, so nothing was measured. That is not the same as low risk.",
      factors,
      confidence: "low",
      limitations: gaps.length > 0 ? gaps : ["No changed file is in the graph built from the head commit."],
    };
  }
  const score = Math.min(
    100,
    factors.reduce((sum, factor) => sum + (factor.contribution ?? 0), 0),
  );
  const level = levelOf(score);
  const leading = factors
    .filter((factor) => (factor.contribution ?? 0) > 0)
    .sort((a, b) => (b.contribution ?? 0) - (a.contribution ?? 0))
    .slice(0, 2)
    .map((factor) => `${FACTOR_RULES[factor.factor].label.toLowerCase()} (${factor.contribution})`);
  const summary = `${levelLabel(level)}, ${score} of 100${
    leading.length > 0 ? `, mainly from ${leading.join(" and ")}` : ", with no factor adding points"
  }. Confidence ${confidence}${confidence === "low" ? ": treat the score as provisional" : ""}.`;
  return { method: SCORE_METHOD, score, level, summary, factors, confidence, limitations: gaps };
}
