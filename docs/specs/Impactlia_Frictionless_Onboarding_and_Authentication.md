# Impactlia — Frictionless Onboarding and Simple Authentication

## Objective
Simplify Impactlia's first-time experience so people can try the product quickly without a long or intimidating sign-in process.

Impactlia currently uses Clerk. **Inspect the existing implementation before changing it.** Prefer simplifying Clerk's current flow over replacing the provider or building a new authentication system.

Desired experience:
1. A visitor opens Impactlia and can understand how to get started.
2. A very short onboarding collects only information genuinely needed.
3. A valid user gets a persistent account/profile in the database when appropriate.
4. The user reaches the core tool with minimal friction.
5. Authentication or GitHub permissions are requested only when a feature requires them, such as connecting a private repository.

The goal is low-friction access, **not insecure access**. Do not remove authorization checks for private data or sensitive actions.

## Product Requirements
- Preserve current functionality, analysis pipeline, routes, and visual design except for small changes needed for this flow.
- Do not redesign the whole app.
- Do not introduce a new paid authentication service.
- Do not replace Clerk unless there is a clear technical reason, explained first.
- Do not create fake accounts or treat an anonymous browser ID as a verified user.
- Do not require a long profile before a user can try the product.
- Do not request GitHub permissions before they are needed.
- Be transparent about what information is collected and why.

## Phase 1: Audit Existing Authentication
Before editing:
1. Inspect Clerk configuration, middleware, route guards, sign-in/sign-up pages, session handling, user synchronization, database schema, and onboarding components.
2. Identify which routes require authentication and why.
3. Identify how Clerk identities map to database user records.
4. Determine the minimum requirements for trying the core product.
5. Identify which actions require an authenticated account or GitHub authorization.
6. Propose the smallest secure implementation that removes unnecessary friction.

Do not assume database tables, file paths, or auth architecture exist. Reuse existing models and helpers.

## Desired User Experience

### 1. Clear call to action
Use a direct primary action such as **“Try Impactlia”** or **“Get started.”** Avoid forcing visitors through lengthy registration before they can understand or try the product.

### 2. Minimal onboarding
Create the shortest practical onboarding. Collect only fields the product truly needs.

Potential fields, only if useful:
- Display name
- Primary use case (optional)
- Role or experience (optional)

Do not require all of these. Avoid company name, job title, or a lengthy questionnaire unless the existing product genuinely needs them. Let users skip optional questions and explain briefly what happens next.

### 3. Select the simplest secure access model
Inspect the current product and choose the most suitable approach; do not implement all options automatically.

**Option A — Simplify Clerk (preferred starting point)**
- Use a clean, minimal sign-in/sign-up flow supported by the existing Clerk setup.
- Prefer a supported low-friction method, such as an already-configured social sign-in or email verification, if appropriate.
- Remove unnecessary fields and steps.
- Create or synchronize the application user after Clerk confirms the identity.
- Preserve session handling and server-side authorization.

**Option B — Allow a limited public trial**
- If meaningful functionality can be tried safely without private repository access, allow a visitor to try it before creating an account.
- Clearly distinguish demo/sample data from real analysis.
- Never present fake results as analysis of a real repository or PR.
- Require authentication when the user needs saved work, private repository access, or another account-specific feature.

**Option C — Guest session**
- Consider this only if it fits the current architecture.
- Use a secure server-issued guest session or supported equivalent.
- Scope guest data to that session and define expiry/retention.
- Do not treat a guest as a verified identity or create a permanent verified profile from an unverified identifier.
- Explain whether guest work is temporary and how users can preserve it.
- If supported, provide a safe way to link guest work to a real account.

If the core tool cannot work meaningfully without GitHub authorization, use the shortest practical sign-in and explain why it is needed.

## User Record and Database
The goal is to have a real, persistent application account without burdensome registration.

- Reuse the current database and user model.
- If Clerk is the identity provider, create/synchronize the application user only after Clerk establishes a valid identity.
- Make user creation idempotent so repeated sign-ins or webhook deliveries do not create duplicates.
- Use the stable Clerk user ID or existing provider identifier as the identity key.
- Store only minimum necessary profile information.
- Do not trust client-submitted user IDs or email addresses as proof of identity.
- Use verified identity information from the server-side authentication context.
- If guest sessions are implemented, keep guest records separate from verified accounts.
- Add migrations only if necessary and follow existing conventions.
- Never expose database service-role keys or privileged credentials to the browser.

