"use client";

import { useMemo, useState } from "react";
import {
  Fact,
  Facts,
  FileRow,
  FolderRow,
  Gaps,
  Note,
  Provenance,
  Rows,
  Section,
  folderPath,
  numberFormat,
} from "@/components/detail-parts";
import { RepositorySummary, reasonLabel } from "@/components/repository-summary";
import type { GraphEdge, GraphFile, GraphFolder, GraphModel } from "@/lib/graph/model";
import type { Relations, Selection } from "@/lib/graph/selection";
import { countBy, type RepositoryOverview } from "@/lib/repository-overview";

type Tab = "structure" | "explanation";

const tabs: { id: Tab; label: string }[] = [
  { id: "structure", label: "Structure" },
  { id: "explanation", label: "Explanation" },
];

type Select = (selection: Selection) => void;

function FileStructure({
  file,
  relations,
  fileById,
  onSelect,
}: {
  file: GraphFile;
  relations: Relations;
  fileById: ReadonlyMap<string, GraphFile>;
  onSelect: Select;
}) {
  const failed = file.parseStatus === "failed";
  const rows = (edges: GraphEdge[], end: "source" | "target") =>
    edges.flatMap((edge) => {
      const other = fileById.get(edge[end]);
      return other
        ? [
            <FileRow
              key={other.id}
              file={other}
              direction={end === "source" ? "incoming" : "outgoing"}
              note={edge.typeOnly ? "types only" : undefined}
              onSelect={onSelect}
            />,
          ]
        : [];
    });

  return (
    <>
      <div className="px-5 py-4">
        <Facts>
          <Fact label="Type">
            <span className="font-mono text-[0.8125rem]">{file.type}</span>
          </Fact>
          <Fact label="Lines">{numberFormat.format(file.lineCount)}</Fact>
          <Fact label="Parse status">
            {failed ? <span className="text-critical">Could not be parsed</span> : "Parsed"}
          </Fact>
          {/* Always shown, zero included, so a complete file says so. */}
          <Fact label="Unresolved imports">{numberFormat.format(file.unresolved.length)}</Fact>
        </Facts>
      </div>

      <Section
        direction="incoming"
        title="Files that depend on this"
        count={relations.incoming.length}
      >
        {relations.incoming.length === 0 ? (
          <Note>No import of this file was found in the repository.</Note>
        ) : (
          <Rows>{rows(relations.incoming, "source")}</Rows>
        )}
      </Section>
      <Section
        direction="outgoing"
        title="Files this depends on"
        count={relations.outgoing.length}
      >
        {relations.outgoing.length > 0 ? (
          <Rows>{rows(relations.outgoing, "target")}</Rows>
        ) : failed ? (
          <Note>Unknown. The file could not be parsed, so its imports were not read.</Note>
        ) : (
          <Note>This file imports no other file in the repository.</Note>
        )}
      </Section>

      {failed && (
        <Section title="Parse errors" count={file.parseErrors.length}>
          <ul className="space-y-2 border-l-2 border-critical pl-3">
            {file.parseErrors.map((error, index) => (
              <li key={index}>
                <span className="text-xs text-muted">Line {numberFormat.format(error.line)}</span>
                <p>{error.message}</p>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {file.unresolved.length > 0 && (
        <Section title="Unresolved imports" count={file.unresolved.length}>
          <p className="mb-2 text-muted">
            These may be dependencies on files in this repository. They are not
            in the graph or in the lists above.
          </p>
          <ul className="space-y-2 border-l-2 border-caution pl-3">
            {file.unresolved.map((entry, index) => (
              <li key={index}>
                <div className="flex items-baseline gap-2">
                  <span className="min-w-0 font-mono text-[0.8125rem] break-all">
                    {entry.specifier ?? "(computed at run time)"}
                  </span>
                  <span className="ml-auto shrink-0 text-xs text-muted">
                    line {numberFormat.format(entry.line)}
                  </span>
                </div>
                <p className="text-xs text-muted">
                  {reasonLabel[entry.reason]}. {entry.detail}
                </p>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {file.excluded.length > 0 && (
        <Section title="Imports of excluded files" count={file.excluded.length}>
          <p className="mb-2 text-muted">
            These resolve to files an exclusion rule keeps out of the graph, so
            they cannot be selected.
          </p>
          <ul className="space-y-2 border-l-2 border-caution pl-3">
            {file.excluded.map((entry, index) => (
              <li key={index}>
                <div className="flex items-baseline gap-2">
                  <span className="min-w-0 font-mono text-[0.8125rem] break-all">
                    {entry.specifier ?? "(computed at run time)"}
                  </span>
                  <span className="ml-auto shrink-0 text-xs text-muted">
                    line {numberFormat.format(entry.line)}
                  </span>
                </div>
                <p className="text-xs break-all text-muted">
                  Resolves to {entry.target} ({entry.rule.replaceAll("-", " ")}).
                </p>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </>
  );
}

function FolderStructure({
  folder,
  model,
  relations,
  fileById,
  onSelect,
}: {
  folder: GraphFolder;
  model: GraphModel;
  relations: Relations;
  fileById: ReadonlyMap<string, GraphFile>;
  onSelect: Select;
}) {
  const files = folder.files.flatMap((id) => fileById.get(id) ?? []);
  const fileTypes = countBy(files.map((file) => file.type));
  // Other folders on the far end of the crossing edges, with how many real
  // file-to-file dependencies each one accounts for.
  const folderRows = (edges: GraphEdge[], end: "source" | "target") => {
    const counts = new Map<string, number>();
    for (const edge of edges) {
      const other = fileById.get(edge[end])?.folder;
      if (other !== undefined) counts.set(other, (counts.get(other) ?? 0) + 1);
    }
    return model.folders
      .filter((entry) => counts.has(entry.id))
      .map((entry) => (
        <FolderRow
          key={entry.id}
          folder={entry}
          direction={end === "source" ? "incoming" : "outgoing"}
          note={numberFormat.format(counts.get(entry.id) ?? 0)}
          onSelect={onSelect}
        />
      ));
  };
  const dependents = folderRows(relations.incoming, "source");
  const dependencies = folderRows(relations.outgoing, "target");

  return (
    <>
      <div className="px-5 py-4">
        <Facts>
          <Fact label="Files">{numberFormat.format(folder.files.length)}</Fact>
          <Fact label="Dependencies between its own files">
            {numberFormat.format(folder.internal)}
          </Fact>
          <Fact label="Dependencies coming in">{numberFormat.format(folder.fanIn)}</Fact>
          <Fact label="Dependencies going out">{numberFormat.format(folder.fanOut)}</Fact>
          <Fact label="Unresolved imports">
            {numberFormat.format(files.reduce((sum, file) => sum + file.unresolved.length, 0))}
          </Fact>
        </Facts>
      </div>
      <Section title="File types">
        <ul className="space-y-1">
          {fileTypes.map((group) => (
            <li key={group.label} className="flex items-baseline justify-between gap-3">
              <span className="font-mono text-[0.8125rem]">{group.label}</span>
              <span className="text-muted tabular-nums">{numberFormat.format(group.files)}</span>
            </li>
          ))}
        </ul>
      </Section>
      <Section direction="incoming" title="Folders that depend on this" count={dependents.length}>
        {dependents.length === 0 ? (
          <Note>No import of a file in this folder was found outside it.</Note>
        ) : (
          <Rows>{dependents}</Rows>
        )}
      </Section>
      <Section direction="outgoing" title="Folders this depends on" count={dependencies.length}>
        {dependencies.length === 0 ? (
          <Note>No file in this folder imports a file outside it.</Note>
        ) : (
          <Rows>{dependencies}</Rows>
        )}
      </Section>
      <Gaps files={files} onSelect={onSelect} />
    </>
  );
}

// The right-hand pane. With nothing selected it summarises the repository;
// with a selection it lists that file's or folder's relationships exactly as
// the edge list has them. It never adds to them, and everything it shows was
// already in the browser when the page loaded.
export function SelectionDetail({
  overview,
  model,
  selection,
  relations,
  onSelect,
}: {
  overview: RepositoryOverview;
  model: GraphModel;
  selection: Selection | null;
  relations: Relations | null;
  onSelect: Select;
}) {
  // Kept here rather than in the selected view, so the tab survives moving
  // from one selection to the next and through the resting state.
  const [tab, setTab] = useState<Tab>("structure");
  const fileById = useMemo(
    () => new Map(model.files.map((file) => [file.id, file])),
    [model],
  );

  const file = selection?.kind === "file" ? fileById.get(selection.id) : undefined;
  const folder =
    selection?.kind === "folder"
      ? model.folders.find((entry) => entry.id === selection.id)
      : model.folders.find((entry) => entry.id === file?.folder);

  if (!selection || !relations || (!file && !folder)) {
    return (
      <RepositorySummary
        overview={overview}
        model={model}
        fileById={fileById}
        onSelect={onSelect}
      />
    );
  }

  return (
    <div className="text-sm">
      <div className="px-5 pt-4 pb-3">
        <p className="text-xs text-muted">{file ? "File" : "Folder"}</p>
        <h2 className="mt-0.5 font-mono text-[0.8125rem] font-medium break-all">
          {file ? file.path : folder && folderPath(folder)}
        </h2>
        {file && folder && (
          <button
            type="button"
            onClick={() => onSelect({ kind: "folder", id: folder.id })}
            className="mt-2 cursor-pointer text-accent hover:underline"
          >
            Shown in {folder.label}
          </button>
        )}
      </div>

      <div role="tablist" aria-label="Detail" className="flex gap-4 border-b border-line px-5">
        {tabs.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`detail-tab-${id}`}
            aria-selected={tab === id}
            aria-controls="detail-panel"
            onClick={() => setTab(id)}
            className={`-mb-px cursor-pointer border-b-2 pb-2 font-medium ${
              tab === id
                ? "border-accent text-ink"
                : "border-transparent text-muted hover:text-ink"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id="detail-panel" aria-labelledby={`detail-tab-${tab}`}>
        {tab === "explanation" ? (
          <div className="px-5 py-4">
            <h3 className="font-medium">No explanation yet</h3>
            <p className="mt-1 text-muted">
              Impactlia does not write explanations yet, so there is nothing
              here for this {file ? "file" : "folder"}. Everything known about
              it is on the Structure tab, read directly from the repository.
            </p>
          </div>
        ) : (
          <>
            {file ? (
              <FileStructure
                file={file}
                relations={relations}
                fileById={fileById}
                onSelect={onSelect}
              />
            ) : (
              folder && (
                <FolderStructure
                  folder={folder}
                  model={model}
                  relations={relations}
                  fileById={fileById}
                  onSelect={onSelect}
                />
              )
            )}
            <Provenance />
          </>
        )}
      </div>
    </div>
  );
}
