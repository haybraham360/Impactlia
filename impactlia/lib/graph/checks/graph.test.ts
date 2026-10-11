import assert from "node:assert/strict";
import { test } from "node:test";
import {
  HIGH_FAN_IN_DEPENDENTS,
  LARGE_FILE_LINES,
  filesIn,
  findInsights,
} from "../insights";
import { DEFAULT_DEPTH, MAX_DEPTH, indexEdges, traverse, type Traversal } from "../traverse";
import { edges, features, files } from "./fixture";

// Run with `pnpm check:graph`. Every expected value below can be confirmed by
// reading fixture.ts.

const index = indexEdges(edges);
const edgeSet = new Set(edges.map((edge) => `${edge.source} -> ${edge.target}`));
const reachedAt = (traversal: Traversal, depth: number) =>
  traversal.reached.filter((entry) => entry.depth === depth).map((entry) => entry.file);

test("blast radius follows edges from an imported file to its importers", () => {
  const result = traverse(index, ["lib/format.ts"], "dependents");
  assert.equal(result.depth, DEFAULT_DEPTH);
  assert.equal(DEFAULT_DEPTH, 2);
  assert.deepEqual(reachedAt(result, 1), [
    "app/page.tsx",
    "components/header.tsx",
    "lib/format.test.ts",
  ]);
  // app/page.tsx also imports header.tsx, but it was already reached directly.
  assert.deepEqual(reachedAt(result, 2), []);
  assert.equal(result.more, false);
});

test("dependency chain follows the same edges the other way", () => {
  const result = traverse(index, ["app/page.tsx"], "dependencies");
  assert.deepEqual(reachedAt(result, 1), ["components/header.tsx", "lib/format.ts"]);
  assert.deepEqual(reachedAt(result, 2), ["components/button.tsx", "lib/core.ts"]);
  // lib/theme.ts is three imports away.
  assert.equal(result.more, true);
  assert.deepEqual(traverse(index, ["app/page.tsx"], "dependents").reached, []);
});

test("every step of every reported path is an edge in the graph", () => {
  for (const direction of ["dependents", "dependencies"] as const) {
    for (const file of files) {
      for (const entry of traverse(index, [file.id], direction, MAX_DEPTH).reached) {
        assert.equal(entry.path.length, entry.depth + 1);
        assert.equal(entry.path[0], file.id);
        assert.equal(entry.path[entry.path.length - 1], entry.file);
        for (let step = 1; step < entry.path.length; step += 1) {
          const [near, far] = [entry.path[step - 1], entry.path[step]];
          const edge = direction === "dependents" ? `${far} -> ${near}` : `${near} -> ${far}`;
          assert.ok(edgeSet.has(edge), `${edge} is not an edge`);
        }
        for (const near of entry.via) {
          const edge =
            direction === "dependents" ? `${entry.file} -> ${near}` : `${near} -> ${entry.file}`;
          assert.ok(edgeSet.has(edge), `${edge} is not an edge`);
        }
      }
    }
  }
});

test("depth limits the result and deeper levels only add files", () => {
  const one = traverse(index, ["lib/theme.ts"], "dependents", 1);
  const two = traverse(index, ["lib/theme.ts"], "dependents", 2);
  const three = traverse(index, ["lib/theme.ts"], "dependents", 3);
  assert.deepEqual(one.reached.map((entry) => entry.file), ["components/button.tsx"]);
  assert.deepEqual(two.reached.map((entry) => entry.file), [
    "components/button.tsx",
    "components/header.tsx",
  ]);
  assert.deepEqual(three.reached.map((entry) => entry.file), [
    "components/button.tsx",
    "components/header.tsx",
    "app/page.tsx",
  ]);
  assert.deepEqual(three.reached[2].path, [
    "lib/theme.ts",
    "components/button.tsx",
    "components/header.tsx",
    "app/page.tsx",
  ]);
  assert.deepEqual([one.more, two.more, three.more], [true, true, false]);
  assert.throws(() => traverse(index, ["lib/theme.ts"], "dependents", 0));
  assert.throws(() => traverse(index, ["lib/theme.ts"], "dependents", MAX_DEPTH + 1));
});

test("a file reached by several routes or from several starts appears once", () => {
  // lib/core.ts is reached from page.tsx only through format.ts; format.ts is
  // imported by both page.tsx and header.tsx.
  const single = traverse(index, ["app/page.tsx"], "dependencies", 3);
  assert.equal(new Set(single.reached.map((entry) => entry.file)).size, single.reached.length);

  const combined = traverse(index, ["lib/theme.ts", "lib/format.ts"], "dependents", 3);
  const names = combined.reached.map((entry) => entry.file);
  assert.equal(new Set(names).size, names.length);
  // header.tsx and page.tsx are in both files' blast radius. Each is listed
  // once, at its nearest distance.
  assert.deepEqual(reachedAt(combined, 1), [
    "app/page.tsx",
    "components/button.tsx",
    "components/header.tsx",
    "lib/format.test.ts",
  ]);
  assert.deepEqual(reachedAt(combined, 2), []);
  // A starting file is never reported as affected by itself or another start.
  assert.ok(!names.includes("lib/theme.ts") && !names.includes("lib/format.ts"));
});

