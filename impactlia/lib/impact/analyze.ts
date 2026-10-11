import type { FileNode, ParserOutput } from "../../parser/contract";
import { ROLES } from "../../parser/roles";
import { summariseCoverage } from "../graph/coverage";
import {
  byText,
  indexEdges,
  traverse,
  type GraphIndex,
  type Traversal,
} from "../graph/traverse";
import type {
  AffectedReportFile,
  ChangedReportFile,
  ImpactReport,
  Limitation,
  PullRequestChanges,
  ReportDependency,
  ReportRecommendation,
  ReportSignal,
  RiskLevel,
} from "./report";
import {
  CRITICAL_ROLES,
  DIRECT_DEPENDENTS_HIGH,
  DIRECT_DEPENDENTS_MEDIUM,
  IMPACT_DEPTH,
  REACH_HIGH,
  REACH_MEDIUM,
  SHARED_MODULE_DEPENDENTS,
  SIGNALS,
  highestLevel,
} from "./risk";

// The impact of a pull request, worked out from two things and nothing else:
// the files GitHub says it changes, and the graph the parser built from its
// head commit. Pure: the same two inputs always give the same report, with
// its lists in the same order.
//
// The analysis is per file. Any change to a file counts for the whole file,
// so the patch's content is never read here.
//
// A file is "potentially affected" only when a chain of real edges leads from
// it to a changed file. That is a statement about imports. It is never a
// statement that the file is broken.

// How many paths one finding names. The counts in its text are always the
// full ones.
const EVIDENCE_LIMIT = 50;
const FACT_LIMIT = 10;
const LIMITATION_FILES = 20;

const SOURCE_FILE = /\.[cm]?[jt]sx?$/;

const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

// At most `limit` items, and a last item saying how many were left out.
function listed(items: readonly string[], limit: number): string[] {
  if (items.length <= limit) return [...items];
  return [...items.slice(0, limit), `…and ${items.length - limit} more.`];
}

function named(paths: readonly string[], limit = 5): string {
  const shown = paths.slice(0, limit).join(", ");
  return paths.length > limit ? `${shown} and ${paths.length - limit} more` : shown;
}

function lookup(output: ParserOutput) {
  const nodeById = new Map<string, FileNode>(output.files.map((file) => [file.id, file]));
  const pathOf = (id: string): string => {
    const node = nodeById.get(id);
    if (!node) throw new Error(`The graph has an edge to ${id}, which is not one of its files.`);
    return node.path;
  };
  return { nodeById, pathOf };
}

export type ChangeMapping = {
  changed: ChangedReportFile[];
  // Graph ids of the changed files that are nodes: where the walk starts.
  starts: string[];
  // Paths of changed files, by why they are not fully covered.
  removed: string[];
  outsideGraph: string[];
  missing: string[];
  unparsed: string[];
};

