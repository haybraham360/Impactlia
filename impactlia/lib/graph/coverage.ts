import type { ParserOutput, UnresolvedReason } from "../../parser/contract";
import { unsupportedFileTypeRule } from "../../parser/exclusions";

// How much of what the parser read ended up in the graph. Every number is
// counted by the parser; nothing here is estimated.
//
// The figure is import coverage:
//
//   imports resolved to a file in the graph
//   ───────────────────────────────────────────────────────────
//   imports resolved to a file in the graph + imports unresolved
//
// Imports of installed packages and Node built-ins are in neither number: they
// were understood, and they are not relationships between repository files.
// Imports of a file an exclusion rule left out are also in neither, and are
// reported on their own.
//
// It measures static imports the parser read. It says nothing about
// relationships that exist only at runtime, so 100% is not a complete map.
export type CoverageSummary = {
  // False when anything below means a relationship may be missing.
  incomplete: boolean;
  // null when the repository has no import that points inside it, which
  // leaves nothing to take a percentage of.
  imports: { resolved: number; total: number; percent: number } | null;
  unresolvedByReason: { reason: UnresolvedReason; count: number }[];
  // Files whose syntax could not be parsed. Their imports were not read.
  failedFiles: number;
  files: number;
  // tsconfig/jsconfig files that could not be fully read. These decide how
  // aliases resolve, so a problem here is the usual cause of unresolved ones.
  configProblems: { path: string; problems: string[] }[];
  // Imports that resolved to a file kept out of the graph by an exclusion rule.
  excludedImports: number;
  // Files that are not TypeScript or JavaScript, which the parser does not read.
  unsupportedFiles: number;
};

export function summariseCoverage(output: ParserOutput): CoverageSummary {
  const { references, files } = output.coverage;
  const total = references.internal + references.unresolved;
  const configProblems = output.resolutionConfigs.filter(
    (config) => config.problems.length > 0,
  );

  return {
    incomplete: references.unresolved > 0 || files.failed > 0 || configProblems.length > 0,
    imports:
      total === 0
        ? null
        : {
            resolved: references.internal,
            total,
            // Rounded down, so anything short of every import never reads as 100%.
            percent: Math.floor((references.internal / total) * 100),
          },
    unresolvedByReason: output.coverage.unresolvedByReason.map(({ reason, count }) => ({
      reason,
      count,
    })),
    failedFiles: files.failed,
    files: files.included,
    configProblems,
    excludedImports: references.excluded,
    unsupportedFiles:
      output.coverage.excludedByRule.find((row) => row.rule === unsupportedFileTypeRule.id)
        ?.files ?? 0,
  };
}
