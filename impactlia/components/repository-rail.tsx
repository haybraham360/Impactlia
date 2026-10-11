"use client";

import { useMemo, useState } from "react";
import { InsightFindings } from "@/components/insight-findings";
import { categoryLabel } from "@/lib/graph/emphasis";
import {
  INSIGHT_CATEGORIES,
  filesIn,
  type InsightCategory,
  type Insights,
} from "@/lib/graph/insights";
import type { GraphModel } from "@/lib/graph/model";
import type { Selection } from "@/lib/graph/selection";
import type { FileGroup, RepositoryOverview } from "@/lib/repository-overview";

const numberFormat = new Intl.NumberFormat("en");

function Total({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="font-medium tabular-nums">{numberFormat.format(value)}</dd>
    </div>
  );
}

function Groups({ title, groups }: { title: string; groups: FileGroup[] }) {
  return (
    <section className="border-t border-line px-4 py-4">
      <h2 className="mb-2 text-xs font-medium text-muted">{title}</h2>
      <ul className="space-y-1">
        {groups.map((group) => (
          <li
            key={group.label}
            className="flex items-baseline justify-between gap-3"
          >
            <span className="truncate font-mono text-[0.8125rem]" title={group.label}>
              {group.label}
            </span>
            <span className="text-muted tabular-nums">
              {numberFormat.format(group.files)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// The insight filters, with the findings behind them one click away. The
// filters are always visible; the findings start closed so the rail stays a
// summary until someone asks for the detail.
function InsightSection({
  overview,
  model,
  insights,
  category,
  onCategory,
  onSelect,
}: {
  overview: RepositoryOverview;
  model: GraphModel;
  insights: Insights;
  category: InsightCategory | null;
  onCategory: (category: InsightCategory | null) => void;
  onSelect: (selection: Selection) => void;
}) {
  const [open, setOpen] = useState(false);
  // The same list the graph's emphasis and the findings are taken from, so
  // the three counts cannot disagree.
  const counts = useMemo(
    () => new Map(INSIGHT_CATEGORIES.map((id) => [id, filesIn(insights, id).length])),
    [insights],
  );

  return (
    <section className="border-t border-line px-4 py-4">
      <h2 className="mb-1 text-xs font-medium text-muted">Insights</h2>
      <p className="mb-2 text-xs text-muted">
        Counted from the import graph. Choose one to pick its files out on the
        graph.
      </p>
      <ul className="space-y-0.5">
        {INSIGHT_CATEGORIES.map((id) => {
          const active = category === id;
          return (
            <li key={id}>
              <button
                type="button"
                aria-pressed={active}
                onClick={() => onCategory(active ? null : id)}
                className={`-mx-2 flex w-[calc(100%+1rem)] cursor-pointer items-baseline justify-between gap-3 rounded px-2 py-1 text-left ${
                  active ? "bg-accent text-accent-ink" : "hover:bg-canvas"
                }`}
              >
                <span>{categoryLabel[id]}</span>
                <span className={`tabular-nums ${active ? "" : "text-muted"}`}>
                  {numberFormat.format(counts.get(id) ?? 0)}
                  <span className="sr-only"> files</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        <button
          type="button"
          aria-expanded={open}
          aria-controls="insight-findings"
          onClick={() => setOpen(!open)}
          className="cursor-pointer text-accent hover:underline"
        >
          {open ? "Hide findings" : "Show findings"}
        </button>
        {category && (
          <button
            type="button"
            onClick={() => onCategory(null)}
            className="cursor-pointer text-accent hover:underline"
          >
            Show the full graph
          </button>
        )}
      </div>
      {open && (
        <div id="insight-findings" className="mt-3">
          <InsightFindings
            overview={overview}
            model={model}
            insights={insights}
            category={category}
            onSelect={onSelect}
          />
        </div>
      )}
    </section>
  );
}

export function RepositoryRail({
  overview,
  model,
  insights,
  category,
  onCategory,
  onSelect,
}: {
  overview: RepositoryOverview;
  model: GraphModel;
  insights: Insights;
  category: InsightCategory | null;
  onCategory: (category: InsightCategory | null) => void;
  onSelect: (selection: Selection) => void;
}) {
  return (
    <div className="text-sm">
      <section className="px-4 py-4">
        <h2 className="mb-2 text-xs font-medium text-muted">Repository</h2>
        <dl className="space-y-1">
          <Total label="Source files" value={overview.files} />
          <Total label="Dependencies" value={overview.edges} />
          {/* Always shown, zero included: a graph with unresolved imports is
              missing relationships, and that should never be invisible. */}
          <Total
            label="Unresolved imports"
            value={overview.unresolvedReferences}
          />
          {overview.failedFiles > 0 && (
            <Total label="Files not parsed" value={overview.failedFiles} />
          )}
        </dl>
      </section>
      <InsightSection
        overview={overview}
        model={model}
        insights={insights}
        category={category}
        onCategory={onCategory}
        onSelect={onSelect}
      />
      <Groups title="Top-level directories" groups={overview.topLevelDirectories} />
      <Groups title="File types" groups={overview.fileTypes} />
    </div>
  );
}
