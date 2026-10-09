# Phase 6 — The Impactlia landing page

**Goal.** A developer who has never heard of Impactlia should understand the problem, understand how the product works, and want to try it within a minute.

The landing page should feel like a credible, polished developer-tools startup: confident, technical, calm, and carefully designed. It must explain Impactlia in plain language without turning into a long marketing essay or pretending that features not yet implemented are already available.

This is the public marketing page. Keep it separate from the authenticated Impactlia workspace and its application shell.

## The message

Impactlia helps engineering teams understand what a code change could affect before they merge or ship it.

The central question is:

**What could this code change affect?**

The page must make the distinction clear: Impactlia is focused on change impact and blast-radius intelligence, not just another generic AI code reviewer.

### Suggested primary copy

**Eyebrow:** CODE CHANGE INTELLIGENCE

**Headline:** Know what your code changes could affect.

**Supporting copy:** Impactlia maps the relationships inside your codebase to help you understand the potential impact of a Pull Request, spot areas that deserve attention, and decide what to review or test before you merge.

**Primary CTA:** Get started

**Secondary CTA:** See how it works

A short supporting line may mention that the first version is being built for TypeScript/JavaScript repositories, but only if that matches the current implementation.

Do not promise that Impactlia prevents every bug, guarantees production safety, or detects every possible impact.

## Page structure

Build a complete, responsive landing page with the following sections in this order.

### 1. Navigation

A simple, high-quality top navigation.

- Impactlia wordmark/name on the left.
- Links that scroll to the relevant sections: How it works, Why Impactlia, and FAQ.
- A low-emphasis Sign in link for returning users.
- A prominent Get started button.
- On small screens, use a compact mobile menu that is keyboard-accessible and closes after navigation.

Keep the navigation visually light. It may become slightly more compact or gain a subtle background when the page scrolls, but do not add heavy effects.

The wordmark can be typographic if no real logo asset exists. Do not invent a complex logo or use a random icon pack mark as a substitute for a brand identity.

### 2. Hero: explain the value immediately

The first viewport should answer three questions without scrolling:

- What is Impactlia?
- What problem does it solve?
- What can I do next?

Use the hero copy above, with a strong headline, readable supporting copy, and two clear actions.

The visual should be a product illustration, not a generic stock photo, giant decorative gradient, robot, or abstract AI brain.

#### Hero visual: an illustrative change-impact map

Create a compact, believable preview of a Pull Request being traced through a codebase. It should communicate the product before someone reads every label.

The illustration should show:

- A small PR/change card, such as `PR #128 — Update payment flow`.
- A few changed-file nodes, visually identified as changed.
- Connected downstream file/module nodes, visually identified as potentially affected.
- Directional dependency edges.
- A compact impact summary such as `Changed files`, `Potentially affected`, and `Review focus`.
- A small status or legend explaining the visual states.

Use illustrative example values only. Label the graphic as an example/preview, not a real repository analysis or a measured product result.

The visual should look like a restrained product UI: fine borders, subtle depth, precise spacing, legible labels, and meaningful use of colour. It should resemble a real developer tool rather than a generic dashboard mockup.

### 3. Problem: the diff does not show the whole story

**Suggested heading:** A small change can reach much further than it looks.

Explain that a Pull Request shows what was edited, but not always which other parts of the application rely on the changed code.

Use a simple before/after comparison:

- **What a diff shows:** files changed in the PR.
- **What a developer still needs to know:** which other files or modules depend on them, how far the change reaches, and what deserves additional review.

Keep this section concise. Avoid exaggerated fear-based copy and unsupported statistics.

### 4. How it works: a clear three-step flow

**Suggested heading:** From Pull Request to a clearer picture.

Show the workflow as three connected steps. On desktop, use a horizontal layout; on mobile, stack the steps vertically.

**Step 1 — Connect a repository**
Impactlia starts with the structure of a supported codebase and its real dependency relationships.

**Step 2 — Inspect a Pull Request**
The analysis begins with the files changed by a PR and traces their relationships through the repository.

