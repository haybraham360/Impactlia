import ts from "typescript";
import type { LineRange } from "./report";

// What the TypeScript parser can say about one file's text: which top-level
// declarations a diff touches, what kind of code it added inside them, and
// what a test file imports. Pure: text in, positions out. Nothing here runs
// the code, and nothing reads beyond the text it is given.
//
// Only syntax is read. A name here is a declaration in the file; whether
// anything calls it is the graph's business, not this file's.

// Which lines of the head revision a pull request changed. "all" is a new file.
export type ChangedLines = { added: readonly LineRange[] | "all"; removedAt: readonly number[] };

// Kinds of code on an added line that a test can be aimed at. Each is a
// syntax node, so its presence is a fact; that it deserves a test is the
// inference.
export const FEATURE_KINDS = ["signature", "throw", "catch", "branch", "fallback", "await"] as const;
export type FeatureKind = (typeof FEATURE_KINDS)[number];

export type ChangedDeclaration = {
  // "format", "default", or "Cart.total" for a method of a class.
  name: string;
  // The names other files import it by. Empty when it is not exported; a
  // method has its class's.
  exportedAs: string[];
  kind: "function" | "class" | "method" | "variable" | "type";
  startLine: number;
  endLine: number;
  // Lines of each kind of added code inside it, sorted. A kind is absent when
  // there is none.
  features: Partial<Record<FeatureKind, number[]>>;
};

function lineOf(file: ts.SourceFile, position: number): number {
  return file.getLineAndCharacterOfPosition(position).line + 1;
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === kind);
}

function scriptKindOf(fileName: string): ts.ScriptKind {
  if (/\.[cm]?tsx$/.test(fileName)) return ts.ScriptKind.TSX;
  if (/\.[cm]?jsx$/.test(fileName)) return ts.ScriptKind.JSX;
  if (/\.[cm]?js$/.test(fileName)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function parse(fileName: string, text: string): ts.SourceFile {
  return ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, scriptKindOf(fileName));
}

type Candidate = {
  name: string;
  exportedAs: string[];
  kind: ChangedDeclaration["kind"];
  node: ts.Node;
  // The function whose parameters are this declaration's signature, if any.
  signatureOf: (ts.SignatureDeclaration & { body?: ts.Node }) | null;
};

// Every top-level declaration, with methods of classes listed after their
// class. Exports written apart from the declaration (`export { a as b }`,
// `export default a`) are attached to it.
function declarationsOf(file: ts.SourceFile): Candidate[] {
  const candidates: Candidate[] = [];
  const byLocalName = new Map<string, Candidate>();
  const add = (candidate: Candidate) => {
    candidates.push(candidate);
    if (!byLocalName.has(candidate.name)) byLocalName.set(candidate.name, candidate);
  };

  for (const statement of file.statements) {
    const exported = hasModifier(statement, ts.SyntaxKind.ExportKeyword);
    const isDefault = hasModifier(statement, ts.SyntaxKind.DefaultKeyword);
    const exportNames = (name: string) => (!exported ? [] : isDefault ? ["default"] : [name]);

    if (ts.isFunctionDeclaration(statement)) {
      const name = statement.name?.text ?? "default";
      add({ name, exportedAs: exportNames(name), kind: "function", node: statement, signatureOf: statement });
    } else if (ts.isClassDeclaration(statement)) {
      const name = statement.name?.text ?? "default";
      const exportedAs = exportNames(name);
      add({ name, exportedAs, kind: "class", node: statement, signatureOf: null });
      for (const member of statement.members) {
        if (
          (ts.isMethodDeclaration(member) || ts.isConstructorDeclaration(member)) &&
          member.body
        ) {
          const memberName = ts.isConstructorDeclaration(member)
            ? "constructor"
            : member.name.getText(file);
          candidates.push({
            name: `${name}.${memberName}`,
            exportedAs,
            kind: "method",
            node: member,
            signatureOf: member,
          });
        }
      }
    } else if (ts.isVariableStatement(statement)) {
      const single = statement.declarationList.declarations.length === 1;
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue;
        const name = declaration.name.text;
        const initializer = declaration.initializer;
        const fn =
          initializer && (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))
            ? initializer
            : null;
        add({
          name,
          exportedAs: exportNames(name),
          kind: fn ? "function" : "variable",
          // One declaration per statement: the statement, so `export const`
          // on its own line counts.
          node: single ? statement : declaration,
          signatureOf: fn,
        });
      }
    } else if (
      ts.isInterfaceDeclaration(statement) ||
      ts.isTypeAliasDeclaration(statement) ||
      ts.isEnumDeclaration(statement)
    ) {
      const name = statement.name.text;
      add({ name, exportedAs: exportNames(name), kind: "type", node: statement, signatureOf: null });
    } else if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
      if (ts.isIdentifier(statement.expression)) {
        byLocalName.get(statement.expression.text)?.exportedAs.push("default");
      } else {
        const fn =
          ts.isArrowFunction(statement.expression) || ts.isFunctionExpression(statement.expression)
            ? statement.expression
            : null;
        add({
          name: "default",
          exportedAs: ["default"],
          kind: fn ? "function" : "variable",
          node: statement,
          signatureOf: fn,
        });
      }
    }
  }

  // `export { a, b as c }` with no `from`: names declared above.
  for (const statement of file.statements) {
    if (
      !ts.isExportDeclaration(statement) ||
      statement.moduleSpecifier ||
      !statement.exportClause ||
      !ts.isNamedExports(statement.exportClause)
    ) {
      continue;
    }
    for (const element of statement.exportClause.elements) {
      const local = (element.propertyName ?? element.name).getText(file);
      const target = byLocalName.get(local);
      if (target) target.exportedAs.push(element.name.getText(file));
    }
  }
  // A class's methods share its export names, which may only now be known.
  for (const candidate of candidates) {
    if (candidate.kind !== "method") continue;
    const owner = byLocalName.get(candidate.name.slice(0, candidate.name.indexOf(".")));
    if (owner) candidate.exportedAs = owner.exportedAs;
  }
  return candidates;
}

