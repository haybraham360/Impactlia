# Impactlia — Phase 9: CommonJS Dependency Analysis and Express Recognition

## Goal

Extend Impactlia's JavaScript/TypeScript repository analysis so CommonJS codebases that use `require()` produce meaningful dependency graphs instead of appearing empty or having misleading coverage figures.

This phase adds deterministic CommonJS dependency extraction and an Express framework adapter for file-role classification. It extends the existing parser and framework-adapter system without changing the meaning or output of existing import analysis.

## Build

### 1. CommonJS `require()` dependency extraction

- Detect calls to `require()` whose argument is a single literal string.
- Resolve these local module references using the same resolution rules and file-selection behavior already used by the existing import parser.
- Add resolved local dependencies to the existing graph using the same edge representation and direction as current import edges.
- Record unresolved literal `require()` references using the existing unresolved-dependency representation, where available.
- Read CommonJS export forms sufficiently to identify exported names supported by the existing parser architecture.
- Keep this work focused on static dependency relationships. Do not execute repository code to resolve module paths or exports.
- Ignore dynamic calls such as `require(variable)` when the target cannot be statically recovered. Record a limitation if the existing analysis model supports doing so.

### 2. Mixed CommonJS and ES module files

A file may contain both `require()` and ES module syntax.

- Collect both `require()` and existing `import`/`export` relationships.
- Deduplicate identical file-to-file edges so a relationship discovered through more than one syntax path does not appear multiple times.
- Preserve distinct source evidence where useful, even when the graph edge itself is deduplicated.
- Ensure existing ES module parsing behavior remains unchanged.
- Do not silently change edge direction, file identity normalization, extension handling, or resolution precedence.

### 3. Express framework adapter

Add an Express adapter to the existing framework detection and role-classification system.

- Detect Express repositories using supported, deterministic evidence such as package metadata and recognizable project structure.
- Assign concrete file roles using directory conventions.
- Support both singular and plural directory names, since real repositories use conventions such as `controller` and `controllers`, `route` and `routes`, or `middleware` and `middlewares`.
- Keep the supported directory patterns explicit and documented.
- Use generic roles for files that cannot be classified confidently.
- Ensure framework detection follows the existing fixed detection order and does not override a more specific supported adapter incorrectly.
- Keep Express-specific rules inside the Express adapter rather than adding Express-specific conditions throughout the parser core.

### 4. Express routes

Do **not** extract Express routes in this phase.

Express routes may be assembled dynamically from routers, variables, imported modules, and middleware chains. Under Impactlia's rule that routes must be exact or absent, the adapter must not invent route patterns or HTTP methods.

- Express repositories should receive supported file-role classifications.
- The route table should remain empty unless a route is independently recoverable by an already-supported, exact route extractor.
- Do not label the absence of extracted routes as proof that the application exposes no routes.
- Where appropriate, explain that Express route extraction is not supported in this phase.

### 5. Coverage and analysis reporting

CommonJS support must improve coverage reporting rather than simply increasing the number of edges.

- Review how the current parser calculates the coverage numerator and denominator.
- Ensure the denominator reflects the files and dependency references the analyzer actually considered, not only the imports it already knows how to parse.
- Include supported literal `require()` references in the appropriate coverage accounting.
- Keep unresolved references visible in coverage/limitations reporting where supported.
- Do not report 100% coverage merely because the parser resolved every reference it previously knew how to detect while ignoring CommonJS references entirely.
- If the existing system cannot calculate a defensible percentage, report the limitation rather than manufacturing a number.

## Constraints

