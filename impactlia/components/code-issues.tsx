import { Risk } from "@/components/analysis-run-list";
import { repositoryUrl } from "@/lib/github/repository-url";
import {
  CODE_ISSUE_RULES,
  ISSUE_SCOPE,
  RELATED_FILE_LIMIT,
  SET_ASIDE_RULE,
} from "@/lib/impact/code-issues";
import type { CodeCheck, CodeIssue, RiskLevel } from "@/lib/impact/report";
import type { AnalysisRun } from "@/lib/impact/runs";

// The code issues of one stored analysis, and what the checks behind them
// covered. Kept apart from the impact sections above it: an issue is a
// problem a tool reported in the changed code, and the files listed with it
// import that code. Importing it is not evidence the issue reaches them.

const numberFormat = new Intl.NumberFormat("en");

const levelBorder: Record<RiskLevel, string> = {
  low: "border-l-positive",
  medium: "border-l-caution",
  high: "border-l-critical",
};

const statusLabels: Record<CodeIssue["status"], string> = { confirmed: "Confirmed" };
const sourceLabels: Record<CodeIssue["source"], string> = {
  compiler: "TypeScript compiler",
  "tree-sitter": "tree-sitter parser",
};

// The id an affected file's row carries in the report, so an issue can point
// at it.
export const affectedFileAnchor = (path: string) => `affected-file-${path}`;

// The file at the analysed commit, at the issue's line. A commit link never
// moves, so it shows exactly what was checked.
function locationUrl(run: AnalysisRun, issue: CodeIssue): string {
  const path = issue.path.split("/").map(encodeURIComponent).join("/");
  const lines =
    issue.endLine !== null && issue.endLine !== issue.startLine
      ? `#L${issue.startLine}-L${issue.endLine}`
      : `#L${issue.startLine}`;
  return `${repositoryUrl(run.repository)}/blob/${run.headSha}/${path}${lines}`;
}

function Location({ issue }: { issue: CodeIssue }) {
  return (
    <>
      {issue.path}:{issue.startLine}
      {issue.startColumn !== null && `:${issue.startColumn}`}
    </>
  );
}

function RelatedFiles({
  issue,
  changed,
  affected,
}: {
  issue: CodeIssue;
  changed: ReadonlySet<string>;
  affected: ReadonlySet<string>;
}) {
  if (issue.relatedFileCount === 0) {
    return (
      <p className="mt-3 text-muted">
        No file in the graph imports {issue.path}.
      </p>
    );
  }
  return (
    <div className="mt-3">
      <p className="text-muted">
        Imported directly by {numberFormat.format(issue.relatedFileCount)}{" "}
        {issue.relatedFileCount === 1 ? "file" : "files"}. They use the file this issue is in;
        whether the issue reaches them is not known.
      </p>
      <ul className="mt-2 space-y-1 font-mono text-[0.8125rem] break-all">
        {issue.relatedFiles.map((file) => (
          <li key={file.path} className="flex items-start gap-2">
            {changed.has(file.path) ? (
              <span aria-hidden="true" className="mt-1.5 size-2 shrink-0 rotate-45 bg-accent" />
            ) : (
              <span
                aria-hidden="true"
                className="mt-1.5 size-2 shrink-0 rounded-full border-[1.5px] border-incoming"
              />
            )}
            <span className="min-w-0">
              {affected.has(file.path) ? (
                <a href={`#${encodeURIComponent(affectedFileAnchor(file.path))}`} className="hover:underline">
                  {file.path}
                </a>
              ) : (
                file.path
              )}
              <span className="ml-2 font-sans text-xs text-muted">
                {changed.has(file.path) ? "changed, " : ""}
                {file.relationship}
                {file.typeOnly ? ", types only" : ""}
              </span>
            </span>
          </li>
        ))}
      </ul>
      {issue.relatedFileCount > issue.relatedFiles.length && (
        <p className="mt-1 text-xs text-muted">
          The first {RELATED_FILE_LIMIT} by path are listed.
        </p>
      )}
    </div>
  );
}

