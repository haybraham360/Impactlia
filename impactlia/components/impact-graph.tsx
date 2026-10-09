"use client";

import {
  Controls,
  Handle,
  MarkerType,
  Panel,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useEffect, useMemo, useState } from "react";
import { DirectionMark } from "@/components/direction-mark";
import { HOVERED_CLASS, useHoverTarget, useHovered } from "@/components/hover";
import {
  COLUMN_WIDTH,
  GRID_PADDING,
  ROW_HEIGHT,
  fileGrid,
  layoutFolders,
  linkFolders,
} from "@/lib/graph/layout";
import type { GraphFile, GraphFolder, GraphModel } from "@/lib/graph/model";
import type { Relations, Selection } from "@/lib/graph/selection";

// This component only draws. Which folders exist, which lines connect them
// and where they sit all come from lib/graph.

type FolderTone = "idle" | "selected" | "holds-selection" | "related" | "dimmed";

type FolderData = {
  folder: GraphFolder;
  // The folder's files when it is open, null when it is closed.
  files: GraphFile[] | null;
  headerHeight: number;
  tone: FolderTone;
  selectedFile: string | null;
  relations: Relations | null;
  onSelect: (selection: Selection) => void;
  onToggle: (folder: string) => void;
};

type FolderNode = Node<FolderData, "folder">;

const numberFormat = new Intl.NumberFormat("en");

const toneClass: Record<FolderTone, string> = {
  idle: "border-ink/25",
  related: "border-ink/25",
  "holds-selection": "border-accent",
  selected: "border-accent outline-2 outline-accent",
  dimmed: "border-ink/25 opacity-25",
};

function FileRow({ file, data }: { file: GraphFile; data: FolderData }) {
  const { relations } = data;
  const selected = data.selectedFile === file.id;
  const dependent = relations?.dependents.has(file.id) ?? false;
  const dependency = relations?.dependencies.has(file.id) ?? false;
  const unrelated =
    relations !== null && !relations.selected.has(file.id) && !dependent && !dependency;
  // Lit while this file's row in the detail pane is hovered, and the other
  // way round: hovering here lights that row.
  const hovered = useHovered((hover) => hover.file === file.id);
  const hoverTarget = useHoverTarget({ file: file.id, folder: file.folder });

  return (
    <li>
      <button
        type="button"
        title={file.path}
        aria-pressed={selected}
        onClick={() => data.onSelect({ kind: "file", id: file.id })}
        {...hoverTarget}
        style={{ height: ROW_HEIGHT }}
        className={`flex w-full cursor-pointer items-center gap-1.5 rounded px-2 text-left font-mono text-xs ${
          selected ? "bg-accent text-accent-ink" : hovered ? HOVERED_CLASS : "hover:bg-canvas"
        } ${unrelated && !hovered ? "opacity-35" : ""}`}
      >
        <span className="truncate">{file.label}</span>
        {(dependent || dependency) && (
          <span className="ml-auto flex shrink-0 flex-col gap-0.5">
            {dependent && <DirectionMark direction="incoming" />}
            {dependency && <DirectionMark direction="outgoing" />}
          </span>
        )}
      </button>
    </li>
  );
}

