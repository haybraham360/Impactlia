# Impactlia — Phase 11: Working Pull Request Impact Analysis

## Goal

Make Impactlia's main feature work end to end. A developer should be able to select a real GitHub Pull Request, analyze its actual diff against a suitable repository dependency graph, and receive a stored report showing changed files, potentially affected files, evidence-based risk signals, and recommended checks.

The current Analysis Runs screen contains sample rows. Those rows demonstrate the UI but are not proof of real analysis. This phase replaces the sample-only workflow with a real one.

**Core principle:** deterministic repository analysis and verified dependency relationships are the source of truth. AI may explain computed results, but must not invent dependencies, affected files, risk evidence, or test results.

## 1. Audit the current implementation first

Before changing code, inspect:

- Analysis Runs page, queries, actions, and status counts.
- Database schema, migrations, RLS policies, and analysis-run lifecycle.
- Repository ingestion pipeline and persisted graph format.
- Parser, framework adapters, CommonJS support, blast-radius traversal, and report components.
- GitHub connection, repository selection, PR list, and webhook/API integrations, if any.
- Sample/seed data and all code paths that display it.
- Existing authenticated real-time updates, background work, and retry patterns.

Classify each relevant feature as **working, partial, mocked, missing, or broken**, citing the files and evidence. Reuse working components. Do not assume that a screen means the backend feature exists. Do not begin by redesigning the UI.

## 2. Replace sample-only runs with real records

- Connect Analysis Runs to persisted records scoped to the current authorized workspace/organization.
- Keep the existing table and visual design where possible.
- Remove sample rows from the production experience. Keep fixtures only in isolated development/test environments.
- Show an honest empty state and a working action to connect/select a repository or analyze a PR.
- Calculate status counts from real records and ensure counts match visible rows.
- Open each real run to its own stored report.
- Never present a sample PR, sample risk score, or fixture result as a real analysis.

## 3. Connect to an authorized GitHub repository and PR

Reuse an existing secure GitHub integration if one is already implemented. Otherwise, build the smallest secure integration required to select a repository and PR.

- List only repositories and Pull Requests the authenticated user is authorized to access.
- Request only necessary permissions.
- Keep credentials and tokens server-side; never expose them to browser code or ask users to paste secrets into ordinary forms.
- Verify repository and PR access on the server for every analysis request.
- Handle missing configuration, revoked permissions, rate limits, inaccessible repositories, and unavailable PRs with clear states.
- If the GitHub integration cannot be completed, do not fake it. Clearly report the blocker and test the analysis service against real local fixtures without claiming end-to-end GitHub support.

## 4. Fetch and verify actual PR data

For each selected PR, retrieve and validate:

- Repository identity and URL.
- PR number, title, author, and URL.
- Base and head commit SHAs.
- Changed file paths and statuses: added, modified, renamed, and deleted, where available.
- Actual patch/diff data where available.

Do not infer changes from a title or sample data. Handle binary files, generated files, very large diffs, deleted files, and truncated/unavailable patches explicitly. Persist the exact revisions analyzed. If the diff is incomplete, surface that limitation instead of claiming complete coverage.

## 5. Calculate impact from real graph evidence

Implement this deterministic workflow:

1. Validate repository and PR authorization.
2. Fetch PR metadata, changed files, and base/head SHAs.
3. Ensure a repository graph exists for an appropriate revision; do not silently use a graph from an unrelated commit.
4. Match changed paths to actual graph nodes.
5. Calculate blast radius using the existing tested traversal utility and documented edge direction.
6. Deduplicate files reached from multiple changed files.
7. Preserve dependency paths that explain why each affected file is included.
8. Calculate documented risk signals from real analysis evidence.
9. Produce targeted test/check recommendations, clearly labelled as recommendations.
10. Persist the result and mark the run completed only after required stages succeed.

The report must distinguish:

- **Changed files:** files in the actual PR diff.
- **Potentially affected files:** files reached through verified dependency paths.
- **Unresolved/unanalysed files:** files for which the analyzer cannot establish relationships.
- **Coverage limitations:** incomplete diff, missing graph nodes, unresolved imports, unsupported patterns, or stale repository data.
- **Risk signals:** evidence that warrants attention.
- **Suggested checks:** recommendations, not tests Impactlia claims to have run.

Never call a potentially affected file broken solely because it is in the blast radius. Never claim tests failed unless actual test results were collected.

## 6. Add transparent, deterministic risk signals

Start with documented rules, such as:

- A changed file has many direct or transitive dependents.
- A change reaches a highly depended-on shared module.
- Relevant dependency relationships or source coverage are incomplete.
- A change touches a critical application role only when a deterministic adapter has identified that role.

Each signal must record its triggering facts and rule. A large blast radius alone is not proof of a defect.

If using Low/Medium/High, document the rule and show its contributing evidence. Present it as a prioritization heuristic, not a measured probability of failure. If evidence is insufficient, show **Insufficient evidence** rather than inventing a score.

## 7. Persist the complete run lifecycle

Reuse the current schema where possible; add migrations only when needed. Each run must record its workspace scope, repository and PR identity, base/head SHAs, status, current stage, timestamps, result, and safe failure details.

