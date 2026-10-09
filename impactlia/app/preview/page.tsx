import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { AnalysisWorkspace } from "@/components/analysis-workspace";
import { buildGraphModel } from "@/lib/graph/model";
import { PREVIEW_OUTPUT_FILE, readPreviewAnalysis } from "@/lib/preview-analysis";
import { summariseRepository } from "@/lib/repository-overview";

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-16 text-sm">
      <h1 className="text-lg font-semibold">{title}</h1>
      <div className="mt-2 space-y-3 text-muted">{children}</div>
    </div>
  );
}

async function Preview() {
  // The file is rewritten whenever the parser is run again, so it is read on
  // each request rather than baked into the prerendered page.
  await connection();
  const analysis = readPreviewAnalysis();

  if (analysis.status === "missing") {
    return (
      <Notice title="No parser output to show yet">
        <p>
          Run the parser against a repository on disk, from the directory that
          holds package.json, then reload this page.
        </p>
        <pre className="overflow-x-auto rounded-md border border-line bg-surface px-3 py-2 font-mono text-[0.8125rem] text-ink">
          pnpm parse &lt;repository-directory&gt; --out {PREVIEW_OUTPUT_FILE}
        </pre>
      </Notice>
    );
  }

  if (analysis.status === "invalid") {
    return (
      <Notice title="The parser output could not be used">
        <p>
          <span className="font-mono text-[0.8125rem]">{PREVIEW_OUTPUT_FILE}</span>{" "}
          exists but did not pass validation, so nothing from it is shown.
        </p>
        <p className="border-l-2 border-critical pl-3 text-critical">
          {analysis.message}
        </p>
      </Notice>
    );
  }

  return (
    <AnalysisWorkspace
      overview={summariseRepository(analysis.output)}
      model={buildGraphModel(analysis.output)}
    />
  );
}

export default function PreviewPage() {
  // Reads a file from the developer's disk without signing in, so it does not
  // exist outside `next dev`.
  if (process.env.NODE_ENV !== "development") notFound();

  return (
    <div className="flex min-h-dvh flex-col lg:h-dvh">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-surface px-4 py-2.5 text-sm">
        <span className="text-base font-semibold tracking-tight">Impactlia</span>
        <span className="rounded border border-dashed border-muted px-1.5 text-xs text-muted">
          Development preview
        </span>
        <span className="ml-auto font-mono text-[0.8125rem] text-muted">
          {PREVIEW_OUTPUT_FILE}
        </span>
      </header>
      <Suspense>
        <Preview />
      </Suspense>
    </div>
  );
}
