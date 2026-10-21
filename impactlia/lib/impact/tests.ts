import type { FileNode, ParserOutput } from "../../parser/contract";
import { byText } from "../graph/traverse";
import type { BlastRadius, ChangeMapping } from "./analyze";
import type {
  Confidence,
  FileReference,
  Limitation,
  Priority,
  PullRequestChanges,
  TestDiscovery,
  TestFileReference,
  TestRecommendation,
  TestRelationship,
} from "./report";
import { TEST_RELATIONSHIPS } from "./report";
import type { RepositoryFiles } from "./repository-files";
import { CRITICAL_ROLES, DIRECT_DEPENDENTS_MEDIUM } from "./risk";
import { TEST_RULES, TEST_RUNNERS } from "./test-rules";
import {
  changedDeclarations,
  importsOf,
  type ChangedDeclaration,
  type ChangedLines,
  type FeatureKind,
} from "./syntax";

// The whole test-recommendation methodology: which files count as tests, how
// a test is tied to the change, which scenarios are suggested, and where the
// test command comes from. Deterministic: the same graph, diff and files give
// the same recommendations in the same order. The report page prints the
// rules below beside the results.
//
// Three things are kept apart. An existing test is a file at the head commit,
// tied to the change by an import the parser resolved (or, weakest, by its
// name, and labelled so). A scenario is inferred from the syntax on lines the
// pull request adds; it is a suggestion, not a test. And a changed file with
// no test found is "unknown", never "untested": no coverage data is read.
//
// Nothing is run. Files are read as text, and only the changed files and the
// test files that import them.

export const EXISTING_TEST_LIMIT = 30;
export const SCENARIO_LIMIT = 12;
const SCENARIOS_PER_DECLARATION = 3;
export const COVERAGE_UNKNOWN_LIMIT = 15;
// How many files are read for their syntax in one analysis.
const SOURCE_READ_LIMIT = 200;
const TEST_READ_LIMIT = 300;
// A narrowed command names at most this many test files.
const PATHS_IN_COMMAND = 10;
const NAME_MATCHES_PER_FILE = 3;
const RELATED_TESTS_SHOWN = 3;

const SCENARIO_RULES: Record<
  FeatureKind | "route",
  { title: (symbol: string) => string; riskAddressed: string }
> = {
  route: { title: (symbol) => `Requests to the changed handler ${symbol}`, riskAddressed: "request handling" },
  signature: { title: (symbol) => `Callers of ${symbol} after its signature change`, riskAddressed: "contract change" },
  throw: { title: (symbol) => `The error path in ${symbol}`, riskAddressed: "error handling" },
  catch: { title: (symbol) => `Failure handling in ${symbol}`, riskAddressed: "error handling" },
  branch: { title: (symbol) => `Both outcomes of the changed condition in ${symbol}`, riskAddressed: "regression" },
  fallback: { title: (symbol) => `Missing input to ${symbol}`, riskAddressed: "missing or invalid input" },
  await: { title: (symbol) => `A rejected call awaited in ${symbol}`, riskAddressed: "error handling" },
};
const SCENARIO_ORDER: (FeatureKind | "route")[] = [
  "route",
  "signature",
  "throw",
  "catch",
  "branch",
  "fallback",
  "await",
];

const PRIORITY_ORDER: Record<Priority, number> = { high: 0, medium: 1, low: 2 };
const RELATIONSHIP_ORDER = new Map(TEST_RELATIONSHIPS.map((id, at) => [id, at]));

const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

