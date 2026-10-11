"use client";

import { useId, useState } from "react";
import type { Selection } from "@/lib/graph/selection";
import type { RepositoryOverview } from "@/lib/repository-overview";
import type { RouteRecord } from "@/parser/contract";

const numberFormat = new Intl.NumberFormat("en");
const plural = (count: number, one: string, many: string) =>
  `${numberFormat.format(count)} ${count === 1 ? one : many}`;

type Select = (selection: Selection) => void;

// A source file, as a way back to it: choosing one selects that file on the
// graph and in the detail pane.
function Source({
  file,
  line,
  onSelect,
}: {
  file: string;
  line: number | null;
  onSelect: Select;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect({ kind: "file", id: file })}
      className="cursor-pointer text-left font-mono text-[0.8125rem] break-all text-accent hover:underline"
    >
      {file}
      {line !== null && <span className="text-muted">:{line}</span>}
    </button>
  );
}

function Routes({
  title,
  routes,
  selectedFile,
  onSelect,
}: {
  title: string;
  routes: RouteRecord[];
  selectedFile: string | null;
  onSelect: Select;
}) {
  if (routes.length === 0) return null;
  return (
    <tbody>
      <tr>
        <th
          colSpan={4}
          scope="rowgroup"
          className="bg-canvas px-4 py-1 text-left text-xs font-medium text-muted"
        >
          {title} ({numberFormat.format(routes.length)})
        </th>
      </tr>
      {routes.map((route, index) => (
        <tr
          key={index}
          title={route.evidence}
          className={`border-t border-line align-baseline ${
            route.file === selectedFile ? "bg-accent/10" : ""
          }`}
        >
          <td className="py-1 pr-3 pl-4 font-mono text-[0.8125rem] font-medium whitespace-nowrap">
            {route.method ?? "Page"}
          </td>
          <td className="py-1 pr-3 font-mono text-[0.8125rem] break-all">{route.pattern}</td>
          <td className="py-1 pr-3">
            <Source file={route.file} line={route.line} onSelect={onSelect} />
          </td>
          <td className="py-1 pr-4 font-mono text-[0.8125rem] break-all text-muted">
            {route.handler}
          </td>
        </tr>
      ))}
    </tbody>
  );
}

// Sits under the graph. Collapsed it is one line saying how many routes were
// read and how many were declined; open, it is the table itself. Every row is
// something the parser's adapter read from the source or from a documented
// file convention. Nothing here is inferred from a name.
export function RouteTable({
  overview,
  selectedFile,
  onSelect,
}: {
  overview: RepositoryOverview;
  selectedFile: string | null;
  onSelect: Select;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const { routes, omittedRoutes, framework } = overview;
  const pages = routes.filter((route) => route.kind === "page");
  const endpoints = routes.filter((route) => route.kind === "http");

  return (
    <div className="border-t border-line bg-surface text-sm">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2">
        <p className="min-w-0 flex-1 basis-64">
          <span className="font-medium">Routes</span>{" "}
          <span className="text-muted">
            {routes.length === 0
              ? "None extracted."
              : `${plural(pages.length, "page", "pages")}, ${plural(endpoints.length, "HTTP endpoint", "HTTP endpoints")}.`}
          </span>{" "}
          {omittedRoutes.length > 0 && (
            <span className="text-caution">
              {numberFormat.format(omittedRoutes.length)} not extracted.
            </span>
          )}
        </p>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((value) => !value)}
          className="cursor-pointer text-accent hover:underline"
        >
          {open ? "Hide routes" : routes.length === 0 ? "Why" : "Show routes"}
        </button>
      </div>

      {open && (
        <div id={panelId} className="max-h-[45dvh] overflow-y-auto border-t border-line">
          {routes.length === 0 ? (
            <p className="max-w-prose px-4 py-3 text-muted">
              {framework.label === null
                ? "No supported framework (Next.js, NestJS, Express or React) is named in a package.json of this repository. Routes are only read through a framework's own conventions, so there are none to show."
                : `No route was extracted from this ${framework.label} repository. That is not evidence that it has none.`}
            </p>
          ) : (
            <table className="w-full border-collapse">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th scope="col" className="py-1.5 pr-3 pl-4 font-medium">
                    Method
                  </th>
                  <th scope="col" className="py-1.5 pr-3 font-medium">
                    Route pattern
                  </th>
                  <th scope="col" className="py-1.5 pr-3 font-medium">
                    Source
                  </th>
                  <th scope="col" className="py-1.5 pr-4 font-medium">
                    Handler
                  </th>
                </tr>
              </thead>
              <Routes
                title="Pages a browser opens"
                routes={pages}
                selectedFile={selectedFile}
                onSelect={onSelect}
              />
              <Routes
                title="HTTP endpoints"
                routes={endpoints}
                selectedFile={selectedFile}
                onSelect={onSelect}
              />
            </table>
          )}

          {omittedRoutes.length > 0 && (
            <section className="border-t border-line px-4 py-3">
              <h3 className="font-medium text-caution">
                Not extracted ({numberFormat.format(omittedRoutes.length)})
              </h3>
              <p className="mt-1 max-w-prose text-muted">
                These look like routes, but part of the address could not be read from the
                source, so none is shown for them.
              </p>
              <ul className="mt-2 space-y-2">
                {omittedRoutes.map((omitted, index) => (
                  <li key={index}>
                    <Source file={omitted.file} line={omitted.line} onSelect={onSelect} />
                    {omitted.handler && (
                      <span className="ml-2 font-mono text-[0.8125rem] text-muted">
                        {omitted.handler}
                      </span>
                    )}
                    <p className="text-muted">{omitted.reason}</p>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <div className="max-w-prose space-y-1.5 border-t border-line px-4 py-3 text-xs text-muted">
            {framework.notes.map((note, index) => (
              <p key={index} className="text-ink">
                {note.detail}
                {note.line !== null && ` Line ${numberFormat.format(note.line)}.`}
              </p>
            ))}
            <p>
              A route is listed only when its method and whole pattern are written in the
              source or fixed by a file convention. Nothing is run, so routes added at
              runtime are not here, and the list is not proof that an address responds.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
