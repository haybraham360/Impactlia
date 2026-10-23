// Every resource limit one analysis works within, in one place, each against
// the resource it protects. A limit reached either stops the run with a
// message naming it, or leaves something out and says what; nothing stops
// silently.
//
// The deployment these are set for: a Vercel function on the Hobby plan,
// which runs the analysis after its request returns (lib/impact/start.ts),
// for at most 300 seconds, with 1 vCPU, 2 GB of memory and 500 MB of /tmp.
// Measured on a laptop, so a guide rather than a guarantee there: tree-sitter
// read about 500 files a second, and 26,000 C headers took 55 seconds and
// 1.2 GB.

const MEGABYTE = 1024 * 1024;

export const BUDGETS = {
  // ── Downloading a whole commit (the full path) ──────────────────────────
  // The .tar.gz GitHub sends. It is unpacked as it arrives and never stored,
  // so this bounds download time, not disk. The old single 100 MB limit was
  // this number, applied to an archive saved to /tmp first.
  archiveBytes: 1024 * MEGABYTE,
  // Bytes read out of the compressed stream, whatever is done with them: an
  // archive bomb stops here.
  unpackedBytes: 4096 * MEGABYTE,
  // Bytes written to /tmp: source files and the project files the parser
  // reads. Everything else is written as an empty file.
  writtenBytes: 300 * MEGABYTE,
  // Entries of any kind in the archive.
  entries: 500_000,
  // Source files parsed in one analysis, in every language together. Over
  // this the run stops: a graph missing files would under-report what a
  // change reaches.
  sourceFiles: 15_000,
  // Of those, TypeScript and JavaScript, which one compiler program holds in
  // memory at once.
  typescriptFiles: 5_000,
  // One source file larger than this is left out of the graph, named, and
  // not parsed: it is almost always generated or bundled.
  sourceFileBytes: 1 * MEGABYTE,

  // ── Updating the stored index instead (the selective path) ──────────────
  // A repository with fewer source files than this is analysed in full, as
  // before: it is quick, and the full path also type-checks changed
  // TypeScript.
  selectiveFromFiles: 2_000,
  // Files changed between the index's commit and the one analysed. GitHub's
  // compare lists at most 300; more falls back to the full path.
  changedFiles: 300,
  // Files downloaded one by one: changed source files, project files the
  // resolvers read, and tests read for their imports.
  fetchedFiles: 400,
  fetchConcurrency: 8,
  // Tests that import a changed file, fetched so their imports can be read.
  fetchedTests: 50,

  // ── Sharing the server ──────────────────────────────────────────────────
  // Repository runs and pull request analyses one organization may have in
  // progress at once. A member starting another is told to wait; automatic
  // analyses are retried by the sweep instead.
  activeRunsPerOrganization: 3,
} as const;
