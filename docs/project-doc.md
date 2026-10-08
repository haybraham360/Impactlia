# Impactlia

The product decisions behind this build, written before it starts, with the reasoning attached. The reasoning matters more than the decision — new problems will appear that this document does not cover, and the team needs to understand which direction the product is leaning.

Read the part you need before building something. Do not treat this as a prompt to paste wholesale into an AI coding tool.

## What it is

Sign in with GitHub, connect a repository, select a Pull Request, and get an analysis of what that change could affect.

Impactlia takes the files and code changes in a PR, maps them against the repository's real dependency structure, identifies direct and indirect downstream impact, evaluates risk factors, and presents a clear impact report.

The core question is:

**What could this code change affect, and how risky is it?**

The product is not primarily a code reviewer. It is a change-impact intelligence layer that helps developers understand the consequences of a change before they merge or ship it.

A visual graph shows the changed files and their affected neighbours. A report explains the blast radius, important dependencies, risk signals, and what deserves review or testing.

AI can explain the findings in plain language and help developers investigate the repository, but it does not invent the repository structure or become the source of truth.

## The problem

AI coding tools and faster development workflows mean teams can now make much larger numbers of code changes, often without every developer fully understanding the surrounding codebase.

A PR can change one file while affecting many others through imports, re-exports, shared utilities, APIs, configuration, or other dependencies.

The difficult question is no longer only:

“Is this code correct?”

It is also:

“What else could this change affect?”

Today, answering that question often means manually tracing dependencies, searching the repository, asking teammates, reading unfamiliar code, and guessing which tests matter.

That becomes increasingly difficult as repositories grow and AI-generated code increases the speed and volume of change.

## Who it's for

The primary user is a software developer or engineering team working in a JavaScript/TypeScript codebase who needs to understand the potential consequences of a Pull Request before merging it.

The first important user may be:

- A developer working in a codebase they did not originally build.
- A team shipping quickly with AI-assisted development.
- An engineering team where a small change can have a large downstream effect.

They can read code. What they cannot always see quickly is the shape of the change across the repository.

The product should eventually belong to the engineering organization rather than to one developer. A repository can be analyzed once, and the resulting intelligence can help everyone reviewing changes against it.

## The product bet

The crowded category is AI code review.

Impactlia should not try to win by becoming another tool that primarily asks whether code contains bugs, style issues, or review comments.

The bet is narrower:

**As software development becomes faster, understanding the impact of a change becomes a distinct engineering problem.**

Impactlia owns that question.

The differentiation should remain:

**Code review asks: “What is wrong with this change?”**

**Impactlia asks: “What could this change affect?”**

This distinction must remain visible in the product, positioning, and roadmap.

## The rule everything rests on

**Repository relationships must come from real code analysis whenever they can.**

The dependency graph is the source of truth.

The AI may explain findings, summarize changes, identify useful areas to inspect, and recommend validation. It may not invent dependency edges, claim a file is affected without evidence, or replace deterministic graph calculations with guesses.

If the system says a file is affected, there must be a traceable reason why.

The same applies to risk. Risk should begin with explicit, explainable signals rather than an opaque model-generated number.

A beautiful graph that is structurally wrong is worse than a limited graph that is honest about what it knows.

## Scope

- GitHub authentication and repository/PR selection.
- Public repositories for the first version if private repository access creates unnecessary credential complexity.
- Organizations and team access once repository-level analysis is reliable.
- Pull Request metadata, changed files, commits, and diffs.
- TypeScript and JavaScript analysis first.
- Imports, re-exports, dynamic imports, and CommonJS `require()` where resolvable.
- Dependency graph construction from parsed code.
- Changed-file identification.
- Direct and indirect downstream impact analysis.
- Blast-radius calculation.
- Dependency depth and affected-component calculations.
- Explainable risk signals.
- Identification of potentially critical/shared components.
- Detection of relevant API, database, authentication, configuration, and other high-impact changes where reliably detectable.
- Test-change awareness.
- Recommended areas to review or validate.
- A visual impact graph.
- A structured PR impact report.
- AI explanation grounded in the deterministic analysis.
- AI repository questions that retrieve facts before answering.
- Analysis coverage reporting, including what could not be resolved.
- Live progress for repository analysis.
- Checks that AI output does not reference files absent from the repository.

## Out of scope, and why

- **Generic AI code review.** There are already strong products focused on this. Impactlia should own change impact rather than compete feature-for-feature with them.
- **Opaque AI risk scores.** A number without understandable evidence will become something users argue with rather than trust.
- **AI-generated dependency edges.** The graph must remain grounded in code.
- **AI deciding the blast radius.** Graph traversal is deterministic and should remain deterministic.
- **Pretending affected means broken.** Impactlia identifies potential impact; it must not claim a change will definitely break a component without evidence.
- **All programming languages in v1.** TypeScript and JavaScript should be made genuinely reliable first.
- **Production safety guarantees.** Impactlia can surface risk and evidence; it cannot guarantee that production will not fail.
- **Large infrastructure before product validation.** Do not introduce queues, workers, containers, or complex distributed systems simply because the architecture may eventually need them.
- **Decorative dashboards.** The interface should help a developer understand a PR, not become a collection of vanity metrics.
- **Features that do not improve change understanding.** Every feature should answer whether it helps a developer understand what the PR could affect.

