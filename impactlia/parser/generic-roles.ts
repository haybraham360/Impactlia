import type { FileRole } from "./contract";

// Roles that depend on nothing but a file's name, and so apply to every
// repository. Adapters call this between their path conventions and their
// syntax rules; the parser calls it for every file no adapter placed.
export function supportingRole(file: { path: string; declaration: boolean }): FileRole | null {
  if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(file.path)) {
    return { id: "test", reason: "Named *.test.* or *.spec.*.", line: null };
  }
  if (/(^|\/)__tests__\//.test(file.path)) {
    return { id: "test", reason: "Inside a __tests__ directory.", line: null };
  }
  if (file.declaration) {
    return { id: "declaration", reason: "A type declaration file (*.d.ts).", line: null };
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