## Authentication and Authorization Safety
- Keep server-side authentication and authorization on private routes/actions.
- Verify ownership of saved analyses, repository connections, and user data server-side.
- Prevent users from accessing another user's private analysis by changing an ID in a request.
- Keep Clerk secrets and credentials server-side.
- Do not remove middleware or route guards indiscriminately.
- Protect GitHub connections and repository access with appropriate permissions.
- Ask for GitHub authorization only when required.
- Handle expired sessions and failed sign-ins clearly.
- Do not store sensitive tokens in local storage or other insecure client-side locations.
- Preserve the project's CSRF, cookie, session, and redirect protections.

## Returning Users
- After onboarding, send users directly to the most useful next screen in the existing product.
- Do not repeat onboarding on every visit.
- Persist completion in the existing profile or an appropriate server-side mechanism.
- Allow optional questions to be skipped.
- Support sign-out and account/session recovery through the current provider.
- If guest access is used, explain what is temporary and how work can be saved.

## UI and Accessibility
- Preserve Impactlia's current visual style.
- Keep onboarding short, responsive, and easy on mobile and desktop.
- Use clear labels, useful errors, and loading states.
- Avoid unnecessary modal chains, repeated confirmations, and unexplained redirects.
- Ensure keyboard navigation and accessible labels.
- Avoid adding a large UI framework or unnecessary dependencies.

## Analytics (Optional)
If analytics already exists, consider measuring:
- Onboarding started/completed
- Optional step skipped
- First analysis started/completed
- Authentication abandoned

Do not add a paid analytics provider without approval. Do not log private source code, tokens, or unnecessary personal information. Analytics must not block the implementation.

## Testing Requirements
Use the project's existing test setup. Cover:
- New visitors can reach the intended start flow without unnecessary steps.
- Minimal onboarding accepts valid input and optional fields can be skipped.
- A verified Clerk identity creates or updates exactly one application user record.
- Repeated sign-ins do not create duplicate records.
- Unauthenticated requests cannot access private data.
- Users cannot access another user's analyses or repository connections.
- Guest access, if implemented, cannot impersonate a verified user.
- Private repository access still requires appropriate authorization.
- Returning users do not unnecessarily repeat onboarding.
- Expired sessions and auth failures are handled clearly.
- Existing analysis workflows still work.
- Privileged credentials are not exposed to client-side code.

## Implementation Phases

### Phase 1 — Audit
Map the current Clerk flow, database user model, protected routes, and minimum requirements for using the tool. Report the proposed approach before editing.

### Phase 2 — Simplify entry
Remove unnecessary sign-in steps and make the main call to action lead to minimal onboarding or a safe trial experience.

### Phase 3 — User persistence
Ensure verified users are synchronized idempotently with the existing database. If guest access is chosen, keep guest records separate and document their limitations.

### Phase 4 — Progressive authentication
Require authentication and GitHub authorization only for features that need them. Preserve server-side protection for private data and sensitive actions.

### Phase 5 — Persist onboarding
Remember completion and direct returning users to the appropriate screen.

### Phase 6 — Validate
Run relevant lint, type-check, unit, and integration tests. Report files changed, migrations/configuration, tests, and known limitations.

Implement incrementally. Do not rewrite the entire authentication system in one pass.

## Acceptance Criteria
- A new visitor can get started through a minimal, clear flow.
- Unnecessary registration fields and steps are removed.
- The access model fits Impactlia's real features and security needs.
- Verified users have a corresponding database record without duplicates.
- Users can reach the core product without avoidable friction.
- GitHub permissions are requested only when required.
- Private repository data, saved analyses, and account-specific features remain protected.
- Onboarding completion persists.
- Existing UI, analysis pipeline, and working features remain functional.
- Automated tests cover onboarding, identity, user creation, and authorization.
- No fake verified identities or insecure shortcuts are introduced.

## Instructions to Claude Code
Work inside the existing Impactlia repository.

1. Inspect the current codebase and Clerk setup first.
2. Preserve existing working features, routes, and UI.
3. Simplify the current authentication flow before considering replacing Clerk.
4. Choose the smallest secure solution that lets users reach the product quickly.
5. Implement real user persistence and server-side authorization, not just a front-end onboarding screen.
6. Do not invent database tables or environment variables without checking the project.
7. Run relevant project checks and tests.
8. Finish with a concise report of the chosen access model, changes, files modified, migrations/configuration, tests run, and limitations.

**Product principle:** Make Impactlia effortless to try while keeping identity, private repositories, and saved work secure.
