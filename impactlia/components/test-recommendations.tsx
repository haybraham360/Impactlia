import { affectedFileAnchor } from "@/components/code-issues";
import { repositoryUrl } from "@/lib/github/repository-url";
import {
  TEST_RELATIONSHIPS,
  type Confidence,
  type FileReference,
  type Priority,
  type TestDiscovery,
  type TestRecommendation,
} from "@/lib/impact/report";
import type { AnalysisRun } from "@/lib/impact/runs";
import { RELATIONSHIP_LABELS, TEST_RULES } from "@/lib/impact/test-rules";

// The test recommendations of one stored analysis. Four kinds, kept visibly
// apart because they claim different things: an existing test is a file that
// exists, a scenario is a suggestion, an unknown is a search that found
// nothing, and the command is the repository's own. None of it was run.

const numberFormat = new Intl.NumberFormat("en");

const priorityLabels: Record<Priority, string> = {
  high: "High priority",
  medium: "Medium priority",
  low: "Low priority",
};
const priorityBorder: Record<Priority, string> = {
  high: "border-l-critical",
  medium: "border-l-caution",
  low: "border-l-line",
};
const confidenceTone: Record<Confidence, string> = {
  high: "border-positive/40 text-positive",
  medium: "border-caution/50 text-caution",
  low: "border-line text-muted",
};

// The file at the analysed commit. A commit link never moves, so it shows
// exactly what was read.
function fileUrl(run: AnalysisRun, reference: FileReference): string {
  const path = reference.path.split("/").map(encodeURIComponent).join("/");
  const lines =
    reference.startLine === null
      ? ""
      : reference.endLine !== null && reference.endLine !== reference.startLine
        ? `#L${reference.startLine}-L${reference.endLine}`
        : `#L${reference.startLine}`;
  return `${repositoryUrl(run.repository)}/blob/${run.headSha}/${path}${lines}`;
}

function Where({ run, reference }: { run: AnalysisRun; reference: FileReference }) {
  return (
    <a href={fileUrl(run, reference)} className="font-mono text-[0.8125rem] break-all hover:underline">
      {reference.path}
      {reference.startLine !== null &&
        (reference.endLine !== null && reference.endLine !== reference.startLine
          ? `:${reference.startLine}–${reference.endLine}`
          : `:${reference.startLine}`)}
    </a>
  );
}

function Tag({ children, tone = "border-line text-muted" }: { children: React.ReactNode; tone?: string }) {
  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs whitespace-nowrap ${tone}`}>{children}</span>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed border-muted/50 px-5 py-4 text-sm text-muted">
      {children}
    </p>
  );
}

function Evidence({ recommendation }: { recommendation: TestRecommendation }) {
  if (recommendation.evidence.length === 0) return null;
  return (
    <details className="group mt-2">
      <summary className="cursor-pointer text-xs text-muted hover:text-ink">
        <span className="group-open:hidden">Show evidence</span>
        <span className="hidden group-open:inline">Hide evidence</span>
      </summary>
      <ul className="mt-2 list-disc space-y-1 pl-5 break-words text-muted">
        {recommendation.evidence.map((fact) => (
          <li key={fact}>{fact}</li>
        ))}
      </ul>
    </details>
  );
}

function ExistingTests({
  run,
  tests,
  omitted,
  discovery,
  affected,
}: {
  run: AnalysisRun;
  tests: TestRecommendation[];
  omitted: number;
  discovery: TestDiscovery;
  affected: ReadonlySet<string>;
}) {
  if (tests.length === 0) {
    return (
      <Empty>
        No relevant tests were identified by this analysis.{" "}
        {discovery.testFileCount === 0
          ? "No file in the repository matched the rules for a test file."
          : `${numberFormat.format(discovery.testFileCount)} test ${discovery.testFileCount === 1 ? "file was" : "files were"} found in the repository; none imports the changed code or is named like it.`}
      </Empty>
    );
  }
  return (
    <>
      <ul className="panel overflow-hidden text-sm">
        {tests.map((test) => {
          const [file] = test.relatedTestFiles;
          return (
            <li key={test.title} className="border-t border-line px-5 py-3 first:border-t-0">
              <p className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                {file ? <Where run={run} reference={file} /> : <span className="font-mono text-[0.8125rem]">{test.title}</span>}
                <span className="flex flex-wrap gap-1.5">
                  {test.relationship && <Tag>{RELATIONSHIP_LABELS[test.relationship]}</Tag>}
                  <Tag tone={confidenceTone[test.confidence]}>{test.confidence} confidence</Tag>
                </span>
              </p>
              {test.relatedChangedFiles.length > 0 && (
                <p className="mt-1 text-muted">
                  Tied to{" "}
                  {test.relatedChangedFiles.map((reference, at) => (
                    <span key={reference.path}>
                      {at > 0 && ", "}
                      <Where run={run} reference={reference} />
                    </span>
                  ))}
                  {test.symbol && (
                    <>
                      {" "}
                      through <span className="font-mono text-[0.8125rem] text-ink">{test.symbol}</span>
                    </>
                  )}
                  {test.relationship === "imports-indirectly" && affected.has(test.title) && (
                    <>
                      {" · "}
                      <a href={`#${encodeURIComponent(affectedFileAnchor(test.title))}`} className="text-accent hover:underline">
                        see the import chain
                      </a>
                    </>
                  )}
                </p>
              )}
              <p className="mt-1">{test.rationale}</p>
              <Evidence recommendation={test} />
            </li>
          );
        })}
      </ul>
      {omitted > 0 && (
        <p className="mt-2 text-sm text-muted">
          {numberFormat.format(omitted)} more related tests were found and not stored; the strongest{" "}
          {numberFormat.format(tests.length)} are shown.
        </p>
      )}
    </>
  );
}

