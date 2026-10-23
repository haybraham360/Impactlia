import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { before, test } from "node:test";
import { frameworkAdapters } from "../adapters";
import type { ParserOutput } from "../contract";
import { describeLanguage } from "../languages/registry";
import { loadGrammars, type Grammars } from "../languages/tree-sitter";
import { parseRepository } from "../parse-repository";
import { readParserOutput } from "../validate";

// Run with `pnpm check:adapters`. Each repository is written out below, file
// by file, so every expected edge can be read off the files themselves.

// The parser's grammars load asynchronously, once, before any test.
let grammars: Grammars;
before(async () => {
  grammars = await loadGrammars();
});

function analyse(files: Record<string, string>): ParserOutput {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "impactlia-python-"));
  try {
    for (const [file, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(directory, file)), { recursive: true });
      fs.writeFileSync(path.join(directory, file), content);
    }
    const output = parseRepository(directory, grammars, frameworkAdapters);
    // What is stored is what has to hold together.
    return readParserOutput(JSON.parse(JSON.stringify(output)));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

const edgesOf = (output: ParserOutput) =>
  output.edges.map((edge) => `${edge.source} -> ${edge.target}${edge.typeOnly ? " (types)" : ""}`);

const unlinkedOf = (output: ParserOutput) =>
  output.unlinkedReferences.map(
    (reference) =>
      `${reference.source}:${reference.line} ${reference.specifier ?? "(expression)"} ${reference.status}${
        reference.status === "external" ? `:${reference.externalKind}` : reference.status === "unresolved" ? `:${reference.reason}` : ""
      }`,
  );

// A src-layout project:
//   src/shop/__init__.py   imports .cart
//   src/shop/cart.py       imports .pricing, .payments (gateway as a
//                          submodule, charge from __init__), Gateway only
//                          under TYPE_CHECKING, os, requests, and a module
//                          named at runtime
//   tests/test_cart.py     imports shop.cart, shop.missing, pytest
const SHOP = {
  "pyproject.toml": '[project]\nname = "shop"\n\n[tool.pytest.ini_options]\ntestpaths = ["tests"]\n',
  "src/shop/__init__.py": "from .cart import Cart\n",
  "src/shop/cart.py": [
    "from __future__ import annotations", //               1
    "from typing import TYPE_CHECKING", //                 2
    "import os", //                                        3
    "import requests", //                                  4
    "from . import pricing", //                            5
    "from .payments import gateway, charge as pay", //     6
    "if TYPE_CHECKING:", //                                7
    "    from shop.payments.gateway import Gateway", //    8
    "", //                                                 9
    "class Cart:", //                                      10
    "    def total(self, items=None):", //                 11
    "        import importlib", //                         12
    '        importlib.import_module("shop.pricing")', //  13
    "        importlib.import_module(name)", //            14
    "        return pricing.sum(items or [])", //          15
    "",
  ].join("\n"),
  "src/shop/pricing.py": "def sum(items):\n    return 0\n",
  "src/shop/payments/__init__.py": "def charge(amount):\n    raise ValueError(amount)\n",
  "src/shop/payments/gateway.py": "class Gateway:\n    pass\n",
  "tests/test_cart.py": "from shop.cart import Cart\nimport shop.missing\nimport pytest\n\ndef test_total():\n    assert Cart().total() == 0\n",
};

test("Python imports become edges with the statement that proves each", () => {
  const output = analyse(SHOP);
  assert.deepEqual(edgesOf(output), [
    "src/shop/__init__.py -> src/shop/cart.py",
    "src/shop/cart.py -> src/shop/payments/__init__.py",
    "src/shop/cart.py -> src/shop/payments/gateway.py",
    "src/shop/cart.py -> src/shop/pricing.py",
    "tests/test_cart.py -> src/shop/cart.py",
  ]);
  const gateway = output.edges.find((edge) => edge.target === "src/shop/payments/gateway.py");
  assert.deepEqual(
    gateway?.evidence.map((piece) => [piece.kind, piece.specifier, piece.line, piece.typeOnly, piece.via]),
    [
      ["from-import", ".payments.gateway", 6, false, "relative"],
      ["from-import", "shop.payments.gateway", 8, true, "source-root"],
    ],
  );
  const pricing = output.edges.find((edge) => edge.target === "src/shop/pricing.py");
  assert.deepEqual(
    pricing?.evidence.map((piece) => [piece.kind, piece.specifier, piece.line]),
    [
      ["from-import", ".pricing", 5],
      ["dynamic-import", "shop.pricing", 13],
    ],
  );
});

