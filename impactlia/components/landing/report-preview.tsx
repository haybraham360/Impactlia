"use client";

import { useState, type ReactNode } from "react";
import { FileMark, stateTone } from "@/components/landing/file-mark";
import { RiskBadge } from "@/components/landing/risk-badge";
import {
  affectedFiles,
  changedFiles,
  examplePullRequest,
  importsOf,
  layersFromChange,
  type ExampleFile,
} from "@/lib/landing/example";
import {
  LEVEL_SUMMARY,
  exampleChecks,
  exampleLevel,
  exampleSignals,
  levelLabel,
} from "@/lib/landing/example-report";

// A picture of the report the product produces, drawn from the same example
// as the hero, with the product's own section names and risk signals. Nothing here is computed from a real
// repository, and the panel says so. The one thing that moves is which
// affected file the connection is shown for.
//
// The wording is for someone who has never read an impact report: a file
// "uses" another rather than "imports" it, and the panel says what that means
// once, at the top. Every sentence about a relationship is built from the
// example's edges, so the words cannot disagree with the picture.

const FIRST_EXPLAINED = "src/emails/receipt.ts";

const listFormat = new Intl.ListFormat("en", { type: "conjunction" });

function names(files: ExampleFile[]): string {
  return listFormat.format(files.map((file) => file.name));
}

function uses(files: ExampleFile[]): string {
  return files.length === 1 ? "uses" : "use";
}

// How one affected file is tied to the change, in a line.
function connection(file: ExampleFile): string {
  const imported = names(importsOf(file.id));
  return file.steps === 1 ? `Uses ${imported} directly.` : `Reached through ${imported}.`;
}

function Block({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <section className="px-4 py-5 sm:px-5">
      <h3 className="mb-3 text-xs font-medium text-muted">{title}</h3>
      {children}
    </section>
  );
}

function Legend() {
  return (
    <div className="border-b border-line px-4 py-3 text-xs text-muted sm:px-5">
      <dl className="flex flex-col gap-x-6 gap-y-1.5 lg:flex-row">
        <div className="flex gap-2">
          <span className={`mt-0.5 ${stateTone.changed}`}>
            <FileMark state="changed" />
          </span>
          <dt className="font-medium text-ink">Changed</dt>
          <dd>A file this pull request edited.</dd>
        </div>
        <div className="flex gap-2">
          <span className={`mt-0.5 ${stateTone.affected}`}>
            <FileMark state="affected" />
          </span>
          <dt className="shrink-0 font-medium text-ink">Potentially affected</dt>
          <dd>A file that uses a changed file, directly or through another file.</dd>
        </div>
      </dl>
      <p className="mt-1.5">One file “uses” another when it imports code from it.</p>
    </div>
  );
}

