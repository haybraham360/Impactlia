# Impactlia — Gamified Dashboard Redesign Brief for Claude Code

## Mission

Redesign the **authenticated Impactlia dashboard** to feel more visual, playful, and interactive, taking broad inspiration from the supplied Sentry dashboard screenshot. The target is a premium developer-tool workspace with a distinct Impactlia identity—not a Sentry clone.

Reference screenshot: the uploaded Sentry Issues → Feed dashboard showing a dark purple interface, compact side navigation, dense but orderly controls, a large empty-state panel with a playful illustration, and a polished application shell.

**This brief is for the logged-in product dashboard, not the public marketing landing page.** Preserve all existing working Impactlia functionality, routes, data flows, permissions, authentication, and analysis logic. Do not replace real functionality with decorative mockups.

---

## 1. Impactlia product context

Impactlia is an early MVP focused on **pull-request change-impact and risk intelligence**.

Its central question is:

> **Know what your code changes could affect.**

The intended workflow is:

1. Connect or select a supported GitHub repository.
2. Select a pull request.
3. Read the actual diff and relevant repository structure.
4. Analyze supported dependency relationships to identify potentially affected areas.
5. Present changed files, potentially affected files, dependency paths, evidence-based risk signals, and areas worth validating.
6. Help the developer decide what to inspect and test before merging.

Impactlia is an assistive tool. It must not promise to detect every bug, guarantee a safe merge, or claim that an analysis is complete when some parts of the repository could not be inspected.

### Evidence and language rules

- Deterministic repository analysis and real code relationships are the source of truth.
- AI, if present, may explain structured findings but must not invent dependencies or repository facts.
- Clearly distinguish **changed files**, **potentially affected files**, **confirmed failures**, **coverage gaps**, and **recommendations**.
- Show incomplete or unsupported analysis honestly.
- The product is an early MVP. Do not imply all languages, frameworks, integrations, or analysis capabilities are supported.
- Never use fake repository data in a real user's dashboard.
- Any sample data used for a preview must be clearly labeled as a demo or illustrative example.

---

## 2. Design goal

Make the dashboard feel like a polished, lively engineering workspace, with a subtle gamified feel based on **discovery, progress, feedback, and responsive interactions**.

The interface should feel:
- Technically credible and easy to scan.
- Visually rich without being noisy.
- Dark, expressive, and atmospheric, with controlled gradients and colorful accents.
- Playful through illustrations, animation, transitions, and small interaction details.
- Efficient for developers who need to find a repository, start an analysis, and understand a report.
- Calm and trustworthy when displaying errors, missing data, security states, or analysis limitations.

Do **not** turn the product into a literal game. Do not invent XP, points, badges, leaderboards, streaks, rewards, or rankings.

---

## 3. Sentry-inspired dashboard principles to reinterpret

The supplied screenshot shows several useful patterns:

- A clear, persistent left navigation with icon labels.
- A secondary navigation column for the current section.
- A compact top toolbar for the page title, key actions, search, and utilities.
- Dark purple surfaces with visible separation between navigation, toolbar, and content.
- Clear borders and restrained elevation to organize dense technical UI.
- A large empty-state panel that combines a friendly illustration with practical next steps.
- Consistent button styling, active navigation states, small badges, and helpful status indicators.
- A hierarchy that keeps the primary content area dominant.

Apply the principles to Impactlia's workflow, but do not copy Sentry's exact layout, labels, iconography, artwork, copy, brand colors, or illustrations.

Impactlia's dashboard should visually communicate a different story: **repositories, pull requests, code relationships, impact analysis, and validation**.

---

## 4. Mandatory preflight: inspect before changing

Before writing code:

1. Inspect `package.json`, lockfile, and current framework/tool versions.
2. Inspect the current authenticated dashboard route and all related routes.
3. Inspect the current navigation, sidebar, top bar, cards, tables, forms, graph views, and empty states.
4. Identify which components are shared with the public landing page.
5. Inspect existing auth/session and workspace logic.
6. Inspect the real repository, pull-request, analysis-run, and report data models.
7. Identify real loading, empty, error, permission-denied, and completed states.
8. Check Git status and preserve unrelated user changes.
9. Check available disk space before running large builds or cleanup tasks.
10. Write a short implementation plan based on the current code, then proceed with the redesign.

