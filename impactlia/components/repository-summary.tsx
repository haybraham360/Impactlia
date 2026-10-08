"use client";

import {
  Fact,
  Facts,
  FileRow,
  Gaps,
  LongRows,
  Note,
  Provenance,
  Rows,
  Section,
  numberFormat,
} from "@/components/detail-parts";
import type { GraphFile, GraphModel } from "@/lib/graph/model";
import type { Selection } from "@/lib/graph/selection";
import type { RepositoryOverview } from "@/lib/repository-overview";
import type { UnresolvedReason } from "@/parser/contract";

export const reasonLabel: Record<UnresolvedReason, string> = {
  "file-not-found": "File not found",
  "alias-target-not-found": "Alias target not found",
  "alias-not-configured": "No matching alias configured",
  "workspace-package-not-linked": "Workspace package not linked",
  "non-literal-specifier": "Import path is not a fixed string",
};

const plural = (count: number, one: string, many: string) =>
  `${numberFormat.format(count)} ${count === 1 ? one : many}`;

// The pane's resting state: what the parser established about the repository
// as a whole, shown whenever nothing is selected.
export function RepositorySummary({
  overview,
  model,
  fileById,
  onSelect,
}: {
  overview: RepositoryOverview;
  model: GraphModel;
  fileById: ReadonlyMap<string, GraphFile>;
  onSelect: (selection: Selection) => void;
}) {
  const noKnownDependents = overview.noKnownDependents.flatMap(
    (id) => fileById.get(id) ?? [],
  );
  const excluded = overview.excludedByRule.filter(
    (rule) => rule.files > 0 || rule.directories > 0,
  );

  return (
    <div className="text-sm">
      <div className="px-5 py-4">
        <p className="text-xs text-muted">Repository</p>
        <h2 className="mt-0.5 text-base font-semibold break-all">
          {overview.name ?? "Name not detected"}
        </h2>
        <p className="text-xs text-muted">
          {overview.name === null
            ? "The root package.json has no name."
            : "The name in the root package.json."}
        </p>
        <div className="mt-3">
          <Facts>
            <Fact label="Framework">{overview.framework ?? "Not detected"}</Fact>
            <Fact label="Source files">{numberFormat.format(overview.files)}</Fact>
            <Fact label="Dependencies between files">
              {numberFormat.format(overview.edges)}
            </Fact>
            {/* The parser contract carries no routes: no adapter identifies
                them yet, so there is nothing to count. */}
            <Fact label="Routes">Not detected</Fact>
          </Facts>
        </div>
      </div>

      <Section title="Most depended-on files">
        {overview.mostDependedOn.length === 0 ? (
          <Note>No file in the repository imports another.</Note>
        ) : (
          <>
            <p className="mb-2 text-muted">
              Ranked by how many files import them, shown beside each.
            </p>
            <Rows>
              {overview.mostDependedOn.flatMap(({ file: id, dependents }) => {
                const file = fileById.get(id);
                return file
                  ? [
                      <FileRow
                        key={id}
                        file={file}
                        note={numberFormat.format(dependents)}
                        onSelect={onSelect}
                      />,
                    ]
                  : [];
              })}
            </Rows>
          </>
        )}
      </Section>

      <Section title="Files with no known dependents" count={noKnownDependents.length}>
        {noKnownDependents.length === 0 ? (
          <Note>Every file is imported by at least one other.</Note>
        ) : (
          <>
            <p className="mb-2 text-muted">
              No import of these was found. That makes them places to start
              reading, not unused code: entry points, tests, scripts and files
              loaded by a tool all look the same here.
            </p>
            <LongRows
              rows={noKnownDependents.map((file) => (
                <FileRow key={file.id} file={file} onSelect={onSelect} />
              ))}
            />
          </>
        )}
      </Section>

      <Section title="What the parser could not cover">
        <Facts>
          <Fact label="Files parsed">
            {numberFormat.format(overview.files - overview.failedFiles)} of{" "}
            {numberFormat.format(overview.files)}
          </Fact>
          <Fact label="Unresolved imports">
            {numberFormat.format(overview.unresolvedReferences)}
          </Fact>
          {overview.unresolvedByReason.map(({ reason, count }) => (
            <div key={reason} className="flex justify-between gap-3 pl-3 text-muted">
              <dt>{reasonLabel[reason]}</dt>
              <dd className="tabular-nums">{numberFormat.format(count)}</dd>
            </div>
          ))}
          <Fact label="Imports of excluded files">
            {numberFormat.format(overview.excludedReferences)}
          </Fact>
        </Facts>
        {excluded.length > 0 && (
          <>
            <p className="mt-3 mb-1 text-muted">Left out before parsing</p>
            <ul className="space-y-1">
              {excluded.map((rule) => (
                <li key={rule.description} className="flex justify-between gap-3">
                  <span>{rule.description}</span>
                  <span className="shrink-0 text-right text-muted tabular-nums">
                    {[
                      rule.files > 0 && plural(rule.files, "file", "files"),
                      rule.directories > 0 &&
                        plural(rule.directories, "directory", "directories"),
                    ]
                      .filter(Boolean)
                      .join(", ")}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Section>

      <Gaps files={model.files} onSelect={onSelect} />
      <Provenance />
    </div>
  );
}
