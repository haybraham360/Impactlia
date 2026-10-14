import type { CSSProperties, ReactNode } from "react";
import { FileMark, stateTone } from "@/components/landing/file-mark";
import { ImpactMap } from "@/components/landing/impact-map";
import { RiskBadge } from "@/components/landing/risk-badge";
import {
  MAP_BUILD_MS,
  affectedFiles,
  changedFiles,
  exampleDiff,
  examplePullRequest,
  stateLabel,
  type FileState,
} from "@/lib/landing/example";
import { exampleChecks, exampleLevel, exampleSignals } from "@/lib/landing/example-report";

// The hero's story in three panels: a pull request is picked up, its changed
// files are traced through the import map, and a report comes out the other
// side. It plays once, in that order, and then stays still. Every element
// ends on its plain style, so with reduced motion the finished scene is all
// there is. Everything in it is the landing page's one made-up example.

const MAP_START = 800;
const MAPPED_AT = MAP_START + MAP_BUILD_MS;
const REPORT_AT = MAPPED_AT + 150;

const delay = (ms: number): CSSProperties => ({ animationDelay: `${ms}ms` });

const stages = [
  { label: "Pull request selected", at: 150 },
  { label: "Impact mapped", at: MAPPED_AT },
  { label: "Report ready", at: REPORT_AT + 300 },
];

function PanelTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex items-center gap-2 border-b border-line px-4 py-2.5 text-xs text-muted">
      <span className="font-medium tracking-wide uppercase">{children}</span>
      {aside && <span className="ml-auto">{aside}</span>}
    </div>
  );
}

function PullRequestGlyph() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="size-4 text-accent"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <circle cx="4" cy="3.5" r="1.75" />
      <circle cx="4" cy="12.5" r="1.75" />
      <circle cx="12" cy="12.5" r="1.75" />
      <path d="M4 5.25v5.5M12 10.75V7a2.5 2.5 0 0 0-2.5-2.5H7m1.5-2L7 4.5 8.5 6" />
    </svg>
  );
}

