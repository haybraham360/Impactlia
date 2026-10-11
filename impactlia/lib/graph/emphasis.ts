import { filesIn, type InsightCategory, type Insights } from "./insights";
import { linkId } from "./layout";
import { ROLES, type RoleId } from "@/parser/roles";
import type { GraphModel } from "./model";
import type { Traversal } from "./traverse";

// What the canvas keeps at full strength while a traversal or an insight
// filter is active. Everything else is dimmed and stays where it is. Only one
// of the two is ever active, so there is one answer to "why is this bright".
export type Emphasis = {
  files: ReadonlySet<string>;
  // How many of each folder's files match, so a closed folder can say why it
  // is still bright. A traversal's starting file is bright but not counted.
  matchesIn: ReadonlyMap<string, number>;
  // Folder-to-folder lines carrying at least one edge that is evidence for
  // the result.
  links: ReadonlySet<string>;
  line: "incoming" | "outgoing" | "plain";
  // Completes "3 …" on a folder.
  noun: string;
  legend: string;
};

type Edge = { source: string; target: string };

function build(
  model: GraphModel,
  matches: readonly string[],
  alsoBright: readonly string[],
  evidence: readonly Edge[],
): Pick<Emphasis, "files" | "matchesIn" | "links"> {
  const folderOf = new Map(model.files.map((file) => [file.id, file.folder]));
  const matchesIn = new Map<string, number>();
  for (const file of matches) {
    const folder = folderOf.get(file);
    if (folder !== undefined) matchesIn.set(folder, (matchesIn.get(folder) ?? 0) + 1);
  }
  const links = new Set<string>();
  for (const edge of evidence) {
    const source = folderOf.get(edge.source);
    const target = folderOf.get(edge.target);
    if (source !== undefined && target !== undefined && source !== target) {
      links.add(linkId(source, target));
    }
  }
  return { files: new Set([...matches, ...alsoBright]), matchesIn, links };
}

export function emphasiseTraversal(model: GraphModel, traversal: Traversal): Emphasis {
  const blast = traversal.direction === "dependents";
  // The edges on every shortest route, pointing the way the import does.
  const evidence = traversal.reached.flatMap((entry) =>
    entry.via.map((near) =>
      blast ? { source: entry.file, target: near } : { source: near, target: entry.file },
    ),
  );
  const within = `within ${traversal.depth} ${traversal.depth === 1 ? "import" : "imports"}`;
  return {
    ...build(
      model,
      traversal.reached.map((entry) => entry.file),
      traversal.starts,
      evidence,
    ),
    line: blast ? "incoming" : "outgoing",
    noun: blast ? "potentially affected" : "in the dependency chain",
    legend: blast
      ? `Blast radius: the selected file and the files that import it, ${within}. The rest is dimmed, not removed.`
      : `Dependency chain: the selected file and the files it imports, ${within}. The rest is dimmed, not removed.`,
  };
}

// What the rail can pick out on the graph. One at a time.
export type GraphFilter =
  | { kind: "insight"; id: InsightCategory }
  | { kind: "role"; id: RoleId };

// The one list a role's count in the rail and its emphasis on the graph are
// both taken from.
export function filesWithRole(model: GraphModel, role: RoleId): string[] {
  return model.files.filter((file) => file.role.id === role).map((file) => file.id);
}

// A role is a fact about each file on its own, so no line is picked out.
export function emphasiseRole(model: GraphModel, role: RoleId): Emphasis {
  return {
    ...build(model, filesWithRole(model, role), [], []),
    line: "plain",
    noun: "matching",
    legend: `Filter: ${ROLES[role].label}. Files that do not match are dimmed, not removed.`,
  };
}

export const categoryLabel: Record<InsightCategory, string> = {
  cycles: "Import cycles",
  "no-incoming": "No incoming imports detected",
  "high-fan-in": "Highly depended-on files",
  large: "Large files",
};

export function emphasiseCategory(
  model: GraphModel,
  insights: Insights,
  category: InsightCategory,
): Emphasis {
  // Only a cycle is made of edges. For the other categories an edge between
  // two matching files means nothing, so no line is picked out.
  const group = new Map<string, number>();
  if (category === "cycles") {
    insights.cycles.forEach((cycle, number) => {
      for (const file of cycle.files) group.set(file, number);
    });
  }
  const evidence = model.edges.filter((edge) => {
    const source = group.get(edge.source);
    return source !== undefined && source === group.get(edge.target);
  });
  return {
    ...build(model, filesIn(insights, category), [], evidence),
    line: "plain",
    noun: "matching",
    legend: `Filter: ${categoryLabel[category]}. Files that do not match are dimmed, not removed.`,
  };
}
