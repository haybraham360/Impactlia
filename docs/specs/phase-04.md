# Phase 4 — The Impact Graph

**Goal.** Put the repository structure produced by the parser on screen as a useful, deterministic visualization that will later become the foundation for showing Pull Request blast radius.

This phase is about proving that the parser's real dependency data can be understood visually. It is not yet the PR impact report.

## Build

- Run the Impactlia parser against a real TypeScript/JavaScript repository on disk and use its typed output as the data source for the canvas.
- The parser output is the contract. Do not reshape or fabricate graph data simply to make the interface easier to render.
- Use a repository large enough to test the visualization properly: preferably a few hundred files with real nesting, shared modules, and meaningful dependency relationships.
- A development preview route should render the parser output through the real Impactlia interface without requiring GitHub, authentication, or a database-backed analysis.
- **Settle the main analysis layout here.** The canvas should establish the structure later PR impact views will use:
  - a narrow left rail for repository/file information
  - the dependency graph in the middle
  - a right-side detail pane
- The left rail should show useful file/module categories and counts derived from the parser output. Categories must represent real repository data, not invented classifications.
- **Repository folding.** Start with the repository's actual directory structure. Collapse small/deep directories into their parents using a deterministic rule so a large repository becomes readable without destroying its underlying structure.
- The folding threshold should adapt to repository size rather than assuming that every repository has the same ideal number of visible nodes.
- Opening a folded directory should expose its files while keeping the directory as a coherent visual group.
- A folder/group should show useful structural information such as its name, file count, fan-in, and fan-out where those values are available.
- File rows inside an expanded group must be selectable.
- Selecting a file or group should highlight its real dependency relationships and visually de-emphasize unrelated nodes.
- The visualization should make incoming and outgoing relationships distinguishable because this distinction will become important when Impactlia later explains PR blast radius.
- Layout must be deterministic. The same parser output should produce the same graph structure and initial layout every time.
- The canvas should use the available space effectively and remain readable at a useful zoom level.

## Why this matters to Impactlia

The graph is not the product by itself.

Its purpose is to make the repository relationships understandable enough that, in a later phase, a developer can see something like:

```text
Changed:
payment.ts

Potentially affected:
checkout.ts
order.ts
invoice.ts
refund.ts
```

and understand **why** those files appear.

The graph must therefore preserve the truth of the parser output. It should never create a visually convincing relationship that does not exist in the analysis data.

This phase establishes the visual foundation for the future workflow:

**Repository structure → changed files → affected files → blast radius → risk explanation**

## Constraints

- **The parser output remains authoritative.** Do not create a second, incompatible representation of dependency relationships just for the UI.
- Any data needed by the canvas but absent from the parser output must be derived from that output. Do not manually duplicate repository facts.
- Do not use AI to decide node relationships, folder membership, dependency direction, or layout semantics.
- Do not build Pull Request-specific highlighting yet. The graph should work from repository data alone.
- Do not calculate risk in this phase.
- Do not label a file as “affected,” “risky,” “broken,” or “critical” unless that property is actually part of the current data contract. Those concepts belong to later analysis phases.
- Do not introduce arbitrary node limits that silently remove files or edges.
- If the repository is too large to display completely, use deterministic folding/grouping rather than silently dropping relationships.
- Folder grouping must preserve the underlying file and edge relationships.
- Labels should be the shortest text that remains unambiguous in the current view.
- Node size must not imply importance unless it is explicitly based on a meaningful structural metric. A long filename should not look more important merely because it is long.
- The detail pane should exist as a stable part of the layout. It should not become a modal or temporary overlay that later phases have to replace.
- Opening a folder/group may refit the view, but refitting must not unexpectedly zoom into the opened area and lose the surrounding graph.
- No ambient animation, pulsing, drifting nodes, or decorative motion.
- Do not add a dashboard full of unrelated repository metrics. Every visible metric should help the user understand repository structure or dependencies.

## Impactlia visual language

The graph should eventually distinguish three important states:

- **Changed** — files directly modified by a Pull Request.
- **Affected** — files reached through known dependency relationships from changed files.
- **Unrelated** — repository elements outside the current impact view.

This phase does not need to implement PR states yet, but the graph architecture should not make those future states difficult to introduce.

Dependency direction must also remain clear:

- Incoming relationships show what depends on a selected file.
- Outgoing relationships show what the selected file depends on.

This distinction is central to Impactlia's future blast-radius experience.

## Acceptance check

**Run the parser and report the actual numbers.**

1. Render a real repository from the Phase 3 parser output.
2. Report the number of source files represented by the graph.
3. Report the number of dependency edges represented.
4. Report the number of visible top-level/group nodes after deterministic folding.
5. Confirm that every rendered dependency edge terminates at an existing rendered node or an explicitly represented collapsed group.
6. Confirm that no dependency edge was invented by the UI layer.
7. Confirm that selecting a file highlights that file and its real dependency relationships while unrelated elements are visually de-emphasized.
8. Open an expanded folder/group and confirm its files appear inside the group while the underlying dependency edges remain connected correctly.
9. Close the group and confirm the graph returns to its previous structural representation.
10. Run the same parser output twice and confirm the graph structure and initial layout are deterministic.
11. Confirm that the graph uses the available canvas rather than clustering in one small area.
12. Confirm that labels remain readable at the default view.
13. TypeScript checks, lint, and the production build pass.

## Not in this phase

GitHub repository connection. GitHub Pull Request retrieval. PR diff parsing. Changed-file detection from a Pull Request. Blast-radius calculation. Risk scoring. AI explanations. Recommended tests. Repository chat. GitHub Checks. CI/CD integration. Production telemetry. Merge gates.

The graph in this phase represents the **repository's real structure**. Later phases will use the same graph to show what a specific code change could affect.

This phase ends when a real repository can be explored visually through its actual dependency structure, without the canvas inventing or hiding relationships.