function FolderBox({ data }: NodeProps<FolderNode>) {
  const { folder, files } = data;
  const open = files !== null;
  // Why this folder stayed bright: how many of its files depend on the
  // selection, and how many the selection depends on.
  const dependents = data.relations?.dependentsIn.get(folder.id) ?? 0;
  const dependencies = data.relations?.dependenciesIn.get(folder.id) ?? 0;
  const path = folder.id === "" ? folder.label : folder.id;
  // A hovered file counts for its folder too, so a pane row still has
  // something to light up on the graph while that file's folder is closed.
  const hovered = useHovered((hover) => hover.folder === folder.id);
  const hoverTarget = useHoverTarget({ file: null, folder: folder.id });
  const tone = hovered && data.tone === "dimmed" ? "idle" : data.tone;

  return (
    <div
      // The library switches pointer events off on nodes that can be neither
      // dragged nor selected through it, which would make the buttons here
      // unclickable, so they are switched back on.
      className={`pointer-events-auto h-full w-full overflow-hidden rounded-lg border bg-surface text-ink ${toneClass[tone]} ${
        hovered ? "ring-2 ring-ink" : ""
      }`}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} className="opacity-0" />
      <Handle type="source" position={Position.Right} isConnectable={false} className="opacity-0" />
      {/* One click selects the folder and opens or closes its panel of
          files. The block's height is its fan-in, so the text sits at the top
          and the rest is left empty. */}
      <button
        type="button"
        title={path}
        aria-expanded={open}
        onClick={() => {
          data.onSelect({ kind: "folder", id: folder.id });
          data.onToggle(folder.id);
        }}
        {...hoverTarget}
        style={{ height: data.headerHeight }}
        className="flex w-full cursor-pointer items-start gap-2 px-3 pt-3 text-left hover:bg-canvas"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-base font-medium">{folder.label}</span>
          <span className="mt-0.5 flex items-baseline justify-between gap-2 text-[0.8125rem] text-muted">
            <span>
              {numberFormat.format(folder.files.length)}{" "}
              {folder.files.length === 1 ? "file" : "files"}
            </span>
            <span className="tabular-nums">
              in {numberFormat.format(folder.fanIn)}, out {numberFormat.format(folder.fanOut)}
            </span>
          </span>
          {(dependents > 0 || dependencies > 0) && (
            <span className="mt-0.5 flex items-center gap-3 text-xs tabular-nums">
              {dependents > 0 && (
                <span className="flex items-center gap-1.5">
                  <DirectionMark direction="incoming" />
                  {numberFormat.format(dependents)}
                  <span className="sr-only">
                    {dependents === 1 ? "file depends" : "files depend"} on the selection
                  </span>
                </span>
              )}
              {dependencies > 0 && (
                <span className="flex items-center gap-1.5">
                  <DirectionMark direction="outgoing" />
                  {numberFormat.format(dependencies)}
                  <span className="sr-only">
                    {dependencies === 1 ? "file" : "files"} the selection depends on
                  </span>
                </span>
              )}
            </span>
          )}
        </span>
        <svg
          aria-hidden="true"
          viewBox="0 0 10 10"
          className={`mt-2 size-2.5 shrink-0 text-muted ${open ? "rotate-90" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <path d="M3 1l4 4-4 4" />
        </svg>
      </button>
      {files && (
        <ul
          className="grid grid-flow-col border-t border-line"
          style={{
            padding: GRID_PADDING,
            gridTemplateRows: `repeat(${fileGrid(files.length).rows}, ${ROW_HEIGHT}px)`,
            gridAutoColumns: COLUMN_WIDTH,
          }}
        >
          {files.map((file) => (
            <FileRow key={file.id} file={file} data={data} />
          ))}
        </ul>
      )}
    </div>
  );
}

const nodeTypes = { folder: FolderBox };

function folderTone(
  folder: GraphFolder,
  selection: Selection | null,
  relations: Relations | null,
  holder: string | null,
): FolderTone {
  if (!selection || !relations) return "idle";
  if (selection.kind === "folder" && selection.id === folder.id) return "selected";
  if (holder === folder.id) return "holds-selection";
  return relations.folders.has(folder.id) ? "related" : "dimmed";
}

export function ImpactGraph({
  model,
  selection,
  relations,
  onSelect,
}: {
  model: GraphModel;
  selection: Selection | null;
  relations: Relations | null;
  onSelect: (selection: Selection | null) => void;
}) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [flow, setFlow] = useState<ReactFlowInstance<FolderNode, Edge> | null>(null);

  const links = useMemo(() => linkFolders(model), [model]);
  const boxes = useMemo(() => layoutFolders(model, links, open), [model, links, open]);
  const fileById = useMemo(
    () => new Map(model.files.map((file) => [file.id, file])),
    [model],
  );

  // Opening or closing a folder changes the layout, so the whole graph is
  // fitted again. It is never zoomed to the folder that was opened.
  useEffect(() => {
    if (!flow) return;
    const frame = requestAnimationFrame(() => flow.fitView({ padding: 0.08 }));
    return () => cancelAnimationFrame(frame);
  }, [flow, boxes]);

  const nodes = useMemo((): FolderNode[] => {
    const toggle = (folder: string) =>
      setOpen((current) => {
        const next = new Set(current);
        if (!next.delete(folder)) next.add(folder);
        return next;
      });
    const selectedFile = selection?.kind === "file" ? selection.id : null;
    const holder = selectedFile === null ? null : (fileById.get(selectedFile)?.folder ?? null);

    return model.folders.flatMap((folder) => {
      const box = boxes.get(folder.id);
      if (!box) return [];
      return [
        {
          id: folder.id,
          type: "folder",
          position: { x: box.x, y: box.y },
          width: box.width,
          height: box.height,
          // Sizes and connection points are known from the layout, so they are
          // stated rather than left for the library to measure. Without this
          // it forgets where lines attach each time the selection changes.
          measured: { width: box.width, height: box.height },
          handles: [
            {
              type: "target" as const,
              position: Position.Left,
              x: 0,
              y: box.height / 2,
              width: 1,
              height: 1,
            },
            {
              type: "source" as const,
              position: Position.Right,
              x: box.width - 1,
              y: box.height / 2,
              width: 1,
              height: 1,
            },
          ],
          data: {
            folder,
            files: open.has(folder.id)
              ? folder.files.flatMap((id) => fileById.get(id) ?? [])
              : null,
            headerHeight: box.header,
            tone: folderTone(folder, selection, relations, holder),
            selectedFile,
            relations,
            onSelect,
            onToggle: toggle,
          },
        },
      ];
    });
  }, [model, boxes, open, fileById, selection, relations, onSelect]);

  const edges = useMemo(
    (): Edge[] =>
      links.map((link) => {
        const incoming = relations?.incomingLinks.has(link.id) ?? false;
        const outgoing = relations?.outgoingLinks.has(link.id) ?? false;
        const color = incoming
          ? "var(--incoming)"
          : outgoing
            ? "var(--outgoing)"
            : "var(--edge)";
        const highlighted = incoming || outgoing;
        return {
          id: link.id,
          source: link.source,
          target: link.target,
          zIndex: highlighted ? 1 : 0,
          markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
          style: {
            stroke: color,
            strokeWidth: highlighted ? 2 : 1.25,
            strokeDasharray: outgoing ? "6 4" : undefined,
            opacity: relations && !highlighted ? 0.12 : 1,
          },
        };
      }),
    [links, relations],
  );

  return (
    <div className="absolute inset-0">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onInit={setFlow}
        // Clicking empty canvas clears the selection and brings everything
        // back to full strength.
        onPaneClick={() => onSelect(null)}
        fitView
        fitViewOptions={{ padding: 0.08 }}
        minZoom={0.05}
        maxZoom={2}
        nodesDraggable={false}
        nodesConnectable={false}
        nodesFocusable={false}
        edgesFocusable={false}
        elementsSelectable={false}
      >
        <Controls showInteractive={false} />
        <Panel
          position="top-left"
          className="max-w-64 rounded-lg border border-line bg-surface px-3 py-2.5 text-xs text-muted"
        >
          <p>
            <span className="text-ink tabular-nums">
              {numberFormat.format(model.folders.length)}
            </span>{" "}
            folders. A folder sits to the right of the folders that depend on
            it; folders that depend on each other in a cycle sit side by side.
            A taller folder has more dependencies coming in.
            {model.foldThreshold > 1 &&
              ` Directories with fewer than ${model.foldThreshold} files are shown inside their parent.`}
          </p>
          <ul className="mt-2 space-y-1">
            <li className="flex items-center gap-2">
              <DirectionMark direction="incoming" />
              Depends on the selection
            </li>
            <li className="flex items-center gap-2">
              <DirectionMark direction="outgoing" />
              The selection depends on it
            </li>
          </ul>
        </Panel>
      </ReactFlow>
    </div>
  );
}