export function touches(lines: ChangedLines, start: number, end: number): boolean {
  if (lines.added === "all") return true;
  if (lines.added.some((range) => range.start <= end && range.end >= start)) return true;
  // A removal at a declaration's first line is lines taken out just above it,
  // so only points strictly inside count.
  return lines.removedAt.some((point) => point > start && point <= end);
}

export function isAddedLine(lines: ChangedLines, line: number): boolean {
  return lines.added === "all" || lines.added.some((range) => line >= range.start && line <= range.end);
}

// The kinds of code on added lines within `node`.
function featuresIn(
  file: ts.SourceFile,
  candidate: Candidate,
  lines: ChangedLines,
): ChangedDeclaration["features"] {
  const found = new Map<FeatureKind, Set<number>>();
  const note = (kind: FeatureKind, line: number) => {
    if (!isAddedLine(lines, line)) return;
    const set = found.get(kind) ?? new Set<number>();
    set.add(line);
    found.set(kind, set);
  };

  // The signature: from the declaration's first line to the end of its
  // parameters and return type. Only an exported declaration has callers in
  // other files for a changed signature to matter to.
  const fn = candidate.signatureOf;
  if (fn && candidate.exportedAs.length > 0) {
    const from = lineOf(file, candidate.node.getStart(file));
    const to = lineOf(file, (fn.type ?? fn.parameters).end);
    for (let line = from; line <= to; line += 1) note("signature", line);
  }

  // A nested class or function belongs to the declaration it is in, and its
  // code counts there.
  const visit = (node: ts.Node) => {
    const line = () => lineOf(file, node.getStart(file));
    if (ts.isThrowStatement(node)) note("throw", line());
    else if (ts.isCatchClause(node)) note("catch", line());
    else if (ts.isIfStatement(node) || ts.isConditionalExpression(node) || ts.isCaseClause(node)) {
      note("branch", line());
    } else if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
    ) {
      note("fallback", lineOf(file, node.operatorToken.getStart(file)));
    } else if (
      (ts.isPropertyAccessExpression(node) ||
        ts.isElementAccessExpression(node) ||
        ts.isCallExpression(node)) &&
      node.questionDotToken
    ) {
      note("fallback", lineOf(file, node.questionDotToken.getStart(file)));
    } else if (ts.isParameter(node) && node.initializer) {
      note("fallback", line());
    } else if (ts.isAwaitExpression(node)) {
      note("await", line());
    }
    ts.forEachChild(node, visit);
  };
  if (ts.isClassDeclaration(candidate.node)) {
    // Methods are their own entries; the class itself keeps what is outside
    // them, like property initialisers.
    for (const member of candidate.node.members) {
      if ((ts.isMethodDeclaration(member) || ts.isConstructorDeclaration(member)) && member.body) {
        continue;
      }
      visit(member);
    }
  } else {
    ts.forEachChild(candidate.node, visit);
  }

  const features: ChangedDeclaration["features"] = {};
  for (const kind of FEATURE_KINDS) {
    const set = found.get(kind);
    if (set) features[kind] = [...set].sort((a, b) => a - b);
  }
  return features;
}

