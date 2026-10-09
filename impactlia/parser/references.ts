import ts from "typescript";
import type { ReferenceKind } from "./contract";

// One place in a file that names another module.
export type ReferenceSite = {
  kind: ReferenceKind;
  // null when the module is named by an expression instead of a string literal.
  specifier: string | null;
  // Source text of that expression, for the report.
  expression: string | null;
  line: number;
  typeOnly: boolean;
};

const EXPRESSION_PREVIEW_LENGTH = 80;

// Reads every module reference out of a parsed file by walking its syntax
// tree. The whole tree is walked, not just the top-level statements, because
// dynamic imports, require calls and import types can sit anywhere.
export function extractReferences(sourceFile: ts.SourceFile): ReferenceSite[] {
  const sites: ReferenceSite[] = [];
  const lineOf = (position: number) =>
    sourceFile.getLineAndCharacterOfPosition(position).line + 1;

  function add(kind: ReferenceKind, node: ts.Node, specifier: ts.Node, typeOnly: boolean): void {
    const literal = ts.isStringLiteralLike(specifier);
    const text = literal ? null : specifier.getText(sourceFile);
    sites.push({
      kind,
      specifier: literal ? specifier.text : null,
      expression:
        text !== null && text.length > EXPRESSION_PREVIEW_LENGTH
          ? `${text.slice(0, EXPRESSION_PREVIEW_LENGTH)}…`
          : text,
      line: lineOf(node.getStart(sourceFile)),
      typeOnly,
    });
  }

  for (const reference of sourceFile.referencedFiles) {
    sites.push({
      kind: "reference-path",
      specifier: reference.fileName,
      expression: null,
      line: lineOf(reference.pos),
      typeOnly: true,
    });
  }
  for (const reference of sourceFile.typeReferenceDirectives) {
    sites.push({
      kind: "reference-types",
      specifier: reference.fileName,
      expression: null,
      line: lineOf(reference.pos),
      typeOnly: true,
    });
  }

  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node)) {
      const typeOnly = node.importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword;
      add("import", node, node.moduleSpecifier, typeOnly);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      add("re-export", node, node.moduleSpecifier, node.isTypeOnly);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      add("require", node, node.moduleReference.expression, node.isTypeOnly);
    } else if (ts.isCallExpression(node) && node.arguments.length > 0) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        add("dynamic-import", node, node.arguments[0], false);
      } else if (
        // A call to anything named `require` with one argument is read as
        // CommonJS. Without type information a local function that happens to
        // share the name cannot be told apart.
        ts.isIdentifier(node.expression) &&
        node.expression.text === "require" &&
        node.arguments.length === 1
      ) {
        add("require", node, node.arguments[0], false);
      }
    } else if (ts.isImportTypeNode(node)) {
      const argument = node.argument;
      add("import-type", node, ts.isLiteralTypeNode(argument) ? argument.literal : argument, true);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return sites;
}