function Command({ command, discovery }: { command: TestRecommendation | undefined; discovery: TestDiscovery }) {
  if (!command?.command) return <Empty>{discovery.command.detail}</Empty>;
  return (
    <div className="panel px-5 py-4 text-sm">
      <p className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="text-[0.9375rem] font-medium">{command.title}</span>
        <Tag tone={confidenceTone[command.confidence]}>{command.confidence} confidence</Tag>
      </p>
      <pre className="mt-2 overflow-x-auto rounded-lg bg-canvas px-3 py-2 font-mono text-[0.8125rem]">
        <code>{command.command}</code>
      </pre>
      {command.workingDirectory && (
        <p className="mt-1 text-muted">
          In <span className="font-mono text-[0.8125rem]">{command.workingDirectory}</span>
        </p>
      )}
      <p className="mt-2 text-muted">{command.rationale}</p>
      <Evidence recommendation={command} />
    </div>
  );
}

function Scenarios({
  run,
  scenarios,
  omitted,
}: {
  run: AnalysisRun;
  scenarios: TestRecommendation[];
  omitted: number;
}) {
  if (scenarios.length === 0) {
    return (
      <Empty>
        No additional scenario could be grounded in the lines this pull request adds: none of the
        kinds of code scenarios are drawn from was found on them, or which lines changed could not
        be read.
      </Empty>
    );
  }
  const priorities = (["high", "medium", "low"] as const).filter((priority) =>
    scenarios.some((scenario) => scenario.priority === priority),
  );
  return (
    <>
      {priorities.map((priority) => (
        <div key={priority} className="mb-4">
          <h4 className="mb-2 text-sm font-medium">
            {priorityLabels[priority]}
            <span className="ml-2 font-normal text-muted tabular-nums">
              {scenarios.filter((scenario) => scenario.priority === priority).length}
            </span>
          </h4>
          <ul className="space-y-3">
            {scenarios
              .filter((scenario) => scenario.priority === priority)
              .map((scenario) => (
                <li
                  key={`${scenario.title}:${scenario.relatedChangedFiles[0]?.startLine ?? 0}`}
                  className={`panel border-l-2 px-5 py-4 text-sm ${priorityBorder[scenario.priority]}`}
                >
                  <p className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <span className="text-[0.9375rem] font-medium">{scenario.title}</span>
                    <span className="flex flex-wrap gap-1.5">
                      {scenario.riskAddressed && <Tag>{scenario.riskAddressed}</Tag>}
                      <Tag>suggested, not run</Tag>
                    </span>
                  </p>
                  {scenario.relatedChangedFiles.map((reference) => (
                    <p key={reference.path} className="mt-1">
                      <Where run={run} reference={reference} />
                    </p>
                  ))}
                  <p className="mt-2">{scenario.description}</p>
                  <p className="mt-1 text-muted">
                    <span className="font-medium">Why.</span> {scenario.rationale}
                  </p>
                  {scenario.relatedTestFiles.length > 0 && (
                    <p className="mt-1 text-muted">
                      Existing tests that import this file:{" "}
                      {scenario.relatedTestFiles.map((reference, at) => (
                        <span key={reference.path}>
                          {at > 0 && ", "}
                          <Where run={run} reference={{ ...reference, startLine: null, endLine: null }} />
                        </span>
                      ))}
                    </p>
                  )}
                  <Evidence recommendation={scenario} />
                </li>
              ))}
          </ul>
        </div>
      ))}
      {omitted > 0 && (
        <p className="mt-2 text-sm text-muted">
          {numberFormat.format(omitted)} more scenarios were found and left out to keep the list
          short; the highest-priority {numberFormat.format(scenarios.length)} are shown.
        </p>
      )}
    </>
  );
}

