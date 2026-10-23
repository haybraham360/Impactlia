import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { selectAdapter, type FrameworkAdapter, type Manifest } from "./adapter";
import {
  ANALYZER_VERSION,
  REFERENCE_KINDS,
  SCHEMA_VERSION,
  UNRESOLVED_REASONS,
  type Coverage,
  type ExcludedPath,
  type FileNode,
  type ParserOutput,
  type ReferenceCounts,
  type UnlinkedReference,
} from "./contract";
import {
  binaryFileRule,
  coreExclusionRules,
  generatedFileRule,
  oversizedFileRule,
  symbolicLinkRule,
  unsupportedFileTypeRule,
} from "./exclusions";
import { otherRole, supportingRole } from "./generic-roles";
import { buildEdges, computeMetrics, type ResolvedReference } from "./graph";
import { OverlayUnsupported, type LanguageContext, type LanguageReading } from "./languages/adapter";
import { cAdapter } from "./languages/c";
import { csharpAdapter } from "./languages/csharp";
import { goAdapter } from "./languages/go";
import { javaAdapter } from "./languages/java";
import { phpAdapter } from "./languages/php";
import { pythonAdapter } from "./languages/python";
import { rustAdapter } from "./languages/rust";
import type { Grammars } from "./languages/tree-sitter";
import { readTypeScript } from "./languages/typescript";
import { readPackageDependencies, readPackageName } from "./resolve";
import { FRAMEWORKS } from "./roles";
import { byText, describeSourceFile, walkRepository, type WalkResult } from "./walk";

const EXAMPLES_PER_REASON = 5;

export type ParseOptions = {
  // Files whose contents were kept out before they were written to disk (an
  // oversized source file), by repository path, with the rule that kept each
  // out.
  excludedFiles?: ReadonlyMap<string, string>;
  // Updating a stored graph instead of reading every file: see overlay
  // below.
  overlay?: Overlay;
};

// A stored graph of an earlier commit, and the files that changed since.
//
// The directory then holds every path of the repository as it is now, but
// only the changed files' contents, and the project files resolvers read
// (package.json, tsconfig.json, go.mod, …); every other file may be empty.
// Changed files are parsed; every other file keeps what the stored graph
// recorded about it (its size, hash, parse status, role and routes) and its
// stored references are resolved again, so an import that now names a
// different file says so. The result is the graph a full parse of the
// directory with every file's contents would give, which is what
// checks/overlay.test.ts holds it to.
//
// When that cannot be guaranteed, OverlayUnsupported is raised with the
// reason, and the caller reads the repository in full instead.
export type Overlay = {
  base: ParserOutput;
  changed: ReadonlySet<string>;
};

// Every reference the stored graph read out of each file, from its edges
// and its unlinked references together.
function storedReferences(base: ParserOutput): Map<string, ResolvedReference[]> {
  const byFile = new Map<string, ResolvedReference[]>();
  const add = (reference: ResolvedReference) =>
    byFile.set(reference.source, [...(byFile.get(reference.source) ?? []), reference]);
  for (const edge of base.edges) {
    for (const { kind, specifier, line, typeOnly, via } of edge.evidence) {
      add({
        source: edge.source,
        site: { kind, specifier, expression: null, line, typeOnly },
        resolution: { status: "internal", target: edge.target, via },
      });
    }
  }
  for (const reference of base.unlinkedReferences) {
    const { source, kind, specifier, line, typeOnly } = reference;
    const site = { kind, specifier, expression: null, line, typeOnly };
    const resolution: ResolvedReference["resolution"] =
      reference.status === "external"
        ? { status: "external", externalKind: reference.externalKind, packageName: reference.packageName }
        : reference.status === "excluded"
          ? { status: "excluded", target: reference.target, rule: reference.rule }
          : { status: "unresolved", reason: reference.reason, detail: reference.detail };
    add({ source, site, resolution });
  }
  return byFile;
}

// The rules a file's contents, not its path, decided. A file left out by one
// of them in the stored graph, and unchanged since, is still left out.
const CONTENT_RULES = new Set([oversizedFileRule.id, binaryFileRule.id, generatedFileRule.id]);

