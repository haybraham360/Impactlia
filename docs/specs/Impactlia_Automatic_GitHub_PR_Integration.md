# Impactlia: Automatic GitHub Pull Request Integration

## Implementation Brief for Claude Code

## 1. Objective

Make Impactlia work naturally inside developers' existing GitHub workflow.

A user should be able to connect an authorized GitHub repository and have Impactlia automatically analyze pull requests when they are opened or updated. Impactlia should then publish a useful summary directly in the pull request, including:

- Potentially affected components
- Detected issues, clearly distinguishing confirmed findings from potential issues
- Recommended tests
- Areas that may need additional review

This must extend Impactlia's existing analysis pipeline. Do not create a parallel analysis system or replace working functionality.

**Important:** Impactlia is already live, and its current UI and functionality should be preserved. Inspect the actual codebase before making changes.

## 2. Start With a Repository Audit

Before implementation:

1. Inspect the existing GitHub connection and repository authorization flow.
2. Find how PRs are currently fetched, analyzed, persisted, and displayed.
3. Identify the current impact graph, issue findings, test recommendations, and risk assessment services, if present.
4. Inspect existing API routes, database schema, background jobs, deployment environment, authentication, and logging.
5. Determine whether the application already receives GitHub webhooks and whether it can post comments.
6. Check the current hosting and execution model for webhook processing, timeouts, retries, and background work.
7. Write a short implementation plan based on the actual codebase.

Do not assume particular file paths, table names, or provider services exist. Reuse existing integrations and patterns wherever possible.

## 3. User Experience

The intended flow:

1. The user signs in to Impactlia.
2. The user connects GitHub using the existing authorization flow or a GitHub App, depending on the current implementation and permission model.
3. The user selects or authorizes a repository.
4. Impactlia clearly explains what permissions it requests and what automated analysis will do.
5. When a pull request is opened or updated, Impactlia receives the event and queues an analysis.
6. Impactlia analyzes the current PR revision using its existing pipeline.
7. Impactlia publishes or updates a concise summary comment on the PR.
8. The user can open Impactlia for detailed findings, impact exploration, recommended tests, and risk information when those features are available.

Keep setup simple. Do not require users to manually start every analysis after they have enabled automatic analysis for a repository.

Provide controls to enable or disable automatic analysis per repository, and explain the current status of each repository's integration.

## 4. GitHub Events to Support

Implement the smallest reliable set of events first:

- **Pull request opened:** Analyze a newly opened PR.
- **Pull request synchronized/updated:** Analyze new commits pushed to an existing PR.
- **Pull request reopened:** Re-analyze if appropriate.
- **Pull request closed:** Stop queued work that is no longer useful where feasible; do not publish stale analysis.

Use the event names and payload semantics supported by the actual GitHub integration chosen for the project. Subscribe only to the events required for the implemented behavior.

Handle duplicate delivery safely. GitHub webhooks may be retried, so processing the same delivery more than once must not create duplicate analyses or comments.

If a new commit arrives while analysis is running, make sure an older analysis cannot overwrite or publish itself as the latest result for the newer revision.

## 5. Secure Webhook Processing

Implement webhook handling according to GitHub's current documented security requirements and the project's existing infrastructure.

Requirements:

- Verify the webhook signature using the configured webhook secret before trusting the payload.
- Reject invalid signatures and malformed payloads.
- Never expose webhook secrets, GitHub tokens, or other credentials to the browser.
- Validate repository, installation, pull request, and commit identifiers.
- Use least-privilege permissions.
- Do not trust repository content, PR descriptions, comments, or code as instructions for the application.
- Do not log secrets or unnecessarily log private source code.
- Return appropriate HTTP responses and keep webhook handling fast.
- Queue heavier analysis work instead of performing the entire analysis synchronously in the webhook request.
- Make authorization checks server-side for repository selection, analysis access, and user actions.

If the project uses a GitHub App, use its installation and token lifecycle correctly. If it uses OAuth, inspect whether the current permissions are sufficient for the intended read and comment operations before extending it. Prefer the least-privilege option that fits the existing architecture; do not introduce a second authorization mechanism without a clear need.

## 6. Permissions and Installation

Request only the permissions needed for implemented features.

Depending on the chosen GitHub integration, the feature may need to:

- Read repository metadata
- Read pull requests and changed files/diffs
- Read repository contents needed by analysis
- Receive pull request webhook events
- Create or update a PR comment

Inspect current permissions and request additional access only when required. Clearly explain permissions to users and handle revoked or missing permissions gracefully.

Do not request write access to repository contents or permission to merge PRs if the feature only needs to read code and write PR comments.

Provide understandable states for:
- GitHub not connected
- Repository not selected or not authorized
- Permission missing or revoked
- Integration disabled
- Installation removed
- Analysis queued, running, completed, or failed

