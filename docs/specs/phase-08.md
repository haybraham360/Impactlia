# Impactlia — Phase 7: Repository Ingestion and Analysis Pipeline

## Goal

Allow a developer to submit a public GitHub repository URL and have Impactlia turn the repository into a real, inspectable dependency map backed by stored analysis data.

This phase connects the existing repository-analysis engine and graph explorer to a reliable ingestion workflow. It establishes the foundation for later Pull Request impact analysis, but it does not implement live GitHub Pull Request ingestion or AI-based risk assessment.

## Build

### 1. Public repository URL ingestion

- Add or complete the dashboard form for submitting a public GitHub repository URL.
- Validate and normalize supported GitHub repository URLs before starting work.
- Fetch the repository as an archive using a safe, supported method.
- Do not request repository permissions or store a GitHub token for this public-repository workflow.
- Reject unsupported URLs and invalid repository identifiers with clear, actionable messages.
- Enforce reasonable archive size, file-count, and processing limits so a very large repository cannot exhaust application resources.
- Extract archives safely: prevent path traversal, ignore unsafe paths, and avoid executing repository code or lifecycle scripts.
- Exclude generated directories and irrelevant files according to the existing parser's rules, such as dependency folders and build output.
- Record the exact source commit SHA when the archive provides it. Do not invent a commit identifier if it cannot be verified.

### 2. A staged analysis run

Implement a clear, traceable pipeline with named stages. Reuse the existing parser and graph types rather than creating a second analysis implementation.

Suggested stages:

1. **Validating repository** — validate the URL and repository identity.
2. **Fetching source** — retrieve the public archive and source revision.
3. **Preparing files** — safely extract the archive and select supported source files.
4. **Parsing dependencies** — extract resolvable imports and dependency edges.
5. **Calculating graph data** — compute graph statistics and supported structural insights.
6. **Saving analysis** — persist the repository metadata, graph data, coverage information, and run result.
7. **Complete** — make the stored analysis available in the explorer.

Each stage should have a stable identifier, a human-readable message, and a defined success/failure transition.

- Persist stage changes as the run progresses.
- A top-level error handler must record a failed state, the stage where failure occurred, and a safe, useful error message.
- Do not leave a run indefinitely marked as processing when an exception occurs.
- Avoid storing secrets, raw credentials, or unnecessarily verbose internal error details in user-visible messages.
- Ensure temporary extracted files are cleaned up on success and failure.

### 3. Repository identity and duplicate prevention

- Normalize repository URLs so common URL variations resolve to the same repository identity.
- Maintain one canonical analysis record per repository for this phase, consistent with the existing data model.
- If the repository has already been analyzed, take the user to the existing analysis instead of silently creating a duplicate.
- Make re-analysis a deliberate action from the existing repository/analysis view.
- When a user deliberately re-runs an analysis, update or version the result according to the current schema and preserve enough metadata to distinguish the new run from the previous one.
- Record the source commit SHA for each run so a future phase can detect when the repository has changed.
- Handle concurrent submissions of the same repository safely. A database constraint or equivalent atomic mechanism should prevent duplicate records even when two requests arrive together.

### 4. Stored analysis as the source of truth

- Update the explorer to read the saved analysis data rather than a checked-in parser-output fixture or preview-only route.
- Persist the repository identity, source commit SHA, run status, timestamps, file nodes, dependency edges, unresolved relationship information, and coverage metrics supported by the existing schema.
- Keep the schema consistent with the project's current database design. Add migrations only when needed, and make them safe to apply.
- Ensure the UI handles missing, partial, failed, and completed analyses explicitly.
- Do not present sample or fixture data as if it came from the submitted repository.
- Remove the checked-in analysis fixture and preview route only after every consumer has been migrated and verified against stored analysis rows.

### 5. Live progress updates

- Show the current stage and a short explanation on a progress page while analysis is running.
- Use the project's authenticated real-time/database subscription mechanism if it is already configured and suitable.
- Publish only the minimum required progress payload, such as the analysis ID, stage identifier, status, and safe stage message—not an entire database row.
- Declare required channels or publication configuration in the relevant migration/setup before attempting to publish to them.
- Apply authorization policies so a user can only read progress for analyses they are permitted to access. Organization boundaries must be enforced just as they are for stored repository and analysis data.
- Use the authenticated browser client for protected subscriptions.
- Ensure subscriptions are cleaned up when a component unmounts or the user leaves the progress page.
- If live updates are unavailable, show an explicit recoverable state rather than silently appearing frozen.

### 6. Stale-run detection and failure recovery

- Mark a run as **stale** in the dashboard when it has remained in a non-terminal state beyond a documented time threshold.
- A stale run must be distinguishable from a run that is actively progressing.
- Do not claim that stale detection proves a process has stopped; it means progress has not been recorded within the expected window.
- Provide a safe way to retry a failed or stale analysis.
- Prevent overlapping retries from corrupting the stored result.
- Record the last successful stage and a useful failure reason.
- Keep completed and failed states terminal for a particular run; a retry should create or start a clearly distinguishable run according to the data model.

### 7. Coverage and parser limitations

