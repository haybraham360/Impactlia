import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

// Type-checking changed files of a repository on disk with the TypeScript
// compiler, under the repository's own tsconfig. This is the tool invocation
// and nothing more: which diagnostics count, and what they mean, is decided
// in code-issues.ts.
//
// Nothing in the repository is run. The compiler reads files as text, and
// this host lets it read only files inside the repository and TypeScript's
// own library declarations. The repository's packages are not installed, so
// an import of one resolves to nothing; code-issues.ts accounts for that.
//
// Synchronous, like the parser. TYPE_CHECK_FILE_LIMIT and the time budget
// keep it bounded; the budget is checked between files, since one file's
// check cannot be interrupted.

export const TYPE_CHECK_BUDGET_MS = 90_000;
// Per file. A file with more than this is reported with this many.
const DIAGNOSTIC_LIMIT = 200;
const MESSAGE_LENGTH = 1000;
const CONFIG_NAMES = ["tsconfig.json", "jsconfig.json"];
// TS18003, "No inputs were found in config file", says nothing about settings.
const NO_INPUTS_DIAGNOSTIC = 18003;
const TS_CHECK = /^\s*\/\/\s*@ts-check\b/m;
const JAVASCRIPT = /\.[cm]?jsx?$/;
const DECLARATION = /\.d\.[cm]?ts$/;

export type CompilerDiagnostic = {
  code: number;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  message: string;
};

export type TypeCheckOutcome =
  | {
      path: string;
      state: "checked";
      // The repository-relative config whose settings were used.
      config: string;
      diagnostics: CompilerDiagnostic[];
    }
  | { path: string; state: "skipped"; reason: string };

type LoadedConfig = {
  path: string;
  parsed: ts.ParsedCommandLine;
  fileNames: Set<string>;
  problem: string | null;
};

