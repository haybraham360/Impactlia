import type { Language, Node } from "web-tree-sitter";
import type { ParseStatus } from "../contract";
import { PARSE_ERROR_LIMIT } from "./adapter";
import { parserFor } from "./tree-sitter";

// What every tree-sitter language adapter shares: parsing each file on its
// own, recording syntax errors, and freeing each tree as soon as it has been
// read. A failure in one file is that file's, never the repository's.

const EXPRESSION_PREVIEW_LENGTH = 80;
// One file may take this long to parse. tree-sitter is linear in the size of
// its input, so only a pathological file gets near it; it is recorded as a
// parse failure rather than allowed to hold up the run.
export const PARSE_TIME_LIMIT_MS = 2_000;

export const lineOf = (node: Node) => node.startPosition.row + 1;
// Source text with its whitespace removed: `a . b` and `a.b` name the same.
export const compact = (node: Node) => node.text.replace(/\s+/g, "");

export function preview(text: string): string {
  return text.length > EXPRESSION_PREVIEW_LENGTH ? `${text.slice(0, EXPRESSION_PREVIEW_LENGTH)}…` : text;
}

// Line numbers of syntax errors, at most PARSE_ERROR_LIMIT, in file order.
// Only branches that contain an error are walked.
export function syntaxErrors(root: Node, language: string): { line: number; message: string }[] {
  const errors: { line: number; message: string }[] = [];
  const visit = (node: Node) => {
    if (errors.length >= PARSE_ERROR_LIMIT) return;
    if (node.isMissing) {
      errors.push({ line: lineOf(node), message: `Expected ${node.type} here.` });
      return;
    }
    if (node.isError) {
      errors.push({
        line: lineOf(node),
        message: `${language} could not parse this: ${preview(node.text.split("\n")[0])}`,
      });
      return;
    }
    for (const child of node.children) if (child.hasError) visit(child);
  };
  if (root.hasError) visit(root);
  return errors;
}

export type TreeReading<T> = {
  parseStatus: ParseStatus;
  parseErrors: { line: number; message: string }[];
  // What `read` returned. null for a file that failed to parse.
  value: T | null;
};

// Parses every file with one parser and gives each tree to `read`, which
// must copy out what it needs: the tree is deleted when it returns.
//
// `checkSyntax: false` is for a grammar whose errors are not evidence of a
// broken file (C and C++, which tree-sitter reads without running the
// preprocessor; see c.ts). Every file then counts as parsed.
export function readTrees<T>(
  grammar: Language,
  label: string,
  files: readonly string[],
  texts: ReadonlyMap<string, string>,
  read: (file: string, root: Node) => T,
  { checkSyntax = true }: { checkSyntax?: boolean } = {},
): Map<string, TreeReading<T>> {
  const readings = new Map<string, TreeReading<T>>();
  const parser = parserFor(grammar);
  const fail = (file: string, message: string) =>
    readings.set(file, { parseStatus: "failed", parseErrors: [{ line: 1, message }], value: null });
  try {
    for (const file of files) {
      let tree;
      const started = Date.now();
      try {
        tree = parser.parse(texts.get(file) ?? "", null, {
          progressCallback: () => Date.now() - started > PARSE_TIME_LIMIT_MS,
        });
      } catch (error) {
        parser.reset();
        fail(file, `The ${label} parser stopped: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
      if (!tree) {
        parser.reset();
        fail(file, `Parsing took longer than the limit of ${PARSE_TIME_LIMIT_MS / 1000} seconds for one file.`);
        continue;
      }
      try {
        const errors = checkSyntax ? syntaxErrors(tree.rootNode, label) : [];
        readings.set(
          file,
          errors.length > 0
            ? { parseStatus: "failed", parseErrors: errors, value: null }
            : { parseStatus: "parsed", parseErrors: [], value: read(file, tree.rootNode) },
        );
      } finally {
        tree.delete();
      }
    }
  } finally {
    parser.delete();
  }
  return readings;
}
