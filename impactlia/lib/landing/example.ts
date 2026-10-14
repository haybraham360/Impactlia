// The one made-up Pull Request the landing page draws, in the hero map, the
// workflow steps and the report preview. It is an illustration, not parser
// output: every number shown on the page is counted from this file so the
// pictures cannot disagree with each other.

export type FileState = "changed" | "affected" | "unreached";

export type ExampleFile = {
  // Repository-relative path, as in the parser contract.
  id: string;
  name: string;
  state: FileState;
  // Imports between this file and the nearest changed file.
  steps: number | null;
  reason: string;
};

export const examplePullRequest = {
  number: 128,
  title: "Update payment flow",
  head: "payment-rounding",
  base: "main",
};

// The hero map builds itself one step at a time, from the changed files
// outwards. Defined here rather than beside the map so the server-rendered
// parts of the hero can time themselves against it.
export const MAP_STEP_MS = 300;
// From the map's first file to its last label.
export const MAP_BUILD_MS = 7 * MAP_STEP_MS;

export const exampleFiles: ExampleFile[] = [
  {
    id: "src/payments/payment.ts",
    name: "payment.ts",
    state: "changed",
    steps: 0,
    reason: "Edited in this Pull Request.",
  },
  {
    id: "src/payments/currency.ts",
    name: "currency.ts",
    state: "changed",
    steps: 0,
    reason: "Edited in this Pull Request.",
  },
  {
    id: "src/checkout/checkout.ts",
    name: "checkout.ts",
    state: "affected",
    steps: 1,
    reason: "Imports payment.ts.",
  },
  {
    id: "src/billing/invoice.ts",
    name: "invoice.ts",
    state: "affected",
    steps: 1,
    reason: "Imports payment.ts and currency.ts.",
  },
  {
    id: "src/payments/refund.ts",
    name: "refund.ts",
    state: "affected",
    steps: 1,
    reason: "Imports payment.ts.",
  },
  {
    id: "src/api/orders.ts",
    name: "orders.ts",
    state: "affected",
    steps: 2,
    reason: "Imports checkout.ts, which imports payment.ts.",
  },
  {
    id: "src/emails/receipt.ts",
    name: "receipt.ts",
    state: "affected",
    steps: 2,
    reason: "Imports invoice.ts, which imports both changed files.",
  },
  {
    id: "src/auth/session.ts",
    name: "session.ts",
    state: "unreached",
    steps: null,
    reason: "No import path leads here from the changed files.",
  },
];

// Same direction as the parser's edges: the source imports the target.
export const exampleEdges: { source: string; target: string }[] = [
  { source: "src/checkout/checkout.ts", target: "src/payments/payment.ts" },
  { source: "src/billing/invoice.ts", target: "src/payments/payment.ts" },
  { source: "src/billing/invoice.ts", target: "src/payments/currency.ts" },
  { source: "src/payments/refund.ts", target: "src/payments/payment.ts" },
  { source: "src/api/orders.ts", target: "src/checkout/checkout.ts" },
  { source: "src/emails/receipt.ts", target: "src/billing/invoice.ts" },
];

export const stateLabel: Record<FileState, string> = {
  changed: "Changed",
  affected: "Potentially affected",
  unreached: "Not reached",
};

export const changedFiles = exampleFiles.filter((file) => file.state === "changed");
export const affectedFiles = exampleFiles.filter((file) => file.state === "affected");

// The file where the example's two changes meet.
export const REVIEW_FOCUS = "src/billing/invoice.ts";

function walk(start: string, next: (id: string) => string[]): string[] {
  const seen = new Set<string>();
  const queue = [start];
  for (const id of queue) {
    for (const neighbour of next(id)) {
      if (!seen.has(neighbour)) {
        seen.add(neighbour);
        queue.push(neighbour);
      }
    }
  }
  return [...seen];
}

// A file plus everything on a path through it: what it imports, back to the
// changed files, and what imports it. This is what lights up on hover.
export function connectedTo(id: string): ReadonlySet<string> {
  const imports = walk(id, (file) =>
    exampleEdges.filter((edge) => edge.source === file).map((edge) => edge.target),
  );
  const importers = walk(id, (file) =>
    exampleEdges.filter((edge) => edge.target === file).map((edge) => edge.source),
  );
  return new Set([id, ...imports, ...importers]);
}

// The files a given file imports directly, in the order the example lists them.
export function importsOf(id: string): ExampleFile[] {
  const targets = new Set(
    exampleEdges.filter((edge) => edge.source === id).map((edge) => edge.target),
  );
  return exampleFiles.filter((file) => targets.has(file.id));
}

// Every import path from the changed files out to the given file, as rows:
// the changed files first, the given file last, and each row imported by the
// row after it. Rows rather than one path, because a file that imports both
// changed files has to show both.
export function layersFromChange(id: string): ExampleFile[][] {
  const layers: ExampleFile[][] = [];
  const seen = new Set<string>();
  let current = exampleFiles.filter((file) => file.id === id);
  while (current.length > 0) {
    layers.unshift(current);
    for (const file of current) seen.add(file.id);
    const next = new Set(current.flatMap((file) => importsOf(file.id)).map((file) => file.id));
    current = exampleFiles.filter((file) => next.has(file.id) && !seen.has(file.id));
  }
  return layers;
}

// What the example's diff says about each changed file. GitHub reports these
// counts; Impactlia's analysis uses only the paths and statuses.
export const exampleDiff: Record<string, { added: number; removed: number; status: string }> = {
  "src/payments/payment.ts": { added: 42, removed: 17, status: "Modified" },
  "src/payments/currency.ts": { added: 6, removed: 2, status: "Modified" },
};

export type Reached = {
  file: ExampleFile;
  // Imports between this file and the changed file it was reached from.
  steps: number;
  // From the reached file back to the changed file, each one importing the next.
  path: ExampleFile[];
};

// Everything that imports one changed file, directly or through other files,
// nearest first. Breadth-first, so each file keeps its shortest path.
export function reachFrom(changedId: string): Reached[] {
  const byId = new Map(exampleFiles.map((file) => [file.id, file]));
  const parent = new Map<string, string>();
  const depth = new Map<string, number>([[changedId, 0]]);
  const queue = [changedId];
  for (const id of queue) {
    for (const edge of exampleEdges) {
      if (edge.target === id && !depth.has(edge.source)) {
        depth.set(edge.source, (depth.get(id) ?? 0) + 1);
        parent.set(edge.source, id);
        queue.push(edge.source);
      }
    }
  }
  return queue.slice(1).flatMap((id) => {
    const file = byId.get(id);
    if (!file) return [];
    const path: ExampleFile[] = [];
    for (let at: string | undefined = id; at !== undefined; at = parent.get(at)) {
      const step = byId.get(at);
      if (step) path.push(step);
    }
    return [{ file, steps: depth.get(id) ?? 0, path }];
  });
}
