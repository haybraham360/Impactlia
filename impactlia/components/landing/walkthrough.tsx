"use client";

import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { FileMark, stateTone } from "@/components/landing/file-mark";
import { RiskBadge } from "@/components/landing/risk-badge";
import {
  affectedFiles,
  changedFiles,
  exampleDiff,
  exampleEdges,
  exampleFiles,
  examplePullRequest,
} from "@/lib/landing/example";
import { exampleChecks, exampleLevel, exampleSignals } from "@/lib/landing/example-report";

// The workflow as five tabs over the landing page's one example. Each stage
// says where its information comes from, because that is the difference
// between what GitHub reports, what is read from the repository, and what
// Impactlia computes. The tabs only change what is shown: nothing runs.

type Source = "GitHub" | "Repository" | "Computed";

const sourceText: Record<Source, string> = {
  GitHub: "Reported by GitHub",
  Repository: "Read from the repository",
  Computed: "Calculated by Impactlia",
};

const sourceTone: Record<Source, string> = {
  GitHub: "border-line text-muted",
  Repository: "border-accent/50 text-accent",
  Computed: "border-outgoing/50 text-outgoing",
};

const nameOf = new Map(exampleFiles.map((file) => [file.id, file.name]));

function Mono({ children }: { children: ReactNode }) {
  return <span className="font-mono text-[0.8125rem]">{children}</span>;
}

