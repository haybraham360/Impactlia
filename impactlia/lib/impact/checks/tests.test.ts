import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { parseRepository } from "../../../parser/parse-repository";
import { calculateBlastRadius, mapChangedFiles } from "../analyze";
import { readPatch } from "../patch";
import type { ChangeType, LineRange, PullRequestFile, TestRecommendation } from "../report";
import { repositoryFiles } from "../repository-files";
import { changedDeclarations } from "../syntax";
import { recommendTests } from "../tests";

// Run with `pnpm check:impact`. Nothing here touches the network. Each
// repository is written out below and parsed by the real parser, so every
// expected recommendation can be confirmed by reading the files it came from.

function change(
  file: string,
  addedLines: LineRange[] | null,
  changeType: ChangeType = "modified",
): PullRequestFile {
  return {
    path: file,
    changeType,
    previousPath: null,
    additions: 1,
    deletions: 0,
    patchAvailable: addedLines !== null,
    addedLines,
    removedAt: addedLines === null ? null : [],
  };
}

function recommend(files: Record<string, string>, changed: PullRequestFile[]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "impactlia-test-recommendations-"));
  try {
    for (const [name, content] of Object.entries(files)) {
      const target = path.join(root, name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content);
    }
    const output = parseRepository(root, []);
    const changes = { files: changed, complete: true, reportedFileCount: changed.length };
    const mapping = mapChangedFiles(output, changes);
    const radius = calculateBlastRadius(output, mapping.starts);
    return { output, ...recommendTests(output, changes, mapping, radius, repositoryFiles(root)) };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const kindOf = (results: TestRecommendation[], kind: TestRecommendation["kind"]) =>
  results.filter((recommendation) => recommendation.kind === kind);

// Line numbers matter below: format's `if` is line 3 and its `??` line 4.
const FORMAT = [
  "export function format(value: number | null, unit?: string) {", // 1
  "  const shown = value ?? 0;", //                                   2
  "  if (shown < 0) {", //                                             3
  '    return `-${unit ?? ""}${-shown}`;', //                          4
  "  }", //                                                            5
  '  return `${unit ?? ""}${shown}`;', //                              6
  "}", //                                                              7
  "", //                                                               8
  "export function parse(text: string) {", //                          9
  "  return Number(text);", //                                         10
  "}", //                                                              11
  "",
].join("\n");

const REPOSITORY = {
  "package.json": JSON.stringify({ name: "shop", scripts: { test: "vitest run" } }),
  "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
  "src/format.ts": FORMAT,
  // Imports the changed declaration by name.
  "src/format.test.ts": 'import { format } from "./format";\nformat(1);\n',
  // Imports the changed file, but only a declaration the diff did not touch.
  "src/parse.test.ts": 'import { parse } from "./format";\nparse("1");\n',
  "src/page.ts": 'import { format } from "./format";\nexport const page = () => format(2);\n',
  // Reaches the change only through page.ts.
  "src/page.test.ts": 'import { page } from "./page";\npage();\n',
  // Not named like a test, but imports a test runner: an unfamiliar layout.
  "qa/format-check.ts": 'import { test } from "node:test";\nimport { format } from "../src/format";\ntest("f", () => { format(3); });\n',
  "src/lonely.ts": "export function lonely(flag: boolean) {\n  if (flag) throw new Error(\"no\");\n  return 1;\n}\n",
  // Named like lonely.ts, imports nothing of it.
  "test/lonely.spec.ts": "export {};\n",
};

const PULL_REQUEST = [
  change("src/format.ts", [{ start: 2, end: 4 }]),
  change("src/lonely.ts", [{ start: 2, end: 2 }]),
];

test("removed lines are read from a unified diff as the head line that follows them", () => {
  assert.deepEqual(readPatch("@@ -1,4 +1,2 @@\n a\n-b\n c\n-d\n"), {
    added: [],
    removedAt: [2, 3],
  });
  assert.deepEqual(readPatch("@@ -1,3 +1,3 @@\n a\n-b\n+c\n d"), {
    added: [{ start: 2, end: 2 }],
    removedAt: [2],
  });
});

test("a change that only removes lines still marks the declaration it was in", () => {
  const text = "export function a() {\n  return 1;\n}\nexport function b() {\n  return 2;\n}\n";
  // Lines removed from inside a(), before its closing brace on line 3.
  const changed = changedDeclarations("x.ts", text, { added: [], removedAt: [3] });
  assert.deepEqual(changed.map((declaration) => declaration.name), ["a"]);
  // Lines removed just above b() belong to neither.
  assert.deepEqual(changedDeclarations("x.ts", text, { added: [], removedAt: [4] }), []);
});

test("a test that imports only types from a changed file is not tied to it by import", () => {
  const { recommendations } = recommend(
    {
      "src/shape.ts": "export type Shape = { a: number };\nexport const make = (): Shape => ({ a: 1 });\n",
      "src/shape.test.ts": 'import type { Shape } from "./shape";\nconst s: Shape = { a: 1 };\nexport default s;\n',
    },
    [change("src/shape.ts", [{ start: 2, end: 2 }])],
  );
  // Still listed, weakly, because of its name, and the evidence says why.
  const [named] = kindOf(recommendations, "existing_test");
  assert.equal(named.relationship, "name-only");
  assert.equal(named.confidence, "low");
  assert.match(named.evidence[0], /imports only types from it/);
  assert.deepEqual(kindOf(recommendations, "coverage_unknown").map((r) => r.title), [
    "No test found importing src/shape.ts",
  ]);
});

test("a test importing a changed declaration by name is found with high confidence", () => {
  const { recommendations } = recommend(REPOSITORY, PULL_REQUEST);
  const found = kindOf(recommendations, "existing_test").find(
    (recommendation) => recommendation.title === "src/format.test.ts",
  );
  assert.ok(found);
  assert.equal(found.relationship, "imports-changed-symbol");
  assert.equal(found.confidence, "high");
  assert.equal(found.symbol, "format");
  assert.deepEqual(found.relatedChangedFiles, [{ path: "src/format.ts", startLine: 1, endLine: 7 }]);
  assert.equal(found.relatedTestFiles[0].startLine, 1);
  assert.match(found.evidence[0], /^Imports format from src\/format\.ts at line 1; this pull request changes format \(lines 1–7\)\.$/);
});

test("each existing test says how it is tied to the change, strongest first", () => {
  const { recommendations } = recommend(REPOSITORY, PULL_REQUEST);
  assert.deepEqual(
    kindOf(recommendations, "existing_test").map((recommendation) => [
      recommendation.title,
      recommendation.relationship,
      recommendation.confidence,
    ]),
    [
      ["qa/format-check.ts", "imports-changed-symbol", "high"],
      ["src/format.test.ts", "imports-changed-symbol", "high"],
      ["src/parse.test.ts", "imports-changed-file", "medium"],
      ["src/page.test.ts", "imports-indirectly", "low"],
      ["test/lonely.spec.ts", "name-only", "low"],
    ],
  );
  const parse = kindOf(recommendations, "existing_test").find((r) => r.title === "src/parse.test.ts");
  assert.match(parse?.evidence[0] ?? "", /Imports parse from src\/format\.ts at line 1, but not format, which hold the changed lines\./);
});

test("a repository whose tests are not named *.test.* is still searched", () => {
  const { discovery } = recommend(REPOSITORY, PULL_REQUEST);
  assert.equal(discovery.testFileCount, 5);
  assert.deepEqual(discovery.frameworks, ["node:test"]);
  assert.deepEqual(
    discovery.conventions.map((entry) => [entry.rule, entry.count]),
    [
      ["Named *.test.* or *.spec.*.", 4],
      ["Imports a test runner.", 1],
    ],
  );
});

test("a changed file no test imports is unknown coverage, not a gap", () => {
  const { recommendations } = recommend(REPOSITORY, PULL_REQUEST);
  const unknown = kindOf(recommendations, "coverage_unknown");
  assert.deepEqual(unknown.map((recommendation) => recommendation.title), [
    "No test found importing src/lonely.ts",
  ]);
  assert.equal(unknown[0].status, "unknown");
  assert.match(unknown[0].rationale, /not a confirmed gap/);
  assert.deepEqual(unknown[0].relatedTestFiles.map((file) => file.path), ["test/lonely.spec.ts"]);
});

test("no coverage figure is ever claimed, because none was read", () => {
  const { recommendations, discovery } = recommend(REPOSITORY, PULL_REQUEST);
  assert.match(discovery.coverageData, /Coverage reports are not read/);
  for (const recommendation of recommendations) {
    const text = [recommendation.title, recommendation.description, recommendation.rationale, ...recommendation.evidence].join(" ");
    assert.doesNotMatch(text, /\d+(\.\d+)?\s*%/, recommendation.title);
    assert.doesNotMatch(text, /\buntested\b/i, recommendation.title);
  }
});

test("scenarios come from the syntax on added lines and cite those lines", () => {
  const { recommendations } = recommend(REPOSITORY, PULL_REQUEST);
  const scenarios = kindOf(recommendations, "suggested_scenario");
  assert.deepEqual(
    scenarios.map((scenario) => [
      scenario.symbol,
      scenario.riskAddressed,
      scenario.relatedChangedFiles[0].path,
      scenario.relatedChangedFiles[0].startLine,
      scenario.relatedChangedFiles[0].endLine,
    ]),
    [
      // format is exported and imported by four files, so high priority; it
      // comes first, then by line, then by kind.
      ["format", "missing or invalid input", "src/format.ts", 2, 4],
      ["format", "regression", "src/format.ts", 3, 3],
      // lonely's line 2 holds both a condition and a throw.
      ["lonely", "error handling", "src/lonely.ts", 2, 2],
      ["lonely", "regression", "src/lonely.ts", 2, 2],
    ],
  );
  // The existing test that imports format is offered as where it may fit.
  assert.deepEqual(scenarios[0].relatedTestFiles.map((file) => file.path), [
    "qa/format-check.ts",
    "src/format.test.ts",
    "src/parse.test.ts",
  ]);
  assert.equal(scenarios[0].status, "suggested");
  assert.deepEqual(scenarios.map((scenario) => scenario.priority), ["high", "high", "medium", "medium"]);
});

test("the test command comes from package.json and is narrowed to the related tests", () => {
  const { recommendations } = recommend(REPOSITORY, PULL_REQUEST);
  const [command] = kindOf(recommendations, "test_command");
  assert.equal(command.command, "pnpm test qa/format-check.ts src/format.test.ts src/parse.test.ts");
  assert.equal(command.workingDirectory, "");
  assert.equal(command.confidence, "high");
});

test("without a test script no command is invented", () => {
  const { recommendations, discovery } = recommend(
    { ...REPOSITORY, "package.json": JSON.stringify({ name: "shop", scripts: { test: 'echo "Error: no test specified" && exit 1' } }) },
    PULL_REQUEST,
  );
  assert.deepEqual(kindOf(recommendations, "test_command"), []);
  assert.equal(discovery.command.found, false);
  assert.match(discovery.command.detail, /could not be identified/);
});

test("a changed function with no related test gets no existing test", () => {
  const { recommendations } = recommend(
    { "src/solo.ts": "export const solo = () => 1;\n" },
    [change("src/solo.ts", [{ start: 1, end: 1 }])],
  );
  assert.deepEqual(kindOf(recommendations, "existing_test"), []);
  const [unknown] = kindOf(recommendations, "coverage_unknown");
  assert.equal(unknown.description, "No file in this repository was identified as a test by the rules used.");
});

test("a file with no readable patch is matched by import only, and says so", () => {
  const { recommendations, discovery, limitations } = recommend(REPOSITORY, [change("src/format.ts", null)]);
  assert.deepEqual(discovery.symbolsUnread.map((entry) => entry.path), ["src/format.ts"]);
  assert.ok(limitations.some((limitation) => limitation.id === "test-symbols-unread"));
  assert.deepEqual(kindOf(recommendations, "suggested_scenario"), []);
  const format = kindOf(recommendations, "existing_test").find((r) => r.title === "src/format.test.ts");
  assert.equal(format?.relationship, "imports-changed-file");
  assert.match(format?.evidence[0] ?? "", /Which declarations changed in it is unknown\./);
});

test("references outside the head commit are never cited", () => {
  // A diff from another revision: lines past the end of the file, and a path
  // the head commit does not have.
  const { recommendations } = recommend(REPOSITORY, [
    change("src/format.ts", [{ start: 400, end: 410 }]),
    change("src/old.ts", [{ start: 1, end: 3 }]),
  ]);
  const changed = new Set(["src/format.ts", "src/old.ts"]);
  const lines: Record<string, number> = { "src/format.ts": FORMAT.split("\n").length };
  for (const recommendation of recommendations) {
    for (const reference of recommendation.relatedChangedFiles) {
      assert.ok(changed.has(reference.path), reference.path);
      assert.notEqual(reference.path, "src/old.ts");
      if (reference.endLine !== null) assert.ok(reference.endLine <= lines[reference.path]);
    }
  }
  assert.deepEqual(kindOf(recommendations, "suggested_scenario"), []);
});

test("a pull request with nothing to analyse recommends nothing", () => {
  const { recommendations } = recommend(REPOSITORY, [change("README.md", [{ start: 1, end: 1 }])]);
  assert.deepEqual(recommendations, []);
});

test("the same inputs give the same recommendations whatever order they arrive in", () => {
  const first = recommend(REPOSITORY, PULL_REQUEST);
  const second = recommend(REPOSITORY, [...PULL_REQUEST].reverse());
  assert.deepEqual(first.recommendations, second.recommendations);
  assert.deepEqual(first.discovery, second.discovery);
});