Do not assume the app structure or route names. Discover them from the repository.

---

## 5. Dashboard visual system

### Palette and atmosphere

Use the existing Impactlia tokens if present. Otherwise establish a restrained system based on:

- Deep ink, midnight plum, or blue-black base surfaces.
- Slightly lighter purple/charcoal panels for cards and navigation.
- Electric violet or magenta for primary actions and selected navigation.
- Cyan or blue for neutral information and graph connections.
- Restrained green for successful/completed states.
- Amber for warnings or partial analysis.
- Red for errors or high-severity states only when justified by actual data.
- High-contrast main text and readable muted text.

Do not use color as the only indicator of status. Pair colors with text, icons, or labels. Verify text and control contrast.

### Surface hierarchy

Define consistent styles for:

- App background.
- Primary sidebar.
- Section navigation.
- Main content surface.
- Cards and panels.
- Input fields and search.
- Tables and list rows.
- Popovers, dialogs, and dropdowns.
- Tooltips.
- Selected, hover, focus, disabled, loading, and error states.

Use borders and subtle elevation to distinguish layers. Avoid putting every element in a separate heavy card. Keep enough whitespace for the dashboard to breathe.

### Typography

- Use the existing product font if suitable.
- Establish clear hierarchy for page titles, section headings, labels, table metadata, and helper text.
- Keep dense data legible.
- Avoid oversized marketing-style headings inside the operational dashboard.
- Use monospace typography for paths, identifiers, diffs, and code-related values where appropriate.

---

## 6. Dashboard shell and navigation

### Primary sidebar

Build on the existing navigation rather than replacing routes.

Suggested product-oriented sections, **only where corresponding routes/features already exist**:

- Overview
- Repositories
- Pull Requests
- Analysis Runs
- Impact Reports
- Settings

Potentially place secondary items under a section if the app already supports them. Do not add dead links or pretend a feature exists when it does not.

Requirements:

- Clear active route styling.
- Icons with consistent size and stroke weight.
- Text labels on desktop.
- Collapsible or compact behavior only if it is safe and usable.
- Tooltips for icon-only navigation.
- Accessible keyboard focus and navigation.
- On mobile, use a drawer or compact navigation pattern that works with touch and screen readers.

### Top bar

Depending on existing architecture and workspace support, include:

- Current page title or breadcrumb.
- Repository or workspace context when relevant.
- Search only if it searches real available data.
- Primary action appropriate to the page.
- Existing account/profile controls.
- Notifications only if notifications actually exist.

Do not add fake notification counts, fake search behavior, or nonfunctional toolbar buttons.

---

## 7. Overview dashboard

The overview should answer three questions quickly:

1. What can I analyze next?
2. What has been analyzed recently?
3. Is there anything I should review or resolve?

### Recommended hierarchy

**A. Welcome and primary action**

Use a concise heading such as:

> **Understand the impact before you merge.**

Supporting copy should briefly explain that the user can select a repository and pull request to explore potential downstream impact.

Primary CTA should lead to the real supported action, for example:
- **Analyze a pull request**
- **Connect a repository**
- **Choose a repository**

Choose the CTA based on the user's actual state and available flows. Do not show “Analyze a pull request” if the app cannot yet perform that action.

**B. Real summary metrics**

If the backend has reliable values, show a small number of useful summaries such as:
- Repositories connected.
- Analysis runs completed.
- Pull requests analyzed.
- Analyses requiring attention.

Only use metrics that exist and are computed from real data. Do not invent totals or use hardcoded sample numbers in a real user's dashboard. If metrics are unavailable, omit them or show a helpful setup state.

**C. Recent activity**

Show actual recent analysis runs or PRs with:
- Repository name.
- PR title/number when available.
- Status.
- Created/updated time.
- Link to the real report or run details.

Use a clean table or compact list. Keep status labels explicit: queued, running, completed, failed, or whatever the real data model supports. Do not conflate a successful analysis with a safe pull request.

