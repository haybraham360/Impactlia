import type { NextConfig } from "next";
// Imported for its side effect: validates required environment variables.
import "./lib/env";

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
  outputFileTracingIncludes: {
    "/app/**": ["./node_modules/typescript/lib/lib.*.d.ts"],
    "/api/github/webhook": ["./node_modules/typescript/lib/lib.*.d.ts"],
    "/api/github/jobs": ["./node_modules/typescript/lib/lib.*.d.ts"],
  },
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