const stages: { title: string; source: Source; text: string; visual: ReactNode }[] = [
  {
    title: "Pull request",
    source: "GitHub",
    text: "It starts with a pull request on a public GitHub repository: its number, title, author, and the two commits it sits between.",
    visual: (
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2.5">
        <dt className="text-muted">Pull request</dt>
        <dd>
          <Mono>#{examplePullRequest.number}</Mono> {examplePullRequest.title}
        </dd>
        <dt className="text-muted">Into</dt>
        <dd>
          <Mono>{examplePullRequest.base}</Mono>
        </dd>
        <dt className="text-muted">From</dt>
        <dd>
          <Mono>{examplePullRequest.head}</Mono>
        </dd>
        <dt className="text-muted">Files changed</dt>
        <dd className="tabular-nums">{changedFiles.length}</dd>
      </dl>
    ),
  },
  {
    title: "Changed files",
    source: "GitHub",
    text: "GitHub lists the files the pull request changes and how. The analysis works per file, from these paths and statuses.",
    visual: (
      <ul className="space-y-2.5">
        {changedFiles.map((file) => {
          const diff = exampleDiff[file.id];
          return (
            <li key={file.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className={stateTone.changed}>
                <FileMark state="changed" />
              </span>
              <Mono>{file.id}</Mono>
              {diff && (
                <span className="ml-auto text-xs text-muted">
                  {diff.status} ·{" "}
                  <span className="text-positive tabular-nums">+{diff.added}</span>{" "}
                  <span className="text-critical tabular-nums">−{diff.removed}</span>
                </span>
              )}
            </li>
          );
        })}
      </ul>
    ),
  },
  {
    title: "Dependency relationships",
    source: "Repository",
    text: "The repository's source is parsed for imports, so every connection is one that is written in the code. One that cannot be resolved is reported, not guessed.",
    visual: (
      <ul className="space-y-2">
        {exampleEdges.map((edge) => (
          <li key={`${edge.source}>${edge.target}`} className="flex flex-wrap items-center gap-x-2">
            <Mono>{nameOf.get(edge.source)}</Mono>
            <span className="text-xs text-muted">imports</span>
            <Mono>{nameOf.get(edge.target)}</Mono>
          </li>
        ))}
        <li className="flex flex-wrap items-center gap-x-2 text-muted">
          <Mono>loader.ts</Mono>
          <span className="text-xs">imports a path built at runtime: unresolved</span>
        </li>
      </ul>
    ),
  },
  {
    title: "Potential impact",
    source: "Computed",
    text: "From each changed file, the import graph is followed outwards. Every file reached is potentially affected, and keeps the path that reached it.",
    visual: (
      <div className="space-y-4">
        {[1, 2].map((steps) => (
          <div key={steps}>
            <p className="text-xs text-muted">
              {steps === 1 ? "Imports a changed file directly" : "Two steps away"}
            </p>
            <ul className="mt-1.5 flex flex-wrap gap-1.5">
              {affectedFiles
                .filter((file) => file.steps === steps)
                .map((file) => (
                  <li
                    key={file.id}
                    className="inline-flex items-center gap-1.5 rounded-md border border-incoming/50 bg-incoming/10 px-2 py-0.5"
                  >
                    <span className={stateTone.affected}>
                      <FileMark state="affected" />
                    </span>
                    <Mono>{file.name}</Mono>
                  </li>
                ))}
            </ul>
          </div>
        ))}
        <p className="flex items-center gap-1.5 text-xs text-muted">
          <FileMark state="unreached" />
          session.ts is not reached, so it is not on the list.
        </p>
      </div>
    ),
  },
  {
    title: "Review and validation",
    source: "Computed",
    text: "The report gives a risk level with the signals behind it, and suggested checks that each name the fact they come from.",
    visual: (
      <div>
        <div className="flex items-center gap-3">
          <RiskBadge level={exampleLevel} />
          <span className="text-xs text-muted">
            from {exampleSignals.length} signals, highest wins
          </span>
        </div>
        <ul className="mt-4 space-y-2.5">
          {exampleChecks.map((check) => (
            <li key={check.file}>
              <p>{check.body}</p>
              <p className="text-xs text-muted">{check.reason}</p>
            </li>
          ))}
        </ul>
      </div>
    ),
  },
];

export function Walkthrough() {
  const [active, setActive] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const stage = stages[active];

  const go = (index: number, focus: boolean) => {
    const next = (index + stages.length) % stages.length;
    setActive(next);
    if (focus) tabs.current[next]?.focus();
  };

  // The usual tab keys: arrows move between tabs, Home and End jump.
  const onKeyDown = (event: KeyboardEvent) => {
    const moves: Record<string, number> = {
      ArrowRight: active + 1,
      ArrowDown: active + 1,
      ArrowLeft: active - 1,
      ArrowUp: active - 1,
      Home: 0,
      End: stages.length - 1,
    };
    const target = moves[event.key];
    if (target === undefined) return;
    event.preventDefault();
    go(target, true);
  };

  return (
    <div className="panel overflow-hidden">
      <div className="border-b border-line px-3 pt-3 sm:px-4">
        <div
          role="tablist"
          aria-label="Stages of an analysis"
          onKeyDown={onKeyDown}
          className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-3"
        >
          {stages.map((item, index) => (
            <button
              key={item.title}
              ref={(element) => {
                tabs.current[index] = element;
              }}
              id={`walkthrough-tab-${index}`}
              role="tab"
              type="button"
              aria-selected={index === active}
              aria-controls="walkthrough-panel"
              tabIndex={index === active ? 0 : -1}
              onClick={() => go(index, false)}
              className="flex shrink-0 cursor-pointer items-center gap-2 rounded-lg border border-transparent px-3 py-2 text-sm text-muted transition-colors duration-150 hover:bg-white/5 hover:text-ink aria-selected:border-line aria-selected:bg-white/5 aria-selected:text-ink"
            >
              <span
                className={`flex size-5 items-center justify-center rounded-full text-[0.6875rem] font-semibold tabular-nums transition-colors duration-200 ${
                  index <= active ? "bg-accent text-accent-ink" : "border border-line"
                }`}
              >
                {index + 1}
              </span>
              {item.title}
            </button>
          ))}
        </div>
        {/* How far along the story is. */}
        <div aria-hidden="true" className="-mx-3 h-0.5 bg-line sm:-mx-4">
          <div
            className="h-full bg-linear-to-r from-accent via-incoming to-outgoing transition-[width] duration-300 ease-out motion-reduce:transition-none"
            style={{ width: `${((active + 1) / stages.length) * 100}%` }}
          />
        </div>
      </div>

      <div
        id="walkthrough-panel"
        role="tabpanel"
        aria-labelledby={`walkthrough-tab-${active}`}
        className="grid gap-6 px-4 py-6 sm:px-6 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] md:gap-10"
      >
        <div key={`text-${active}`} className="impact-step">
          <p className="text-xs text-muted tabular-nums">
            Stage {active + 1} of {stages.length}
          </p>
          <h3 className="mt-1 text-xl font-semibold tracking-tight">{stage.title}</h3>
          <span
            className={`mt-3 inline-flex rounded-full border px-2.5 py-0.5 text-xs ${sourceTone[stage.source]}`}
          >
            {sourceText[stage.source]}
          </span>
          <p className="mt-4 text-muted">{stage.text}</p>
          <div className="mt-6 flex gap-2">
            <button
              type="button"
              onClick={() => go(active - 1, false)}
              disabled={active === 0}
              className="btn btn-secondary btn-small disabled:cursor-not-allowed disabled:opacity-40"
            >
              Back
            </button>
            <button
              type="button"
              onClick={() => go(active + 1, false)}
              disabled={active === stages.length - 1}
              className="btn btn-primary btn-small disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next stage
            </button>
          </div>
        </div>
        <div
          key={`visual-${active}`}
          className="impact-step rounded-xl border border-line bg-canvas/60 p-4 text-sm sm:p-5"
          style={{ animationDelay: "80ms" }}
        >
          {stage.visual}
        </div>
      </div>
      <p className="border-t border-line px-4 py-2.5 text-xs text-muted sm:px-6">
        Illustrative example. The same made-up pull request as the rest of this page.
      </p>
    </div>
  );
}
