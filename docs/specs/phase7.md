# Impactlia — Phase 6: Change Impact, Blast Radius, and Evidence-Based Insights

## Goal

Make Impactlia's repository graph useful for understanding the consequences of a code change. Given a selected file—or, when available, a set of files changed in a GitHub Pull Request—the product should show which parts of the codebase may be affected, why they are connected, and what a developer should inspect or test next.

This phase must use the repository analysis already available in Impactlia. It must not depend on an AI model to discover dependencies or invent relationships.

## Build

### 1. Reusable graph traversal

Implement one deterministic graph-traversal utility that supports direction and depth limits.

- **Blast radius:** follow reverse dependency edges to find files that may depend on the selected file.
- **Dependency chain:** follow dependency edges to find files the selected file depends on.
- Support multiple starting files so a future Pull Request analysis can calculate the combined potential impact of all changed files.
- Default to two dependency levels. Allow deeper exploration where useful, but avoid presenting an unbounded repository-wide result as a focused answer.
- Deduplicate results and preserve the path or paths that explain why each file was included.
- Make traversal deterministic so the same graph and input produce the same result.
- Keep the computation local to the already-loaded analysis data; opening these views should not trigger a network request.

### 2. Explainable impact results

For a selected file, display:

- The selected file and its direct relationships.
- Potentially affected files within the chosen blast-radius depth.
- The dependency path that connects each affected file to the selected file.
- The depth at which each file was reached.
- A clear distinction between direct dependents and indirect dependents.
- A useful empty state when no relationships are found.

Do not describe a file as broken simply because it appears in the blast radius. Use language such as **potentially affected** unless a test or other reliable signal confirms an actual failure.

### 3. Repository insights

Add a compact, initially collapsed Insights panel with deterministic findings derived from the parsed repository graph. Start with:

- **Import cycles:** groups of files that form a verified cycle in the resolved import graph.
- **Files with no incoming imports:** files that are not imported by another file in the graph.
- **Highly depended-on files:** files with unusually high incoming dependency counts, using a documented and consistent threshold.
- **Large files:** files exceeding a documented line-count threshold.

Every insight must include the relevant file paths and a short, factual explanation. These are structural observations, not automatic judgments about code quality.

Important: a file with no incoming imports is not automatically unused. Framework entry points such as pages, routes, layouts, middleware, configuration files, scripts, and test entry points may be discovered by the runtime or tooling rather than imported by another source file. Exclude known entry-point patterns where the current project can identify them reliably. Otherwise label the result **“No incoming imports detected”**, not **“Unused file.”**

Do not claim that an import cycle or a large file is a bug by itself.

### 4. Graph and navigation-rail integration

Connect the results to the existing Impactlia graph and detail pane.

- Add or complete **Blast radius** and **Dependency chain** actions in the file detail pane.
- Selecting an item in a result should focus or select that file in the graph and detail pane.
- Add rail filters for the supported insight categories.
- When a category is selected, dim non-matching graph elements rather than removing them. Preserve the overall repository shape so developers retain context.
- Show a matching-file count for each category.
- Make counts consistent across the rail, panel, and displayed results.
- Provide a clear way to clear a filter and return to the full graph.
- Keep the Insights panel collapsed by default; the repository graph and selected-file context remain the primary experience.

### 5. Data and performance

- Use the existing parser output and graph representation as the source of truth.
- Do not fabricate edges for unresolved imports.
- Represent unresolved relationships or analysis limitations separately where the existing data supports them.
- Use iterative graph algorithms for cycle detection and traversal where appropriate; avoid recursion that can overflow on large repositories.
- Cache computed results only if the cache can be invalidated reliably when the graph changes.
- Avoid repeated full-graph calculations on every render. Memoize or compute results at the appropriate data layer.
- Do not introduce a new backend service or database schema unless the existing implementation proves it is necessary.
- Do not make network requests just to calculate blast radius, dependency chains, or structural insights from an already-loaded graph.

## Constraints

- **Deterministic analysis first.** Dependency relationships, graph traversal, cycle detection, counts, and structural insights must be derived from repository data—not generated by an AI model.
- **No invented certainty.** Blast radius means potentially affected code, not guaranteed breakage.
- **Evidence must be inspectable.** A developer should be able to open a result and verify the dependency path.
- **Respect graph limitations.** Static import analysis may not capture runtime behavior, reflection, aliases the parser cannot resolve, dependency injection, or framework conventions. Do not imply complete coverage.
- **Keep current architecture.** Inspect the existing repository and reuse its graph types, parser output, components, styling, and state-management patterns before making changes.
- **Do not regress existing screens.** Preserve the landing page, authentication, workspace shell, repository views, and existing graph interactions.
- **No unrelated redesign.** Improve the existing experience only as needed to deliver this phase.
- **Accessible interactions.** Filters and result actions must work with keyboard navigation, have visible focus states, and remain usable on narrower screens.
- **Honest language.** Avoid calling a file “unused,” a change “unsafe,” or a result a “bug” unless the available evidence supports that claim.

## Acceptance checks

1. Select a file and open **Blast radius**. Results appear promptly from the loaded graph without a new network request.
2. Manually inspect at least two returned files and verify that the displayed dependency paths exist in the parser's edge list.
3. Open **Dependency chain** for the same file and verify that traversal follows the opposite direction from blast-radius traversal.
4. Confirm that the default depth is two levels, that results are deduplicated, and that changing depth changes results predictably.
5. Select multiple changed files in a test fixture and verify that the combined blast radius does not duplicate files shared by multiple paths.
6. Verify cycle detection against at least one real cycle in a checked-in fixture or repository. Manually confirm the reported cycle.
7. Verify that a file with no incoming imports is reported descriptively, while known framework entry points are not incorrectly presented as unused.
8. Verify the highly depended-on and large-file insights against known fixture data and documented thresholds.
9. Select a rail category. Matching elements remain emphasized, non-matching elements are dimmed but remain visible, and the counts agree with the panel results.
10. Select a result and confirm that the graph and detail pane focus the same file.
11. Test empty results, unresolved imports, large graphs, keyboard use, and narrow layouts.
12. Inspect the browser network tab while using these graph features. No network request should be made solely to calculate local graph results.
13. Run the project's available lint, type checks, tests, and production build when the environment has sufficient disk space. Report any checks that could not be completed.

## Implementation approach

1. Inspect the existing parser output, graph edge direction, graph components, detail pane, and navigation rail before coding.
2. Confirm and document the meaning of each edge direction. Add small graph fixtures to prevent direction mistakes.
3. Implement and test the shared traversal utility.
4. Implement iterative cycle detection and the remaining structural insight calculations.
5. Connect results to the detail pane and graph selection.
6. Connect insight filters and matching counts to the navigation rail.
7. Test against a small known fixture and a representative real repository.
8. Run validation checks and summarize changed files, verified behavior, limitations, and any remaining work.

## Out of scope for this phase

- GitHub App installation and live Pull Request ingestion, unless already implemented and explicitly needed to pass the existing workflow.
- AI-generated explanations or AI-based risk scoring.
- Claims that a change will definitely break production.
- Automated test execution or CI integrations.
- Cross-language analysis beyond the languages the existing parser supports.
- Code review comments, code generation, or integration with CodeRabbit.

## Completion report

When finished, report:

- What was implemented.
- Which existing components and files were reused.
- Tests and validation commands run, with actual results.
- Known limitations and unhandled graph relationships.
- Any UI or behavior that remains incomplete.

Do not mark the phase complete merely because the UI renders. The graph results must be checked against the underlying repository edges.
