import type { ExclusionRule } from "./exclusions";

// Where framework-specific knowledge goes. The parser itself never tests for
// a framework; it only asks the adapter it was given. The interface holds
// only what the parser uses today and grows when a supported framework needs
// more.
export type FrameworkAdapter = {
  name: string;
  // Paths this framework generates, on top of the core exclusion rules.
  exclusionRules: ExclusionRule[];
};

// Knows nothing about any framework.
export const fallbackAdapter: FrameworkAdapter = {
  name: "fallback",
  exclusionRules: [],
};