function Chip({ file, selected }: { file: ExampleFile; selected: boolean }) {
  const tone =
    file.state === "changed"
      ? "border-accent bg-accent text-accent-ink"
      : selected
        ? "border-incoming bg-canvas"
        : "border-line";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded border px-1.5 py-0.5 ${tone}`}>
      <span className={file.state === "changed" ? undefined : stateTone[file.state]}>
        <FileMark state={file.state} />
      </span>
      {file.name}
    </span>
  );
}

// The connection drawn top to bottom, one row per step, with the relationship
// written on every arrow. An unlabelled arrow leaves the reader to guess
// whether it means "uses" or "is used by".
function Chain({ layers }: { layers: ExampleFile[][] }) {
  const last = layers.length - 1;
  return (
    <ol className="impact-step font-mono text-[0.8125rem]">
      {layers.map((layer, index) => (
        <li key={layer[0].id}>
          {index > 0 && (
            <span className="flex items-center gap-1.5 py-1 pl-2 font-sans text-xs text-muted">
              <svg
                aria-hidden="true"
                viewBox="0 0 8 16"
                className="h-4 w-2 text-incoming"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <path d="M4 0v14M1 10.5l3 3.5 3-3.5" />
              </svg>
              {layer.length === 1 ? "is used by" : "are used by"}
            </span>
          )}
          <span className="flex flex-wrap items-center gap-1.5">
            {layer.map((file) => (
              <Chip key={file.id} file={file} selected={index === last} />
            ))}
            <span className="font-sans text-xs text-muted">
              {index === 0 && "changed in this pull request"}
              {index === last && "the file you selected"}
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}

export function ReportPreview() {
  const [explainedId, setExplainedId] = useState(FIRST_EXPLAINED);
  const layers = layersFromChange(explainedId);
  const explained = layers[layers.length - 1][0];
  // Read back from the selected file towards the change, one step at a time.
  const steps = layers
    .slice(1)
    .map((layer, index) => `${names(layer)} ${uses(layer)} ${names(layers[index])}`)
    .reverse()
    .join(", and ");

  return (
    <div className="panel overflow-hidden text-sm">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-4 py-3 sm:px-5">
        <span className="font-mono text-[0.8125rem] text-muted">
          PR #{examplePullRequest.number}
        </span>
        <span className="font-medium">{examplePullRequest.title}</span>
        <span className="text-muted">
          {changedFiles.length} files changed, {affectedFiles.length} potentially affected
        </span>
        <span className="ml-auto rounded-full border border-dashed border-muted/60 px-2 py-0.5 text-xs text-muted">
          Illustrative example
        </span>
      </header>

      <Legend />

      <div className="grid divide-y divide-line lg:grid-cols-3 lg:divide-x lg:divide-y-0">
        <div className="divide-y divide-line">
          <Block title={`Changed files (${changedFiles.length})`}>
            <ul className="space-y-2.5">
              {changedFiles.map((file) => (
                <li key={file.id} className="flex gap-2">
                  <span className={`mt-1.5 ${stateTone[file.state]}`}>
                    <FileMark state={file.state} />
                  </span>
                  <span className="min-w-0 font-mono text-[0.8125rem] break-all">{file.id}</span>
                </li>
              ))}
            </ul>
          </Block>
          <Block title={`Potentially affected files (${affectedFiles.length})`}>
            <p className="mb-3 text-xs text-muted">
              Select a file to see how the change reaches it.
            </p>
            <ul className="space-y-2.5">
              {affectedFiles.map((file) => (
                <li key={file.id}>
                  {/* The negative margin gives the row a hover area without
                      moving its text out of line with the list above. */}
                  <button
                    type="button"
                    aria-pressed={explainedId === file.id}
                    onClick={() => setExplainedId(file.id)}
                    className="group -mx-2 -my-1 flex w-[calc(100%+1rem)] cursor-pointer items-start gap-2 rounded-md border border-transparent px-2 py-1 text-left transition-colors duration-150 hover:bg-canvas aria-pressed:border-incoming/60 aria-pressed:bg-canvas"
                  >
                    <span className={`mt-1.5 ${stateTone[file.state]}`}>
                      <FileMark state={file.state} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-mono text-[0.8125rem] break-all">
                        {file.id}
                      </span>
                      <span className="block text-xs text-muted">{connection(file)}</span>
                    </span>
                    {/* Says the row can be opened, and which one is open. */}
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 8 12"
                      className="mt-1.5 h-3 w-2 shrink-0 text-muted group-aria-pressed:text-incoming"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                    >
                      <path d="M1.5 1l5 5-5 5" />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          </Block>
        </div>

        <div className="divide-y divide-line">
          <Block title={`Why ${explained.name} is on the list`}>
            {/* Announced when the selection changes; keyed so the chain fades
                in again for the new file. */}
            <div aria-live="polite">
              <Chain key={explainedId} layers={layers} />
              <p className="mt-4">
                {steps}. So a change there could reach {explained.name}.
              </p>
              <p className="mt-2 text-muted">
                That is a reason to check it, not a sign that it is broken.
              </p>
            </div>
          </Block>
          <Block title="Coverage and limitations">
            <p>1 connection could not be followed.</p>
            <p className="mt-1 text-muted">
              <span className="font-mono text-[0.8125rem]">src/plugins/loader.ts</span> decides
              which file to load while the app is running, so the files it loads are missing
              from this report.
            </p>
          </Block>
        </div>

        <div className="divide-y divide-line">
          <Block
            title={
              <span className="flex items-center justify-between gap-3">
                Risk signals
                <span className="text-sm">
                  <RiskBadge level={exampleLevel} />
                </span>
              </span>
            }
          >
            <ul className="space-y-3">
              {exampleSignals.map((signal) => (
                <li key={signal.id}>
                  <p className="flex items-start justify-between gap-3">
                    <span>{signal.label}</span>
                    <span className="shrink-0 text-xs text-muted">{levelLabel[signal.level]}</span>
                  </p>
                  <p className="mt-0.5 text-muted">{signal.fact}</p>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-xs text-muted">{LEVEL_SUMMARY}</p>
          </Block>
          <Block title="Suggested checks">
            <ol className="list-decimal space-y-2.5 pl-4.5 marker:text-muted">
              {exampleChecks.map((check) => (
                <li key={check.file}>
                  {check.body}
                  <span className="block text-xs text-muted">{check.reason}</span>
                </li>
              ))}
            </ol>
          </Block>
        </div>
      </div>
    </div>
  );
}
