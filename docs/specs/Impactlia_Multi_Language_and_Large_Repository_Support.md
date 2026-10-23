# Impactlia — Multi-Language Analysis and Large Repository Support

## Instructions for Claude Code

## 1. Objective
Expand Impactlia beyond its current JavaScript/TypeScript focus so it can analyze pull requests in commonly used languages, including Python, JavaScript, TypeScript, Java, C, C++, C#, Go, Rust, PHP, Ruby, Kotlin, Swift, Dart, SQL, and relevant configuration formats.

Also improve repository ingestion so Impactlia can handle repositories larger than the current 100 MB limit without inefficiently loading or processing the entire repository.

**Scale the existing product; do not rewrite it.** Preserve the current UI, authentication, PR workflow, impact graph, test recommendations, risk scoring, and GitHub integration wherever possible.

## 2. Audit Before Editing
Inspect and document:
1. How the JavaScript/TypeScript analyzer works.
2. How language selection, parsing, symbol extraction, imports, references, dependency graphs, and test discovery work.
3. Exactly where the 100 MB limit is enforced and what it measures: GitHub repository size, downloaded archive, extracted source bytes, scanned bytes, a single file, or an internal quota.
4. How repository contents are fetched, stored, parsed, cached, and deleted.
5. Memory, timeout, API, request-size, job-duration, and provider limits.
6. Current deployment and background-job constraints.
7. Existing tests and language-specific assumptions.

Do not guess what the 100 MB limit means. Trace the implementation and identify every relevant limit before changing it. Write a concise plan before editing.

## 3. Architecture: Shared Core and Language Adapters
Separate common analysis behavior from language-specific parsing with minimal disruption.

The shared pipeline should handle:
- Repository and PR revision identification
- Changed-file and diff extraction
- Language detection
- Relevant source-context retrieval
- Normalized symbol and dependency data
- Impact analysis
- Test discovery/recommendations where supported
- Risk scoring where supported
- Evidence, confidence, and limitation reporting
- Persistence and UI results

Each language adapter should expose a consistent contract for:
- Detecting relevant files
- Parsing changed files and selected context
- Extracting symbols and declarations
- Identifying imports/modules and reliable dependencies
- Mapping changed symbols to potentially affected code where supported
- Finding tests using language-specific conventions
- Returning structured diagnostics and limitations

Adapt interfaces to the existing architecture; do not create redundant abstractions. For every relationship, preserve evidence and confidence. If a relationship cannot be resolved reliably, report it as unknown rather than inventing a dependency.

Define capability levels, for example:
- **Basic:** language detection and changed-file analysis
- **Dependency-aware:** symbol/import/dependency analysis with evidence
- **Test-aware:** related test discovery and scenario suggestions
- **Advanced:** framework-specific or compiler-assisted analysis where available

Do not claim full support when only file extensions are recognized.

## 4. Language Strategy
Keep JavaScript and TypeScript working. Recommended first wave:
1. Python
2. Java
3. Go
4. C#
5. C and C++
6. Rust
7. PHP

Then consider Ruby, Kotlin, Swift, Dart, SQL, and other formats based on user demand and architecture.

Language-specific considerations:
- **Python:** modules, imports, classes/functions, package structure, `tests/`, and `test_*.py` conventions.
- **Java:** packages, imports, classes/methods, modules, and common test conventions such as JUnit.
- **C/C++:** headers, source files, include relationships, declarations/definitions, build configuration, and test frameworks when detectable.
- **C#:** namespaces, `using` directives, classes/methods, solution/project boundaries, and test frameworks.
- **Rust:** crates, modules, `use` statements, public items, Cargo workspaces, unit tests, and integration tests.
- **Go:** packages, imports, exported symbols, modules, and `*_test.go`.
- **PHP:** namespaces, `use` statements, classes/functions, Composer packages, and test conventions.
- **Ruby:** modules, classes, `require` relationships, Bundler configuration, and test conventions.
- **Kotlin/Swift/Dart:** module/project structure, imports, declarations, and ecosystem-specific tests.
- **SQL:** queries, migrations, schema changes, stored procedures, and relationships supported by available schema evidence.

Use appropriate parsers or static-analysis tools where practical. Do not rely on regular expressions alone for complex syntax or claim semantic analysis when only lexical matching is implemented.

Before adding tooling, inspect the current stack, deployment constraints, licensing, native binary compatibility, memory use, and runtime support. Tree-sitter or native tooling may be suitable depending on the language, but choose deliberately. Avoid installing every compiler/toolchain into the web runtime. Isolate heavy tools behind adapters/workers when appropriate. Do not introduce paid external services without approval.

