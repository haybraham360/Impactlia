// Every reason a path can be kept out of the graph is a named rule in this
// file or in an adapter. Exclusion is by what a path is, never by size or
// count, and every excluded path is reported with the rule that excluded it.

export type ExclusionRule = {
  id: string;
  description: string;
  appliesTo: "file" | "directory";
  matches: (name: string) => boolean;
};

const DEPENDENCY_DIRECTORIES = new Set(["node_modules", "bower_components", "jspm_packages"]);
const BUILD_OUTPUT_DIRECTORIES = new Set(["dist", "build", "out", "coverage"]);

export const coreExclusionRules: ExclusionRule[] = [
  {
    id: "dependency-directory",
    description: "Installed third-party dependencies (node_modules and equivalents).",
    appliesTo: "directory",
    matches: (name) => DEPENDENCY_DIRECTORIES.has(name),
  },
  {
    // Covers .git and every tool's cache or build directory without the
    // parser having to know which tools exist.
    id: "hidden-directory",
    description: "Directories whose name starts with a dot: version control, tool state and caches.",
    appliesTo: "directory",
    matches: (name) => name.startsWith("."),
  },
  {
    id: "build-output-directory",
    description: "Conventional build and report output directories (dist, build, out, coverage).",
    appliesTo: "directory",
    matches: (name) => BUILD_OUTPUT_DIRECTORIES.has(name),
  },
  {
    id: "minified-file",
    description: "Minified JavaScript (*.min.js, *.min.mjs, *.min.cjs), which is generated output.",
    appliesTo: "file",
    matches: (name) => /\.min\.[cm]?js$/.test(name),
  },
];

// These two are applied by the walker itself, because they depend on what the
// entry is rather than on its name.
export const symbolicLinkRule = {
  id: "symbolic-link",
  description: "Symbolic links are not followed; the file they point at is reached by its real path.",
};

export const unsupportedFileTypeRule = {
  id: "unsupported-file-type",
  description: "Not a TypeScript or JavaScript source file.",
};
