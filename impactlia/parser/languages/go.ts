import type { Node } from "web-tree-sitter";
import type { ResolvedReference } from "../graph";
import type { Resolution } from "../resolve";
import {
  restated,
  storedStatements,
  type FileReading,
  type LanguageAdapter,
  type LanguageContext,
} from "./adapter";
import { exclusionOf, filesNamed, joinPath, parentOf, readProjectFile } from "./repository-text";
import { lineOf, readTrees } from "./syntax-tree";
import type { Grammars } from "./tree-sitter";

// Go, read with tree-sitter's Go grammar.
//
// An import names a package, and a package is every .go file in one folder,
// so an import becomes an edge to each of the package's files other than its
// tests, all with the import line as evidence. The folder is found through
// the go.mod whose module path the import starts with; the longest such path
// wins, as in Go's own module resolution.
//
// A test file (*_test.go) is compiled together with the other files of its
// folder, so it gets a "same-package" edge to each of them, with its package
// clause as evidence. Other files of one package use each other without any
// import, and those uses are not edges: which file declares a name is not
// read.
//
// An import under no module of the repository is the standard library's
// when its first element has no dot (Go reserves those for it), and a
// third-party module otherwise. A folder under the vendor directory is left
// out with the other dependency folders.

type GoFile = {
  imports: { path: string; line: number }[];
  packageLine: number | null;
};

const isTest = (file: string) => file.endsWith("_test.go");

function readGoFile(root: Node): GoFile {
  const imports: GoFile["imports"] = [];
  let packageLine: number | null = null;
  for (const node of root.namedChildren) {
    if (node.type === "package_clause") packageLine = lineOf(node);
    if (node.type !== "import_declaration") continue;
    for (const spec of node.descendantsOfType("import_spec")) {
      const literal = spec.childForFieldName("path");
      if (!literal) continue;
      // "path" or `path`: the quotes are the first and last characters.
      imports.push({ path: literal.text.slice(1, -1), line: lineOf(spec) });
    }
  }
  return { imports, packageLine };
}

// "module example.com/shop" from a go.mod, or null.
function modulePath(text: string): string | null {
  const match = /^\s*module\s+("?)([^\s"]+)\1\s*$/m.exec(text);
  return match ? match[2] : null;
}

export function goAdapter(grammars: Grammars): LanguageAdapter {
  return {
    languages: ["go"],
    read({ root, walk, files, texts, stored }: LanguageContext) {
      const modules = filesNamed(walk, "go.mod").flatMap((file) => {
        const text = readProjectFile(root, file);
        const name = text === null ? null : modulePath(text);
        return name === null ? [] : [{ name, folder: parentOf(file) }];
      });
      // Longest module path first, so a nested module wins over its parent.
      modules.sort((a, b) => b.name.length - a.name.length);

      const packageFiles = new Map<string, string[]>();
      for (const file of walk.sourceFiles) {
        if (!file.endsWith(".go") || isTest(file)) continue;
        const folder = parentOf(file);
        packageFiles.set(folder, [...(packageFiles.get(folder) ?? []), file]);
      }

      function resolveImport(importPath: string): Resolution[] {
        const owner = modules.find(({ name }) => importPath === name || importPath.startsWith(`${name}/`));
        if (owner) {
          const folder = joinPath(owner.folder, importPath.slice(owner.name.length + 1));
          const targets = packageFiles.get(importPath === owner.name ? owner.folder : folder) ?? [];
          if (targets.length > 0) {
            return targets.map((target) => ({ status: "internal", target, via: "go-module" }));
          }
          const rule = folder === "" ? null : exclusionOf(walk, folder);
          if (rule) return [{ status: "excluded", target: folder, rule }];
          return [
            {
              status: "unresolved",
              reason: "file-not-found",
              detail: `"${importPath}" is under the module ${owner.name}, but ${folder || "its root"} holds no Go files other than tests.`,
            },
          ];
        }
        const first = importPath.split("/")[0];
        return [
          first.includes(".")
            ? { status: "external", externalKind: "package", packageName: importPath }
            : { status: "external", externalKind: "builtin", packageName: importPath },
        ];
      }

      const trees = readTrees(grammars.go, "Go", files, texts, (_file, tree) => readGoFile(tree));
      const readings = new Map<string, FileReading>();
      for (const [file, { parseStatus, parseErrors, value }] of trees) {
        const references: ResolvedReference[] = [];
        for (const { path, line } of value?.imports ?? []) {
          for (const resolution of resolveImport(path)) {
            references.push({
              source: file,
              site: { kind: "import", specifier: path, expression: null, line, typeOnly: false },
              resolution,
            });
          }
        }
        if (value && isTest(file) && value.packageLine !== null) {
          for (const target of packageFiles.get(parentOf(file)) ?? []) {
            references.push({
              source: file,
              site: { kind: "same-package", specifier: parentOf(file) || ".", expression: null, line: value.packageLine, typeOnly: false },
              resolution: { status: "internal", target, via: "relative" },
            });
          }
        }
        readings.set(file, { parseStatus, parseErrors, references });
      }
      // Stored imports resolved again; a test's same-package links are
      // remade from its folder as it is now.
      for (const [file, references] of stored) {
        const resolved = storedStatements(references).flatMap((statement) => {
          const { site } = statement[0];
          if (site.kind === "same-package") {
            return restated(
              statement,
              (packageFiles.get(parentOf(file)) ?? []).map((target) => ({ status: "internal", target, via: "relative" })),
            );
          }
          return site.specifier === null ? statement : restated(statement, resolveImport(site.specifier));
        });
        readings.set(file, { parseStatus: "parsed", parseErrors: [], references: resolved });
      }
      return { files: readings, resolutionConfigs: [] };
    },
  };
}