## 5. Multi-Language Impact Analysis
For each PR:
1. Detect changed files and languages.
2. Parse changed files using the relevant adapters.
3. Retrieve only necessary context, such as imported modules, referenced symbols, dependency neighbors, tests, and configuration.
4. Build/update dependency relationships with evidence.
5. Identify potentially affected files/components where supported.
6. Recommend relevant tests using language-specific conventions.
7. Report unsupported constructs, missing dependencies, and partial analysis.
8. Feed normalized evidence into existing risk scoring and UI.

Support mixed-language repositories. Do not silently ignore files because another language is present. Do not imply cross-language relationships without evidence such as API contracts, generated schemas, RPC definitions, build metadata, or configuration.

## 6. Large Repository Support: Address the Actual Bottleneck
Do not simply raise the limit to an arbitrarily large number. First identify the actual limit and resource constraints. Aim for **incremental, selective, bounded processing**.

### 6.1 Separate resource budgets
Where appropriate, configure separate limits for:
- Repository metadata size
- Downloaded archive/clone size
- Total extracted source bytes
- Individual file size
- Number of files indexed
- Files parsed per job
- Diff size
- Related context retrieved per changed symbol
- Job duration and memory
- GitHub API request volume
- Cache/storage usage
- AI context/token budget, if applicable

Do not use one 100 MB threshold for all resources. Set safe defaults based on the actual deployment environment and document the configurable limits.

### 6.2 Analyze the PR diff first
For PR analysis, do not fetch or parse the entire repository unless needed:
1. Fetch PR metadata, base/head SHAs, and changed-file information.
2. Retrieve the diff and changed file contents for the exact revision.
3. Analyze changed files first.
4. Expand selectively to imports, references, graph neighbors, tests, and configuration.
5. Stop expansion when a defined budget is reached.
6. Report what was analyzed and what was omitted.

### 6.3 Incremental repository index
Where broader dependency analysis needs repository-wide context, implement or improve an incremental index:
- Index a specific commit/revision.
- Store useful metadata such as path, language, size, content hash, symbols, imports, dependency edges, and index status.
- On a new commit, re-index changed files and update affected dependency relationships.
- Reuse cached results only when content hash, revision relationship, parser version, and configuration make it safe.
- Remove/invalidate deleted and renamed files.
- Support clean full re-indexing to recover from stale or corrupted index state.
- Make index freshness visible; never present stale results as current.

Do not assume a file is unchanged just because its path is unchanged. Use content hashes or reliable Git revision information.

### 6.4 Memory and CPU efficiency
- Stream archive entries/files where possible.
- Avoid loading the full repository into memory.
- Process bounded batches with bounded concurrency.
- Skip generated, vendored, binary, build-output, and dependency directories by default, with configuration for inclusion where needed.
- Respect `.gitignore` and language-specific ignore conventions where appropriate.
- Detect binary and oversized files before parsing.
- Use per-file timeouts and isolate parser failures so one file does not fail the entire repository.
- Support cancellation and cleanup for abandoned/superseded jobs.
- Keep CPU-heavy indexing out of request handlers; use durable background jobs compatible with current hosting.
- Avoid retaining full source contents longer than needed.
- Add safe archive extraction limits to prevent archive bombs and path traversal.

### 6.5 Retrieval and API limits
Inspect the current retrieval method before changing it. Use GitHub APIs or shallow/filtered Git fetch where appropriate. Avoid downloading all history when a PR revision is enough. Handle pagination, rate limits, large diffs, binary files, renames, deletions, and truncated responses. If required context cannot be retrieved, report partial analysis. Verify access to private repositories.

### 6.6 Partial results and explicit limits
When a budget is reached, do not silently stop. Where useful, report:
- Revision analyzed
- Languages detected
- Changed files analyzed
- Related files inspected
- Files skipped and why
- Whether the dependency index was complete or partial
- API, size, timeout, parser, or resource limits reached
- Confidence and limitations

Never label partial analysis as complete.

### 6.7 Configuration and abuse protection
Replace hardcoded limits with validated server-side configuration where appropriate. Increase limits only after load testing. Add sensible per-user/repository concurrency and rate limits. Protect against huge files, generated content, malicious repositories, deeply nested archives, and expensive parsing. Do not let unauthenticated users exhaust resources.

## 7. Cache, Index, and Persistence
- Reuse existing persistence/caching patterns.
- Key cached results by content hash/revision, parser/adapter version, and relevant configuration.
- Invalidate cache when source content or analysis logic changes.
- Avoid duplicate index jobs for the same revision.
- Ensure private repository data is isolated by authorization.
- Apply existing retention/deletion behavior to indexes and cached source data.
- Add migrations only if necessary and follow project conventions.

