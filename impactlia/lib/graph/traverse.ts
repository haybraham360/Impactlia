// Walks the dependency graph outwards from one or more files. Pure and
// self-contained: it takes edges and file ids and nothing else, so it runs
// the same in the browser, on the server and in the terminal check.
//
// Edge direction, stated once for everything built on this file: an edge's
// `source` is the file that contains the import, and its `target` is the file
// being imported. So `source` depends on `target`, and a change to `target`
// may affect `source`.

export type TraversalEdge = { source: string; target: string };

// "dependents" walks edges backwards, from an imported file to the files that
// import it: the blast radius. "dependencies" walks them forwards, from a file
// to what it imports: the dependency chain.
export type TraversalDirection = "dependents" | "dependencies";

export const DEFAULT_DEPTH = 2;
// Deep enough to follow a real chain, shallow enough that the answer is still
// about the starting file rather than about the whole repository.
export const MAX_DEPTH = 8;

export type GraphIndex = {
  // For each file, the files that import it.
  dependents: ReadonlyMap<string, readonly string[]>;
  // For each file, the files it imports.
  dependencies: ReadonlyMap<string, readonly string[]>;
  // Files that import themselves. Kept out of the two maps above, where a
  // file is never its own neighbour.
  selfImports: readonly string[];
};

export type ReachedFile = {
  file: string;
  // The fewest edges between this file and any starting file.
  depth: number;
  // One shortest chain of real edges, from a starting file to this one. Each
  // neighbouring pair is an edge in the graph.
  path: string[];
  // Every file one level closer that has an edge to this one, so every
  // shortest route can be checked, not only the one in `path`.
  via: string[];
};

export type Traversal = {
  direction: TraversalDirection;
  starts: string[];
  depth: number;
  // Nearest first, then in code-point order. Never includes a starting file.
  reached: ReachedFile[];
  // True when files exist beyond `depth` that this traversal did not follow.
  more: boolean;
};

// Plain code-point order, so the result does not depend on locale.
export function byText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// Built once per graph. Neighbour lists are sorted so that every walk over
// them visits files in the same order whatever order the edges arrived in.
export function indexEdges(edges: readonly TraversalEdge[]): GraphIndex {
  const dependents = new Map<string, string[]>();
  const dependencies = new Map<string, string[]>();
  const selfImports = new Set<string>();
  const add = (map: Map<string, string[]>, key: string, value: string) => {
    const list = map.get(key);
    if (list) list.push(value);
    else map.set(key, [value]);
  };
  const seen = new Set<string>();
  for (const { source, target } of edges) {
    if (source === target) {
      selfImports.add(source);
      continue;
    }
    const key = `${source}\n${target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    add(dependents, target, source);
    add(dependencies, source, target);
  }
  for (const list of dependents.values()) list.sort(byText);
  for (const list of dependencies.values()) list.sort(byText);
  return { dependents, dependencies, selfImports: [...selfImports].sort(byText) };
}

// Breadth-first, one level at a time, so the first time a file is reached is
// by a shortest route and its depth is final. A file reached from several
// starting files, or by several routes, appears once.
export function traverse(
  index: GraphIndex,
  starts: readonly string[],
  direction: TraversalDirection,
  depth: number = DEFAULT_DEPTH,
): Traversal {
  if (!Number.isInteger(depth) || depth < 1 || depth > MAX_DEPTH) {
    throw new Error(`Traversal depth must be a whole number from 1 to ${MAX_DEPTH}, not ${depth}.`);
  }
  const next = index[direction];
  const origin = [...new Set(starts)].sort(byText);
  const found = new Map<string, ReachedFile>();
  const visited = new Set(origin);
  const pathOf = (file: string) => found.get(file)?.path ?? [file];

  let level = origin;
  for (let distance = 1; distance <= depth && level.length > 0; distance += 1) {
    const reachedHere: string[] = [];
    // `level` is sorted, so the first file to reach another is the smallest
    // one that can, and `via` fills in sorted order.
    for (const from of level) {
      for (const to of next.get(from) ?? []) {
        const known = found.get(to);
        if (known) {
          if (known.depth === distance) known.via.push(from);
        } else if (!visited.has(to)) {
          visited.add(to);
          found.set(to, { file: to, depth: distance, path: [...pathOf(from), to], via: [from] });
          reachedHere.push(to);
        }
      }
    }
    level = reachedHere.sort(byText);
  }

  return {
    direction,
    starts: origin,
    depth,
    // Insertion order is by level, and each level was only sorted after its
    // files were inserted, so the order is settled here.
    reached: [...found.values()].sort((a, b) => a.depth - b.depth || byText(a.file, b.file)),
    more: level.some((file) => (next.get(file) ?? []).some((other) => !visited.has(other))),
  };
}