**D. Getting started**

For users who have not connected a repository or run an analysis, show a guided setup card:
1. Connect a supported repository.
2. Select a pull request.
3. Review the first impact report.

Mark each step as complete only when verified from real state. The card may include small progress visuals, but never fabricate progress.

---

## 8. Repository experience

If repository routes exist, make repository selection and status easy to understand.

Repository cards or rows may show:
- Repository name and owner.
- Supported/default branch when available.
- Connection status.
- Most recent analysis time if real.
- A clear action to open the repository or inspect its pull requests.

Do not display access tokens or sensitive credentials. Do not expose repository information to users who lack permission.

If no repositories are connected, create a friendly, illustrated empty state with:
- A clear explanation of why connecting a repository is useful.
- One primary action to start the existing connection flow.
- Brief reassurance based only on verified permission and data-handling facts.
- Optional secondary documentation/help link only if it exists.

The empty-state illustration can use a playful code repository/dependency metaphor: connected file blocks, a small graph, or a PR card. Do not copy Sentry's character art.

---

## 9. Pull-request selection and analysis flow

This is the core product journey. The visual redesign must improve clarity without altering analysis behavior.

### Pull-request selection

Make it clear:
- Which repository is selected.
- Which pull requests are available.
- Which PR is selected for analysis.
- Whether required data has loaded.
- What the next action will do.

Use existing pagination, filtering, and permissions. Do not add fake PRs to the real user view.

### Starting an analysis

The primary action should have:
- A clear label.
- A disabled state when required information is missing.
- A loading state while the request is being submitted.
- A clear error state if the operation fails.
- Protection against accidental duplicate submissions.
- A real connection to the current analysis endpoint or action.

Do not create a decorative “Analyze” button that does nothing.

### Progress state

If analysis is asynchronous, present progress using actual lifecycle states and events available from the backend.

Potential visual treatment:
- A stepper or compact progress rail.
- Subtle progress animation.
- Status text such as “Fetching pull-request changes” or “Building dependency relationships” only if these correspond to actual backend steps.
- A clear fallback when detailed progress is unavailable.

Do not simulate detailed progress with a timer if the backend cannot confirm those steps. If only a generic running state is available, show a simple honest running indicator.

---

## 10. Impact report experience

The report should be the dashboard's signature experience: visually engaging, technically clear, and grounded in evidence.

### Recommended information hierarchy

1. Pull request identity and repository context.
2. Overall analysis status.
3. Summary of findings, if the analysis produces a meaningful summary.
4. Changed files.
5. Potentially affected files or components.
6. Dependency paths/evidence.
7. Risk signals and their explanations, where supported.
8. Suggested areas for review or validation, where supported.
9. Analysis limitations, unsupported files, or incomplete coverage.

Use only fields that the actual analysis returns. If a section is not implemented or its data is absent, do not fill it with fabricated values.

### Dependency graph

If the product has an existing React Flow/Dagre-based graph, inspect and reuse it if practical.

Visual improvements may include:
- Clear node categories and a persistent legend.
- Selected node state.
- Focused dependency path.
- Smooth but restrained edge highlighting.
- A compact detail panel explaining the selected node.
- Fit-to-view and zoom controls if already supported or implemented correctly.
- Clear empty and loading states.

Do not over-animate large graphs. Ensure graph navigation is usable with keyboard and touch where possible. Provide a text-based way to inspect important findings so users are not forced to interpret a visual graph.

### Risk and evidence presentation

- Explain why an item is highlighted.
- Show the actual evidence or supported dependency path when available.
- Distinguish a potential risk from a confirmed failure.
- Make uncertainty visible.
- Do not use unexplained risk percentages or invented severity values.
- Do not label a PR “safe” simply because no findings were returned.

### Report actions

Only include real supported actions, such as opening the PR on GitHub, returning to the run list, or re-running analysis if the backend supports it.

---

## 11. Gamified interaction system

Aim for subtle delight and a sense of progress—not distraction.

### Appropriate interactions

