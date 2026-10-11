# Impactlia — Phase 10: AI Explanations, Traceability, and Cache

## Goal

Introduce Impactlia's first AI-powered explanation layer in a controlled way. The model should help developers understand a file or folded folder in the context of the repository's already-computed dependency graph.

AI explains evidence that Impactlia has already collected. It must not create dependency edges, walk the graph, determine routes, or make unsupported claims about the repository.

This phase adds explanations, safe caching, trace records, and stale-result handling. It does not attempt to measure explanation quality; that evaluation belongs to a later phase.

## Build

### 1. Centralized AI client and tracing

- Create one shared location for constructing and configuring the AI client.
- Route every model request through a shared wrapper so each attempt is consistently traced.
- Record the analysis/explanation type, model identifier, start/end time, outcome, token usage when available, cache status, and a safe error summary.
- Avoid recording secrets, API keys, full environment variables, or unnecessary source-code payloads in trace records.
- Keep provider-specific details behind the shared client interface so the rest of Impactlia does not construct ad hoc clients.
- Make tracing configuration status visible in an appropriate developer/admin surface. If tracing is not configured, model calls should still work, but the application must clearly indicate that traces may be incomplete.
- Pin an exact model version rather than using a moving alias. Keep the model identifier configurable in the central client configuration.

### 2. Explain a file using verified repository context

Add an **Explain** action to the existing file detail pane.

The explanation input should include structured evidence already computed by Impactlia:

- The selected file's path and relevant source content.
- Files it imports, based on resolved dependency edges.
- Files that import it, based on resolved reverse edges.
- The verified paths/relationships that connect these neighboring files.
- Its known framework role, if an adapter assigned one.
- Relevant parser limitations, unresolved imports, or coverage warnings.
- The repository commit SHA associated with the analysis.

The model may describe the file's apparent responsibility and explain why its known neighbors may matter. It must not invent relationships or claim that the graph is complete.

- Only pass context appropriate for the current user's authorized repository.
- Limit source/context size safely and state when relevant context was omitted.
- Treat repository content as untrusted data, not as instructions to the model.
- Require explanations to distinguish observed facts from cautious interpretation.
- Do not state that a change will break production or that a file is safe merely from static dependency data.

### 3. Explain a folded folder as a separate task

A folded folder needs a folder-level explanation, not a summary of one arbitrary file.

Provide a folder-specific prompt and structured input containing, where available:

- The folder path.
- The files represented by the folded node.
- Their known roles.
- Important internal dependencies.
- Incoming dependencies from outside the folder.
- Outgoing dependencies to other folders.
- Relevant counts and analysis limitations.

Ask the model to explain what the folder appears to contain and why other parts of the repository depend on it. Do not describe relationships that are not present in the supplied graph evidence.

### 4. Classify files that have no known adapter role

For files that remain unclassified after deterministic framework adapters run, allow AI to suggest a non-structural role.

Allowed examples include:

- `service`
- `repository`
- `model`
- `util`
- `config`
- `component`
- `hook`

The allowed set must be validated in code. The model must not assign structural or routable roles such as `page`, `route`, or `controller`. Those roles affect route tables and framework-specific graph behavior and must remain the responsibility of deterministic conventions/adapters.

- Preserve the distinction between a deterministic role and an AI-suggested role.
- Store the role's provenance and model version.
- If the model returns invalid, ambiguous, or unsupported output, keep the file's generic role rather than guessing.
- Do not let AI classification change dependency edges or route records.

### 5. Content-based explanation cache

Cache file and folder explanations to avoid unnecessary repeat model calls.

- Key each cached result using a stable hash of the exact explanation input, including the relevant content, verified neighbor context, repository analysis/commit identity, prompt version, and pinned model identifier.
- Use separate cache types or namespaces for file explanations and folder explanations.
- Include the model identifier in the key so changing the pinned model invalidates only results associated with that model/configuration.
- Ensure cache invalidation follows changes to relevant file content or neighbor relationships.
- Avoid sharing cached results across repositories or tenants when their authorization boundaries differ.
- Store enough metadata to understand which input, prompt version, and model produced an explanation without unnecessarily duplicating sensitive source content.

### 6. Cache behavior visible in the UI

An explanation already fetched should remain visible in the detail pane when the user selects another node and then returns.

- Keep valid explanations in client state or retrieve them from the cache without requiring a second explicit click.
- Clearly distinguish a cached explanation from a new explanation being generated.
- Reopening a cached explanation should be immediate where possible.
- Ensure cache state is scoped to the current authorized repository and analysis.
- Do not show a stale explanation as current merely because it remains in the UI.

### 7. Traces include cache hits

Every explanation request should create a trace record, including requests satisfied from cache.

- Perform cache lookup within the shared traced operation so the trace records both cache hits and model calls.
- A cache hit must record that no model call was made and that token usage for that run was zero.
- A cache miss should record the model call outcome and token usage when the provider supplies it.
- Trace failures, cache failures, and model failures distinctly.
- Do not report zero tokens for a model call if token usage is unknown; represent unknown usage explicitly.
- Make it possible to inspect recent runs in the existing or a small dedicated tracing view, with filters for outcome and cache status.

### 8. Render a controlled subset of Markdown

The model's explanation should fit the narrow detail pane and remain readable.

Allow only these formatting constructs:

- Inline code.
- Bulleted lists.
- Bold text.

Do not render headings or arbitrary raw HTML. Do not print unsupported Markdown syntax literally.

- Use a Markdown renderer configured to allow only the supported subset, or parse and render that subset safely.
- Sanitize or reject unsafe links and HTML.
- Convert repository paths mentioned in the explanation into clickable internal links only when they match a known file path in the current analysis.
- Clicking a recognized path should select/focus that file in the graph and detail pane.
- Do not turn arbitrary model-generated text into navigable paths.
- Provide a plain-text fallback if parsing or rendering fails.

