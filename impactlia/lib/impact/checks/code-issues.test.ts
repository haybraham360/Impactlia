import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { before, test } from "node:test";
import { parseRepository } from "../../../parser/parse-repository";
import { calculateBlastRadius, mapChangedFiles } from "../analyze";
import { collectCodeIssues, planCodeCheck } from "../code-issues";
import { addedLines } from "../patch";
import type { ChangeType, LineRange, PullRequestFile } from "../report";
import { typeCheckFiles } from "../type-check";
import { loadGrammars, type Grammars } from "../../../parser/languages/tree-sitter";

// The parser's grammars load asynchronously, once, before any test.
let grammars: Grammars;
before(async () => {
  grammars = await loadGrammars();
});

// Run with `pnpm check:impact`. Nothing here touches the network. Each
// repository is written out below, parsed by the real parser and checked by
// the real compiler, so every expected issue can be confirmed by reading the
// files it was built from.

const TSCONFIG = JSON.stringify({
  compilerOptions: { strict: true, target: "es2022", module: "esnext", moduleResolution: "bundler" },
  include: ["src"],
});

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

function check(files: Record<string, string>, changed: PullRequestFile[]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "impactlia-code-check-"));
  try {
    for (const [name, content] of Object.entries(files)) {
      const target = path.join(root, name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content);
    }
    const output = parseRepository(root, grammars);
    const changes = { files: changed, complete: true, reportedFileCount: changed.length };
    const mapping = mapChangedFiles(output, changes);
    const radius = calculateBlastRadius(output, mapping.starts);
    const plan = planCodeCheck(output, changes, mapping);
    const outcomes = typeCheckFiles(root, plan.targets);
    return collectCodeIssues(output, changes, radius.index, plan, outcomes);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("added lines are read from a unified diff", () => {
  assert.deepEqual(
    addedLines("@@ -1,3 +1,4 @@\n a\n-b\n+c\n+d\n e\n@@ -10,2 +11,2 @@ f()\n g\n+h\n\\ No newline at end of file"),
    [
      { start: 2, end: 3 },
      { start: 12, end: 12 },
    ],
  );
  assert.deepEqual(addedLines("@@ -0,0 +1 @@\n+only"), [{ start: 1, end: 1 }]);
  assert.deepEqual(addedLines("@@ -1,2 +1 @@\n a\n-b"), []);
  // Not a diff, or one that does not add up, is not trusted.
  assert.equal(addedLines("Binary files differ"), null);
  assert.equal(addedLines("@@ -1,1 +1,1 @@\n+a\n+b"), null);
});

test("a type error on an added line is a confirmed issue linked to the files importing it", () => {
  const { issues, check: coverage } = check(
    {
      "tsconfig.json": TSCONFIG,
      "src/price.ts": 'export function price(cents: number): string {\n  const label: number = "free";\n  return String(cents) + label;\n}\n',
      "src/cart.ts": 'import { price } from "./price";\nexport const total = price(1);\n',
      "src/types.ts": 'import type { price } from "./price";\nexport type P = typeof price;\n',
    },
    [change("src/price.ts", [{ start: 2, end: 2 }])],
  );
  assert.equal(issues.length, 1);
  const [issue] = issues;
  assert.equal(issue.ruleId, "TS2322");
  assert.equal(issue.category, "type");
  assert.equal(issue.status, "confirmed");
  assert.equal(issue.source, "compiler");
  assert.equal(issue.severity, "medium");
  assert.equal(issue.path, "src/price.ts");
  assert.equal(issue.startLine, 2);
  assert.equal(issue.startColumn, 9);
  assert.match(issue.conditions, /tsconfig\.json/);
  assert.deepEqual(issue.relatedFiles, [
    { path: "src/cart.ts", relationship: "import", typeOnly: false },
    { path: "src/types.ts", relationship: "import", typeOnly: true },
  ]);
  assert.equal(issue.relatedFileCount, 2);
  assert.deepEqual(coverage.checked, ["src/price.ts"]);
});

test("an error on a line the pull request did not add is not reported", () => {
  const { issues, check: coverage } = check(
    {
      "tsconfig.json": TSCONFIG,
      "src/a.ts": 'const old: number = "already here";\nexport const added = 1;\n',
    },
    [change("src/a.ts", [{ start: 2, end: 2 }])],
  );
  assert.deepEqual(issues, []);
  assert.deepEqual(coverage.checked, ["src/a.ts"]);
});

test("what a missing package causes is set aside, and a real error beside it is kept", () => {
  const { issues, check: coverage } = check(
    {
      "tsconfig.json": TSCONFIG,
      "src/server.ts": [
        'import express from "express";',
        "const app = express();",
        'app.get("/", (req, res) => res.send(req.query));',
        "process.env.PORT;",
        'export const port: number = "8080";',
      ].join("\n"),
    },
    [change("src/server.ts", null, "added")],
  );
  assert.deepEqual(
    issues.map((issue) => [issue.ruleId, issue.startLine]),
    [["TS2322", 5]],
  );
  const setAside = new Map(coverage.setAside.map((entry) => [entry.ruleId, entry.count]));
  assert.equal(setAside.get("TS2307"), 1);
  assert.equal(setAside.get("TS7006"), 2);
  assert.ok(setAside.has("TS2580") || setAside.has("TS2591"));
});

test("clean code gives no issues and still records what was checked", () => {
  const { issues, check: coverage, limitations } = check(
    {
      "tsconfig.json": TSCONFIG,
      "src/a.ts": "export const double = (n: number): number => n * 2;\n",
    },
    [change("src/a.ts", null, "added")],
  );
  assert.deepEqual(issues, []);
  assert.deepEqual(coverage.checked, ["src/a.ts"]);
  assert.deepEqual(coverage.skipped, []);
  assert.deepEqual(limitations, []);
});

test("files with no usable compiler settings are skipped with the reason", () => {
  const { issues, check: coverage, limitations } = check(
    {
      "a/x.ts": 'export const x: number = "no config";\n',
      "b/tsconfig.json": JSON.stringify({ extends: "@missing/base/tsconfig.json" }),
      "b/y.ts": 'export const y: number = "base missing";\n',
      "c/tsconfig.json": JSON.stringify({ extends: "../../outside.json" }),
      "c/z.ts": 'export const z: number = "outside";\n',
      "d/tsconfig.json": JSON.stringify({ compilerOptions: { allowJs: true } }),
      "d/w.js": "export const w = 1;\n",
      "e/v.ts": "export const v = 1;\n",
    },
    [
      change("a/x.ts", null, "added"),
      change("b/y.ts", null, "added"),
      change("c/z.ts", null, "added"),
      change("d/w.js", null, "added"),
      change("e/v.ts", null),
    ],
  );
  assert.deepEqual(issues, []);
  assert.deepEqual(coverage.checked, []);
  const reasons = new Map(coverage.skipped.map((entry) => [entry.path, entry.reason]));
  assert.match(reasons.get("a/x.ts") ?? "", /No tsconfig\.json/);
  assert.match(reasons.get("b/y.ts") ?? "", /could not be fully read/);
  assert.match(reasons.get("c/z.ts") ?? "", /could not be fully read/);
  assert.match(reasons.get("d/w.js") ?? "", /JavaScript/);
  assert.match(reasons.get("e/v.ts") ?? "", /no patch/);
  assert.equal(limitations[0]?.id, "code-check-partial");
});

test("a syntax error on an added line is a high-severity issue", () => {
  const { issues, check: coverage } = check(
    {
      "tsconfig.json": TSCONFIG,
      "src/broken.ts": "export const ok = 1;\nexport const = ;\n",
      "src/user.ts": 'import { ok } from "./broken";\nexport const used = ok;\n',
    },
    [change("src/broken.ts", [{ start: 2, end: 2 }])],
  );
  assert.ok(issues.length >= 1);
  assert.ok(issues.every((issue) => issue.category === "syntax" && issue.severity === "high"));
  assert.equal(issues[0].startLine, 2);
  assert.deepEqual(issues[0].relatedFiles.map((file) => file.path), ["src/user.ts"]);
  assert.match(coverage.skipped[0]?.reason ?? "", /syntax errors/);
});