- Sidebar items respond to hover and active state.
- Cards lift slightly on hover and return smoothly.
- Status badges transition when real status changes.
- Progress indicators animate when real analysis progresses.
- Graph nodes and dependency paths highlight when selected.
- Filters and tabs update real content.
- Empty states use small, friendly illustrations.
- Guided setup shows verified completion.
- Buttons have tactile hover, active, focus, disabled, and loading states.
- Small transition effects help the user understand where they navigated.

### Avoid

- Fake XP, points, streaks, badges, leaderboards, or reward systems.
- Confetti or game-like sounds.
- Constantly moving background elements.
- Fake progress percentages.
- Random graph animation that does not correspond to real data.
- Hover-only information.
- Excessive glow, blur, particles, or large animated backgrounds.
- Animations that cause layout shifts, flicker, or CPU spikes.

### Motion/accessibility requirements

- Respect `prefers-reduced-motion`.
- Use CSS transitions/keyframes for simple effects.
- Use an existing motion library if already installed and appropriate; do not add one without need.
- Use consistent timing and easing.
- Ensure keyboard focus is visible.
- Do not communicate state by color alone.
- Make controls accessible to keyboard and screen readers.
- Avoid animation that delays access to important information.

---

## 12. Empty, loading, error, and success states

The Sentry screenshot is particularly useful as a reference for a clear empty state with a friendly illustration and practical next steps. Create distinct Impactlia states for real scenarios.

### No repositories connected

Headline example:
> **Your codebase journey starts here.**

Supporting text:
> Connect a supported GitHub repository to start exploring the potential impact of pull requests.

CTA: use the existing repository connection action.

### No pull requests available

Explain that no eligible pull requests were found for the selected repository or filters. Offer a real way to change the repository/filter or refresh, if supported.

### No analysis runs yet

Headline example:
> **Your first impact report is one step away.**

Show the next real step without pretending analysis has already happened.

### No findings returned

Do not automatically describe this as “safe” or “no risk.” Explain what the analysis did and did not inspect, using actual metadata. If the backend cannot provide detail, use neutral wording.

### Loading

Use skeletons that match the final layout. Avoid a full-page spinner where a local loading state is enough. Keep labels stable to prevent layout shifts.

### Error

Use human-readable error copy, an appropriate retry action when safe, and enough context to help the user recover. Do not show stack traces or secrets to end users.

### Completed analysis

Show a clear completed status, a report link, and a concise summary derived from real results. Do not conflate “analysis completed” with “all risks resolved.”

### Failed analysis

Show the real failure state and a safe next action. Do not hide failures behind a generic success-colored badge.

---

## 13. Technical constraints and implementation safety

The project has previously used a modern Next.js application with TypeScript, Tailwind CSS, Supabase, Clerk, and repository-analysis components. The current checkout must be inspected to verify exact versions and architecture.

### Preserve working behavior

- Do not alter authentication/session behavior.
- Do not change Supabase schemas or run migrations for a visual redesign.
- Do not modify production environment variables.
- Do not rewrite the repository analysis engine.
- Do not remove real filters, table columns, routes, permissions, or controls without explicit reason.
- Do not replace live data with hardcoded sample content.
- Do not modify the public landing page as part of this task unless a shared token/component change is required; verify it if shared components change.
- Do not add dead links or nonfunctional buttons.
- Do not weaken RLS or permission checks to make the UI work.

### Stability requirements

- Keep animations deterministic and isolated.
- Clean up timers, listeners, observers, and subscriptions.
- Avoid hydration errors from random values or browser-only APIs during SSR.
- Avoid effects that cause repeated state updates or blinking.
- Avoid unnecessary client components and re-renders.
- Preserve loading/error boundaries where they exist.
- Keep the app compatible with the existing Node/pnpm setup.
- Do not delete source files or configuration to free disk space. Check disk usage before running builds and clean only known generated artifacts if needed.

---

## 14. Responsive design

### Desktop

- A compact primary sidebar.
- Clear main content hierarchy.
- Dense tables with readable columns and controls.
- Graph/report panels with sufficient space.
- Tooltips for icon-only controls.

### Tablet

- Sidebar may collapse if existing routing and layout support it.
- Tables should adapt without hiding essential actions.
- Filters should wrap or use a compact control layout.