**Step 3 — Understand the potential impact**
Review the affected areas, the reasons they matter, and the parts of the change that may deserve more testing or attention.

Use a small visual for each step. Connect them with a line or directional indicator so the sequence reads naturally.

The copy must describe the intended product accurately. If the corresponding workflow is not implemented yet, present the section as the product workflow being built and do not create controls that pretend to perform a live analysis.

### 5. Product preview: show what the output means

**Suggested heading:** See beyond the changed files.

Create a wider product-preview section showing an illustrative impact report. This should be the most concrete explanation of the product.

The preview may contain:

- A Pull Request title and a compact change summary.
- A clearly distinguished list of changed files.
- A list or graph of potentially affected files.
- A visual dependency path showing why an affected file is connected.
- A transparent risk/attention summary.
- A short “What to review” area with example recommendations.
- A coverage note showing that some relationships may be unresolved or outside the current analysis.

Use example data that is internally consistent. For example, if a PR changes `payment.ts`, the illustration may show downstream modules such as `checkout.ts`, `invoice.ts`, and `refund.ts` only if the arrows and labels make the relationship clear.

Do not show fake live telemetry, fake customer data, fake performance metrics, fabricated security badges, or a score that is presented as a validated real-world result.

If the real analysis UI is available and stable, prefer reusing its actual components or a controlled screenshot/demo state. Otherwise build a carefully designed illustrative preview using the existing design system. Do not duplicate the full app or create a second graph model that conflicts with the actual parser data contract.

### 6. Why Impactlia: make the difference clear

**Suggested heading:** Not just what changed. What it could affect.

Use three concise value points:

- **See the reach of a change.** Trace direct and indirect relationships across the codebase.
- **Understand why an area matters.** Make the relationship between a changed file and a potentially affected file visible.
- **Know where to look next.** Use the analysis to guide review and validation, not to replace engineering judgement.

Include a small contrast, not a competitor attack:

- General code review: “What might be wrong with this code?”
- Impactlia: “What could this change affect?”

Do not claim that other tools cannot perform impact analysis. Differentiate Impactlia by its focus and workflow rather than making unverified competitor claims.

### 7. Built on evidence, clear about uncertainty

**Suggested heading:** Useful analysis starts with real code relationships.

Explain the trust principle in accessible language:

Impactlia uses code structure and dependency relationships as the foundation for its analysis. Explanations and recommendations should be grounded in that evidence. When a relationship cannot be resolved, the product should say so instead of pretending to know.

Use a small, restrained visual such as:
- Real code relationships
- Traceable impact paths
- Explainable signals
- Visible analysis limitations

This section should build trust without overwhelming visitors with implementation details.

Do not imply complete coverage for every language, framework, dynamic import, or repository. State the supported scope accurately.

### 8. Who it is for

**Suggested heading:** Built for teams moving quickly through code.

Briefly address:
- Developers working in unfamiliar or complex codebases.
- Teams shipping changes frequently.
- Teams using AI-assisted coding tools that want to understand the consequences of changes.
- Engineering leads who want reviews to focus on the areas that matter.

Do not imply that AI coding tools are inherently unsafe. The point is that faster code production increases the value of understanding a change's reach.

### 9. FAQ

Include a short accessible accordion or list with clear answers.

Suggested questions:

**Is Impactlia another AI code reviewer?**  
Impactlia focuses on understanding the potential impact of a change across the codebase. It is designed to complement code review, not simply duplicate it.

**How does Impactlia understand what a change could affect?**  
It uses repository structure and dependency relationships to trace how changed files connect to other parts of the codebase. The quality of the result depends on what the analysis can resolve.

**Does Impactlia guarantee a change will not break production?**  
No. It helps teams understand potential impact and identify areas for review or testing; it cannot guarantee that a change is safe.

**Which languages does it support?**  
Describe only the languages actually supported by the current implementation. If the MVP is still focused on TypeScript and JavaScript, say that clearly and avoid promising a release date for additional languages.

