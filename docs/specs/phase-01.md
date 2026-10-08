# Phase 1 — Auth, teams, and the Impactlia workspace

**Goal.** Someone signs in, belongs to an organization, and lands in an Impactlia workspace where they can begin working with repositories and Pull Requests, in the theme they prefer.

Sign-in itself is already scaffolded. This phase establishes the identity, organization, protected application shell, and workspace foundation that every later Impactlia feature will use.

## Build

- **Organizations.** Signing in for the first time lands the person inside one organization without requiring them to create one manually. There is a way to switch between organizations and a way to invite another person into one. Accepting an invitation brings the person to Impactlia's login page.
- **The current organization is readable during server rendering**, not only in the browser.
- Whichever sign-in methods are enabled all lead to the same Impactlia workspace. Adding or removing a sign-in method is configuration, not a code change.
- Signed-out visitors to protected Impactlia routes are redirected to the login screen before protected content renders.
- A theme control with three states: follow the system, force light, force dark. The choice is persisted and written to the root element so Impactlia's colour tokens can use it.
- The **Impactlia application shell** everything later renders inside. The shell should establish basic navigation and workspace structure without prematurely building repository or PR features.
- The workspace should have a clear place for the user's organization context and a future repository/PR workflow, but repository analysis itself is not part of this phase.
- The application should feel like a focused developer tool rather than a generic SaaS dashboard.

## Constraints

- **Identity is a token, and the token carries the organization.** Everything built after this decides what someone can see by reading that claim. Downstream code should not need to ask the identity provider a question at runtime.
- Use the sign-in scaffolding already provided rather than rebuilding it. If a hand-written login form appears in this phase, something has gone wrong.
- **One session system, not two.** Whatever the database library's own setup snippet installs for refreshing its sessions comes out. Sessions belong to the identity provider. Two systems trying to own the same cookie and middleware slot is a bug that can present as random sign-outs.
- **The database client carries the signed-in token.** Nothing queries repository or analysis data yet, but the client must be constructed so the token travels with every request. That is what will allow organization policies to work when Impactlia begins storing repositories, PRs, analyses, and reports.
- Environment configuration fails loudly at startup if required values are missing. A blank value that produces a confusing error later is worse than a clear startup failure.
- **No repository analysis in this phase.** Do not build dependency parsing, GitHub PR ingestion, blast-radius calculation, risk scoring, or AI analysis yet.
- Nothing here creates repository, Pull Request, dependency graph, risk, or analysis tables.
- Do not introduce GitHub repository permissions or private-repository credential handling in this phase unless already required by the existing authentication scaffolding.
- The application shell should be stable enough that later phases can add repository and PR analysis without rearranging the entire interface.

## Acceptance check

1. Sign in on a brand new account with each enabled method. All methods land in the same Impactlia workspace, and the account is already inside an organization without being asked to create one.
2. Invite a second account. Accepting the invitation arrives at the Impactlia login page, and signing in from there lands in that organization's workspace.
3. Read the current organization in a server component and render it. It is available on the first paint, not only after client-side hydration.
4. Switch the theme, reload, and confirm the choice persists. All three states work, and forcing light while the system is dark actually wins.
5. Visit a protected Impactlia route while signed out and get redirected to login. Confirm in the network tab that protected page HTML was never sent.
6. The authenticated workspace has a stable Impactlia application shell with organization context and clear navigation space for future repositories, Pull Requests, and analyses.
7. No Impactlia analysis logic has leaked into authentication or workspace code. This phase establishes the foundation only.

## Not in this phase

Repository connection. GitHub repository listing. Pull Request retrieval. Diff parsing. Dependency graph construction. Blast-radius calculation. Risk scoring. AI explanations. React Flow impact visualization. CI/CD integration. Private repository support. Repository or analysis tables. Roles beyond the defaults that come out of the box. Styling the sign-in screen beyond making it match the Impactlia application.
