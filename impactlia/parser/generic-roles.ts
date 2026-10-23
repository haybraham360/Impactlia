import type { FileRole } from "./contract";

// Roles that depend on nothing but a file's name, and so apply to every
// repository. Adapters call this between their path conventions and their
// syntax rules; the parser calls it for every file no adapter placed.
const TEST_NAMES: { pattern: RegExp; reason: string }[] = [
  { pattern: /_test\.go$/, reason: "Named *_test.go." },
  { pattern: /(Test|Tests|TestCase|IT)\.java$/, reason: "Named *Test.java, *Tests.java, *TestCase.java or *IT.java." },
  { pattern: /Tests?\.cs$/, reason: "Named *Test.cs or *Tests.cs." },
  { pattern: /Test\.php$/, reason: "Named *Test.php." },
  { pattern: /(^|\/)tests\/[^/]+\.rs$/, reason: "A file directly in a tests folder, Cargo's integration tests." },
  {
    pattern: /(^|\/)([^/]+_(unit)?test|test_[^/]+)\.(c|cc|cpp|cxx)$/,
    reason: "Named *_test, *_unittest or test_* in C or C++.",
  },
];

export function supportingRole(file: { path: string; declaration: boolean }): FileRole | null {
  if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(file.path)) {
    return { id: "test", reason: "Named *.test.* or *.spec.*.", line: null };
  }
  if (/(^|\/)__tests__\//.test(file.path)) {
    return { id: "test", reason: "Inside a __tests__ directory.", line: null };
  }
  // pytest's default test file names, which unittest's discovery also finds.
  if (/(^|\/)(test_[^/]*|[^/]+_test)\.py$/.test(file.path)) {
    return { id: "test", reason: "Named test_*.py or *_test.py.", line: null };
  }
  // Each ecosystem's own default: go test, Maven Surefire and Failsafe, the
  // dotnet and PHPUnit conventions, Cargo's tests folder, googletest.
  const convention = TEST_NAMES.find(({ pattern }) => pattern.test(file.path));
  if (convention) return { id: "test", reason: convention.reason, line: null };
  if (file.declaration) {
    return file.path.endsWith(".pyi")
      ? { id: "declaration", reason: "A Python type stub (*.pyi).", line: null }
      : { id: "declaration", reason: "A type declaration file (*.d.ts).", line: null };
  }
  if (/(^|\/)[^/]+\.config\.[cm]?[jt]s$/.test(file.path)) {
    return { id: "config", reason: "Named *.config.*.", line: null };
  }
  return null;
}

export const otherRole = (framework: string | null): FileRole => ({
  id: "other",
  reason: framework
    ? `No ${framework} or generic rule matched this file.`
    : "No generic rule matched this file, and no supported framework was detected.",
  line: null,
});
