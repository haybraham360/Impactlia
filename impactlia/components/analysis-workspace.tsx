"use client";

import { useCallback, useMemo, useState } from "react";
import { AnalysisLayout } from "@/components/analysis-layout";
import type { AiContext } from "@/components/explanation-panel";
import { CoverageBanner } from "@/components/coverage-banner";
import { HoverContext, createHoverStore } from "@/components/hover";
import { ImpactGraph } from "@/components/impact-graph";
import { RepositoryRail } from "@/components/repository-rail";
import { RouteTable } from "@/components/route-table";
import { SelectionDetail, type FileView } from "@/components/selection-detail";
import type { CoverageSummary } from "@/lib/graph/coverage";
import {
  emphasiseCategory,
  emphasiseRole,
  emphasiseTraversal,
  type GraphFilter,
} from "@/lib/graph/emphasis";
import { findInsights } from "@/lib/graph/insights";
import type { GraphModel } from "@/lib/graph/model";
import { relate, type Selection } from "@/lib/graph/selection";
import { DEFAULT_DEPTH, indexEdges, traverse } from "@/lib/graph/traverse";
import type { RepositoryOverview } from "@/lib/repository-overview";

// Owns what the three columns share: what is selected, what is hovered, and
// which traversal or rail filter the graph is emphasising. All of it is
// worked out here from the model already in the browser.
export function AnalysisWorkspace({
  overview,
  model,
  coverage,
  ai,
}: {
  ai?: AiContext;
  overview: RepositoryOverview;
  model: GraphModel;
  coverage: CoverageSummary;
}) {
  const [selection, setSelection] = useState<Selection | null>(null);
  const [hover] = useState(createHoverStore);
  const relations = useMemo(
    () => (selection ? relate(model, selection) : null),
    [model, selection],
  );
  const [view, setView] = useState<FileView>("structure");
  const [depth, setDepth] = useState(DEFAULT_DEPTH);
  const [filter, setFilter] = useState<GraphFilter | null>(null);

  // Each depends on the model alone, so the whole-graph work happens once per
  // graph and again only when the graph itself is replaced.
  const index = useMemo(() => indexEdges(model.edges), [model]);
  const insights = useMemo(() => findInsights(model.files, index), [model, index]);

  const selectedFile = selection?.kind === "file" ? selection.id : null;
  const traversal = useMemo(
    () =>
      selectedFile !== null && view !== "structure"
        ? traverse(index, [selectedFile], view, depth)
        : null,
    [index, selectedFile, view, depth],
  );
  const emphasis = useMemo(() => {
    if (filter?.kind === "insight") return emphasiseCategory(model, insights, filter.id);
    if (filter?.kind === "role") return emphasiseRole(model, filter.id);
    return traversal ? emphasiseTraversal(model, traversal) : null;
  }, [model, insights, filter, traversal]);

  const select = useCallback(
    (next: Selection | null) => {
      // The row that was clicked may not exist in the next view, and a row
      // that disappears never reports the pointer leaving it.
      hover.set(null);
      setSelection(next);
      // The open view carries over to the next file, like the tab does, but
      // every file starts from the default depth.
      setDepth(DEFAULT_DEPTH);
    },
    [hover],
  );
  // A traversal and a rail filter both decide what the graph dims, so
  // turning one on turns the other off.
  const chooseView = useCallback((next: FileView) => {
    setView(next);
    if (next !== "structure") setFilter(null);
  }, []);
  const chooseFilter = useCallback((next: GraphFilter | null) => {
    setFilter(next);
    if (next) setView("structure");
  }, []);
  const clearEmphasis = useCallback(() => {
    setFilter(null);
    setView("structure");
  }, []);

  return (
    <HoverContext value={hover}>
      <AnalysisLayout
        rail={
          <RepositoryRail
            overview={overview}
            model={model}
            insights={insights}
            filter={filter}
            onFilter={chooseFilter}
            onSelect={select}
          />
        }
        detail={
          <SelectionDetail
            overview={overview}
            model={model}
            selection={selection}
            relations={relations}
            controls={{ view, traversal, onView: chooseView, onDepth: setDepth }}
            ai={ai}
            onSelect={select}
          />
        }
      >
        {/* The banner takes its own row above the canvas, so it can never be
            panned or zoomed out of sight. */}
        <div className="absolute inset-0 flex flex-col">
          <CoverageBanner coverage={coverage} />
          <div className="relative min-h-0 flex-1">
            <ImpactGraph
              model={model}
              selection={selection}
              relations={relations}
              emphasis={emphasis}
              onClearEmphasis={clearEmphasis}
              onSelect={select}
            />
          </div>
          <RouteTable overview={overview} selectedFile={selectedFile} onSelect={select} />
        </div>
      </AnalysisLayout>
    </HoverContext>
  );
}
