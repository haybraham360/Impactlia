"use client";

// What a page shows when reading it failed, instead of nothing. The cause is
// usually temporary (GitHub or the database could not be reached), so the
// one action is to try again. The error's own message stays on the server;
// the reference matches it in the server log.
export function RouteError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div role="alert" className="panel mx-auto mt-6 max-w-2xl border-critical/40 px-5 py-5 text-sm sm:px-6">
      <h2 className="text-[0.9375rem] font-medium text-critical">This page could not be loaded</h2>
      <p className="mt-2 max-w-prose">
        Reading it failed, most often because GitHub or the database could not be reached. Nothing
        was changed. Try again in a moment.
      </p>
      {error.digest && (
        <p className="mt-2 text-muted">
          Reference for the server log: <span className="font-mono text-[0.8125rem]">{error.digest}</span>
        </p>
      )}
      <button type="button" onClick={() => retry()} className="btn btn-secondary btn-small mt-4">
        Try again
      </button>
    </div>
  );
}