Use named stages, for example:

1. Validating access
2. Fetching PR diff
3. Preparing repository graph
4. Mapping changed files
5. Calculating impact
6. Computing risk signals
7. Saving report
8. Complete

- Persist progress and failure state.
- A top-level error handler must record the failing stage and a useful safe message.
- Prevent concurrent duplicate requests from corrupting results.
- Make deliberate re-analysis distinguishable from previous runs.
- Support `pending`, `running`, `completed`, `failed`, and `stale` states, or map these to the existing model consistently.
- Detect stale runs after a documented no-progress threshold. Stale means progress has not been recorded; do not claim it proves the process has stopped.
- Make retries safe and prevent a failed run from remaining `running` forever.

## 8. Make progress and report views real

- Show the actual persisted stage and status.
- Use the existing authenticated realtime mechanism if available. Otherwise use a bounded refresh strategy and clean up timers correctly.
- Do not add browser polling if working database subscriptions already exist.
- Ensure status badges and summary counts reflect stored state.
- A completed run must open a report that survives refresh and is backed by persisted results.

The report should contain:

- PR title, number, author, URL, and base/head SHAs.
- Analysis status and timestamp.
- Changed-file and potentially-affected-file counts.
- Risk label or “Insufficient evidence,” with contributing signals.
- Changed and affected file lists or the existing interactive graph.
- Verified paths explaining why files were included.
- Suggested tests/checks and why they are recommended.
- Coverage and analysis limitations.
- A warning if the repository revision is stale or differs from the analyzed revision.

Selecting a file should focus it in the existing graph/detail pane where supported. Do not create a disconnected second graph implementation.

## 9. AI explanations are optional

If the Phase 10 explanation layer is already working, it may summarize the deterministic report. If it is not working, do not let it block basic impact analysis.

- AI may explain only evidence supplied by Impactlia.
- AI must not add affected files, create dependency edges, fabricate test results, or replace deterministic calculations.
- The deterministic report must still complete if the AI provider is unavailable or the API key is missing.
- Respect existing cache, tracing, authorization, and stale-explanation rules.

## Security and reliability constraints

- Enforce workspace access in server handlers and database RLS, not only in the UI.
- Never expose GitHub tokens or OpenAI keys to the browser.
- Validate repository/PR identifiers server-side.
- Apply timeouts and sensible diff/file limits; handle API rate limits.
- Never execute repository code.
- Treat diffs, filenames, PR descriptions, and repository content as untrusted input.
- Protect model prompts against instructions embedded in source content.
- Keep logs and errors free of secrets.
- Preserve the existing landing page, authentication, repository explorer, graph, framework adapters, CommonJS support, and working explanation features.

## Acceptance checks

1. A workspace with no real analyses sees an empty state, not seeded sample PRs.
2. Select a real authorized GitHub repository and PR.
3. Verify title, number, author, changed paths, base SHA, and head SHA against GitHub.
4. Observe actual persisted stage transitions.
5. Verify changed files come from the real diff.
6. Manually verify at least two affected files against the stored dependency graph and their displayed paths.
7. Confirm files reached by multiple paths are counted once.
8. Confirm each risk signal has real evidence and no unrun tests or guaranteed breakage are claimed.
9. Refresh the page and confirm the report still shows the persisted result.
10. Submit the same repository/PR/revision twice and verify duplicate/concurrent-run behavior.
11. Simulate invalid PR, revoked access, truncated diff, parser failure, and persistence failure; each must result in an honest state and safe message.
12. Confirm failed runs do not stay running forever and stale runs can be safely retried.
13. Verify cross-workspace access is denied.
14. Disable AI configuration in a test environment; deterministic analysis must still work.
15. Confirm status counts match persisted records and exclude sample rows.
16. Run available lint, type checks, tests, and production build when disk space allows. Report actual results.

## Implementation approach

1. Audit and report which parts are working, partial, mocked, missing, or broken.
2. Identify the smallest missing end-to-end path and reuse existing components.
3. Repair or implement secure repository/PR selection.
4. Fetch real PR metadata/diffs and store exact revisions.
5. Connect changed files to a suitable stored graph and calculate blast radius.
6. Implement evidence-backed risk signals and recommendations.
7. Persist run lifecycle, progress, results, and failures.
8. Connect the Analysis Runs list and report view to real records.
9. Ensure AI is optional.
10. Run acceptance checks and report verified results and blockers.

## Out of scope

- Guaranteeing detection of every bug or production failure.
- Automatically merging, rejecting, or blocking PRs.
- Executing arbitrary repository code.
- Generic code review unrelated to change impact.
- Expanding language support before the current parser works reliably.
- Using CodeRabbit as Impactlia's core analysis engine.
- Unrelated enterprise analytics or billing.

## Completion report

Report the working end-to-end flow; integrations, routes, tables, and components reused or added; how real diffs and revisions are verified; how impact and risk signals are calculated; how failures, partial coverage, retries, and stale runs work; security checks; tests actually run; and remaining blockers.

**Do not mark this phase complete because the dashboard looks correct or a sample row says “Completed.” It is complete only when a real Pull Request produces a stored, reproducible, evidence-based Impactlia report.**
