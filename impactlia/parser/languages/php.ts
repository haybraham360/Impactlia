import type { Node } from "web-tree-sitter";
import type { ResolvedReference } from "../graph";
import type { Resolution } from "../resolve";
import { keepStored, type FileReading, type LanguageAdapter, type LanguageContext } from "./adapter";
import { exclusionOf, filesNamed, joinPath, parentOf, readProjectFile } from "./repository-text";
import { lineOf, preview, readTrees } from "./syntax-tree";
import type { Grammars } from "./tree-sitter";
import { buildTypeIndex, qualify, type Declarations } from "./type-index";

// PHP, read with tree-sitter's PHP grammar.
//
//   use A\B\C;  use A\{B, C};     → "use" of the file declaring A\B\C: found
//   use function A\f;               among the classes, interfaces, traits,
//                                   enums and functions every file declares,
//                                   or else through a PSR-4 prefix in a
//                                   composer.json
//   new \A\B\C, \A\B\C::x()      → "type-reference", the same way
//   a class of the file's own namespace named without `use`
//                                 → "type-reference"
//   require 'x.php'; include __DIR__ . '/x.php';
//                                 → "require" of that file, relative to the
//                                   including file's folder, then to the
//                                   repository root; a path built any other
//                                   way is only known at runtime
//
// PHP resolves a relative require against its include path and working
// directory, which are runtime settings; the including file's folder is the
// usual intent and is what is tried first. A namespace the repository does
// not declare belongs to a third-party package, named by its first segment.

type PhpFile = {
  declarations: Declarations;
  uses: { name: string; line: number }[];
  // Fully qualified names written in the code (\A\B\C), with their lines.
  qualified: { name: string; line: number }[];
  // Unqualified and partly qualified names, at their first line.
  names: Map<string, number>;
  requires: { path: string | null; relativeToFile: boolean; expression: string; line: number }[];
};

const TYPE_DECLARATIONS = new Set([
  "class_declaration",
  "interface_declaration",
  "trait_declaration",
  "enum_declaration",
  "function_definition",
]);
const REQUIRES = new Set([
  "require_expression",
  "require_once_expression",
  "include_expression",
  "include_once_expression",
]);

// "App\Models\User" → "App.Models.User", the index's spelling.
const dotted = (name: string) => name.replace(/^\\/, "").split("\\").join(".");

function literal(node: Node): string | null {
  if (node.type !== "string" && node.type !== "encapsed_string") return null;
  const parts = node.namedChildren;
  return parts.every((part) => part.type === "string_content") ? parts.map((part) => part.text).join("") : null;
}

// `__DIR__ . '/x.php'` or `dirname(__FILE__) . '/x.php'`.
function fromOwnFolder(node: Node): string | null {
  if (node.type !== "binary_expression") return null;
  const left = node.childForFieldName("left");
  const right = node.childForFieldName("right");
  if (!left || !right) return null;
  const own = left.text.replace(/\s+/g, "");
  if (own !== "__DIR__" && own !== "dirname(__FILE__)") return null;
  return literal(right);
}

function readPhpFile(root: Node): PhpFile {
  const file: PhpFile = { declarations: [], uses: [], qualified: [], names: new Map(), requires: [] };
  let namespace = "";
  const types: string[] = [];
  const visit = (node: Node) => {
    if (node.type === "namespace_definition") {
      const name = node.childForFieldName("name");
      if (name) namespace = dotted(name.text);
    } else if (TYPE_DECLARATIONS.has(node.type) && node.parent?.type !== "declaration_list") {
      const name = node.childForFieldName("name")?.text;
      if (name) types.push(name);
    } else if (node.type === "namespace_use_declaration") {
      const group = node.childForFieldName("body");
      const prefix = group ? node.namedChildren.find((child) => child.type === "namespace_name")?.text ?? "" : "";
      for (const clause of node.descendantsOfType("namespace_use_clause")) {
        const name = clause.namedChildren.find((child) => child.type === "qualified_name" || child.type === "name");
        if (name) file.uses.push({ name: dotted(prefix ? `${prefix}\\${name.text}` : name.text), line: lineOf(node) });
      }
      return;
    } else if (REQUIRES.has(node.type)) {
      const argument = node.namedChildren[0];
      if (argument) {
        const own = fromOwnFolder(argument);
        const path = own ?? literal(argument);
        file.requires.push({ path, relativeToFile: own !== null, expression: preview(argument.text), line: lineOf(node) });
      }
    } else if (node.type === "qualified_name") {
      if (node.text.startsWith("\\")) file.qualified.push({ name: dotted(node.text), line: lineOf(node) });
      else if (!file.names.has(dotted(node.text))) file.names.set(dotted(node.text), lineOf(node));
      return;
    } else if (node.type === "name" && node.parent?.type !== "variable_name") {
      if (!file.names.has(node.text)) file.names.set(node.text, lineOf(node));
    }
    for (const child of node.namedChildren) visit(child);
  };
  visit(root);
  file.declarations.push({ namespace, types });
  return file;
}

