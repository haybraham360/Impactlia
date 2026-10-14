# Impactlia — Gamified Landing Page Redesign Brief for Claude Code

## Mission

Redesign the **Impactlia marketing landing page** into a more expressive, playful, interactive developer-tool experience, taking high-level inspiration from Sentry's visual energy and storytelling:

- https://sentry.io/welcome/
- The reference screenshot supplied by the founder in this conversation.

The goal is a premium developer product that feels alive: dark atmospheric backgrounds, bold typography, colorful accent gradients, custom illustrations or visual metaphors, floating product UI, animated code/dependency diagrams, scroll-based storytelling, tactile buttons, and polished micro-interactions.

**Do not copy Sentry.** Do not reuse its logo, characters, illustrations, wording, brand assets, or exact layouts. Extract broad design principles and create a distinct visual identity for Impactlia. The result should feel like Impactlia, not a Sentry clone.

This is a design and frontend implementation brief, not permission to rebuild the whole application or invent product functionality.

---

## 1. Product context: what Impactlia is

Impactlia is an early-stage developer tool focused on **pull-request change-impact and risk intelligence**.

Its central question is:

> **Know what your code changes could affect.**

When a developer changes code, the consequences may extend beyond the files directly edited. A pull request can affect dependent modules, routes, shared utilities, components, APIs, or other connected areas. Impactlia aims to help developers understand that potential blast radius before merging.

### Intended workflow

1. **Connect a repository** — connect or select a supported GitHub repository.
2. **Choose a pull request** — select a PR for analysis.
3. **Inspect the change** — read the PR's actual diff and relevant repository structure.
4. **Map potential impact** — deterministic repository analysis identifies direct changes and supported dependency relationships that may be affected.
5. **Review evidence and risk signals** — present changed files, potentially affected files, dependency paths, and evidence-based areas that may need attention.
6. **Plan validation** — suggest areas or tests worth checking, based on available evidence and supported analysis.
7. **Make a more informed merge decision** — use the report to decide what to review and validate next.

This is an assistive analysis tool. It must not claim to guarantee correctness, prevent every regression, or prove that a change is safe.

### Product principles

- Repository-derived evidence is the source of truth.
- Deterministic parsing and dependency analysis are the foundation.
- AI, if available, may explain structured findings, but must not invent dependencies, risks, tests, or repository facts.
- Clearly distinguish **changed files**, **potentially affected files**, **confirmed failures**, **coverage gaps**, and **recommendations**.
- Show uncertainty honestly when the repository cannot support a conclusion.
- Impactlia is an early MVP. Do not imply every language, framework, repository type, or analysis capability is already supported.
- Describe the intended value without pretending that unimplemented capabilities are live.

---

## 2. Primary design goal

Make the landing page more **gamified in its visual storytelling**, not turn Impactlia into a literal video game.

“Gamified” means:

- A memorable visual world and playful developer-friendly personality.
- Clear progress through a story as visitors scroll.
- Animated code changes flowing into a dependency graph and then into an impact report.
- Small visual rewards for exploration: hover responses, reveal animations, graph nodes lighting up, cards lifting, and transitions that make the product feel responsive.
- A sense of discovery and momentum.
- Product visuals that feel tangible and interactive.

It does **not** mean adding fake points, XP, badges, leaderboards, streaks, confetti, arcade UI, or competitive rankings to the product. Do not invent game mechanics or user data.

The website should remain credible to software engineers, engineering managers, technical founders, and potential design partners.

---

## 3. Design direction

### Overall atmosphere

Create a premium, dark, high-contrast developer-tool landing page with an expressive but controlled visual language.

Possible direction:

