import { COMMENT_MARKER } from "../github/managed-comment";
import type {
  Confidence,
  RiskScoreLevel,
  TestRecommendationKind,
} from "../impact/report";

// The pull request comment, written from a stored analysis. Pure: the same
// summary always gives the same text, and every case is checked in
// lib/automation/checks.
//
// Only what the analysis stored is shown. A section with nothing behind it is
// left out rather than filled in, a check that did not run says so, and
// nothing says the pull request is safe. Paths, titles and messages come from
// the repository, so each is escaped before it is written into Markdown.

export type CommentSummary =
  | {
      status: "failed";
      headSha: string;
      analysisUrl: string;
      // The analysis's own failure reason, already written for people.
      reason: string;
    }
  | {
      status: "completed";
      headSha: string;
      analysisUrl: string;
      changedFileCount: number;
      affectedFileCount: number;
      // The nearest affected files, at most AFFECTED_SHOWN.
      affected: { path: string; depth: number }[];
      // null on an analysis from before the code check existed.
      codeCheck: { checked: number; skipped: number } | null;
      codeIssues: { title: string; path: string; line: number }[];
      codeIssueCount: number;
      tests: { kind: TestRecommendationKind; title: string }[];
      testCount: number;
      // The analysis's deterministic review recommendations.
      areas: string[];
      // null on an analysis from before the score existed.
      risk: {
        score: number | null;
        level: RiskScoreLevel | null;
        confidence: Confidence;
        summary: string;
      } | null;
      limitations: string[];
    };

export const AFFECTED_SHOWN = 5;
export const ISSUES_SHOWN = 5;
export const TESTS_SHOWN = 5;
export const AREAS_SHOWN = 3;
export const LIMITATIONS_SHOWN = 3;
const TEXT_LENGTH = 300;
const PATH_LENGTH = 200;

const DISCLAIMER =
  "_Impactlia findings are advisory. A potentially affected file is not a confirmed bug, and this analysis does not guarantee that the pull request is safe._";

