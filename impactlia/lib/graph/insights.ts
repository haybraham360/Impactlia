import { byText, type GraphIndex } from "./traverse";

// Structural observations about the repository graph. Each one is counted
// from the files and resolved edges and nothing else. They describe shape:
// none of them says a file is wrong, unused or needs changing.

// A file is "highly depended-on" when at least this many other files import
// it. A fixed number rather than a percentile, so the list can be checked by
// counting and means the same thing in every repository.
export const HIGH_FAN_IN_DEPENDENTS = 10;
// A file is "large" when it has more lines than this.
export const LARGE_FILE_LINES = 500;

export const INSIGHT_CATEGORIES = ["cycles", "no-incoming", "high-fan-in", "large"] as const;
export type InsightCategory = (typeof INSIGHT_CATEGORIES)[number];

export type InsightFile = { id: string; path: string; lineCount: number };

export type ImportCycle = {
  // Every file in the group can reach every other by following imports.
  files: string[];
  // One shortest loop inside the group, starting and ending on its first
  // file. Each neighbouring pair is an edge in the graph: the left file
  // imports the right one.
  loop: string[];
};

export type Insights = {
  cycles: ImportCycle[];
  // Files no other file imports, apart from those matching a convention below.
  noIncoming: string[];
  // Files no other file imports that match a naming convention under which a
  // tool or framework loads the file itself. Reported, not hidden.
  conventionLoaded: { convention: string; files: string[] }[];
  highFanIn: { file: string; dependents: number }[];
  large: { file: string; lines: number }[];
};

// Conventions recognisable from the path alone. A match means "a tool
// normally loads a file with this name", which is why a missing import says
// little about it. The first match names the file.
//
// The Next.js entries are matched by name, not by the parser's framework
// adapter, which this list predates. They are narrow on purpose. A
// middleware-style name counts only at the repository root or in src/, and the
// Pages Router's pages/ directory is left out, because a directory called
// "pages" is not reliable evidence on its own.
const CONVENTIONS: { convention: string; matches: (path: string) => boolean }[] = [
  {
    convention: "Test files (*.test.*, *.spec.*, __tests__/)",
    matches: (path) =>
      /\.(test|spec)\.[cm]?[jt]sx?$/.test(path) || /(^|\/)__tests__\//.test(path),
  },
  {
    convention: "Type declaration files (*.d.ts)",
    matches: (path) => /\.d\.[cm]?ts$/.test(path),
  },
  {
    convention: "Tool configuration files (*.config.*)",
    matches: (path) => /(^|\/)[^/]+\.config\.[cm]?[jt]s$/.test(path),
  },
  {
    convention: "Next.js App Router files (page, layout, route and similar under app/)",
    matches: (path) =>
      /(^|\/)app\/(.*\/)?(page|layout|route|template|default|loading|error|global-error|not-found|forbidden|unauthorized|sitemap|robots|manifest|icon|apple-icon|opengraph-image|twitter-image)\.[jt]sx?$/.test(
        path,
      ),
  },
  {
    convention: "Next.js root files (middleware, proxy, instrumentation)",
    matches: (path) =>
      /^(src\/)?(middleware|proxy|instrumentation|instrumentation-client)\.[jt]s$/.test(path),
  },
  {
    convention: "Scripts (files under a scripts/ directory)",
    matches: (path) => /(^|\/)scripts\//.test(path),
  },
];

// Tarjan's algorithm with its own stack instead of recursion, so a long chain
// of imports cannot overflow the call stack. Returns every strongly connected
// group, including groups of one.
function stronglyConnected(
  nodes: readonly string[],
  next: ReadonlyMap<string, readonly string[]>,
): string[][] {
  const order = new Map<string, number>();
  const lowest = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const groups: string[][] = [];
  const enter = (node: string) => {
    const index = order.size;
    order.set(node, index);
    lowest.set(node, index);
    stack.push(node);
    onStack.add(node);
  };
  const lower = (node: string, value: number) => {
    lowest.set(node, Math.min(lowest.get(node) ?? value, value));
  };

  for (const root of nodes) {
    if (order.has(root)) continue;
    enter(root);
    // `edge` is how many of the node's imports have been followed so far.
    const work = [{ node: root, edge: 0 }];
    for (;;) {
      const frame = work[work.length - 1];
      if (!frame) break;
      const targets = next.get(frame.node) ?? [];
      if (frame.edge < targets.length) {
        const target = targets[frame.edge];
        frame.edge += 1;
        if (!order.has(target)) {
          enter(target);
          work.push({ node: target, edge: 0 });
        } else if (onStack.has(target)) {
          lower(frame.node, order.get(target) ?? 0);
        }
        continue;
      }
      work.pop();
      const low = lowest.get(frame.node) ?? 0;
      const parent = work[work.length - 1];
      if (parent) lower(parent.node, low);
      if (low !== order.get(frame.node)) continue;
      const group: string[] = [];
      for (;;) {
        const member = stack.pop();
        if (member === undefined) break;
        onStack.delete(member);
        group.push(member);
        if (member === frame.node) break;
      }
      groups.push(group);
    }
  }
  return groups;
}

