import type { Node } from "web-tree-sitter";
import type { ResolvedReference } from "../graph";
import type { Resolution } from "../resolve";
import { keepStored, type FileReading, type LanguageAdapter, type LanguageContext } from "./adapter";
import { compact, lineOf, readTrees } from "./syntax-tree";
import type { Grammars } from "./tree-sitter";
import { buildTypeIndex, qualify, type Declarations } from "./type-index";

// Java, read with tree-sitter's Java grammar. Files are linked through the
// types they name, matched against what every file declares (its package
// and its top-level types), never against its path:
//
//   import a.b.C;           → the file declaring C in package a.b (or the
//                             enclosing type, for a nested one)
//   import static a.b.C.m;  → the file declaring C
//   import a.b.*;           → the files of package a.b whose types this file
//                             names
//   a type of its own package, named without an import
//                           → "type-reference" to the file declaring it
//
// A name is a type name where the grammar says so (a type, an annotation)
// or where it is the receiver of a call or field access and starts with a
// capital letter, the Java convention for a class. Imports of java.*,
// javax.*, jdk.* and sun.* are the platform's; any other package the
// repository does not declare is a third-party one.

type JavaFile = {
  package: string;
  types: string[];
  imports: { name: string; isStatic: boolean; wildcard: boolean; line: number }[];
  // Each name used as a type, at its first line.
  typeNames: Map<string, number>;
};

const PLATFORM = new Set(["java", "javax", "jdk", "sun"]);
const TYPE_DECLARATIONS = new Set([
  "class_declaration",
  "interface_declaration",
  "enum_declaration",
  "record_declaration",
  "annotation_type_declaration",
]);

function readJavaFile(root: Node): JavaFile {
  const file: JavaFile = { package: "", types: [], imports: [], typeNames: new Map() };
  for (const node of root.namedChildren) {
    if (node.type === "package_declaration") {
      const name = node.namedChildren.find((child) => child.type === "scoped_identifier" || child.type === "identifier");
      if (name) file.package = compact(name);
    } else if (node.type === "import_declaration") {
      const name = node.namedChildren.find((child) => child.type === "scoped_identifier" || child.type === "identifier");
      if (!name) continue;
      file.imports.push({
        name: compact(name),
        isStatic: node.children.some((child) => child.type === "static"),
        wildcard: node.namedChildren.some((child) => child.type === "asterisk"),
        line: lineOf(node),
      });
    } else if (TYPE_DECLARATIONS.has(node.type)) {
      const name = node.childForFieldName("name")?.text;
      if (name) file.types.push(name);
    }
  }
  const note = (name: string, node: Node) => {
    if (!file.typeNames.has(name)) file.typeNames.set(name, lineOf(node));
  };
  const visit = (node: Node) => {
    if (node.type === "type_identifier") note(node.text, node);
    else if (node.type === "marker_annotation" || node.type === "annotation") {
      const name = node.childForFieldName("name");
      if (name?.type === "identifier") note(name.text, name);
    } else if (node.type === "method_invocation" || node.type === "field_access" || node.type === "method_reference") {
      const receiver = node.type === "method_reference" ? node.namedChildren[0] : node.childForFieldName("object");
      if (receiver?.type === "identifier" && /^[A-Z]/.test(receiver.text)) note(receiver.text, receiver);
    }
    for (const child of node.namedChildren) visit(child);
  };
  visit(root);
  return file;
}

export function javaAdapter(grammars: Grammars): LanguageAdapter {
  return {
    languages: ["java"],
    read(context: LanguageContext) {
      const kept = keepStored("Java", context);
      if (kept) return { files: kept, resolutionConfigs: [] };
      const { files, texts } = context;
      const trees = readTrees(grammars.java, "Java", files, texts, (_file, root) => readJavaFile(root));
      const declarations = new Map<string, Declarations>();
      for (const [file, { value }] of trees) {
        if (value) declarations.set(file, [{ namespace: value.package, types: value.types }]);
      }
      const index = buildTypeIndex(declarations);

      // The file declaring a type, trying enclosing names for a nested one:
      // a.b.C.Inner is declared by the file declaring a.b.C.
      function typeFiles(qualified: string): string[] {
        for (let name = qualified; name.includes("."); name = name.slice(0, name.lastIndexOf("."))) {
          const found = index.filesOf(name);
          if (found.length > 0) return found;
        }
        return index.filesOf(qualified);
      }
      function outside(name: string): Resolution {
        const segments = name.split(".");
        if (PLATFORM.has(segments[0])) {
          return { status: "external", externalKind: "builtin", packageName: segments.slice(0, 2).join(".") };
        }
        if (index.declaresNamespace(segments.slice(0, 2).join("."))) {
          return {
            status: "unresolved",
            reason: "file-not-found",
            detail: `The package ${segments.slice(0, 2).join(".")} is declared in this repository, but no file declares ${name}.`,
          };
        }
        return { status: "external", externalKind: "package", packageName: segments.slice(0, 2).join(".") };
      }

      const readings = new Map<string, FileReading>();
      for (const [file, { parseStatus, parseErrors, value }] of trees) {
        const references: ResolvedReference[] = [];
        const add = (kind: "import" | "type-reference", specifier: string, line: number, resolution: Resolution) =>
          references.push({ source: file, site: { kind, specifier, expression: null, line, typeOnly: false }, resolution });
        if (value) {
          const own = new Set(value.types);
          // Names imported one by one shadow same-named types of the package.
          const imported = new Set<string>();
          for (const entry of value.imports) {
            if (entry.wildcard) {
              const specifier = `${entry.name}.*`;
              const internal = (target: string) =>
                add("import", specifier, entry.line, { status: "internal", target, via: "declaration-index" });
              if (index.declaresNamespace(entry.name)) {
                // A package: only the types this file names tie it to a file.
                for (const [name, targets] of index.typesIn(entry.name)) {
                  if (value.typeNames.has(name)) targets.filter((target) => target !== file).forEach(internal);
                }
              } else if (typeFiles(entry.name).length > 0) {
                // A type's members: `import static a.b.C.*`.
                typeFiles(entry.name).filter((target) => target !== file).forEach(internal);
              } else {
                add("import", specifier, entry.line, outside(entry.name));
              }
              continue;
            }
            const typeName = entry.isStatic ? entry.name.slice(0, entry.name.lastIndexOf(".")) : entry.name;
            imported.add(entry.name.slice(entry.name.lastIndexOf(".") + 1));
            const targets = typeFiles(typeName).filter((target) => target !== file);
            if (targets.length > 0) {
              for (const target of targets) add("import", entry.name, entry.line, { status: "internal", target, via: "declaration-index" });
            } else if (typeFiles(typeName).length === 0) {
              add("import", entry.name, entry.line, outside(typeName));
            }
          }
          for (const [name, targets] of index.typesIn(value.package)) {
            const line = value.typeNames.get(name);
            if (line === undefined || own.has(name) || imported.has(name)) continue;
            for (const target of targets) {
              if (target !== file) {
                add("type-reference", qualify(value.package, name), line, { status: "internal", target, via: "declaration-index" });
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
