import ts from "typescript";

// Syntax questions more than one adapter asks. All of them read the tree the
// parser already built; none resolves a name beyond the file it is in.

export const lineOf = (sourceFile: ts.SourceFile, node: ts.Node): number =>
  sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;

// What an exported name is bound to, as far as this file's syntax says.
export type BindingKind = "function" | "class" | "call" | "value" | "unknown";

// The name given to what `module.exports = value` exports: the module itself,
// which is what `require()` returns.
export const COMMONJS_MODULE = "module.exports";

export type ExportedBinding = {
  // The name importers use; "default" for the default export, and
  // COMMONJS_MODULE for a CommonJS module's whole value.
  name: string;
  // The name inside the file, when there is one.
  local: string | null;
  kind: BindingKind;
  line: number;
};

function kindOfExpression(expression: ts.Expression | undefined): BindingKind {
  if (!expression) return "value";
  if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) return "function";
  if (ts.isClassExpression(expression)) return "class";
  if (ts.isCallExpression(expression)) return "call";
  if (ts.isIdentifier(expression)) return "unknown";
  return "value";
}

const hasModifier = (node: ts.Node, kind: ts.SyntaxKind): boolean =>
  ts.canHaveModifiers(node) &&
  (ts.getModifiers(node)?.some((modifier) => modifier.kind === kind) ?? false);

// `module.exports` → "", `module.exports.name` and `exports.name` → "name",
// anything else → null.
function commonJsTarget(node: ts.Expression): string | null {
  if (!ts.isPropertyAccessExpression(node)) return null;
  const { expression, name } = node;
  if (ts.isIdentifier(expression)) {
    if (expression.text === "module" && name.text === "exports") return "";
    return expression.text === "exports" ? name.text : null;
  }
  return commonJsTarget(expression) === "" ? name.text : null;
}

// Every value a file exports, through ES module syntax or CommonJS. `star` is
// true when it also has `export * from`, which exports names this file does
// not state.
//
// CommonJS forms read, at the top level of the file only:
//   module.exports = value
//   module.exports = { name, other: value }    one binding per property
//   module.exports.name = value
//   exports.name = value
// Not read: exports assigned inside a function or a condition, spread
// properties, Object.assign(module.exports, …), and Object.defineProperty.
export function readExports(sourceFile: ts.SourceFile): {
  bindings: ExportedBinding[];
  star: boolean;
} {
  const locals = new Map<string, BindingKind>();
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      locals.set(statement.name.text, "function");
    } else if (ts.isClassDeclaration(statement) && statement.name) {
      locals.set(statement.name.text, "class");
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) {
          locals.set(declaration.name.text, kindOfExpression(declaration.initializer));
        }
      }
    }
  }

  const bindings: ExportedBinding[] = [];
  let star = false;
  for (const statement of sourceFile.statements) {
    const line = lineOf(sourceFile, statement);
    const exported = hasModifier(statement, ts.SyntaxKind.ExportKeyword);
    if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) {
      if (!exported) continue;
      const local = statement.name?.text ?? null;
      const isDefault = hasModifier(statement, ts.SyntaxKind.DefaultKeyword);
      if (!isDefault && local === null) continue;
      bindings.push({
        name: isDefault ? "default" : (local ?? "default"),
        local,
        kind: ts.isFunctionDeclaration(statement) ? "function" : "class",
        line,
      });
    } else if (ts.isVariableStatement(statement)) {
      if (!exported) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue;
        bindings.push({
          name: declaration.name.text,
          local: declaration.name.text,
          kind: kindOfExpression(declaration.initializer),
          line: lineOf(sourceFile, declaration),
        });
      }
    } else if (ts.isExportAssignment(statement)) {
      // `export = x` is CommonJS and exports no name.
      if (statement.isExportEquals) continue;
      const { expression } = statement;
      const local = ts.isIdentifier(expression) ? expression.text : null;
      bindings.push({
        name: "default",
        local,
        kind: local === null ? kindOfExpression(expression) : (locals.get(local) ?? "unknown"),
        line,
      });
    } else if (ts.isExportDeclaration(statement)) {
      if (statement.isTypeOnly) continue;
      const clause = statement.exportClause;
      if (!clause) {
        star = true;
      } else if (ts.isNamedExports(clause)) {
        for (const element of clause.elements) {
          if (element.isTypeOnly) continue;
          const local = (element.propertyName ?? element.name).text;
          bindings.push({
            name: element.name.text,
            local: statement.moduleSpecifier ? null : local,
            // A name re-exported from another module is whatever that module
            // says it is, which this file cannot tell.
            kind: statement.moduleSpecifier ? "unknown" : (locals.get(local) ?? "unknown"),
            line,
          });
        }
      } else {
        bindings.push({ name: clause.name.text, local: null, kind: "unknown", line });
      }
    }
  }

  const kindOf = (expression: ts.Expression): BindingKind =>
    ts.isIdentifier(expression)
      ? (locals.get(expression.text) ?? "unknown")
      : kindOfExpression(expression);
  const localOf = (expression: ts.Expression) =>
    ts.isIdentifier(expression) ? expression.text : null;
  for (const statement of sourceFile.statements) {
    if (!ts.isExpressionStatement(statement)) continue;
    const assignment = statement.expression;
    if (
      !ts.isBinaryExpression(assignment) ||
      assignment.operatorToken.kind !== ts.SyntaxKind.EqualsToken
    ) {
      continue;
    }
    const target = commonJsTarget(assignment.left);
    if (target === null) continue;
    const value = assignment.right;
    const line = lineOf(sourceFile, statement);
    if (target !== "") {
      bindings.push({ name: target, local: localOf(value), kind: kindOf(value), line });
    } else if (ts.isObjectLiteralExpression(value)) {
      for (const property of value.properties) {
        if (ts.isShorthandPropertyAssignment(property)) {
          const name = property.name.text;
          bindings.push({
            name,
            local: name,
            kind: locals.get(name) ?? "unknown",
            line: lineOf(sourceFile, property),
          });
        } else if (
          ts.isPropertyAssignment(property) &&
          (ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name))
        ) {
          bindings.push({
            name: property.name.text,
            local: localOf(property.initializer),
            kind: kindOf(property.initializer),
            line: lineOf(sourceFile, property),
          });
        } else if (ts.isMethodDeclaration(property) && ts.isIdentifier(property.name)) {
          bindings.push({
            name: property.name.text,
            local: null,
            kind: "function",
            line: lineOf(sourceFile, property),
          });
        }
      }
    } else {
      bindings.push({ name: COMMONJS_MODULE, local: localOf(value), kind: kindOf(value), line });
    }
  }
  return { bindings, star };
}

