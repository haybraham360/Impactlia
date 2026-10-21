import assert from "node:assert/strict";
import { test } from "node:test";
import type { ChangeMapping } from "../analyze";
import type {
  ChangedReportFile,
  CodeIssue,
  PullRequestFile,
  ReportSignal,
  RiskLevel,
  SignalId,
} from "../report";
import { LEVEL_THRESHOLDS, assessRisk, levelOf, type ScoreInput } from "../score";

// Run with `pnpm check:impact`. The score is a pure function of what the
// earlier steps found, so its inputs are written out by hand here and every
// expected number can be added up from the rules in score.ts.

function file(path: string, additions = 5, deletions = 5): PullRequestFile {
  return {
    path,
    changeType: "modified",
    previousPath: null,
    additions,
    deletions,
    patchAvailable: true,
    addedLines: [{ start: 1, end: 1 }],
    removedAt: [],
  };
}

function analysed(path: string): ChangedReportFile {
  return {
    kind: "changed",
    path,
    changeType: "modified",
    previousPath: null,
    additions: 5,
    deletions: 5,
    patchAvailable: true,
    analysisState: "analysed",
    stateReason: null,
  };
}

function signal(id: SignalId, level: RiskLevel, facts: string[] = [`${id} fact`]): ReportSignal {
  return { signal: id, level, detail: { rule: "", facts }, evidence: [] };
}

function issue(category: CodeIssue["category"]): CodeIssue {
  return {
    title: category,
    category,
    severity: category === "syntax" ? "high" : "medium",
    status: "confirmed",
    source: "compiler",
    ruleId: category === "type" ? "TS2322" : null,
    path: "src/a.ts",
    startLine: 3,
    startColumn: 1,
    endLine: 3,
    endColumn: 2,
    message: "m",
    conditions: "c",
    relatedFiles: [],
    relatedFileCount: 0,
  };
}

// One analysed, type-checked, directly tested source file and nothing else:
// every factor measured and none adding points.
function input(overrides: Partial<ScoreInput> = {}, paths = ["src/a.ts"]): ScoreInput {
  const mapping: ChangeMapping = {
    changed: paths.map(analysed),
    starts: [...paths],
    removed: [],
    outsideGraph: [],
    missing: [],
    unparsed: [],
  };
  return {
    changes: { files: paths.map((path) => file(path)), complete: true, reportedFileCount: paths.length },
    mapping,
    signals: [],
    codeIssues: [],
    codeCheck: { checked: [...paths], skipped: [], setAside: [], omitted: 0 },
    tests: { changedCode: [...paths], directlyTested: [...paths], testFileCount: 3 },
    limitations: [],
    ...overrides,
  };
}

const contributionOf = (result: ReturnType<typeof assessRisk>, factor: string) =>
  result.factors.find((entry) => entry.factor === factor)?.contribution;

test("the same input always gives the same assessment", () => {
  const value = input({ signals: [signal("transitive-reach", "medium")] });
  assert.deepEqual(assessRisk(value), assessRisk(structuredClone(value)));
});

test("levels change exactly at the documented thresholds", () => {
  assert.deepEqual(
    [0, 24, 25, 49, 50, 74, 75, 100].map(levelOf),
    ["low", "low", "moderate", "moderate", "high", "high", "very_high", "very_high"],
  );
  assert.deepEqual(
    LEVEL_THRESHOLDS.map((threshold) => threshold.from),
    [75, 50, 25, 0],
  );
});

test("with every factor measured and none present, the score is 0 and confidence high", () => {
  const result = assessRisk(input());
  assert.equal(result.score, 0);
  assert.equal(result.level, "low");
  assert.equal(result.confidence, "high");
  assert.equal(
    result.factors.find((factor) => factor.factor === "test-evidence")?.direction,
    "reduces_uncertainty",
  );
});