**Can I use it today?**  
Answer based on the current product state. If the MVP is still in development, say that it is being built and direct visitors to the available sign-in, waitlist, or early-access path only if that path actually exists.

### 10. Final CTA

**Suggested heading:** Understand the change before it ships.

**Supporting copy:** Make the potential reach of a Pull Request easier to see, explain, and review.

**Primary CTA:** Get started

Use the same destination and behaviour as the hero CTA. If the product is not open for general use yet, use an honest “Join early access” CTA only if an actual early-access flow has been implemented.

### 11. Footer

Include:

- Impactlia wordmark/name.
- A short one-line description: “Code change intelligence for engineering teams.”
- Links to the landing-page sections.
- Sign in, if available.
- Privacy and Terms only if those pages exist.
- Copyright year generated dynamically.

Do not add broken links, fake social accounts, or policy pages that do not exist.

## Visual direction

The page should feel like a serious, modern developer-tools product.

### Overall look

- Dark-first visual direction is appropriate because the existing Impactlia workspace uses a dark developer-tool aesthetic. Keep contrast and readability high.
- Use a near-black or deep charcoal background, slightly lighter surfaces, subtle borders, and one restrained accent colour derived from the existing product theme.
- Use colour to communicate meaning in the graph: changed, potentially affected, and neutral/unrelated.
- Use a clear type scale with a strong headline, readable body copy, and compact technical labels.
- Use generous whitespace and consistent alignment.
- Use restrained borders, small radii, and deliberate spacing rather than excessive glass effects, glow, gradients, or shadows.
- Avoid a page that looks like a generic AI SaaS template.
- Avoid oversized empty sections, unnecessary card grids, repeated rounded boxes, and walls of copy.
- The page must still look polished in light mode if the current theme system supports light mode.

### Existing design system first

Before building, inspect the current application shell, theme tokens, typography, installed UI components, and graph styles.

Reuse existing design tokens and components where sensible. Do not create a separate incompatible design system or add dependencies simply to produce a marketing page.

Use the existing font setup if one is already established. Do not introduce multiple decorative fonts without a clear reason.

## Motion and interaction

Animation should help explain the product, not distract from it.

### Hero graph animation

Create a subtle, short, finite sequence that can play when the hero enters the viewport:

1. The PR/change card appears.
2. Changed-file nodes become visible.
3. Dependency edges draw or fade in from the changed nodes.
4. Potentially affected nodes appear along those connections.
5. The impact summary becomes visible.

The sequence should finish and remain still. It must not loop endlessly, pulse continuously, or keep moving nodes around.

If reduced motion is enabled, show the final complete illustration without animated transitions.

### Interaction

- “See how it works” scrolls to the workflow section.
- Navigation links scroll to their sections with appropriate anchor offsets.
- Graph node hover/focus can highlight its connected path and show a short tooltip or label.
- A selected node may reveal a small detail card if this can be implemented without making the illustration confusing.
- The FAQ opens and closes accessibly.
- Buttons and links have clear hover, focus, active, and disabled states.

Do not make the animation depend on random positions or random data. The illustration should be deterministic.

Do not introduce an animation library unless the project genuinely needs it and the dependency is approved. CSS and existing tools are preferred for the limited motion described here.

## Responsive behaviour

- Desktop: strong two-column hero with copy on one side and the impact-map visual on the other.
- Tablet: reduce the illustration's density and maintain a clear headline/CTA hierarchy.
- Mobile: stack the hero, simplify the graph preview without hiding its meaning, and ensure the primary CTA is easy to reach.
- Navigation must work by keyboard and touch.
- No horizontal page overflow.
- The graph illustration must not shrink into unreadable tiny labels. Simplify the preview on small screens instead.
- Keep the reading width comfortable and the sections visually distinct.

## Accessibility

- Use semantic landmarks and heading order.
- All links and buttons must be keyboard-accessible.
- The mobile menu and FAQ must expose correct accessible names and state.
- Interactive graph-preview elements must have meaningful labels, or be treated as a single labelled illustration if they are not truly interactive.
- Do not use colour as the only way to distinguish changed and potentially affected nodes; add labels, shapes, or other visual cues.
- Honour `prefers-reduced-motion`.
- Ensure readable contrast in both supported themes.
- Provide visible focus styles.
- Decorative SVG elements should be hidden from assistive technology; informative diagrams should have an accessible summary.

