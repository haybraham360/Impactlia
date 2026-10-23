import type { Node } from "web-tree-sitter";
import { joinModule, literalString } from "../../parser/languages/python";
import { parserFor, type Grammars } from "../../parser/languages/tree-sitter";
import {
  FEATURE_KINDS,
  isAddedLine,
  touches,
  type ChangedDeclaration,
  type ChangedLines,
  type FeatureKind,
  type ImportBinding,
} from "./syntax";

// What tree-sitter's Python grammar can say about one file's text, in the
// same terms syntax.ts uses for TypeScript: which top-level declarations a
// diff touches, what kind of code it added inside them, and what a test file
// imports. Pure: text in, positions out. Nothing is run.
//
// Python has no export list that binds an import: anything defined at the top
// of a module can be imported from it, so every top-level declaration is
// "exported" under its own name. A method is reached through its class.
//
// The feature kinds map onto Python syntax as:
//   throw    raise
//   catch    except
//   branch   if, elif, a conditional expression, a match case
//   fallback a parameter's default value
//   await    await

const lineOf = (node: Node) => node.startPosition.row + 1;
const endLineOf = (node: Node) => node.endPosition.row + 1;

function parse<T>(grammars: Grammars, text: string, read: (root: Node) => T): T | null {
  const parser = parserFor(grammars.python);
  try {
    const tree = parser.parse(text);
    if (!tree) return null;
    try {
      return read(tree.rootNode);
    } finally {
      tree.delete();
    }
  } finally {
    parser.delete();
  }
}

type Candidate = {
  name: string;
  exportedAs: string[];
  kind: ChangedDeclaration["kind"];
  // The whole statement, decorators included.
  node: Node;
  // The function_definition whose parameters are its signature, if any.
  signatureOf: Node | null;
};

// A decorated definition is reported from its first decorator.
function unwrap(statement: Node): Node | null {
  if (statement.type !== "decorated_definition") return statement;
  return statement.childForFieldName("definition");
}

function assignedNames(assignment: Node): string[] {
  const names: string[] = [];
  for (let node: Node | null = assignment; node?.type === "assignment"; node = node.childForFieldName("right")) {
    const left = node.childForFieldName("left");
    if (left?.type === "identifier") names.push(left.text);
    else if (left?.type === "pattern_list" || left?.type === "tuple_pattern") {
      for (const item of left.namedChildren) if (item.type === "identifier") names.push(item.text);
    }
  }
  return names;
}

function declarationsOf(root: Node): Candidate[] {
  const candidates: Candidate[] = [];
  for (const statement of root.namedChildren) {
    const definition = unwrap(statement);
    if (!definition) continue;
    if (definition.type === "function_definition") {
      const name = definition.childForFieldName("name")?.text;
      if (name) candidates.push({ name, exportedAs: [name], kind: "function", node: statement, signatureOf: definition });
    } else if (definition.type === "class_definition") {
      const name = definition.childForFieldName("name")?.text;
      if (!name) continue;
      candidates.push({ name, exportedAs: [name], kind: "class", node: statement, signatureOf: null });
      for (const member of definition.childForFieldName("body")?.namedChildren ?? []) {
        const method = unwrap(member);
        const methodName = method?.type === "function_definition" ? method.childForFieldName("name")?.text : null;
        if (method && methodName) {
          candidates.push({
            name: `${name}.${methodName}`,
            exportedAs: [name],
            kind: "method",
            node: member,
            signatureOf: method,
          });
        }
      }
    } else if (definition.type === "expression_statement") {
      const assignment = definition.namedChildren[0];
      if (assignment?.type !== "assignment") continue;
      const value = assignment.childForFieldName("right");
      const kind = value?.type === "lambda" ? "function" : "variable";
      for (const name of assignedNames(assignment)) {
        candidates.push({ name, exportedAs: [name], kind, node: statement, signatureOf: null });
      }
    } else if (definition.type === "type_alias_statement") {
      const name = definition.childForFieldName("left")?.text;
      if (name) candidates.push({ name, exportedAs: [name], kind: "type", node: statement, signatureOf: null });
    }
  }
  return candidates;
}

