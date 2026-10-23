import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { before, test } from "node:test";
import { loadGrammars, type Grammars } from "../../../parser/languages/tree-sitter";
import { parseRepository } from "../../../parser/parse-repository";
import { analyseImpact, calculateBlastRadius, mapChangedFiles } from "../analyze";
import { collectCodeIssues, planCodeCheck } from "../code-issues";
import { changedPythonDeclarations, pythonImportsOf } from "../python-syntax";
import type { ChangeType, LineRange, PullRequestFile, TestRecommendation } from "../report";
import { repositoryFiles } from "../repository-files";
import { recommendTests } from "../tests";
import { typeCheckFiles } from "../type-check";

// Run with `pnpm check:impact`. Nothing here touches the network or runs
// Python. Each repository is written out below and parsed by the real
// parser, so every expected answer can be read off the files.

// The parser's grammars load asynchronously, once, before any test.
let grammars: Grammars;
before(async () => {
  grammars = await loadGrammars();
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

function analyse(files: Record<string, string>, changed: PullRequestFile[]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "impactlia-python-impact-"));
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
    return {
      output,
      impact: analyseImpact(output, changes, null),
      code,
      plan,
      ...recommendTests(output, changes, mapping, radius, repositoryFiles(root), grammars),
    };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const kindOf = (results: TestRecommendation[], kind: TestRecommendation["kind"]) =>
  results.filter((recommendation) => recommendation.kind === kind);

// Line numbers matter below.
const CART = [
  "from shop.pricing import price", //                 1
  "", //                                                2
  "def total(items, discount=0):", //                   3
  "    if not items:", //                               4
  '        raise ValueError("empty")', //               5
  "    return sum(price(i) for i in items) - discount", // 6
  "", //                                                7
  "class Cart:", //                                     8
  "    def add(self, item):", //                        9
  "        try:", //                                    10
  "            self.items.append(item)", //             11
  "        except AttributeError:", //                  12
  "            self.items = [item]", //                 13
  "",
].join("\n");

const SHOP = {
  "pyproject.toml": '[project]\nname = "shop"\n\n[tool.pytest.ini_options]\ntestpaths = ["tests"]\n',
  "shop/__init__.py": "",
  "shop/pricing.py": "def price(item):\n    return 1\n",
  "shop/cart.py": CART,
  "shop/checkout.py": "from shop.cart import Cart\n",
  "shop/api.py": "from shop import checkout\n",
  "tests/test_cart.py": "import pytest\nfrom shop.cart import total\n\ndef test_total():\n    assert total([1]) == 1\n",
  "tests/test_checkout.py": "import shop.checkout\n",
};

test("changed Python declarations and the code added in them are read from syntax", () => {
  const declarations = changedPythonDeclarations(grammars, CART, {
    added: [{ start: 3, end: 5 }, { start: 12, end: 12 }],
    removedAt: [],
  });
  assert.deepEqual(
    declarations.map((declaration) => [declaration.name, declaration.kind, declaration.startLine, declaration.endLine, declaration.exportedAs]),
    [
      ["total", "function", 3, 6, ["total"]],
      // The class is touched as well as its method, as in TypeScript; its
      // own features exclude what is inside its methods.
      ["Cart", "class", 8, 13, ["Cart"]],
      ["Cart.add", "method", 9, 13, ["Cart"]],
    ],
  );
  assert.deepEqual(declarations[0].features, { signature: [3], throw: [5], branch: [4], fallback: [3] });
  assert.deepEqual(declarations[1].features, {});
  assert.deepEqual(declarations[2].features, { catch: [12] });
});

test("a Python test's imports are read as the parser recorded them", () => {
  assert.deepEqual(pythonImportsOf(grammars, "import a.b as c\nfrom . import x, y as z\nfrom m import *\n"), [
    { specifier: "a.b", line: 1, names: [], whole: true },
    { specifier: ".", line: 2, names: ["x", "y"], whole: false },
    { specifier: ".x", line: 2, names: [], whole: true },
    { specifier: ".y", line: 2, names: [], whole: true },
    { specifier: "m", line: 3, names: [], whole: true },
  ]);
});

test("the blast radius follows Python imports, and only them", () => {
  const { impact } = analyse(SHOP, [change("shop/cart.py", [{ start: 5, end: 5 }])]);
  assert.deepEqual(
    impact.files.filter((file) => file.kind === "affected").map((file) => [file.path, file.kind === "affected" ? file.impactDepth : 0]),
    [
      ["shop/checkout.py", 1],
      ["tests/test_cart.py", 1],
      ["shop/api.py", 2],
      ["tests/test_checkout.py", 2],
    ],
  );
});

test("a test importing the changed function is found with high confidence, with a pytest command", () => {
  const { recommendations, discovery } = analyse(SHOP, [change("shop/cart.py", [{ start: 5, end: 5 }])]);
  const existing = kindOf(recommendations, "existing_test");
  assert.deepEqual(
    existing.map((recommendation) => [recommendation.title, recommendation.relationship, recommendation.confidence]),
    [
      ["tests/test_cart.py", "imports-changed-symbol", "high"],
      ["tests/test_checkout.py", "imports-indirectly", "low"],
    ],
  );
  assert.match(existing[0].evidence[0], /^Imports total from shop\/cart\.py at line 2; this pull request changes total \(lines 3–6\)\.$/);
  const [command] = kindOf(recommendations, "test_command");
  assert.equal(command.command, "python -m pytest tests/test_cart.py");
  assert.equal(command.confidence, "high");
  assert.deepEqual(command.evidence.slice(0, 2), [
    "pyproject.toml has a [tool.pytest.ini_options] section.",
    "A test file imports pytest.",
  ]);
  assert.deepEqual(discovery.frameworks, ["pytest"]);
  const [scenario] = kindOf(recommendations, "suggested_scenario");
  assert.equal(scenario.title, "The error path in total");
  assert.deepEqual(scenario.evidence[0], "raise at line 5.");
});

test("without pytest evidence no Python command is invented", () => {
  const files: Record<string, string> = { ...SHOP, "tests/test_cart.py": "from shop.cart import total\n" };
  delete files["pyproject.toml"];
  const { recommendations, discovery } = analyse(files, [change("shop/cart.py", [{ start: 5, end: 5 }])]);
  assert.equal(kindOf(recommendations, "test_command").length, 0);
  assert.match(discovery.command.detail, /^No Python test command could be identified/);
});

test("a Python syntax error on an added line is an issue from tree-sitter, and Python is not type-checked", () => {
  const { code, plan } = analyse(
    { "app/__init__.py": "", "app/views.py": "def view(:\n    pass\n", "app/urls.py": "from app import views\n" },
    [change("app/views.py", [{ start: 1, end: 1 }]), change("app/urls.py", [{ start: 1, end: 1 }])],
  );
  assert.deepEqual(
    code.issues.map((issue) => [issue.path, issue.startLine, issue.category, issue.source, issue.relatedFiles.map((file) => file.path)]),
    [["app/views.py", 1, "syntax", "tree-sitter", ["app/urls.py"]]],
  );
  assert.deepEqual(plan.targets, []);
  assert.match(plan.skipped.find((entry) => entry.path === "app/urls.py")?.reason ?? "", /^Python files are not type-checked/);
});

test("a changed file in a language that is only detected is named, and nothing is claimed about it", () => {
  const { impact } = analyse({ ...SHOP, "tools/release.rb": "puts 1\n" }, [
    change("tools/release.rb", [{ start: 1, end: 1 }]),
    change("shop/cart.py", [{ start: 5, end: 5 }]),
  ]);
  const ruby = impact.files.find((file) => file.path === "tools/release.rb");
  assert.equal(ruby?.kind === "changed" ? ruby.analysisState : null, "unanalysed");
  const limitation = impact.limitations.find((entry) => entry.id === "language-detected-only:Ruby");
  assert.deepEqual(limitation?.files, ["tools/release.rb"]);
  assert.match(limitation?.detail ?? "", /Ruby is recognised by its file extension but not parsed yet/);
});