## How it works

### Pull Request intake

The system receives a GitHub Pull Request and retrieves:

- PR metadata
- changed files
- additions and deletions
- commits
- relevant diffs
- repository context

The PR itself is the starting point for analysis.

### Repository analysis

The parser independently analyzes the repository and produces:

- files
- modules
- dependency edges
- resolution information
- coverage information

The parser should be usable independently of the web interface.

If the parser cannot reliably resolve something, it should report that limitation rather than invent a relationship.

### Impact analysis

Impact calculations are pure operations over the repository graph and the set of changed files.

At minimum, the system should be able to determine:

- direct dependents
- indirect dependents
- dependency depth
- number of affected files
- affected paths/components
- fan-in and fan-out
- shared or highly connected modules

The system should clearly distinguish:

**Changed files** — files directly modified by the PR.

**Affected files** — files that may be impacted through known repository relationships.

The distinction is fundamental to the product.

### Risk analysis

Risk is initially deterministic and explainable.

Potential signals include:

- number of changed files
- number of affected files
- dependency depth
- high fan-in/shared modules
- core application paths
- API changes
- database-related changes
- authentication/authorization changes
- configuration/environment changes
- large or complex diffs
- whether relevant tests changed
- unresolved dependency information
- other evidence that can be reliably derived from the repository

The system should show why a PR received a particular risk assessment.

Do not hide the methodology.

### AI interpretation

AI sits above the analysis rather than underneath it.

It may:

- explain why the change is potentially risky
- summarize the blast radius
- explain important affected areas
- suggest what developers should inspect
- recommend tests or validation
- answer repository questions using retrieved facts

It may not:

- invent files
- invent dependencies
- invent test results
- claim production behaviour that has not been observed
- replace deterministic graph traversal
- become the only source of risk calculation

Every AI response should be grounded in structured analysis data.

## The impact report

The report should make the important information obvious without requiring the developer to inspect the entire graph.

A useful first version should answer:

1. What changed?
2. What could this change affect?
3. How large is the potential blast radius?
4. Why is this change considered low, medium, or high risk?
5. Which areas deserve attention?
6. What should be reviewed or tested?
7. What evidence supports those conclusions?
8. What could not be determined?

The user should be able to move from the summary into the actual files and dependency relationships.

## React Flow and visualization

The graph is an explanation tool, not decoration.

The initial view should emphasize the changed files and their relevant downstream impact.

Users should be able to:

- select a changed file
- see direct dependents
- expand deeper relationships
- distinguish incoming and outgoing relationships
- inspect file details
- understand why a file appears in the impact set
- avoid being overwhelmed by the entire repository

The graph should never imply certainty where the underlying analysis is uncertain.

Anything derivable from data already loaded in the browser should be calculated immediately rather than requiring another request.

## The interface

A developer tool, not a marketing dashboard.

The interface should prioritize:

- PR context
- risk/impact summary
- changed files
- affected files
- evidence
- graph
- recommended validation
- analysis coverage

Use dense but readable layouts. File paths and technical identifiers should remain easy to scan.

Colour should carry meaning. It should not be used merely for decoration.

Risk colours may communicate severity, while graph colours may distinguish changed, affected, and unrelated nodes.

Nothing should move automatically. Motion should happen because the user interacted with something.

The shell and information hierarchy should be established early and then remain stable while later phases add functionality.

## Data and security principles

Repository and PR data can contain sensitive intellectual property.

The system must therefore treat repository access and stored analysis as security-sensitive.

For organization-owned data:

- rows must be scoped to the correct organization
- authorization must be enforced at the database layer where appropriate
- private repository credentials must never be exposed to the client
- GitHub access tokens must be handled securely
- users must never be able to query another organization's analysis
- analysis data should contain only what the product needs

If private repository support is introduced, its security requirements must be treated as a product feature rather than an implementation detail.

## AI tracing and caching

Every AI call should be traceable and cached.

The cache should be checked inside the traced operation so that a cache hit is still visible as a recorded run without pretending a model call occurred.

This makes AI behaviour observable, reproducible, and easier to evaluate.

AI cost should be treated as a real product constraint.

Do not call a model when deterministic computation can answer the question.

## Evaluation

The product must be evaluated against known repositories and known Pull Requests.

Before shipping an analysis feature:

- manually verify representative dependency relationships
- verify changed-file detection
- verify affected-file calculations
- verify blast-radius calculations
- verify risk signals
- verify that unresolved relationships are reported
- verify that AI explanations reference real files
- verify that AI does not invent evidence

AI answer quality should eventually become measurable rather than being judged only by reading a few examples.

## Where this is likely to go wrong

### Import and dependency resolution

Path aliases, index files, re-exports, dynamic imports, generated files, and framework conventions can cause silent gaps.

The dangerous failure is not always a crash. A graph that looks complete while missing important relationships is worse.

