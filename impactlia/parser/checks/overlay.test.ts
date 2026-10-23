import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { before, test } from "node:test";
import { frameworkAdapters } from "../adapters";
import type { ParserOutput } from "../contract";
import { OverlayUnsupported } from "../languages/adapter";
import { loadGrammars, type Grammars } from "../languages/tree-sitter";
import { parseRepository } from "../parse-repository";
import { readParserOutput } from "../validate";

// Run with `pnpm check:adapters`. Updating a stored graph has one rule: the
// result is exactly what a full parse of the new commit gives. Each case
// below parses commit A in full, changes it into commit B, and compares a
// full parse of B with an update of A's graph that reads only B's changed
// files. Every unchanged file is written empty for the update, so a
// difference would show if it were read.

// The parser's grammars load asynchronously, once, before any test.
let grammars: Grammars;
before(async () => {
  grammars = await loadGrammars();
});

type Files = Record<string, string>;

// The project files resolvers read: these keep their contents in the
// partial copy, as the selective path downloads them.
const PROJECT_FILE = /(^|\/)(package\.json|[jt]sconfig[\w.-]*\.json|go\.mod|Cargo\.toml|composer\.json|pyproject\.toml|setup\.cfg)$/;

function write(files: Files, blank: (file: string) => boolean = () => false): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "impactlia-overlay-"));
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(directory, file)), { recursive: true });
    fs.writeFileSync(path.join(directory, file), blank(file) ? "" : content);
  }
  return directory;
}

function parse(directory: string, overlay?: { base: ParserOutput; changed: Set<string> }): ParserOutput {
  try {
    return readParserOutput(JSON.parse(JSON.stringify(parseRepository(directory, grammars, frameworkAdapters, { overlay }))));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

// The files of B that are new or different from A: what GitHub's compare
// would list and the selective path would download.
const changedBetween = (a: Files, b: Files) =>
  new Set(Object.keys(b).filter((file) => a[file] !== b[file] && !PROJECT_FILE.test(file)));

function assertSame(a: Files, b: Files): void {
  const base = parse(write(a));
  const changed = changedBetween(a, b);
  const full = parse(write(b));
  const updated = parse(write(b, (file) => !changed.has(file) && !PROJECT_FILE.test(file)), { base, changed });
  assert.deepEqual(updated, full);
}

test("TypeScript: a new file that changes what an unchanged import names, and a removed one", () => {
  const a: Files = {
    "package.json": JSON.stringify({ name: "app" }),
    "tsconfig.json": JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } } }),
    "src/index.ts": 'import { util } from "./util";\nimport { gone } from "@/gone";\nexport const run = () => util + gone;\n',
    "src/util/index.ts": "export const util = 1;\n",
    "src/gone.ts": "export const gone = 1;\n",
    "src/other.ts": 'import "./index";\n',
    "src/broken.ts": "export const = ;\n",
  };
  const b: Files = { ...a, "src/util.ts": "export const util = 2;\n", "src/other.ts": 'import "./index";\nimport "./util";\n' };
  delete b["src/gone.ts"];
  assertSame(a, b);
});

test("Python, Go, Rust and C: added, changed and removed files in each", () => {
  const a: Files = {
    "py/pkg/__init__.py": "",
    "py/pkg/core.py": "from . import helpers\nimport os\n",
    "py/pkg/helpers.py": "",
    "go.mod": "module example.com/m\n",
    "go/cart/cart.go": "package cart\n",
    "go/cart/cart_test.go": "package cart\n",
    "go/main.go": 'package main\nimport "example.com/m/go/cart"\n',
    "Cargo.toml": '[package]\nname = "core"\n',
    "src/lib.rs": "mod a;\nmod inline { mod nested; }\n",
    "src/a.rs": "use crate::b::Thing;\n",
    "src/inline/nested.rs": "",
    "c/main.c": '#include "util.h"\n#include <stdio.h>\n',
    "c/include/util.h": "",
  };
  const b: Files = {
    ...a,
    "py/pkg/new.py": "from .helpers import x\n",
    "py/pkg/core.py": "from . import helpers, new\n",
    "go/cart/price.go": "package cart\n",
    "src/b.rs": "pub struct Thing;\n",
    "src/lib.rs": "mod a;\nmod b;\nmod inline { mod nested; }\n",
    "c/util.h": "",
  };
  delete b["py/pkg/helpers.py"];
  assertSame(a, b);
});

test("a framework's roles and routes of unchanged files are kept, and changed files get new ones", () => {
  const a: Files = {
    "package.json": JSON.stringify({ name: "web", dependencies: { next: "15" } }),
    "app/page.tsx": "export default function Page() { return null; }\n",
    "app/about/page.tsx": "export default function About() { return null; }\n",
    "app/api/route.ts": "export async function GET() {}\n",
    "lib/data.ts": "export const data = 1;\n",
  };
  const b: Files = {
    ...a,
    "app/api/route.ts": "export async function GET() {}\nexport async function POST() {}\n",
    "app/blog/page.tsx": 'import { data } from "../../lib/data";\nexport default function Blog() { return data; }\n',
  };
  assertSame(a, b);
});

test("Java's references stand while no Java file changes, and an update is refused when one does", () => {
  const a: Files = {
    "java/a/A.java": "package a;\nclass A { B b; }\n",
    "java/a/B.java": "package a;\nclass B {}\n",
    "web/index.ts": 'import "./x";\n',
    "web/x.ts": "",
    "gen/types.ts": "// @generated\nexport type T = 1;\n",
  };
  assertSame(a, { ...a, "web/y.ts": 'import "./x";\n' });

  const changed: Files = { ...a, "java/a/B.java": "package a;\nclass C {}\n" };
  const base = parse(write(a));
  assert.throws(
    () => parse(write(changed), { base, changed: changedBetween(a, changed) }),
    (error) => error instanceof OverlayUnsupported && /Java files were added, changed or removed/.test(error.message),
  );
});

test("an update is refused when the framework's configuration was not read", () => {
  const a: Files = {
    "package.json": JSON.stringify({ name: "web", dependencies: { next: "15" } }),
    "next.config.js": "module.exports = {};\n",
    "app/page.tsx": "export default function Page() { return null; }\n",
  };
  const b: Files = { ...a, "app/page.tsx": "export default function Page() { return 1; }\n" };
  const base = parse(write(a));
  assert.throws(
    () => parse(write(b), { base, changed: changedBetween(a, b) }),
    (error) => error instanceof OverlayUnsupported && /next\.config\.js configures the framework/.test(error.message),
  );
  // With it read, the update matches a full parse.
  const full = parse(write(b));
  const changed = new Set([...changedBetween(a, b), "next.config.js"]);
  assert.deepEqual(parse(write(b, (file) => !changed.has(file) && !PROJECT_FILE.test(file)), { base, changed }), full);
});
