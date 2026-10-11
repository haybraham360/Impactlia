import ts from "typescript";
import {
  dependencyEvidence,
  emptyAnalysis,
  type AdapterAnalysis,
  type AdapterFile,
  type FrameworkAdapter,
} from "../adapter";
import type { FileRole } from "../contract";
import { supportingRole } from "../generic-roles";
import { decoratorCalls, lineOf, namedImports, topLevelClasses } from "./syntax";

// NestJS.
//
// Detected by: a package.json that lists "@nestjs/core".
//
// Roles, first match wins:
//   test, declaration, config   by name, as in every repository
//   controller, module          a top-level class decorated with @Controller()
//                               or @Module(), imported by name from
//                               @nestjs/common
//   entity                      a top-level class decorated with @Entity(),
//                               imported by name from typeorm or
//                               @mikro-orm/core
//   controller, service,        otherwise by the Nest CLI's file names:
//   module, entity              *.controller, *.service, *.module, *.entity
//
// Routes come only from classes with @Controller(). A handler is a method with
// @Get, @Post, @Put, @Delete, @Patch, @Options, @Head or @All (method ANY),
// and its pattern is the controller's prefix joined to the method's path. Both
// must be written as string literals, arrays of them, or left out; the
// controller may also use the object form with a literal `path`.
//
// Joining: each part loses its leading and trailing slashes, empty parts are
// dropped, the rest are joined with "/" behind a leading "/". Nothing inside a
// part is touched, so ":id", ":id?" and "*" stay exactly as written.
//
// Omitted rather than guessed: a prefix or path that is a constant, a template
// with substitutions or any other expression; a controller or handler with a
// version (@Version, or `version` in @Controller's options), since the address
// then depends on how versioning is switched on; a handler whose name is
// computed.
//
// Not applied: setGlobalPrefix, RouterModule and enableVersioning. Patterns
// are what the decorators declare, and a note says so when one of those calls
// is found.

const NEST = ["@nestjs/common"];
const ORMS = ["typeorm", "@mikro-orm/core"];

const HTTP_DECORATORS: Record<string, string> = {
  Get: "GET",
  Post: "POST",
  Put: "PUT",
  Delete: "DELETE",
  Patch: "PATCH",
  Options: "OPTIONS",
  Head: "HEAD",
  All: "ANY",
};

const FILE_NAMES: { suffix: RegExp; id: FileRole["id"]; label: string }[] = [
  { suffix: /\.controller\.[jt]s$/, id: "controller", label: "*.controller" },
  { suffix: /\.service\.[jt]s$/, id: "service", label: "*.service" },
  { suffix: /\.module\.[jt]s$/, id: "module", label: "*.module" },
  { suffix: /\.entity\.[jt]s$/, id: "entity", label: "*.entity" },
];

// Calls whose effect on addresses is not modelled.
const UNAPPLIED: Record<string, string> = {
  setGlobalPrefix: "sets a global prefix",
  enableVersioning: "enables versioning",
};

type Paths = { paths: string[] } | { problem: string };

// The paths a decorator argument states, when it states them outright.
function literalPaths(argument: ts.Expression | undefined, what: string): Paths {
  if (argument === undefined) return { paths: [""] };
  if (ts.isStringLiteralLike(argument)) return { paths: [argument.text] };
  if (ts.isArrayLiteralExpression(argument) && argument.elements.length > 0) {
    const paths = argument.elements.flatMap((element) =>
      ts.isStringLiteralLike(element) ? [element.text] : [],
    );
    if (paths.length === argument.elements.length) return { paths };
  }
  return { problem: `${what} is not written as a string, so it cannot be read without running the code.` };
}

function controllerPrefixes(call: ts.CallExpression): Paths {
  const argument = call.arguments.at(0);
  if (!argument || !ts.isObjectLiteralExpression(argument)) {
    return literalPaths(argument, "The @Controller() prefix");
  }
  let path: ts.Expression | undefined;
  for (const property of argument.properties) {
    if (
      !ts.isPropertyAssignment(property) ||
      !(ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name))
    ) {
      return { problem: "The @Controller() options are not all written out, so the prefix cannot be read." };
    }
    const name = property.name.text;
    if (name === "version") {
      return { problem: "The controller sets a version, so its address depends on how versioning is enabled." };
    }
    if (name === "path") path = property.initializer;
  }
  return literalPaths(path, "The @Controller() prefix");
}

const trimSlashes = (part: string) => part.replace(/^\/+|\/+$/g, "");
const joinPattern = (prefix: string, path: string) =>
  `/${[prefix, path].map(trimSlashes).filter((part) => part !== "").join("/")}`;

