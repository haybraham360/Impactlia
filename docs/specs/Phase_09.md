# Impactlia — Phase 8: Framework Adapters and Route Intelligence

## Goal

Help Impactlia recognize common JavaScript/TypeScript application structures so its repository map becomes more useful than a list of imports. This phase adds deterministic framework detection, concrete file roles, and route extraction where the source code provides enough evidence.

The adapters enrich Impactlia's existing repository analysis. They must not replace the dependency parser, invent routes, or imply that framework-specific behavior has been fully understood.

## Build

### 1. Framework detection

Implement a small framework-detection layer that evaluates supported frameworks in a documented, fixed order. Use repository metadata and recognizable source/configuration patterns where appropriate.

Initial supported adapters:

- **Next.js**
- **NestJS**
- **React**

The first confident match wins. If no adapter matches, the repository must still analyze successfully using generic file roles and an empty route table.

Keep framework-specific detection and parsing inside their adapter modules. The parser core should expose a framework-neutral adapter interface and must not contain framework-name-specific branching scattered throughout the core.

### 2. Next.js adapter

Recognize Next.js repository conventions and derive roles from file paths and syntax that the adapter can verify.

Where supported by the existing project and parser:

- Identify page routes from App Router and/or Pages Router conventions.
- Identify API endpoints from the supported route-file conventions.
- Identify server actions only when the source syntax and supported conventions provide sufficient evidence.
- Distinguish route files from ordinary components and utility modules.
- Preserve the exact file path and the reason the role was assigned.

Do not infer a route merely because a file name looks plausible. Document which Next.js conventions are supported and leave unsupported patterns unclassified rather than guessing.

### 3. NestJS adapter

Recognize NestJS repository conventions and assign concrete roles using filename suffixes and syntax where available.

Initial roles may include:

- Controllers
- Services
- Modules
- Entities

For controller routes, combine the controller-level path decorator and method-level route decorator only when both values and the HTTP method are statically recoverable from parsed syntax.

- Preserve the controller file, method name, HTTP method, and full route pattern.
- Normalize route joining consistently without silently changing parameter names or optional segments.
- If the controller prefix, method path, or HTTP method cannot be recovered reliably, do not emit a route for that handler.
- Keep the source locations or evidence needed to inspect why a role or route was assigned.

### 4. React adapter

Provide a lightweight React adapter for repositories that use React without matching a more specific supported framework.

- Identify likely React component files using deterministic evidence supported by the parser.
- Keep component-role classification conservative.
- Do not treat every JSX-containing file as a route.
- Reuse shared adapter infrastructure rather than duplicating framework-detection and result-storage logic.

### 5. Route registry and route table

Create a framework-neutral route record suitable for storing and displaying extracted routes.

Each route record should include, where available:

- Repository and analysis identifiers.
- Source file path.
- HTTP method, if the route is an HTTP endpoint.
- Full route pattern.
- Framework and route kind.
- Handler or exported symbol when recoverable.
- Evidence/source location for verification.

Render extracted routes in a table within the existing repository explorer.

- Make the source file clickable so selecting a route focuses the corresponding node and detail pane.
- Display method, route pattern, and source path clearly.
- Distinguish browser page routes from HTTP/API endpoints and other supported route types.
- Provide a useful empty state when no routes can be confidently extracted.
- Do not display guessed routes as facts.

If the current data model stores analysis results persistently, store route records against the corresponding analysis using the existing schema patterns. Add a migration only if needed.

### 6. Framework-aware navigation rail

Make the navigation rail reflect the detected framework using concrete role names.

Examples:

- **Next.js:** Page routes, API endpoints, Server actions, Components, Utilities.
- **NestJS:** Controllers, Services, Modules, Entities, Utilities.
- **React:** Components, Hooks, Utilities, Tests, where each category is supported by deterministic rules.

Requirements:

- Keep the taxonomy in a framework-neutral module separate from parser and filesystem code so browser components can render category names without importing parser dependencies.
- Keep category order stable and documented.
- Put routable surfaces first, application layers next, and supporting/plumbing roles afterward.
- Show counts based on actual analyzed files, not placeholder values.
- Selecting a category should reuse the existing graph-filter behavior: emphasize matching files and dim non-matching files without removing the repository's overall shape.
- If no adapter matches, show generic categories rather than a broken or empty workspace.