// The declarations the diff touches, in file order.
export function changedDeclarations(
  fileName: string,
  text: string,
  lines: ChangedLines,
): ChangedDeclaration[] {
  const file = parse(fileName, text);
  const changed: ChangedDeclaration[] = [];
  for (const candidate of declarationsOf(file)) {
    const startLine = lineOf(file, candidate.node.getStart(file));
    const endLine = lineOf(file, candidate.node.getEnd());
    if (!touches(lines, startLine, endLine)) continue;
    changed.push({
      name: candidate.name,
      exportedAs: [...new Set(candidate.exportedAs)],
      kind: candidate.kind,
      startLine,
      endLine,
      features: candidate.kind === "type" ? {} : featuresIn(file, candidate, lines),
    });
  }
  return changed.sort((a, b) => a.startLine - b.startLine || (a.name < b.name ? -1 : 1));
}

// One import of another module, as written. `names` are the exported names
// it binds ("default" for a default import). `whole` is true when it takes
// the whole module (a namespace import, a plain require or a dynamic import),
// so any export may be used.
export type ImportBinding = {
  specifier: string;
  line: number;
  names: string[];
  whole: boolean;
};

export function importsOf(fileName: string, text: string): ImportBinding[] {
  const file = parse(fileName, text);
  const bindings: ImportBinding[] = [];
  const push = (specifier: ts.StringLiteralLike, names: string[], whole: boolean) => {
    bindings.push({ specifier: specifier.text, line: lineOf(file, specifier.getStart(file)), names, whole });
  };

  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
      const clause = node.importClause;
      const names: string[] = [];
      let whole = false;
      if (clause?.name) names.push("default");
      const bound = clause?.namedBindings;
      if (bound && ts.isNamespaceImport(bound)) whole = true;
      if (bound && ts.isNamedImports(bound)) {
        for (const element of bound.elements) names.push((element.propertyName ?? element.name).text);
      }
      push(node.moduleSpecifier, names, whole);
      return;
    }
    if (ts.isCallExpression(node) && node.arguments.length >= 1) {
      const [argument] = node.arguments;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === "require";
      const isDynamic = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      if ((isRequire || isDynamic) && ts.isStringLiteralLike(argument)) {
        // `const { a, b } = require("x")` names what it uses.
        const parent = node.parent;
        if (isRequire && ts.isVariableDeclaration(parent) && ts.isObjectBindingPattern(parent.name)) {
          const names = parent.name.elements.flatMap((element) => {
            const key = element.propertyName ?? element.name;
            return ts.isIdentifier(key) ? [key.text] : [];
          });
          push(argument, names, names.length !== parent.name.elements.length);
        } else {
          push(argument, [], true);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return bindings;
}
