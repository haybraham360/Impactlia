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
import { reactRole } from "./react";
import { directiveLine, lineOf, readExports } from "./syntax";

// Next.js.
//
// Detected by: a package.json that lists "next". Each such package is read on
// its own, with paths taken relative to its folder.
//
// Supported conventions:
//   App Router      app/ or src/app/ (the first that has files).
//                   page.{tsx,ts,jsx,js} with a default export is a page.
//                   route.{tsx,ts,jsx,js} is one endpoint per HTTP method it
//                   exports by name (GET, HEAD, POST, PUT, DELETE, PATCH,
//                   OPTIONS). Route groups "(name)" are left out of the
//                   pattern; dynamic segments are kept exactly as written.
//                   Folders starting with "_" are private and hold no routes.
//   Pages Router    pages/ or src/pages/ (the first that has files).
//                   Every file with a default export is a page, "index"
//                   standing for its folder. Under pages/api it is an endpoint
//                   instead, with method ANY: the handler receives them all.
//                   _app, _document and _error are not routes.
//   Server actions  a file that opens with the "use server" directive.
//   Root files      middleware, proxy, instrumentation, instrumentation-client
//                   at the package root or in src/.
//
// Not supported, and reported as omitted rather than guessed:
//   - parallel route slots (@name) and intercepting routes ((.)name)
//   - any route in a package whose next.config sets pageExtensions, because
//     that changes which files are routes
//   - a page with no default export, a route file with no method export, and
//     files with syntax errors
// Not read at all: .mdx pages, metadata files (sitemap, robots, icons),
// "use server" inside a function body, and routes added by rewrites or
// redirects. basePath and i18n are not applied to patterns; a note says so
// when the config sets them.

