import fs from "node:fs";
import { builtinModules } from "node:module";
import path from "node:path";
import ts from "typescript";
import type {
  ExternalKind,
  ResolutionConfig,
  ResolutionMethod,
  UnresolvedReason,
} from "./contract";
import type { ReferenceSite } from "./references";
import type { WalkResult } from "./walk";
import { byText } from "./walk";

export type Resolution =
  | { status: "internal"; target: string; via: ResolutionMethod }
  | { status: "external"; externalKind: ExternalKind; packageName: string | null }
  | { status: "excluded"; target: string; rule: string }
  | { status: "unresolved"; reason: UnresolvedReason; detail: string };

export type Resolver = {
  resolve: (source: string, site: ReferenceSite) => Resolution;
  // The configs that were actually consulted, with their problems.
  configs: () => ResolutionConfig[];
};

type LoadedConfig = {
  // null for the built-in defaults used when a file has no config above it.
  path: string | null;
  directory: string;
  options: ts.CompilerOptions;
  files: Set<string>;
  references: string[];
  problems: string[];
  cache: ts.ModuleResolutionCache;
};

const CONFIG_NAMES = ["tsconfig.json", "jsconfig.json"];
const BUILTINS = new Set(builtinModules);
// TS18003, "No inputs were found in config file", says nothing about resolution.
const NO_INPUTS_DIAGNOSTIC = 18003;
// The shape npm allows for a package name, optionally scoped.
const PACKAGE_NAME = /^(@[a-z0-9][\w.-]*\/)?[a-zA-Z0-9][\w.-]*$/;

