import fs from "node:fs";
import path from "node:path";
import type { WalkResult } from "../walk";

// Reading a project file the walk listed (go.mod, Cargo.toml, composer.json)
// from the repository on disk. These say how a language's modules are laid
// out; they are small, so one over the limit is treated as unreadable.
const PROJECT_FILE_LIMIT_BYTES = 256 * 1024;

export function readProjectFile(root: string, relative: string): string | null {
  try {
    const file = path.join(/* turbopackIgnore: true */ root, relative);
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > PROJECT_FILE_LIMIT_BYTES) return null;
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

// Every listed file with this name, in path order.
export function filesNamed(walk: WalkResult, name: string): string[] {
  return [...walk.skippedFiles.keys(), ...walk.sourceFiles]
    .filter((file) => file === name || file.endsWith(`/${name}`))
    .sort();
}

export const parentOf = (file: string) => (file.includes("/") ? path.posix.dirname(file) : "");
export const joinPath = (folder: string, relative: string) =>
  folder === "" ? relative : `${folder}/${relative}`;

// The rule that kept a path out of the graph: its own, or an excluded
// folder's above it. null when nothing excluded it.
export function exclusionOf(walk: WalkResult, relative: string): string | null {
  const own = walk.skippedFiles.get(relative) ?? walk.skippedDirectories.get(relative);
  if (own) return own;
  for (let folder = parentOf(relative); folder !== ""; folder = parentOf(folder)) {
    const rule = walk.skippedDirectories.get(folder);
    if (rule) return rule;
  }
  return null;
}
