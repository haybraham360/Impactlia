"use client";

import { useMemo, type ReactNode } from "react";
import { FileRow, LongRows, numberFormat } from "@/components/detail-parts";
import { categoryLabel } from "@/lib/graph/emphasis";
import {
  HIGH_FAN_IN_DEPENDENTS,
  INSIGHT_CATEGORIES,
  LARGE_FILE_LINES,
  filesIn,
  type InsightCategory,
  type Insights,
} from "@/lib/graph/insights";
import type { GraphFile, GraphModel } from "@/lib/graph/model";
import type { Selection } from "@/lib/graph/selection";
import type { RepositoryOverview } from "@/lib/repository-overview";

// The findings behind the rail's insight filters: the files in each category
// and the fact that put them there. Every sentence here describes structure.
// None of it says a file is wrong.

type Select = (selection: Selection) => void;

const files = (count: number) => `${numberFormat.format(count)} ${count === 1 ? "file" : "files"}`;

function Finding({
  category,
  count,
  children,
}: {
  category: InsightCategory;
  count: number;
  children: ReactNode;
}) {
  return (
    <section className="border-t border-line pt-3 first:border-t-0 first:pt-0">
      <h3 className="flex items-baseline justify-between gap-3 font-medium">
        {categoryLabel[category]}
        <span className="text-muted tabular-nums">{numberFormat.format(count)}</span>
      </h3>
      <div className="mt-1 space-y-2">{children}</div>
    </section>
  );
}

const Explanation = ({ children }: { children: ReactNode }) => (
  <p className="text-xs text-muted">{children}</p>
);

export function InsightFindings({
  overview,
  model,
  insights,
  category,
  onSelect,
}: {
  overview: RepositoryOverview;
  model: GraphModel;
  insights: Insights;
  // With a filter chosen only that category is listed; otherwise all four.
  category: InsightCategory | null;
  onSelect: Select;
}) {
  const fileById = useMemo(
    () => new Map(model.files.map((file) => [file.id, file])),
    [model],
  );
  const row = (id: string, note?: string) => {
    const file: GraphFile | undefined = fileById.get(id);
    return file ? [<FileRow key={id} file={file} note={note} onSelect={onSelect} />] : [];
  };
  const shown = INSIGHT_CATEGORIES.filter((id) => category === null || category === id);
  const count = (id: InsightCategory) => filesIn(insights, id).length;
  const conventionLoaded = insights.conventionLoaded.reduce(
    (sum, entry) => sum + entry.files.length,
    0,
  );

  const body: Record<InsightCategory, ReactNode> = {
    cycles: (
      <>
        <Explanation>
          Groups of files that can each reach every other by following imports,
          so they import each other in a loop. This describes how the files are
          connected; a cycle is not a fault in itself.
        </Explanation>
        {insights.cycles.length === 0 ? (
          <Explanation>No import cycle was found in the resolved imports.</Explanation>
        ) : (
          insights.cycles.map((cycle) => (
            <div key={cycle.files[0]} className="border-l-2 border-line pl-2">
              <p className="text-xs text-muted">
                {cycle.files.length === 1
                  ? "1 file that imports itself"
                  : `Group of ${files(cycle.files.length)}. One loop through it, each file importing the next:`}
              </p>
              {cycle.files.length > 1 && (
                <p className="mt-0.5 font-mono text-xs break-all text-muted">
                  {cycle.loop.join(" → ")}
                </p>
              )}
              <div className="mt-1">
                <LongRows rows={cycle.files.flatMap((id) => row(id))} />
              </div>
            </div>
          ))
        )}
      </>
    ),
    "no-incoming": (
      <>
        <Explanation>
          No other file in the graph imports these. That is not evidence they
          are unused: a file can be run directly, loaded by a framework or a
          tool, or imported in a way static analysis cannot follow.
        </Explanation>
        {conventionLoaded > 0 && (
          <div className="text-xs text-muted">
            <p>
              {files(conventionLoaded)} more with no incoming imports{" "}
              {conventionLoaded === 1 ? "is" : "are"} left out because the name
              matches a convention a tool loads by itself:
            </p>
            <ul className="mt-1 space-y-0.5">
              {insights.conventionLoaded.map((entry) => (
                <li key={entry.convention} className="flex justify-between gap-3">
                  <span>{entry.convention}</span>
                  <span className="shrink-0 tabular-nums">
                    {numberFormat.format(entry.files.length)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {overview.unresolvedReferences > 0 && (
          <Explanation>
            {numberFormat.format(overview.unresolvedReferences)}{" "}
            {overview.unresolvedReferences === 1 ? "import" : "imports"} in the repository could
            not be resolved. A file listed here may be the target of one.
          </Explanation>
        )}
        {insights.noIncoming.length === 0 ? (
          <Explanation>Every other file is imported by at least one file.</Explanation>
        ) : (
          <LongRows rows={insights.noIncoming.flatMap((id) => row(id))} />
        )}
      </>
    ),
    "high-fan-in": (
      <>
        <Explanation>
          Files imported by {HIGH_FAN_IN_DEPENDENTS} or more other files. The
          number beside each is how many import it directly. A change to one
          of these can reach many files.
        </Explanation>
        {insights.highFanIn.length === 0 ? (
          <Explanation>No file is imported by that many others.</Explanation>
        ) : (
          <LongRows
            rows={insights.highFanIn.flatMap((entry) =>
              row(entry.file, numberFormat.format(entry.dependents)),
            )}
          />
        )}
      </>
    ),
    large: (
      <>
        <Explanation>
          Files with more than {numberFormat.format(LARGE_FILE_LINES)} lines,
          with the line count beside each. Size is a fact about the file, not
          a judgment of it.
        </Explanation>
        {insights.large.length === 0 ? (
          <Explanation>No file is that long.</Explanation>
        ) : (
          <LongRows
            rows={insights.large.flatMap((entry) =>
              row(entry.file, numberFormat.format(entry.lines)),
            )}
          />
        )}
      </>
    ),
  };

  return (
    <div className="space-y-3">
      {shown.map((id) => (
        <Finding key={id} category={id} count={count(id)}>
          {body[id]}
        </Finding>
      ))}
    </div>
  );
}
