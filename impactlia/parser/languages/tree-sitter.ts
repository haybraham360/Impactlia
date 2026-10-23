import fs from "node:fs";
import path from "node:path";
import { Language, Parser } from "web-tree-sitter";
import { GRAMMAR_FILES, RUNTIME_FILE } from "./grammar-files";

// The tree-sitter grammars the language adapters parse with. tree-sitter runs
// as WebAssembly, so nothing native is installed or compiled, and a parse
// cannot touch the filesystem or run what it reads.
//
// Loading is asynchronous and happens once per process. Everything after it
// is synchronous, like the TypeScript parser, so a caller loads the grammars
// first and hands them to the parser and to the impact analysis.
//
// The .wasm files are read from node_modules by path rather than found by the
// bundler, so the deployment includes them explicitly (next.config.ts).

export type Grammars = Record<keyof typeof GRAMMAR_FILES, Language>;

function readWasm(segments: readonly string[]): Uint8Array {
  return fs.readFileSync(path.join(/* turbopackIgnore: true */ process.cwd(), "node_modules", ...segments));
}

let loading: Promise<Grammars> | null = null;

export function loadGrammars(): Promise<Grammars> {
  loading ??= (async () => {
    await Parser.init({ wasmBinary: readWasm(RUNTIME_FILE) });
    const load = (name: keyof typeof GRAMMAR_FILES) => Language.load(readWasm(GRAMMAR_FILES[name]));
    const [python, java, go, csharp, c, cpp, rust, php] = await Promise.all([
      load("python"),
      load("java"),
      load("go"),
      load("csharp"),
      load("c"),
      load("cpp"),
      load("rust"),
      load("php"),
    ]);
    return { python, java, go, csharp, c, cpp, rust, php };
  })();
  // A failed load is not cached, so the next analysis tries again.
  loading.catch(() => {
    loading = null;
  });
  return loading;
}

// A parser for one grammar. The caller deletes it when done: its memory lives
// in the WebAssembly heap, outside the garbage collector's reach.
export function parserFor(language: Language): Parser {
  const parser = new Parser();
  parser.setLanguage(language);
  return parser;
}
