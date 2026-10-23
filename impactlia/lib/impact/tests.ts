import type { FileNode, Language, ParserOutput } from "../../parser/contract";
import type { Grammars } from "../../parser/languages/tree-sitter";
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
import { SUPPORTED_LANGUAGES, supportedLanguageOf } from "../../parser/languages/registry";
import { changedPythonDeclarations, pythonImportsOf } from "./python-syntax";
import type { RepositoryFiles } from "./repository-files";
import { CRITICAL_ROLES, DIRECT_DEPENDENTS_MEDIUM } from "./risk";
import { TEST_RULES, TEST_RUNNERS } from "./test-rules";
import {
  changedDeclarations,
  importsOf,
  type ChangedDeclaration,
  type ChangedLines,
  type FeatureKind,
  type ImportBinding,
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
//
// TypeScript and JavaScript are read with the TypeScript parser (syntax.ts),
// Python with tree-sitter (python-syntax.ts). The method is the same for both;
// only the syntax each feature kind stands for, and the test command, differ.

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

// "src/format.test.ts" → "format"; "src/__tests__/format.tsx" → "format";
// "tests/test_format.py", "format_test.go" and "format_unittest.cc" →
// "format"; "FormatTest.java", "FormatTests.cs" and "FormatTest.php" →
// "Format". Each language's own test naming is undone, and only its own.
function stemOf(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  const extension = dot <= 0 ? "" : base.slice(dot);
  const name = dot <= 0 ? base : base.slice(0, dot);
  switch (supportedLanguageOf(base)) {
    case "python":
      return name.replace(/^test_/, "").replace(/_test$/, "");
    case "go":
      return name.replace(/_test$/, "");
    case "java":
    case "csharp":
    case "php":
      return name.replace(/(.)(Tests?|TestCase|IT)$/, "$1");
    case "c":
    case "cpp":
      return name.replace(/^test_/, "").replace(/_(unit)?test$/, "");
    case "rust":
      return name;
    default:
      return extension === "" ? base : base.replace(/\.[cm]?[jt]sx?$/, "").replace(/\.(test|spec)$/, "");
  }
}

// How a language's changed declarations and a test's imports are read. A
// language with none has its tests matched by import and by name only, and
// no scenarios are suggested for it.
type SyntaxReader = {
  declarations: (path: string, text: string, lines: ChangedLines) => ChangedDeclaration[];
  imports: (path: string, text: string) => ImportBinding[];
};
function syntaxReader(language: Language, grammars: Grammars): SyntaxReader | null {
  if (language === "typescript" || language === "javascript") {
    return { declarations: changedDeclarations, imports: importsOf };
  }
  if (language === "python") {
    return {
      declarations: (_path, text, lines) => changedPythonDeclarations(grammars, text, lines),
      imports: (_path, text) => pythonImportsOf(grammars, text),
    };
  }
  return null;
}

// A module named only for its folder says nothing about what tests it.
const PACKAGE_STEMS = new Set(["index", "__init__", "mod"]);

// The words a scenario uses for the syntax it points at.
type Wording = {
  throw: string;
  catch: string;
  branch: string;
  missing: string;
  fallback: string;
  fallbackEvidence: string;
};
const JAVASCRIPT_WORDING: Wording = {
  throw: "throw",
  catch: "catch",
  branch: "if, ?: or switch case",
  missing: "undefined or null",
  fallback: "a default value, ?? or ?.",
  fallbackEvidence: "Default, ?? or ?.",
};
// Only the languages scenarios are suggested for (see syntaxReader).
const WORDING: Partial<Record<Language, Wording>> = {
  typescript: JAVASCRIPT_WORDING,
  javascript: JAVASCRIPT_WORDING,
  python: {
    throw: "raise",
    catch: "except",
    branch: "if, elif, conditional expression or match case",
    missing: "left out or None",
    fallback: "a default parameter value",
    fallbackEvidence: "Default parameter value",
  },
};

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
  grammars: Grammars,
): TestFindings {
  const nodeById = new Map<string, FileNode>(output.files.map((file) => [file.id, file]));
  const nodeByPath = new Map<string, FileNode>(output.files.map((file) => [file.path, file]));
  const changeByPath = new Map(changes.files.map((file) => [file.path, file]));
  const edgeByPair = new Map(output.edges.map((edge) => [`${edge.source}\n${edge.target}`, edge]));
  const pathOf = (id: string) => nodeById.get(id)?.path ?? id;
  // Every file of the repository that is not source, by path: where build
  // files (pom.xml, *.csproj) are looked for.
  const projectFiles = output.excluded.filter((entry) => entry.type === "file").map((entry) => entry.path);
  const readerOf = (path: string) => {
    const language = nodeByPath.get(path)?.language;
    return language ? syntaxReader(language, grammars) : null;
  };
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
    const reader = readerOf(path);
    if (!reader) {
      const language = nodeByPath.get(path)?.language;
      symbolsUnread.push({
        path,
        reason: `Which declarations changed is not read for ${language ? SUPPORTED_LANGUAGES[language].label : "these"} files yet; tests were matched to it by import and by name.`,
      });
      continue;
    }
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
    let found = reader.declarations(path, text, lines);
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
    const reader = readerOf(path);
    const text = reader ? files.read(path) : null;
    return reader && text !== null ? reader.imports(path, text) : null;
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
    if (PACKAGE_STEMS.has(stem)) continue;
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
      ? findCommand(files, nodeByPath, strongTests, changedCode, frameworks, projectFiles)
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
      const words = WORDING[node.language] ?? JAVASCRIPT_WORDING;
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
          `This pull request adds a ${words.throw} statement there.`,
          [`${words.throw} at ${linesText(features.throw)}.`],
        );
      }
      if (features.catch) {
        scenario(
          "catch",
          features.catch,
          `Make the operation guarded by the ${words.catch} at ${linesText(features.catch)} fail, and check what ${declaration.name} does instead.`,
          "This pull request adds or edits error handling there.",
          [`${words.catch} at ${linesText(features.catch)}.`],
        );
      }
      if (features.branch) {
        scenario(
          "branch",
          features.branch,
          `Cover the case where the condition at ${linesText(features.branch)} holds and the case where it does not.`,
          `This pull request adds or edits ${plural(features.branch.length, "condition", "conditions")} (${words.branch}) in ${declaration.name}.`,
          [`Conditions at ${linesText(features.branch)}.`],
        );
      }
      if (features.fallback) {
        scenario(
          "fallback",
          features.fallback,
          `Call ${declaration.name} with the value guarded at ${linesText(features.fallback)} absent (${words.missing}) and present.`,
          `This pull request adds ${words.fallback} there, which behaves differently when a value is missing.`,
          [`${words.fallbackEvidence} at ${linesText(features.fallback)}.`],
        );
      }
      if (features.await && !features.catch) {
        scenario(
          "await",
          features.await,
          `Make the call awaited at ${linesText(features.await)} reject, and check how ${declaration.name} responds.`,
          `This pull request adds an await there, and no ${words.catch} was added with it.`,
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

type CommandFinding = { recommendation: TestRecommendation | null; detail: string };

// The command for the language most of the related tests are in; with no
// related test, the language of the changed code. A tie goes to the
// package.json command, the one Impactlia has always looked for. Each is
// named only from the repository's own build files, and never run.
function findCommand(
  files: RepositoryFiles,
  nodeByPath: ReadonlyMap<string, FileNode>,
  tests: readonly string[],
  changedCode: readonly string[],
  frameworks: ReadonlySet<string>,
  projectFiles: readonly string[],
): CommandFinding {
  const deciding = tests.length > 0 ? tests : changedCode;
  const counts = new Map<Language, number>();
  for (const path of deciding) {
    const language = nodeByPath.get(path)?.language;
    if (language) counts.set(language, (counts.get(language) ?? 0) + 1);
  }
  const javascript = (counts.get("typescript") ?? 0) + (counts.get("javascript") ?? 0);
  let language: Language | null = null;
  let most = javascript;
  for (const [candidate, count] of counts) {
    if (candidate !== "typescript" && candidate !== "javascript" && count > most) {
      language = candidate;
      most = count;
    }
  }
  const own = tests.filter((test) => language !== null && nodeByPath.get(test)?.language === language);
  switch (language) {
    case null:
      return findPackageCommand(files, nodeByPath, tests);
    case "python":
      return findPytestCommand(files, own, frameworks);
    case "go":
      return findBuildCommand(files, own, BUILD_TOOLS.go);
    case "rust":
      return findBuildCommand(files, own, BUILD_TOOLS.rust);
    case "java": {
      const maven = findBuildCommand(files, own, BUILD_TOOLS.maven);
      if (maven.recommendation) return maven;
      const gradle = findBuildCommand(files, own, BUILD_TOOLS.gradle);
      return gradle.recommendation
        ? gradle
        : { recommendation: null, detail: "No test command could be identified: no pom.xml or build.gradle was found beside the related tests or at the repository root." };
    }
    case "csharp":
      return findDotnetCommand(projectFiles, own);
    case "php":
      return findBuildCommand(files, own, BUILD_TOOLS.phpunit);
    case "c":
    case "cpp":
      return {
        recommendation: null,
        detail: "No test command is suggested for C or C++: their build systems are too varied to name one from the files alone.",
      };
  }
}

const parentFolder = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");

// The folders above the related tests, nearest first, then the root.
function foldersAbove(tests: readonly string[]): string[] {
  const folders: string[] = [];
  for (const test of [...tests].sort(byText)) {
    for (let folder = parentFolder(test); ; folder = parentFolder(folder)) {
      if (!folders.includes(folder)) folders.push(folder);
      if (folder === "") break;
    }
  }
  if (!folders.includes("")) folders.push("");
  return folders;
}

function commandRecommendation(
  command: string,
  root: string,
  narrowed: number,
  evidence: string[],
  rationale: string,
  confidence: Confidence,
): TestRecommendation {
  return {
    kind: "test_command",
    title: narrowed > 0 ? `Run the ${plural(narrowed, "related test file", "related test files")}` : "Run the repository's tests",
    description: root === "" ? `Run ${command}.` : `Run ${command} in ${root}.`,
    rationale,
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
  };
}

// A tool found by its build file, nearest the related tests first. `narrow`
// turns the related tests, relative to the build file's folder, into the
// arguments that run only them, or null when the tool cannot.
type BuildTool = {
  label: string;
  file: string;
  command: string;
  narrow: ((tests: string[]) => string | null) | null;
  // A file beside the build file that changes the command, like gradlew.
  wrapper?: { file: string; command: string };
};
const className = (path: string) => path.slice(path.lastIndexOf("/") + 1).replace(/\.[^.]+$/, "");
const BUILD_TOOLS = {
  go: {
    label: "Go",
    file: "go.mod",
    command: "go test",
    // A package is a folder; ./... would run everything.
    narrow: (tests) => [...new Set(tests.map((test) => `./${parentFolder(test) || "."}`.replace(/\/\.$/, "")))].join(" "),
  },
  rust: { label: "Cargo", file: "Cargo.toml", command: "cargo test", narrow: null },
  maven: {
    label: "Maven",
    file: "pom.xml",
    command: "mvn test",
    narrow: (tests) => `-Dtest=${[...new Set(tests.map(className))].join(",")}`,
  },
  gradle: {
    label: "Gradle",
    file: "build.gradle",
    command: "gradle test",
    narrow: (tests) => [...new Set(tests.map(className))].map((name) => `--tests ${name}`).join(" "),
    wrapper: { file: "gradlew", command: "./gradlew test" },
  },
  phpunit: {
    label: "PHPUnit",
    file: "phpunit.xml",
    command: "vendor/bin/phpunit",
    // PHPUnit takes one test file or folder.
    narrow: (tests) => (tests.length === 1 ? quoted(tests[0]) : null),
  },
} satisfies Record<string, BuildTool>;

function findBuildCommand(files: RepositoryFiles, tests: readonly string[], tool: BuildTool): CommandFinding {
  // Gradle's Kotlin build file and PHPUnit's distributed config count too.
  const names = [tool.file, `${tool.file}.kts`, `${tool.file}.dist`];
  for (const folder of foldersAbove(tests)) {
    const found = names.map((name) => (folder === "" ? name : `${folder}/${name}`)).find((at) => files.exists(at));
    if (!found) continue;
    const evidence = [`${found} is present.`];
    let command = tool.command;
    const wrapper = tool.wrapper && files.exists(folder === "" ? tool.wrapper.file : `${folder}/${tool.wrapper.file}`);
    if (tool.wrapper && wrapper) {
      command = tool.wrapper.command;
      evidence.push(`The ${tool.wrapper.file} wrapper is beside it.`);
    }
    const local = tests
      .filter((test) => folder === "" || test.startsWith(`${folder}/`))
      .map((test) => (folder === "" ? test : test.slice(folder.length + 1)));
    const narrowed = tool.narrow && local.length > 0 && local.length <= PATHS_IN_COMMAND ? tool.narrow(local) : null;
    if (narrowed) {
      command = `${command} ${narrowed}`;
      evidence.push(`Narrowed to the related tests, which ${tool.label} can select.`);
    }
    return {
      recommendation: commandRecommendation(
        command,
        folder,
        narrowed ? local.length : 0,
        evidence,
        `${tool.label}'s usual test command, chosen because ${found} is present. Impactlia has not run it and has no test results.`,
        "high",
      ),
      detail: evidence.join(" "),
    };
  }
  return {
    recommendation: null,
    detail: `No test command could be identified: no ${tool.file} was found beside the related tests or at the repository root.`,
  };
}

function findDotnetCommand(projectFiles: readonly string[], tests: readonly string[]): CommandFinding {
  // The project the related tests are in, else a solution at the root.
  const projects = projectFiles.filter((path) => path.endsWith(".csproj"));
  const project = foldersAbove(tests)
    .flatMap((folder) => projects.filter((path) => parentFolder(path) === folder))
    .find(() => true);
  const solution = projectFiles.find((path) => !path.includes("/") && path.endsWith(".sln"));
  const target = project ?? solution;
  if (!target) {
    return {
      recommendation: null,
      detail: "No test command could be identified: no .csproj beside the related tests and no .sln at the repository root was found.",
    };
  }
  const command = `dotnet test ${quoted(target)}`;
  return {
    recommendation: commandRecommendation(
      command,
      "",
      0,
      [`${target} is present.`],
      "The .NET command that builds and runs a project's tests. Impactlia has not run it and has no test results.",
      project ? "high" : "medium",
    ),
    detail: `${target} is present.`,
  };
}

function findPackageCommand(
  files: RepositoryFiles,
  nodeByPath: ReadonlyMap<string, FileNode>,
  tests: readonly string[],
): CommandFinding {
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

// pytest is named only when the repository shows it is used: its settings in
// a configuration file it reads, or a test that imports it. A unittest suite
// pytest would also run is not assumed to be run that way.
const PYTEST_SETTINGS: { file: string; section: RegExp | null; label: string }[] = [
  { file: "pytest.ini", section: null, label: "is present" },
  { file: "pyproject.toml", section: /^\[tool\.pytest\.ini_options\]/m, label: "has a [tool.pytest.ini_options] section" },
  { file: "tox.ini", section: /^\[pytest\]/m, label: "has a [pytest] section" },
  { file: "setup.cfg", section: /^\[tool:pytest\]/m, label: "has a [tool:pytest] section" },
];

function findPytestCommand(
  files: RepositoryFiles,
  tests: readonly string[],
  frameworks: ReadonlySet<string>,
): CommandFinding {
  const parentOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
  // The folders above the related tests, nearest first, then the root: where
  // pytest looks for its configuration.
  const folders: string[] = [];
  for (const test of [...tests].sort(byText)) {
    for (let folder = parentOf(test); ; folder = parentOf(folder)) {
      if (!folders.includes(folder)) folders.push(folder);
      if (folder === "") break;
    }
  }
  if (!folders.includes("")) folders.push("");

  let root: string | null = null;
  const evidence: string[] = [];
  search: for (const folder of folders) {
    for (const { file, section, label } of PYTEST_SETTINGS) {
      const at = folder === "" ? file : `${folder}/${file}`;
      const text = section === null ? (files.exists(at) ? "" : null) : files.read(at);
      if (text !== null && (section === null || section.test(text))) {
        root = folder;
        evidence.push(`${at} ${label}.`);
        break search;
      }
    }
  }
  if (frameworks.has("pytest")) evidence.push("A test file imports pytest.");
  if (evidence.length === 0) {
    return {
      recommendation: null,
      detail:
        "No Python test command could be identified: no pytest configuration (pytest.ini, or a pytest section in pyproject.toml, tox.ini or setup.cfg) was found, and no test imports pytest.",
    };
  }
  root ??= "";
  const local = tests
    .filter((test) => root === "" || test.startsWith(`${root}/`))
    .map((test) => (root === "" ? test : test.slice(root.length + 1)));
  let command = "python -m pytest";
  let title = "Run the repository's tests";
  if (local.length > 0 && local.length <= PATHS_IN_COMMAND) {
    command = `${command} ${local.map(quoted).join(" ")}`;
    title = `Run the ${plural(local.length, "related test file", "related test files")}`;
    evidence.push("Narrowed to the related test files: pytest takes file paths.");
  }
  return {
    recommendation: {
      kind: "test_command",
      title,
      description: root === "" ? `Run ${command}.` : `Run ${command} in ${root}.`,
      rationale:
        "Built from the repository's pytest configuration or its tests' imports. Impactlia has not run it and has no test results; the project's dependencies must be installed first.",
      priority: "medium",
      status: "found",
      confidence: evidence[0].startsWith("A test file") ? "medium" : "high",
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
