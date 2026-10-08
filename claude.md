# Impactlia

Impactlia is a global developer platform that helps engineering teams understand the potential impact and risk of software changes before they are merged or shipped.

The product analyzes GitHub pull requests against the structure and dependencies of a codebase to identify changed components, downstream dependencies, potential blast radius, risk factors, and areas that should be reviewed or tested.

Impactlia should turn complex code-change information into something engineering teams can actually understand and act on: clear impact reports, dependency relationships, risk signals, recommended validation, and an understandable visual representation of what a change could affect.

Impactlia should be built around actual repository structure, code relationships, pull-request changes, and deterministic analysis wherever possible. AI can help explain findings, summarize changes, identify patterns, and help developers interpret the analysis, but it must not invent dependencies, risks, test results, or technical facts.

Why these rules exist is in `docs/project-doc.md`. This file is the rules themselves.

## Stack

Next.js 16 App Router, React 19, TypeScript strict. Supabase for Postgres, row-level security and realtime. The OpenAI SDK through one wrapped client, traced with LangSmith. Tailwind v4. pnpm.

Use the project's actual integrations and dependencies as they are introduced. Do not add a service or package simply because it appears in an example.

For code analysis, use the project's established parsing and dependency-analysis approach, including `ts-morph` where appropriate for TypeScript/JavaScript repositories.

For GitHub functionality, use the appropriate GitHub API integration to retrieve repositories, pull requests, commits, changed files, and diffs.

Next.js 16 changed a lot. If you're not certain about an API, read the docs inside the installed package rather than going from memory.

## How we work

Spec driven. Nothing gets built without a spec.

- `docs/project-doc.md` — what Impactlia is and every decision behind it. Read the part you need. Don't ask me to paste it.
- `docs/specs/phase-NN.md` — one per phase, written just before it starts. Behaviour and an acceptance check, never filenames.
- This file — always true, read on every prompt.

**Starting a phase.** Read this file and that phase's spec. Build what the spec asks and stop.

**Dropped into a fresh context and don't know where we are?** Look at which files exist in `docs/specs/`, then the git log. The last commit is the last phase that passed. Tell me what you've worked out before building on it.

**The acceptance check is mine to run, not yours.** It's a list of things I do by hand in a browser. Don't automate it, don't install a test runner or browser driver for it. Build so those things are true, then tell me it's ready.

**What you check before saying a phase is done:** types, lint, build. Anything verifiable from a terminal in a few seconds is yours — running a script and reading its output counts. Anything needing a browser is mine.

**When a phase comes out wrong, I reset rather than patch.** Prompting on top of wrong code three times leaves code nobody understands, including you. So if a spec is ambiguous, say so before you build.

## How to talk to me

Short. If a sentence isn't telling me something I need, cut it.

**Ask with an answer attached.** One specific question, and say which way you'd go and why. "A or B, I'd take B because it keeps the impact-analysis model simple" is answerable in two seconds. An open question isn't. Never pick a direction silently, never build both.

**When you need something only I can give you** — a GitHub OAuth value, API key, integration credential, or value in `.env.local` — say exactly what and exactly where, then stop.

**No walls of text.** Don't summarise every file you touched or restate the plan back to me. When a phase is done, say what it does and what the check should show, in a few lines.

**Plain English.** If you're reaching for a bulleted breakdown of something that's one sentence, it's one sentence.

**Say when something didn't work.** A failure worked around quietly costs me an hour later.

## How the code is laid out

You pick the file structure. These are about behaviour.

