import type { FileNode, ParserOutput } from "../../parser/contract";
import { byText, type GraphIndex } from "../graph/traverse";
import type { ChangeMapping } from "./analyze";
import { isAdded } from "./patch";
import type {
  CodeCheck,
  CodeIssue,
  LineRange,
  Limitation,
  PullRequestChanges,
  RelatedFile,
  RiskLevel,
} from "./report";
import type { TypeCheckOutcome } from "./type-check";

// The whole code-issue methodology: which changed files are checked, which
// diagnostics count, how severe each kind is, and which files an issue is
// linked to. Pure: the same inputs always give the same issues in the same
// order. The report page prints the rules below beside the issues.
//
// Two lines are held throughout. An issue is something a tool reported, at a
// line the pull request added; nothing here guesses. And a file linked to an
// issue imports the file it is in; that is a relationship in the graph, never
// evidence that the issue reaches it.

// How many changed files one analysis type-checks.
export const TYPE_CHECK_FILE_LIMIT = 200;
// How many issues one analysis stores. The count of the rest is kept.
export const ISSUE_LIMIT = 200;
// How many importers one issue names. The full count is kept.
export const RELATED_FILE_LIMIT = 20;

export const CODE_ISSUE_RULES: Record<
  CodeIssue["category"],
  { label: string; severity: RiskLevel; rule: string }
> = {
  syntax: {
    label: "Syntax error",
    severity: "high",
    rule: "High. The TypeScript parser could not read the file at that line. Anything that compiles or loads the file fails, unless the project compiles it with syntax extensions TypeScript does not know.",
  },
  type: {
    label: "Type error",
    severity: "medium",
    rule: "Medium. The TypeScript compiler, under the repository's own tsconfig, rejects the code at that line. Whether that fails the build depends on whether the project type-checks when it builds, and the code may still run.",
  },
};

export const ISSUE_SCOPE =
  "Only problems at lines this pull request adds are reported. Every issue is a diagnostic a tool produced; none is written by AI. An empty list means these checks found nothing, not that the change is free of defects.";

// Diagnostics that are what the compiler says when a repository's packages,
// or the global names they declare, are missing. The packages are not
// installed here, so on their own these say nothing about the code: they are
// counted and left out.
const SET_ASIDE: ReadonlyMap<number, string> = new Map([
  [2307, "Cannot find a module"],
  [2792, "Cannot find a module"],
  [7016, "No type declarations for a module"],
  [2688, "Cannot find a type definition file"],
  [2875, "JSX runtime module not found"],
  [2304, "Cannot find a name"],
  [2503, "Cannot find a namespace"],
  [2580, "Cannot find a Node.js name"],
  [2591, "Cannot find a Node.js name"],
  [2581, "Cannot find a jQuery name"],
  [2582, "Cannot find a test runner name"],
  [2593, "Cannot find a test runner name"],
  [2583, "Cannot find a name from a library"],
  [2584, "Cannot find a name from a library"],
]);
// 7xxx: "implicitly has an 'any' type". A callback passed to a function from
// a missing package loses its parameter types and is reported here too.
const IMPLICIT_ANY = { from: 7000, to: 7999, why: "Implicitly 'any'" };

export function setAsideReason(code: number): string | null {
  if (code >= IMPLICIT_ANY.from && code <= IMPLICIT_ANY.to) return IMPLICIT_ANY.why;
  return SET_ASIDE.get(code) ?? null;
}

export const SET_ASIDE_RULE =
  "Left out: diagnostics the compiler also gives when a repository's packages are not installed, which they are not here. These are: modules, type declarations or global names that cannot be found, and values that are implicitly ‘any’. A real problem of one of these kinds is missed rather than guessed at; each kind is counted below.";

const LINE_UNKNOWN =
  "GitHub returned no patch that could be read, so which lines the pull request added is unknown.";

export type CodeCheckPlan = {
  // Changed files to type-check, in path order.
  targets: string[];
  skipped: { path: string; reason: string }[];
};

// The added lines of a changed file. null means every line: the file is new.
function addedLinesOf(
  file: PullRequestChanges["files"][number],
): LineRange[] | null | "unknown" {
  if (file.changeType === "added") return null;
  return file.addedLines ?? "unknown";
}

// Which changed files the compiler is asked about, and why each other one in
// the graph is not.
export function planCodeCheck(
  output: ParserOutput,
  changes: PullRequestChanges,
  mapping: ChangeMapping,
): CodeCheckPlan {
  const nodeByPath = new Map(output.files.map((file) => [file.path, file]));
  const changeByPath = new Map(changes.files.map((file) => [file.path, file]));
  const targets: string[] = [];
  const skipped: CodeCheckPlan["skipped"] = [];
  for (const changed of mapping.changed) {
    if (changed.analysisState !== "analysed") continue;
    const node = nodeByPath.get(changed.path);
    const change = changeByPath.get(changed.path);
    if (!node || !change) continue;
    const lines = addedLinesOf(change);
    if (lines === "unknown") {
      skipped.push({ path: changed.path, reason: LINE_UNKNOWN });
    } else if (lines !== null && lines.length === 0) {
      skipped.push({ path: changed.path, reason: "The pull request adds no lines to it." });
    } else if (node.parseStatus === "failed") {
      skipped.push({
        path: changed.path,
        reason:
          "It has syntax errors, so it was not type-checked. Those on added lines are listed as issues.",
      });
    } else if (targets.length >= TYPE_CHECK_FILE_LIMIT) {
      skipped.push({
        path: changed.path,
        reason: `Over the limit of ${TYPE_CHECK_FILE_LIMIT} files type-checked in one analysis.`,
      });
    } else {
      targets.push(changed.path);
    }
  }
  return { targets, skipped };
}

