import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { frameworkAdapters } from "../../../parser/adapters";
import type { ParserOutput } from "../../../parser/contract";
import { loadGrammars, type Grammars } from "../../../parser/languages/tree-sitter";
import { parseRepository } from "../../../parser/parse-repository";
import { readParserOutput } from "../../../parser/validate";
import { BUDGETS } from "../budgets";
import { buildSelectively } from "../selective";

// Run with `pnpm check:ingestion`. GitHub is stood in for by two commits held
// in memory: the comparison and single-file requests are answered from them,
// and every request is recorded, so the test can say what was downloaded.

let grammars: Grammars;
before(async () => {
  grammars = await loadGrammars();
});

type Files = Record<string, string>;
const BASE = "a".repeat(40);
const HEAD = "b".repeat(40);
const repository = { owner: "o", name: "r" };

// A repository just over the size where the selective path is used.
function large(): Files {
  const files: Files = {
    "package.json": JSON.stringify({ name: "big" }),
    "src/index.ts": 'import { a } from "./lib/a";\nexport const run = a;\n',
    "src/lib/a.ts": "export const a = 1;\n",
    "src/lib/a.test.ts": 'import { a } from "./a";\n',
  };
  for (let index = 0; index < BUDGETS.selectiveFromFiles; index += 1) {
    files[`src/many/m${index}.ts`] = index === 0 ? 'import "../lib/a";\n' : "export {};\n";
  }
  return files;
}

function parseFull(files: Files): ParserOutput {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "impactlia-selective-full-"));
  try {
    for (const [file, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(directory, file)), { recursive: true });
      fs.writeFileSync(path.join(directory, file), content);
    }
    return readParserOutput(JSON.parse(JSON.stringify(parseRepository(directory, grammars, frameworkAdapters))));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

const realFetch = globalThis.fetch;
let requested: string[] = [];
function serve(head: Files, comparison: { status: string; files: { filename: string; status: string }[] }): void {
  requested = [];
  globalThis.fetch = async (input: string | URL | Request) => {
    const url = String(input);
    requested.push(url);
    if (url.includes(`/compare/${BASE}...${HEAD}`)) return Response.json(comparison);
    const raw = `https://raw.githubusercontent.com/o/r/${HEAD}/`;
    if (url.startsWith(raw)) {
      const file = decodeURIComponent(url.slice(raw.length));
      return file in head ? new Response(head[file]) : new Response("", { status: 404 });
    }
    return new Response("", { status: 500 });
  };
}
after(() => {
  globalThis.fetch = realFetch;
});

async function run(index: ParserOutput) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "impactlia-selective-"));
  const outcome = await buildSelectively(repository, { output: index, commitSha: BASE }, HEAD, directory, grammars);
  return { outcome, cleanup: () => fs.rmSync(directory, { recursive: true, force: true }) };
}

test("a large repository's graph is updated from what changed, and equals reading it in full", async () => {
  const a = large();
  const b: Files = { ...a, "src/lib/a.ts": "export const a = 2;\n", "src/lib/b.ts": 'import "./a";\n' };
  delete b["src/many/m1.ts"];
  serve(b, {
    status: "ahead",
    files: [
      { filename: "src/lib/a.ts", status: "modified" },
      { filename: "src/lib/b.ts", status: "added" },
      { filename: "src/many/m1.ts", status: "removed" },
    ],
  });
  const { outcome, cleanup } = await run(parseFull(a));
  try {
    assert.equal(outcome.kind, "updated");
    if (outcome.kind !== "updated") return;
    assert.deepEqual(readParserOutput(JSON.parse(JSON.stringify(outcome.graph.output))), parseFull(b));
    // One comparison, then only the changed source files and package.json.
    assert.deepEqual(
      requested.map((url) => url.replace(/^https:\/\/[^/]+\//, "")).sort(),
      [`o/r/${HEAD}/package.json`, `o/r/${HEAD}/src/lib/a.ts`, `o/r/${HEAD}/src/lib/b.ts`, `repos/o/r/compare/${BASE}...${HEAD}?per_page=1`],
    );
    assert.deepEqual([...outcome.graph.readable].sort(), ["package.json", "src/lib/a.ts", "src/lib/b.ts"]);
    // More can be downloaded afterwards, such as a test to read its imports.
    assert.deepEqual(await outcome.graph.fetchMore(["src/lib/a.test.ts", "not/there.ts"]), ["src/lib/a.test.ts"]);
    assert.equal(fs.readFileSync(path.join(outcome.graph.source, "src/lib/a.test.ts"), "utf8"), a["src/lib/a.test.ts"]);
  } finally {
    cleanup();
  }
});

test("the selective path declines, with a reason, whenever its result could differ", async () => {
  const a = large();
  const index = parseFull(a);
  const cases: [string, { status: string; files: { filename: string; status: string }[] }, RegExp][] = [
    ["diverged", { status: "diverged", files: [] }, /not an ancestor of this one/],
    ["a manifest changed", { status: "ahead", files: [{ filename: "package.json", status: "modified" }] }, /package\.json changed/],
    [
      "too many files",
      { status: "ahead", files: Array.from({ length: 300 }, (_, n) => ({ filename: `x${n}.ts`, status: "added" })) },
      /More than 300 files changed/,
    ],
  ];
  for (const [label, comparison, reason] of cases) {
    serve(a, comparison);
    const { outcome, cleanup } = await run(index);
    cleanup();
    assert.equal(outcome.kind, "declined", label);
    if (outcome.kind === "declined") assert.match(outcome.reason, reason, label);
  }
  // A small repository is read in full without asking GitHub anything.
  serve(a, { status: "ahead", files: [] });
  const small = parseFull({ "a.ts": "" });
  const { outcome, cleanup } = await run(small);
  cleanup();
  assert.equal(outcome.kind, "declined");
  assert.deepEqual(requested, []);
});
