# Prompt 1 — Make the Impactlia landing page more interactive

I like the current Impactlia landing page design. Do not redesign it or change the existing content, layout, colours, typography, or overall visual identity.

I want you to enhance the page with subtle, polished animations and micro-interactions that make it feel like a premium, modern developer-tools startup.

First, inspect the existing landing page implementation and identify its sections and components. Then implement the following enhancements directly in the existing codebase.

## 1. Scroll-triggered reveal animations

As visitors scroll down the page, sections and their content should appear smoothly.

- Headlines should fade in while moving upward slightly.
- Supporting paragraphs should fade in shortly after their headings.
- Cards and feature descriptions should reveal themselves as they enter the viewport.
- Use a subtle stagger effect for items in the same row.
- Animate each element only once when it first enters the viewport.
- Do not make entire sections disappear and reappear when users scroll up and down.

Use IntersectionObserver or an existing animation solution already installed in the project.

## 2. Hero section

Make the hero feel more alive without becoming distracting.

- Fade in the headline and supporting paragraph.
- Reveal the CTA buttons with a small delay.
- Animate the dependency graph illustration in a clear sequence.
- Show the changed-file nodes first.
- Draw or reveal the dependency connections next.
- Reveal the potentially affected nodes after their connections.
- Finally, reveal the small impact summary.

The animation should explain how Impactlia traces a code change through a codebase.

Play the sequence once when the hero enters view, then leave the illustration in its final state.

## 3. Section transitions

Apply subtle reveal animations to:
- The problem section.
- The three-step How It Works section.
- The product preview and impact report.
- The Why Impactlia section.
- The analysis trust section.
- The target audience section.
- The FAQ section.
- The final CTA section.

Vary the animation slightly where appropriate, but maintain a consistent visual language throughout the page.

## 4. Card micro-interactions

Add subtle hover and focus effects to interactive cards and relevant content blocks.

Examples:
- Slight border-colour transitions.
- A very small upward movement on hover.
- Subtle background changes.
- Smooth transitions for buttons and links.
- A restrained highlight when hovering over dependency graph nodes or connections.

Avoid excessive scaling, strong shadows, glowing borders, or large movements.

## 5. Interactive dependency graph

Make the hero graph and product preview feel more interactive.

- Hovering over a node should highlight its connected dependency path where the existing graph implementation supports it.
- Dim unrelated connections slightly when a node is highlighted.
- Show a small tooltip or detail label where useful.
- Restore the normal appearance when the pointer leaves.
- Make the same essential information accessible on touch devices and through keyboard interaction.

Do not invent dependencies or change the underlying graph data to create an animation.

## 6. How it works

Give the three steps a subtle sequential reveal as the visitor scrolls to the section.

If the existing design supports it, animate the connecting line between the three steps so the workflow reads visually from:
Repository → Pull Request → Impact Analysis.

Do not introduce an autoplaying carousel or require visitors to click through the steps.

## 7. FAQ interactions

Make the FAQ accordion feel smooth and polished.

- Animate opening and closing.
- Rotate the existing indicator if appropriate.
- Preserve keyboard accessibility.
- Ensure the animation does not clip answers or make the page jump unexpectedly.

## 8. Performance and accessibility

- Respect `prefers-reduced-motion`.
- When reduced motion is enabled, show the content immediately without unnecessary movement.
- Content must remain readable if JavaScript or an animation fails.
- Avoid layout shifts during animations.
- Do not add a new animation library unless genuinely necessary.
- Reuse existing dependencies and components where possible.
- Avoid animating expensive properties such as width, height, and layout positions when opacity and transform will work.
- Avoid infinite animations, continuous pulsing, floating elements, and distracting background movement.
- Do not delay access to content until an animation finishes.
- Ensure the page works on mobile, tablet, and desktop.

## 9. Preserve the existing application

Do not change the existing landing page copy, routing, authentication, or application functionality.

Do not modify unrelated components.

Do not replace the existing design with a generic animated SaaS template.

## Implementation process

First inspect the existing code and identify the best components to enhance.

Then implement the animations directly. Do not just describe what should be done.

After implementation:
- Run TypeScript checks.
- Run lint.
- Run the production build.
- Fix any errors introduced by your changes.
- Verify that the page still renders correctly and does not blink or repeatedly re-render.

The final result should feel smooth, responsive, professional, and intentionally designed—not like a page with animations added everywhere.

The guiding principle is: animations should help visitors understand Impactlia and guide their attention through the page.