- Deep ink, midnight plum, or blue-black backgrounds.
- Layered gradients and subtle ambient glows.
- A distinctive Impactlia accent palette such as electric violet, vivid magenta, cool cyan, and restrained lime for positive/validated states.
- Bright, legible typography with selected words highlighted by gradients or accent colors.
- Subtle grain or atmospheric texture only if it does not reduce clarity or performance.
- Cards and panels with visible depth, carefully controlled borders, and soft shadows.
- A combination of crisp technical UI and playful illustrative elements.
- Strong visual rhythm: spacious hero, focused product demo, alternating feature sections, a clear process, trust/security information, and a decisive final CTA.

Use the existing Impactlia logo, fonts, design tokens, and brand assets where they exist. Inspect the repository first. If there is no established visual system, create a small consistent one rather than adding arbitrary styles to every component.

### Sentry-inspired principles to reinterpret

The supplied reference uses a dark, saturated visual environment, expressive headline typography, an illustration-led hero, floating product panels, a long scroll-driven narrative, product screenshots integrated into feature explanations, colorful section accents, social proof, onboarding guidance, security messaging, and repeated calls to action.

Translate those principles into Impactlia's own story:

- **From errors to impact:** the hero shows a proposed code change expanding through a codebase dependency map.
- **From abstract to tangible:** show believable product UI instead of generic abstract AI imagery.
- **From static to responsive:** let graph nodes, file cards, connectors, buttons, and panels respond subtly to interaction.
- **From feature list to narrative:** tell a clear story from PR diff → connected code → potential blast radius → review and test guidance.
- **From decoration to explanation:** every visual should help visitors understand the product.

Do not imitate Sentry's exact copy, logo bar, characters, brand illustrations, section titles, or page composition one-for-one.

---

## 4. Audience and message

### Primary audience

- Software developers working with GitHub pull requests.
- Frontend and backend engineers maintaining interconnected codebases.
- Engineering leads who want better visibility into the potential consequences of changes.
- Technical founders and small engineering teams that need to make review and validation more deliberate.

### Core message

Impactlia helps developers understand the **potential blast radius of a pull request** before merging.

### Supporting messages

Use these only where they match the actual implementation:

- See which files changed and which connected areas may be affected.
- Follow supported dependency paths instead of relying only on a list of changed files.
- Surface evidence-based risk signals and areas worth validating.
- Understand why an area was flagged.
- Get a clearer starting point for code review and test planning.

Avoid unsupported claims such as “catches every bug,” “zero regressions,” “guaranteed safe merges,” “understands any codebase,” “100% accurate,” or made-up productivity statistics.

---

## 5. Recommended landing page structure

Build a cohesive page, not a collection of unrelated animations. Preserve existing working routes, authentication behavior, and navigation.

### Section A — Navigation

A clean, compact navigation bar with:

- Impactlia logo/wordmark.
- Product or How it works anchor.
- Features anchor.
- Security/Trust anchor if that content exists.
- Sign in link if the existing application supports it.
- One primary CTA such as **“Analyze a pull request”** or **“Get started”**, based on the actual working onboarding flow.

Requirements:
- Keep navigation readable over the hero.
- It may become subtly more solid or blurred when scrolling.
- Mobile navigation must be functional and keyboard accessible.
- Do not add links to pages that do not exist.

### Section B — Hero: make the impact visible

Suggested headline:

> **Know what your code changes could affect.**

Suggested supporting copy:

> Understand the potential blast radius of a pull request. Trace connected parts of your codebase, review evidence-based risk signals, and see what may need testing before you merge.

Suggested primary CTA: **“Analyze a pull request”**  
Suggested secondary CTA: **“See how it works”**

Use the current product flow to decide the exact CTA. Do not promise immediate analysis if the user cannot actually start one yet.

#### Hero visual concept

Create a custom Impactlia “change-to-impact” scene using actual UI components or carefully crafted product-like mockups:

- A compact pull-request/diff card showing a few changed files.
- A central dependency graph with connected file/module nodes.
- A small set of affected nodes lighting up as the graph animates.
- An impact summary card showing clearly labeled example findings.
- A small validation/review checklist.

Animation sequence:
1. A PR is selected.
2. Changed files become highlighted.
3. Supported dependency edges appear or illuminate.
4. Potentially affected nodes are highlighted.
5. A concise impact report is revealed.

