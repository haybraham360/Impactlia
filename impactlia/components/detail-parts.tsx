"use client";

import { useState, type ReactNode } from "react";
import { DirectionMark } from "@/components/direction-mark";
import { HOVERED_CLASS, useHoverTarget, useHovered, type Hover } from "@/components/hover";
import type { GraphFile, GraphFolder } from "@/lib/graph/model";
import type { Selection } from "@/lib/graph/selection";

// The pieces the detail pane's views are assembled from.

export const numberFormat = new Intl.NumberFormat("en");

type Direction = "incoming" | "outgoing";

const directionText: Record<Direction, string> = {
  incoming: "Depends on the selection:",
  outgoing: "The selection depends on:",
};

export function Section({
  title,
  direction,
  count,
  children,
}: {
  title: string;
  direction?: Direction;
  count?: number;
  children: ReactNode;
}) {
  return (
    <section className="border-t border-line px-5 py-4">
      <h3 className="flex items-center gap-2 text-xs font-medium text-muted">
        {direction && <DirectionMark direction={direction} />}
        {title}
        {count !== undefined && (
          <span className="ml-auto tabular-nums">{numberFormat.format(count)}</span>
        )}
      </h3>
      <div className="mt-2">{children}</div>
    </section>
  );
}

export function Facts({ children }: { children: ReactNode }) {
  return <dl className="space-y-1">{children}</dl>;
}

export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right tabular-nums">{children}</dd>
    </div>
  );
}

export function Note({ children }: { children: ReactNode }) {
  return <p className="text-muted">{children}</p>;
}

function Row({
  label,
  title,
  note,
  direction,
  hover,
  highlighted,
  onClick,
}: {
  label: string;
  title: string;
  note?: string;
  direction?: Direction;
  hover: Hover;
  highlighted: boolean;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        title={title}
        onClick={onClick}
        {...useHoverTarget(hover)}
        className={`-mx-2 flex w-[calc(100%+1rem)] cursor-pointer items-baseline gap-2 rounded px-2 py-1 text-left hover:bg-canvas ${
          highlighted ? HOVERED_CLASS : ""
        }`}
      >
        {direction && (
          <span className="self-center">
            <DirectionMark direction={direction} />
            <span className="sr-only">{directionText[direction]}</span>
          </span>
        )}
        <span className="min-w-0 font-mono text-[0.8125rem] break-all">{label}</span>
        {note && <span className="ml-auto shrink-0 text-xs text-muted">{note}</span>}
      </button>
    </li>
  );
}

// A file path. Always selects that file when clicked, and lights up when the
// file, or the closed folder holding it, is hovered on the graph.
export function FileRow({
  file,
  note,
  direction,
  onSelect,
}: {
  file: GraphFile;
  note?: string;
  direction?: Direction;
  onSelect: (selection: Selection) => void;
}) {
  const highlighted = useHovered(
    (hover) =>
      hover.file === file.id || (hover.file === null && hover.folder === file.folder),
  );
  return (
    <Row
      label={file.path}
      title={file.path}
      note={note}
      direction={direction}
      hover={{ file: file.id, folder: file.folder }}
      highlighted={highlighted}
      onClick={() => onSelect({ kind: "file", id: file.id })}
    />
  );
}

export const folderPath = (folder: GraphFolder) =>
  folder.id === "" ? folder.label : folder.id;

export function FolderRow({
  folder,
  note,
  direction,
  onSelect,
}: {
  folder: GraphFolder;
  note?: string;
  direction?: Direction;
  onSelect: (selection: Selection) => void;
}) {
  const highlighted = useHovered((hover) => hover.folder === folder.id);
  return (
    <Row
      label={folder.label}
      title={folderPath(folder)}
      note={note}
      direction={direction}
      hover={{ file: null, folder: folder.id }}
      highlighted={highlighted}
      onClick={() => onSelect({ kind: "folder", id: folder.id })}
    />
  );
}

export function Rows({ children }: { children: ReactNode }) {
  return <ul className="space-y-0.5">{children}</ul>;
}

const FIRST_ROWS = 10;

// A list that can run to hundreds of rows. It opens on the first few, and the
// rest are one click away, so the count above it is always inspectable.
export function LongRows({ rows }: { rows: ReactNode[] }) {
  const [all, setAll] = useState(false);
  return (
    <>
      <Rows>{all ? rows : rows.slice(0, FIRST_ROWS)}</Rows>
      {rows.length > FIRST_ROWS && (
        <button
          type="button"
          aria-expanded={all}
          onClick={() => setAll(!all)}
          className="mt-2 cursor-pointer text-accent hover:underline"
        >
          {all ? `Show first ${FIRST_ROWS}` : `Show all ${numberFormat.format(rows.length)}`}
        </button>
      )}
    </>
  );
}

const importsMissing = (file: GraphFile) => file.unresolved.length + file.excluded.length;

// Where the graph is known to be incomplete for a set of files. Renders
// nothing when the parser reported no gaps.
export function Gaps({
  files,
  onSelect,
}: {
  files: GraphFile[];
  onSelect: (selection: Selection) => void;
}) {
  const failed = files.filter((file) => file.parseStatus === "failed");
  const missing = files.filter((file) => importsMissing(file) > 0);
  return (
    <>
      {failed.length > 0 && (
        <Section title="Files that could not be parsed" count={failed.length}>
          <p className="mb-2 text-muted">
            No imports were read from these, so what they depend on is unknown.
          </p>
          <LongRows
            rows={failed.map((file) => (
              <FileRow key={file.id} file={file} onSelect={onSelect} />
            ))}
          />
        </Section>
      )}
      {missing.length > 0 && (
        <Section title="Files with imports missing from the graph" count={missing.length}>
          <p className="mb-2 text-muted">
            Each has imports that could not be resolved or that point at an
            excluded file. Select one to see them.
          </p>
          <LongRows
            rows={missing.map((file) => (
              <FileRow
                key={file.id}
                file={file}
                note={numberFormat.format(importsMissing(file))}
                onSelect={onSelect}
              />
            ))}
          />
        </Section>
      )}
    </>
  );
}

export function Provenance() {
  return (
    <p className="border-t border-line px-5 py-4 text-xs text-muted">
      Read from the import statements in the repository. A dependency shows
      what could be reached, not that anything is wrong.
    </p>
  );
}
