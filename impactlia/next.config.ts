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