Keep the scene readable at a glance. It must not look like a random network visualization.

If the product already has a React Flow graph component or other graph visualization, reuse it only if safe and practical. Otherwise, create a lightweight, isolated marketing illustration. Do not introduce a complex visualization library solely for a decorative hero.

Use sample data only in a clearly illustrative marketing demo. Label it **“Illustrative example”** where necessary. Never present sample values or sample findings as a real repository analysis.

### Section C — A short “How it works” sequence

Explain the process in three or four steps:

**01 — Connect a repository**  
Choose a supported GitHub repository.

**02 — Select a pull request**  
Start with the actual changes proposed in a PR.

**03 — Trace potential impact**  
Use supported code relationships to understand which connected areas may be affected.

**04 — Review what to validate**  
Inspect the evidence and use the findings to guide review and testing.

Use animated numbered markers, a connected progress line, or small transitions between steps. Keep the language concise. Do not add steps that the product does not support yet.

### Section D — Feature story: from diff to blast radius

Show a convincing product visual with a code diff or changed-file list on one side and an impact graph/report on the other.

Potential headline:

> **A changed file is only the beginning.**

Explain that a change can affect connected modules and shared code. Impactlia's value is helping the developer inspect the relationships that the analysis can establish.

Visual interaction ideas:

- Hovering or focusing a changed file highlights the corresponding node.
- Selecting a node highlights its supported dependency path.
- A legend distinguishes changed files from potentially affected files.
- A small evidence panel explains why a node is included.

These interactions should work with pointer, keyboard, and touch where appropriate. Do not make important content available only on hover.

### Section E — Feature story: make risk understandable

Potential headline:

> **See why an area deserves a closer look.**

Explain that a useful report should give developers evidence and context, not simply an unexplained risk score.

Show an illustrative risk/report panel with fields such as:

- **Changed files**
- **Potentially affected files**
- **Evidence / dependency path**
- **Areas to review**
- **Suggested validation**
- **Analysis limitations**, when applicable

Only display fields the actual product supports or that are clearly part of an illustrative mockup. Do not fabricate confidence percentages, test coverage, failures, risk scores, or repository facts.

If the application uses a risk classification, reuse its real terminology and definitions. Do not invent a new scoring model in the landing page.

### Section F — Feature story: move from findings to validation

Potential headline:

> **Know where to focus your review.**

Explain that impact findings can help developers choose what to inspect and validate before merging. Keep this framed as guidance rather than a guarantee.

A visual can show a compact checklist with example items such as reviewing a connected module or validating a related route. Mark it as illustrative if the example is not generated by a real analysis.

### Section G — A concise product walkthrough

Use a short, visually rich sequence or an interactive demo to show the end-to-end workflow:

`Pull request → Changed files → Dependency relationships → Potential impact → Review and validation`

A visitor should understand the value without reading a long essay.

If a live demo is feasible, use a small, safe, deterministic fixture dataset. Do not require GitHub authentication just to see a preview. If the demo is static, label it clearly and ensure the controls do not pretend to execute a real analysis.

### Section H — Trust and security

Repository access is sensitive. Make trust part of the product story.

Explain only verified facts about:

- What permissions are requested from GitHub.
- Which repository data is read.
- Whether source code or diffs are persisted.
- How users disconnect a repository.
- How authentication and workspace access are handled.
- Any existing privacy/security documentation.

**Do not make up security certifications, encryption claims, retention guarantees, compliance status, or data-handling policies.** If these details have not been verified, use a restrained statement and flag the missing information for the founder rather than inventing copy.

### Section I — Early product / feedback invitation

Impactlia is an early MVP. The page should be confident but honest about its stage.

Possible copy:

> **Early access. Real feedback matters.**  
> We're building Impactlia to make change-impact analysis more useful for everyday engineering work. Try the current experience and tell us what helps, what is confusing, and what you would want to see next.