export function phpAdapter(grammars: Grammars): LanguageAdapter {
  return {
    languages: ["php"],
    read(context: LanguageContext) {
      const kept = keepStored("PHP", context);
      if (kept) return { files: kept, resolutionConfigs: [] };
      const { root, walk, files, texts } = context;
      const included = new Set(walk.sourceFiles);
      // PSR-4 prefixes: "App\\" → its folders, from every composer.json.
      const prefixes: { prefix: string; folder: string }[] = [];
      for (const manifest of filesNamed(walk, "composer.json")) {
        try {
          const json: unknown = JSON.parse(readProjectFile(root, manifest) ?? "null");
          if (typeof json !== "object" || json === null) continue;
          for (const section of ["autoload", "autoload-dev"]) {
            const autoload: unknown = Reflect.get(json, section);
            const psr4: unknown = typeof autoload === "object" && autoload !== null ? Reflect.get(autoload, "psr-4") : null;
            if (typeof psr4 !== "object" || psr4 === null) continue;
            for (const [prefix, folders] of Object.entries(psr4)) {
              for (const folder of Array.isArray(folders) ? folders : [folders]) {
                if (typeof folder !== "string") continue;
                prefixes.push({ prefix: dotted(prefix.replace(/\\+$/, "")), folder: joinPath(parentOf(manifest), folder.replace(/\/+$/, "")) });
              }
            }
          }
        } catch {
          // A malformed composer.json declares no prefixes.
        }
      }
      prefixes.sort((a, b) => b.prefix.length - a.prefix.length);

      const trees = readTrees(grammars.php, "PHP", files, texts, (_file, tree) => readPhpFile(tree));
      const declarations = new Map<string, Declarations>();
      for (const [file, { value }] of trees) if (value) declarations.set(file, value.declarations);
      const index = buildTypeIndex(declarations);

      function resolveName(name: string): Resolution {
        const declared = index.filesOf(name);
        if (declared.length > 0) return { status: "internal", target: declared[0], via: "declaration-index" };
        for (const { prefix, folder } of prefixes) {
          if (name !== prefix && !name.startsWith(`${prefix}.`)) continue;
          const candidate = `${joinPath(folder, name.slice(prefix.length + 1).split(".").join("/"))}.php`;
          if (included.has(candidate)) return { status: "internal", target: candidate, via: "psr-4" };
        }
        const first = name.split(".")[0];
        if (index.declaresNamespace(name.includes(".") ? name.slice(0, name.lastIndexOf(".")) : name) || prefixes.some((entry) => entry.prefix === first)) {
          return {
            status: "unresolved",
            reason: "file-not-found",
            detail: `${name.split(".").join("\\")} is in a namespace this repository declares, but no file declares it.`,
          };
        }
        return { status: "external", externalKind: "package", packageName: first };
      }

      const readings = new Map<string, FileReading>();
      for (const [file, { parseStatus, parseErrors, value }] of trees) {
        const references: ResolvedReference[] = [];
        if (value) {
          const add = (kind: "use" | "type-reference" | "require", specifier: string | null, expression: string | null, line: number, resolution: Resolution) =>
            references.push({ source: file, site: { kind, specifier, expression, line, typeOnly: false }, resolution });
          const linked = new Set<string>();
          for (const use of value.uses) {
            const resolution = resolveName(use.name);
            if (resolution.status === "internal") {
              if (resolution.target === file) continue;
              linked.add(resolution.target);
            }
            add("use", use.name.split(".").join("\\"), null, use.line, resolution);
          }
          const seen = new Set<string>();
          for (const { name, line } of value.qualified) {
            if (seen.has(name)) continue;
            seen.add(name);
            const resolution = resolveName(name);
            if (resolution.status !== "internal" || resolution.target === file || linked.has(resolution.target)) continue;
            linked.add(resolution.target);
            add("type-reference", `\\${name.split(".").join("\\")}`, null, line, resolution);
          }
          const namespace = value.declarations[0]?.namespace ?? "";
          for (const [name, targets] of index.typesIn(namespace)) {
            const line = value.names.get(name);
            const target = targets[0];
            if (line === undefined || target === file || linked.has(target)) continue;
            linked.add(target);
            add("type-reference", qualify(namespace, name).split(".").join("\\"), null, line, { status: "internal", target, via: "declaration-index" });
          }
          for (const { path, relativeToFile, expression, line } of value.requires) {
            if (path === null) {
              add("require", null, expression, line, {
                status: "unresolved",
                reason: "non-literal-specifier",
                detail: `The file is named by an expression (${expression}), so it is only known at runtime.`,
              });
              continue;
            }
            const own = parentOf(file);
            const clean = (relative: string) => {
              const parts: string[] = [];
              for (const part of relative.split("/")) {
                if (part === "" || part === ".") continue;
                if (part === "..") {
                  if (parts.length === 0) return null;
                  parts.pop();
                } else parts.push(part);
              }
              return parts.join("/");
            };
            const candidates = relativeToFile || path.startsWith(".")
              ? [clean(joinPath(own, path))]
              : [clean(joinPath(own, path)), clean(path)];
            const target = candidates.find((candidate): candidate is string => candidate !== null && included.has(candidate));
            const elsewhere = candidates.find((candidate): candidate is string => candidate !== null && walk.skippedFiles.has(candidate));
            const rule = elsewhere ? exclusionOf(walk, elsewhere) : null;
            add(
              "require",
              path,
              null,
              line,
              target
                ? { status: "internal", target, via: "relative" }
                : elsewhere && rule
                  ? { status: "excluded", target: elsewhere, rule }
                  : { status: "unresolved", reason: "file-not-found", detail: `No PHP file at ${candidates.filter((c) => c !== null).join(" or ") || path}.` },
            );
          }
        }
        readings.set(file, { parseStatus, parseErrors, references });
      }
      return { files: readings, resolutionConfigs: [] };
    },
  };
}