function Unknowns({
  run,
  unknowns,
  omitted,
}: {
  run: AnalysisRun;
  unknowns: TestRecommendation[];
  omitted: number;
}) {
  if (unknowns.length === 0) {
    return (
      <Empty>
        Every changed source file analysed is imported directly by at least one test file. That
        does not show the changed lines are tested.
      </Empty>
    );
  }
  return (
    <>
      <ul className="panel overflow-hidden text-sm">
        {unknowns.map((unknown) => (
          <li key={unknown.title} className="border-t border-line px-5 py-3 first:border-t-0">
            <p className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              {unknown.relatedChangedFiles[0] ? (
                <Where run={run} reference={unknown.relatedChangedFiles[0]} />
              ) : (
                <span>{unknown.title}</span>
              )}
              <span className="flex flex-wrap gap-1.5">
                <Tag>{priorityLabels[unknown.priority]}</Tag>
                <Tag>coverage unknown</Tag>
              </span>
            </p>
            <p className="mt-1">{unknown.description}</p>
            <p className="mt-1 text-muted">{unknown.rationale}</p>
            <Evidence recommendation={unknown} />
          </li>
        ))}
      </ul>
      {omitted > 0 && (
        <p className="mt-2 text-sm text-muted">
          {numberFormat.format(omitted)} more changed files had no test found; the highest-priority{" "}
          {numberFormat.format(unknowns.length)} are shown.
        </p>
      )}
    </>
  );
}

function Method({ discovery }: { discovery: TestDiscovery }) {
  return (
    <details className="mt-3 rounded-xl border border-line px-5 py-3 text-sm">
      <summary className="cursor-pointer font-medium">
        How tests were found: {numberFormat.format(discovery.testFileCount)} test{" "}
        {discovery.testFileCount === 1 ? "file" : "files"} in the repository
      </summary>
      <p className="mt-3 max-w-prose">{TEST_RULES.testFiles}</p>
      {discovery.conventions.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-muted">
          {discovery.conventions.map((convention) => (
            <li key={convention.rule}>
              {convention.rule} <span className="tabular-nums">{numberFormat.format(convention.count)}</span>
            </li>
          ))}
        </ul>
      )}
      {discovery.frameworks.length > 0 && (
        <p className="mt-2 text-muted">
          Test runners imported: <span className="font-mono text-[0.8125rem]">{discovery.frameworks.join(", ")}</span>
        </p>
      )}
      <h4 className="mt-4 font-medium">How a test is tied to the change</h4>
      <p className="mt-1 max-w-prose text-muted">{TEST_RULES.imports}</p>
      <dl className="mt-1 space-y-2">
        {TEST_RELATIONSHIPS.map((id) => (
          <div key={id}>
            <dt className="font-medium">{RELATIONSHIP_LABELS[id]}</dt>
            <dd className="text-muted">{TEST_RULES.relationships[id]}</dd>
          </div>
        ))}
      </dl>
      <h4 className="mt-4 font-medium">Scenarios</h4>
      <p className="mt-1 max-w-prose text-muted">{TEST_RULES.scenarios}</p>
      <h4 className="mt-4 font-medium">Coverage data</h4>
      <p className="mt-1 max-w-prose text-muted">{discovery.coverageData}</p>
      <h4 className="mt-4 font-medium">Test command</h4>
      <p className="mt-1 max-w-prose text-muted">{TEST_RULES.command}</p>
      {discovery.symbolsUnread.length > 0 && (
        <>
          <h4 className="mt-4 font-medium">Changed files whose declarations were not read</h4>
          <ul className="mt-1 space-y-2">
            {discovery.symbolsUnread.map((entry) => (
              <li key={entry.path}>
                <p className="font-mono text-[0.8125rem] break-all">{entry.path}</p>
                <p className="text-muted">{entry.reason}</p>
              </li>
            ))}
          </ul>
        </>
      )}
    </details>
  );
}

export function TestRecommendations({
  run,
  recommendations,
  discovery,
  affected,
}: {
  run: AnalysisRun;
  recommendations: TestRecommendation[];
  discovery: TestDiscovery | null;
  affected: ReadonlySet<string>;
}) {
  if (discovery === null) {
    return (
      <Empty>
        This analysis ran before Impactlia looked for related tests, so none were looked for.
        Re-analyze the pull request to get test recommendations.
      </Empty>
    );
  }
  const of = (kind: TestRecommendation["kind"]) =>
    recommendations.filter((recommendation) => recommendation.kind === kind);
  return (
    <>
      <h3 className="mb-2 text-sm font-medium">Existing tests</h3>
      <ExistingTests
        run={run}
        tests={of("existing_test")}
        omitted={discovery.omitted.existing}
        discovery={discovery}
        affected={affected}
      />

      <h3 className="mt-6 mb-2 text-sm font-medium">Test command</h3>
      <Command command={of("test_command")[0]} discovery={discovery} />

      <h3 className="mt-6 mb-2 text-sm font-medium">Suggested scenarios</h3>
      <Scenarios run={run} scenarios={of("suggested_scenario")} omitted={discovery.omitted.scenarios} />

      <h3 className="mt-6 mb-2 text-sm font-medium">Changed code with no test found</h3>
      <Unknowns run={run} unknowns={of("coverage_unknown")} omitted={discovery.omitted.coverageUnknown} />

      <Method discovery={discovery} />
    </>
  );
}