Use a CTA only if it leads to a real destination:
- Try Impactlia
- Get started
- Share feedback
- Contact the team

Do not create fake testimonials, fabricated customer logos, made-up usage numbers, or claims that the product is trusted by companies that have not actually adopted it.

### Section J — Final CTA and footer

End with one clear, high-contrast CTA. Repeat the core value proposition in a concise form.

The footer should use only existing, working links and current company information. Do not invent social accounts, documentation pages, legal policies, or contact details.

---

## 6. Gamified interaction and motion system

The aim is **playful, tactile and purposeful**, not distracting.

### Interactions to implement where appropriate

- Scroll reveal for major sections, with small staggered delays for grouped cards.
- Gentle movement or parallax in decorative hero elements.
- Graph nodes that illuminate in a clear sequence.
- Dependency edges that draw in or brighten as the animation progresses.
- Cards that lift slightly on hover and return smoothly to rest.
- Buttons that feel tactile: subtle lift on hover, a pressed state on activation, and clear focus styling.
- Tabs or selectors that update a connected illustrative preview when functional.
- Small visual status transitions when moving from “PR selected” to “Impact mapped” to “Report ready,” but only inside a clearly labelled demo.
- A restrained progress marker or section transition that gives the page a sense of journey.
- A reduced-motion version that avoids unnecessary movement.

### Motion guidelines

- Use CSS transitions and keyframes for simple effects.
- Use the project's existing animation library if one is already installed and suitable.
- Do not add a large animation dependency without a clear reason.
- Keep motion short, purposeful and consistent.
- Avoid constant movement everywhere; let the page have quiet moments.
- Avoid cursor-following effects that make text hard to read.
- Avoid excessive blur, glow, particle systems, huge video backgrounds, and animations that make the site slow.
- Respect `prefers-reduced-motion`.
- Avoid layout shifts during animation.
- Do not animate important information in a way that disappears before it can be read.

### Accessibility

- Use semantic HTML and correct heading order.
- Ensure interactive elements work with keyboard navigation.
- Give visible focus indicators.
- Maintain sufficient color contrast.
- Do not use color alone to communicate node status or risk.
- Provide text labels or a legend for graph states.
- Ensure touch targets are practical on mobile.
- Disable or simplify nonessential animation when reduced motion is requested.

---

## 7. Visual system and component direction

Create reusable components and tokens rather than one-off styling.

### Suggested component inventory

Use or adapt existing project components before creating duplicates:

- `LandingNavbar`
- `HeroSection`
- `ChangeImpactScene`
- `PullRequestCard`
- `ChangedFilesPanel`
- `DependencyGraphPreview`
- `ImpactSummaryCard`
- `SectionReveal`
- `HowItWorksSection`
- `FeatureStorySection`
- `ValidationChecklist`
- `SecuritySection`
- `EarlyAccessSection`
- `FinalCTA`
- `LandingFooter`

These are suggested names, not mandatory. Follow existing naming conventions and directory structure.

### Tokens to define or refine

- Background and surface colors.
- Primary and secondary accent colors.
- Text, muted text, border and focus colors.
- Border radii.
- Elevation/shadow styles.
- Spacing scale.
- Heading and body typography.
- Animation duration and easing.
- Graph node states and edge styles.

Use a limited palette with consistent meaning. For example, one accent can identify changed files, another can identify potentially affected files, and a third can identify recommendations. Confirm the mapping is understandable and do not rely on color alone.

### Illustrations and assets

Prefer, in order:

1. Existing Impactlia assets and real product UI.
2. New interface illustrations built from HTML/CSS/SVG or existing project tools.
3. New custom illustration assets if there is a clear benefit.

Do not hotlink Sentry assets or reuse Sentry's characters. Avoid generic stock imagery and unrelated game imagery. The playful visual metaphor should come from code changes, dependency paths, connected systems, and developer workflows.

---

## 8. Technical constraints — inspect before changing anything