test("standard-library, third-party, missing and runtime-named modules are never edges", () => {
  const output = analyse(SHOP);
  assert.deepEqual(unlinkedOf(output), [
    "src/shop/cart.py:2 typing external:builtin",
    "src/shop/cart.py:3 os external:builtin",
    "src/shop/cart.py:4 requests external:package",
    "src/shop/cart.py:12 importlib external:builtin",
    "src/shop/cart.py:14 (expression) unresolved:non-literal-specifier",
    "tests/test_cart.py:2 shop.missing unresolved:file-not-found",
    "tests/test_cart.py:3 pytest external:package",
  ]);
});

test("an import used only for type checking is a type-only edge", () => {
  const output = analyse({
    "app/__init__.py": "",
    "app/models.py": "class User:\n    pass\n",
    "app/views.py": "import typing\nif typing.TYPE_CHECKING:\n    from app.models import User\nelse:\n    import app.helpers\n",
    "app/helpers.py": "",
  });
  assert.deepEqual(edgesOf(output), ["app/views.py -> app/helpers.py", "app/views.py -> app/models.py (types)"]);
});

test("Python tests and stubs get roles from their names", () => {
  const output = analyse({
    "pkg/__init__.py": "",
    "pkg/core.py": "",
    "pkg/core.pyi": "",
    "tests/test_core.py": "",
    "tests/core_test.py": "",
    "tests/helpers.py": "",
  });
  const roles = Object.fromEntries(output.files.map((file) => [file.path, file.role.id]));
  assert.deepEqual(roles, {
    "pkg/__init__.py": "other",
    "pkg/core.py": "other",
    "pkg/core.pyi": "declaration",
    "tests/core_test.py": "test",
    "tests/helpers.py": "other",
    "tests/test_core.py": "test",
  });
});

test("a file that fails to parse is the only one affected", () => {
  const output = analyse({
    "app/broken.py": "def broken(:\n    pass\n",
    "app/ok.py": "from app import broken\nimport app.helper\n",
    "app/helper.py": "VALUE = 1\n",
  });
  const broken = output.files.find((file) => file.path === "app/broken.py");
  assert.equal(broken?.parseStatus, "failed");
  assert.equal(broken?.parseErrors[0]?.line, 1);
  assert.deepEqual(
    output.files.filter((file) => file.parseStatus === "parsed").map((file) => file.path),
    ["app/helper.py", "app/ok.py"],
  );
  // Edges into the broken file survive; none are read out of it.
  assert.deepEqual(edgesOf(output), ["app/ok.py -> app/broken.py", "app/ok.py -> app/helper.py"]);
});

test("relative imports cannot climb out of the repository", () => {
  const output = analyse({ "top.py": "from .. import anything\n" });
  assert.deepEqual(unlinkedOf(output), ["top.py:1 .. unresolved:file-not-found"]);
});

test("a mixed repository is one graph, with no edge between languages it does not state", () => {
  const output = analyse({
    "package.json": JSON.stringify({ name: "web", dependencies: { react: "1" } }),
    "web/app.tsx": 'import { api } from "./api";\nexport default function App() { return <main>{api}</main>; }\n',
    "web/api.ts": "export const api = '/api';\n",
    "service/__init__.py": "",
    "service/api.py": "from service import db\n",
    "service/db.py": "",
    "tools/release.rb": "puts 1\n",
  });
  assert.deepEqual(edgesOf(output), [
    "service/api.py -> service/db.py",
    "web/app.tsx -> web/api.ts",
  ]);
  assert.deepEqual(
    output.files.map((file) => `${file.path}:${file.language}`),
    [
      "service/__init__.py:python",
      "service/api.py:python",
      "service/db.py:python",
      "web/api.ts:typescript",
      "web/app.tsx:typescript",
    ],
  );
  // The framework adapter reads only the JavaScript side.
  assert.equal(output.adapter, "react");
  assert.equal(output.files.find((file) => file.path === "web/app.tsx")?.role.id, "component");
  // A language that is only detected is excluded, never parsed or guessed at.
  assert.deepEqual(
    output.excluded.filter((entry) => entry.path === "tools/release.rb"),
    [{ path: "tools/release.rb", type: "file", rule: "unsupported-file-type" }],
  );
  assert.deepEqual(describeLanguage("tools/release.rb"), { label: "Ruby", capability: "detected" });
});

test("the same repository always gives the same output", () => {
  assert.equal(JSON.stringify(analyse(SHOP)), JSON.stringify(analyse(SHOP)));
});

test("a stored version 2 graph is still read", () => {
  const output = analyse({ "a.ts": 'import "./b";\n', "b.ts": "" });
  const stored = readParserOutput({ ...JSON.parse(JSON.stringify(output)), schemaVersion: 2 });
  assert.equal(stored.schemaVersion, 3);
  assert.throws(() => readParserOutput({ ...JSON.parse(JSON.stringify(output)), schemaVersion: 1 }));
});