### 9. Staleness and re-analysis

An explanation is valid only for the repository content and analysis context that produced it.

- Store the analyzed commit SHA and a content hash for the explained file.
- When the repository's current known revision differs from the analyzed revision, mark the explanation as potentially stale.
- When a newer analysis exists, compare the current file content hash and relevant graph context with the explanation's stored inputs.
- Mark an explanation stale if the file content, relevant dependency context, or source analysis has changed.
- Clearly explain why the result is stale and offer an action to re-analyze the repository or refresh the explanation using a current analysis.
- Do not claim to know that a remote repository has changed unless Impactlia has checked a current revision or has other reliable evidence.
- If the current revision cannot be checked, show that freshness is unknown rather than assuming the result is current.
- Keep stale explanations identifiable in the pane and cache metadata; do not silently reuse them as fresh answers.

## Constraints

- **The graph is the source of truth for relationships.** The model explains supplied evidence; it never decides which files are connected or walks the graph itself.
- **One AI client path.** All model calls go through the shared client and tracing wrapper.
- **Exact model pinning.** Use an exact version and include it in the cache key.
- **Cache hits are traceable.** Every user-visible explanation request should be represented in the trace, including requests that do not call the model.
- **Validate AI classifications.** Only allow approved non-structural roles; structural/routable roles remain deterministic.
- **Safe rendering.** Only render the supported Markdown subset, and link only verified repository paths.
- **Tenant isolation.** Never allow cached explanations, trace details, or repository context to cross authorization boundaries.
- **Staleness must be honest.** A cached result is not necessarily a current result.
- **Reuse existing architecture.** Inspect the existing provider setup, database schema, graph data, detail pane, authentication, and tracing facilities before introducing new abstractions.
- **Do not regress existing features.** Preserve repository ingestion, graph analysis, framework adapters, CommonJS support, route tables, and graph navigation.
- **No quality claims yet.** This phase builds the explanation infrastructure; it does not prove that explanations are correct or useful.

## Acceptance checks

1. Click **Explain** on a file. The explanation reflects its actual source and verified incoming/outgoing dependency neighbors.
2. Inspect the request input and confirm that every named dependency was supplied from the parser/graph data and no relationship was invented by the model.
3. Click a recognized repository path in the explanation. The graph and detail pane select the corresponding known file.
4. Confirm that unsupported Markdown, headings, raw HTML, and unsafe links are not rendered as active content or printed as stray formatting characters.
5. Explain a folded folder and confirm the result describes the folder's represented files and external relationships rather than summarizing only one file.
6. Request the same explanation twice without changing its inputs. The second request is served from cache and is visibly immediate.
7. Inspect traces for both requests. Both are present; the cache hit records no model call and zero tokens.
8. Change the explanation input, prompt version, or pinned model identifier. Confirm the appropriate cache entry is invalidated without unnecessarily invalidating unrelated entries.
9. Return to a previously explained file. Its valid explanation remains visible without requiring another click.
10. Change the analyzed file or relevant repository context. Confirm the old explanation is marked stale and the UI offers a refresh/re-analysis action.
11. Disconnect or disable tracing configuration. Confirm model calls still work if provider configuration is valid, and the UI visibly indicates that tracing is not fully configured.
12. Return an invalid role from the model. Confirm the result is rejected and the file remains generic rather than becoming a page, route, or controller.
13. Verify that a user cannot retrieve another user's cached explanation or traces.
14. Simulate model, cache, and rendering failures. Confirm the UI shows useful recoverable states without exposing secrets.
15. Run available lint, type checks, tests, and a production build when the environment has sufficient disk space. Report any checks that could not be completed.

## Implementation approach

1. Audit the current AI provider configuration, repository/analysis data structures, graph neighbors, detail pane, caching options, tracing tables/views, and authentication policies.
2. Define the shared AI client interface and trace schema using existing project conventions.
3. Implement file-explanation input construction from verified graph and repository evidence.
4. Implement folder-level input construction as a separate explanation type.
5. Add content-based cache keys and trace cache lookups inside the shared traced operation.
6. Add validated non-structural role classification for files left generic by deterministic adapters.
7. Implement the restricted Markdown renderer and verified-path navigation.
8. Add explanation freshness metadata and stale-state behavior.
9. Test cache hits/misses, model errors, stale inputs, tenant isolation, and invalid model output.
10. Report changed files, actual validation results, model configuration, trace behavior, and remaining limitations.

## Out of scope for this phase

- Measuring explanation accuracy or usefulness; that comes in a later phase.
- AI-generated dependency edges or graph traversal.
- AI assignment of page, route, controller, or other structural roles.
- Automatic code changes, code generation, or AI code review.
- Production-failure prediction or guaranteed risk scores.
- Unrestricted Markdown, arbitrary HTML, or external links generated from model output.
- Private GitHub access or live Pull Request analysis unless already implemented and explicitly required by the existing workflow.

## Completion report

When finished, report:

- How the centralized AI client and tracing wrapper work.
- What evidence is supplied for file and folder explanations.
- Which model version is pinned and how it is configured.
- How cache keys and invalidation work.
- How cache hits appear in traces.
- Which non-structural roles AI may assign and how output is validated.
- How Markdown rendering and repository-path links are secured.
- How stale explanations are detected and communicated.
- Tests and validation commands run, with actual results.
- Known limitations and incomplete behavior.

Do not mark this phase complete merely because the model returns text. Verify evidence grounding, cache behavior, trace records, safe rendering, authorization boundaries, and stale-result handling.