Impactlia's existing project has been developed as a modern Next.js application. The known intended stack includes:

- Next.js App Router
- React
- Strict TypeScript
- Tailwind CSS v4
- pnpm
- Supabase for database/auth-related functionality
- Clerk for authentication in the deployed application
- A repository analysis engine using TypeScript/JavaScript parsing and dependency relationships
- React Flow and Dagre for graph visualization in relevant product areas, if present in the current checkout

These details are context, **not permission to assume the repository is unchanged**. Verify the actual codebase and installed packages before implementation.

### Mandatory preflight

Before editing:

1. Inspect `package.json` and the lockfile.
2. Inspect the actual app routes and identify the current public landing page.
3. Inspect existing styles, Tailwind setup, fonts, icons, design tokens and components.
4. Inspect existing authentication and onboarding routes.
5. Identify shared components used by authenticated application pages.
6. Inspect current screenshots or available local preview if possible.
7. Check Git status and preserve unrelated user changes.
8. Identify the current landing page's actual functionality and existing links.
9. Check available disk space before running large builds or cleanup tasks.

Do not assume the landing page lives at a particular path. Find the route from the current repository.

### Preserve working functionality

- Keep authentication and session behavior intact.
- Keep the GitHub connection and onboarding paths intact.
- Do not change database schemas or Supabase migrations for a marketing redesign.
- Do not change environment variables or production configuration unless explicitly necessary and approved.
- Do not rewrite the analysis engine.
- Do not modify authenticated dashboard screens as part of this task unless a shared component change is essential; if so, verify that the dashboard still works.
- Do not remove features simply to make the page visually simpler.
- Do not replace real flows with static mockups.
- Do not create fake interactive controls.
- Do not add packages if native CSS or existing dependencies are enough.

### Avoid unstable implementation

- Keep animations isolated and deterministic.
- Clean up timers, event listeners and observers correctly.
- Avoid hydration errors from random values or browser-only APIs during server rendering.
- Avoid continuous animation loops that cause CPU usage or blinking.
- Do not trigger repeated state updates from effects.
- Avoid unnecessary client components; use server components where appropriate.
- Prevent overflow and layout shifts on mobile.
- Use responsive images and lightweight SVG/CSS visuals.
- Keep production builds compatible with the current Node/pnpm setup.

---

## 9. Responsive behavior

The experience must feel intentionally designed on desktop, tablet and mobile.

### Desktop

- Large, expressive hero headline.
- Rich product visual that can use the available horizontal space.
- Feature stories with clear visual/text balance.
- Graphs and panels large enough to read.

### Tablet

- Reduce decorative complexity.
- Preserve a clear hierarchy.
- Avoid squeezed text beside complex product visuals.

### Mobile

- Stack hero text and visual in a sensible order.
- Keep the main CTA visible without overwhelming the first screen.
- Simplify dependency graph previews to a legible subset.
- Make code snippets and report cards readable without horizontal scrolling.
- Avoid large decorative assets that cover text or cause excessive page height.
- Keep animations lightweight.
- Ensure nav, buttons and demo controls work by touch.

Do not merely scale down the desktop design. Make deliberate responsive decisions.

---

## 10. Copy and content rules

The page should sound like a sharp, thoughtful developer tool: clear, direct, confident, human and slightly playful.

Use concise headlines, short supporting paragraphs, meaningful labels and specific examples.

Prefer:
- “Understand the potential impact of a pull request.”
- “Trace the code relationships that matter.”
- “See which connected areas may need attention.”
- “Use evidence to guide review and testing.”

Avoid:
- Empty claims such as “Revolutionize your workflow with next-generation AI.”
- Overuse of “AI-powered” as a substitute for explaining the product.
- Claims that the tool finds every bug or prevents every regression.
- Made-up customer quotes, customer logos, adoption figures or benchmarks.
- Pretending a sample visualization is a live repository analysis.
- Claiming unsupported framework/language coverage.
- Overly game-like language that makes the tool seem unserious.