### Mobile

- Use a drawer or compact navigation.
- Keep page title and primary action easy to find.
- Convert wide tables into readable stacked rows/cards when necessary.
- Avoid horizontal scrolling for the entire page.
- Keep graph controls touch-friendly and make important findings available in a text list.
- Ensure dialogs fit within the viewport and can be dismissed accessibly.
- Reduce decorative motion and graph complexity.
- Avoid tiny icon buttons or dense toolbar clusters.

Do not simply scale down the desktop dashboard; adapt each pattern to the smaller screen.

---

## 15. Performance and visual quality

- Keep the dashboard fast and responsive.
- Avoid oversized image assets and background videos.
- Use existing icon libraries if available; avoid inconsistent emoji as primary UI icons.
- Keep shadows, borders, gradients, and glow effects restrained and consistent.
- Avoid unnecessary animation dependencies.
- Prevent layout shifts.
- Keep console output free of new errors and warnings.
- Maintain TypeScript, lint, formatting, and accessibility standards used by the repository.

---

## 16. Required implementation workflow

### Phase 1 — Audit

Inspect routes, components, data models, states, permissions, and shared styles. Identify which dashboard features are real and which areas currently use sample data or incomplete flows.

### Phase 2 — Design system and shell

Refine the existing dashboard surfaces, typography, sidebar, top bar, buttons, badges, inputs, and cards. Preserve routes and existing interactions.

### Phase 3 — Overview and empty states

Improve the overview hierarchy, real metrics, recent activity, and first-use guidance. Implement polished empty, loading, error, and success states based on actual app state.

### Phase 4 — Core analysis workflow

Polish repository selection, PR selection, analysis submission/progress, and report navigation without changing the analysis engine.

### Phase 5 — Report and graph polish

Improve graph clarity, evidence panels, file categories, risk explanations, and validation recommendations using real backend data.

### Phase 6 — Responsive and accessibility pass

Test desktop, tablet, and mobile layouts; keyboard navigation; contrast; reduced motion; and screen-reader labels.

### Phase 7 — Verification

Run the repository's relevant checks where possible:
- Typecheck.
- Lint.
- Production build, if disk space and environment allow.
- Relevant unit/integration tests.
- Manual navigation and data-flow checks.
- Browser console checks.

Test at least:
- New user with no repository.
- User with connected repository but no analysis.
- User with a running analysis.
- Completed analysis.
- Failed analysis.
- Analysis with incomplete/unsupported coverage.
- User without permission to access a repository or report.

Do not fabricate results if these states cannot be reached. Report what was actually tested and what remains blocked.

---

## 17. Definition of done

The dashboard redesign is complete when:

- The interface feels premium, expressive, subtly gamified, and distinct to Impactlia.
- Navigation is clear and all links lead to real destinations.
- The overview prioritizes the next useful action and real recent activity.
- Empty states are helpful and visually polished.
- Analysis progress reflects actual backend state.
- Reports make evidence, potential impact, and limitations easy to understand.
- The graph is legible and complemented by accessible text.
- The dashboard works on desktop, tablet, and mobile.
- Motion is restrained, purposeful, and respects reduced-motion settings.
- No fake metrics, fake findings, fake progress, or invented product capabilities have been introduced.
- Existing authentication, authorization, analysis, and database behavior remain intact.
- Checks are run where possible and results are reported honestly.

---

## 18. Final instruction to Claude Code

**Audit the current repository first, then implement the dashboard redesign in the existing application.**

Do not stop after creating a plan. Make the actual frontend improvements in controlled steps. Do not blindly rewrite the dashboard, invent features, or replace live data with mock data. Preserve the MVP's working functionality and verify each major change.

The design should take inspiration from the supplied Sentry dashboard's polished dark UI, navigation hierarchy, clear panels, friendly empty states, and interaction details, while expressing Impactlia's own product identity.

The overall experience should help a developer move naturally from:

**Repository → Pull request → Impact analysis → Evidence → Validation**

Make it visually engaging, but keep the engineering information accurate, clear, and trustworthy.
