import path from "node:path";
import type { Resolution } from "../resolve";
import { byText, type WalkResult } from "../walk";
import { PYTHON_STDLIB } from "./python-stdlib";

// Turning a Python module name into a file of the repository, the way the
// interpreter would find it if the repository's own folders were on its
// path. Nothing is installed and nothing is run, so which folders are on the
// path is read from the repository's layout:
//
//   1. each project root enclosing the importing file, nearest first: a
//      folder holding pyproject.toml, setup.py or setup.cfg, and its src/
//      folder before it, the usual "src layout";
//   2. the repository root, and its src/ folder before it;
//   3. the importing file's base folder: the nearest folder at or above it
//      with no __init__.py. pytest puts that folder on the path for a test
//      file, and Python puts a script's own folder there.
//
// The first root holding the module wins, as the first matching path entry
// does in Python. A module found under none of them is the standard
// library's when its first segment is a standard-library module, a
// third-party package when nothing in the repository has that name, and
// unresolved when the repository has a package of that name but not the
// module: then something is missing and it is said so.
//
// `import a.b.c` runs a/__init__.py and a/b/__init__.py too. Only the edge to
// the module named is recorded; the packages it passes through are not.

const PROJECT_FILES = ["pyproject.toml", "setup.py", "setup.cfg"];

// A module's candidate files, in the order Python prefers them. A stub
// (.pyi) only stands in when there is no source.
const moduleFiles = (base: string) => [
  `${base}.py`,
  `${base}/__init__.py`,
  `${base}.pyi`,
  `${base}/__init__.pyi`,
];

const join = (folder: string, relative: string) => (folder === "" ? relative : `${folder}/${relative}`);
const parentOf = (file: string) => (file.includes("/") ? path.posix.dirname(file) : "");

// What a module name led to. `packageFolder` is set when the module is a
// package, so `from it import name` can look for a submodule `name` there.
export type ModuleTarget = { resolution: Resolution; packageFolder: string | null };

export type PythonResolver = {
  // `module` as written: "a.b", ".", "..a". Leading dots are relative.
  resolveModule: (source: string, module: string) => ModuleTarget;
  // The submodule `name` of a package folder, or null when there is none.
  // `via` is how the package itself was found.
  submodule: (packageFolder: string, name: string, via: "relative" | "source-root") => Resolution | null;
};