The visual design may be playful; the product claims must remain precise.

---

## 11. Performance and quality requirements

- Keep the page fast and responsive.
- Avoid large background videos and oversized animation libraries.
- Lazy-load noncritical media where appropriate.
- Prevent cumulative layout shift.
- Keep client-side JavaScript lean.
- Avoid unnecessary re-renders in animated graph components.
- Ensure animations do not block interaction.
- Keep browser console output free of new errors and warnings.
- Respect existing linting, formatting and TypeScript rules.

### Required verification

After implementation:

1. Run the repository's relevant lint/typecheck commands if available.
2. Run the production build if environment and disk space permit.
3. Fix errors caused by the changes.
4. Test the landing page at desktop and mobile widths.
5. Test all landing-page navigation links and CTAs.
6. Test sign-in and sign-up entry points without changing authentication behavior.
7. Check keyboard navigation and visible focus.
8. Test reduced-motion behavior.
9. Check the browser console.
10. Verify that authenticated product routes and shared components still render.
11. Confirm that no fake functionality or unsupported claims were introduced.

If a check cannot be completed because an environment variable or external service is missing, report that limitation explicitly. Do not claim the check passed.

---

## 12. Implementation plan

Work in controlled steps. Do not attempt a risky full rewrite in one pass.

### Phase 1 — Audit and plan

- Inspect the existing landing page and app structure.
- Identify the current design tokens and reusable components.
- List which sections can be improved in place and which need new components.
- Identify the real onboarding and authentication CTAs.
- Report any uncertainty about current product capabilities before writing claims.

### Phase 2 — Establish the visual foundation

- Refine the landing-page color, typography, spacing, surface and motion tokens.
- Keep the visual system consistent.
- Preserve the existing application design outside the marketing page unless explicitly required.

### Phase 3 — Build the hero and core product visual

- Implement the headline, supporting copy and CTA.
- Build a clear pull-request-to-impact visual.
- Make the visual responsive and accessible.
- Use illustrative data honestly.

### Phase 4 — Build the scroll narrative

- Add the workflow section and feature stories.
- Use purposeful scroll reveals and graph interactions.
- Add trust/security and early-MVP feedback sections using verified information.
- Ensure the page has a strong final CTA.

### Phase 5 — Polish and verify

- Test all responsive breakpoints.
- Add reduced-motion support.
- Check accessibility, performance, hydration and console errors.
- Run typecheck/lint/build where possible.
- Test that existing auth and application routes remain intact.

### Phase 6 — Summarize the changes

At completion, provide:
- A summary of what changed.
- The files created or modified.
- The interactions and animations implemented.
- Any assumptions or product details that need founder confirmation.
- Tests actually run and their outcomes.
- Any known issues or unfinished items.

Do not claim deployment has occurred unless it has actually been performed and verified.

---

## 13. Definition of done

The redesign is complete when:

- The page immediately communicates Impactlia's pull-request impact-analysis value.
- The visual language feels expressive, gamified and premium without copying Sentry.
- The hero shows the relationship between code changes and potential impact.
- Visitors can understand the product workflow in a few seconds.
- The page uses believable product visuals and evidence-conscious copy.
- Motion is purposeful, smooth, responsive and accessible.
- The page works well on mobile.
- All CTAs point to real, appropriate destinations.
- Existing authentication, onboarding and product routes still work.
- No fake customer proof, invented capabilities or misleading demo behavior has been added.
- Relevant checks have been run and their results reported honestly.

---

## 14. Final instruction to Claude Code

**Start by auditing the current repository. Then implement the redesign within the existing architecture.**

Do not stop at producing a plan or a static design description: make the frontend changes. However, do not blindly overwrite the landing page, replace the app shell, or invent features. Work incrementally, preserve the working MVP, and verify the result.

The outcome should feel like a distinct, playful, technically credible Impactlia experience: **a visual journey from a pull request to the code it may affect.**
