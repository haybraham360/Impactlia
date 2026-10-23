import type { NextConfig } from "next";
// Imported for its side effect: validates required environment variables.
import "./lib/env";
import { GRAMMAR_FILES, RUNTIME_FILE } from "./parser/languages/grammar-files";

const TREE_SITTER_WASM = [RUNTIME_FILE, ...Object.values(GRAMMAR_FILES)].map(
  (segments) => `./node_modules/${segments.join("/")}`,
);

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // Hides the Next.js badge the dev server draws in the corner of every page.
  // Build and runtime errors still open their overlay.
  devIndicators: false,
  // A pull request analysis type-checks the changed code, and the compiler
  // reads its built-in library declarations (lib.*.d.ts) from disk at
  // runtime, so tracing does not find them. The pages under /app are where
  // an analysis is started or re-run; the GitHub webhook and the retry sweep
  // run automatic analyses.
  //
  // The tree-sitter runtime and its Python grammar are WebAssembly files the
  // parser reads from node_modules by path, wherever a repository is parsed.
  outputFileTracingIncludes: {
    "/app/**": ["./node_modules/typescript/lib/lib.*.d.ts", ...TREE_SITTER_WASM],
    "/api/github/webhook": ["./node_modules/typescript/lib/lib.*.d.ts", ...TREE_SITTER_WASM],
    "/api/github/jobs": ["./node_modules/typescript/lib/lib.*.d.ts", ...TREE_SITTER_WASM],
  },
  // Loaded by Node from node_modules rather than bundled: its Emscripten
  // loader decides at runtime how to start the WebAssembly module.
  serverExternalPackages: ["web-tree-sitter"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
