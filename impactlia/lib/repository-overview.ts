import { fallbackAdapter } from "@/parser/adapter";
import type { FileNode, ParserOutput, UnresolvedReason } from "@/parser/contract";

export type FileGroup = { label: string; files: number };

export type RepositoryOverview = {
  // The name in the repository's root package.json, as the parser recorded
  // it. null when the root has none; the parser output carries no other name.
  name: string | null;
  // null when the parser ran without a framework adapter.
  framework: string | null;
  files: number;
  failedFiles: number;
  edges: number;
  unresolvedReferences: number;
  unresolvedByReason: { reason: UnresolvedReason; count: number }[];
  // Imports that resolved to a file an exclusion rule kept out of the graph.
  excludedReferences: number;
  excludedByRule: { description: string; files: number; directories: number }[];
  // File ids, most dependents first.
  mostDependedOn: { file: string; dependents: number }[];
  // File ids that no edge points at.
  noKnownDependents: string[];
  fileTypes: FileGroup[];
  topLevelDirectories: FileGroup[];
};

// Shown for files that sit directly in the repository root. Not a directory
// name, so it cannot collide with one.
export const ROOT_LABEL = "(repository root)";

const MOST_DEPENDED_ON = 10;

// The one way a file's type is named: its extension, with declaration files
// kept apart because the parser records them apart.
export function fileType(file: Pick<FileNode, "extension" | "declaration">): string {
  return file.declaration ? `.d${file.extension}` : file.extension;
}

// Largest first, then plain code-point order so ties do not depend on locale.
export function countBy(labels: string[]): FileGroup[] {
  const counts = new Map<string, number>();
  for (const label of labels) counts.set(label, (counts.get(label) ?? 0) + 1);
  return [...counts]
    .map(([label, files]) => ({ label, files }))
    .sort(
      (a, b) =>
        b.files - a.files || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0),
    );
}

// Everything here is counted from the parser output. The groupings are the
// ones the parser already records: a file's extension, whether it is a
// declaration file, and the first segment of its folder.
export function summariseRepository(output: ParserOutput): RepositoryOverview {
  // Counted from the edge list, the same list the detail pane shows a file's
  // dependents from, so the two can never disagree.
  const dependents = new Map<string, number>();
  for (const edge of output.edges) {
    if (edge.source === edge.target) continue;
    dependents.set(edge.target, (dependents.get(edge.target) ?? 0) + 1);
  }
  const ruleDescriptions = new Map(
    output.exclusionRules.map((rule) => [rule.id, rule.description]),
  );

  return {
    name: output.files.find((file) => file.package?.root === "")?.package?.name ?? null,
    framework: output.adapter === fallbackAdapter.name ? null : output.adapter,
    unresolvedByReason: output.coverage.unresolvedByReason.map(({ reason, count }) => ({
      reason,
      count,
    })),
    excludedReferences: output.coverage.references.excluded,
    excludedByRule: output.coverage.excludedByRule.map((entry) => ({
      description: ruleDescriptions.get(entry.rule) ?? entry.rule,
      files: entry.files,
      directories: entry.directories,
    })),
    mostDependedOn: [...dependents]
      .map(([file, count]) => ({ file, dependents: count }))
      .sort(
        (a, b) =>
          b.dependents - a.dependents || (a.file < b.file ? -1 : a.file > b.file ? 1 : 0),
      )
      .slice(0, MOST_DEPENDED_ON),
    noKnownDependents: output.files
      .filter((file) => !dependents.has(file.id))
      .map((file) => file.id),
    files: output.files.length,
    failedFiles: output.coverage.files.failed,
    edges: output.edges.length,
    unresolvedReferences: output.coverage.references.unresolved,
    fileTypes: countBy(output.files.map(fileType)),
    topLevelDirectories: countBy(
      output.files.map((file) => file.folderSegments[0] ?? ROOT_LABEL),
    ),
  };
}
