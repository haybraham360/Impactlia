import { Impact, InsufficientEvidence, Risk, RiskScore } from "@/components/analysis-run-list";
import { CodeIssues, affectedFileAnchor } from "@/components/code-issues";
import { RiskAssessmentDetail } from "@/components/risk-assessment";
import { TestRecommendations } from "@/components/test-recommendations";
import type { ReactNode } from "react";
import {
  CAPABILITY_LEVELS,
  describeLanguage,
  type CapabilityLevel,
} from "@/parser/languages/registry";
import type { RiskLevel } from "@/lib/impact/report";
import { IMPACT_DEPTH, SIGNALS } from "@/lib/impact/risk";
import {
  AFFECTED_FILE_LIMIT,
  CHANGED_FILE_LIMIT,
  type AnalysisRun,
  type StoredAffectedFile,
  type StoredChangedFile,
  type StoredReport,
} from "@/lib/impact/runs";
import { SIGNAL_IDS, type SignalId } from "@/lib/impact/report";

// The stored report of one completed analysis. Everything here was read from
// the database: nothing is recalculated, so the page shows the same thing
// every time it is opened.
//
// Three things are kept visibly apart throughout: what the pull request
// changed (a fact from GitHub), what it could affect (files reached through
// real imports), and what is suggested (recommendations and test scenarios,
// never results).

const numberFormat = new Intl.NumberFormat("en");

const changeLabels: Record<StoredChangedFile["changeType"], string> = {
  added: "Added",
  modified: "Modified",
  removed: "Removed",
  renamed: "Renamed",
};

const levelBorder: Record<RiskLevel, string> = {
  low: "border-l-positive",
  medium: "border-l-caution",
  high: "border-l-critical",
};

const isSignal = (id: string): id is SignalId => SIGNAL_IDS.some((known) => known === id);

