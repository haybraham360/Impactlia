# Phase 3 — The repository parser

**Goal.** Turn a TypeScript or JavaScript repository on disk into a reliable, typed representation of its files and real dependency relationships. This phase establishes the source of truth that Impactlia will later use to determine what a Pull Request could affect.

The parser does not analyze risk yet. It does not know about Pull Requests yet. Its job is simpler and more important: understand the actual structure of the codebase accurately.

## Build

- **Repository walking.** Walk a repository on disk and determine which source files become nodes in the analysis graph.
- Record useful file metadata such as file path, relative path, file type, line count, content hash, module identity where applicable, and parent folder information.
- **Import parsing.** Read TypeScript and JavaScript files using a real TypeScript-aware parser rather than regular expressions.
- Turn resolvable relationships into dependency edges for static imports, re-exports, and dynamic imports with literal module paths.
- Support common relative and configured path resolution needed by real TypeScript/JavaScript repositories.
- **Fan-in and fan-out.** Calculate both from the final deduplicated edge list.
- **Coverage and resolution reporting.** For every import/reference encountered, record whether it resolved to a file inside the repository, points outside the repository, was deliberately excluded, or could not be resolved.
- When resolution fails, record the reason and useful examples rather than returning only an aggregate failure count.
- **Framework adapter interface.** Establish an adapter boundary for framework-specific knowledge without placing framework-specific conditions inside the parser itself.
- Provide a framework-agnostic fallback adapter.
- **Typed parser output.** Define the data contract that later Impactlia phases will consume for dependency analysis, Pull Request impact analysis, blast-radius calculation, and visualization.
- Provide a command that runs the parser against a local repository directory, prints a useful summary, and can write the complete typed analysis result to a file.
- The generated output must be deterministic enough that the same repository state produces the same structural result.

## Constraints

- The parser imports no web framework, UI library, database client, GitHub client, or AI client.
- It takes a directory path and produces structured analysis data. It must run independently from the Next.js application.
- **The parser does not fetch repositories.** It performs no network calls and does not know how a repository was obtained. Cloning or downloading a repository belongs to the GitHub/repository integration layer in a later phase.
- The parser must be usable against the Impactlia repository itself as well as representative external TypeScript/JavaScript repositories.
- No framework-specific checks should exist inside the core parser. Framework knowledge belongs behind the adapter interface.
- **File selection must be structurally defensible.** Do not select the largest N files, sample arbitrary files, or otherwise create a graph whose edges point to nodes that were silently excluded.
- The initial MVP should prefer complete source coverage within the supported repository rather than an attractive but incomplete graph.
- Generated files, dependencies, build output, binaries, and other intentionally excluded paths must have explicit exclusion rules and must be reported as excluded where relevant.
- An import that cannot be resolved is reported as unresolved with a reason. It is never silently dropped and never guessed.
- Dependency edges must come from parsed code and deterministic resolution, never from an AI model.
- Duplicate edges must be removed before graph metrics are calculated.
- Do not calculate PR risk, blast radius, or AI explanations in this phase. This phase produces the evidence those later systems will consume.
- Do not add React Flow or any other visualization library. The parser ends with structured output.

## Parser output contract

The output should contain enough information for later phases to answer structural questions without reparsing the repository unnecessarily.

At minimum, the contract should represent:

### Files

- stable file identifier
- repository-relative path
- file extension/type
- folder information
- line count
- content hash
- parse status
- exclusion status/reason where applicable

### Edges

- source file
- target file
- relationship/import kind
- resolution status
- enough metadata to explain how the relationship was established

### Coverage

- total files encountered
- files included
- files parsed successfully
- files excluded
- files that failed to parse
- imports/references encountered
- resolved internal relationships
- external relationships
- unresolved relationships
- representative resolution failures with reasons

### Graph metrics

- fan-in per file
- fan-out per file

The contract should be versioned or designed so later phases can extend it without breaking existing analysis results.

## Why this phase matters to Impactlia

Impactlia's core promise depends on knowing the real structure of a repository.

Later, when a Pull Request changes:

```text
payment.ts
```

Impactlia needs to be able to determine whether the repository contains relationships such as:

```text
payment.ts
    ↓
checkout.ts
    ↓
order.ts
    ↓
invoice.ts
```

The PR impact engine will eventually traverse these relationships to determine potential affected files.

If the parser misses an edge, the blast-radius analysis can become incomplete.

If the parser invents an edge, the impact report becomes misleading.

Therefore, **parser correctness is more important than visual completeness.**

## Acceptance check

Run these checks and report the actual numbers.

1. **Parse the Impactlia repository itself.** Report files encountered, files included, files parsed successfully, files excluded, files that failed, internal edges, unresolved relationships, and external relationships. Nothing should be silently omitted.
2. **Inspect folder information.** Every included file must carry the folder/path information needed later to group and visualize repository structure.
3. **Verify dependency edges manually.** Select representative files and confirm that their imports and re-exports match the parser output.
4. **Test barrel files.** Parse a repository that uses index/barrel files. Report re-exports encountered and successfully resolved. Any difference must have an explicit reason.
5. **Test an unresolved import.** Rename or remove a file that another file imports, then re-run the parser. The resulting unresolved relationship must identify the source import and explain why resolution failed.
6. **Test duplicate relationships.** Confirm that the same source/target relationship is represented once even if multiple parsing paths could discover it.
7. **Test dynamic imports.** A literal dynamic import should become an edge when it can be deterministically resolved. Non-literal dynamic imports should be reported as unsupported/unresolved rather than guessed.
8. **Test output persistence.** Write the parser output to a typed data file, read it back, and confirm that the structure remains valid.
9. **Test determinism.** Run the parser twice against the same repository state and confirm that the structural output is equivalent.
10. TypeScript checks, lint, and the production build must pass.

## Not in this phase

GitHub authentication. Repository OAuth/installation flows. Repository cloning from GitHub. Pull Request retrieval. Pull Request diffs. Changed-file detection from a PR. Blast-radius calculation for a PR. Risk scoring. Test-selection recommendations. AI explanations. Repository chat. React Flow visualization. GitHub Checks. CI/CD integration. Production telemetry.

Framework-specific adapters beyond the initial fallback should only be introduced when a concrete supported framework requires them.

This phase ends with a **trusted repository analysis artifact on disk**, not a rendered Impactlia report.