const SEVERITY_ORDER: Record<RiskLevel, number> = { high: 0, medium: 1, low: 2 };

export function collectCodeIssues(
  output: ParserOutput,
  changes: PullRequestChanges,
  index: GraphIndex,
  plan: CodeCheckPlan,
  outcomes: readonly TypeCheckOutcome[],
): { issues: CodeIssue[]; check: CodeCheck; limitations: Limitation[] } {
  const nodeByPath = new Map<string, FileNode>(output.files.map((file) => [file.path, file]));
  const changeByPath = new Map(changes.files.map((file) => [file.path, file]));
  const edgeByPair = new Map(output.edges.map((edge) => [`${edge.source}\n${edge.target}`, edge]));

  function onAddedLine(path: string, line: number): boolean {
    const change = changeByPath.get(path);
    if (!change) return false;
    const lines = addedLinesOf(change);
    if (lines === "unknown") return false;
    return lines === null || isAdded(lines, line);
  }

  // The files that import `path`, straight from the graph's edges. Node ids
  // are repository paths.
  function importersOf(path: string): { related: RelatedFile[]; count: number } {
    const importers = [...(index.dependents.get(path) ?? [])].sort(byText);
    const related = importers.slice(0, RELATED_FILE_LIMIT).map((importer) => {
      const edge = edgeByPair.get(`${importer}\n${path}`);
      if (!edge) throw new Error(`The graph lists ${importer} as importing ${path} with no edge.`);
      const source = nodeByPath.get(edge.source);
      if (!source) throw new Error(`The graph has an edge from ${edge.source}, which is not one of its files.`);
      return { path: source.path, relationship: edge.kinds.join("+"), typeOnly: edge.typeOnly };
    });
    return { related, count: importers.length };
  }

  const issues: CodeIssue[] = [];

  // Syntax errors, as the parser recorded them for the graph.
  for (const changed of changes.files) {
    const node = nodeByPath.get(changed.path);
    if (!node || node.parseStatus !== "failed") continue;
    for (const error of node.parseErrors) {
      if (!onAddedLine(node.path, error.line)) continue;
      const { related, count } = importersOf(node.path);
      issues.push({
        title: CODE_ISSUE_RULES.syntax.label,
        category: "syntax",
        severity: CODE_ISSUE_RULES.syntax.severity,
        status: "confirmed",
        source: "compiler",
        ruleId: null,
        path: node.path,
        startLine: error.line,
        startColumn: null,
        endLine: null,
        endColumn: null,
        message: error.message,
        conditions:
          "Reported by the TypeScript parser reading this file at the head commit, at a line the pull request adds. The parser records at most five syntax errors per file.",
        relatedFiles: related,
        relatedFileCount: count,
      });
    }
  }

  // Type errors, as the compiler reported them.
  const setAside = new Map<number, number>();
  const checked: string[] = [];
  const skipped = [...plan.skipped];
  for (const outcome of outcomes) {
    if (outcome.state === "skipped") {
      skipped.push({ path: outcome.path, reason: outcome.reason });
      continue;
    }
    checked.push(outcome.path);
    for (const diagnostic of outcome.diagnostics) {
      if (!onAddedLine(outcome.path, diagnostic.line)) continue;
      if (setAsideReason(diagnostic.code) !== null) {
        setAside.set(diagnostic.code, (setAside.get(diagnostic.code) ?? 0) + 1);
        continue;
      }
      const { related, count } = importersOf(outcome.path);
      issues.push({
        title: CODE_ISSUE_RULES.type.label,
        category: "type",
        severity: CODE_ISSUE_RULES.type.severity,
        status: "confirmed",
        source: "compiler",
        ruleId: `TS${diagnostic.code}`,
        path: outcome.path,
        startLine: diagnostic.line,
        startColumn: diagnostic.column,
        endLine: diagnostic.endLine,
        endColumn: diagnostic.endColumn,
        message: diagnostic.message,
        conditions: `Reported by the TypeScript compiler under ${outcome.config}, at the head commit, at a line the pull request adds. The repository's packages were not installed, so anything typed by them was treated as unknown and not checked.`,
        relatedFiles: related,
        relatedFileCount: count,
      });
    }
  }

  issues.sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      byText(a.path, b.path) ||
      a.startLine - b.startLine ||
      (a.startColumn ?? 0) - (b.startColumn ?? 0) ||
      byText(a.message, b.message),
  );
  skipped.sort((a, b) => byText(a.path, b.path));

  const limitations: Limitation[] = [];
  if (skipped.length > 0) {
    limitations.push({
      id: "code-check-partial",
      detail: `${skipped.length} changed ${skipped.length === 1 ? "file was" : "files were"} not type-checked. The Code issues section says why for each. No issue is reported for ${skipped.length === 1 ? "it" : "them"} beyond syntax errors.`,
      files: skipped.slice(0, 20).map((entry) => entry.path),
    });
  }

  return {
    issues: issues.slice(0, ISSUE_LIMIT),
    check: {
      checked: checked.sort(byText),
      skipped,
      setAside: [...setAside.entries()]
        .sort(([codeA, a], [codeB, b]) => b - a || codeA - codeB)
        .map(([code, count]) => ({
          ruleId: `TS${code}`,
          reason: setAsideReason(code) ?? "",
          count,
        })),
      omitted: Math.max(0, issues.length - ISSUE_LIMIT),
    },
    limitations,
  };
}