export function createPythonResolver(walk: WalkResult): PythonResolver {
  const included = new Set(walk.sourceFiles);
  // Folders holding a Python file somewhere beneath them. A folder with no
  // Python file in it is not a package of anything.
  const pythonFolders = new Set<string>();
  for (const file of walk.sourceFiles) {
    if (!/\.pyi?$/.test(file)) continue;
    for (let folder = parentOf(file); folder !== ""; folder = parentOf(folder)) {
      if (pythonFolders.has(folder)) break;
      pythonFolders.add(folder);
    }
  }
  const projectRoots = new Set<string>();
  for (const file of [...walk.skippedFiles.keys(), ...walk.sourceFiles].sort(byText)) {
    if (PROJECT_FILES.includes(path.posix.basename(file))) projectRoots.add(parentOf(file));
  }

  function ruleExcluding(relative: string): string | null {
    const fileRule = walk.skippedFiles.get(relative);
    if (fileRule) return fileRule;
    for (let folder = parentOf(relative); folder !== ""; folder = parentOf(folder)) {
      const rule = walk.skippedDirectories.get(folder);
      if (rule) return rule;
    }
    return null;
  }

  // The file a module path names under one folder: in the graph, excluded by
  // a rule, a namespace package (a folder with Python files but no
  // __init__.py), or nothing.
  type Found =
    | { kind: "file"; path: string; packageFolder: string | null }
    | { kind: "excluded"; path: string; rule: string }
    | { kind: "namespace"; folder: string };
  function lookup(base: string): Found | null {
    for (const candidate of moduleFiles(base)) {
      if (included.has(candidate)) {
        return {
          kind: "file",
          path: candidate,
          packageFolder: /(^|\/)__init__\.pyi?$/.test(candidate) ? base : null,
        };
      }
    }
    for (const candidate of moduleFiles(base)) {
      const rule = walk.skippedFiles.has(candidate) ? ruleExcluding(candidate) : null;
      if (rule) return { kind: "excluded", path: candidate, rule };
    }
    // A module under an excluded folder was never listed by the walk, so
    // whether it exists is unknown and it is not claimed here.
    if (base !== "" && pythonFolders.has(base)) return { kind: "namespace", folder: base };
    return null;
  }

  function toResolution(found: Found, via: "relative" | "source-root"): ModuleTarget {
    if (found.kind === "file") {
      return {
        resolution: { status: "internal", target: found.path, via },
        packageFolder: found.packageFolder,
      };
    }
    if (found.kind === "excluded") {
      return { resolution: { status: "excluded", target: found.path, rule: found.rule }, packageFolder: null };
    }
    return {
      resolution: {
        status: "unresolved",
        reason: "file-not-found",
        detail: `${found.folder} is a namespace package (a folder with no __init__.py), so there is no file for the module itself.`,
      },
      packageFolder: found.folder,
    };
  }

  const rootsBySource = new Map<string, string[]>();
  function rootsFor(source: string): string[] {
    const folder = parentOf(source);
    const cached = rootsBySource.get(folder);
    if (cached) return cached;
    const roots: string[] = [];
    const add = (root: string) => {
      if (!roots.includes(root)) roots.push(root);
    };
    for (let at: string | null = folder; at !== null; at = at === "" ? null : parentOf(at)) {
      if (at !== "" && projectRoots.has(at)) {
        add(join(at, "src"));
        add(at);
      }
    }
    add("src");
    add("");
    let base = folder;
    while (base !== "" && (included.has(`${base}/__init__.py`) || included.has(`${base}/__init__.pyi`))) {
      base = parentOf(base);
    }
    add(base);
    rootsBySource.set(folder, roots);
    return roots;
  }

  function resolveModule(source: string, module: string): ModuleTarget {
    const dots = /^\.*/.exec(module)?.[0].length ?? 0;
    const rest = module.slice(dots);
    const relativePath = rest === "" ? "" : rest.split(".").join("/");

    if (dots > 0) {
      // One dot is the importing file's own package; each more is one up.
      let folder: string | null = parentOf(source);
      for (let up = 1; up < dots && folder !== null; up += 1) {
        folder = folder === "" ? null : parentOf(folder);
      }
      if (folder === null) {
        return {
          resolution: {
            status: "unresolved",
            reason: "file-not-found",
            detail: `"${module}" climbs ${dots - 1} folders above ${parentOf(source) || "the repository root"}, past the repository root.`,
          },
          packageFolder: null,
        };
      }
      const base = relativePath === "" ? folder : join(folder, relativePath);
      // `from . import x` names the package of the importing file itself.
      const found = relativePath === "" ? lookupPackage(folder) : lookup(base);
      if (found) return toResolution(found, "relative");
      return {
        resolution: {
          status: "unresolved",
          reason: "file-not-found",
          detail: `No module or package at ${base === "" ? "the repository root" : base}.`,
        },
        packageFolder: null,
      };
    }

    let namespace: Found | null = null;
    for (const root of rootsFor(source)) {
      const found = lookup(join(root, relativePath));
      if (!found) continue;
      if (found.kind === "namespace") {
        namespace ??= found;
        continue;
      }
      return toResolution(found, "source-root");
    }
    if (namespace) return toResolution(namespace, "source-root");

    const first = rest.split(".")[0];
    // __main__ is the interpreter's own name for the running script.
    if (PYTHON_STDLIB.has(first) || first === "__main__") {
      return { resolution: { status: "external", externalKind: "builtin", packageName: first }, packageFolder: null };
    }
    const local = rootsFor(source)
      .map((root) => lookup(join(root, first)))
      .find((found) => found !== null);
    if (local && rest.includes(".")) {
      const where = local.kind === "namespace" ? local.folder : local.path;
      return {
        resolution: {
          status: "unresolved",
          reason: "file-not-found",
          detail: `"${first}" is a package in this repository (${where}), but no module ${rest} was found in it.`,
        },
        packageFolder: null,
      };
    }
    // Named like no module in the repository: installed from elsewhere.
    return { resolution: { status: "external", externalKind: "package", packageName: first }, packageFolder: null };
  }

  function lookupPackage(folder: string): Found | null {
    for (const name of ["__init__.py", "__init__.pyi"]) {
      const file = join(folder, name);
      if (included.has(file)) return { kind: "file", path: file, packageFolder: folder };
    }
    return { kind: "namespace", folder };
  }

  function submodule(
    packageFolder: string,
    name: string,
    via: "relative" | "source-root",
  ): Resolution | null {
    const found = lookup(join(packageFolder, name));
    if (!found || found.kind === "namespace") return null;
    return toResolution(found, via).resolution;
  }

  return { resolveModule, submodule };
}