function Section({
  id,
  title,
  note,
  children,
}: {
  id: string;
  title: string;
  note?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="mt-10 scroll-mt-20">
      <h2 id={`${id}-heading`} className="text-lg font-semibold">
        {title}
      </h2>
      {note && <p className="mt-1 max-w-prose text-sm text-muted">{note}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Paths({ paths }: { paths: string[] }) {
  if (paths.length === 0) return null;
  return (
    <ul className="mt-2 space-y-0.5 font-mono text-[0.8125rem] break-all text-muted">
      {paths.map((path) => (
        <li key={path}>{path}</li>
      ))}
    </ul>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed border-muted/50 px-5 py-4 text-sm text-muted">
      {children}
    </p>
  );
}

function ChangedFiles({ files, total }: { files: StoredChangedFile[]; total: number }) {
  if (files.length === 0) {
    return <Empty>GitHub lists no changed files for this pull request.</Empty>;
  }
  return (
    <>
      <div className="panel overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-canvas/60 text-xs text-muted">
            <tr>
              <th scope="col" className="py-2.5 pr-6 pl-5 font-medium">File</th>
              <th scope="col" className="py-2.5 pr-6 font-medium">Change</th>
              <th scope="col" className="py-2.5 pr-6 font-medium">Lines</th>
              <th scope="col" className="py-2.5 pr-5 font-medium">In the graph</th>
            </tr>
          </thead>
          <tbody>
            {files.map((file) => (
              <tr key={file.path} className="border-t border-line align-top">
                <td className="py-3 pr-6 pl-5 font-mono text-[0.8125rem] break-all">
                  <ChangedMark />
                  {file.path}
                  {file.previousPath && (
                    <span className="block text-muted">was {file.previousPath}</span>
                  )}
                </td>
                <td className="py-3 pr-6 whitespace-nowrap">{changeLabels[file.changeType]}</td>
                <td className="py-3 pr-6 font-mono text-[0.8125rem] whitespace-nowrap tabular-nums">
                  +{numberFormat.format(file.additions)} −{numberFormat.format(file.deletions)}
                  {!file.patchAvailable && file.additions + file.deletions > 0 && (
                    <span className="block font-sans text-xs text-muted">no patch from GitHub</span>
                  )}
                </td>
                <td className="max-w-sm py-3 pr-5">
                  {file.analysed ? (
                    <span>Yes: what imports it was traced</span>
                  ) : (
                    <span className="font-medium text-caution">Not analysed</span>
                  )}
                  {file.stateReason && (
                    <span className="mt-0.5 block text-muted">{file.stateReason}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {total > files.length && (
        <p className="mt-2 text-sm text-muted">
          Showing the first {numberFormat.format(files.length)} of{" "}
          {numberFormat.format(total)} changed files, in path order. The page reads at most{" "}
          {numberFormat.format(CHANGED_FILE_LIMIT)}; all of them are stored and were analysed.
        </p>
      )}
    </>
  );
}

// The two file marks used across the product: solid for a file the pull
// request changed (a fact), a ring for one that imports changed code (a
// possibility). Shape as well as colour.
function ChangedMark() {
  return (
    <span
      aria-hidden="true"
      className="mr-2 inline-block size-2 rotate-45 bg-accent align-[0.05em]"
    />
  );
}

function AffectedMark() {
  return (
    <span
      aria-hidden="true"
      className="inline-block size-2 shrink-0 rounded-full border-[1.5px] border-incoming"
    />
  );
}

// The chain as stored: it starts at a changed file, and each file after it
// imports the one before. Drawn as a rail so the direction reads at a glance.
function Chain({ file }: { file: StoredAffectedFile }) {
  const [origin, ...rest] = file.dependencyPath;
  return (
    <div className="border-t border-line bg-canvas/40 px-5 py-4 text-sm">
      <p className="text-muted">Why it is here: a chain of imports that leads to a changed file.</p>
      <ol className="mt-3 font-mono text-[0.8125rem] break-all">
        <li className="relative flex items-start gap-3 pb-3">
          <span aria-hidden="true" className="absolute top-3 bottom-0 left-[0.2rem] w-px bg-incoming/50" />
          <span aria-hidden="true" className="mt-1.5 size-2 shrink-0 rotate-45 bg-accent" />
          <span>
            <span className="mr-2 rounded bg-accent px-1.5 py-0.5 font-sans text-xs text-accent-ink">
              changed
            </span>
            {origin}
          </span>
        </li>
        {rest.map((step, index) => (
          <li key={step} className="relative flex items-start gap-3 pb-3 last:pb-0">
            {index < rest.length - 1 && (
              <span aria-hidden="true" className="absolute top-3 bottom-0 left-[0.2rem] w-px bg-incoming/50" />
            )}
            <span className="mt-1.5 flex">
              <AffectedMark />
            </span>
            <span>
              <span className="mr-2 font-sans text-muted">is imported by</span>
              {step}
            </span>
          </li>
        ))}
      </ol>
      {file.routeCount > 1 && (
        <p className="mt-3 text-muted">
          This is one shortest chain. {file.routeCount} files one step closer to the change are
          imported by this file, so there are other chains of the same length.
        </p>
      )}
    </div>
  );
}

function AffectedFiles({ files, total }: { files: StoredAffectedFile[]; total: number }) {
  if (total === 0) {
    return (
      <Empty>
        No file in the graph imports a changed file, directly or through other files. That is
        a statement about the imports that could be resolved, not a guarantee that nothing
        else is affected.
      </Empty>
    );
  }
  const depths = [...new Set(files.map((file) => file.impactDepth))];
  return (
    <>
      {depths.map((depth) => {
        const atDepth = files.filter((file) => file.impactDepth === depth);
        return (
          <div key={depth} className="mb-4">
            <h3 className="mb-2 text-sm font-medium">
              {depth === 1
                ? "Imports a changed file directly"
                : `${depth} imports away from a changed file`}
              <span className="ml-2 font-normal text-muted tabular-nums">{atDepth.length}</span>
            </h3>
            <ul className="panel overflow-hidden">
              {atDepth.map((file) => (
                <li
                  key={file.path}
                  id={affectedFileAnchor(file.path)}
                  className="scroll-mt-28 border-t border-line first:border-t-0 target:bg-hover"
                >
                  <details className="group">
                    <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-2.5 font-mono text-[0.8125rem] break-all transition-colors duration-150 hover:bg-hover group-open:bg-hover [&::-webkit-details-marker]:hidden">
                      <AffectedMark />
                      <span className="min-w-0 flex-1">{file.path}</span>
                      <span className="shrink-0 font-sans text-xs text-muted">
                        <span className="group-open:hidden">Show chain</span>
                        <span className="hidden group-open:inline">Hide chain</span>
                      </span>
                    </summary>
                    <Chain file={file} />
                  </details>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      {total > files.length && (
        <p className="mt-2 text-sm text-muted">
          Showing the nearest {numberFormat.format(files.length)} of {numberFormat.format(total)}{" "}
          potentially affected files. The page reads at most{" "}
          {numberFormat.format(AFFECTED_FILE_LIMIT)}; all of them are stored and counted.
        </p>
      )}
    </>
  );
}

// The report's sections in reading order, kept in view under the top bar so
// any part of a long report is one step away. Counts are the report's own.
// What was read and how far each language is understood, kept folded away:
// it explains the report rather than adding to it.
function HowAnalysed({ report }: { report: StoredReport }) {
  const selective = report.limitations.some((limitation) => limitation.id === "selective-analysis");
  const groups = new Map<string, { capability: CapabilityLevel | null; files: number; analysed: number }>();
  for (const file of report.changed) {
    const language = describeLanguage(file.path);
    const label = language?.label ?? "Other files";
    const group = groups.get(label) ?? { capability: language?.capability ?? null, files: 0, analysed: 0 };
    group.files += 1;
    if (file.analysed) group.analysed += 1;
    groups.set(label, group);
  }
  const rows = [...groups].sort((a, b) => b[1].files - a[1].files || (a[0] < b[0] ? -1 : 1));
  return (
    <details className="mb-5 rounded-xl border border-line px-5 py-3 text-sm">
      <summary className="cursor-pointer font-medium">How this was analysed</summary>
      <div className="mt-3 space-y-3">
        <p className="max-w-prose text-muted">
          {selective
            ? "The repository's stored analysis was updated with the files that changed since it, which were downloaded one by one. The limitation below says exactly what was read."
            : "The pull request's head commit was downloaded and every source file in it read."}
        </p>
        {rows.length > 0 && (
          <div className="overflow-x-auto">
          <table className="w-full max-w-xl text-left">
            <thead className="text-xs text-muted">
              <tr>
                <th className="py-1 font-normal">Changed files</th>
                <th className="py-1 text-right font-normal">Files</th>
                <th className="py-1 text-right font-normal">In the graph</th>
                <th className="py-1 pl-4 font-normal">What is understood</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([label, group]) => (
                <tr key={label} className="border-t border-line">
                  <td className="py-1.5">{label}</td>
                  <td className="py-1.5 text-right tabular-nums">{numberFormat.format(group.files)}</td>
                  <td className="py-1.5 text-right tabular-nums">{numberFormat.format(group.analysed)}</td>
                  <td
                    className="py-1.5 pl-4 text-muted"
                    title={group.capability ? CAPABILITY_LEVELS[group.capability].rule : undefined}
                  >
                    {group.capability ? CAPABILITY_LEVELS[group.capability].label : "Not a recognised language"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
        <p className="max-w-prose text-xs text-muted">
          {Object.values(CAPABILITY_LEVELS)
            .map((level) => `${level.label}: ${level.rule}`)
            .join(" ")}
        </p>
      </div>
    </details>
  );
}

function ReportNav({ items }: { items: { href: string; label: ReactNode; count: number }[] }) {
  return (
    <nav
      aria-label="Report sections"
      className="sticky top-14 z-10 -mx-4 mt-6 border-b border-line bg-canvas/85 px-4 py-2 backdrop-blur-md sm:-mx-6 sm:px-6 md:-mx-10 md:px-10"
    >
      <ul className="-mx-1 flex gap-1 overflow-x-auto px-1 text-xs">
        {items.map((item) => (
          <li key={item.href} className="shrink-0">
            <a
              href={item.href}
              className="flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-muted transition-colors duration-150 hover:bg-hover hover:text-ink"
            >
              {item.label}
              <span className="rounded-full bg-hover px-1.5 font-mono text-[0.6875rem] text-ink tabular-nums">
                {numberFormat.format(item.count)}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function ImpactReport({ run, report }: { run: AnalysisRun; report: StoredReport }) {
  const changedTotal = run.changedFileCount ?? report.changed.length;
  const affectedTotal = run.affectedFileCount ?? report.affected.length;
  const unanalysed = report.changed.filter((file) => !file.analysed);
  const { risk } = run;

  return (
    <>
      <section aria-label="Summary" className="panel relative mt-6 overflow-hidden">
        <div aria-hidden="true" className="panel-glow pointer-events-none absolute inset-0" />
        <dl className="relative grid gap-x-10 gap-y-5 px-5 py-5 text-sm sm:grid-cols-[auto_1fr] sm:px-6">
          <div>
            <dt className="mb-1.5 text-xs text-muted">Risk</dt>
            <dd className="text-lg">
              {risk?.kind === "score" ? (
                <a href="#risk" className="hover:underline">
                  <RiskScore score={risk.score} level={risk.level} confidence={risk.confidence} />
                </a>
              ) : risk?.kind === "label" ? (
                <Risk level={risk.level} />
              ) : (
                <InsufficientEvidence />
              )}
            </dd>
          </div>
          <div>
            <dt className="mb-1.5 text-xs text-muted">Impact</dt>
            <dd>
              <Impact changed={changedTotal} affected={affectedTotal} />
            </dd>
          </div>
        </dl>
        {/* What could not be established, up front rather than only at the
            bottom of the page. */}
        {(unanalysed.length > 0 || report.limitations.length > 0) && (
          <p className="relative flex flex-wrap gap-2 border-t border-line px-5 py-3 text-xs sm:px-6">
            {unanalysed.length > 0 && (
              <a
                href="#not-analysed"
                className="rounded-full border border-caution/50 bg-caution/10 px-2.5 py-1 text-caution hover:underline"
              >
                {numberFormat.format(unanalysed.length)} changed{" "}
                {unanalysed.length === 1 ? "file" : "files"} not analysed
              </a>
            )}
            {report.limitations.length > 0 && (
              <a
                href="#coverage"
                className="rounded-full border border-caution/50 bg-caution/10 px-2.5 py-1 text-caution hover:underline"
              >
                {numberFormat.format(report.limitations.length)}{" "}
                {report.limitations.length === 1 ? "limitation" : "limitations"} recorded
              </a>
            )}
          </p>
        )}
        <p className="relative border-t border-line px-5 py-3 text-sm text-muted sm:px-6">
          {risk?.kind === "score"
            ? `${report.risk?.summary ?? ""} The score is a way to decide what to look at first, added up from documented factors. It is not calibrated against real outcomes, and a low score does not mean the change is safe.`
            : risk?.kind === "label"
              ? "The label is a way to decide what to look at first, worked out from the signals below by fixed rules. It is not a measured probability that anything breaks."
              : "No changed file could be matched to the graph, so there was nothing to measure and no score is given. That is not the same as low risk."}{" "}
          A file that could be affected is one that imports changed code. It is not known to be
          broken, and Impactlia has run no tests.
        </p>
      </section>

      <ReportNav
        items={[
          {
            href: "#risk",
            label: "Risk score",
            count: report.risk?.factors.filter((factor) => (factor.contribution ?? 0) > 0).length ?? 0,
          },
          { href: "#signals", label: "Risk signals", count: report.signals.length },
          { href: "#changed", label: "Changed", count: changedTotal },
          { href: "#affected", label: "Potentially affected", count: affectedTotal },
          { href: "#code-issues", label: "Code issues", count: report.codeIssues.length },
          { href: "#tests", label: "Recommended tests", count: report.testRecommendations.length },
          { href: "#not-analysed", label: "Not analysed", count: unanalysed.length },
          { href: "#coverage", label: "Limitations", count: report.limitations.length },
          { href: "#checks", label: "Suggested checks", count: report.recommendations.length },
        ]}
      />

      <Section
        id="risk"
        title="Risk score"
        note="Each factor that added points, with the measurements behind it, then the factors that added none. A factor that could not be measured adds nothing."
      >
        <RiskAssessmentDetail risk={report.risk} />
      </Section>

      <Section
        id="signals"
        title="Risk signals"
        note="Each signal is a rule that was triggered, with the measurements that triggered it."
      >
        {report.signals.length === 0 ? (
          <Empty>
            No rule was triggered: nothing in the graph imports the changed files, and no part
            of the change went unanalysed.
          </Empty>
        ) : (
          <ul className="space-y-3">
            {report.signals.map((signal) => (
              <li
                key={signal.signal}
                className={`panel border-l-2 px-5 py-4 text-sm ${levelBorder[signal.level]}`}
              >
                <p className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <span className="text-[0.9375rem] font-medium">
                    {isSignal(signal.signal) ? SIGNALS[signal.signal].label : signal.signal}
                  </span>
                  <Risk level={signal.level} />
                </p>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {signal.detail.facts.map((fact) => (
                    <li key={fact} className="break-words">{fact}</li>
                  ))}
                </ul>
                <p className="mt-3 text-muted">
                  <span className="font-medium">Rule.</span> {signal.detail.rule}
                </p>
              </li>
            ))}
          </ul>
        )}
        <details className="mt-3 rounded-xl border border-line px-5 py-3 text-sm">
          <summary className="cursor-pointer font-medium">How each signal is decided</summary>
          <dl className="mt-3 space-y-3">
            {SIGNAL_IDS.map((id) => (
              <div key={id}>
                <dt className="font-medium">{SIGNALS[id].label}</dt>
                <dd className="text-muted">{SIGNALS[id].rule}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 max-w-prose text-muted">
            The analysis is per file: any change to a file counts for the whole file. Only
            static imports the parser resolved are followed, up to {IMPACT_DEPTH} imports out.
            Relationships that exist only at runtime are not seen.
          </p>
        </details>
      </Section>

      <Section
        id="changed"
        title={`Changed files (${numberFormat.format(changedTotal)})`}
        note="The files in the pull request’s diff, as GitHub lists them."
      >
        <ChangedFiles files={report.changed} total={changedTotal} />
      </Section>

      <Section
        id="affected"
        title={`Potentially affected files (${numberFormat.format(affectedTotal)})`}
        note="Files that import a changed file, directly or through other files. Each is counted once, at its shortest distance. Open one to see the chain of imports that puts it here."
      >
        <AffectedFiles files={report.affected} total={affectedTotal} />
      </Section>

      <Section
        id="code-issues"
        title={`Code issues (${numberFormat.format(report.codeIssues.length)})`}
        note="Problems the TypeScript compiler reported at lines this pull request adds. Each comes from a tool, not from AI, and lists the files that import the code it is in."
      >
        <CodeIssues
          run={run}
          issues={report.codeIssues}
          check={report.codeCheck}
          changed={new Set(report.changed.map((file) => file.path))}
          affected={new Set(report.affected.map((file) => file.path))}
        />
      </Section>

      <Section
        id="tests"
        title={`Recommended tests (${numberFormat.format(report.testRecommendations.length)})`}
        note="Existing tests tied to the change through real imports, scenarios inferred from the lines it adds, and changed files no test was found for. Impactlia has run none of them."
      >
        <TestRecommendations
          run={run}
          recommendations={report.testRecommendations}
          discovery={report.testDiscovery}
          affected={new Set(report.affected.map((file) => file.path))}
        />
      </Section>

      <Section
        id="not-analysed"
        title={`Not analysed (${numberFormat.format(unanalysed.length)})`}
        note="Changed files Impactlia could not place in the graph. Nothing is claimed about what depends on them."
      >
        {unanalysed.length === 0 ? (
          <Empty>Every changed file shown above is in the graph.</Empty>
        ) : (
          <ul className="panel overflow-hidden text-sm">
            {unanalysed.map((file) => (
              <li key={file.path} className="border-t border-line px-5 py-3 first:border-t-0">
                <p className="font-mono text-[0.8125rem] break-all">{file.path}</p>
                <p className="mt-0.5 text-muted">{file.stateReason}</p>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        id="coverage"
        title="Coverage and limitations"
        note="What this analysis could not establish. A dependency that runs through one of these is missing from the report."
      >
        <HowAnalysed report={report} />
        {report.limitations.length === 0 ? (
          <Empty>
            None were recorded for this run. The graph still covers only static imports the
            parser could resolve.
          </Empty>
        ) : (
          <ul className="space-y-3">
            {report.limitations.map((limitation) => (
              <li
                key={limitation.id}
                className="border-l-2 border-caution pl-4 text-sm"
              >
                <p className="max-w-prose">{limitation.detail}</p>
                <Paths paths={limitation.files} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        id="checks"
        title="Suggested checks"
        note="Recommendations worked out from the report above. Impactlia has not run any of them and has collected no test results."
      >
        {report.recommendations.length === 0 ? (
          <Empty>Nothing in this report leads to a specific check.</Empty>
        ) : (
          <ol className="space-y-3">
            {report.recommendations.map((recommendation, index) => (
              <li
                key={recommendation.body}
                className="panel flex gap-3 px-5 py-4 text-sm"
              >
                <span className="grid size-7 shrink-0 place-items-center rounded-lg border border-outgoing/50 bg-outgoing/10 font-mono text-xs text-outgoing">
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <p className="text-[0.9375rem] font-medium">{recommendation.body}</p>
                  {recommendation.reason && (
                    <p className="mt-1 break-words text-muted">
                      <span className="font-medium">Why.</span> {recommendation.reason}
                    </p>
                  )}
                  {recommendation.origin === "ai" && (
                    <p className="mt-1 text-xs text-muted">Written by AI, not computed.</p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
      </Section>
    </>
  );
}