function listed(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

function linesText(lines: readonly number[]): string {
  if (lines.length === 1) return `line ${lines[0]}`;
  if (lines.length <= 4) return `lines ${listed(lines.map(String))}`;
  return `lines ${lines.slice(0, 3).join(", ")} and ${lines.length - 3} more`;
}

const span = (from: number, to: number) => (from === to ? `line ${from}` : `lines ${from}–${to}`);

// "src/format.test.ts" → "format"; "src/__tests__/format.tsx" → "format".
function stemOf(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  return base.replace(/\.[cm]?[jt]sx?$/, "").replace(/\.(test|spec)$/, "");
}

const quoted = (value: string) => (/^[\w./@+-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`);

export type TestEvidence = {
  // Changed source files that tests were looked for, in path order.
  changedCode: string[];
  // Of those, the ones a test file imports directly.
  directlyTested: string[];
  testFileCount: number;
};

export type TestFindings = {
  recommendations: TestRecommendation[];
  discovery: TestDiscovery;
  evidence: TestEvidence;
  limitations: Limitation[];
};

type ExistingMatch = {
  test: string;
  relationship: TestRelationship;
  depth: number;
  changed: FileReference[];
  importLine: number | null;
  symbol: string | null;
  evidence: string[];
};

function confidenceOf(relationship: TestRelationship): Confidence {
  if (relationship === "imports-changed-symbol") return "high";
  if (relationship === "imports-changed-file" || relationship === "changed-in-pull-request") {
    return "medium";
  }
  return "low";
}

const priorityOf = (confidence: Confidence): Priority => confidence;

const RATIONALE: Record<TestRelationship, string> = {
  "imports-changed-symbol":
    "It imports code this pull request changes, so it is the most direct existing check that the change behaves as intended.",
  "imports-changed-file":
    "It imports a changed file. Whether it exercises the changed lines is not known.",
  "changed-in-pull-request": "This pull request edits it, so it should pass at the head commit.",
  "imports-indirectly":
    "It reaches the change only through other files, so it may not exercise the changed code.",
  "name-only":
    "It is named like a changed file, but no import of that file was found. Check it is related before relying on it.",
};

const DESCRIPTION: Record<TestRelationship, string> = {
  "imports-changed-symbol": "Imports changed code by name.",
  "imports-changed-file": "Imports a changed file.",
  "changed-in-pull-request": "Changed by this pull request.",
  "imports-indirectly": "Reaches a changed file through other imports.",
  "name-only": "Possible match by name only.",
};

export function recommendTests(
  output: ParserOutput,
  changes: PullRequestChanges,
  mapping: ChangeMapping,
  radius: BlastRadius,
  files: RepositoryFiles,
): TestFindings {
  const nodeById = new Map<string, FileNode>(output.files.map((file) => [file.id, file]));
  const nodeByPath = new Map<string, FileNode>(output.files.map((file) => [file.path, file]));
  const changeByPath = new Map(changes.files.map((file) => [file.path, file]));
  const edgeByPair = new Map(output.edges.map((edge) => [`${edge.source}\n${edge.target}`, edge]));
  const pathOf = (id: string) => nodeById.get(id)?.path ?? id;
  const { index } = radius;

  // ── Which files are tests ────────────────────────────────────────────────
  const runnersOf = new Map<string, Set<string>>();
  for (const reference of output.unlinkedReferences) {
    if (
      reference.status !== "external" ||
      reference.packageName === null ||
      !TEST_RUNNERS.includes(reference.packageName)
    ) {
      continue;
    }
    const set = runnersOf.get(reference.source) ?? new Set<string>();
    set.add(reference.packageName);
    runnersOf.set(reference.source, set);
  }
  const testRule = new Map<string, string>();
  const frameworks = new Set<string>();
  for (const node of output.files) {
    const runners = runnersOf.get(node.id);
    if (runners) for (const runner of runners) frameworks.add(runner);
    if (node.role.id === "test") testRule.set(node.path, node.role.reason);
    else if (runners) {
      testRule.set(node.path, `Imports a test runner (${[...runners].sort(byText).join(", ")}).`);
    }
  }
  const conventionCounts = new Map<string, number>();
  for (const rule of testRule.values()) {
    // "Imports a test runner (vitest)." is counted under one heading.
    const key = rule.startsWith("Imports a test runner") ? "Imports a test runner." : rule;
    conventionCounts.set(key, (conventionCounts.get(key) ?? 0) + 1);
  }

  // ── What changed, declaration by declaration ─────────────────────────────
  const startPaths = new Set(mapping.starts.map(pathOf));
  const changedCode = mapping.changed
    .filter((file) => {
      const node = nodeByPath.get(file.path);
      return (
        file.analysisState === "analysed" &&
        node !== undefined &&
        !testRule.has(file.path) &&
        node.role.id !== "declaration" &&
        node.role.id !== "config"
      );
    })
    .map((file) => file.path);

  const declarations = new Map<string, ChangedDeclaration[]>();
  const symbolsUnread: TestDiscovery["symbolsUnread"] = [];
  for (const path of changedCode) {
    const change = changeByPath.get(path);
    if (!change) continue;
    let lines: ChangedLines;
    if (change.changeType === "added") lines = { added: "all", removedAt: [] };
    else if (change.addedLines === null) {
      symbolsUnread.push({
        path,
        reason: "GitHub returned no patch that could be read, so which lines changed is unknown.",
      });
      continue;
    } else lines = { added: change.addedLines, removedAt: change.removedAt ?? [] };
    if (declarations.size >= SOURCE_READ_LIMIT) {
      symbolsUnread.push({
        path,
        reason: `Over the limit of ${SOURCE_READ_LIMIT} changed files read in one analysis.`,
      });
      continue;
    }
    const text = files.read(path);
    if (text === null) {
      symbolsUnread.push({ path, reason: "The file could not be read from the head commit." });
      continue;
    }
    let found = changedDeclarations(path, text, lines);
    // A new file has no earlier callers for a signature to have changed for.
    if (change.changeType === "added") {
      found = found.map((declaration) => {
        const features = { ...declaration.features };
        delete features.signature;
        return { ...declaration, features };
      });
    }
    declarations.set(path, found);
  }
  const changedExports = (path: string): string[] | null => {
    const found = declarations.get(path);
    return found ? [...new Set(found.flatMap((declaration) => declaration.exportedAs))] : null;
  };
  const referenceTo = (path: string, names: readonly string[] = []): FileReference => {
    const found = (declarations.get(path) ?? []).filter(
      (declaration) => names.length === 0 || declaration.exportedAs.some((name) => names.includes(name)),
    );
    if (names.length === 0 || found.length === 0) return { path, startLine: null, endLine: null };
    return {
      path,
      startLine: Math.min(...found.map((declaration) => declaration.startLine)),
      endLine: Math.max(...found.map((declaration) => declaration.endLine)),
    };
  };

  // ── Existing tests tied to the change ────────────────────────────────────
  let testReads = 0;
  const bindingsOf = (path: string) => {
    if (testReads >= TEST_READ_LIMIT) return null;
    testReads += 1;
    const text = files.read(path);
    return text === null ? null : importsOf(path, text);
  };

  const matches = new Map<string, ExistingMatch>();
  const directTestsOf = new Map<string, string[]>();

  // Tests that import a changed file themselves: tests among the affected
  // files at one import, and changed tests, which the walk starts from.
  const directCandidates = [
    ...radius.traversal.reached
      .filter((entry) => entry.depth === 1 && testRule.has(pathOf(entry.file)))
      .map((entry) => entry.file),
    ...mapping.starts.filter((id) => testRule.has(pathOf(id))),
  ];
  for (const id of directCandidates) {
    const test = pathOf(id);
    // An import of types only runs none of the code, so it does not tie a
    // test to the change.
    const imported = (index.dependencies.get(id) ?? []).filter(
      (target) =>
        startPaths.has(pathOf(target)) &&
        !testRule.has(pathOf(target)) &&
        edgeByPair.get(`${id}\n${target}`)?.typeOnly === false,
    );
    if (imported.length === 0) continue;
    const bindings = bindingsOf(test);
    let best: TestRelationship = "imports-changed-file";
    let importLine: number | null = null;
    let symbol: string | null = null;
    // By name first: the strongest tie leads.
    const byName: string[] = [];
    const evidence: string[] = [];
    const changed: FileReference[] = [];
    for (const target of imported) {
      const targetPath = pathOf(target);
      const edge = edgeByPair.get(`${id}\n${target}`);
      if (!edge) throw new Error(`The graph lists ${test} as importing ${targetPath} with no edge.`);
      const lines = edge.evidence.map((piece) => piece.line);
      importLine ??= Math.min(...lines);
      const fromEdge = bindings?.filter((binding) =>
        edge.evidence.some((piece) => piece.line === binding.line && piece.specifier === binding.specifier),
      );
      const names = [...new Set((fromEdge ?? []).flatMap((binding) => binding.names))];
      const whole = (fromEdge ?? []).some((binding) => binding.whole);
      const exported = changedExports(targetPath);
      const matched = exported ? names.filter((name) => exported.includes(name)) : [];
      const where = `${targetPath} at ${linesText([...new Set(lines)].sort((a, b) => a - b))}`;
      if (matched.length > 0) {
        best = "imports-changed-symbol";
        const declared = (declarations.get(targetPath) ?? []).filter((declaration) =>
          declaration.exportedAs.some((name) => matched.includes(name)),
        );
        symbol ??= declared[0]?.name ?? matched[0];
        byName.push(
          `Imports ${listed(matched)} from ${where}; this pull request changes ${listed(
            declared.map((declaration) => `${declaration.name} (${span(declaration.startLine, declaration.endLine)})`),
          )}.`,
        );
        changed.push(referenceTo(targetPath, matched));
        continue;
      }
      changed.push(referenceTo(targetPath));
      if (!bindings || !fromEdge || fromEdge.length === 0) {
        evidence.push(`Imports ${where} (${edge.kinds.join(", ")}); which names it uses could not be read.`);
      } else if (whole) {
        evidence.push(`Imports the whole of ${where}, so it may use any part of it.`);
      } else if (exported === null) {
        evidence.push(
          `Imports ${names.length > 0 ? listed(names) : "it for its side effects"} from ${where}. Which declarations changed in it is unknown.`,
        );
      } else if (exported.length === 0) {
        evidence.push(
          `Imports ${names.length > 0 ? listed(names) : "it for its side effects"} from ${where}. The changed lines are in no exported declaration, so they may run through what it imports.`,
        );
      } else {
        evidence.push(
          `Imports ${names.length > 0 ? listed(names) : "it for its side effects"} from ${where}, but not ${listed(exported)}, which hold the changed lines.`,
        );
      }
    }
    evidence.unshift(...byName);
    if (startPaths.has(test)) evidence.push("This pull request also changes this test.");
    for (const target of imported) {
      const list = directTestsOf.get(pathOf(target)) ?? [];
      list.push(test);
      directTestsOf.set(pathOf(target), list);
    }
    matches.set(test, { test, relationship: best, depth: 1, changed, importLine, symbol, evidence });
  }

  // Changed tests that import no changed file directly.
  for (const id of mapping.starts) {
    const test = pathOf(id);
    if (!testRule.has(test) || matches.has(test)) continue;
    matches.set(test, {
      test,
      relationship: "changed-in-pull-request",
      depth: 0,
      changed: [{ path: test, startLine: null, endLine: null }],
      importLine: null,
      symbol: null,
      evidence: ["This pull request changes this test file. It does not import another changed file directly."],
    });
  }

  // Tests that reach the change only through other files. One at a single
  // import that imports only types was left out above and stays out.
  for (const entry of radius.traversal.reached) {
    const test = pathOf(entry.file);
    if (entry.depth < 2 || !testRule.has(test) || matches.has(test)) continue;
    const chain = entry.path.map(pathOf);
    matches.set(test, {
      test,
      relationship: "imports-indirectly",
      depth: entry.depth,
      changed: [referenceTo(chain[0])],
      importLine: null,
      symbol: null,
      evidence: [
        `Reaches ${chain[0]} through ${plural(entry.depth, "import", "imports")}: ${[...chain].reverse().join(" → ")}, each importing the next.`,
      ],
    });
  }

  const directlyTested = changedCode.filter((path) => directTestsOf.has(path));

  // Tests named like a changed file that no import ties to the change.
  const testsByStem = new Map<string, string[]>();
  for (const test of [...testRule.keys()].sort(byText)) {
    const stem = stemOf(test);
    testsByStem.set(stem, [...(testsByStem.get(stem) ?? []), test]);
  }
  const typesOnly = (test: string, path: string) => {
    const from = nodeByPath.get(test);
    const to = nodeByPath.get(path);
    return from !== undefined && to !== undefined && edgeByPair.get(`${from.id}\n${to.id}`)?.typeOnly === true;
  };
  for (const path of changedCode) {
    if (directTestsOf.has(path)) continue;
    const stem = stemOf(path);
    if (stem === "index") continue;
    for (const test of (testsByStem.get(stem) ?? []).slice(0, NAME_MATCHES_PER_FILE)) {
      if (matches.has(test)) continue;
      matches.set(test, {
        test,
        relationship: "name-only",
        depth: Number.MAX_SAFE_INTEGER,
        changed: [referenceTo(path)],
        importLine: null,
        symbol: null,
        evidence: [
          typesOnly(test, path)
            ? `Named like ${path}, and imports only types from it, which runs none of its code.`
            : `Named like ${path}, but no import of it was found in the graph. The graph's unresolved imports may hide one.`,
        ],
      });
    }
  }

  const existing = [...matches.values()].sort(
    (a, b) =>
      (RELATIONSHIP_ORDER.get(a.relationship) ?? 0) - (RELATIONSHIP_ORDER.get(b.relationship) ?? 0) ||
      a.depth - b.depth ||
      byText(a.test, b.test),
  );
  const existingRecommendations: TestRecommendation[] = existing
    .slice(0, EXISTING_TEST_LIMIT)
    .map((match) => {
      const confidence = confidenceOf(match.relationship);
      return {
        kind: "existing_test",
        title: match.test,
        description: DESCRIPTION[match.relationship],
        rationale: RATIONALE[match.relationship],
        priority: priorityOf(confidence),
        status: "found",
        confidence,
        relationship: match.relationship,
        symbol: match.symbol,
        riskAddressed: "regression",
        relatedChangedFiles: match.changed,
        relatedTestFiles: [
          {
            path: match.test,
            startLine: match.importLine,
            endLine: match.importLine,
            relationshipEvidence: match.evidence[0] ?? null,
          },
        ],
        command: null,
        workingDirectory: null,
        evidence: match.evidence,
      };
    });

  // ── The test command ─────────────────────────────────────────────────────
  const strongTests = existing
    .filter((match) => confidenceOf(match.relationship) !== "low")
    .map((match) => match.test);
  // Only worth naming when there is something for it to test.
  const command =
    changedCode.length > 0 || existing.length > 0
      ? findCommand(files, nodeByPath, strongTests)
      : { recommendation: null, detail: "No changed source file or related test was found, so no test command is suggested." };

  // ── Scenarios ────────────────────────────────────────────────────────────
  const priorityFor = (path: string, declaration: ChangedDeclaration, handlesRoute: boolean): Priority => {
    if (declaration.exportedAs.length === 0) return "low";
    const node = nodeByPath.get(path);
    const importers = node ? (index.dependents.get(node.id)?.length ?? 0) : 0;
    const critical = node !== undefined && CRITICAL_ROLES.includes(node.role.id);
    return handlesRoute || critical || importers >= DIRECT_DEPENDENTS_MEDIUM ? "high" : "medium";
  };
  const relatedTests = (path: string): TestFileReference[] =>
    (directTestsOf.get(path) ?? []).slice(0, RELATED_TESTS_SHOWN).map((test) => ({
      path: test,
      startLine: matches.get(test)?.importLine ?? null,
      endLine: matches.get(test)?.importLine ?? null,
      relationshipEvidence: "An existing test that imports this file; the scenario may fit there.",
    }));

  const ranked: { recommendation: TestRecommendation; order: number }[] = [];
  for (const path of changedCode) {
    const found = declarations.get(path);
    const node = nodeByPath.get(path);
    if (!found || !node) continue;
    const importers = (index.dependents.get(node.id) ?? []).map(pathOf).sort(byText);
    for (const declaration of found) {
      if (declaration.kind === "type") continue;
      const routes = output.routes.filter(
        (route) =>
          route.file === path &&
          route.handler !== null &&
          (route.handler === declaration.name || declaration.exportedAs.includes(route.handler)),
      );
      const priority = priorityFor(path, declaration, routes.length > 0);
      const own: { recommendation: TestRecommendation; order: number }[] = [];
      const scenario = (
        kind: FeatureKind | "route",
        lines: readonly number[],
        description: string,
        rationale: string,
        evidence: string[],
      ) => {
        own.push({ order: SCENARIO_ORDER.indexOf(kind), recommendation: {
          kind: "suggested_scenario",
          title: SCENARIO_RULES[kind].title(declaration.name),
          description,
          rationale,
          priority,
          status: "suggested",
          confidence: "medium",
          relationship: null,
          symbol: declaration.name,
          riskAddressed: SCENARIO_RULES[kind].riskAddressed,
          relatedChangedFiles: [
            {
              path,
              startLine: lines.length > 0 ? Math.min(...lines) : declaration.startLine,
              endLine: lines.length > 0 ? Math.max(...lines) : declaration.endLine,
            },
          ],
          relatedTestFiles: relatedTests(path),
          command: null,
          workingDirectory: null,
          evidence: [
            ...evidence,
            `${declaration.name} is at ${span(declaration.startLine, declaration.endLine)} of ${path}${
              declaration.exportedAs.length > 0 ? `, exported as ${listed(declaration.exportedAs)}` : ", not exported"
            }.`,
          ],
        } });
      };

      for (const route of routes) {
        const target = route.kind === "http" ? `${route.method ?? "ANY"} ${route.pattern}` : route.pattern;
        scenario(
          "route",
          route.line !== null ? [route.line] : [],
          route.kind === "http"
            ? `Send ${route.method === "ANY" ? "requests" : `a ${route.method} request`} to ${route.pattern} and check the response, including one the handler should refuse.`
            : `Open ${route.pattern} and check it renders as intended.`,
          `This pull request changes ${declaration.name}, which handles ${target}.`,
          [`Route read from the source: ${route.evidence}`],
        );
      }
      const { features } = declaration;
      if (features.signature && importers.length > 0) {
        scenario(
          "signature",
          features.signature,
          `Check that the ${plural(importers.length, "file", "files")} importing ${path} still call ${declaration.name} correctly after the change at ${linesText(features.signature)}.`,
          `The parameters or return type of exported ${declaration.name} changed, and other files import it.`,
          [`Imported directly by ${listed(importers.slice(0, 5))}${importers.length > 5 ? ` and ${importers.length - 5} more` : ""}.`],
        );
      }
      if (features.throw) {
        scenario(
          "throw",
          features.throw,
          `Drive ${declaration.name} into the throw at ${linesText(features.throw)} and check what its caller receives.`,
          "This pull request adds a throw statement there.",
          [`throw at ${linesText(features.throw)}.`],
        );
      }
      if (features.catch) {
        scenario(
          "catch",
          features.catch,
          `Make the operation guarded by the catch at ${linesText(features.catch)} fail, and check what ${declaration.name} does instead.`,
          "This pull request adds or edits error handling there.",
          [`catch at ${linesText(features.catch)}.`],
        );
      }
      if (features.branch) {
        scenario(
          "branch",
          features.branch,
          `Cover the case where the condition at ${linesText(features.branch)} holds and the case where it does not.`,
          `This pull request adds or edits ${plural(features.branch.length, "condition", "conditions")} (if, ?: or switch case) in ${declaration.name}.`,
          [`Conditions at ${linesText(features.branch)}.`],
        );
      }
      if (features.fallback) {
        scenario(
          "fallback",
          features.fallback,
          `Call ${declaration.name} with the value guarded at ${linesText(features.fallback)} absent (undefined or null) and present.`,
          "This pull request adds a default value, ?? or ?. there, which behaves differently when a value is missing.",
          [`Default, ?? or ?. at ${linesText(features.fallback)}.`],
        );
      }
      if (features.await && !features.catch) {
        scenario(
          "await",
          features.await,
          `Make the call awaited at ${linesText(features.await)} reject, and check how ${declaration.name} responds.`,
          "This pull request adds an await there, and no catch was added with it.",
          [`await at ${linesText(features.await)}.`],
        );
      }
      ranked.push(...own.slice(0, SCENARIOS_PER_DECLARATION));
    }
  }
  const scenarios = ranked
    .sort(
      ({ recommendation: a, order: orderA }, { recommendation: b, order: orderB }) =>
        PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] ||
        byText(a.relatedChangedFiles[0].path, b.relatedChangedFiles[0].path) ||
        (a.relatedChangedFiles[0].startLine ?? 0) - (b.relatedChangedFiles[0].startLine ?? 0) ||
        orderA - orderB,
    )
    .map((entry) => entry.recommendation);

  // ── Changed files with no test found ─────────────────────────────────────
  const reachedBy = new Map<string, string[]>();
  for (const match of existing) {
    if (match.relationship !== "imports-indirectly" && match.relationship !== "name-only") continue;
    for (const reference of match.changed) {
      reachedBy.set(reference.path, [...(reachedBy.get(reference.path) ?? []), match.test]);
    }
  }
  const unknown: TestRecommendation[] = [];
  for (const path of changedCode) {
    if (directTestsOf.has(path)) continue;
    const node = nodeByPath.get(path);
    if (!node) continue;
    const found = declarations.get(path);
    const exported = (found ?? []).filter((declaration) => declaration.exportedAs.length > 0);
    const importerCount = index.dependents.get(node.id)?.length ?? 0;
    const critical = CRITICAL_ROLES.includes(node.role.id);
    const handlesRoute = output.routes.some((route) => route.file === path);
    const priority: Priority =
      critical || handlesRoute || importerCount >= DIRECT_DEPENDENTS_MEDIUM
        ? "high"
        : exported.length > 0 || found === undefined
          ? "medium"
          : "low";
    const weaker = reachedBy.get(path) ?? [];
    const evidence: string[] = [];
    if (found === undefined) {
      evidence.push(
        symbolsUnread.find((entry) => entry.path === path)?.reason ??
          "Its declarations were not read.",
      );
    } else if (found.length > 0) {
      evidence.push(
        `Changed declarations: ${listed(
          found.slice(0, 5).map((declaration) => `${declaration.name} (${span(declaration.startLine, declaration.endLine)})`),
        )}${found.length > 5 ? ` and ${found.length - 5} more` : ""}.`,
      );
    }
    evidence.push(`Imported directly by ${plural(importerCount, "file", "files")}.`);
    if (critical) evidence.push(`Its role is ${node.role.id}: ${node.role.reason}`);
    unknown.push({
      kind: "coverage_unknown",
      title: `No test found importing ${path}`,
      description:
        testRule.size === 0
          ? "No file in this repository was identified as a test by the rules used."
          : `No test file identified by this analysis imports it directly.${
              weaker.length > 0
                ? ` ${plural(weaker.length, "test is", "tests are")} only linked indirectly or by name.`
                : ""
            }`,
      rationale:
        "Coverage data was not available, so this is not a confirmed gap: it may be tested in ways imports do not show, such as end-to-end tests.",
      priority,
      status: "unknown",
      confidence: output.coverage.unresolvedByReason.length > 0 ? "low" : "medium",
      relationship: null,
      symbol: exported[0]?.name ?? null,
      riskAddressed: null,
      relatedChangedFiles: [
        found && found.length > 0
          ? {
              path,
              startLine: Math.min(...found.map((declaration) => declaration.startLine)),
              endLine: Math.max(...found.map((declaration) => declaration.endLine)),
            }
          : { path, startLine: null, endLine: null },
      ],
      relatedTestFiles: weaker.slice(0, RELATED_TESTS_SHOWN).map((test) => ({
        path: test,
        startLine: null,
        endLine: null,
        relationshipEvidence: matches.get(test)?.evidence[0] ?? null,
      })),
      command: null,
      workingDirectory: null,
      evidence,
    });
  }
  unknown.sort(
    (a, b) =>
      PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] ||
      byText(a.relatedChangedFiles[0].path, b.relatedChangedFiles[0].path),
  );

  // ── Checked against the graph before anything leaves ─────────────────────
  // Every changed path is a changed file of this report and every test path
  // a file at the head commit; a line outside its file is dropped.
  const changedPaths = new Set(mapping.changed.map((file) => file.path));
  const lineCountOf = (path: string) => nodeByPath.get(path)?.lineCount ?? 0;
  const checkedLines = <T extends FileReference>(reference: T): T => {
    const count = lineCountOf(reference.path);
    const inside = (line: number | null) => line !== null && line >= 1 && line <= count;
    return inside(reference.startLine) && inside(reference.endLine)
      ? reference
      : { ...reference, startLine: null, endLine: null };
  };
  const validated = (recommendation: TestRecommendation): TestRecommendation => ({
    ...recommendation,
    relatedChangedFiles: recommendation.relatedChangedFiles
      .filter((reference) => changedPaths.has(reference.path))
      .map(checkedLines),
    relatedTestFiles: recommendation.relatedTestFiles
      .filter((reference) => nodeByPath.has(reference.path))
      .map(checkedLines),
  });

  const recommendations = [
    ...existingRecommendations,
    ...(command.recommendation ? [command.recommendation] : []),
    ...scenarios.slice(0, SCENARIO_LIMIT),
    ...unknown.slice(0, COVERAGE_UNKNOWN_LIMIT),
  ].map(validated);

  const limitations: Limitation[] = [];
  if (symbolsUnread.length > 0) {
    limitations.push({
      id: "test-symbols-unread",
      detail: `For ${plural(symbolsUnread.length, "changed file", "changed files")}, which declarations changed could not be read. Tests were matched to ${symbolsUnread.length === 1 ? "it" : "them"} by import only, and no scenario is suggested for ${symbolsUnread.length === 1 ? "it" : "them"}.`,
      files: symbolsUnread.slice(0, 20).map((entry) => entry.path),
    });
  }

  return {
    recommendations,
    discovery: {
      testFileCount: testRule.size,
      conventions: [...conventionCounts.entries()]
        .map(([rule, count]) => ({ rule, count }))
        .sort((a, b) => b.count - a.count || byText(a.rule, b.rule)),
      frameworks: [...frameworks].sort(byText),
      omitted: {
        existing: Math.max(0, existing.length - EXISTING_TEST_LIMIT),
        scenarios: Math.max(0, scenarios.length - SCENARIO_LIMIT),
        coverageUnknown: Math.max(0, unknown.length - COVERAGE_UNKNOWN_LIMIT),
      },
      coverageData: TEST_RULES.coverage,
      command: { found: command.recommendation !== null, detail: command.detail },
      symbolsUnread,
    },
    evidence: { changedCode, directlyTested, testFileCount: testRule.size },
    limitations,
  };
}