function Coverage({ check }: { check: CodeCheck }) {
  const setAside = check.setAside.reduce((sum, entry) => sum + entry.count, 0);
  return (
    <details className="mt-3 rounded-xl border border-line px-5 py-3 text-sm">
      <summary className="cursor-pointer font-medium">
        What was checked: {numberFormat.format(check.checked.length)} type-checked,{" "}
        {numberFormat.format(check.skipped.length)} not,{" "}
        {numberFormat.format(setAside)} {setAside === 1 ? "diagnostic" : "diagnostics"} set aside
      </summary>
      <p className="mt-3 max-w-prose">{ISSUE_SCOPE}</p>
      {check.checked.length > 0 && (
        <>
          <h3 className="mt-4 font-medium">Type-checked</h3>
          <ul className="mt-1 space-y-0.5 font-mono text-[0.8125rem] break-all text-muted">
            {check.checked.map((path) => (
              <li key={path}>{path}</li>
            ))}
          </ul>
        </>
      )}
      {check.skipped.length > 0 && (
        <>
          <h3 className="mt-4 font-medium">Not type-checked</h3>
          <ul className="mt-1 space-y-2">
            {check.skipped.map((entry) => (
              <li key={entry.path}>
                <p className="font-mono text-[0.8125rem] break-all">{entry.path}</p>
                <p className="text-muted">{entry.reason}</p>
              </li>
            ))}
          </ul>
        </>
      )}
      <h3 className="mt-4 font-medium">Set aside</h3>
      <p className="mt-1 max-w-prose text-muted">{SET_ASIDE_RULE}</p>
      {check.setAside.length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {check.setAside.map((entry) => (
            <li key={entry.ruleId}>
              <span className="font-mono text-[0.8125rem]">{entry.ruleId}</span>{" "}
              <span className="text-muted">
                {entry.reason}: {numberFormat.format(entry.count)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <h3 className="mt-4 font-medium">How severity is set</h3>
      <dl className="mt-1 space-y-2">
        {Object.values(CODE_ISSUE_RULES).map((rule) => (
          <div key={rule.label}>
            <dt className="font-medium">{rule.label}</dt>
            <dd className="text-muted">{rule.rule}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

export function CodeIssues({
  run,
  issues,
  check,
  changed,
  affected,
}: {
  run: AnalysisRun;
  issues: CodeIssue[];
  check: CodeCheck | null;
  changed: ReadonlySet<string>;
  affected: ReadonlySet<string>;
}) {
  if (check === null) {
    return (
      <p className="rounded-xl border border-dashed border-muted/50 px-5 py-4 text-sm text-muted">
        This analysis ran before Impactlia checked changed code, so nothing was checked. Re-analyze
        the pull request to check it.
      </p>
    );
  }
  return (
    <>
      {issues.length === 0 ? (
        <p className="rounded-xl border border-dashed border-muted/50 px-5 py-4 text-sm text-muted">
          {check.checked.length === 0
            ? "No changed file could be type-checked, so no type errors could be found. Syntax errors were still looked for. See below for why each file was not checked."
            : "No issues were found by the checks completed for this analysis. That does not mean the pull request is free of defects."}
        </p>
      ) : (
        <ul className="space-y-3">
          {issues.map((issue) => (
            <li
              key={`${issue.path}:${issue.startLine}:${issue.startColumn ?? 0}:${issue.message}`}
              className={`panel border-l-2 px-5 py-4 text-sm ${levelBorder[issue.severity]}`}
            >
              <p className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <span className="text-[0.9375rem] font-medium">
                  {issue.title}
                  {issue.ruleId && (
                    <span className="ml-2 font-mono text-[0.8125rem] font-normal text-muted">
                      {issue.ruleId}
                    </span>
                  )}
                </span>
                <span className="flex items-baseline gap-2 text-xs">
                  <span className="text-muted">Severity</span>
                  <Risk level={issue.severity} />
                </span>
              </p>
              <p className="mt-1 font-mono text-[0.8125rem] break-all">
                <a href={locationUrl(run, issue)} className="hover:underline">
                  <Location issue={issue} />
                </a>
              </p>
              <p className="mt-2 break-words">{issue.message}</p>
              <p className="mt-2 text-xs">
                <span className="rounded-full border border-line px-2 py-0.5">
                  {statusLabels[issue.status]}
                </span>{" "}
                <span className="text-muted">by the {sourceLabels[issue.source]}</span>
              </p>
              <p className="mt-2 text-muted">{issue.conditions}</p>
              <RelatedFiles issue={issue} changed={changed} affected={affected} />
            </li>
          ))}
        </ul>
      )}
      {check.omitted > 0 && (
        <p className="mt-2 text-sm text-muted">
          {numberFormat.format(check.omitted)} more issues were found and not stored. The first{" "}
          {numberFormat.format(issues.length)}, most severe first, are shown.
        </p>
      )}
      <Coverage check={check} />
    </>
  );
}
