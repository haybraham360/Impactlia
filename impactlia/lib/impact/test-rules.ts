import type { TestRelationship } from "./report";

// The test runners tests.ts looks for and the written rules it applies, kept
// apart from it so the report page can print them without loading the
// TypeScript compiler. Plain data with no runtime imports.

// Packages whose import marks a file as a test, wherever it is and whatever
// it is called. Only test runners: a helper library is imported by fixtures
// and utilities too.
export const TEST_RUNNERS: readonly string[] = [
  "vitest",
  "jest",
  "@jest/globals",
  "mocha",
  "ava",
  "uvu",
  "tap",
  "node:test",
  "bun:test",
  "@playwright/test",
  "cypress",
];

export const TEST_RULES = {
  imports:
    "Only imports the parser resolved are followed, and an import of types only does not count: it runs none of the changed code.",
  testFiles: `A file is a test when the parser gave it the Tests role (named *.test.* or *.spec.*, or inside __tests__), or when it imports a test runner: ${TEST_RUNNERS.join(", ")}.`,
  relationships: {
    "imports-changed-symbol":
      "High confidence. The test imports, by name, a declaration whose lines this pull request changes.",
    "imports-changed-file":
      "Medium confidence. The test imports a changed file, but not by a name that could be tied to the changed lines.",
    "changed-in-pull-request":
      "Medium confidence. This pull request edits the test itself.",
    "imports-indirectly":
      "Low confidence. The test imports a file that leads to a changed file through other imports. It may not exercise the changed code.",
    "name-only":
      "Low confidence. The test is named like a changed file but no import of it was found. A name alone is not evidence that it tests the file.",
  } satisfies Record<TestRelationship, string>,
  scenarios:
    "Suggested from the syntax on lines this pull request adds, inside a declaration it changes: a new or edited signature of an exported function, a throw, a catch, a condition, a default or ?? / ?. fallback, an await, or a route handler. Each names its lines. Whether a test is needed is a judgement; the code it points at is a fact.",
  coverage:
    "Coverage reports are not read: one committed to the repository cannot be tied to this pull request's head commit, and Impactlia runs no tests. A changed file with no test found is listed as unknown coverage, not as a gap.",
  command:
    "Read from the scripts.test entry of the repository's package.json (the package nearest the related tests in a monorepo), with the package manager its lockfile or packageManager field names. Narrowed to the related test files only when the script is a single vitest or jest call, which accept file filters. Never run here.",
};

// What each relationship is called where a test is listed.
export const RELATIONSHIP_LABELS: Record<TestRelationship, string> = {
  "imports-changed-symbol": "Imports changed code",
  "imports-changed-file": "Imports a changed file",
  "changed-in-pull-request": "Changed in this pull request",
  "imports-indirectly": "Indirect import",
  "name-only": "Possible match by name",
};
