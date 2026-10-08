import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { fallbackAdapter, type FrameworkAdapter } from "./adapter";
import {
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
import { coreExclusionRules, symbolicLinkRule, unsupportedFileTypeRule } from "./exclusions";
import { buildEdges, computeMetrics, type ResolvedReference } from "./graph";
import { extractReferences } from "./references";
import { createResolver, readPackageName } from "./resolve";
import { byText, describeSourceFile, walkRepository } from "./walk";

const PARSE_ERROR_LIMIT = 5;
const EXAMPLES_PER_REASON = 5;

// TS8xxx diagnostics say "this syntax is only allowed in TypeScript files".
// The file still parsed, so they do not count as parse failures.
const isTypeScriptOnlySyntax = (code: number) => code >= 8000 && code < 9000;

function countLines(text: string): number {
  if (text === "") return 0;
  const breaks = text.split("\n").length - 1;
  return text.endsWith("\n") ? breaks : breaks + 1;
}

// Turns a repository on disk into its files and the dependency relationships
// between them. Reads only the local filesystem.
export function parseRepository(
  directory: string,
  adapter: FrameworkAdapter = fallbackAdapter,
): ParserOutput {
  const root = fs.realpathSync.native(path.resolve(directory));
  if (!fs.statSync(root).isDirectory()) {
    throw new Error(`${root} is not a directory.`);
  }

  const rules = [...coreExclusionRules, ...adapter.exclusionRules];
  const walk = walkRepository(root, rules);

  // Package roots, to give each file its module identity.
  const packageNameByFolder = new Map<string, string | null>();
  for (const file of walk.skippedFiles.keys()) {
    if (path.posix.basename(file) === "package.json") {
      const folder = file.includes("/") ? path.posix.dirname(file) : "";
      packageNameByFolder.set(folder, readPackageName(path.join(root, file)));
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
  const files: FileNode[] = walk.sourceFiles.map((relative) => {
    const bytes = fs.readFileSync(path.join(root, relative));
    const text = bytes.toString("utf8");
    texts.set(path.join(root, relative), text);
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

  // One program over every source file gives the syntax trees and, through
  // the public API, their syntax errors. `noResolve` and `noLib` keep the
  // compiler from following imports itself; resolution is done below, one
  // reference at a time, so that every outcome is recorded.
  const options: ts.CompilerOptions = {
    allowJs: true,
    jsx: ts.JsxEmit.Preserve,
    noLib: true,
    noResolve: true,
    target: ts.ScriptTarget.ESNext,
    types: [],
  };
  const host = ts.createCompilerHost(options);
  host.getCurrentDirectory = () => root;
  host.getSourceFile = (fileName, languageVersionOrOptions) => {
    const text = texts.get(fileName);
    return text === undefined
      ? undefined
      : ts.createSourceFile(fileName, text, languageVersionOrOptions);
  };
  const program = ts.createProgram({ rootNames: [...texts.keys()], options, host });

  const resolver = createResolver(root, walk);
  const references: ResolvedReference[] = [];
  for (const file of files) {
    const sourceFile = program.getSourceFile(path.join(root, file.path));
    if (!sourceFile) throw new Error(`${file.path} was not loaded by the TypeScript parser.`);
    const errors = program
      .getSyntacticDiagnostics(sourceFile)
      .filter((diagnostic) => !isTypeScriptOnlySyntax(diagnostic.code));
    if (errors.length > 0) {
      file.parseStatus = "failed";
      file.parseErrors = errors.slice(0, PARSE_ERROR_LIMIT).map((diagnostic) => ({
        line: sourceFile.getLineAndCharacterOfPosition(diagnostic.start ?? 0).line + 1,
        message: ts.flattenDiagnosticMessageText(diagnostic.messageText, " "),
      }));
      // The tree of a file with syntax errors is a best-effort recovery.
      // References read from it could be artefacts, so none are taken.
      continue;
    }
    for (const site of extractReferences(sourceFile)) {
      references.push({ source: file.path, site, resolution: resolver.resolve(file.path, site) });
    }
  }

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
  ];

  return {
    schemaVersion: SCHEMA_VERSION,
    adapter: adapter.name,
    exclusionRules,
    resolutionConfigs: resolver.configs(),
    files,
    excluded,
    edges,
    unlinkedReferences,
    metrics: computeMetrics(
      files.map((file) => file.id),
      edges,
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