test("the score is the sum of the factors, capped at 100", () => {
  const result = assessRisk(
    input({
      signals: [signal("direct-dependents", "high"), signal("critical-role", "medium")],
      codeIssues: [issue("syntax")],
      tests: { changedCode: ["src/a.ts"], directlyTested: [], testFileCount: 3 },
      changes: {
        files: [file("src/a.ts", 900, 200), file("package.json")],
        complete: true,
        reportedFileCount: 2,
      },
    }),
  );
  // 30 reach + 15 role + 25 syntax + 15 no tests + 10 size + 10 configuration.
  assert.equal(result.score, 100);
  assert.equal(result.level, "very_high");
});

test("the reach signals measure one thing and are counted once", () => {
  const result = assessRisk(
    input({
      signals: [
        signal("direct-dependents", "high"),
        signal("transitive-reach", "medium"),
        signal("shared-module-reached", "medium"),
      ],
    }),
  );
  assert.equal(contributionOf(result, "dependency-reach"), 30);
  assert.equal(result.score, 30);
});

test("what was not measured adds nothing and is marked unknown", () => {
  const result = assessRisk(
    input({
      codeCheck: { checked: [], skipped: [{ path: "src/a.ts", reason: "no patch" }], setAside: [], omitted: 0 },
      tests: { changedCode: [], directlyTested: [], testFileCount: 0 },
    }),
  );
  for (const factor of ["code-issues", "test-evidence"]) {
    const entry = result.factors.find((candidate) => candidate.factor === factor);
    assert.equal(entry?.direction, "unknown", factor);
    assert.equal(entry?.contribution, null, factor);
  }
  assert.equal(result.score, 0);
});

test("a large pull request is not pushed up by its size alone", () => {
  const paths = Array.from({ length: 400 }, (_, at) => `src/f${at}.ts`);
  const result = assessRisk(
    input(
      {
        changes: {
          files: paths.map((path) => file(path, 120, 30)),
          complete: true,
          reportedFileCount: paths.length,
        },
      },
      paths,
    ),
  );
  assert.equal(contributionOf(result, "change-size"), 10);
  assert.equal(result.score, 10);
  assert.equal(result.level, "low");
});

test("a request-handling file counts only when its role was established, never by its name", () => {
  const named = assessRisk(input({}, ["src/payments/checkout-auth.ts"]));
  assert.equal(contributionOf(named, "critical-role"), 0);
  const established = assessRisk(input({ signals: [signal("critical-role", "medium")] }));
  assert.equal(contributionOf(established, "critical-role"), 15);
});

test("only issues a tool reported add points", () => {
  assert.equal(contributionOf(assessRisk(input({ codeIssues: [issue("syntax"), issue("type")] })), "code-issues"), 25);
  assert.equal(contributionOf(assessRisk(input({ codeIssues: [issue("type")] })), "code-issues"), 15);
  // Scenarios and other suggestions are not an input to the score at all;
  // with no reported issue, nothing is added.
  assert.equal(contributionOf(assessRisk(input()), "code-issues"), 0);
});

test("an incomplete analysis is shown as low confidence and provisional", () => {
  const result = assessRisk(
    input({
      changes: { files: [file("src/a.ts")], complete: false, reportedFileCount: 4000 },
      limitations: [{ id: "diff-incomplete", detail: "", files: [] }],
    }),
  );
  assert.equal(result.confidence, "low");
  assert.match(result.summary, /provisional/);
  assert.ok(result.limitations.some((limitation) => limitation.includes("4000")));
});

test("gaps in the graph lower confidence to medium without adding points", () => {
  const result = assessRisk(
    input({
      signals: [signal("incomplete-coverage", "low")],
      limitations: [{ id: "graph-incomplete", detail: "", files: [] }],
    }),
  );
  assert.equal(result.confidence, "medium");
  assert.equal(result.score, 0);
  assert.equal(contributionOf(result, "analysis-completeness"), null);
});

test("with no changed file in the graph there is no score at all", () => {
  const result = assessRisk(
    input({
      mapping: { changed: [], starts: [], removed: [], outsideGraph: ["README.md"], missing: [], unparsed: [] },
      tests: { changedCode: [], directlyTested: [], testFileCount: 0 },
    }),
  );
  assert.equal(result.score, null);
  assert.equal(result.level, null);
  assert.match(result.summary, /^Insufficient evidence/);
});
