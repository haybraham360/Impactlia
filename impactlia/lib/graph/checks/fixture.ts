import type { InsightFile } from "../insights";
import type { TraversalEdge } from "../traverse";

// A small repository written out by hand, so every expected answer in
// graph.test.ts can be confirmed by reading this file. An edge is
// [importer, imported]: the left file contains the import of the right one.
//
//   app/page.tsx ──▶ components/header.tsx ──▶ components/button.tsx ──▶ lib/theme.ts
//        │                    │
//        └──────▶ lib/format.ts ◀──┘ ──▶ lib/core.ts
//
//   lib/a.ts ──▶ lib/b.ts ──▶ lib/c.ts ──▶ lib/a.ts      (a real cycle)
//   lib/c.ts ──▶ lib/core.ts
//
// lib/core.ts is also imported by ten features/*.ts files and scripts/seed.ts.

const FEATURES = Array.from(
  { length: 10 },
  (_, index) => `features/f${String(index + 1).padStart(2, "0")}.ts`,
);

const pairs: [string, string][] = [
  ["app/page.tsx", "components/header.tsx"],
  ["app/page.tsx", "lib/format.ts"],
  ["components/header.tsx", "components/button.tsx"],
  ["components/header.tsx", "lib/format.ts"],
  ["components/button.tsx", "lib/theme.ts"],
  ["lib/format.ts", "lib/core.ts"],
  ["lib/format.test.ts", "lib/format.ts"],
  ["lib/a.ts", "lib/b.ts"],
  ["lib/b.ts", "lib/c.ts"],
  ["lib/c.ts", "lib/a.ts"],
  ["lib/c.ts", "lib/core.ts"],
  ["scripts/seed.ts", "lib/core.ts"],
  ...FEATURES.map((feature): [string, string] => [feature, "lib/core.ts"]),
];

export const edges: TraversalEdge[] = pairs.map(([source, target]) => ({ source, target }));

// Line counts sit either side of the large-file threshold on purpose.
const lineCounts: Record<string, number> = {
  "lib/core.ts": 501,
  "lib/format.ts": 500,
  "lib/orphan.ts": 1200,
};

const paths = [
  ...new Set([...pairs.flat(), "lib/orphan.ts", "next.config.ts", "types/global.d.ts"]),
];

export const files: InsightFile[] = paths.map((path) => ({
  id: path,
  path,
  lineCount: lineCounts[path] ?? 40,
}));

export const features = FEATURES;