function PullRequestPanel() {
  return (
    <div className="panel impact-step overflow-hidden">
      <PanelTitle>Pull request</PanelTitle>
      <div className="px-4 py-3.5">
        <p className="flex items-center gap-2 text-sm">
          <PullRequestGlyph />
          <span className="font-mono text-[0.8125rem] text-muted">#{examplePullRequest.number}</span>
          <span className="font-medium">{examplePullRequest.title}</span>
        </p>
        <p className="mt-1.5 font-mono text-xs text-muted">
          {examplePullRequest.head} → {examplePullRequest.base}
        </p>
        <p className="mt-4 text-xs text-muted">{changedFiles.length} files changed</p>
        <ul className="mt-2 space-y-1.5 font-mono text-[0.8125rem]">
          {changedFiles.map((file, index) => {
            const diff = exampleDiff[file.id];
            return (
              <li
                key={file.id}
                className="impact-pulse -mx-2 flex items-center gap-2 rounded-md px-2 py-1"
                style={delay(350 + index * 150)}
              >
                <span className={stateTone.changed}>
                  <FileMark state="changed" />
                </span>
                <span className="truncate">{file.name}</span>
                {diff && (
                  <span className="ml-auto shrink-0 tabular-nums">
                    <span className="text-positive">+{diff.added}</span>{" "}
                    <span className="text-critical">−{diff.removed}</span>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function MapPanel() {
  const states: FileState[] = ["changed", "affected", "unreached"];
  return (
    <div className="panel impact-step overflow-hidden" style={delay(MAP_START - 200)}>
      <PanelTitle aside="Select a file">Dependency map</PanelTitle>
      <p className="sr-only">
        An example impact map. The pull request changes payment.ts and currency.ts.{" "}
        {affectedFiles.length} other files import them, directly or through another file, and are
        marked as potentially affected. One file, session.ts, is not reached.
      </p>
      <div className="px-2.5 pt-5 pb-3 sm:px-5">
        <ImpactMap startMs={MAP_START} />
      </div>
      <ul className="flex flex-wrap gap-x-5 gap-y-1 border-t border-line px-4 py-2.5 text-xs sm:px-5">
        {states.map((state) => (
          <li key={state} className="flex items-center gap-1.5">
            <span className={stateTone[state]}>
              <FileMark state={state} />
            </span>
            {stateLabel[state]}
          </li>
        ))}
        <li className="flex items-center gap-1.5">
          <svg
            aria-hidden="true"
            viewBox="0 0 20 8"
            className="h-2 w-5 text-incoming"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <path d="M0 4h18M14.5 1l3.5 3-3.5 3" />
          </svg>
          Is imported by
        </li>
      </ul>
    </div>
  );
}

function CheckMark() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="mt-0.5 size-4 shrink-0 text-outgoing"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <rect x="1.75" y="1.75" width="12.5" height="12.5" rx="3.5" />
      <path d="M5 8.25l2 2 4-4.5" />
    </svg>
  );
}

function ReportPanel() {
  const top = exampleSignals.find((signal) => signal.level === exampleLevel);
  return (
    <div className="panel impact-step overflow-hidden" style={delay(REPORT_AT)}>
      <PanelTitle>Impact report</PanelTitle>
      <div className="px-4 py-3.5 text-sm">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-muted">Risk level</span>
          <RiskBadge level={exampleLevel} />
        </div>
        {top && <p className="mt-1.5 text-xs text-muted">{top.fact}</p>}
        <dl className="mt-4 grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-line px-3 py-2">
            <dt className="text-xs text-muted">Changed</dt>
            <dd className="text-lg font-semibold tabular-nums">{changedFiles.length}</dd>
          </div>
          <div className="rounded-lg border border-line px-3 py-2">
            <dt className="text-xs text-muted">Potentially affected</dt>
            <dd className="text-lg font-semibold tabular-nums">{affectedFiles.length}</dd>
          </div>
        </dl>
        <p className="mt-4 text-xs text-muted">Suggested checks</p>
        <ul className="mt-2 space-y-2">
          {exampleChecks.map((check, index) => (
            <li
              key={check.file}
              className="impact-step flex gap-2 text-[0.8125rem] leading-5"
              style={delay(REPORT_AT + 300 + index * 150)}
            >
              <CheckMark />
              <span>{check.body}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// Drawn between the panels on wide screens: the way the story travels.
function Connector({ at, vertical = false }: { at: number; vertical?: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox={vertical ? "0 0 12 32" : "0 0 40 12"}
      className={vertical ? "mx-auto h-8 w-3 text-edge" : "h-3 w-10 text-edge"}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <path
        className="impact-edge"
        pathLength={1}
        style={delay(at)}
        d={vertical ? "M6 0V29M2 25l4 4 4-4" : "M0 6H37M33 2l4 4-4 4"}
      />
    </svg>
  );
}

export function ChangeImpactScene() {
  return (
    <figure data-reveal="sequence" aria-labelledby="scene-caption">
      <div className="mb-4 flex flex-wrap items-center justify-center gap-x-2 gap-y-2 text-xs">
        <ol className="flex flex-wrap items-center justify-center gap-x-2 gap-y-2">
          {stages.map((stage, index) => (
            <li key={stage.label} className="flex items-center gap-2">
              {index > 0 && (
                <span aria-hidden="true" className="h-px w-4 bg-line sm:w-6" />
              )}
              <span
                className="impact-stage flex items-center gap-1.5 rounded-full border border-accent/40 bg-accent/10 px-2.5 py-1 text-ink"
                style={delay(stage.at)}
              >
                <span aria-hidden="true" className="size-1.5 rounded-full bg-accent" />
                {stage.label}
              </span>
            </li>
          ))}
        </ol>
        <span className="rounded-full border border-dashed border-muted/60 px-2.5 py-1 text-muted">
          Illustrative example
        </span>
      </div>

      <div className="mx-auto grid max-w-[522px] items-center gap-0 xl:max-w-none xl:grid-cols-[17rem_2.5rem_522px_2.5rem_17rem] xl:justify-center">
        <PullRequestPanel />
        <span className="py-1 xl:hidden">
          <Connector vertical at={MAP_START - 200} />
        </span>
        <span className="hidden justify-center xl:flex">
          <Connector at={MAP_START - 200} />
        </span>
        <MapPanel />
        <span className="py-1 xl:hidden">
          <Connector vertical at={REPORT_AT - 100} />
        </span>
        <span className="hidden justify-center xl:flex">
          <Connector at={REPORT_AT - 100} />
        </span>
        <ReportPanel />
      </div>

      <figcaption id="scene-caption" className="mt-4 text-center text-xs text-muted">
        An illustration with made-up files, not an analysis of a real repository.
      </figcaption>
    </figure>
  );
}
