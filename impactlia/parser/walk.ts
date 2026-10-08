import fs from "node:fs";
import path from "node:path";
import type { Language } from "./contract";
import { symbolicLinkRule, unsupportedFileTypeRule, type ExclusionRule } from "./exclusions";

export type WalkResult = {
  // Repository-relative paths of every file that becomes a node, sorted.
  sourceFiles: string[];
  // Every other file and directory the walk met, with the rule that kept it out.
  skippedFiles: Map<string, string>;
  skippedDirectories: Map<string, string>;
};

const LANGUAGE_BY_EXTENSION: Record<string, Language> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
};

export function describeSourceFile(
  name: string,
): { extension: string; language: Language; declaration: boolean } | null {
  const extension = path.extname(name);
  const language = LANGUAGE_BY_EXTENSION[extension];
  if (!language) return null;
  return { extension, language, declaration: /\.d\.[cm]?ts$/.test(name) };
}

// Plain code-point order, so the result does not depend on the machine's locale.
export function byText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function walkRepository(root: string, rules: ExclusionRule[]): WalkResult {
  const sourceFiles: string[] = [];
  const skippedFiles = new Map<string, string>();
  const skippedDirectories = new Map<string, string>();
  const ruleFor = (appliesTo: ExclusionRule["appliesTo"], name: string) =>
    rules.find((rule) => rule.appliesTo === appliesTo && rule.matches(name));

  function visit(folder: string): void {
    const entries = fs.readdirSync(path.join(root, folder), { withFileTypes: true });
    for (const entry of entries) {
      const relative = folder ? `${folder}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) {
        skippedFiles.set(relative, symbolicLinkRule.id);
      } else if (entry.isDirectory()) {
        const rule = ruleFor("directory", entry.name);
        if (rule) skippedDirectories.set(relative, rule.id);
        else visit(relative);
      } else {
        const rule = ruleFor("file", entry.name);
        if (rule) skippedFiles.set(relative, rule.id);
        else if (entry.isFile() && describeSourceFile(entry.name)) sourceFiles.push(relative);
        else skippedFiles.set(relative, unsupportedFileTypeRule.id);
      }
    }
  }

  visit("");
  sourceFiles.sort(byText);
  return { sourceFiles, skippedFiles, skippedDirectories };
}