function packageNameOf(specifier: string): string {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

// The `paths` pattern TypeScript would pick for a specifier: an exact match,
// otherwise the wildcard pattern with the longest prefix.
function matchPathAlias(
  specifier: string,
  paths: ts.MapLike<string[]> | undefined,
): { pattern: string; star: string } | null {
  let best: { pattern: string; star: string; prefixLength: number } | null = null;
  for (const pattern of Object.keys(paths ?? {})) {
    const starIndex = pattern.indexOf("*");
    if (starIndex === -1) {
      if (pattern === specifier) return { pattern, star: "" };
      continue;
    }
    const prefix = pattern.slice(0, starIndex);
    const suffix = pattern.slice(starIndex + 1);
    if (
      specifier.length >= prefix.length + suffix.length &&
      specifier.startsWith(prefix) &&
      specifier.endsWith(suffix) &&
      (best === null || prefix.length > best.prefixLength)
    ) {
      const star = specifier.slice(prefix.length, specifier.length - suffix.length);
      best = { pattern, star, prefixLength: prefix.length };
    }
  }
  return best && { pattern: best.pattern, star: best.star };
}

export function createResolver(root: string, walk: WalkResult): Resolver {
  const included = new Set(walk.sourceFiles);
  const toRelative = (absolute: string) => path.relative(root, absolute).split(path.sep).join("/");
  const canonical = (fileName: string) =>
    ts.sys.useCaseSensitiveFileNames ? fileName : fileName.toLowerCase();

  // Packages defined inside the repository, by name. Used to tell a workspace
  // package that is not linked apart from a third-party one.
  const workspacePackages = new Map<string, string>();
  for (const file of [...walk.skippedFiles.keys()].sort(byText)) {
    if (path.posix.basename(file) !== "package.json") continue;
    const name = readPackageName(path.join(root, file));
    if (name !== null && !workspacePackages.has(name)) workspacePackages.set(name, file);
  }

  const unrecoverable: ts.Diagnostic[] = [];
  const configHost: ts.ParseConfigFileHost = {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (diagnostic) => unrecoverable.push(diagnostic),
  };

  function withDefaults(options: ts.CompilerOptions): ts.CompilerOptions {
    // Resolution here is about which file a specifier names, not about what
    // the project's compiler would accept, so JavaScript and JSON targets are
    // always allowed.
    const effective: ts.CompilerOptions = { ...options, allowJs: true, resolveJsonModule: true };
    const nodeModule =
      effective.module !== undefined &&
      effective.module >= ts.ModuleKind.Node16 &&
      effective.module <= ts.ModuleKind.NodeNext;
    // Left unset, TypeScript falls back to resolution modes that predate
    // package.json `exports` and cannot resolve a modern repository.
    if (effective.moduleResolution === undefined && !nodeModule) {
      effective.moduleResolution = ts.ModuleResolutionKind.Bundler;
    }
    return effective;
  }

  function makeConfig(
    configPath: string | null,
    directory: string,
    options: ts.CompilerOptions,
    files: string[],
    references: string[],
    problems: string[],
  ): LoadedConfig {
    const effective = withDefaults(options);
    return {
      path: configPath,
      directory,
      options: effective,
      files: new Set(files.map(canonical)),
      references,
      problems,
      cache: ts.createModuleResolutionCache(root, canonical, effective),
    };
  }

  const defaultConfig = makeConfig(null, root, {}, [], [], []);
  const loadedConfigs = new Map<string, LoadedConfig>();
  const usedConfigs = new Set<LoadedConfig>();

  function loadConfig(absolutePath: string): LoadedConfig {
    const cached = loadedConfigs.get(absolutePath);
    if (cached) return cached;
    unrecoverable.length = 0;
    const parsed = ts.getParsedCommandLineOfConfigFile(absolutePath, undefined, configHost);
    const problems = [...unrecoverable, ...(parsed?.errors ?? [])]
      .filter((diagnostic) => diagnostic.code !== NO_INPUTS_DIAGNOSTIC)
      // Messages quote absolute paths; strip the root so output is the same
      // wherever the repository is checked out.
      .map((diagnostic) =>
        ts.flattenDiagnosticMessageText(diagnostic.messageText, " ").replaceAll(`${root}/`, ""),
      );
    const config = makeConfig(
      toRelative(absolutePath),
      path.dirname(absolutePath),
      parsed?.options ?? {},
      parsed?.fileNames ?? [],
      (parsed?.projectReferences ?? []).map((reference) =>
        ts.resolveProjectReferencePath(reference),
      ),
      problems,
    );
    loadedConfigs.set(absolutePath, config);
    return config;
  }

  // The nearest tsconfig/jsconfig at or above a folder, never above the
  // repository root: a config outside the repository is not part of it.
  const nearestConfigByFolder = new Map<string, string | null>();
  function nearestConfigPath(folder: string): string | null {
    const cached = nearestConfigByFolder.get(folder);
    if (cached !== undefined) return cached;
    let found: string | null = null;
    for (const name of CONFIG_NAMES) {
      const candidate = folder ? `${folder}/${name}` : name;
      if (walk.skippedFiles.has(candidate)) {
        found = candidate;
        break;
      }
    }
    if (found === null && folder !== "") {
      found = nearestConfigPath(folder.includes("/") ? path.posix.dirname(folder) : "");
    }
    nearestConfigByFolder.set(folder, found);
    return found;
  }

  const configBySource = new Map<string, LoadedConfig>();
  function configFor(source: string): LoadedConfig {
    const cached = configBySource.get(source);
    if (cached) return cached;
    const folder = source.includes("/") ? path.posix.dirname(source) : "";
    const nearest = nearestConfigPath(folder);
    let config = nearest === null ? defaultConfig : loadConfig(path.join(root, nearest));
    // A "solution" config lists no files itself and points at the configs
    // that do; the one that includes this file holds its real settings.
    const absoluteSource = canonical(path.join(root, source));
    if (config.references.length > 0 && !config.files.has(absoluteSource)) {
      for (const reference of config.references) {
        if (!reference.startsWith(`${root}/`) || !fs.existsSync(reference)) continue;
        const referenced = loadConfig(reference);
        if (referenced.files.has(absoluteSource)) {
          config = referenced;
          break;
        }
      }
    }
    usedConfigs.add(config);
    configBySource.set(source, config);
    return config;
  }

  function ruleExcluding(relative: string): string | null {
    const fileRule = walk.skippedFiles.get(relative);
    if (fileRule) return fileRule;
    let folder = relative;
    while (folder.includes("/")) {
      folder = path.posix.dirname(folder);
      const rule = walk.skippedDirectories.get(folder);
      if (rule) return rule;
    }
    return null;
  }

  // Classifies a file that is known to exist by where it really lives.
  function classify(
    absolute: string,
    via: ResolutionMethod,
    packageName: string | null,
  ): Resolution {
    // The real path follows symlinks (a linked workspace package lands on its
    // source) and, on case-insensitive filesystems, gives the on-disk casing.
    const relative = toRelative(fs.realpathSync.native(absolute));
    if (relative.startsWith("../") || path.isAbsolute(relative)) {
      return { status: "external", externalKind: "outside-repository", packageName: null };
    }
    if (included.has(relative)) return { status: "internal", target: relative, via };
    if (relative.split("/").includes("node_modules")) {
      return { status: "external", externalKind: "package", packageName };
    }
    const rule = ruleExcluding(relative);
    if (rule) return { status: "excluded", target: relative, rule };
    return {
      status: "unresolved",
      reason: "file-not-found",
      detail: `Resolved to ${relative}, which was not there when the repository was walked.`,
    };
  }

  const isFile = (absolute: string) => fs.statSync(absolute, { throwIfNoEntry: false })?.isFile();

  function resolve(source: string, site: ReferenceSite): Resolution {
    const specifier = site.specifier;
    if (specifier === null) {
      return {
        status: "unresolved",
        reason: "non-literal-specifier",
        detail: `The module is named by an expression (${site.expression}), so its target is only known at runtime.`,
      };
    }

    const absoluteSource = path.join(root, source);
    const sourceFolder = path.dirname(absoluteSource);

    if (site.kind === "reference-path") {
      const target = path.resolve(sourceFolder, specifier);
      if (isFile(target)) return classify(target, "relative", null);
      return {
        status: "unresolved",
        reason: "file-not-found",
        detail: `No file at ${toRelative(target)}.`,
      };
    }

    const config = configFor(source);
    const { options } = config;

    if (site.kind === "reference-types") {
      const resolved = ts.resolveTypeReferenceDirective(specifier, absoluteSource, options, ts.sys)
        .resolvedTypeReferenceDirective?.resolvedFileName;
      if (resolved) return classify(resolved, "relative", specifier);
      return { status: "external", externalKind: "package", packageName: specifier };
    }

    const relative = /^\.\.?(\/|$)/.test(specifier);
    const absolute = path.isAbsolute(specifier);
    const alias = relative || absolute ? null : matchPathAlias(specifier, options.paths);
    const bare = !relative && !absolute && alias === null;

    if (bare && (specifier.startsWith("node:") || BUILTINS.has(specifier))) {
      return { status: "external", externalKind: "builtin", packageName: specifier };
    }

    const resolved = ts.resolveModuleName(
      specifier,
      absoluteSource,
      options,
      ts.sys,
      config.cache,
    ).resolvedModule;
    if (resolved) {
      const via: ResolutionMethod = relative
        ? "relative"
        : absolute
          ? "absolute"
          : alias
            ? "path-alias"
            : resolved.isExternalLibraryImport
              ? "workspace-package"
              : specifier.startsWith("#")
                ? "package-imports"
                : "base-url";
      return classify(
        resolved.resolvedFileName,
        via,
        resolved.packageId?.name ?? packageNameOf(specifier),
      );
    }

    // TypeScript only resolves modules it can type. A specifier that names an
    // existing file exactly (a stylesheet, an image) is still a real
    // reference, so look for that file where the specifier says it is.
    const pathsBase = options["pathsBasePath"];
    const aliasBase =
      typeof pathsBase === "string" ? pathsBase : (options.baseUrl ?? config.directory);
    const candidates = relative
      ? [path.resolve(sourceFolder, specifier)]
      : absolute
        ? [specifier]
        : alias
          ? (options.paths?.[alias.pattern] ?? []).map((substitution) =>
              path.resolve(aliasBase, substitution.replace("*", alias.star)),
            )
          : options.baseUrl
            ? [path.resolve(options.baseUrl, specifier)]
            : [];
    const exact = candidates.find(isFile);
    if (exact) {
      return classify(
        exact,
        relative ? "relative" : absolute ? "absolute" : alias ? "path-alias" : "base-url",
        null,
      );
    }

    if (relative || absolute) {
      return {
        status: "unresolved",
        reason: "file-not-found",
        detail: `No file or directory module at ${toRelative(candidates[0])}.`,
      };
    }
    if (alias) {
      const tried = candidates.map(toRelative).join(", ") || "nothing, the entry is empty";
      return {
        status: "unresolved",
        reason: "alias-target-not-found",
        detail: `Matches "${alias.pattern}" in ${config.path}, but no module was found at ${tried}.`,
      };
    }

    const packageName = packageNameOf(specifier);
    const workspaceManifest = workspacePackages.get(packageName);
    if (workspaceManifest) {
      return {
        status: "unresolved",
        reason: "workspace-package-not-linked",
        detail: `"${packageName}" is defined in this repository at ${workspaceManifest}, but it is not linked into node_modules, so its entry file cannot be determined. Install the repository's dependencies and parse again.`,
      };
    }
    if (PACKAGE_NAME.test(packageName)) {
      // Named like a package and not defined in this repository. Whether it
      // is installed does not matter: either way it is outside the graph.
      return { status: "external", externalKind: "package", packageName };
    }
    return {
      status: "unresolved",
      reason: "alias-not-configured",
      detail: `"${specifier}" is not a valid package name, and no \`paths\` entry in ${config.path ?? "a tsconfig.json or jsconfig.json (none was found)"} matches it.`,
    };
  }

  return {
    resolve,
    configs: () =>
      [...usedConfigs]
        .flatMap((config) =>
          config.path === null ? [] : [{ path: config.path, problems: config.problems }],
        )
        .sort((a, b) => byText(a.path, b.path)),
  };
}

export function readPackageName(manifestPath: string): string | null {
  try {
    const manifest: unknown = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    if (typeof manifest === "object" && manifest !== null && "name" in manifest) {
      return typeof manifest.name === "string" ? manifest.name : null;
    }
  } catch {
    // An unreadable or malformed package.json simply names no package.
  }
  return null;
}