// Plain text from the repository, as one line of inert Markdown: no
// formatting, links, HTML, headings, tables or @mentions survive.
export function escapeText(value: string, maxLength = TEXT_LENGTH): string {
  const line = value.replace(/\s+/g, " ").trim();
  const short = line.length > maxLength ? `${line.slice(0, maxLength - 1)}…` : line;
  // Entities first, so no tag survives any Markdown renderer; then a
  // backslash before everything Markdown treats as syntax.
  return short
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/[\\`*_{}[\]()#+\-!|~]/g, (character) => `\\${character}`)
    // An invisible word joiner after @ keeps GitHub from notifying anyone.
    .replace(/@/g, "@\u2060");
}

// A path as inline code. Nothing inside a code span is formatted; a path
// containing backticks gets a longer fence so it cannot close the span.
export function codeSpan(value: string, maxLength = PATH_LENGTH): string {
  const line = value.replace(/\s+/g, " ").trim();
  const short = line.length > maxLength ? `${line.slice(0, maxLength - 1)}…` : line;
  const longestRun = Math.max(0, ...(short.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(longestRun + 1);
  const pad = longestRun > 0 ? " " : "";
  return `${fence}${pad}${short}${pad}${fence}`;
}

const SCORE_LEVELS: Record<RiskScoreLevel, string> = {
  low: "Low",
  moderate: "Moderate",
  high: "High",
  very_high: "Very high",
};

const TEST_LABELS: Record<TestRecommendationKind, string> = {
  existing_test: "Existing test",
  suggested_scenario: "Suggested",
  coverage_unknown: "No test found",
  test_command: "Command",
};

const numberFormat = new Intl.NumberFormat("en");
const plural = (count: number, one: string, many: string) =>
  `${numberFormat.format(count)} ${count === 1 ? one : many}`;

function more(shown: number, total: number): string[] {
  return total > shown ? [`- …and ${numberFormat.format(total - shown)} more in the full analysis.`] : [];
}

export function buildComment(summary: CommentSummary): string {
  const revision = codeSpan(summary.headSha.slice(0, 7));
  const header = [COMMENT_MARKER, "## Impactlia pull request analysis", ""];

  if (summary.status === "failed") {
    return [
      ...header,
      "**Analysis status:** Failed  ",
      `**Analyzed revision:** ${revision}`,
      "",
      `The analysis of this revision did not finish: ${escapeText(summary.reason, 500)}`,
      "",
      "No result is shown for this revision, and no earlier result applies to it.",
      "",
      `[View details in Impactlia](${summary.analysisUrl})`,
      "",
      DISCLAIMER,
    ].join("\n");
  }

  const partial = summary.limitations.length > 0;
  const lines = [
    ...header,
    `**Analysis status:** ${partial ? "Complete, with limitations (partial)" : "Complete"}  `,
    `**Analyzed revision:** ${revision}`,
    "",
    "### Change impact",
    `- **Changed files:** ${numberFormat.format(summary.changedFileCount)}`,
    `- **Potentially affected files:** ${numberFormat.format(summary.affectedFileCount)}, through imports found in the repository`,
  ];
  for (const file of summary.affected.slice(0, AFFECTED_SHOWN)) {
    const distance = file.depth === 1 ? "imports a changed file" : `${file.depth} imports away`;
    lines.push(`  - ${codeSpan(file.path)} (${distance})`);
  }
  if (summary.affectedFileCount > AFFECTED_SHOWN && summary.affected.length > 0) {
    lines.push(
      `  - …and ${numberFormat.format(summary.affectedFileCount - Math.min(summary.affected.length, AFFECTED_SHOWN))} more in the full analysis.`,
    );
  }

  lines.push("", "### Code issues");
  if (summary.codeCheck === null) {
    lines.push("The code check did not run for this analysis, so no issue is reported either way.");
  } else if (summary.codeIssueCount === 0) {
    const notChecked = summary.codeCheck.skipped > 0
      ? `; ${plural(summary.codeCheck.skipped, "changed file was", "changed files were")} not checked`
      : "";
    lines.push(
      `No confirmed issue was reported by the compiler on the lines this pull request adds (${plural(summary.codeCheck.checked, "changed file", "changed files")} type-checked${notChecked}). That is not proof there are none.`,
    );
  } else {
    for (const issue of summary.codeIssues.slice(0, ISSUES_SHOWN)) {
      lines.push(
        `- **Confirmed (compiler):** ${escapeText(issue.title)} in ${codeSpan(`${issue.path}:${issue.line}`)}`,
      );
    }
    lines.push(...more(Math.min(summary.codeIssues.length, ISSUES_SHOWN), summary.codeIssueCount));
  }

  if (summary.testCount > 0) {
    lines.push("", "### Recommended tests");
    for (const test of summary.tests.slice(0, TESTS_SHOWN)) {
      lines.push(`- **${TEST_LABELS[test.kind]}:** ${escapeText(test.title)}`);
    }
    lines.push(...more(Math.min(summary.tests.length, TESTS_SHOWN), summary.testCount));
    lines.push("", "No test was run by Impactlia.");
  }

  if (summary.areas.length > 0) {
    lines.push("", "### Areas to review");
    for (const area of summary.areas.slice(0, AREAS_SHOWN)) lines.push(`- ${escapeText(area)}`);
    lines.push(...more(Math.min(summary.areas.length, AREAS_SHOWN), summary.areas.length));
  }

  if (summary.risk !== null) {
    lines.push("", "### Review attention");
    const { score, level, confidence, summary: reason } = summary.risk;
    const verdict =
      score !== null && level !== null
        ? `**Risk: ${SCORE_LEVELS[level]}** (${score}/100, ${confidence} confidence)`
        : "**Risk: Insufficient evidence**";
    lines.push(`${verdict} — ${escapeText(reason, 500)}`);
  }

  if (partial) {
    lines.push("", "### Limitations");
    for (const detail of summary.limitations.slice(0, LIMITATIONS_SHOWN)) {
      lines.push(`- ${escapeText(detail)}`);
    }
    lines.push(...more(Math.min(summary.limitations.length, LIMITATIONS_SHOWN), summary.limitations.length));
  }

  lines.push("", `[View the full analysis in Impactlia](${summary.analysisUrl})`, "", DISCLAIMER);
  return lines.join("\n");
}
