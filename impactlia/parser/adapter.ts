import type ts from "typescript";
import type {
  FileRole,
  FrameworkEvidence,
  FrameworkNote,
  OmittedRoute,
  RouteRecord,
} from "./contract";
import { FALLBACK, FRAMEWORKS, type FrameworkName } from "./roles";

// Where framework-specific knowledge goes. The parser itself never tests for
// a framework: it is handed a list of adapters, asks each in turn whether the
// repository is theirs, and gives the first that says yes the files to read.
// What an adapter leaves unplaced gets a generic role from the parser.

// A package.json found in the repository.
export type Manifest = {
  path: string;
  // The folder it sits in; "" for the repository root.
  root: string;
  // Every name under dependencies, devDependencies and peerDependencies.
  dependencies: string[];
};

export type AdapterFile = {
  path: string;
  // The folder of the nearest package.json, which is one that names the
  // framework: files under any other package are not given to the adapter.
  packageRoot: string;
  declaration: boolean;
  // null when the file has syntax errors. Only its path can be used then.
  syntax: ts.SourceFile | null;
};

export type AdapterAnalysis = {
  // Keyed by file path. A file left out keeps a generic role.
  roles: Map<string, FileRole>;
  routes: RouteRecord[];
  omittedRoutes: OmittedRoute[];
  notes: FrameworkNote[];
};

export type FrameworkAdapter = {
  name: FrameworkName;
  // One entry per package.json that names the framework; empty when none does.
  detect: (manifests: Manifest[]) => FrameworkEvidence[];
  // Reads only what it is given. Never runs repository code.
  analyse: (files: AdapterFile[]) => AdapterAnalysis;
};

export const emptyAnalysis = (): AdapterAnalysis => ({
  roles: new Map(),
  routes: [],
  omittedRoutes: [],
  notes: [],
});

// Knows nothing about any framework.
export const fallbackAdapter: FrameworkAdapter = {
  name: FALLBACK,
  detect: () => [],
  analyse: emptyAnalysis,
};

// The usual way to detect a framework: a package.json that depends on it.
export function dependencyEvidence(manifests: Manifest[], dependency: string): FrameworkEvidence[] {
  return manifests
    .filter((manifest) => manifest.dependencies.includes(dependency))
    .map((manifest) => ({
      file: manifest.path,
      root: manifest.root,
      detail: `${manifest.path} lists "${dependency}" as a dependency.`,
    }));
}

export type AdapterChoice = {
  adapter: FrameworkAdapter;
  evidence: FrameworkEvidence[];
  notes: FrameworkNote[];
};

// The first adapter, in the order given, with any evidence at all. One adapter
// reads the whole repository. A later one that matched a package the chosen
// one does not cover is reported rather than silently dropped; one that only
// matched the same packages (React under Next.js) is the expected case.
export function selectAdapter(adapters: FrameworkAdapter[], manifests: Manifest[]): AdapterChoice {
  const matches = adapters
    .map((adapter) => ({ adapter, evidence: adapter.detect(manifests) }))
    .filter((match) => match.evidence.length > 0);
  if (matches.length === 0) return { adapter: fallbackAdapter, evidence: [], notes: [] };
  const [chosen, ...others] = matches;
  const covered = new Set(chosen.evidence.map((entry) => entry.root));
  return {
    ...chosen,
    notes: others.flatMap(({ adapter, evidence }) => {
      const elsewhere = evidence.filter((entry) => !covered.has(entry.root));
      return elsewhere.length === 0
        ? []
        : [
            {
              file: elsewhere[0].file,
              line: null,
              detail: `${FRAMEWORKS[adapter.name].label} was also found (${elsewhere.map((entry) => entry.file).join(", ")}). One framework is read per repository and ${FRAMEWORKS[chosen.adapter.name].label} comes first, so files there have generic roles and no routes are extracted from them.`,
            },
          ];
    }),
  };
}
