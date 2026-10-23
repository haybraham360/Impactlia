import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { before, test } from "node:test";
import { loadGrammars, type Grammars } from "../../../parser/languages/tree-sitter";
import { parseRepository } from "../../../parser/parse-repository";
import { calculateBlastRadius, mapChangedFiles } from "../analyze";
import { collectCodeIssues, planCodeCheck } from "../code-issues";
import type { PullRequestFile, TestRecommendation } from "../report";
import { repositoryFiles } from "../repository-files";
import { recommendTests } from "../tests";
import { typeCheckFiles } from "../type-check";

// Run with `pnpm check:impact`. The languages that are dependency-aware but
// not test-aware: their tests are found by import and by name, their test
// command comes from their build files, and nothing is run.

// The parser's grammars load asynchronously, once, before any test.
let grammars: Grammars;
before(async () => {
  grammars = await loadGrammars();
});

const change = (file: string, line = 1): PullRequestFile => ({
  path: file,
  changeType: "modified",
  previousPath: null,
  additions: 1,
  deletions: 0,
  patchAvailable: true,
  addedLines: [{ start: line, end: line }],
  removedAt: [],
});

function analyse(files: Record<string, string>, changed: PullRequestFile[]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "impactlia-languages-impact-"));
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
    const code = collectCodeIssues(output, changes, radius.index, plan, typeCheckFiles(root, plan.targets));
    return { code, ...recommendTests(output, changes, mapping, radius, repositoryFiles(root), grammars) };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const existing = (results: TestRecommendation[]) =>
  results.filter((entry) => entry.kind === "existing_test").map((entry) => `${entry.title} ${entry.relationship} ${entry.confidence}`);
const command = (results: TestRecommendation[]) => results.find((entry) => entry.kind === "test_command")?.command ?? null;

test("Go: the package's test is found through its package, with go test for that package", () => {
  const { recommendations, discovery } = analyse(
    {
      "go.mod": "module example.com/shop\n",
      "cart/cart.go": "package cart\n\nfunc Total() int { return 1 }\n",
      "cart/cart_test.go": 'package cart\n\nimport "testing"\n\nfunc TestTotal(t *testing.T) {}\n',
    },
    [change("cart/cart.go", 3)],
  );
  assert.deepEqual(existing(recommendations), ["cart/cart_test.go imports-changed-file medium"]);
  assert.equal(command(recommendations), "go test ./cart");
  assert.deepEqual(discovery.symbolsUnread, [
    {
      path: "cart/cart.go",
      reason: "Which declarations changed is not read for Go files yet; tests were matched to it by import and by name.",
    },
  ]);
  // Scenarios are only suggested where declarations are read.
  assert.equal(recommendations.filter((entry) => entry.kind === "suggested_scenario").length, 0);
});

test("Java: a test naming the changed class is found, with Maven narrowed to it", () => {
  const { recommendations, discovery } = analyse(
    {
      "pom.xml": "<project/>\n",
      "src/main/java/shop/Cart.java": "package shop;\npublic class Cart { int total() { return 1; } }\n",
      "src/test/java/shop/CartTest.java": "package shop;\nimport org.junit.jupiter.api.Test;\nclass CartTest { @Test void total() { new Cart(); } }\n",
    },
    [change("src/main/java/shop/Cart.java", 2)],
  );
  assert.deepEqual(existing(recommendations), ["src/test/java/shop/CartTest.java imports-changed-file medium"]);
  assert.equal(command(recommendations), "mvn test -Dtest=CartTest");
  assert.deepEqual(discovery.frameworks, ["org.junit"]);
});

test("C#: dotnet test names the test project", () => {
  const { recommendations } = analyse(
    {
      "Shop/Cart.cs": "namespace Shop;\npublic class Cart {}\n",
      "Shop.Tests/Shop.Tests.csproj": "<Project/>\n",
      "Shop.Tests/CartTests.cs": "using Xunit;\nusing Shop;\npublic class CartTests { void T() { new Cart(); } }\n",
    },
    [change("Shop/Cart.cs", 2)],
  );
  assert.deepEqual(existing(recommendations), ["Shop.Tests/CartTests.cs imports-changed-file medium"]);
  assert.equal(command(recommendations), "dotnet test Shop.Tests/Shop.Tests.csproj");
});

test("PHP and Rust: PHPUnit for one test file, cargo test for a crate", () => {
  const php = analyse(
    {
      "phpunit.xml.dist": "<phpunit/>\n",
      "src/Cart.php": "<?php\nnamespace App;\nclass Cart {}\n",
      "tests/CartTest.php": "<?php\nuse App\\Cart;\nclass CartTest {}\n",
    },
    [change("src/Cart.php", 3)],
  );
  assert.equal(command(php.recommendations), "vendor/bin/phpunit tests/CartTest.php");
  const rust = analyse(
    {
      "Cargo.toml": '[package]\nname = "shop"\n',
      "src/lib.rs": "pub mod cart;\n",
      "src/cart.rs": "pub fn total() -> u32 { 1 }\n",
      "tests/cart.rs": "use shop::cart::total;\n",
    },
    [change("src/cart.rs")],
  );
  assert.deepEqual(existing(rust.recommendations), ["tests/cart.rs imports-changed-file medium"]);
  assert.equal(command(rust.recommendations), "cargo test");
});

test("C: no test command is guessed", () => {
  const { recommendations, discovery } = analyse(
    { "src/cart.c": '#include "cart.h"\n', "src/cart.h": "int total(void);\n", "src/cart_test.c": '#include "cart.h"\n' },
    [change("src/cart.h")],
  );
  assert.deepEqual(existing(recommendations), ["src/cart_test.c imports-changed-file medium"]);
  assert.equal(command(recommendations), null);
  assert.match(discovery.command.detail, /^No test command is suggested for C or C\+\+/);
});

test("a Java syntax error on an added line is an issue from tree-sitter; C never has one", () => {
  const { code } = analyse(
    {
      "src/Broken.java": "package x;\nclass Broken {\n  void f( {\n}\n",
      "src/odd.c": "#define WRAP(x) x\nWRAP(int) main(void) { return 0; }\n",
    },
    [change("src/Broken.java", 3), change("src/odd.c", 2)],
  );
  assert.deepEqual(
    code.issues.map((issue) => [issue.path, issue.category, issue.source]),
    [["src/Broken.java", "syntax", "tree-sitter"]],
  );
  assert.match(code.issues[0].conditions, /tree-sitter's Java parser/);
});