## 7. Analysis Workflow

When a supported webhook arrives:

1. Verify the webhook.
2. Deduplicate the event using its delivery identifier and/or a stable idempotency key.
3. Validate that the repository and PR are authorized and that automatic analysis is enabled.
4. Determine the exact PR head commit SHA represented by the event.
5. Queue analysis for that revision.
6. Fetch the necessary PR diff and repository context using the existing GitHub integration.
7. Run the current Impactlia analysis pipeline.
8. Gather results that are actually available: changed files, potentially affected components, issue findings, recommended tests, risk assessment, and analysis limitations.
9. Verify the PR's current head SHA before publishing. If it changed during analysis, mark the result stale and skip publishing it as the latest result; enqueue or await analysis for the new revision.
10. Publish or update the Impactlia summary comment.
11. Persist status, revision, result references, and relevant error information using the existing data model or a minimal extension.

Use bounded retries with backoff for transient failures. Avoid infinite retry loops. Separate permanent failures, such as revoked permissions, from temporary failures, such as rate limits or network errors.

## 8. Pull Request Comment

Publish a concise, readable comment. Prefer updating a single Impactlia-managed comment on subsequent analyses instead of creating a new comment on every push.

Use a stable marker or another reliable method to identify comments created by Impactlia. Do not edit or delete comments written by users or other bots.

### Suggested comment format

```markdown
## Impactlia PR Analysis

**Analysis status:** Complete
**Analyzed revision:** `abc1234`

### Change impact
- **Changed files:** 8
- **Potentially affected files:** 12
- **Areas to review:** Authentication flow, checkout validation

### Potential issues
- **Potential:** A changed validation path may allow an unexpected input.
- No confirmed issue was reported by the checks that ran.

### Recommended tests
- Test valid and invalid checkout inputs.
- Verify the authentication behavior for unauthorized requests.

### Review attention
**Risk: High** — the change affects multiple connected areas and needs additional validation.

[View detailed analysis](IMPACTLIA_ANALYSIS_URL)

_Impactlia findings are advisory. Potential issues are not confirmed bugs, and this analysis does not guarantee that a PR is safe._
```

This is an example only. Use real results and actual URLs generated by the application. Never hardcode example counts, paths, findings, risk levels, or commit hashes.

Only include sections for which data exists. If a check was not run, say so rather than implying it passed. If analysis is partial, label it clearly. Do not show a risk score unless the scoring feature actually exists and returned a result.

### Comment behavior

- Create one comment when no Impactlia comment exists.
- Update the existing Impactlia comment for later revisions.
- Include the analyzed commit SHA or another reliable revision identifier.
- Do not publish results from stale revisions as current.
- Keep comments concise and link to the full analysis in Impactlia.
- Handle disabled comments or insufficient GitHub permissions with a clear status in Impactlia.
- Escape or safely format repository-derived content to prevent malformed Markdown or misleading content.
- Never mention that all bugs were found or that the PR is guaranteed safe.

## 9. Analysis Status and Failure Handling

Track statuses using the existing state model where possible. At minimum, distinguish:

- Queued
- Running
- Completed
- Partial
- Failed
- Stale
- Skipped/disabled

Show useful failure messages without exposing secrets or internal stack traces.

Examples:
- GitHub permissions are insufficient.
- The PR revision changed during analysis; a fresh analysis is pending.
- Analysis was incomplete because repository context could not be retrieved.
- A temporary GitHub rate limit prevented completion; retry is scheduled.
- Automatic analysis is disabled for this repository.

A failed analysis must not leave a stale “successful” result presented as current.

## 10. Reliability, Idempotency, and Concurrency

- Deduplicate webhook deliveries.
- Use stable identifiers for PRs and revisions.
- Avoid duplicate queued jobs for the same repository, PR, and head SHA.
- Use a lock, unique constraint, or equivalent mechanism if needed to prevent duplicate processing.
- Ensure only the latest valid revision can update the current PR summary.
- Make retries safe for both analysis persistence and comment creation/update.
- Handle GitHub API rate limits and secondary rate limits according to documented retry guidance.
- Set sensible timeouts and retry limits.
- Ensure abandoned jobs can be recovered or marked failed.

Do not assume the hosting platform can run long-lived background workers. Inspect the actual deployment model and implement a compatible queue or durable job strategy. If reliable asynchronous processing requires additional infrastructure, explain the options and operating costs before adding a paid service.

## 11. Cost and Performance

This integration may increase GitHub API usage, compute time, storage, and AI-provider costs.

