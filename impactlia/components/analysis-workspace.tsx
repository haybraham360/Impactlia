"use client";

import { useCallback, useMemo, useState } from "react";
import { AnalysisLayout } from "@/components/analysis-layout";
import { HoverContext, createHoverStore } from "@/components/hover";
import { ImpactGraph } from "@/components/impact-graph";
import { RepositoryRail } from "@/components/repository-rail";
import { SelectionDetail } from "@/components/selection-detail";
import type { GraphModel } from "@/lib/graph/model";
import { relate, type Selection } from "@/lib/graph/selection";
import type { RepositoryOverview } from "@/lib/repository-overview";

// Owns what the three columns share: what is selected, and what is hovered.
export function AnalysisWorkspace({
  overview,
  model,
}: {
  overview: RepositoryOverview;
  model: GraphModel;
}) {
  const [selection, setSelection] = useState<Selection | null>(null);
  const [hover] = useState(createHoverStore);
  const relations = useMemo(
    () => (selection ? relate(model, selection) : null),
    [model, selection],
  );
  const select = useCallback(
    (next: Selection | null) => {
      // The row that was clicked may not exist in the next view, and a row
      // that disappears never reports the pointer leaving it.
      hover.set(null);
      setSelection(next);
    },
    [hover],
  );

  return (
    <HoverContext value={hover}>
      <AnalysisLayout
        rail={<RepositoryRail overview={overview} />}
        detail={
          <SelectionDetail
            overview={overview}
            model={model}
            selection={selection}
            relations={relations}
            onSelect={select}
          />
        }
      >
        <ImpactGraph
          model={model}
          selection={selection}
          relations={relations}
          onSelect={select}
        />
      </AnalysisLayout>
    </HoverContext>
  );
}
