// Which languages Impactlia reads, and how far. Plain data with no imports, so
// the browser can name a language and its capability without loading a
// parser.
//
// A language is only listed under SUPPORTED_LANGUAGES once an adapter parses
// it: its files become graph nodes and its imports are resolved with
// evidence. Everything else a file extension recognises is "detected": the
// report can say what a changed file is, and that nothing is known about its
// dependencies. Recognising an extension is never support.

export const CAPABILITY_LEVELS = {
  detected: {
    label: "Detected only",
    rule: "The language is recognised from the file extension. Its files are not parsed, so they have no dependencies in the graph.",
  },
  "dependency-aware": {
    label: "Dependency-aware",
    rule: "Files are parsed, and their imports are resolved to files in the repository, with the statement that proves each one. Related tests are found by import and by name; no test scenarios are suggested.",
  },
  "test-aware": {
    label: "Dependency- and test-aware",
    rule: "Dependency-aware, and related tests are found from their imports, with scenarios suggested from the changed syntax.",
  },
  advanced: {
    label: "Compiler-checked",
    rule: "Test-aware, and changed files are also checked by the language's own compiler for errors on added lines.",
  },
} as const;
export type CapabilityLevel = keyof typeof CAPABILITY_LEVELS;
// From least to most understood: each level includes those before it.
export const CAPABILITY_ORDER: readonly CapabilityLevel[] = ["detected", "dependency-aware", "test-aware", "advanced"];

export const SUPPORTED_LANGUAGES = {
  typescript: {
    label: "TypeScript",
    extensions: [".ts", ".tsx", ".mts", ".cts"],
    capability: "advanced",
    parser: "TypeScript compiler",
  },
  javascript: {
    label: "JavaScript",
    extensions: [".js", ".jsx", ".mjs", ".cjs"],
    capability: "advanced",
    parser: "TypeScript compiler",
  },
  python: {
    label: "Python",
    extensions: [".py", ".pyi"],
    capability: "test-aware",
    parser: "tree-sitter",
  },
  java: { label: "Java", extensions: [".java"], capability: "dependency-aware", parser: "tree-sitter" },
  go: { label: "Go", extensions: [".go"], capability: "dependency-aware", parser: "tree-sitter" },
  csharp: { label: "C#", extensions: [".cs"], capability: "dependency-aware", parser: "tree-sitter" },
  // A .h header is C++ in a repository with C++ sources (parse-repository.ts).
  c: { label: "C", extensions: [".c", ".h"], capability: "dependency-aware", parser: "tree-sitter" },
  cpp: {
    label: "C++",
    extensions: [".cc", ".cpp", ".cxx", ".c++", ".hh", ".hpp", ".hxx", ".h++", ".ipp", ".tpp", ".inl"],
    capability: "dependency-aware",
    parser: "tree-sitter",
  },
  rust: { label: "Rust", extensions: [".rs"], capability: "dependency-aware", parser: "tree-sitter" },
  php: { label: "PHP", extensions: [".php"], capability: "dependency-aware", parser: "tree-sitter" },
} as const satisfies Record<
  string,
  { label: string; extensions: readonly string[]; capability: CapabilityLevel; parser: string }
>;

// Languages whose tree-sitter syntax errors are reported as code issues. C
// and C++ are read without running the preprocessor, so a macro can look
// like a syntax error that the compiler would never see; for them only the
// #include lines are read and nothing is reported as a syntax error.
export const SYNTAX_ISSUES: ReadonlySet<SupportedLanguage> = new Set([
  "typescript",
  "javascript",
  "python",
  "java",
  "go",
  "csharp",
  "rust",
  "php",
]);
export type SupportedLanguage = keyof typeof SUPPORTED_LANGUAGES;

// Recognised by extension and nothing more. Ordered as they are listed.
export const DETECTED_LANGUAGES: { label: string; extensions: readonly string[] }[] = [
  { label: "Ruby", extensions: [".rb"] },
  { label: "Kotlin", extensions: [".kt", ".kts"] },
  { label: "Swift", extensions: [".swift"] },
  { label: "Dart", extensions: [".dart"] },
  { label: "SQL", extensions: [".sql"] },
];

function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot).toLowerCase();
}

const SUPPORTED_BY_EXTENSION = new Map<string, SupportedLanguage>(
  (Object.keys(SUPPORTED_LANGUAGES) as SupportedLanguage[]).flatMap((language) =>
    SUPPORTED_LANGUAGES[language].extensions.map((extension) => [extension, language] as const),
  ),
);
const DETECTED_BY_EXTENSION = new Map<string, string>(
  DETECTED_LANGUAGES.flatMap(({ label, extensions }) =>
    extensions.map((extension) => [extension, label] as const),
  ),
);

// The supported language a path's extension names, or null. Case matters, as
// it does to the tools that read these files.
export function supportedLanguageOf(path: string): SupportedLanguage | null {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? null : (SUPPORTED_BY_EXTENSION.get(name.slice(dot)) ?? null);
}

// What a path is, for a report: a supported language with its capability, a
// language that is only detected, or nothing recognised.
export function describeLanguage(
  path: string,
): { label: string; capability: CapabilityLevel } | null {
  const supported = supportedLanguageOf(path);
  if (supported) {
    const { label, capability } = SUPPORTED_LANGUAGES[supported];
    return { label, capability };
  }
  const detected = DETECTED_BY_EXTENSION.get(extensionOf(path));
  return detected ? { label: detected, capability: "detected" } : null;
}

const labels = (Object.keys(SUPPORTED_LANGUAGES) as SupportedLanguage[]).map(
  (language) => SUPPORTED_LANGUAGES[language].label,
);
// "TypeScript, JavaScript, …, PHP": for sentences that name them all.
export const SUPPORTED_LANGUAGE_NAMES = `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