### 7. Evidence and uncertainty

- Record why a framework and file role were selected, where practical.
- Prefer exact syntax and documented file conventions over naming guesses.
- Keep unsupported or ambiguous files in a generic/unknown role.
- Never convert an uncertain classification into a confident route record.
- Do not label a file as unused or broken merely because its role is unknown.

## Constraints

- **Deterministic adapters only.** No AI classification in this phase.
- **Exact routes or no route.** Emit a route only when the HTTP method and complete route pattern are recoverable from supported source syntax and conventions. If either is ambiguous, omit the route and report the limitation where useful.
- **Fixed detection order.** Document the order and ensure the same repository produces the same adapter choice.
- **Generic fallback.** A repository that matches no supported adapter must still render with generic roles and an empty route table.
- **Keep the parser core framework-neutral.** Framework-specific terms and logic belong in adapter modules and the separate role-taxonomy definitions.
- **Reuse existing graph and storage structures.** Inspect the current implementation before adding new types, tables, or UI components.
- **No broad redesign.** Extend the existing Impactlia explorer and navigation rail.
- **Respect static-analysis limits.** Do not execute repository code to discover routes. Dynamic decorators, computed paths, runtime configuration, and unsupported conventions may remain unresolved.
- **No unrelated scope expansion.** Do not add private GitHub access, live Pull Request ingestion, AI classification, Express support, or CommonJS `require()` parsing in this phase unless explicitly approved as a separate task.

## Acceptance checks

1. Analyze a supported Next.js repository and verify that the navigation rail shows the expected supported categories with counts derived from actual files.
2. Verify representative App Router and/or Pages Router page routes against the actual file structure.
3. Verify API route extraction only for conventions explicitly supported by the adapter.
4. Analyze a NestJS repository and verify that controller, service, module, and entity roles are assigned from actual evidence.
5. For multiple NestJS handlers, compare the extracted HTTP method and full route pattern against the controller and method decorators in source. Any uncertain route must be omitted rather than guessed.
6. Open a route from the route table and verify that the correct source file is selected in the graph and detail pane.
7. Analyze a React repository that does not match Next.js. Confirm the React adapter is selected and component classification follows documented deterministic rules.
8. Analyze a repository that matches no adapter. Confirm analysis succeeds, generic roles remain available, and the route table is empty rather than misleading.
9. Confirm category counts agree with the analyzed files and graph filters preserve non-matching nodes in a dimmed state.
10. Confirm framework-specific detection lives in adapter modules and the parser core does not contain scattered checks for framework names.
11. Test ambiguous route definitions, computed decorator values, unsupported file conventions, and malformed source. Confirm these cases do not produce invented route records.
12. Run available lint, type checks, tests, and a production build when the environment has sufficient disk space. Report any checks that could not be completed.

## Implementation approach

1. Inspect the current parser interface, repository metadata, role representation, graph filtering, analysis persistence, and explorer layout.
2. Define the framework-neutral adapter contract and route record shape based on existing code.
3. Implement and test fixed-order framework detection with a generic fallback.
4. Implement Next.js role and route extraction for explicitly supported conventions.
5. Implement NestJS role detection and exact route assembly from supported decorators.
6. Implement the lightweight React fallback adapter.
7. Add or extend route persistence and the route table only as required by the existing architecture.
8. Connect role categories to the existing navigation rail and graph filtering.
9. Validate the output against representative repositories and manually verify route patterns against source code.
10. Report changes, test results, supported conventions, and known limitations.

## Out of scope for this phase

- AI classification of files that no adapter recognizes.
- Express adapter support.
- CommonJS `require()` dependency parsing.
- Runtime route discovery by executing the repository.
- Private GitHub repository access and live Pull Request ingestion.
- AI-generated risk scores or code-review comments.

## Completion report

When finished, report:

- Framework adapters implemented and their detection order.
- File-role rules and route conventions supported.
- Example routes verified against source code.
- How route records are stored and displayed.
- How the framework-aware navigation rail gets its categories and counts.
- Tests and validation commands run, with actual results.
- Unsupported patterns and remaining limitations.

Do not mark this phase complete merely because the route table renders. Verify extracted roles and route patterns against the actual repository source.