// ── Command ──────────────────────────────────────────────────────────────────

const PLACEHOLDER_SCRIPT = /no test specified/i;
// A single vitest or jest call with flags only, which takes file filters.
const FILTERABLE = /^(?:npx\s+)?(vitest|jest)(?:\s+run)?(?:\s+--?[\w-]+(?:=[^\s&|;]+)?)*\s*$/;

type Manager = "pnpm" | "yarn" | "bun" | "npm";
const LOCKFILES: [string, Manager][] = [
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
  ["package-lock.json", "npm"],
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function readManifest(files: RepositoryFiles, path: string): Record<string, unknown> | null {
  const text = files.read(path);
  if (text === null) return null;
  try {
    const value: unknown = JSON.parse(text);
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function testScriptOf(manifest: Record<string, unknown> | null): string | null {
  const scripts = manifest?.scripts;
  if (!isRecord(scripts)) return null;
  const test = scripts.test;
  return typeof test === "string" && test.trim() !== "" && !PLACEHOLDER_SCRIPT.test(test)
    ? test.trim().slice(0, 200)
    : null;
}

function findCommand(
  files: RepositoryFiles,
  nodeByPath: ReadonlyMap<string, FileNode>,
  tests: readonly string[],
): { recommendation: TestRecommendation | null; detail: string } {
  const manifestAt = (root: string) => (root === "" ? "package.json" : `${root}/package.json`);

  // The package holding most of the related tests, else the repository root.
  const byRoot = new Map<string, string[]>();
  for (const test of tests) {
    const root = nodeByPath.get(test)?.package?.root;
    if (root === undefined) continue;
    byRoot.set(root, [...(byRoot.get(root) ?? []), test]);
  }
  const roots = [...byRoot.entries()].sort((a, b) => b[1].length - a[1].length || byText(a[0], b[0]));
  const candidates = [...new Set([...roots.map(([root]) => root), ""])];
  let root: string | null = null;
  let script: string | null = null;
  for (const candidate of candidates) {
    script = testScriptOf(readManifest(files, manifestAt(candidate)));
    if (script !== null) {
      root = candidate;
      break;
    }
  }
  if (root === null || script === null) {
    return {
      recommendation: null,
      detail:
        "The project's test command could not be identified: no package.json with a test script was found at the repository root or beside the related tests.",
    };
  }

  const evidence = [`scripts.test in ${manifestAt(root)} is “${script}”.`];
  let manager: Manager | null = null;
  const declared = readManifest(files, "package.json")?.packageManager;
  if (typeof declared === "string") {
    const name = declared.split("@")[0];
    if (name === "pnpm" || name === "yarn" || name === "bun" || name === "npm") {
      manager = name;
      evidence.push(`The root package.json names ${declared} as its package manager.`);
    }
  }
  if (manager === null) {
    for (const [lockfile, owner] of LOCKFILES) {
      const at = root !== "" && files.exists(`${root}/${lockfile}`) ? `${root}/${lockfile}` : lockfile;
      if (files.exists(at)) {
        manager = owner;
        evidence.push(`${at} is present.`);
        break;
      }
    }
  }
  const confidence: Confidence = manager === null ? "medium" : "high";
  if (manager === null) {
    manager = "npm";
    evidence.push("No lockfile or packageManager field was found, so npm is assumed.");
  }

  const base = manager === "npm" ? "npm test" : manager === "bun" ? "bun run test" : `${manager} test`;
  const local = (byRoot.get(root) ?? []).map((test) => (root === "" ? test : test.slice(root.length + 1)));
  const runner = FILTERABLE.exec(script)?.[1];
  let command = base;
  let title = "Run the repository's tests";
  if (runner && local.length > 0 && local.length <= PATHS_IN_COMMAND) {
    const paths = local.map(quoted).join(" ");
    command = manager === "npm" ? `${base} -- ${paths}` : `${base} ${paths}`;
    title = `Run the ${plural(local.length, "related test file", "related test files")}`;
    evidence.push(
      `Narrowed to the test files that import changed code: the script is a single ${runner} call, which takes file filters.`,
    );
  }
  return {
    recommendation: {
      kind: "test_command",
      title,
      description: root === "" ? `Run ${command}.` : `Run ${command} in ${root}.`,
      rationale:
        "Taken from the repository's own package.json. Impactlia has not run it and has no test results.",
      priority: "medium",
      status: "found",
      confidence,
      relationship: null,
      symbol: null,
      riskAddressed: null,
      relatedChangedFiles: [],
      relatedTestFiles: [],
      command,
      workingDirectory: root,
      evidence,
    },
    detail: evidence.join(" "),
  };
}