function readController(
  file: AdapterFile,
  sourceFile: ts.SourceFile,
  declaration: ts.ClassDeclaration,
  controller: ts.CallExpression,
  imports: ReadonlyMap<string, string>,
  analysis: AdapterAnalysis,
): void {
  const className = declaration.name?.text ?? "(anonymous class)";
  const prefixes = controllerPrefixes(controller);
  const classVersioned = decoratorCalls(declaration, imports).some(
    (entry) => entry.name === "Version",
  );

  for (const member of declaration.members) {
    if (!ts.isMethodDeclaration(member)) continue;
    const decorators = decoratorCalls(member, imports);
    const routes = decorators.filter((entry) => entry.name in HTTP_DECORATORS);
    if (routes.length === 0) continue;

    const handler =
      ts.isIdentifier(member.name) || ts.isStringLiteralLike(member.name)
        ? `${className}.${member.name.text}`
        : null;
    for (const route of routes) {
      const line = lineOf(sourceFile, route.decorator);
      const omit = (reason: string) =>
        analysis.omittedRoutes.push({ file: file.path, line, handler, reason });
      const paths = literalPaths(route.call.arguments.at(0), `The @${route.name}() path`);

      if (handler === null) omit("The handler's name is computed, so it cannot be named.");
      else if ("problem" in prefixes) omit(prefixes.problem);
      else if (classVersioned || decorators.some((entry) => entry.name === "Version")) {
        omit("The handler has a version, so its address depends on how versioning is enabled.");
      } else if ("problem" in paths) omit(paths.problem);
      else {
        for (const prefix of prefixes.paths) {
          for (const path of paths.paths) {
            analysis.routes.push({
              framework: "nestjs",
              kind: "http",
              method: HTTP_DECORATORS[route.name],
              pattern: joinPattern(prefix, path),
              file: file.path,
              handler,
              line,
              evidence: `@${controller.getText(sourceFile)} on ${className} (line ${lineOf(sourceFile, controller)}) joined with @${route.call.getText(sourceFile)}.`,
            });
          }
        }
      }
    }
  }
}

// A call such as app.setGlobalPrefix("api") changes every address without any
// decorator saying so. It is reported, never applied.
function noteUnappliedCalls(file: AdapterFile, sourceFile: ts.SourceFile, analysis: AdapterAnalysis): void {
  const mentions =
    Object.keys(UNAPPLIED).some((name) => sourceFile.text.includes(name)) ||
    sourceFile.text.includes("RouterModule");
  if (!mentions) return;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const { name, expression } = node.expression;
      const effect = Object.hasOwn(UNAPPLIED, name.text)
        ? UNAPPLIED[name.text]
        : name.text === "register" && ts.isIdentifier(expression) && expression.text === "RouterModule"
          ? "registers module paths with RouterModule"
          : null;
      if (effect !== null) {
        analysis.notes.push({
          file: file.path,
          line: lineOf(sourceFile, node),
          detail: `${file.path} ${effect}. Patterns are shown as the decorators declare them, without it.`,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

function analyseFile(file: AdapterFile, analysis: AdapterAnalysis): FileRole | null {
  const supporting = supportingRole(file);
  if (supporting) return supporting;

  const sourceFile = file.syntax;
  if (sourceFile) {
    noteUnappliedCalls(file, sourceFile, analysis);
    const nest = namedImports(sourceFile, NEST);
    const orm = namedImports(sourceFile, ORMS);
    let role: FileRole | null = null;
    for (const declaration of topLevelClasses(sourceFile)) {
      const className = declaration.name?.text ?? "a class";
      const found = (name: string, names: ReadonlyMap<string, string>) =>
        decoratorCalls(declaration, names).find((entry) => entry.name === name);
      const controller = found("Controller", nest);
      const decorated: [FileRole["id"], ts.Decorator | undefined][] = [
        ["controller", controller?.decorator],
        ["module", found("Module", nest)?.decorator],
        ["entity", found("Entity", orm)?.decorator],
      ];
      // Routes are read from every controller in the file, whichever class
      // decided the file's role.
      if (controller) {
        readController(file, sourceFile, declaration, controller.call, nest, analysis);
      }
      for (const [id, decorator] of decorated) {
        if (!decorator || role) continue;
        role = {
          id,
          reason: `${decorator.expression.getText(sourceFile)} on ${className}.`,
          line: lineOf(sourceFile, decorator),
        };
      }
    }
    if (role) return role;
  }

  const byName = FILE_NAMES.find((entry) => entry.suffix.test(file.path));
  return byName
    ? {
        id: byName.id,
        reason: `Named ${byName.label}, the Nest CLI's file name for it. No decorator in the file decided this.`,
        line: null,
      }
    : null;
}

export const nestjsAdapter: FrameworkAdapter = {
  name: "nestjs",
  detect: (manifests) => dependencyEvidence(manifests, "@nestjs/core"),
  analyse(files) {
    const analysis = emptyAnalysis();
    for (const file of files) {
      const role = analyseFile(file, analysis);
      if (role) analysis.roles.set(file.path, role);
    }
    return analysis;
  },
};