// Step one: match each changed path to a file in the graph, or say why not.
export function mapChangedFiles(output: ParserOutput, changes: PullRequestChanges): ChangeMapping {
  const nodeByPath = new Map<string, FileNode>(output.files.map((file) => [file.path, file]));

  // ── Changed files, and whether each is a node ────────────────────────────
  const ruleDescriptions = new Map(output.exclusionRules.map((rule) => [rule.id, rule.description]));
  const excludedFiles = new Map<string, string>();
  const excludedDirectories = new Map<string, string>();
  for (const entry of output.excluded) {
    (entry.type === "file" ? excludedFiles : excludedDirectories).set(entry.path, entry.rule);
  }
  function exclusionOf(path: string): string | null {
    const direct = excludedFiles.get(path);
    if (direct) return direct;
    for (let end = path.lastIndexOf("/"); end > 0; end = path.lastIndexOf("/", end - 1)) {
      const rule = excludedDirectories.get(path.slice(0, end));
      if (rule) return rule;
    }
    return null;
  }

  const seen = new Set<string>();
  const changed: ChangedReportFile[] = [];
  const starts: string[] = [];
  const removed: string[] = [];
  const outsideGraph: string[] = [];
  const missing: string[] = [];
  const unparsed: string[] = [];
  for (const file of [...changes.files].sort((a, b) => byText(a.path, b.path))) {
    if (seen.has(file.path)) {
      throw new Error(`GitHub listed ${file.path} twice among the changed files.`);
    }
    seen.add(file.path);
    const node = nodeByPath.get(file.path);
    let analysisState: ChangedReportFile["analysisState"] = "unanalysed";
    let stateReason: string | null;
    if (node) {
      analysisState = "analysed";
      starts.push(node.id);
      if (node.parseStatus === "failed") {
        unparsed.push(file.path);
        stateReason =
          "It could not be parsed, so its own imports were not read. Files that import it were still traced.";
      } else {
        stateReason = null;
      }
    } else if (file.changeType === "removed") {
      removed.push(file.path);
      stateReason =
        "Removed by this pull request, so it is not in the head commit. Files that still import it cannot be traced from this graph.";
    } else {
      const rule = exclusionOf(file.path);
      if (rule) {
        outsideGraph.push(file.path);
        stateReason = `Not in the graph. ${ruleDescriptions.get(rule) ?? `Excluded by the rule “${rule}”.`}`;
      } else {
        missing.push(file.path);
        stateReason = "Not found in the graph built from the head commit.";
      }
    }
    changed.push({
      kind: "changed",
      path: file.path,
      changeType: file.changeType,
      previousPath: file.previousPath,
      additions: file.additions,
      deletions: file.deletions,
      patchAvailable: file.patchAvailable,
      analysisState,
      stateReason,
    });
  }

  return { changed, starts, removed, outsideGraph, missing, unparsed };
}

export type BlastRadius = {
  index: GraphIndex;
  traversal: Traversal;
  affected: AffectedReportFile[];
  dependencies: ReportDependency[];
};

// Step two: follow real imports outwards from the changed files.
export function calculateBlastRadius(output: ParserOutput, starts: readonly string[]): BlastRadius {
  const { pathOf } = lookup(output);
  // One walk from every changed file at once, so a file reached from several
  // of them, or by several routes, is found once, at its shortest distance.
  const index = indexEdges(output.edges);
  const traversal = traverse(index, starts, "dependents", IMPACT_DEPTH);
  const affected: AffectedReportFile[] = traversal.reached.map((entry) => ({
    kind: "affected",
    path: pathOf(entry.file),
    impactDepth: entry.depth,
    dependencyPath: entry.path.map(pathOf),
    routeCount: entry.via.length,
  }));

  // The edges on every shortest route. Each is looked up in the graph; one
  // that is not there stops the analysis rather than being written down.
  const edgeByPair = new Map(output.edges.map((edge) => [`${edge.source}\n${edge.target}`, edge]));
  const dependencies: ReportDependency[] = traversal.reached.flatMap((entry) =>
    entry.via.map((nearer) => {
      const edge = edgeByPair.get(`${entry.file}\n${nearer}`);
      if (!edge) {
        throw new Error(`The traversal followed ${entry.file} → ${nearer}, which is not an edge in the graph.`);
      }
      return {
        source: pathOf(edge.source),
        target: pathOf(edge.target),
        kind: edge.kinds.join("+"),
        typeOnly: edge.typeOnly,
      };
    }),
  );
  return { index, traversal, affected, dependencies };
}

