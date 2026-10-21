import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { parseRepository } from "../../../parser/parse-repository";
import type { ParserOutput } from "../../../parser/contract";
import { analyseImpact } from "../analyze";
import type { ChangeType, PullRequestChanges, ReportFile } from "../report";
import { DIRECT_DEPENDENTS_HIGH, REACH_MEDIUM } from "../risk";

// Run with `pnpm check:impact`. Nothing here touches the network. Each
// repository is written out below and parsed by the real parser, so every
// expected answer can be confirmed by reading the files it was built from.

function parse(files: Record<string, string>): ParserOutput {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "impactlia-impact-check-"));
  try {
    for (const [name, content] of Object.entries(files)) {
      const target = path.join(root, name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content);
    }
    return parseRepository(root, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const change = (file: string, changeType: ChangeType = "modified") => ({
  path: file,
  changeType,
  previousPath: null,
  additions: 1,
  deletions: 1,
  patchAvailable: true,
  addedLines: null,
  removedAt: null,
});

const changes = (...files: ReturnType<typeof change>[]): PullRequestChanges => ({
  files,
  complete: true,
  reportedFileCount: files.length,
});

//   src/page.ts ──▶ src/a.ts ──▶ src/format.ts ──▶ src/core.ts
//                   src/b.ts ──▶ src/format.ts
//                   src/b.ts ──────────────────▶ src/core.ts
//   src/format.test.ts ──▶ src/format.ts
//   src/new.ts imports nothing and nothing imports it.
const repository = parse({
  "README.md": "# Example\n",
  "src/core.ts": "export const core = 1;\n",
  "src/format.ts": 'import { core } from "./core";\nexport const format = () => core;\n',
  "src/a.ts": 'import { format } from "./format";\nexport const a = format();\n',
  "src/b.ts":
    'import { format } from "./format";\nimport { core } from "./core";\nexport const b = format() + core;\n',
  "src/format.test.ts": 'import { format } from "./format";\nformat();\n',
  "src/page.ts": 'import { a } from "./a";\nexport default a;\n',
  "src/new.ts": "export const fresh = true;\n",
});

const pullRequest = changes(
  change("src/core.ts"),
  change("src/new.ts", "added"),
  change("src/gone.ts", "removed"),
  change("README.md"),
);

const affectedOf = (files: ReportFile[]) =>
  files.flatMap((file) => (file.kind === "affected" ? [file] : []));
const changedOf = (files: ReportFile[]) =>
  files.flatMap((file) => (file.kind === "changed" ? [file] : []));

test("changed files are exactly the pull request's files, each marked by whether it is in the graph", () => {
  const report = analyseImpact(repository, pullRequest, null);
  assert.deepEqual(
    changedOf(report.files).map((file) => [file.path, file.analysisState]),
    [
      ["README.md", "unanalysed"],
      ["src/core.ts", "analysed"],
      ["src/gone.ts", "unanalysed"],
      ["src/new.ts", "analysed"],
    ],
  );
  for (const file of changedOf(report.files)) {
    assert.equal(file.stateReason === null, file.analysisState === "analysed", file.path);
  }
});

test("a file reached by two routes is counted once, at its shortest distance", () => {
  const report = analyseImpact(repository, pullRequest, null);
  assert.deepEqual(
    affectedOf(report.files).map((file) => [file.path, file.impactDepth]),
    [
      ["src/b.ts", 1],
      ["src/format.ts", 1],
      ["src/a.ts", 2],
      ["src/format.test.ts", 2],
      ["src/page.ts", 3],
    ],
  );
  // src/b.ts imports core.ts directly and through format.ts.
  assert.deepEqual(
    affectedOf(report.files).find((file) => file.path === "src/b.ts")?.dependencyPath,
    ["src/core.ts", "src/b.ts"],
  );
});

test("a changed file is never also listed as affected", () => {
  // format.ts imports core.ts, and both are changed.
  const report = analyseImpact(repository, changes(change("src/core.ts"), change("src/format.ts")), null);
  const paths = report.files.map((file) => file.path);
  assert.equal(new Set(paths).size, paths.length);
  assert.ok(!affectedOf(report.files).some((file) => file.path === "src/format.ts"));
});

test("every path and every stored dependency is made of real edges", () => {
  const report = analyseImpact(repository, pullRequest, null);
  const edges = new Set(repository.edges.map((edge) => `${edge.source} -> ${edge.target}`));
  for (const dependency of report.dependencies) {
    assert.ok(edges.has(`${dependency.source} -> ${dependency.target}`), dependency.source);
  }
  for (const file of affectedOf(report.files)) {
    assert.equal(file.dependencyPath.length, file.impactDepth + 1);
    assert.equal(file.dependencyPath.at(-1), file.path);
    for (let step = 1; step < file.dependencyPath.length; step += 1) {
      // Each file imports the one before it.
      assert.ok(edges.has(`${file.dependencyPath[step]} -> ${file.dependencyPath[step - 1]}`));
    }
  }
  // Everything a finding points at is a file in the report.
  const inReport = new Set(report.files.map((file) => file.path));
  for (const finding of [...report.signals, ...report.recommendations]) {
    for (const file of finding.evidence) assert.ok(inReport.has(file), file);
  }
  for (const dependency of report.dependencies) {
    assert.ok(inReport.has(dependency.source) && inReport.has(dependency.target));
  }
});

test("signals carry the measurements that triggered them", () => {
  const report = analyseImpact(repository, pullRequest, null);
  assert.deepEqual(
    report.signals.map((signal) => [signal.signal, signal.level]),
    [
      ["transitive-reach", "low"],
      // A removed source file cannot be traced.
      ["incomplete-coverage", "medium"],
    ],
  );
  assert.match(report.signals[0].detail.facts[0], /^5 files import/);
  assert.deepEqual(
    report.limitations.map((limitation) => limitation.id),
    ["removed-files", "outside-graph", "commit-unverified"],
  );
});

test("with nothing to trace and nothing missing, no signal is raised", () => {
  const report = analyseImpact(repository, changes(change("src/new.ts", "added")), "a".repeat(40));
  assert.deepEqual(report.signals, []);
  assert.deepEqual(report.limitations, []);
  assert.deepEqual(affectedOf(report.files), []);
});

test("when no changed file is in the graph nothing is traced", () => {
  const report = analyseImpact(repository, changes(change("README.md")), null);
  assert.deepEqual(
    report.signals.map((signal) => [signal.signal, signal.level]),
    [["incomplete-coverage", "low"]],
  );
  assert.deepEqual(affectedOf(report.files), []);
});

test("an incomplete file list is a limitation and a signal", () => {
  const report = analyseImpact(
    repository,
    { files: [change("src/new.ts", "added")], complete: false, reportedFileCount: 4000 },
    null,
  );
  assert.ok(report.limitations.some((limitation) => limitation.id === "diff-incomplete"));
  assert.equal(report.signals.find((signal) => signal.signal === "incomplete-coverage")?.level, "medium");
});

test("suggested checks leave tests to the test recommendations", () => {
  const report = analyseImpact(repository, pullRequest, null);
  assert.deepEqual(
    report.recommendations.map((recommendation) => recommendation.evidence),
    [["README.md", "src/gone.ts"]],
  );
});

test("the same inputs give the same report whatever order they arrive in", () => {
  const reversed = { ...pullRequest, files: [...pullRequest.files].reverse() };
  assert.deepEqual(analyseImpact(repository, reversed, null), analyseImpact(repository, pullRequest, null));
});

test("the direct-dependents and reach thresholds are the documented ones", () => {
  const importers = Object.fromEntries(
    Array.from({ length: DIRECT_DEPENDENTS_HIGH }, (_, at) => [
      `src/use${String(at).padStart(2, "0")}.ts`,
      'import { hub } from "./hub";\nexport default hub;\n',
    ]),
  );
  const output = parse({ "src/hub.ts": "export const hub = 1;\n", ...importers });
  const report = analyseImpact(output, changes(change("src/hub.ts")), null);
  assert.equal(DIRECT_DEPENDENTS_HIGH, REACH_MEDIUM);
  assert.deepEqual(
    report.signals.map((signal) => [signal.signal, signal.level]),
    [
      ["direct-dependents", "high"],
      ["transitive-reach", "medium"],
    ],
  );
});
