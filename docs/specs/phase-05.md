# Phase 5 — The Impactlia detail pane

**Goal.** Let a developer select any repository node and understand what it is, what it depends on, and what depends on it. This detail pane turns the graph from a picture into an explorable explanation of the repository's actual structure.

This phase uses the parser output and graph established in Phases 3 and 4. It does not yet calculate the impact of a Pull Request.

## Build

- **Repository summary when nothing is selected.** The right-hand pane should be useful immediately, before anyone clicks the graph. Show the repository name, detected framework when supported, and the counts available from the parser: files, imports/dependency relationships, and detected routes where the current parser or adapter can reliably identify them.
- Show a ranked list of the most depended-on files, ordered by the number of files that import or depend on them.
- Show a list of files with no known dependents. These can be useful starting points for exploring the repository, but do not label them as unused or unnecessary without stronger evidence.
- Show how many files or patterns could not be identified by the available parser/framework conventions, if that information exists in the parser output.
- **File selection.** When a file is selected, show its repository-relative path, file type, line count, parse status, number of dependencies it uses, number of files that depend on it, and the full lists of both relationships.
- Each dependency/dependent row should identify the relationship direction clearly.
- **Two tabs: Structure and Explanation.** Structure shows facts derived from parser output. Explanation is an honest empty state in this phase; it must not pretend an AI explanation exists before the explanation feature is implemented.
- **Folder selection.** When a folded directory/group is selected, show its path/name, file count, and the composition of the folder by file type. Show other group-level structural facts only when they can be derived reliably from the existing data.
- Every file path shown in the pane is clickable. Clicking a path selects that file in the graph and updates the pane.
- Hovering a dependency or dependent in the pane highlights the corresponding node on the graph. Hovering a node on the graph highlights its corresponding row in the pane. Synchronize both directions.
- If the selected file or group has unresolved relationships or parsing limitations, show them clearly rather than implying the analysis is complete.

## Constraints

- **The parser output remains the source of truth.** Do not invent relationships, framework classifications, routes, or file metadata to populate the pane.
- Deselecting everything returns to the repository summary. This is the pane's resting state, not an empty placeholder.
- Selecting a node, hovering a relationship, switching tabs, or navigating to a listed file must not trigger a network request. All information in this phase is already present in the browser.
- Keep the currently selected tab when selection changes. For example, if a user is on Explanation and selects another file, Explanation remains open.
- The detail pane remains a stable part of the existing three-column layout. Do not turn it into a modal or redesign the application layout in this phase.
- Do not call an AI model in this phase. The Explanation tab is a future extension point only.
- Do not add Pull Request-specific concepts such as changed files, affected files, blast radius, or risk scores yet.
- Do not label a file as unused, dead, safe, risky, or broken based only on dependency counts.
- If route or framework detection is not implemented for a repository, show “Not detected” or omit that metric rather than guessing.
- Counts must match the actual rows and relationships shown in the pane. If a count is seven, seven corresponding entries must be available to inspect.

## Acceptance check

1. Load the graph with nothing selected. The pane immediately shows the repository summary, including available counts, the most depended-on files, files with no known dependents, and parser/convention coverage where available.
2. Select a file. The pane shows its path, type, line count, dependency count, dependent count, and full relationship lists.
3. Confirm in the browser network panel that selecting a file or folder, hovering a neighbour, switching tabs, and clicking a listed path trigger zero new network requests.
4. Hover a dependency/dependent row and confirm the matching graph node highlights without perceptible delay. Hover a graph node and confirm the corresponding pane row highlights.
5. Click a file path in the pane and confirm the graph selection and detail pane update to that file.
6. Select a folded directory/group and confirm the pane shows its path, file count, and file-type composition.
7. Open the Explanation tab, select a different file, and confirm the Explanation tab remains selected. Its content stays an honest empty state in this phase.
8. Confirm the import/dependency and dependent counts match the complete lists shown beneath them.
9. Confirm unresolved imports and parser limitations are visible where relevant and are not silently presented as resolved.
10. TypeScript checks, lint, and the production build pass.

## Not in this phase

Pull Request ingestion. Diff parsing. Changed-file detection. PR-specific impact analysis. Blast-radius calculations. Dependency-chain exploration buttons. Risk scoring. Recommended test selection. AI-generated explanations. Repository chat. GitHub Checks. CI/CD integration.

This phase ends when a developer can explore the real repository graph and understand a selected file or directory using the facts already available in the browser.
