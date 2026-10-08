import {
  EXCLUDED_PATH_TYPES,
  EXTERNAL_KINDS,
  LANGUAGES,
  PARSE_STATUSES,
  REFERENCE_KINDS,
  RESOLUTION_METHODS,
  SCHEMA_VERSION,
  UNRESOLVED_REASONS,
  type Coverage,
  type DependencyEdge,
  type ExcludedPath,
  type FileNode,
  type ParserOutput,
  type ReferenceCounts,
  type UnlinkedReference,
} from "./contract";
import { computeMetrics } from "./graph";

// Reading an analysis file back is the only place its shape is taken on
// trust, so this checks every field and then checks that the graph agrees
// with itself. Each function builds its result field by field: if the
// contract gains a field, this file stops compiling until it is checked here.

type Fields = Record<string, unknown>;

function fail(at: string, expected: string): never {
  throw new Error(`Invalid parser output at ${at}: expected ${expected}.`);
}

function fields(value: unknown, at: string): Fields {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(at, "an object");
  }
  return { ...value };
}

function text(value: unknown, at: string): string {
  return typeof value === "string" ? value : fail(at, "a string");
}

function count(value: unknown, at: string): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : fail(at, "a non-negative integer");
}

function flag(value: unknown, at: string): boolean {
  return typeof value === "boolean" ? value : fail(at, "a boolean");
}

function oneOf<T extends string>(options: readonly T[], value: unknown, at: string): T {
  const match = options.find((option) => option === value);
  return match ?? fail(at, `one of ${options.join(", ")}`);
}

function list<T>(value: unknown, at: string, item: (value: unknown, at: string) => T): T[] {
  if (!Array.isArray(value)) fail(at, "an array");
  const items: unknown[] = value;
  return items.map((entry, index) => item(entry, `${at}[${index}]`));
}

function fileNode(value: unknown, at: string): FileNode {
  const o = fields(value, at);
  const pkg = o.package === null ? null : fields(o.package, `${at}.package`);
  return {
    id: text(o.id, `${at}.id`),
    path: text(o.path, `${at}.path`),
    name: text(o.name, `${at}.name`),
    extension: text(o.extension, `${at}.extension`),
    language: oneOf(LANGUAGES, o.language, `${at}.language`),
    declaration: flag(o.declaration, `${at}.declaration`),
    folder: text(o.folder, `${at}.folder`),
    folderSegments: list(o.folderSegments, `${at}.folderSegments`, text),
    package: pkg && {
      name: pkg.name === null ? null : text(pkg.name, `${at}.package.name`),
      root: text(pkg.root, `${at}.package.root`),
    },
    sizeBytes: count(o.sizeBytes, `${at}.sizeBytes`),
    lineCount: count(o.lineCount, `${at}.lineCount`),
    contentHash: text(o.contentHash, `${at}.contentHash`),
    parseStatus: oneOf(PARSE_STATUSES, o.parseStatus, `${at}.parseStatus`),
    parseErrors: list(o.parseErrors, `${at}.parseErrors`, (entry, entryAt) => {
      const e = fields(entry, entryAt);
      return { line: count(e.line, `${entryAt}.line`), message: text(e.message, `${entryAt}.message`) };
    }),
  };
}

function excludedPath(value: unknown, at: string): ExcludedPath {
  const o = fields(value, at);
  return {
    path: text(o.path, `${at}.path`),
    type: oneOf(EXCLUDED_PATH_TYPES, o.type, `${at}.type`),
    rule: text(o.rule, `${at}.rule`),
  };
}

function edge(value: unknown, at: string): DependencyEdge {
  const o = fields(value, at);
  return {
    source: text(o.source, `${at}.source`),
    target: text(o.target, `${at}.target`),
    kinds: list(o.kinds, `${at}.kinds`, (v, a) => oneOf(REFERENCE_KINDS, v, a)),
    typeOnly: flag(o.typeOnly, `${at}.typeOnly`),
    evidence: list(o.evidence, `${at}.evidence`, (entry, entryAt) => {
      const e = fields(entry, entryAt);
      return {
        kind: oneOf(REFERENCE_KINDS, e.kind, `${entryAt}.kind`),
        specifier: text(e.specifier, `${entryAt}.specifier`),
        line: count(e.line, `${entryAt}.line`),
        typeOnly: flag(e.typeOnly, `${entryAt}.typeOnly`),
        via: oneOf(RESOLUTION_METHODS, e.via, `${entryAt}.via`),
      };
    }),
  };
}

