import type { Node } from "web-tree-sitter";
import type { ResolvedReference } from "../graph";
import type { Resolution } from "../resolve";
import { keepStored, type FileReading, type LanguageAdapter, type LanguageContext } from "./adapter";
import { compact, lineOf, readTrees } from "./syntax-tree";
import type { Grammars } from "./tree-sitter";
import { buildTypeIndex, qualify, type Declarations } from "./type-index";

// C#, read with tree-sitter's C# grammar.
//
// A `using` directive brings a namespace into scope, not a file, so files
// are linked through the types they name: a name in the file that is a type
// declared, by another file, in a namespace the file can see. Those are:
// the global namespace, the file's own namespaces and the ones enclosing
// them, the namespaces it uses, and any `global using` in the repository.
// Each such link is a "type-reference" with the first line the name appears
// on. A partial class declared in several files links to all of them.
//
//   using static A.B.C;   → "use" of the file declaring C
//   using X = A.B.C;      → "use" of the file declaring C, when C is a type
//
// The match is on names in the syntax tree, not on the compiler's binding,
// so a local variable that shares a type's name links to it too. Which
// project (.csproj) a file belongs to is not read: every file sees every
// namespace of the repository. A namespace the repository does not declare
// is the platform's when it is System or under it, and a package otherwise.

type Using = { name: string; isStatic: boolean; alias: boolean; isGlobal: boolean; line: number };
type CSharpFile = {
  declarations: Declarations;
  usings: Using[];
  // Every identifier, at its first line.
  names: Map<string, number>;
};

const TYPE_DECLARATIONS = new Set([
  "class_declaration",
  "struct_declaration",
  "interface_declaration",
  "enum_declaration",
  "record_declaration",
  "record_struct_declaration",
  "delegate_declaration",
]);

function readCSharpFile(root: Node): CSharpFile {
  const file: CSharpFile = { declarations: [], usings: [], names: new Map() };
  // The types directly inside a namespace (or at the top of the file), not
  // those nested in other types.
  const collect = (container: Node, namespace: string) => {
    const types: string[] = [];
    for (const node of container.namedChildren) {
      if (TYPE_DECLARATIONS.has(node.type)) {
        const name = node.childForFieldName("name")?.text;
        if (name) types.push(name);
      } else if (node.type === "namespace_declaration") {
        const name = node.childForFieldName("name");
        const body = node.childForFieldName("body");
        if (name && body) collect(body, qualify(namespace, compact(name)));
      } else if (node.type === "file_scoped_namespace_declaration") {
        const name = node.childForFieldName("name");
        // Everything after it in the file is inside it.
        if (name) {
          const inner = qualify(namespace, compact(name));
          const after = container.namedChildren.filter((child) => child.startIndex > node.startIndex);
          const scoped: string[] = [];
          for (const child of after) {
            if (TYPE_DECLARATIONS.has(child.type)) {
              const typeName = child.childForFieldName("name")?.text;
              if (typeName) scoped.push(typeName);
            }
          }
          file.declarations.push({ namespace: inner, types: scoped });
          return;
        }
      } else if (node.type === "using_directive") {
        const alias = node.childForFieldName("name");
        const target = node.namedChildren.filter((child) => child.id !== alias?.id).at(-1);
        if (!target) continue;
        file.usings.push({
          name: compact(target),
          isStatic: node.children.some((child) => child.type === "static"),
          alias: alias !== null,
          isGlobal: node.children.some((child) => child.type === "global"),
          line: lineOf(node),
        });
      }
    }
    file.declarations.push({ namespace, types });
  };
  collect(root, "");
  const visit = (node: Node) => {
    if (node.type === "identifier" && !file.names.has(node.text)) file.names.set(node.text, lineOf(node));
    for (const child of node.namedChildren) visit(child);
  };
  visit(root);
  return file;
}

const enclosing = (namespace: string): string[] => {
  const all: string[] = [];
  for (let at = namespace; at !== ""; at = at.includes(".") ? at.slice(0, at.lastIndexOf(".")) : "") all.push(at);
  return all;
};

export function csharpAdapter(grammars: Grammars): LanguageAdapter {
  return {
    languages: ["csharp"],
    read(context: LanguageContext) {
      const kept = keepStored("C#", context);
      if (kept) return { files: kept, resolutionConfigs: [] };
      const { files, texts } = context;
      const trees = readTrees(grammars.csharp, "C#", files, texts, (_file, root) => readCSharpFile(root));
      const declarations = new Map<string, Declarations>();
      const globalUsings = new Set<string>();
      for (const [file, { value }] of trees) {
        if (!value) continue;
        declarations.set(file, value.declarations);
        for (const using of value.usings) {
          if (using.isGlobal && !using.isStatic && !using.alias) globalUsings.add(using.name);
        }
      }
      const index = buildTypeIndex(declarations);
      const outside = (name: string): Resolution => ({
        status: "external",
        externalKind: name === "System" || name.startsWith("System.") ? "builtin" : "package",
        packageName: name,
      });

      const readings = new Map<string, FileReading>();
      for (const [file, { parseStatus, parseErrors, value }] of trees) {
        const references: ResolvedReference[] = [];
        if (value) {
          const add = (kind: "use" | "type-reference", specifier: string, line: number, resolution: Resolution) =>
            references.push({ source: file, site: { kind, specifier, expression: null, line, typeOnly: false }, resolution });
          const visible = new Set<string>(["", ...globalUsings]);
          for (const { namespace } of value.declarations) for (const at of enclosing(namespace)) visible.add(at);
          for (const using of value.usings) {
            if (using.isStatic || using.alias) {
              const targets = index.filesOf(using.name).filter((target) => target !== file);
              if (targets.length > 0) {
                for (const target of targets) add("use", using.name, using.line, { status: "internal", target, via: "declaration-index" });
              } else if (using.alias && index.declaresNamespace(using.name)) {
                visible.add(using.name);
              } else if (!index.declaresNamespace(using.name) && index.filesOf(using.name).length === 0) {
                add("use", using.name, using.line, outside(using.name));
              }
            } else if (index.declaresNamespace(using.name)) {
              visible.add(using.name);
            } else {
              add("use", using.name, using.line, outside(using.name));
            }
          }
          for (const namespace of [...visible].sort()) {
            for (const [name, targets] of index.typesIn(namespace)) {
              const line = value.names.get(name);
              if (line === undefined) continue;
              for (const target of targets) {
                // A partial class declared here still links to its other parts.
                if (target === file) continue;
                add("type-reference", qualify(namespace, name), line, { status: "internal", target, via: "declaration-index" });
              }
            }
          }
        }
        readings.set(file, { parseStatus, parseErrors, references });
      }
      return { files: readings, resolutionConfigs: [] };
    },
  };
}