// The shortest way from `start` back to itself without leaving the group,
// found breadth-first. A group is strongly connected, so one always exists.
function shortestLoop(
  start: string,
  group: ReadonlySet<string>,
  next: ReadonlyMap<string, readonly string[]>,
): string[] {
  const cameFrom = new Map<string, string>();
  let level = [start];
  while (level.length > 0) {
    const following: string[] = [];
    for (const from of level) {
      for (const to of next.get(from) ?? []) {
        if (to === start) {
          const loop = [start];
          for (let step: string | undefined = from; step !== undefined && step !== start; ) {
            loop.push(step);
            step = cameFrom.get(step);
          }
          loop.push(start);
          return loop.reverse();
        }
        if (!group.has(to) || cameFrom.has(to)) continue;
        cameFrom.set(to, from);
        following.push(to);
      }
    }
    level = following;
  }
  throw new Error(`${start} is in an import cycle but no loop back to it was found.`);
}

export function findInsights(files: readonly InsightFile[], index: GraphIndex): Insights {
  const ids = files.map((file) => file.id).sort(byText);

  const cycles: ImportCycle[] = stronglyConnected(ids, index.dependencies)
    .filter((group) => group.length > 1)
    .map((group) => {
      const members = group.sort(byText);
      return { files: members, loop: shortestLoop(members[0], new Set(members), index.dependencies) };
    });
  // A file that imports itself is a cycle of one. A self-importing file that
  // is also in a larger group is already reported there.
  const inGroup = new Set(cycles.flatMap((cycle) => cycle.files));
  for (const file of index.selfImports) {
    if (!inGroup.has(file)) cycles.push({ files: [file], loop: [file, file] });
  }
  cycles.sort((a, b) => byText(a.files[0], b.files[0]));

  const noIncoming: string[] = [];
  const byConvention = new Map<string, string[]>();
  for (const file of [...files].sort((a, b) => byText(a.id, b.id))) {
    if ((index.dependents.get(file.id)?.length ?? 0) > 0) continue;
    const match = CONVENTIONS.find((entry) => entry.matches(file.path));
    if (!match) {
      noIncoming.push(file.id);
      continue;
    }
    const list = byConvention.get(match.convention);
    if (list) list.push(file.id);
    else byConvention.set(match.convention, [file.id]);
  }

  return {
    cycles,
    noIncoming,
    // In the order the conventions are declared.
    conventionLoaded: CONVENTIONS.flatMap(({ convention }) => {
      const matched = byConvention.get(convention);
      return matched ? [{ convention, files: matched }] : [];
    }),
    highFanIn: ids
      .map((file) => ({ file, dependents: index.dependents.get(file)?.length ?? 0 }))
      .filter((entry) => entry.dependents >= HIGH_FAN_IN_DEPENDENTS)
      .sort((a, b) => b.dependents - a.dependents || byText(a.file, b.file)),
    large: files
      .filter((file) => file.lineCount > LARGE_FILE_LINES)
      .map((file) => ({ file: file.id, lines: file.lineCount }))
      .sort((a, b) => b.lines - a.lines || byText(a.file, b.file)),
  };
}

// The files a category points at, each once. This is the one list the rail's
// count, the panel's count and the graph's emphasis are all taken from.
export function filesIn(insights: Insights, category: InsightCategory): string[] {
  switch (category) {
    case "cycles":
      return insights.cycles.flatMap((cycle) => cycle.files).sort(byText);
    case "no-incoming":
      return insights.noIncoming;
    case "high-fan-in":
      return insights.highFanIn.map((entry) => entry.file);
    case "large":
      return insights.large.map((entry) => entry.file);
  }
}