- Show a coverage banner on the graph when the parser reports incomplete coverage or unresolved relationships.
- Base the coverage figure on a documented calculation using actual parser output. Do not invent a percentage or imply it measures all possible runtime behavior.
- If the parser cannot calculate a defensible percentage, show a qualitative partial-analysis warning instead of a misleading number.
- Keep the coverage banner visible enough that an incomplete graph cannot be mistaken for a complete map.
- It may collapse to a compact line, but the compact state must retain the coverage figure or explicit partial-coverage label.
- Explain known limitations such as unresolved aliases, unsupported file types, dynamic imports that cannot be resolved, and framework conventions not yet modeled.
- A high static-analysis coverage figure must not be presented as proof that every runtime dependency has been found.

## Constraints

- **No AI is required for this pipeline.** Repository fetching, parsing, graph construction, status changes, and coverage calculations must be deterministic.
- **Public repository support only in this phase.** Do not request private-repository permissions or store GitHub access tokens as part of this workflow.
- **Never execute repository code.** Treat repository contents and archive paths as untrusted input.
- **Stored rows are the source of truth.** The graph explorer must use the saved analysis for the selected repository.
- **Reliable failure states are required.** Every run must reach a clear terminal state or be visibly identified as stale.
- **Secure tenant isolation.** Enforce ownership/organization access in database policies and subscription authorization, not only in the UI.
- **Reuse existing architecture.** Inspect the repository's current Next.js, TypeScript, Supabase, parser, graph, and state-management implementations before changing anything.
- **Do not duplicate parser logic.** Reuse the existing parser and its established edge direction/types.
- **Do not regress existing work.** Preserve authentication, the workspace shell, graph interactions, blast-radius features, and the landing page.
- **No unrelated redesign.** Only adjust the UI as needed to make the pipeline understandable and reliable.
- **No unsupported claims.** Do not present a successful parse as proof of complete code understanding or production safety.

## Acceptance checks

1. Submit a valid public GitHub repository URL. The pipeline runs through named stages and opens the map built from that repository's stored analysis.
2. Verify that the recorded source commit SHA matches the commit from which the archive was obtained.
3. Submit the same repository again. The existing analysis opens, and a duplicate repository record is not created.
4. Trigger a deliberate re-analysis. The new run is distinguishable from the previous run, and the source revision is recorded.
5. Submit a malformed URL, a nonexistent repository, and a repository that cannot be fetched. Each fails with a useful message and a persisted failed state rather than remaining in a processing state.
6. Simulate a parser or persistence failure. Verify that the run records the failing stage and a safe explanation.
7. Open the progress page in two authorized browser sessions and confirm that both receive stage changes without a manual refresh.
8. Verify that an unauthorized user cannot read another user's or organization's analysis data or subscribe to its progress updates.
9. Confirm that stale runs are visibly identified after the configured threshold and can be retried without corrupting the prior run.
10. Analyze a repository with unsupported patterns, such as unresolved aliases or unusual directory structure. Verify that the coverage banner reports the actual limitation and does not imply a complete graph.
11. Confirm that the explorer reads stored rows and that the old fixture/preview path is removed only after no active screen depends on it.
12. Test archive safety, file-count/size limits, temporary-file cleanup, and failure cleanup.
13. Inspect the network tab and server logs to confirm that progress subscriptions are authorized and that no repository code is executed.
14. Run available lint, type checks, tests, and a production build when sufficient disk space is available. Report any checks that could not be completed.

## Implementation approach

1. Audit the current repository submission form, analysis schema, parser, graph explorer, authentication, real-time configuration, and existing fixture/preview route.
2. Write down the existing repository identity and run lifecycle before changing the schema.
3. Implement URL normalization, public archive retrieval, safe extraction, and commit-SHA capture.
4. Implement the staged pipeline with persisted progress and reliable failure handling.
5. Add duplicate prevention and deliberate re-analysis behavior.
6. Connect progress updates and stale-run handling using the existing authenticated database/realtime approach.
7. Persist the parser output and migrate the explorer to stored analysis data.
8. Add the coverage banner using real parser metrics and clearly documented semantics.
9. Test normal completion, duplicates, concurrent submissions, failures, stale runs, access boundaries, and incomplete coverage.
10. Summarize what changed, validation results, limitations, and any remaining work.

## Out of scope for this phase

- Private GitHub repository access and GitHub App installation.
- Live Pull Request webhooks, diff ingestion, and automatic analysis on every PR.
- AI-generated code explanations or AI-based risk scoring.
- Automatic test execution, CI integration, or merge blocking.
- Framework-specific route/entry-point modeling beyond what the existing parser already supports.
- Multi-language parsing beyond the languages currently supported.
- Code review comments or integration with CodeRabbit.

## Completion report

When finished, report:

- What was implemented and which files changed.
- How public repository fetching and commit identification work.
- How the run lifecycle, progress updates, failure handling, and stale detection work.
- How duplicate submissions and deliberate re-analysis are handled.
- How the explorer uses persisted analysis data.
- How coverage is calculated and what it does not represent.
- Tests and validation commands run, with actual results.
- Remaining security concerns, parser limitations, and incomplete functionality.

Do not mark this phase complete merely because the progress page or graph renders. Verify the complete workflow from URL submission through persisted analysis and the real repository map.