const SOURCE_FILE = /^(.+)\.(tsx|ts|jsx|js)$/;
const HTTP_METHODS = ["GET", "HEAD", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"];
const SEGMENT_FILES = new Set([
  "layout",
  "template",
  "loading",
  "error",
  "global-error",
  "not-found",
  "forbidden",
  "unauthorized",
  "default",
]);
const PAGES_SPECIAL_FILES = new Set(["_app", "_document", "_error"]);
const ROOT_FILE = /^(src\/)?(middleware|proxy|instrumentation|instrumentation-client)\.[jt]s$/;
const CONFIG_FILE = /^next\.config\.(js|mjs|cjs|ts|mts)$/;

type Entry = { file: AdapterFile; relative: string };

// Settings in next.config that change routing. Only whether each is set is
// read; a value is never evaluated.
function readConfig(entries: Entry[], analysis: AdapterAnalysis): { blocked: string | null } {
  const config = entries.find((entry) => CONFIG_FILE.test(entry.relative));
  if (!config) return { blocked: null };
  const { path } = config.file;
  const sourceFile = config.file.syntax;
  if (!sourceFile) {
    return {
      blocked: `${path} has syntax errors, so whether it changes which files are routes is unknown.`,
    };
  }

  const set = new Map<string, number>();
  const visit = (node: ts.Node): void => {
    if (
      (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) &&
      (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) &&
      !set.has(node.name.text)
    ) {
      set.set(node.name.text, lineOf(sourceFile, node));
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  const note = (setting: string, detail: string) => {
    const line = set.get(setting);
    if (line !== undefined) analysis.notes.push({ file: path, line, detail });
  };
  note(
    "basePath",
    `${path} sets basePath. Patterns are shown as the file conventions give them, without it.`,
  );
  note(
    "i18n",
    `${path} sets i18n. Locale prefixes are not added to the patterns shown.`,
  );
  note(
    "pageExtensions",
    `${path} sets pageExtensions, which changes which files are routes. No route is extracted from this package.`,
  );
  return {
    blocked: set.has("pageExtensions")
      ? `${path} sets pageExtensions, which changes which files are routes.`
      : null,
  };
}

function analysePackage(root: string, files: AdapterFile[], analysis: AdapterAnalysis): void {
  const entries: Entry[] = files.map((file) => ({
    file,
    relative: root === "" ? file.path : file.path.slice(root.length + 1),
  }));
  const firstWithFiles = (candidates: string[]) =>
    candidates.find((directory) =>
      entries.some((entry) => entry.relative.startsWith(`${directory}/`)),
    ) ?? null;
  const appDirectory = firstWithFiles(["app", "src/app"]);
  const pagesDirectory = firstWithFiles(["pages", "src/pages"]);
  const config = readConfig(entries, analysis);

  // Each returns the file's role, or null when no route came of it.
  function appRouterFile({ file, relative }: Entry, directory: string): FileRole | null {
    const folders = relative.slice(directory.length + 1).split("/");
    const name = SOURCE_FILE.exec(folders.pop() ?? "")?.[1];
    if (name === undefined || file.declaration) return null;
    // A private folder opts everything beneath it out of routing.
    if (folders.some((folder) => folder.startsWith("_"))) return null;
    if (SEGMENT_FILES.has(name)) {
      return {
        id: "layout",
        reason: `A ${name} file in the App Router directory ${directory}/.`,
        line: null,
      };
    }
    if (name !== "page" && name !== "route") return null;

    const omit = (reason: string): null => {
      analysis.omittedRoutes.push({ file: file.path, line: null, handler: null, reason });
      return null;
    };
    if (config.blocked) return omit(config.blocked);
    const slot = folders.find((folder) => folder.startsWith("@"));
    if (slot) return omit(`Inside the parallel route slot ${slot}. Slots are not modelled.`);
    const intercepting = folders.find((folder) => /^\(\.{1,3}\)/.test(folder));
    if (intercepting) {
      return omit(`Inside the intercepting route ${intercepting}. Intercepting routes are not modelled.`);
    }
    if (!file.syntax) return omit("The file has syntax errors, so its exports could not be read.");

    const pattern = `/${folders.filter((folder) => !/^\(.*\)$/.test(folder)).join("/")}`;
    const { bindings, star } = readExports(file.syntax);

    if (name === "page") {
      const component = bindings.find((binding) => binding.name === "default");
      if (!component) return omit("A page file with no default export.");
      const evidence = `A page file in the App Router directory ${directory}/, with a default export.`;
      analysis.routes.push({
        framework: "nextjs",
        kind: "page",
        method: null,
        pattern,
        file: file.path,
        handler: component.local ?? "default",
        line: component.line,
        evidence,
      });
      return { id: "page-route", reason: evidence, line: component.line };
    }

    const methods = bindings.filter((binding) => HTTP_METHODS.includes(binding.name));
    if (methods.length === 0) {
      return omit(
        star
          ? "A route file that names no HTTP method itself. It has `export * from`, and the names that brings are not read."
          : "A route file that exports no HTTP method.",
      );
    }
    for (const method of methods) {
      analysis.routes.push({
        framework: "nextjs",
        kind: "http",
        method: method.name,
        pattern,
        file: file.path,
        handler: method.name,
        line: method.line,
        evidence: `A route file in the App Router directory ${directory}/ that exports ${method.name}.`,
      });
    }
    return {
      id: "api-endpoint",
      reason: `A route file in the App Router directory ${directory}/ that exports ${methods.map((method) => method.name).join(", ")}.`,
      line: methods[0].line,
    };
  }

  function pagesRouterFile({ file, relative }: Entry, directory: string): FileRole | null {
    const folders = relative.slice(directory.length + 1).split("/");
    const name = SOURCE_FILE.exec(folders.pop() ?? "")?.[1];
    if (name === undefined || file.declaration) return null;
    if (folders.length === 0 && PAGES_SPECIAL_FILES.has(name)) {
      return {
        id: "layout",
        reason: `${name} in the Pages Router directory ${directory}/.`,
        line: null,
      };
    }

    const omit = (reason: string): null => {
      analysis.omittedRoutes.push({ file: file.path, line: null, handler: null, reason });
      return null;
    };
    if (config.blocked) return omit(config.blocked);
    if (!file.syntax) return omit("The file has syntax errors, so its exports could not be read.");
    const handler = readExports(file.syntax).bindings.find((binding) => binding.name === "default");
    if (!handler) return omit(`A file in ${directory}/ with no default export.`);

    const pattern = `/${(name === "index" ? folders : [...folders, name]).join("/")}`;
    const api = pattern === "/api" || pattern.startsWith("/api/");
    const evidence = api
      ? `A file under ${directory}/api with a default export, which receives every HTTP method.`
      : `A file in the Pages Router directory ${directory}/, with a default export.`;
    analysis.routes.push({
      framework: "nextjs",
      kind: api ? "http" : "page",
      method: api ? "ANY" : null,
      pattern,
      file: file.path,
      handler: handler.local ?? "default",
      line: handler.line,
      evidence,
    });
    return { id: api ? "api-endpoint" : "page-route", reason: evidence, line: handler.line };
  }

  function serverActions(file: AdapterFile): FileRole | null {
    const line = file.syntax ? directiveLine(file.syntax, "use server") : null;
    return line === null
      ? null
      : { id: "server-action", reason: 'Opens with the "use server" directive.', line };
  }

  for (const entry of entries) {
    const { file, relative } = entry;
    let role: FileRole | null = null;
    if (appDirectory && relative.startsWith(`${appDirectory}/`)) {
      role = appRouterFile(entry, appDirectory);
    } else if (pagesDirectory && relative.startsWith(`${pagesDirectory}/`)) {
      role = pagesRouterFile(entry, pagesDirectory);
    } else if (ROOT_FILE.test(relative)) {
      role = {
        id: "middleware",
        reason: `Named ${relative.slice(relative.lastIndexOf("/") + 1)} at the package root or in src/.`,
        line: null,
      };
    }
    role ??= supportingRole(file) ?? serverActions(file) ?? reactRole(file);
    if (role) analysis.roles.set(file.path, role);
  }
}

export const nextjsAdapter: FrameworkAdapter = {
  name: "nextjs",
  detect: (manifests) => dependencyEvidence(manifests, "next"),
  analyse(files) {
    const analysis = emptyAnalysis();
    const byRoot = new Map<string, AdapterFile[]>();
    for (const file of files) {
      const list = byRoot.get(file.packageRoot);
      if (list) list.push(file);
      else byRoot.set(file.packageRoot, [file]);
    }
    for (const [root, packageFiles] of byRoot) analysePackage(root, packageFiles, analysis);
    return analysis;
  },
};