function featuresIn(candidate: Candidate, lines: ChangedLines): ChangedDeclaration["features"] {
  const found = new Map<FeatureKind, Set<number>>();
  const note = (kind: FeatureKind, line: number) => {
    if (!isAddedLine(lines, line)) return;
    const set = found.get(kind) ?? new Set<number>();
    set.add(line);
    found.set(kind, set);
  };

  // From the def line to the end of its parameters and return annotation.
  const fn = candidate.signatureOf;
  if (fn) {
    const end = fn.childForFieldName("return_type") ?? fn.childForFieldName("parameters");
    if (end) for (let line = lineOf(fn); line <= endLineOf(end); line += 1) note("signature", line);
  }

  const visit = (node: Node) => {
    switch (node.type) {
      case "raise_statement":
        note("throw", lineOf(node));
        break;
      case "except_clause":
      case "except_group_clause":
        note("catch", lineOf(node));
        break;
      case "if_statement":
      case "elif_clause":
      case "conditional_expression":
      case "case_clause":
        note("branch", lineOf(node));
        break;
      case "default_parameter":
      case "typed_default_parameter":
        note("fallback", lineOf(node));
        break;
      case "await":
        note("await", lineOf(node));
        break;
    }
    for (const child of node.namedChildren) visit(child);
  };
  const definition = unwrap(candidate.node);
  if (definition?.type === "class_definition") {
    // Methods are their own entries; the class keeps the rest of its body.
    for (const member of definition.childForFieldName("body")?.namedChildren ?? []) {
      if (unwrap(member)?.type === "function_definition") continue;
      visit(member);
    }
  } else {
    visit(candidate.node);
  }

  const features: ChangedDeclaration["features"] = {};
  for (const kind of FEATURE_KINDS) {
    const set = found.get(kind);
    if (set) features[kind] = [...set].sort((a, b) => a - b);
  }
  return features;
}

// The declarations the diff touches, in file order.
export function changedPythonDeclarations(
  grammars: Grammars,
  text: string,
  lines: ChangedLines,
): ChangedDeclaration[] {
  const changed =
    parse(grammars, text, (root) =>
      declarationsOf(root).flatMap((candidate): ChangedDeclaration[] => {
        const startLine = lineOf(candidate.node);
        const endLine = endLineOf(candidate.node);
        if (!touches(lines, startLine, endLine)) return [];
        return [
          {
            name: candidate.name,
            exportedAs: candidate.exportedAs,
            kind: candidate.kind,
            startLine,
            endLine,
            features: candidate.kind === "type" ? {} : featuresIn(candidate, lines),
          },
        ];
      }),
    ) ?? [];
  return changed.sort((a, b) => a.startLine - b.startLine || (a.name < b.name ? -1 : 1));
}

// A test's imports, matching the evidence the parser recorded for them: each
// on the statement's first line, under the module name the parser used.
//
//   import a.b                → a.b, whole
//   from a import x, y        → a, naming x and y; and a.x and a.y, whole,
//                               for whichever of them the parser found to be
//                               submodules
//   from a import *           → a, whole
export function pythonImportsOf(grammars: Grammars, text: string): ImportBinding[] {
  return (
    parse(grammars, text, (root) => {
      const bindings: ImportBinding[] = [];
      const visit = (node: Node) => {
        if (node.type === "import_statement") {
          for (const clause of node.childrenForFieldName("name")) {
            const name = clause.type === "aliased_import" ? clause.childForFieldName("name") : clause;
            if (name) bindings.push({ specifier: name.text.replace(/\s+/g, ""), line: lineOf(node), names: [], whole: true });
          }
          return;
        }
        if (node.type === "import_from_statement") {
          const moduleNode = node.childForFieldName("module_name");
          if (!moduleNode) return;
          const moduleName = moduleNode.text.replace(/\s+/g, "");
          const names = node.childrenForFieldName("name").flatMap((clause) => {
            const name = clause.type === "aliased_import" ? clause.childForFieldName("name") : clause;
            return name ? [name.text.replace(/\s+/g, "")] : [];
          });
          bindings.push({ specifier: moduleName, line: lineOf(node), names, whole: names.length === 0 });
          for (const name of names) {
            bindings.push({ specifier: joinModule(moduleName, name), line: lineOf(node), names: [], whole: true });
          }
          return;
        }
        if (node.type === "call") {
          const callee = node.childForFieldName("function");
          const dynamic =
            callee !== null &&
            (callee.text === "__import__" || callee.text.replace(/\s+/g, "") === "importlib.import_module");
          const first = node.childForFieldName("arguments")?.namedChildren[0];
          const literal = dynamic && first ? literalString(first) : null;
          if (literal !== null) bindings.push({ specifier: literal, line: lineOf(node), names: [], whole: true });
        }
        for (const child of node.namedChildren) visit(child);
      };
      visit(root);
      return bindings;
    }) ?? []
  );
}