## 8. UI
Preserve the existing UI. Where useful, show:
- Languages detected
- Capability level per language
- Files analyzed and related files inspected
- Complete versus partial analysis
- Limits reached and why files were skipped
- Unsupported constructs or unavailable tooling

Do not claim a language is fully supported if only detection is implemented. Keep technical details in an expandable section.

## 9. Testing Requirements

### Language tests
- Existing JavaScript/TypeScript behavior remains unchanged.
- Python imports, symbols, changed functions, and test discovery.
- Java packages/imports and related tests.
- C/C++ include relationships and source/header changes.
- C# namespaces/imports and project boundaries.
- Rust modules/imports and test conventions.
- Go package/import relationships and tests.
- PHP namespaces/imports and tests.
- At least one mixed-language repository.
- Unknown languages and unsupported syntax do not crash analysis.
- A parser failure is isolated to the affected file.

Use fixture repositories with known relationships. Do not claim relationships not established by the fixtures.

### Large repository tests
- A repository larger than the current 100 MB limit
- Many small files and a few very large files
- Binary and generated files
- Deleted, renamed, and moved files
- Truncated diffs and API rate limits
- Timeout, cancellation, and partial analysis
- Incremental indexing after a small change
- Cache invalidation after content changes
- Stale index recovery and full re-indexing
- Memory/concurrency budgets and archive extraction safeguards

### Regression and security
- Existing PR analysis, risk scoring, test recommendations, and GitHub workflows continue working.
- Private repository authorization is preserved.
- Secrets and private source content are not exposed.
- Partial analysis is clearly represented.

## 10. Implementation Phases

### Phase 1 — Audit
Trace language adapters and the 100 MB restriction. Report its exact source, what it measures, the real bottleneck, and a proposed plan.

### Phase 2 — Shared core
Introduce/refine the language adapter contract with minimal disruption to JavaScript/TypeScript.

### Phase 3 — Python end-to-end
Implement Python parsing, symbol/import relationships, and test discovery. Integrate it into impact analysis and results. Add fixtures/tests.

### Phase 4 — Additional languages
Add Java, Go, C#, C/C++, Rust, and PHP incrementally. Then add other languages based on the same adapter contract and user demand. Keep the capability matrix accurate.

### Phase 5 — Selective ingestion
Replace the single repository-size assumption with explicit resource budgets. Analyze PR diffs first and fetch related context selectively.

### Phase 6 — Incremental indexing
Implement revision-aware caching/indexing where needed, including changed-file updates, deletions, invalidation, and clean re-indexing.

### Phase 7 — Large-repository hardening
Add bounded concurrency, file-size limits, timeouts, cancellation, archive safeguards, rate-limit handling, and partial-result reporting.

### Phase 8 — UI and validation
Display language capabilities and partial-analysis information in the existing UI. Run tests against larger repositories and document setup, limits, deployment needs, and costs.

Implement incrementally; do not attempt to support every language or rewrite ingestion in one change.

## 11. Acceptance Criteria
- Current JavaScript/TypeScript support continues working.
- Python is supported end-to-end, not just detected by extension.
- New languages can be added without duplicating the whole pipeline.
- Additional languages are added with tests and clearly documented capabilities.
- Mixed-language PRs are handled without silently ignoring files.
- The exact 100 MB limit is identified and adjusted to address the actual bottleneck.
- Larger repositories can be analyzed within explicit resource budgets.
- PR analysis prioritizes changed files and selectively retrieves context.
- Indexing, where used, is incremental and revision-aware.
- Large files, generated content, binary files, timeouts, and API limits are handled safely.
- Partial results and skipped files are reported honestly.
- Existing security, UI, and analysis features remain functional.
- Automated tests cover languages, large repositories, indexing, resource limits, and regressions.
- No unapproved paid services are introduced.

## 12. Instructions to Claude Code
Work inside the existing Impactlia repository.

1. Inspect the codebase before making assumptions.
2. Identify the exact code enforcing the 100 MB limit and explain what it measures.
3. Preserve existing JavaScript/TypeScript support and working product features.
4. Do not add superficial extension-based “support”; implement real parsing and evidence-based relationships.
5. Start with a shared adapter interface and one complete additional language (Python), then add languages incrementally.
6. For large repositories, prefer selective retrieval, bounded processing, and incremental indexing over simply removing limits.
7. Do not introduce paid services without explaining why and likely cost.
8. Run relevant checks and tests.
9. Finish with a report covering architecture changes, languages/capability levels, the origin of the 100 MB limit, resource budgets, indexing strategy, files changed, tests, configuration, performance/cost implications, and limitations.

**Product principle:** Impactlia should support diverse codebases and larger repositories through accurate, evidence-based analysis and efficient processing—not merely by accepting more extensions or raising a size limit without addressing the underlying resource constraints.