Coverage and resolution failures must therefore be visible.

### Blast-radius overload

A highly connected file can produce an enormous impact set.

The product needs to distinguish useful impact from noise and allow developers to understand the most important paths first.

Do not solve this by silently hiding relationships.

### Risk scoring

Risk is inherently contextual.

The initial score should therefore be explainable and evidence-based. Avoid pretending that a single number is objectively correct.

### AI hallucination

The AI may produce a convincing explanation that contains an incorrect file or dependency.

Grounded context, structured inputs, caching, tracing, and validation checks are required.

### Large repositories

Large repositories may exceed practical analysis limits.

The first response should be to state the limit honestly and optimize the analysis path. Do not prematurely build a distributed system simply to avoid acknowledging a limit.

## What has to be true before this ships

Not “it looks right.” Specifics:

- Given a known repository, representative imports and dependency edges match manual verification.
- Changed files exactly match the GitHub PR data.
- Affected files are derived from the dependency graph rather than guessed by AI.
- Direct and indirect impact calculations are deterministic and testable.
- The report clearly distinguishes changed files from affected files.
- Risk factors are visible and explainable.
- Coverage states what was skipped or unresolved and why.
- An explanation never names a file absent from the repository, and that is demonstrated by a check rather than asserted.
- AI recommendations are grounded in the analysis evidence.
- A user from one organization cannot retrieve another organization's analysis.
- Repository credentials never appear in client-visible data.
- Every production database table has the intended access controls.
- The product can analyze a representative real-world TypeScript/JavaScript repository without producing a confident but structurally wrong graph.
- The core workflow from GitHub PR to impact report works end-to-end.

## Development method

Impactlia should be built in phases.

Each phase should have:

- a specific product outcome
- explicit acceptance criteria
- technical constraints
- tests
- a clear definition of done

Do not build future phases early because they sound useful.

A feature is not complete because the UI exists. The underlying analysis, error handling, security, and tests must also work.

## Fresh context procedure

When starting a new development session:

1. Read this document.
2. Read the current phase specification.
3. Inspect the existing implementation before making assumptions.
4. Check what the previous phase actually completed.
5. Do not rebuild completed work without evidence that it is broken.
6. Do not invent requirements that are not present in the project documents.
7. Preserve the core product principles even when implementation details change.

## Completion rules

A task is complete only when:

- the intended behaviour works
- relevant tests pass
- TypeScript/build checks pass
- errors are handled
- security boundaries remain intact
- the UI communicates uncertainty honestly
- no placeholder implementation is presented as production functionality
- the implementation does not quietly expand the scope

## Code quality rules

- TypeScript strict mode.
- Avoid `any`.
- Prefer small, composable functions.
- Keep code analysis separate from UI.
- Keep GitHub integration separate from analysis logic.
- Keep graph calculations pure.
- Keep AI calls behind a centralized client.
- Comment decisions and non-obvious constraints, not obvious syntax.
- Do not install packages without a reason.
- Do not add abstraction merely for future possibilities.
- Prefer simple solutions that can be tested.
- Never weaken type checks or lint rules simply to make a build pass.

## What success looks like

A developer opens a Pull Request and can understand its potential consequences within seconds rather than spending significant time manually tracing the repository.

They can see:

**What changed → what could be affected → why it matters → what to inspect or test.**

If Impactlia becomes something developers routinely check before merging important changes, the product has achieved its first meaningful form of value.

The long-term goal is larger:

As AI makes software creation faster, Impactlia becomes the intelligence layer that helps engineering teams understand and control the consequences of those changes.

## Long-term direction

Potential future capabilities include:

- private repository support
- GitHub Checks and merge-gate integrations
- GitLab and other source-control platforms
- CI/CD integration
- historical change-risk analysis
- test selection based on impact
- production telemetry combined with code impact
- organizational architecture intelligence
- custom risk policies
- support for additional languages
- AI coding-agent integrations
- change-risk trends across teams
- automated validation workflows

These are directions, not commitments.

The core proposition must remain:

**Understand the potential impact of a software change before you ship it.**

## Non-negotiable rules

1. **The dependency graph must be grounded in real code.**
2. **Changed files and affected files must never be treated as the same thing.**
3. **AI is an interpretation layer, not the source of repository truth.**
4. **Risk must be explainable.**
5. **Never invent repository relationships or evidence.**
6. **Never claim that potential impact means certain breakage.**
7. **Do not turn Impactlia into a generic AI code reviewer.**
8. **Do not hide analysis limitations.**
9. **Do not sacrifice correctness for a prettier graph.**
10. **Do not build complexity before the core workflow proves useful.**
11. **Security and organization boundaries are product requirements.**
12. **Every feature should strengthen the central question: “What could this change affect?”**

## Final product definition

**Impactlia is a developer intelligence platform that analyzes software changes before they ship, maps their potential blast radius across the real codebase, explains the associated risk, and helps engineering teams decide what to review or validate.**

The product exists because writing code is getting faster.

Understanding the consequences of changing that code needs to get faster too.
