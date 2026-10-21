import fs from "node:fs";
import path from "node:path";

// Reading files of the unpacked head commit by their repository path. Only
// paths inside the repository are answered: one that is absolute, climbs out
// with "..", or resolves through a link to somewhere else is treated as
// absent. Nothing read here is run or logged.

// A source or test file larger than this is not read for its declarations.
export const READ_LIMIT_BYTES = 1024 * 1024;

export type RepositoryFiles = {
  // The file's text, or null when it is absent, unreadable or too large.
  read(path: string): string | null;
  exists(path: string): boolean;
};

export function repositoryFiles(directory: string): RepositoryFiles {
  const root = fs.realpathSync.native(path.resolve(directory));
  const locate = (relative: string): string | null => {
    if (relative === "" || relative.startsWith("/") || relative.split("/").includes("..")) return null;
    try {
      const real = fs.realpathSync.native(path.join(root, relative));
      return real.startsWith(`${root}${path.sep}`) ? real : null;
    } catch {
      return null;
    }
  };
  return {
    read(relative) {
      const file = locate(relative);
      if (!file) return null;
      try {
        // The unpacked archive, never this application's own files.
        const stat = fs.statSync(/* turbopackIgnore: true */ file);
        if (!stat.isFile() || stat.size > READ_LIMIT_BYTES) return null;
        return fs.readFileSync(/* turbopackIgnore: true */ file, "utf8");
      } catch {
        return null;
      }
    },
    exists(relative) {
      const file = locate(relative);
      return (
        file !== null &&
        fs.statSync(/* turbopackIgnore: true */ file, { throwIfNoEntry: false })?.isFile() === true
      );
    },
  };
}
