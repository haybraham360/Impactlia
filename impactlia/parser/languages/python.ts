import type { Node } from "web-tree-sitter";
import type { ReferenceKind } from "../contract";
import type { ResolvedReference } from "../graph";
import type { ReferenceSite } from "../references";
import {
  restated,
  storedStatements,
  type FileReading,
  type LanguageAdapter,
  type LanguageContext,
} from "./adapter";
import { createPythonResolver, type PythonResolver } from "./python-resolve";
import { compact, lineOf, preview, readTrees } from "./syntax-tree";
import type { Grammars } from "./tree-sitter";

// Python, read with tree-sitter's Python grammar. Every import statement in
// the file is read, wherever it sits, because Python code often imports
// inside a function to defer the cost or break a cycle:
//
//   import a.b                     → "import" of a.b
//   from a.b import c, d           → "from-import": of a.b/c or a.b/d where
//                                    those are submodules, otherwise of a.b
//   from . import c                → the same, relative to the file's package
//   importlib.import_module("a")   → "dynamic-import", when the name is a
//   __import__("a")                  literal string; otherwise unresolved
//
// An import inside `if TYPE_CHECKING:` is type-only: it never runs.
// `from __future__ import ...` is a compiler directive, not a dependency, and
// is not read.

// The text of a plain string literal, or null for anything else: an f-string,
// a bytes literal, or a concatenation is only known at runtime.
export function literalString(node: Node): string | null {
  if (node.type !== "string") return null;
  const start = node.children[0];
  if (!start || start.type !== "string_start" || /[fFbB]/.test(start.text)) return null;
  const parts = node.children.slice(1, -1);
  if (parts.some((part) => part.type !== "string_content")) return null;
  return parts.map((part) => part.text).join("");
}

// `if TYPE_CHECKING:` or `if typing.TYPE_CHECKING:`.
function isTypeCheckingGuard(node: Node): boolean {
  const condition = node.childForFieldName("condition");
  if (!condition) return false;
  return (
    (condition.type === "identifier" && condition.text === "TYPE_CHECKING") ||
    (condition.type === "attribute" && condition.childForFieldName("attribute")?.text === "TYPE_CHECKING")
  );
}

// The name an `import` or `from ... import` clause binds, with any alias
// removed: `a.b as c` → "a.b".
function importedName(node: Node): string | null {
  if (node.type === "dotted_name") return compact(node);
  if (node.type === "aliased_import") {
    const name = node.childForFieldName("name");
    return name ? compact(name) : null;
  }
  return null;
}

export function joinModule(moduleName: string, name: string): string {
  return moduleName.endsWith(".") ? `${moduleName}${name}` : `${moduleName}.${name}`;
}

function referencesOf(
  file: string,
  root: Node,
  resolver: PythonResolver,
): ResolvedReference[] {
  const references: ResolvedReference[] = [];
  const add = (
    kind: ReferenceKind,
    node: Node,
    specifier: string | null,
    expression: string | null,
    typeOnly: boolean,
    resolution: ResolvedReference["resolution"],
  ) => {
    const site: ReferenceSite = { kind, specifier, expression, line: lineOf(node), typeOnly };
    references.push({ source: file, site, resolution });
  };

  const visit = (node: Node, typeOnly: boolean) => {
    if (node.type === "import_statement") {
      for (const clause of node.childrenForFieldName("name")) {
        const moduleName = importedName(clause);
        if (moduleName === null) continue;
        add("import", node, moduleName, null, typeOnly, resolver.resolveModule(file, moduleName).resolution);
      }
      return;
    }
    if (node.type === "import_from_statement") {
      const moduleNode = node.childForFieldName("module_name");
      if (!moduleNode) return;
      const moduleName = compact(moduleNode);
      const target = resolver.resolveModule(file, moduleName);
      const names = node.childrenForFieldName("name").flatMap((clause) => {
        const name = importedName(clause);
        return name === null ? [] : [name];
      });
      // A name is a submodule when the package has one by that name;
      // otherwise it is something the package's __init__ defines.
      let fromPackage = names.length === 0;
      const via = moduleName.startsWith(".") ? "relative" : "source-root";
      for (const name of names) {
        const submodule =
          target.packageFolder !== null && !name.includes(".")
            ? resolver.submodule(target.packageFolder, name, via)
            : null;
        if (submodule) add("from-import", node, joinModule(moduleName, name), null, typeOnly, submodule);
        else fromPackage = true;
      }
      if (fromPackage) add("from-import", node, moduleName, null, typeOnly, target.resolution);
      return;
    }
    if (node.type === "call") {
      const callee = node.childForFieldName("function");
      const isDynamic =
        callee !== null &&
        ((callee.type === "identifier" && callee.text === "__import__") ||
          (callee.type === "attribute" && compact(callee) === "importlib.import_module"));
      const first = node.childForFieldName("arguments")?.namedChildren[0];
      if (isDynamic && first && first.type !== "keyword_argument") {
        const literal = literalString(first);
        if (literal === null) {
          add("dynamic-import", node, null, preview(first.text), typeOnly, {
            status: "unresolved",
            reason: "non-literal-specifier",
            detail: `The module is named by an expression (${preview(first.text)}), so its target is only known at runtime.`,
          });
        } else if (literal.startsWith(".")) {
          // Relative to the `package` argument, which is itself a runtime value.
          add("dynamic-import", node, literal, null, typeOnly, {
            status: "unresolved",
            reason: "non-literal-specifier",
            detail: `"${literal}" is relative to the package argument of the call, which is only known at runtime.`,
          });
        } else {
          add("dynamic-import", node, literal, null, typeOnly, resolver.resolveModule(file, literal).resolution);
        }
      }
    }
    if (node.type === "if_statement" && isTypeCheckingGuard(node)) {
      for (const child of node.namedChildren) {
        visit(child, typeOnly || node.childForFieldName("consequence")?.id === child.id);
      }
      return;
    }
    for (const child of node.namedChildren) visit(child, typeOnly);
  };
  visit(root, false);
  return references;
}

export function pythonAdapter(grammars: Grammars): LanguageAdapter {
  return {
    languages: ["python"],
    read({ walk, files, texts, stored }: LanguageContext) {
      const resolver = createPythonResolver(walk);
      const trees = readTrees(grammars.python, "Python", files, texts, (file, root) =>
        referencesOf(file, root, resolver),
      );
      const readings = new Map<string, FileReading>();
      for (const [file, { parseStatus, parseErrors, value }] of trees) {
        readings.set(file, { parseStatus, parseErrors, references: value ?? [] });
      }
      // Stored references, resolved again. Whether a from-import name was a
      // submodule was decided when the file was read, and stays decided.
      for (const [file, references] of stored) {
        const resolved = storedStatements(references).flatMap((statement) => {
          const { specifier } = statement[0].site;
          if (specifier === null) return statement;
          const runtimeOnly = statement[0].site.kind === "dynamic-import" && specifier.startsWith(".");
          return runtimeOnly
            ? statement
            : restated(statement, [resolver.resolveModule(file, specifier).resolution]);
        });
        readings.set(file, { parseStatus: "parsed", parseErrors: [], references: resolved });
      }
      return { files: readings, resolutionConfigs: [] };
    },
  };
}
