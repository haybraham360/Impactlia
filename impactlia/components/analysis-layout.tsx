import type { ReactNode } from "react";

// The layout every analysis view uses: repository information on the left,
// the dependency graph in the middle, details of the selection on the right.
// The detail pane is a permanent column, not an overlay, so the graph never
// changes size when something is selected.
//
// Fills its parent's height on wide screens, where each column scrolls on its
// own; stacks in reading order on narrow ones.
export function AnalysisLayout({
  rail,
  detail,
  children,
}: {
  rail: ReactNode;
  detail: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[15rem_minmax(0,1fr)_20rem] lg:grid-rows-[minmax(0,1fr)]">
      <aside
        aria-label="Repository"
        className="border-b border-line bg-surface lg:overflow-y-auto lg:border-r lg:border-b-0"
      >
        {rail}
      </aside>
      <section
        aria-label="Dependency graph"
        className="relative min-h-[60dvh] lg:min-h-0"
      >
        {children}
      </section>
      <aside
        aria-label="Details"
        className="border-t border-line bg-surface lg:overflow-y-auto lg:border-t-0 lg:border-l"
      >
        {detail}
      </aside>
    </div>
  );
}
