"use client";

import { useId, useState } from "react";
import { reasonLabel } from "@/components/repository-summary";
import type { CoverageSummary } from "@/lib/graph/coverage";

const numberFormat = new Intl.NumberFormat("en");
const plural = (count: number, one: string, many: string) =>
  `${numberFormat.format(count)} ${count === 1 ? one : many}`;

// What each kind of unresolved import means for the graph, in the reader's
// terms. The counts beside them are the parser's.
const reasonMeaning: Record<keyof typeof reasonLabel, string> = {
  "file-not-found": "the path points at a file that is not in the repository",
  "alias-target-not-found": "a path alias is configured, but nothing exists where it points",
  "alias-not-configured": "it looks like a path alias, and no tsconfig or jsconfig defines one that matches",
  "workspace-package-not-linked": "it names a package in this repository whose entry file could not be found",
  "non-literal-specifier": "the path is built at runtime, so no file can be named for it",
};

// Sits above the graph whenever the parser reported something that could mean
// a missing relationship. Collapsed it is one line, and that line always
// carries the figure or the words "partial coverage".
export function CoverageBanner({ coverage }: { coverage: CoverageSummary }) {
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  if (!coverage.incomplete) return null;

  const { imports } = coverage;
  const unresolved = imports ? imports.total - imports.resolved : 0;

  return (
    <div className="border-b border-caution/40 bg-caution/10 text-sm">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2">
        <p className="min-w-0 flex-1 basis-64">
          <span className="font-medium text-caution">
            {imports
              ? `Partial map: ${imports.percent}% of imports between repository files resolved`
              : "Partial coverage"}
          </span>{" "}
          <span className="text-muted">
            {imports
              ? `(${numberFormat.format(imports.resolved)} of ${numberFormat.format(imports.total)}). `
              : "No percentage can be given: no import pointing inside the repository was read. "}
            {unresolved > 0 &&
              `${plural(unresolved, "import is", "imports are")} missing from this graph. `}
            {coverage.failedFiles > 0 &&
              `${plural(coverage.failedFiles, "file", "files")} could not be parsed.`}
          </span>
        </p>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={detailsId}
          onClick={() => setOpen((value) => !value)}
          className="cursor-pointer text-accent hover:underline"
        >
          {open ? "Hide details" : "What is missing"}
        </button>
      </div>

      {open && (
        <div
          id={detailsId}
          className="max-h-[45dvh] space-y-3 overflow-y-auto border-t border-caution/30 px-4 py-3"
        >
          {imports && (
            <p className="max-w-prose text-muted">
              The figure counts imports the parser read that point at a file in this
              repository: those it resolved to a file in the graph, out of those plus the
              ones it could not resolve. Imports of installed packages are not counted
              either way.
            </p>
          )}
          <ul className="max-w-prose space-y-1.5">
            {coverage.unresolvedByReason.map(({ reason, count }) => (
              <li key={reason}>
                <span className="font-medium tabular-nums">{numberFormat.format(count)}</span>{" "}
                {reasonLabel[reason].toLowerCase()}:{" "}
                <span className="text-muted">{reasonMeaning[reason]}.</span>
              </li>
            ))}
            {coverage.failedFiles > 0 && (
              <li>
                <span className="font-medium tabular-nums">
                  {numberFormat.format(coverage.failedFiles)}
                </span>{" "}
                of {plural(coverage.files, "file", "files")} had syntax errors:{" "}
                <span className="text-muted">
                  they are in the graph, but none of their own imports were read.
                </span>
              </li>
            )}
            {coverage.configProblems.map((config) => (
              <li key={config.path}>
                <span className="font-mono text-[0.8125rem]">{config.path}</span> could not be
                fully read, which affects how aliases resolve:{" "}
                <span className="text-muted">{config.problems.join(" ")}</span>
              </li>
            ))}
            {coverage.excludedImports > 0 && (
              <li>
                <span className="font-medium tabular-nums">
                  {numberFormat.format(coverage.excludedImports)}
                </span>{" "}
                imports of files left out of the graph:{" "}
                <span className="text-muted">
                  build output, installed dependencies and files that are not TypeScript
                  or JavaScript.
                </span>
              </li>
            )}
          </ul>
          <p className="max-w-prose text-muted">
            Select a file to see its own unresolved imports. Apart from what is counted
            above, this map only knows static imports in TypeScript and JavaScript.
            {coverage.unsupportedFiles > 0 &&
              ` ${plural(coverage.unsupportedFiles, "file of another type was", "files of other types were")} not read.`}{" "}
            Files a framework loads by convention (routes, pages, config), and anything
            connected only at runtime, have no edge here. A figure of 100% would not
            mean every dependency has been found.
          </p>
        </div>
      )}
    </div>
  );
}