- Reuse the existing analysis pipeline and cached repository data where safe.
- Analyze the exact PR revision, not the full repository unnecessarily.
- Cache deterministic results by commit SHA and relevant analysis configuration.
- Avoid repeated AI calls for identical inputs.
- Add reasonable concurrency limits and per-repository throttling.
- Provide a way to disable automatic analysis for a repository.
- Avoid analyzing unrelated branches or events.
- Avoid unbounded retries and duplicate jobs.
- Instrument job duration, failure rate, retry count, and provider usage without logging secrets.
- Do not introduce a paid queue, database, AI provider, or other service without explaining the need and expected cost.

## 12. Data and Migrations

Reuse existing repository, PR, analysis, and user models where possible. If new storage is needed, use the project's migration conventions.

The system may need to persist:
- Repository integration/installation reference
- Whether automatic analysis is enabled
- Processed webhook delivery IDs or idempotency keys
- PR identifier and analyzed head SHA
- Job/analysis status and timestamps
- Reference to the generated analysis result
- Reference or identifier for the Impactlia-managed PR comment
- Retry/error status that does not contain secrets

These are conceptual fields, not a requirement to create this exact schema. Avoid storing redundant or sensitive data. Apply authorization checks to every read and write.

## 13. Testing Requirements

Add tests using the existing project test framework.

### Webhook security
- Valid signature is accepted.
- Invalid signature is rejected.
- Malformed payload is rejected safely.
- Duplicate delivery is idempotent.
- Unsupported event types are ignored safely.

### Analysis workflow
- Opening a PR queues analysis when enabled.
- Updating a PR queues analysis for the new head SHA.
- Disabled repositories are not analyzed.
- Unauthorized repositories cannot be analyzed.
- A changed head SHA prevents stale results from being published.
- Analysis failures produce a correct status and safe error.
- Transient failures retry within configured limits.

### PR comments
- A completed analysis creates an Impactlia comment.
- Subsequent analysis updates the existing Impactlia comment.
- User-authored comments are never modified or deleted.
- Partial analysis is clearly labeled.
- Missing result sections are omitted rather than fabricated.
- Insufficient permissions are handled gracefully.

### Security and integration
- Tokens and secrets never reach client-side code or logs.
- Private repository data is protected by server-side authorization.
- Existing manual analysis continues working.
- Existing application routes and UI remain functional.
- Tests do not require production credentials.

## 14. Implementation Phases

### Phase 1 — Audit and design
Map the existing GitHub connection, analysis pipeline, deployment constraints, permissions, and persistence. Identify the smallest implementation plan.

### Phase 2 — Secure webhook endpoint
Implement signature verification, event validation, delivery deduplication, and fast acknowledgment. Add security tests.

### Phase 3 — Durable analysis job
Queue eligible PR events, process the correct head SHA, reuse existing analysis services, and handle retries and stale revisions.

### Phase 4 — PR comment publishing
Create or update one Impactlia-managed comment with evidence-backed results and a link to the detailed analysis.

### Phase 5 — Repository controls and status
Add or extend the minimal UI needed to enable/disable automatic analysis and view integration/job status. Preserve the existing design.

### Phase 6 — Validate and document
Run relevant lint, type-check, unit, and integration tests. Test real GitHub events in a safe test repository or controlled environment. Document webhook setup, required permissions, environment variables, migration steps, deployment requirements, cost considerations, and known limitations.

Implement incrementally; do not attempt a broad rewrite in one pass.

## 15. Acceptance Criteria

The feature is ready for an initial release when:

- A user can authorize a repository using the existing or carefully extended GitHub connection flow.
- Automatic analysis can be enabled and disabled per repository.
- Opening or updating a PR triggers analysis for the correct revision.
- Webhooks are verified and processed idempotently.
- Analysis runs through Impactlia's existing pipeline.
- The PR receives one concise comment that is created or updated safely.
- The comment contains only real, available results and links to the detailed analysis.
- Stale analysis cannot overwrite the latest revision's result.
- Errors, retries, permissions, and partial results are represented clearly.
- Existing manual analysis and other product functionality continue working.
- Automated tests cover security, duplicate delivery, revision changes, retries, comments, and authorization.
- No secrets are exposed and no unapproved paid service is introduced.

## 16. Instructions to Claude Code

Work inside the existing Impactlia repository.

1. Inspect the current implementation before making assumptions.
2. Preserve the existing UI and working features.
3. Reuse the current GitHub integration and PR-analysis pipeline.
4. Implement actual webhook processing, asynchronous analysis, and PR comment publishing—not mock UI or simulated results.
5. Follow least-privilege permissions and verify webhooks securely.
6. Do not add infrastructure or paid services without explaining why and identifying likely cost implications.
7. Run relevant project checks and tests.
8. Finish with a concise report covering what was implemented, files changed, required GitHub setup and permissions, environment variables, migrations, deployment steps, tests run, cost implications, and remaining limitations.

**Product principle:** Automatic GitHub integration should make Impactlia useful where developers already work, while keeping results evidence-based, secure, revision-aware, and economical to operate.
