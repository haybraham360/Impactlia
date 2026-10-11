"use client";

import { FileRow, LongRows, Note, Section, numberFormat } from "@/components/detail-parts";
import type { GraphFile } from "@/lib/graph/model";
import type { Selection } from "@/lib/graph/selection";
import { MAX_DEPTH, type ReachedFile, type Traversal } from "@/lib/graph/traverse";

// Shows a traversal that lib/graph already computed. Nothing is worked out
// here beyond turning each path round so it reads in import order.

const stepButton =
  "flex size-6 cursor-pointer items-center justify-center rounded border border-line hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-40";

function DepthControl({
  traversal,
  onDepth,
}: {
  traversal: Traversal;
  onDepth: (depth: number) => void;
}) {
  const { depth, more } = traversal;
  return (
    <div className="flex items-center gap-2">
      <span id="traversal-depth-label" className="text-muted">
        Depth
      </span>
      <div role="group" aria-labelledby="traversal-depth-label" className="flex items-center gap-1.5">
        <button
          type="button"
          aria-label="Follow one level fewer"
          disabled={depth <= 1}
          onClick={() => onDepth(depth - 1)}
          className={stepButton}
        >
          <span aria-hidden="true">−</span>
        </button>
        <output aria-live="polite" className="min-w-5 text-center font-medium tabular-nums">
          {depth}
        </output>
        <button
          type="button"
          aria-label="Follow one level further"
          // Going deeper is only offered while there is something there.
          disabled={!more || depth >= MAX_DEPTH}
          onClick={() => onDepth(depth + 1)}
          className={stepButton}
        >
          <span aria-hidden="true">+</span>
        </button>
      </div>
      <span className="text-xs text-muted">
        {depth === 1 ? "import away" : "imports away, at most"}
      </span>
    </div>
  );
}

// The chain of imports that put a file in the result, importer first, so each
// neighbouring pair can be looked up as an edge: left imports right.
function Evidence({ entry, blast }: { entry: ReachedFile; blast: boolean }) {
  const chain = blast ? [...entry.path].reverse() : entry.path;
  // The file one level closer on the path shown; the rest of `via` are other
  // routes of the same length.
  const others = entry.via.filter((file) => file !== entry.path[entry.path.length - 2]);
  return (
    <div className="mb-1.5 border-l-2 border-line pl-2 text-xs text-muted">
      <p className="font-mono break-all">
        {chain.map((file, index) => (
          <span key={file}>
            {index > 0 && (
              <>
                {" "}
                <span aria-hidden="true">→</span>
                <span className="sr-only">imports</span>{" "}
              </>
            )}
            {file}
          </span>
        ))}
      </p>
      {others.length > 0 && (
        <details className="mt-1">
          <summary className="cursor-pointer">
            {numberFormat.format(others.length)} other{" "}
            {others.length === 1 ? "route" : "routes"} of the same length
          </summary>
          <p className="mt-1">{blast ? "It also imports:" : "Also imported by:"}</p>
          <ul className="font-mono break-all">
            {others.map((file) => (
              <li key={file}>{file}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

export function TraversalResults({
  file,
  traversal,
  fileById,
  unresolvedInRepository,
  onDepth,
  onSelect,
}: {
  file: GraphFile;
  traversal: Traversal;
  fileById: ReadonlyMap<string, GraphFile>;
  unresolvedInRepository: number;
  onDepth: (depth: number) => void;
  onSelect: (selection: Selection) => void;
}) {
  const blast = traversal.direction === "dependents";
  const direction = blast ? "incoming" : "outgoing";
  const rows = (entries: ReachedFile[], evidence: boolean) =>
    entries.flatMap((entry) => {
      const reached = fileById.get(entry.file);
      return reached
        ? [
            <FileRow
              key={entry.file}
              file={reached}
              direction={direction}
              note={evidence ? `depth ${entry.depth}` : undefined}
              onSelect={onSelect}
            >
              {evidence && <Evidence entry={entry} blast={blast} />}
            </FileRow>,
          ]
        : [];
    });
  const direct = traversal.reached.filter((entry) => entry.depth === 1);
  const indirect = traversal.reached.filter((entry) => entry.depth > 1);
  const failed = file.parseStatus === "failed";

  return (
    <>
      <Section
        direction={direction}
        title={blast ? "Potentially affected files" : "Files in the dependency chain"}
        count={traversal.reached.length}
      >
        <DepthControl traversal={traversal} onDepth={onDepth} />
        <p className="mt-2 text-muted">
          {blast
            ? "Files that import this one, directly or through other files. A change here could reach them. It does not mean any of them is broken."
            : "Files this one imports, directly or through other files. A change to any of them could reach this file."}
        </p>
        {traversal.reached.length === 0 && (
          <div className="mt-3 space-y-2">
            {blast ? (
              <Note>
                No file in the graph imports this one, so nothing was found in
                its blast radius.
                {unresolvedInRepository > 0 &&
                  ` ${numberFormat.format(unresolvedInRepository)} ${
                    unresolvedInRepository === 1 ? "import" : "imports"
                  } in the repository could not be resolved; one of them could point here.`}
              </Note>
            ) : failed ? (
              <Note>Unknown. The file could not be parsed, so its imports were not read.</Note>
            ) : (
              <Note>This file imports no other file in the graph.</Note>
            )}
          </div>
        )}
      </Section>

      {direct.length > 0 && (
        <Section
          direction={direction}
          title={blast ? "Direct dependents" : "Direct dependencies"}
          count={direct.length}
        >
          <p className="mb-2 text-muted">
            {blast ? "Each of these imports this file." : "This file imports each of these."}
          </p>
          <LongRows rows={rows(direct, false)} />
        </Section>
      )}
      {indirect.length > 0 && (
        <Section
          direction={direction}
          title={blast ? "Indirect dependents" : "Indirect dependencies"}
          count={indirect.length}
        >
          <p className="mb-2 text-muted">
            Under each file is one shortest chain of imports connecting it to
            this file. Read left to right: each file imports the next.
          </p>
          <LongRows rows={rows(indirect, true)} />
        </Section>
      )}

      {(traversal.more || (!blast && file.unresolved.length > 0)) && (
        <div className="space-y-2 border-t border-line px-5 py-4 text-muted">
          {traversal.more && (
            <p>
              More files lie beyond depth {traversal.depth} and are not listed.
              {traversal.depth < MAX_DEPTH
                ? " Increase the depth to follow them."
                : ` ${MAX_DEPTH} is the deepest this view goes.`}
            </p>
          )}
          {!blast && file.unresolved.length > 0 && (
            <p>
              {numberFormat.format(file.unresolved.length)} of this file’s imports could not be
              resolved and {file.unresolved.length === 1 ? "is" : "are"} not followed here.
            </p>
          )}
        </div>
      )}
    </>
  );
}