function unlinkedReference(value: unknown, at: string): UnlinkedReference {
  const o = fields(value, at);
  const origin = {
    source: text(o.source, `${at}.source`),
    kind: oneOf(REFERENCE_KINDS, o.kind, `${at}.kind`),
    specifier: o.specifier === null ? null : text(o.specifier, `${at}.specifier`),
    line: count(o.line, `${at}.line`),
    typeOnly: flag(o.typeOnly, `${at}.typeOnly`),
  };
  const status = oneOf(["external", "excluded", "unresolved"], o.status, `${at}.status`);
  if (status === "external") {
    return {
      ...origin,
      status,
      externalKind: oneOf(EXTERNAL_KINDS, o.externalKind, `${at}.externalKind`),
      packageName: o.packageName === null ? null : text(o.packageName, `${at}.packageName`),
    };
  }
  if (status === "excluded") {
    return {
      ...origin,
      status,
      target: text(o.target, `${at}.target`),
      rule: text(o.rule, `${at}.rule`),
    };
  }
  return {
    ...origin,
    status,
    reason: oneOf(UNRESOLVED_REASONS, o.reason, `${at}.reason`),
    detail: text(o.detail, `${at}.detail`),
  };
}

function referenceCounts(o: Fields, at: string): ReferenceCounts {
  return {
    encountered: count(o.encountered, `${at}.encountered`),
    internal: count(o.internal, `${at}.internal`),
    external: count(o.external, `${at}.external`),
    excluded: count(o.excluded, `${at}.excluded`),
    unresolved: count(o.unresolved, `${at}.unresolved`),
  };
}

function coverage(value: unknown, at: string): Coverage {
  const o = fields(value, at);
  const f = fields(o.files, `${at}.files`);
  return {
    files: {
      encountered: count(f.encountered, `${at}.files.encountered`),
      included: count(f.included, `${at}.files.included`),
      parsed: count(f.parsed, `${at}.files.parsed`),
      failed: count(f.failed, `${at}.files.failed`),
      excluded: count(f.excluded, `${at}.files.excluded`),
    },
    directoriesExcluded: count(o.directoriesExcluded, `${at}.directoriesExcluded`),
    excludedByRule: list(o.excludedByRule, `${at}.excludedByRule`, (entry, entryAt) => {
      const e = fields(entry, entryAt);
      return {
        rule: text(e.rule, `${entryAt}.rule`),
        files: count(e.files, `${entryAt}.files`),
        directories: count(e.directories, `${entryAt}.directories`),
      };
    }),
    references: referenceCounts(fields(o.references, `${at}.references`), `${at}.references`),
    referencesByKind: list(o.referencesByKind, `${at}.referencesByKind`, (entry, entryAt) => {
      const e = fields(entry, entryAt);
      return {
        kind: oneOf(REFERENCE_KINDS, e.kind, `${entryAt}.kind`),
        ...referenceCounts(e, entryAt),
      };
    }),
    edges: count(o.edges, `${at}.edges`),
    unresolvedByReason: list(o.unresolvedByReason, `${at}.unresolvedByReason`, (entry, entryAt) => {
      const e = fields(entry, entryAt);
      return {
        reason: oneOf(UNRESOLVED_REASONS, e.reason, `${entryAt}.reason`),
        count: count(e.count, `${entryAt}.count`),
        examples: list(e.examples, `${entryAt}.examples`, (example, exampleAt) => {
          const x = fields(example, exampleAt);
          return {
            source: text(x.source, `${exampleAt}.source`),
            line: count(x.line, `${exampleAt}.line`),
            specifier: x.specifier === null ? null : text(x.specifier, `${exampleAt}.specifier`),
            detail: text(x.detail, `${exampleAt}.detail`),
          };
        }),
      };
    }),
  };
}

