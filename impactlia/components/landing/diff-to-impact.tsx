"use client";

import { useState } from "react";
import { FileMark, stateTone } from "@/components/landing/file-mark";
import {
  changedFiles,
  exampleDiff,
  reachFrom,
  type ExampleFile,
  type Reached,
} from "@/lib/landing/example";

// One changed file at a time, and everything that imports it. Picking a
// changed file redraws the list; picking a file in the list shows the chain
// of imports that put it there. Both are plain buttons, so a mouse, a
// keyboard and a touch all do the same thing.

const groups = [
  { steps: 1, title: "Imports it directly" },
  { steps: 2, title: "Imports it through another file" },
];

function Chain({ path }: { path: ExampleFile[] }) {
  return (
    <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-2 font-mono text-[0.8125rem]">
      {path.map((file, index) => (
        <li key={file.id} className="flex items-center gap-1.5">
          {index > 0 && <span className="font-sans text-xs text-muted">imports</span>}
          <span
            className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 ${
              file.state === "changed"
                ? "border-accent bg-accent text-accent-ink"
                : "border-incoming/60 bg-incoming/10"
            }`}
          >
            <span className={file.state === "changed" ? undefined : stateTone[file.state]}>
              <FileMark state={file.state} />
            </span>
            {file.name}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function DiffToImpact() {
  const [changedId, setChangedId] = useState(changedFiles[0].id);
  const reached = reachFrom(changedId);
  const [pickedId, setPickedId] = useState<string | null>(null);
  // A pick from another changed file's list does not carry over.
  const picked: Reached | undefined =
    reached.find((entry) => entry.file.id === pickedId) ?? reached[0];
  const changed = changedFiles.find((file) => file.id === changedId) ?? changedFiles[0];

  return (
    <div className="panel overflow-hidden text-sm">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3 sm:px-5">
        <span className="text-xs text-muted">Changed in this pull request</span>
        <span className="ml-auto rounded-full border border-dashed border-muted/60 px-2 py-0.5 text-xs text-muted">
          Illustrative example
        </span>
      </div>

      <div
        role="group"
        aria-label="Changed file to trace"
        className="grid gap-2 border-b border-line p-3 sm:grid-cols-2 sm:p-4"
      >
        {changedFiles.map((file) => {
          const diff = exampleDiff[file.id];
          return (
            <button
              key={file.id}
              type="button"
              aria-pressed={file.id === changedId}
              onClick={() => {
                setChangedId(file.id);
                setPickedId(null);
              }}
              className="lift flex cursor-pointer items-center gap-2 rounded-lg border border-line px-3 py-2.5 text-left font-mono text-[0.8125rem] aria-pressed:border-accent aria-pressed:bg-accent/10"
            >
              <span className={stateTone.changed}>
                <FileMark state="changed" />
              </span>
              <span className="min-w-0 truncate">{file.id}</span>
              {diff && (
                <span className="ml-auto shrink-0 tabular-nums">
                  <span className="text-positive">+{diff.added}</span>{" "}
                  <span className="text-critical">−{diff.removed}</span>
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="grid sm:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] sm:divide-x sm:divide-line">
        <div className="space-y-5 px-4 py-4 sm:px-5">
          <p className="text-xs text-muted">
            {reached.length} files import {changed.name}
          </p>
          {groups.map((group) => {
            const entries = reached.filter((entry) => entry.steps === group.steps);
            if (entries.length === 0) return null;
            return (
              <section key={group.steps}>
                <h4 className="mb-2 text-xs font-medium text-muted">{group.title}</h4>
                <ul className="space-y-1.5">
                  {entries.map((entry) => (
                    <li key={entry.file.id}>
                      <button
                        type="button"
                        aria-pressed={picked?.file.id === entry.file.id}
                        onClick={() => setPickedId(entry.file.id)}
                        className="flex w-full cursor-pointer items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-left font-mono text-[0.8125rem] transition-colors duration-150 hover:bg-white/5 aria-pressed:border-incoming/60 aria-pressed:bg-incoming/10"
                      >
                        <span className={stateTone.affected}>
                          <FileMark state="affected" />
                        </span>
                        <span className="min-w-0 truncate">{entry.file.name}</span>
                        <span className="ml-auto shrink-0 font-sans text-xs text-muted">
                          {entry.steps === 1 ? "1 step" : `${entry.steps} steps`}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>

        <div className="border-t border-line px-4 py-4 sm:border-t-0 sm:px-5">
          <h4 className="text-xs font-medium text-muted">Evidence</h4>
          {picked ? (
            // Announced when the pick changes; keyed so it fades in again.
            <div key={picked.file.id} aria-live="polite" className="impact-step mt-3">
              <p className="font-mono text-[0.8125rem] break-all">{picked.file.id}</p>
              <p className="mt-1 flex items-center gap-1.5 text-xs text-incoming">
                <FileMark state="affected" />
                Potentially affected
              </p>
              <div className="mt-4">
                <Chain path={picked.path} />
              </div>
              <p className="mt-4 text-muted">
                Each link is an import found in the source. It is a reason to look at{" "}
                {picked.file.name}, not a sign that it is broken.
              </p>
            </div>
          ) : (
            <p className="mt-3 text-muted">Nothing in the example imports this file.</p>
          )}
        </div>
      </div>
    </div>
  );
}