// Step three: apply the documented rules to what the first two steps found.
export function scoreImpact(
  output: ParserOutput,
  changes: PullRequestChanges,
  mapping: ChangeMapping,
  radius: BlastRadius,
  graphSha: string | null,
): ImpactReport {
  const { nodeById, pathOf } = lookup(output);
  const { changed, starts, removed, outsideGraph, missing, unparsed } = mapping;
  const { index, traversal, affected, dependencies } = radius;

  // ── Risk signals ─────────────────────────────────────────────────────────
  const dependentsOf = (id: string) => index.dependents.get(id)?.length ?? 0;
  const startPaths = starts.map(pathOf);
  const signals: ReportSignal[] = [];
  const raise = (
    signal: ReportSignal["signal"],
    level: RiskLevel,
    facts: string[],
    evidence: readonly string[],
  ) => {
    signals.push({
      signal,
      level,
      detail: { rule: SIGNALS[signal].rule, facts },
      evidence: evidence.slice(0, EVIDENCE_LIMIT),
    });
  };

  const direct = starts
    .map((id) => ({ path: pathOf(id), count: dependentsOf(id) }))
    .filter((entry) => entry.count >= DIRECT_DEPENDENTS_MEDIUM)
    .sort((a, b) => b.count - a.count || byText(a.path, b.path));
  if (direct.length > 0) {
    raise(
      "direct-dependents",
      direct[0].count >= DIRECT_DEPENDENTS_HIGH ? "high" : "medium",
      listed(
        direct.map((entry) => `${entry.path} is imported directly by ${entry.count} files.`),
        FACT_LIMIT,
      ),
      direct.map((entry) => entry.path),
    );
  }

  if (affected.length > 0) {
    const perDepth = new Map<number, number>();
    for (const file of affected) {
      perDepth.set(file.impactDepth, (perDepth.get(file.impactDepth) ?? 0) + 1);
    }
    raise(
      "transitive-reach",
      affected.length >= REACH_HIGH ? "high" : affected.length >= REACH_MEDIUM ? "medium" : "low",
      [
        `${plural(affected.length, "file imports", "files import")} the changed code directly or through other files, each counted once.`,
        [...perDepth.entries()]
          .map(([depth, count]) => `${count} at ${plural(depth, "import", "imports")} away`)
          .join(", ") + ".",
      ],
      startPaths,
    );
  }

  const shared = traversal.reached
    .map((entry) => ({ path: pathOf(entry.file), count: dependentsOf(entry.file) }))
    .filter((entry) => entry.count >= SHARED_MODULE_DEPENDENTS)
    .sort((a, b) => b.count - a.count || byText(a.path, b.path));
  if (shared.length > 0) {
    raise(
      "shared-module-reached",
      "medium",
      listed(
        shared.map(
          (entry) => `${entry.path} is potentially affected and is itself imported by ${entry.count} files.`,
        ),
        FACT_LIMIT,
      ),
      shared.map((entry) => entry.path),
    );
  }

  const critical = starts
    .map((id) => nodeById.get(id))
    .filter((node): node is FileNode => node !== undefined && CRITICAL_ROLES.includes(node.role.id));
  if (critical.length > 0) {
    raise(
      "critical-role",
      "medium",
      listed(
        critical.map(
          (node) => `${node.path} has the role “${ROLES[node.role.id].label}”: ${node.role.reason}`,
        ),
        FACT_LIMIT,
      ),
      critical.map((node) => node.path),
    );
  }

  const coverage = summariseCoverage(output);
  const unresolvedImports = coverage.unresolvedByReason.reduce((sum, row) => sum + row.count, 0);
  const removedSource = removed.filter((path) => SOURCE_FILE.test(path));
  const coverageFacts: string[] = [];
  if (!changes.complete) {
    coverageFacts.push(
      `GitHub returned ${changes.files.length} of the ${changes.reportedFileCount} files this pull request changes.`,
    );
  }
  if (removedSource.length > 0) {
    coverageFacts.push(
      `${plural(removedSource.length, "source file was", "source files were")} removed, and what imported ${removedSource.length === 1 ? "it" : "them"} cannot be traced: ${named(removedSource)}.`,
    );
  }
  if (unparsed.length > 0) {
    coverageFacts.push(
      `${plural(unparsed.length, "changed file", "changed files")} could not be parsed: ${named(unparsed)}.`,
    );
  }
  if (missing.length > 0) {
    coverageFacts.push(
      `${plural(missing.length, "changed file is", "changed files are")} missing from the graph for no known reason: ${named(missing)}.`,
    );
  }
  const concernsTheChange = coverageFacts.length > 0;
  const otherUnanalysed = outsideGraph.length + (removed.length - removedSource.length);
  if (otherUnanalysed > 0) {
    coverageFacts.push(
      `${plural(otherUnanalysed, "changed file is", "changed files are")} of a kind the graph does not cover, so nothing is known about what depends on ${otherUnanalysed === 1 ? "it" : "them"}.`,
    );
  }
  if (unresolvedImports > 0 || coverage.failedFiles > 0) {
    coverageFacts.push(
      `In the repository as a whole, ${plural(unresolvedImports, "import", "imports")} could not be resolved to a file and ${plural(coverage.failedFiles, "file", "files")} could not be parsed. A file that depends on the change only through one of those is not in this report.`,
    );
  }
  if (coverage.configProblems.length > 0) {
    coverageFacts.push(
      `${plural(coverage.configProblems.length, "tsconfig or jsconfig file", "tsconfig or jsconfig files")} could not be fully read, which is the usual cause of unresolved path aliases.`,
    );
  }
  if (coverageFacts.length > 0) {
    raise("incomplete-coverage", concernsTheChange ? "medium" : "low", coverageFacts, [
      ...removedSource,
      ...unparsed,
      ...missing,
      ...outsideGraph,
    ]);
  }

  // ── Suggested checks ─────────────────────────────────────────────────────
  // Recommendations only. Nothing here was run, and none of it is a result.
  const recommendations: ReportRecommendation[] = [];
  const recommend = (body: string, reason: string, evidence: readonly string[]) => {
    recommendations.push({ body, reason, evidence: evidence.slice(0, EVIDENCE_LIMIT) });
  };

  const tests = traversal.reached
    .filter((entry) => nodeById.get(entry.file)?.role.id === "test")
    .map((entry) => pathOf(entry.file));
  if (tests.length > 0) {
    recommend(
      `Run the ${plural(tests.length, "test file", "test files")} that import the changed code.`,
      `They are in the potentially affected set, directly or through other files: ${named(tests)}.`,
      tests,
    );
  } else if (affected.length > 0) {
    const nearest = affected.filter((file) => file.impactDepth === 1).map((file) => file.path);
    recommend(
      "Check the files that import the changed code directly by hand.",
      `No file with a test name (*.test.*, *.spec.*, __tests__/) imports the changed code within ${IMPACT_DEPTH} imports. The direct importers are: ${named(nearest)}.`,
      nearest,
    );
  }

  const inImpactSet = new Set([...startPaths, ...affected.map((file) => file.path)]);
  const routes = output.routes.filter((route) => inImpactSet.has(route.file));
  if (routes.length > 0) {
    recommend(
      `Exercise the ${plural(routes.length, "route", "routes")} handled by changed or potentially affected files.`,
      named(
        routes.map((route) => `${route.method ? `${route.method} ` : ""}${route.pattern} (${route.file})`),
      ) + ".",
      [...new Set(routes.map((route) => route.file))],
    );
  }

  if (direct.length > 0) {
    recommend(
      `Review what imports ${direct[0].path} first.`,
      `It is the changed file with the most direct importers: ${direct[0].count}.`,
      [direct[0].path],
    );
  }

  const untraced = changed.filter((file) => file.analysisState === "unanalysed").map((file) => file.path);
  if (untraced.length > 0) {
    recommend(
      `Trace by hand what uses the ${plural(untraced.length, "changed file", "changed files")} this report could not map.`,
      `They are not in the graph, so no dependency of theirs is shown here: ${named(untraced)}.`,
      untraced,
    );
  }

  // ── Limitations ──────────────────────────────────────────────────────────
  const limitations: Limitation[] = [];
  const limit = (id: string, detail: string, files: readonly string[] = []) => {
    limitations.push({ id, detail, files: files.slice(0, LIMITATION_FILES) });
  };
  if (changes.files.length === 0) {
    limit("no-changed-files", "GitHub lists no changed files for this pull request.");
  }
  if (!changes.complete) {
    limit(
      "diff-incomplete",
      `GitHub returned ${changes.files.length} of the ${changes.reportedFileCount} changed files. The rest were not analysed, so this report does not cover the whole pull request.`,
    );
  }
  if (removed.length > 0) {
    limit(
      "removed-files",
      `${plural(removed.length, "file was", "files were")} removed. The graph is of the head commit, where ${removed.length === 1 ? "it no longer exists" : "they no longer exist"}, so files that imported ${removed.length === 1 ? "it" : "them"} are not traced. An import left pointing at a removed file appears among the unresolved imports.`,
      removed,
    );
  }
  const renamed = changed.filter((file) => file.changeType === "renamed").map((file) => file.path);
  if (renamed.length > 0) {
    limit(
      "renamed-files",
      `${plural(renamed.length, "file was", "files were")} renamed and traced under the new path. An import that still uses the old path is not traced.`,
      renamed,
    );
  }
  if (outsideGraph.length > 0) {
    limit(
      "outside-graph",
      `${plural(outsideGraph.length, "changed file is", "changed files are")} not TypeScript or JavaScript source, or in a folder the graph leaves out. Nothing is known about what depends on ${outsideGraph.length === 1 ? "it" : "them"}.`,
      outsideGraph,
    );
  }
  if (missing.length > 0) {
    limit(
      "missing-from-graph",
      `${plural(missing.length, "changed file", "changed files")} should be in the graph of the head commit and ${missing.length === 1 ? "is" : "are"} not.`,
      missing,
    );
  }
  if (unparsed.length > 0) {
    limit(
      "changed-file-unparsed",
      `${plural(unparsed.length, "changed file", "changed files")} could not be parsed. What imports ${unparsed.length === 1 ? "it" : "them"} was traced; ${unparsed.length === 1 ? "its" : "their"} own imports were not read.`,
      unparsed,
    );
  }
  const noPatch = changed
    .filter(
      (file) =>
        !file.patchAvailable &&
        // A pure rename has no patch because nothing in the file changed.
        !(file.changeType === "renamed" && file.additions + file.deletions === 0),
    )
    .map((file) => file.path);
  if (noPatch.length > 0) {
    limit(
      "patch-unavailable",
      `GitHub returned no patch for ${plural(noPatch.length, "changed file", "changed files")}: binary, or over its size limit. The analysis is per file and uses the path and status, which GitHub did return.`,
      noPatch,
    );
  }
  if (coverage.incomplete) {
    limit(
      "graph-incomplete",
      `The graph of the head commit is incomplete: ${plural(unresolvedImports, "import", "imports")} unresolved, ${plural(coverage.failedFiles, "file", "files")} unparsed, ${plural(coverage.configProblems.length, "configuration file", "configuration files")} not fully read. Dependencies through those are missing from this report.`,
    );
  }
  if (traversal.more) {
    limit(
      "depth-limit",
      `Imports were followed ${IMPACT_DEPTH} steps out from the changed files. More files lie beyond that and are not counted.`,
    );
  }
  if (graphSha === null) {
    limit(
      "commit-unverified",
      "The archive GitHub returned did not state which commit it was built from, so the graph's commit could not be confirmed against the pull request's head.",
    );
  }

  return {
    graphSha,
    // With no changed file in the graph nothing was measured, so no level is
    // given at all rather than a reassuring "low".
    riskLevel: starts.length === 0 ? null : (highestLevel(signals.map((signal) => signal.level)) ?? "low"),
    limitations,
    files: [...changed, ...affected],
    dependencies,
    signals,
    recommendations,
  };
}

export function analyseImpact(
  output: ParserOutput,
  changes: PullRequestChanges,
  graphSha: string | null,
): ImpactReport {
  const mapping = mapChangedFiles(output, changes);
  return scoreImpact(
    output,
    changes,
    mapping,
    calculateBlastRadius(output, mapping.starts),
    graphSha,
  );
}