// Checks that the parts of the output agree with each other. A file that has
// the right shape but an edge to a missing node is still not usable.
function checkConsistency(output: ParserOutput): void {
  const wrong = (message: string): never => {
    throw new Error(`Inconsistent parser output: ${message}`);
  };
  const ids = new Set(output.files.map((file) => file.id));
  if (ids.size !== output.files.length) wrong("two files share an id.");

  const pairs = new Set<string>();
  for (const { source, target } of output.edges) {
    if (!ids.has(source) || !ids.has(target)) {
      wrong(`edge ${source} → ${target} points at a file that is not a node.`);
    }
    const pair = `${source}\n${target}`;
    if (pairs.has(pair)) wrong(`edge ${source} → ${target} appears more than once.`);
    pairs.add(pair);
  }
  for (const reference of output.unlinkedReferences) {
    if (!ids.has(reference.source)) wrong(`a reference comes from unknown file ${reference.source}.`);
  }

  const expected = computeMetrics(
    output.files.map((file) => file.id),
    output.edges,
  );
  if (JSON.stringify(expected) !== JSON.stringify(output.metrics)) {
    wrong("fan-in and fan-out do not match the edge list.");
  }

  const { files, references, edges } = output.coverage;
  const failed = output.files.filter((file) => file.parseStatus === "failed").length;
  const excludedFiles = output.excluded.filter((entry) => entry.type === "file").length;
  const evidence = output.edges.reduce((sum, e) => sum + e.evidence.length, 0);
  const unlinked = (status: UnlinkedReference["status"]) =>
    output.unlinkedReferences.filter((reference) => reference.status === status).length;
  if (
    files.included !== output.files.length ||
    files.failed !== failed ||
    files.parsed !== files.included - failed ||
    files.excluded !== excludedFiles ||
    files.encountered !== files.included + files.excluded
  ) {
    wrong("file coverage does not match the file lists.");
  }
  if (
    edges !== output.edges.length ||
    references.internal !== evidence ||
    references.external !== unlinked("external") ||
    references.excluded !== unlinked("excluded") ||
    references.unresolved !== unlinked("unresolved") ||
    references.encountered !== evidence + output.unlinkedReferences.length
  ) {
    wrong("reference coverage does not match the edges and unlinked references.");
  }
}

// Turns untrusted JSON into a ParserOutput, or throws saying what is wrong.
export function readParserOutput(value: unknown): ParserOutput {
  const o = fields(value, "output");
  if (o.schemaVersion !== SCHEMA_VERSION) {
    fail("output.schemaVersion", `${SCHEMA_VERSION}`);
  }
  const output: ParserOutput = {
    schemaVersion: SCHEMA_VERSION,
    adapter: text(o.adapter, "output.adapter"),
    exclusionRules: list(o.exclusionRules, "output.exclusionRules", (entry, at) => {
      const e = fields(entry, at);
      return { id: text(e.id, `${at}.id`), description: text(e.description, `${at}.description`) };
    }),
    resolutionConfigs: list(o.resolutionConfigs, "output.resolutionConfigs", (entry, at) => {
      const e = fields(entry, at);
      return { path: text(e.path, `${at}.path`), problems: list(e.problems, `${at}.problems`, text) };
    }),
    files: list(o.files, "output.files", fileNode),
    excluded: list(o.excluded, "output.excluded", excludedPath),
    edges: list(o.edges, "output.edges", edge),
    unlinkedReferences: list(o.unlinkedReferences, "output.unlinkedReferences", unlinkedReference),
    metrics: list(o.metrics, "output.metrics", (entry, at) => {
      const e = fields(entry, at);
      return {
        file: text(e.file, `${at}.file`),
        fanIn: count(e.fanIn, `${at}.fanIn`),
        fanOut: count(e.fanOut, `${at}.fanOut`),
      };
    }),
    coverage: coverage(o.coverage, "output.coverage"),
  };
  checkConsistency(output);
  return output;
}
