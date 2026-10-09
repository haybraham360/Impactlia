# Phase 2 — Repository schema and analysis dashboard

**Goal.** The Impactlia workspace can securely store the foundation of repository and Pull Request analysis, and the dashboard can prove that the current organization sees only its own analysis data.

Phase 1 established identity, organizations, protected routes, and the application shell. This phase establishes the database model and the first useful dashboard surface that later repository and PR analysis phases will build on.

## Build

- **The first Impactlia migration.** Create the minimum schema needed to represent organizations, connected repositories, Pull Requests, analysis runs, and the results produced by those analyses.
- The initial schema should support the core Impactlia workflow:
  repository → Pull Request → changed files → dependency/impact analysis → risk assessment → report.
- Every organization-owned record must have a direct or safely traceable relationship to an organization.
- Repository records should identify the source-control provider and repository identity without storing unnecessary credentials.
- Pull Request records should store the repository relationship, PR number/identifier, title, author/reference metadata, and analysis state needed by the product.
- Analysis records should represent an individual analysis run and its state, timestamps, repository/PR relationship, and summary results.
- Analysis-result records should be structured so later phases can store changed files, affected files, dependency relationships, risk signals, recommendations, and evidence without putting everything into one unstructured JSON field.
- **Row-level security on every organization-owned table**, using the organization claim from the authenticated token.
- The dashboard should list analysis runs belonging to the organization currently selected in the workspace.
- The dashboard should show useful analysis states such as pending, running, completed, and failed.
- Provide an honest empty state for a team that has not analyzed a Pull Request yet.
- Seeded development rows may be used to prove organization isolation and dashboard behaviour. Seed data must never be mistaken for a real analysis.
- The dashboard should establish the visual hierarchy that later analysis reports can extend without redesigning the entire application shell.

## Constraints

- **Authorization is a database property, not an application filter.** No organization-owned table is readable without an appropriate row-level security policy.
- Migrations are files tracked in version control. Do not make schema changes manually in the Supabase dashboard.
- The dashboard must not fetch all organizations' data and filter it in application code. If another organization's row is returned, the policy is broken.
- Switching organizations must change what the same dashboard displays without writing a separate organization-specific query.
- Every organization-owned table must have row-level security enabled. Do not enable it only on the most important tables.
- Foreign keys should enforce the ownership relationships required by the schema.
- Deleting an organization should remove or safely invalidate its dependent data according to the chosen database relationships.
- Do not store GitHub access tokens, private repository credentials, or secrets in ordinary repository/PR rows.
- Do not create a schema that assumes the product will only ever support one source-control provider.
- Keep the schema focused on the MVP. Do not create tables for speculative future features simply because they might be useful later.
- Do not put deterministic dependency-graph logic or risk calculations in database triggers. Analysis logic belongs in the analysis layer.
- JSON may be used for genuinely variable metadata, but core entities and relationships should remain queryable structured data.
- Do not introduce complex background-job infrastructure in this phase.

## Acceptance check

1. Seed analysis data for two different organizations. Sign in to the first organization and confirm the dashboard lists only its analysis rows. Switch organizations and confirm the list changes to the second organization's rows.
2. Verify through database queries, not merely the UI, that a user cannot retrieve another organization's repository, Pull Request, or analysis rows.
3. Every organization-owned table has row-level security enabled and an appropriate policy. Check every table, not a sample.
4. The migration can be applied from a clean database without manual dashboard changes.
5. Repository, Pull Request, and analysis records have clear ownership relationships.
6. The dashboard accurately represents analysis state and provides a useful empty state when no analyses exist.
7. No real repository analysis is claimed to have happened from seeded data.
8. The TypeScript checks, lint, and production build pass.
9. Switching organizations changes the dashboard data without changing the application query logic.

## Not in this phase

The repository connection flow. GitHub repository listing. OAuth permissions for private repositories. Pull Request retrieval from GitHub. Diff parsing. TypeScript/JavaScript dependency parsing. Dependency graph construction. Blast-radius calculation. Deterministic risk scoring. AI explanations. React Flow visualization. CI/CD integration. Automatic analysis jobs. Production telemetry.

The dashboard may display seeded or placeholder analysis states for development, but it must not pretend that the “Analyze Pull Request” workflow is already implemented.
