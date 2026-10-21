import type { LineRange } from "./report";

// The lines a pull request added to a file, and where it removed lines, read
// from the unified diff GitHub returns as the file's `patch`. Only line
// numbers are kept: the patch's text is never stored.
//
// Line numbers are of the head revision, the same file the graph and the
// compiler read, so a location from either can be checked against them.

// "@@ -12,7 +12,9 @@ optional section heading". A count left out means 1.
const HUNK = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

// A patch from GitHub is far below this; anything longer is not trusted to be
// one, and the file is treated as having no patch.
const RANGE_LIMIT = 5000;

export type PatchLines = {
  // Inclusive, sorted, never overlapping or touching.
  added: LineRange[];
  // Where lines were taken out: for each run of removed lines, the head line
  // that now follows it. A file whose last lines were removed gives one past
  // its end. Sorted, each point once.
  removedAt: number[];
};

// null when the text is not a unified diff that can be followed line by line.
export function readPatch(patch: string): PatchLines | null {
  const ranges: LineRange[] = [];
  const removedAt: number[] = [];
  let next: number | null = null;
  // How many head-side lines the current hunk still has to account for.
  let remaining = 0;
  for (const line of patch.split("\n")) {
    const header = HUNK.exec(line);
    if (header) {
      if (remaining > 0) return null;
      next = Number(header[1]);
      remaining = header[2] === undefined ? 1 : Number(header[2]);
      // An empty head side ("+0,0") is a file emptied; what follows it is line 1.
      if (remaining === 0 && next === 0) next = 1;
      continue;
    }
    if (next === null) {
      // Nothing before the first hunk header is part of a diff.
      if (line === "") continue;
      return null;
    }
    if (line.startsWith("\\")) continue; // "\ No newline at end of file"
    if (line.startsWith("-")) {
      if (removedAt.at(-1) !== next) removedAt.push(next);
      if (removedAt.length > RANGE_LIMIT) return null;
      continue;
    }
    if (line.startsWith("+")) {
      if (remaining === 0) return null;
      const last = ranges.at(-1);
      if (last && last.end === next - 1) last.end = next;
      else ranges.push({ start: next, end: next });
      if (ranges.length > RANGE_LIMIT) return null;
      next += 1;
      remaining -= 1;
      continue;
    }
    if (line.startsWith(" ")) {
      if (remaining === 0) return null;
      next += 1;
      remaining -= 1;
      continue;
    }
    // GitHub's patch has no trailing newline, but a blank last line is not a
    // change either way.
    if (line === "") continue;
    return null;
  }
  if (remaining > 0) return null;
  return { added: ranges, removedAt };
}

export function addedLines(patch: string): LineRange[] | null {
  return readPatch(patch)?.added ?? null;
}

export function isAdded(ranges: readonly LineRange[], line: number): boolean {
  return ranges.some((range) => line >= range.start && line <= range.end);
}