const KIND_ORDER = new Map(REFERENCE_KINDS.map((kind, index) => [kind, index]));
const resolutionKey = (resolution: ResolvedReference["resolution"]) =>
  resolution.status === "internal" || resolution.status === "excluded" ? resolution.target : resolution.status;

// One order for a file's references however they were found, so a graph
// updated from a stored one is identical to one read in full.
function byPosition(a: ResolvedReference, b: ResolvedReference): number {
  return (
    byText(a.source, b.source) ||
    a.site.line - b.site.line ||
    (KIND_ORDER.get(a.site.kind) ?? 0) - (KIND_ORDER.get(b.site.kind) ?? 0) ||
    byText(a.site.specifier ?? "", b.site.specifier ?? "") ||
    byText(resolutionKey(a.resolution), resolutionKey(b.resolution))
  );
}

// A NUL byte in the first 8 KB, the test git itself uses for binary files.
function isBinary(bytes: Buffer): boolean {
  return bytes.subarray(0, 8192).includes(0);
}

// The markers generators write at the top of what they generate.
const GENERATED_MARKERS = [
  /^\/\/ Code generated .* DO NOT EDIT\.$/m,
  /^\s*(\/\/|#|\*|\/\*|--|<!--).*@generated\b/m,
  /<auto-generated\b/,
  /Generated by the protocol buffer compiler\.\s+DO NOT EDIT!/,
];
function isGenerated(bytes: Buffer): boolean {
  const head = bytes.subarray(0, 2048).toString("utf8").split("\n").slice(0, 10).join("\n");
  return GENERATED_MARKERS.some((marker) => marker.test(head));
}

function countLines(text: string): number {
  if (text === "") return 0;
  const breaks = text.split("\n").length - 1;
  return text.endsWith("\n") ? breaks : breaks + 1;
}

// Turns a repository on disk into its files and the dependency relationships
// between them. Reads only the local filesystem.
//
// Each language's files go to its language adapter, which parses them and
// resolves their references; the graph is built from all of them together,
// so a mixed-language repository is one graph. An edge between files of two
// languages exists only when a file names the other in an import.
//
// `grammars` come from loadGrammars(). `adapters` are the frameworks to look
// for, in the order to try them. With none, or when none matches, every file
// gets a generic role and there are no routes.
export function parseRepository(
  directory: string,
  grammars: Grammars,
  adapters: FrameworkAdapter[] = [],
  options: ParseOptions = {},
): ParserOutput {
  const root = fs.realpathSync.native(path.resolve(directory));
  if (!fs.statSync(root).isDirectory()) {
    throw new Error(`${root} is not a directory.`);
  }
  if (options.overlay && options.overlay.base.analyzerVersion !== ANALYZER_VERSION) {
    throw new OverlayUnsupported("The stored graph was built by an earlier version of the parser.");
  }

  const rules = coreExclusionRules;
  const walked = walkRepository(root, rules);
  // Files whose contents were left out before they reached the disk, with
  // their rules. An empty file may stand in their place.
  for (const [file, rule] of options.excludedFiles ?? []) walked.skippedFiles.set(file, rule);

  // A file named like source that is binary or marked as generated is left
  // out by rule here, before any resolver sees it, so an import of it is
  // reported as an import of an excluded file.
  const overlay = options.overlay ?? null;
  const baseNodes = new Map((overlay?.base.files ?? []).map((file) => [file.path, file]));
  const baseContentRules = new Map(
    (overlay?.base.excluded ?? []).filter((entry) => entry.type === "file" && CONTENT_RULES.has(entry.rule)).map((entry) => [entry.path, entry.rule]),
  );
  const bytesByPath = new Map<string, Buffer>();
  const sourceFiles: string[] = [];
  for (const relative of walked.sourceFiles) {
    if (options.excludedFiles?.has(relative)) continue;
    if (overlay && !overlay.changed.has(relative)) {
      const rule = baseContentRules.get(relative);
      if (rule) walked.skippedFiles.set(relative, rule);
      else if (baseNodes.has(relative)) sourceFiles.push(relative);
      else throw new OverlayUnsupported(`${relative} is neither in the stored graph nor among the changed files.`);
      continue;
    }
    const bytes = fs.readFileSync(path.join(root, relative));
    const rule = isBinary(bytes) ? binaryFileRule.id : isGenerated(bytes) ? generatedFileRule.id : null;
    if (rule) walked.skippedFiles.set(relative, rule);
    else {
      sourceFiles.push(relative);
      bytesByPath.set(relative, bytes);
    }
  }
  const walk: WalkResult = { ...walked, sourceFiles };

  // Package roots, to give each file its module identity, and what each
  // package depends on, which is how a framework is recognised.
  const packageNameByFolder = new Map<string, string | null>();
  const manifests: Manifest[] = [];
  for (const file of [...walk.skippedFiles.keys()].sort(byText)) {
    if (path.posix.basename(file) === "package.json") {
      const folder = file.includes("/") ? path.posix.dirname(file) : "";
      packageNameByFolder.set(folder, readPackageName(path.join(root, file)));
      manifests.push({
        path: file,
        root: folder,
        dependencies: readPackageDependencies(path.join(root, file)),
      });
    }
  }
  function packageOf(folder: string): FileNode["package"] {
    let current = folder;
    for (;;) {
      const name = packageNameByFolder.get(current);
      if (name !== undefined) return { name, root: current };
      if (current === "") return null;
      current = current.includes("/") ? path.posix.dirname(current) : "";
    }
  }

  const texts = new Map<string, string>();
  const unclassified: Omit<FileNode, "role">[] = walk.sourceFiles.map((relative) => {
    const stored = overlay && !overlay.changed.has(relative) ? baseNodes.get(relative) : undefined;
    // Its role is set again below, from the stored graph.
    if (stored) return { ...stored, package: packageOf(stored.folder) };
    const bytes = bytesByPath.get(relative);
    if (!bytes) throw new Error(`${relative} was not read.`);
    const text = bytes.toString("utf8");
    texts.set(relative, text);
    const name = path.posix.basename(relative);
    const description = describeSourceFile(name);
    if (!description) throw new Error(`${relative} was walked as source but is not a source file.`);
    const folder = relative.includes("/") ? path.posix.dirname(relative) : "";
    return {
      id: relative,
      path: relative,
      name,
      ...description,
      folder,
      folderSegments: folder === "" ? [] : folder.split("/"),
      package: packageOf(folder),
      sizeBytes: bytes.length,
      lineCount: countLines(text),
      contentHash: createHash("sha256").update(bytes).digest("hex"),
      parseStatus: "parsed",
      parseErrors: [],
    };
  });

  // TypeScript and JavaScript come first and on their own, because the
  // framework adapters read their syntax trees.
  // A .h header is C or C++. In a repository with C++ sources it is read as
  // C++, whose grammar also reads C headers; otherwise as C.
  if (unclassified.some((file) => file.language === "cpp")) {
    for (const file of unclassified) if (file.extension === ".h") file.language = "cpp";
  }
  for (const file of unclassified) {
    const stored = overlay && !overlay.changed.has(file.path) ? baseNodes.get(file.path) : undefined;
    if (stored && stored.language !== file.language) {
      throw new OverlayUnsupported(`${file.path} is now read as ${file.language}, not ${stored.language}.`);
    }
  }
  const languageByPath = new Map(unclassified.map((file) => [file.path, file.language]));
  const isStored = (file: string) => overlay !== null && !overlay.changed.has(file);
  const storedByFile = overlay ? storedReferences(overlay.base) : new Map<string, ResolvedReference[]>();
  const context = (languages: readonly string[]): LanguageContext => ({
    root,
    walk,
    files: unclassified
      .filter((file) => languages.includes(file.language) && !isStored(file.path))
      .map((file) => file.path),
    texts,
    // A stored file that failed to parse has no references to resolve.
    stored: new Map(
      unclassified
        .filter((file) => languages.includes(file.language) && isStored(file.path) && file.parseStatus === "parsed")
        .map((file) => [file.path, storedByFile.get(file.path) ?? []]),
    ),
    languageOf: (file) => {
      const language = languageByPath.get(file);
      if (!language) throw new Error(`${file} is not a source file of this repository.`);
      return language;
    },
  });
  const typescript = readTypeScript(context(["typescript", "javascript"]));
  const syntax = typescript.syntax;
  const readings: LanguageReading[] = [
    typescript,
    ...[
      pythonAdapter(grammars),
      javaAdapter(grammars),
      goAdapter(grammars),
      csharpAdapter(grammars),
      cAdapter(grammars),
      rustAdapter(grammars),
      phpAdapter(grammars),
    ].map((adapter) => adapter.read(context(adapter.languages))),
  ];
  const references: ResolvedReference[] = [];
  for (const file of unclassified) {
    const reading = readings.find((candidate) => candidate.files.has(file.path))?.files.get(file.path);
    if (!reading && !(isStored(file.path) && file.parseStatus === "failed")) {
      throw new Error(`No language adapter read ${file.path}.`);
    }
    if (!reading) continue;
    // A stored file keeps the parse status it was stored with.
    if (!isStored(file.path)) {
      file.parseStatus = reading.parseStatus;
      file.parseErrors = reading.parseErrors;
    }
    references.push(...reading.references);
  }
  references.sort(byPosition);

  // The adapter sees the files of the packages that name its framework and
  // no others, and only TypeScript and JavaScript ones: every framework it
  // knows is a JavaScript one. Everything it does not place gets a generic
  // role here.
  const choice = selectAdapter(adapters, manifests);
  const scope = new Set(choice.evidence.map((entry) => entry.root));
  const inScope = (file: Omit<FileNode, "role">) =>
    file.package !== null &&
    scope.has(file.package.root) &&
    (file.language === "typescript" || file.language === "javascript");
  if (overlay) {
    if (choice.adapter.name !== overlay.base.adapter) {
      throw new OverlayUnsupported(`The framework read is now ${choice.adapter.name}, not ${overlay.base.adapter}.`);
    }
    // A framework's configuration file (next.config.js) shapes every route
    // in its package, so it is always read, changed or not.
    const config = unclassified.find((file) => inScope(file) && isStored(file.path) && /\.config\.[cm]?[jt]s$/.test(file.name));
    if (config) throw new OverlayUnsupported(`${config.path} configures the framework and was not read.`);
  }
  // Stored files are passed with no syntax tree, so an adapter sees every
  // file of its packages; only what it says about changed files is used.
  const analysis = choice.adapter.analyse(
    unclassified.flatMap((file) =>
      file.package && inScope(file)
        ? [
            {
              path: file.path,
              packageRoot: file.package.root,
              declaration: file.declaration,
              syntax: syntax.get(file.path) ?? null,
            },
          ]
        : [],
    ),
  );
  const frameworkLabel = FRAMEWORKS[choice.adapter.name].label;
  const files: FileNode[] = unclassified.map((file) => {
    const stored = isStored(file.path) ? baseNodes.get(file.path) : undefined;
    return {
      ...file,
      role: stored?.role ?? analysis.roles.get(file.path) ?? supportingRole(file) ?? otherRole(frameworkLabel),
    };
  });
  // Routes and notes: the adapter's for changed files, the stored graph's
  // for the rest.
  const fresh = <T extends { file: string | null }>(items: T[], storedItems: T[]) => [
    ...items.filter((item) => item.file === null || !isStored(item.file)),
    ...storedItems.filter((item) => item.file !== null && isStored(item.file) && baseNodes.has(item.file) && languageByPath.has(item.file)),
  ];
  const baseAdapterNotes = overlay ? overlay.base.framework.notes.slice(choice.notes.length) : [];
  const routes = overlay ? fresh(analysis.routes, overlay.base.routes) : analysis.routes;
  const omittedRoutes = overlay ? fresh(analysis.omittedRoutes, overlay.base.omittedRoutes) : analysis.omittedRoutes;
  const notes = (overlay ? fresh(analysis.notes, baseAdapterNotes) : analysis.notes).sort(
    (a, b) => byText(a.file ?? "", b.file ?? "") || (a.line ?? 0) - (b.line ?? 0) || byText(a.detail, b.detail),
  );

  const edges = buildEdges(references);
  const unlinkedReferences = references.flatMap(
    ({ source, site, resolution }): UnlinkedReference[] => {
      if (resolution.status === "internal") return [];
      const { kind, specifier, line, typeOnly } = site;
      return [{ source, kind, specifier, line, typeOnly, ...resolution }];
    },
  );

  const excluded: ExcludedPath[] = [
    ...[...walk.skippedFiles].map(([file, rule]) => ({ path: file, type: "file" as const, rule })),
    ...[...walk.skippedDirectories].map(([folder, rule]) => ({
      path: folder,
      type: "directory" as const,
      rule,
    })),
  ].sort((a, b) => byText(a.path, b.path));

  const exclusionRules = [
    ...rules.map(({ id, description }) => ({ id, description })),
    symbolicLinkRule,
    unsupportedFileTypeRule,
    oversizedFileRule,
    binaryFileRule,
    generatedFileRule,
  ];

  return {
    schemaVersion: SCHEMA_VERSION,
    analyzerVersion: ANALYZER_VERSION,
    adapter: choice.adapter.name,
    framework: { evidence: choice.evidence, notes: [...choice.notes, ...notes] },
    exclusionRules,
    resolutionConfigs: readings
      .flatMap((reading) => reading.resolutionConfigs)
      .sort((a, b) => byText(a.path, b.path)),
    files,
    excluded,
    edges,
    unlinkedReferences,
    metrics: computeMetrics(
      files.map((file) => file.id),
      edges,
    ),
    routes: [...routes].sort(
      (a, b) =>
        byText(a.pattern, b.pattern) ||
        byText(a.method ?? "", b.method ?? "") ||
        byText(a.file, b.file) ||
        (a.line ?? 0) - (b.line ?? 0),
    ),
    omittedRoutes: [...omittedRoutes].sort(
      (a, b) => byText(a.file, b.file) || (a.line ?? 0) - (b.line ?? 0),
    ),
    coverage: summarise(files, excluded, exclusionRules, references, edges.length),
  };
}

function summarise(
  files: FileNode[],
  excluded: ExcludedPath[],
  rules: { id: string }[],
  references: ResolvedReference[],
  edgeCount: number,
): Coverage {
  const count = (matching: ResolvedReference[]): ReferenceCounts => ({
    encountered: matching.length,
    internal: matching.filter((r) => r.resolution.status === "internal").length,
    external: matching.filter((r) => r.resolution.status === "external").length,
    excluded: matching.filter((r) => r.resolution.status === "excluded").length,
    unresolved: matching.filter((r) => r.resolution.status === "unresolved").length,
  });
  const excludedFiles = excluded.filter((entry) => entry.type === "file");
  const excludedDirectories = excluded.filter((entry) => entry.type === "directory");
  const failed = files.filter((file) => file.parseStatus === "failed").length;

  return {
    files: {
      encountered: files.length + excludedFiles.length,
      included: files.length,
      parsed: files.length - failed,
      failed,
      excluded: excludedFiles.length,
    },
    directoriesExcluded: excludedDirectories.length,
    excludedByRule: rules
      .map(({ id }) => ({
        rule: id,
        files: excludedFiles.filter((entry) => entry.rule === id).length,
        directories: excludedDirectories.filter((entry) => entry.rule === id).length,
      }))
      .filter((row) => row.files + row.directories > 0),
    references: count(references),
    referencesByKind: REFERENCE_KINDS.map((kind) => ({
      kind,
      ...count(references.filter((reference) => reference.site.kind === kind)),
    })).filter((row) => row.encountered > 0),
    edges: edgeCount,
    unresolvedByReason: UNRESOLVED_REASONS.flatMap((reason) => {
      const matching = references.flatMap(({ source, site, resolution }) =>
        resolution.status === "unresolved" && resolution.reason === reason
          ? [{ source, line: site.line, specifier: site.specifier, detail: resolution.detail }]
          : [],
      );
      return matching.length === 0
        ? []
        : [{ reason, count: matching.length, examples: matching.slice(0, EXAMPLES_PER_REASON) }];
    }),
  };
}