export function containsJsx(sourceFile: ts.SourceFile): boolean {
  const isJsx = (node: ts.Node): boolean =>
    ts.isJsxElement(node) ||
    ts.isJsxSelfClosingElement(node) ||
    ts.isJsxFragment(node) ||
    (ts.forEachChild(node, isJsx) ?? false);
  return isJsx(sourceFile);
}

// The line of a directive such as "use server" among the statements a file
// opens with, or null when it is not there.
export function directiveLine(sourceFile: ts.SourceFile, directive: string): number | null {
  for (const statement of sourceFile.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) {
      return null;
    }
    if (statement.expression.text === directive) return lineOf(sourceFile, statement);
  }
  return null;
}

// Names this file imports by name from one module: local name → imported name.
export function namedImports(sourceFile: ts.SourceFile, modules: string[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      !modules.includes(statement.moduleSpecifier.text)
    ) {
      continue;
    }
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      names.set(element.name.text, (element.propertyName ?? element.name).text);
    }
  }
  return names;
}

export function topLevelClasses(sourceFile: ts.SourceFile): ts.ClassDeclaration[] {
  return sourceFile.statements.filter(ts.isClassDeclaration);
}

export type DecoratorCall = { name: string; call: ts.CallExpression; decorator: ts.Decorator };

// The decorators on a node that are calls to one of `names`, reported under
// the name they were imported as. `@Get` without parentheses, and a decorator
// reached through a namespace, are not matched.
export function decoratorCalls(node: ts.Node, names: ReadonlyMap<string, string>): DecoratorCall[] {
  if (!ts.canHaveDecorators(node)) return [];
  return (ts.getDecorators(node) ?? []).flatMap((decorator) => {
    const call = decorator.expression;
    if (!ts.isCallExpression(call) || !ts.isIdentifier(call.expression)) return [];
    const name = names.get(call.expression.text);
    return name === undefined ? [] : [{ name, call, decorator }];
  });
}
