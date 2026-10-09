# Prompt 2 — Make the Impactlia code-impact graph interactive

Now focus specifically on improving the interactive dependency graph demonstration on the Impactlia landing page.

Keep the existing design and content. Enhance the current graph rather than redesigning the entire page.

I want the graph to demonstrate the central idea behind Impactlia: one code change can affect other parts of a codebase.

## Introductory animation

1. When the graph becomes visible, reveal the changed-file node or nodes first.
2. Animate their outgoing dependency connections.
3. Reveal the connected potentially affected files.
4. Display the impact summary after the graph has settled.

After the introductory animation, allow visitors to interact with the graph.

## Graph interaction

When a visitor hovers over or selects a node:
- Highlight that node.
- Highlight its relevant dependency connections.
- Highlight directly connected files.
- Dim unrelated nodes and connections.
- Display a concise label explaining the selected node's role.

Provide a clear visual distinction between:
- Changed files.
- Potentially affected files.
- Other repository files.

Use the existing colour palette and make sure these distinctions are not communicated through colour alone.

When the visitor clears the selection, restore the graph.

The interaction must work on touch devices and support keyboard accessibility. Do not make hover the only way to access important information.

## Important constraints

- Use the existing graph data and components wherever possible.
- Do not fabricate relationships or imply that the displayed example is a real analysis.
- Do not add fake risk scores or unsupported product claims.
- Keep the graph lightweight and responsive.
- Avoid continuous animation after the initial sequence.
- Respect reduced-motion preferences.
- If the current graph is a static illustrative SVG, enhance that implementation rather than introducing an entirely separate graph system.

## Verification

Test the final interaction at desktop and mobile widths, and run the relevant project checks.

The objective is for a first-time visitor to understand the relationship between a changed file and the other files it could affect simply by watching and interacting with the graph.