## Routing and product boundaries

- Keep the public landing page separate from authenticated workspace routes.
- Inspect the current route structure before deciding where the marketing page belongs.
- If `/` is currently used by the authenticated workspace, preserve that workflow and move or redirect it deliberately rather than accidentally replacing the workspace.
- Choose a clear route arrangement, for example a public landing page at `/` and the authenticated workspace under `/app`, only after checking the existing implementation and auth redirects.
- The Get started CTA must lead to a real, existing sign-in/onboarding route.
- The Sign in CTA must lead to the existing sign-in route.
- Do not add a form that submits nowhere.
- Do not add fake “Connect GitHub” or “Analyze PR” controls to the landing page unless they invoke a real implemented flow.
- Do not require Supabase data to render the public landing page if the marketing content itself does not need it. A visitor should not see a blank page just because no organization or repository is selected.
- Do not weaken authentication or organization protection to make the landing page public.

## Constraints

- Read `Impactlia_project-doc.md` and the current phase specifications before implementation.
- Inspect the existing routes and components before changing them.
- Do not break the authenticated application shell or theme controls.
- Do not claim functionality is live when it is only planned or illustrated.
- Do not invent customer logos, testimonials, adoption numbers, accuracy percentages, performance benchmarks, or security certifications.
- Do not make unsupported competitor claims.
- Do not use stock imagery as the main product visual.
- Do not turn the page into a generic AI marketing site.
- Do not add unrelated product features to make the landing page appear more complete.
- Keep the product's core question visible: “What could this code change affect?”
- The landing page should explain the problem and the workflow without exposing internal implementation jargon unnecessarily.
- Keep components modular, typed, and consistent with the project's existing conventions.
- Do not install packages without a clear need and approval.

## Acceptance check

1. Open the public landing page in a fresh signed-out browser session. It renders completely without requiring an organization or Supabase-backed dashboard data.
2. A first-time visitor can explain what Impactlia does after reading the hero and workflow sections.
3. The page clearly distinguishes changed files from potentially affected files.
4. The hero contains a polished, legible illustrative impact map that communicates the product at a glance.
5. The hero animation completes and remains still; with reduced motion enabled, the final state appears without motion.
6. Every navigation link and CTA leads to a real destination or section. No button is decorative while appearing functional.
7. The sign-in CTA reaches the existing authentication flow.
8. The authenticated workspace still loads through its intended route, and protected pages remain protected.
9. The FAQ is keyboard-accessible and exposes its open/closed state correctly.
10. The page works at mobile, tablet, and desktop widths without horizontal overflow or unreadable graph labels.
11. Colour is not the only way the graph communicates changed versus potentially affected nodes.
12. No fabricated testimonials, customers, statistics, performance results, or product capabilities appear.
13. The landing page uses the existing design system where appropriate and introduces no unnecessary packages.
14. TypeScript checks, lint, and the production build pass.
15. Test that the landing page does not blink, enter a repeated loading state, or trigger a client/server render loop.

## Not in this phase

Implementing GitHub repository connection. Pull Request ingestion. Diff parsing. Dependency graph generation beyond using a clearly labelled illustrative preview or reusing existing graph components. Blast-radius calculations. Risk scoring. AI explanations. Repository chat. GitHub Checks. CI/CD integration. Pricing/billing. Customer testimonials. A waitlist backend unless explicitly required and implemented end-to-end.

The landing page explains the product and guides visitors to the existing next step. It does not pretend that future product functionality is already available.

## Definition of done

Impactlia has a professional public landing page that clearly explains the problem, the product, and the workflow; shows a compelling but honest visual preview of code-change impact; works across screen sizes; respects accessibility and reduced-motion preferences; routes visitors correctly into the existing product; and passes the project's checks without destabilizing the authenticated workspace.