// `paths` are repository-relative files that exist under `directory`. The
// outcomes come back in the same order.
export function typeCheckFiles(
  directory: string,
  paths: readonly string[],
  budgetMs = TYPE_CHECK_BUDGET_MS,
): TypeCheckOutcome[] {
  const startedAt = Date.now();
  const root = fs.realpathSync.native(path.resolve(directory));
  const libraries = path.dirname(ts.getDefaultLibFilePath({}));
  const canonical = (fileName: string) =>
    ts.sys.useCaseSensitiveFileNames ? fileName : fileName.toLowerCase();
  const inside = (fileName: string, folder: string) => {
    const resolved = path.resolve(fileName);
    return resolved === folder || resolved.startsWith(`${folder}${path.sep}`);
  };
  const readable = (fileName: string) => inside(fileName, root) || inside(fileName, libraries);
  const relative = (fileName: string) => path.relative(root, fileName).split(path.sep).join("/");
  // Messages quote absolute paths; only the repository-relative part is kept.
  const clean = (message: string) => message.replaceAll(`${root}/`, "").slice(0, MESSAGE_LENGTH);

  // The filesystem as the compiler sees it: the repository and the libraries,
  // nothing else. A module looked for anywhere else is simply not there.
  const system: ts.System = {
    ...ts.sys,
    fileExists: (fileName) => readable(fileName) && ts.sys.fileExists(fileName),
    directoryExists: (name) => readable(name) && ts.sys.directoryExists(name),
    readFile: (fileName, encoding) =>
      readable(fileName) ? ts.sys.readFile(fileName, encoding) : undefined,
    getDirectories: (name) => (readable(name) ? ts.sys.getDirectories(name) : []),
    readDirectory: (name, extensions, exclude, include, depth) =>
      inside(name, root) ? ts.sys.readDirectory(name, extensions, exclude, include, depth) : [],
    realpath: (name) => (readable(name) && ts.sys.realpath ? ts.sys.realpath(name) : name),
  };

  const configs = new Map<string, LoadedConfig>();
  function loadConfig(absolute: string): LoadedConfig {
    const cached = configs.get(absolute);
    if (cached) return cached;
    const unrecoverable: ts.Diagnostic[] = [];
    const parsed = ts.getParsedCommandLineOfConfigFile(absolute, undefined, {
      ...system,
      onUnRecoverableConfigFileDiagnostic: (diagnostic) => unrecoverable.push(diagnostic),
    }) ?? {
      options: {},
      fileNames: [],
      errors: [],
    };
    const problems = [...unrecoverable, ...parsed.errors].filter(
      (diagnostic) => diagnostic.code !== NO_INPUTS_DIAGNOSTIC,
    );
    const config: LoadedConfig = {
      path: relative(absolute),
      parsed,
      fileNames: new Set(parsed.fileNames.map(canonical)),
      problem:
        problems.length > 0
          ? clean(ts.flattenDiagnosticMessageText(problems[0].messageText, " "))
          : null,
    };
    configs.set(absolute, config);
    return config;
  }

  // The nearest tsconfig.json or jsconfig.json at or above the file's folder,
  // never above the repository: a config outside it is not part of it.
  function nearestConfig(file: string): string | null {
    let folder = path.posix.dirname(file);
    for (;;) {
      for (const name of CONFIG_NAMES) {
        const candidate = path.join(root, folder === "." ? "" : folder, name);
        if (fs.existsSync(candidate)) return candidate;
      }
      if (folder === "." || folder === "") return null;
      folder = path.posix.dirname(folder);
    }
  }

  // The config that actually includes the file. A "solution" config lists
  // no files itself and points at the configs that do.
  function configFor(file: string): LoadedConfig | { skipped: string } {
    const nearest = nearestConfig(file);
    if (nearest === null) {
      return {
        skipped:
          "No tsconfig.json or jsconfig.json applies to it, so there are no compiler settings to check it against.",
      };
    }
    const absolute = canonical(path.join(root, file));
    let config = loadConfig(nearest);
    if (!config.fileNames.has(absolute)) {
      for (const reference of config.parsed.projectReferences ?? []) {
        const referencePath = ts.resolveProjectReferencePath(reference);
        if (!inside(referencePath, root) || !fs.existsSync(referencePath)) continue;
        const referenced = loadConfig(referencePath);
        if (referenced.fileNames.has(absolute)) {
          config = referenced;
          break;
        }
      }
    }
    if (config.problem !== null) {
      return {
        skipped: `Its compiler settings in ${config.path} could not be fully read (${config.problem}), so it was not checked against settings that may be wrong.`,
      };
    }
    if (!config.fileNames.has(absolute)) {
      return {
        skipped: `${config.path} does not include it, so the project does not type-check it.`,
      };
    }
    return config;
  }

  const outcomes = new Map<string, TypeCheckOutcome>();
  const groups = new Map<LoadedConfig, string[]>();
  for (const file of paths) {
    const config = configFor(file);
    if ("skipped" in config) {
      outcomes.set(file, { path: file, state: "skipped", reason: config.skipped });
      continue;
    }
    const options = config.parsed.options;
    if (JAVASCRIPT.test(file) && options.checkJs !== true) {
      const text = system.readFile(path.join(root, file)) ?? "";
      if (!TS_CHECK.test(text.slice(0, 4096))) {
        outcomes.set(file, {
          path: file,
          state: "skipped",
          reason: `It is JavaScript, and neither ${config.path} (checkJs) nor a // @ts-check comment asks for it to be type-checked.`,
        });
        continue;
      }
    }
    if (DECLARATION.test(file) && options.skipLibCheck === true) {
      outcomes.set(file, {
        path: file,
        state: "skipped",
        reason: `It is a declaration file, and ${config.path} turns off checking those (skipLibCheck).`,
      });
      continue;
    }
    const group = groups.get(config);
    if (group) group.push(file);
    else groups.set(config, [file]);
  }

  for (const [config, files] of groups) {
    // The repository's own settings, with nothing written and no build
    // information read or kept. Project references are left out so that an
    // import of another project resolves to its source rather than to build
    // output that does not exist here.
    const options: ts.CompilerOptions = {
      ...config.parsed.options,
      noEmit: true,
      declaration: false,
      declarationMap: false,
      emitDeclarationOnly: false,
      composite: false,
      incremental: false,
      tsBuildInfoFile: undefined,
    };
    const host = ts.createCompilerHost(options);
    host.fileExists = system.fileExists;
    host.directoryExists = system.directoryExists;
    host.readFile = system.readFile;
    host.getDirectories = system.getDirectories;
    host.realpath = system.realpath;
    host.getCurrentDirectory = () => root;
    host.getSourceFile = (fileName, languageVersionOrOptions) => {
      const text = system.readFile(fileName);
      return text === undefined
        ? undefined
        : ts.createSourceFile(fileName, text, languageVersionOrOptions);
    };
    // The changed files, and the project's declaration files: those declare
    // globals the changed files may use without importing them.
    const declarations = config.parsed.fileNames.filter((name) => DECLARATION.test(name));
    const program = ts.createProgram({
      rootNames: [...new Set([...files.map((file) => path.join(root, file)), ...declarations])],
      options,
      host,
    });

    for (const file of files) {
      if (Date.now() - startedAt > budgetMs) {
        outcomes.set(file, {
          path: file,
          state: "skipped",
          reason: `The ${budgetMs / 1000} seconds allowed for type-checking ran out before this file.`,
        });
        continue;
      }
      const sourceFile = program.getSourceFile(path.join(root, file));
      if (!sourceFile) {
        outcomes.set(file, {
          path: file,
          state: "skipped",
          reason: "The compiler did not load it.",
        });
        continue;
      }
      const diagnostics: CompilerDiagnostic[] = [];
      for (const diagnostic of program.getSemanticDiagnostics(sourceFile)) {
        if (diagnostic.category !== ts.DiagnosticCategory.Error) continue;
        if (diagnostic.start === undefined) continue;
        const start = sourceFile.getLineAndCharacterOfPosition(diagnostic.start);
        const end = sourceFile.getLineAndCharacterOfPosition(
          diagnostic.start + (diagnostic.length ?? 0),
        );
        diagnostics.push({
          code: diagnostic.code,
          line: start.line + 1,
          column: start.character + 1,
          endLine: end.line + 1,
          endColumn: end.character + 1,
          message: clean(ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")),
        });
        if (diagnostics.length === DIAGNOSTIC_LIMIT) break;
      }
      outcomes.set(file, { path: file, state: "checked", config: config.path, diagnostics });
    }
  }

  return paths.map((file) => {
    const outcome = outcomes.get(file);
    if (!outcome) throw new Error(`${file} was neither type-checked nor skipped.`);
    return outcome;
  });
}