test("every shortest route is kept in via", () => {
  // lib/format.ts is imported by both starting files.
  const result = traverse(index, ["components/header.tsx", "app/page.tsx"], "dependencies", 1);
  const format = result.reached.find((entry) => entry.file === "lib/format.ts");
  assert.deepEqual(format?.via, ["app/page.tsx", "components/header.tsx"]);
  assert.deepEqual(format?.path, ["app/page.tsx", "lib/format.ts"]);
  const chain = traverse(index, ["lib/core.ts"], "dependents", 2);
  const b = chain.reached.find((entry) => entry.file === "lib/b.ts");
  assert.deepEqual(b?.path, ["lib/core.ts", "lib/c.ts", "lib/b.ts"]);
  assert.deepEqual(b?.via, ["lib/c.ts"]);
});

test("the same input gives the same output whatever order the edges arrive in", () => {
  const shuffled = indexEdges([...edges].reverse());
  for (const direction of ["dependents", "dependencies"] as const) {
    assert.deepEqual(
      traverse(shuffled, ["lib/core.ts", "lib/a.ts"], direction, 4),
      traverse(index, ["lib/a.ts", "lib/core.ts"], direction, 4),
    );
  }
  assert.deepEqual(
    findInsights([...files].reverse(), shuffled),
    findInsights(files, index),
  );
});

test("the import cycle is found and its loop is made of real edges", () => {
  const { cycles } = findInsights(files, index);
  assert.deepEqual(cycles, [
    {
      files: ["lib/a.ts", "lib/b.ts", "lib/c.ts"],
      loop: ["lib/a.ts", "lib/b.ts", "lib/c.ts", "lib/a.ts"],
    },
  ]);
  for (let step = 1; step < cycles[0].loop.length; step += 1) {
    assert.ok(edgeSet.has(`${cycles[0].loop[step - 1]} -> ${cycles[0].loop[step]}`));
  }
});

test("a file that imports itself is a cycle of one", () => {
  const self = [{ source: "x.ts", target: "x.ts" }];
  const { cycles } = findInsights([{ id: "x.ts", path: "x.ts", lineCount: 1 }], indexEdges(self));
  assert.deepEqual(cycles, [{ files: ["x.ts"], loop: ["x.ts", "x.ts"] }]);
});

test("a chain far longer than the call stack does not overflow", () => {
  const length = 200_000;
  const name = (n: number) => `f${n}.ts`;
  const chain = Array.from({ length }, (_, n) => ({ source: name(n), target: name((n + 1) % length) }));
  const nodes = Array.from({ length }, (_, n) => ({ id: name(n), path: name(n), lineCount: 1 }));
  const { cycles } = findInsights(nodes, indexEdges(chain));
  assert.equal(cycles.length, 1);
  assert.equal(cycles[0].files.length, length);
  assert.equal(cycles[0].loop.length, length + 1);
});

test("files with no incoming imports, with convention-loaded files kept apart", () => {
  const insights = findInsights(files, index);
  // lib/a.ts is imported by lib/c.ts, so nothing in the cycle is listed.
  assert.deepEqual(insights.noIncoming, [...features, "lib/orphan.ts"]);
  assert.deepEqual(insights.conventionLoaded, [
    { convention: "Test files (*.test.*, *.spec.*, __tests__/)", files: ["lib/format.test.ts"] },
    { convention: "Type declaration files (*.d.ts)", files: ["types/global.d.ts"] },
    { convention: "Tool configuration files (*.config.*)", files: ["next.config.ts"] },
    {
      convention: "Next.js App Router files (page, layout, route and similar under app/)",
      files: ["app/page.tsx"],
    },
    { convention: "Scripts (files under a scripts/ directory)", files: ["scripts/seed.ts"] },
  ]);
});

test("highly depended-on files meet the documented threshold", () => {
  assert.equal(HIGH_FAN_IN_DEPENDENTS, 10);
  // format.ts, c.ts, seed.ts and the ten features import lib/core.ts.
  assert.deepEqual(findInsights(files, index).highFanIn, [{ file: "lib/core.ts", dependents: 13 }]);
  const importers = (count: number) =>
    indexEdges(Array.from({ length: count }, (_, n) => ({ source: `i${n}.ts`, target: "hub.ts" })));
  const hub = [{ id: "hub.ts", path: "hub.ts", lineCount: 1 }];
  assert.deepEqual(findInsights(hub, importers(9)).highFanIn, []);
  assert.deepEqual(findInsights(hub, importers(10)).highFanIn, [{ file: "hub.ts", dependents: 10 }]);
});

test("large files exceed the documented line count", () => {
  assert.equal(LARGE_FILE_LINES, 500);
  // lib/format.ts has exactly 500 lines and is not listed.
  assert.deepEqual(findInsights(files, index).large, [
    { file: "lib/orphan.ts", lines: 1200 },
    { file: "lib/core.ts", lines: 501 },
  ]);
});

test("a category's file list is what its count is taken from", () => {
  const insights = findInsights(files, index);
  assert.deepEqual(filesIn(insights, "cycles"), ["lib/a.ts", "lib/b.ts", "lib/c.ts"]);
  assert.equal(filesIn(insights, "no-incoming").length, 11);
  assert.deepEqual(filesIn(insights, "high-fan-in"), ["lib/core.ts"]);
  assert.deepEqual(filesIn(insights, "large"), ["lib/orphan.ts", "lib/core.ts"]);
});

test("a graph with no edges has no findings that need edges", () => {
  const empty = indexEdges([]);
  assert.deepEqual(traverse(empty, ["lib/orphan.ts"], "dependents").reached, []);
  const insights = findInsights([{ id: "a.ts", path: "a.ts", lineCount: 3 }], empty);
  assert.deepEqual(insights.cycles, []);
  assert.deepEqual(insights.highFanIn, []);
  assert.deepEqual(insights.noIncoming, ["a.ts"]);
});