- **Preserve existing ES module behavior.** This phase touches the parser core. Existing import resolution must not change as a side effect.
- **Regression requirement.** For a repository analyzed before this phase, the existing ES module edge list must remain byte-identical when comparing the old import-only output with the same import-only output after this change.
- **CommonJS support is additive.** New edges should come from statically recoverable literal `require()` calls and supported export analysis.
- **No duplicate graph edges.** Mixed `require()` and `import` syntax must not duplicate the same dependency relationship.
- **No execution of repository code.** Parsing and resolution must remain static and safe.
- **Express roles, not routes.** Express route extraction is explicitly out of scope.
- **Framework detection stays modular.** Keep the Express adapter separate from the parser core and shared role taxonomy.
- **Respect existing architecture.** Inspect and reuse the current parser, adapter interface, graph model, coverage calculation, and persistence structure before making changes.
- **Do not regress prior phases.** Preserve repository ingestion, stored analysis, graph navigation, blast-radius analysis, existing framework adapters, and route-table behavior.
- **No unrelated redesign.** Make only the interface changes needed to expose accurate role and coverage information.
- **Honest limitations.** Do not claim complete CommonJS or runtime dependency coverage; dynamic `require()` calls and other module systems remain unsupported.

## Acceptance checks

1. Analyze an Express repository that previously produced an empty or nearly empty graph because it used CommonJS. Confirm that the graph now contains a believable set of resolved local dependency edges.
2. Spot-check multiple extracted `require('./...')` references against source code and confirm that the target file and edge direction are correct.
3. Verify extension resolution and directory-index resolution follow the same established rules used by existing imports.
4. Analyze a file that mixes `require()` and ES module syntax. Confirm both forms are represented and identical file-to-file relationships are not duplicated.
5. Compare the existing import-only edge list for a repository analyzed before this change with the import-only edge list after this change. Confirm the output is byte-identical.
6. Verify unresolved literal `require()` references are reflected in the analysis limitations or coverage accounting where supported.
7. Confirm dynamic calls such as `require(variable)` do not create invented edges.
8. Confirm coverage for a CommonJS-heavy repository uses a meaningful denominator and does not report 100% simply because CommonJS references were previously ignored.
9. Analyze an Express repository with singular directory names and another with plural directory names. Confirm supported controller, route-module, and middleware roles are classified consistently according to the documented patterns.
10. Confirm an Express repository still renders successfully when some files cannot be classified, using generic roles for those files.
11. Confirm Express route extraction is not fabricated: the route table remains empty unless a supported exact extractor has verified routes.
12. Confirm the Express adapter is modular and the parser core contains no scattered Express-specific classification logic.
13. Run available lint, type checks, parser tests, regression fixtures, and a production build when the environment has sufficient disk space. Report any checks that could not be completed.

## Implementation approach

1. Audit the current parser's import extraction, resolution algorithm, graph-edge representation, export handling, coverage formula, adapter interface, and regression fixtures.
2. Save a baseline import-only edge list for at least one existing repository before changing the parser.
3. Add literal `require()` extraction and route it through the existing resolution logic without changing existing import behavior.
4. Add CommonJS export recognition only for forms the parser can statically support.
5. Merge CommonJS and ES module dependencies with deterministic edge deduplication.
6. Correct or extend coverage accounting so it includes the dependency syntax the parser is intended to analyze.
7. Add the Express adapter and explicit singular/plural directory-role rules.
8. Connect adapter roles to the existing navigation rail while preserving generic fallback behavior.
9. Run baseline regression comparisons, CommonJS fixtures, Express repository checks, and coverage tests.
10. Summarize the implementation, actual validation results, supported syntax, and remaining limitations.

## Out of scope for this phase

- Express route extraction.
- Dynamic `require()` arguments that cannot be statically resolved.
- Other module systems beyond the existing ES module support and the literal CommonJS `require()` patterns implemented here.
- Runtime execution of repositories to discover dependencies or routes.
- AI-based file classification.
- Private repository access, live Pull Request ingestion, AI risk scoring, or CodeRabbit integration.

## Completion report

When finished, report:

- CommonJS patterns supported and unsupported.
- How `require()` dependencies are resolved and deduplicated.
- Evidence that existing import-only output remains unchanged.
- Express role conventions implemented, including singular and plural folder patterns.
- How coverage is calculated and how unresolved references affect it.
- Tests and validation commands run, with actual results.
- Known limitations and any incomplete functionality.

Do not mark this phase complete merely because an Express repository now displays nodes. Verify the extracted edges against source code and demonstrate that existing ES module results have not changed.