- **Code analysis should be separated from the UI.** Repository ingestion, parsing, dependency extraction, impact calculations, risk scoring, validation, and transformation should be independently testable and should not depend on React components.
- **Impact calculations must be deterministic where possible.** Given the same repository state, pull-request changes, dependency graph, and methodology, Impactlia should produce the same analysis.
- **The dependency graph is a core source of truth.** Relationships between files, modules, functions, components, APIs, and other supported code entities should be derived from the repository rather than invented by AI.
- **Risk scoring should be explainable.** Risk should be based on identifiable signals such as dependency impact, number of affected components, API changes, database changes, test coverage, critical paths, and other validated signals.
- **AI must not become the source of truth.** AI can explain, summarize, categorize, and help users interpret analysis, but it must not fabricate dependencies, risk factors, test results, affected components, or technical facts.
- **Database access happens in server code**, not inside components.
- **Who may read or modify a row is decided by a policy**, never only by application code. If a query needs an application-side filter to enforce authorization, the policy is wrong.
- **One place constructs the AI client.** Anywhere else silently skips tracing.
- **External integrations should be isolated behind clear server-side boundaries.** The rest of the application should not depend directly on provider-specific implementation details.
- **GitHub integration should be isolated from analysis logic.** Repository and pull-request data should be normalized before being passed into the analysis engine.
- **Visualization should consume analysis results rather than perform analysis itself.** React Flow and related UI components should display relationships and findings produced by the analysis layer.

## Conventions

Strict TypeScript, no `any`. If a type is genuinely awkward, tell me rather than casting.

Comment the decisions, not the syntax.

Every AI call has a cache read inside its trace, so a cache hit shows up as a recorded run with no model call in it.

One obvious way to do something beats a configurable one.

The UI should feel trustworthy, modern, and clear. Risk information, dependency relationships, pull-request changes, impact reports, and recommendations should be easy to understand without making the product feel like a complicated developer dashboard.

Visualizations should communicate relationships and risk, not exist just because they look impressive.

The primary visualization should make it easy to understand the relationship between changed code and potentially affected code.

Do not use decorative motion, excessive gradients, or visual effects when they make technical information harder to understand.

There is a frontend design skill that activates on its own for UI work. Use it, but the paragraph above overrules it — Impactlia should prioritize clarity, trust, accessibility, and useful information over decorative complexity.

## Things not to do

Breaking one of these is worse than not finishing.

- **Never invent repository relationships.** If Impactlia cannot establish a dependency or affected component from available evidence, say so.
- **Never present an AI-generated explanation as verified technical fact.** Clearly distinguish repository-derived analysis, deterministic calculations, GitHub-provided information, and AI-generated interpretation.
- **Don't hide the risk methodology.** When Impactlia calculates a risk score, the signals contributing to that score should be understandable to the user.
- **Don't confuse changed code with affected code.** A file changed in a PR is not automatically the only thing affected, and an affected file is not automatically evidence of a bug.
- **Don't treat the AI-generated risk explanation as the risk engine.** Deterministic analysis should establish the underlying signals wherever possible.
- **Don't install a package without asking.** Name it, say what for, wait.
- **Don't build ahead of the current phase.** No scaffolding for what's coming.
- **Don't leave the build broken.** Tell me about a failure instead of working around it.
- **Don't weaken a check to make it pass.** A check that can't run has to fail loudly.
- **Don't read from the database on a loop.** Name your columns, limit list reads, subscribe instead of polling.
- **Don't collect unnecessary personal or organizational data.** Only store what the product needs to analyze repositories and deliver its intended functionality.
- **Don't make Impactlia specific to one country.** The product is intended for a global market, so avoid assumptions that unnecessarily restrict the data model, workflows, terminology, pricing, or product experience to any particular country.
- **Don't make Impactlia specific to one programming language forever.** The initial implementation may focus on TypeScript/JavaScript, but the architecture should not make future language support unnecessarily difficult.
- **Don't make AI the product by itself.** Impactlia is the solution; AI is a component that makes analysis, explanation, and developer workflows more useful.
- **Don't build another generic AI code reviewer.** Impactlia's core purpose is understanding the potential impact, dependency reach, and risk of software changes.
- **Don't optimize for a pretty graph over useful analysis.** The graph exists to help developers understand the blast radius of a change.
- **Don't claim that Impactlia guarantees a change will not break production.** It identifies potential impact and risk based on available repository and change information; it does not provide certainty.
