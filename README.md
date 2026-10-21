# Impactlia

**Understand the impact of your code changes before you merge.**

Impactlia is a developer tool focused on pull-request change-impact analysis. It helps developers explore how a proposed code change may affect other parts of a codebase, understand potential risks, and identify areas that may need closer review or testing.

🌐 **Website:** https://impactlia.com

> Impactlia is an evolving MVP. Supported languages, analysis depth, and available features depend on the current implementation. Findings should guide engineering review—not replace it or guarantee that a change is safe.

## Why Impactlia?

A pull request can change more than the files shown in its diff. Shared utilities, modules, components, and other connected parts of a system may depend on the code being modified.

Reviewing only the changed lines can make it difficult to understand the potential blast radius of a change.

Impactlia aims to make those relationships easier to inspect by connecting pull-request changes with repository structure and presenting useful evidence about potential downstream impact.

## What Impactlia is designed to help with

Depending on the capabilities enabled in the current release, Impactlia aims to help developers:

- **Understand changed files** — see the files involved in a pull request.
- **Explore code relationships** — inspect supported dependencies between files and modules.
- **Understand potential blast radius** — identify connected areas that may deserve additional review.
- **Review potential risk signals** — investigate findings supported by the available analysis.
- **Plan validation** — identify relevant areas or scenarios to test before merging.
- **Inspect evidence** — understand why an area was included in an analysis, where evidence is available.

Impactlia distinguishes files directly changed by a pull request from files that may be affected through supported code relationships. A dependency relationship alone does not prove that a downstream failure will occur.

## How it works

The intended workflow is:

1. **Connect or select a repository.** Choose a GitHub repository supported by the current implementation.
2. **Select a pull request.** Start with a proposed change you want to understand.
3. **Analyze the change.** Inspect the pull-request diff and relevant repository structure.
4. **Explore potential impact.** Follow supported dependency relationships to identify connected areas.
5. **Review the report.** Examine findings, evidence, and any stated analysis limitations.
6. **Validate before merging.** Use the report to guide code review and testing.

The depth and accuracy of the analysis depend on the languages, frameworks, repository structure, and checks supported by the current release.

## Design principles

Impactlia is being developed around a few principles:

- **Evidence first:** Findings should be grounded in repository content and analysis results.
- **Explainable impact:** Developers should be able to understand why a file or component was identified.
- **Honest uncertainty:** Potential risks should not be presented as confirmed failures without evidence.
- **Useful, not noisy:** The goal is actionable insight rather than the largest possible number of warnings.
- **Human judgment stays central:** Impactlia supports code review; it does not replace engineering judgment, tests, or security review.

## Current status

Impactlia is available as an early MVP.

The project is being developed iteratively, with a focus on improving pull-request analysis, making impact reports more useful, and validating the product with real developer workflows.

Some capabilities may be incomplete or limited by the current implementation. Do not assume that every language, framework, risk category, or integration is supported.

Feedback from developers is valuable—especially examples where an analysis is useful, unclear, incorrect, or misses an important relationship.

## Getting started

Visit **https://impactlia.com** to explore the current product.

The exact setup and onboarding flow may change as the MVP evolves. Follow the instructions presented by the application.

### For developers who want to contribute

The application lives in the `impactlia/` folder: Next.js 16 (App Router), React 19 and strict TypeScript, with Clerk for sign-in and Supabase for the database. It uses pnpm, pinned to the version in `impactlia/package.json`.

```bash
git clone https://github.com/haybraham360/Impactlia.git
cd Impactlia/impactlia
pnpm install
pnpm dev
```

The app then runs at http://localhost:3000.

Checks you can run from a terminal:

```bash
pnpm lint
pnpm build
pnpm check:impact      # pull request impact and code-issue analysis
pnpm check:automation  # GitHub webhooks, retries and the pull request comment
pnpm check:graph       # dependency graph traversal
pnpm check:adapters    # framework adapters
pnpm check:ingestion   # repository ingestion
pnpm check:ai          # AI explanation grounding
pnpm check:database    # migrations and row-level security, against a local Postgres
```

Database migrations are in `impactlia/supabase/migrations/`.

### Environment variables

Put these in `impactlia/.env.local`, next to `package.json`. `impactlia/lib/env.ts` checks them at startup, and `pnpm dev` and `pnpm build` stop with a message naming any required one that is missing.

| Variable | Required | Used for |
| --- | --- | --- |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Yes | Sign-in (Clerk) |
| `CLERK_SECRET_KEY` | Yes | Sign-in (Clerk), server only |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Database (Supabase) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Yes | Database (Supabase) |
| `OPENAI_API_KEY` | No | AI explanations. Without it they are unavailable; analysis itself does not use AI. |
| `LANGSMITH_API_KEY` | No | Sending AI run traces to LangSmith |

Automatic pull request analysis needs every one of the following, or it stays off and the pull requests page names what is missing. All are server-only.

| Variable | Used for |
| --- | --- |
| `GITHUB_APP_ID`, `GITHUB_APP_SLUG` | Identifying the Impactlia GitHub App |
| `GITHUB_APP_PRIVATE_KEY` | Signing as the App. The PEM, with line breaks written as `\n` |
| `GITHUB_WEBHOOK_SECRET` | Verifying each webhook delivery |
| `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET` | Confirming, once, that the member connecting an installation can see it |
| `SUPABASE_SECRET_KEY` | Writing jobs and analyses when there is no signed-in member. Bypasses row-level security; used only in `lib/supabase/service.ts` |
| `CRON_SECRET` | Authorising Vercel Cron's calls to the retry sweep |
| `APP_URL` | The address the comment links to. On Vercel it defaults to the production domain |

### Automatic pull request analysis

With the Impactlia GitHub App installed on a public repository and automatic analysis turned on for it (pull requests page → select the repository), every pull request opened, reopened or pushed to is analysed at its head commit by the same pipeline as a manual analysis. Impactlia keeps one comment on the pull request up to date, and only ever for the commit that is the head at the moment it publishes.

The GitHub App's settings:

- **Permissions:** Metadata read, Contents read, Pull requests read & write. Nothing else; no write access to code.
- **Subscribe to events:** Pull request. (Installation events are always sent to Apps.)
- **Webhook URL:** `https://<domain>/api/github/webhook`, with the webhook secret.
- **Callback URL:** `https://<domain>/api/github/installed`, and **Request user authorization (OAuth) during installation** on. That sign-in is how Impactlia confirms the member can see the installation they are connecting; the token is revoked immediately and never stored.

How it runs: the webhook verifies the signature, records the delivery and the job in one transaction (a redelivery changes nothing), answers straight away, then starts the job after the response. A job that cannot run yet, or fails temporarily (GitHub unreachable or rate limiting), is retried by the sweep at `/api/github/jobs` no sooner than 1, 5 and 15 minutes later, then marked failed. The sweep runs every half hour from GitHub Actions (`.github/workflows/automatic-analysis-sweep.yml`, which needs the repository secret `IMPACTLIA_CRON_SECRET` equal to `CRON_SECRET`), once a day from Vercel Cron as a backstop (the Hobby plan allows no more), and whenever a job finishes, so a job waiting behind another starts straight away. A retry can therefore take up to about half an hour. An attempt that dies is reclaimed after 10 minutes. One job runs per repository at a time, and a sweep starts at most three. Each attempt logs one `automatic_analysis_attempt` line with its outcome and duration.

Cost: one analysis per pushed commit, using the installation's GitHub rate limit (5,000 requests an hour) rather than the shared unauthenticated one, about 7 requests per analysis plus 2 for the comment. A commit already analysed is not analysed again. No AI is called. No paid service is added: the sweep uses about 1,440 of the private repository's 2,000 free GitHub Actions minutes a month (each run is billed as one minute), and Vercel's daily cron is free.

Limits: public repositories only; the comment lists at most five affected files, issues and tests and links to the rest; GitHub does not redeliver failed webhooks on its own, though they can be redelivered from the App's settings.

- Never commit `.env` files, API keys, access tokens, database passwords, or other secrets.
- Keep server-side secrets out of client-side `NEXT_PUBLIC_` variables.
- Use development credentials locally and configure production credentials only in the appropriate deployment environment.

## Roadmap

Areas of ongoing development and exploration include:

- Improving the reliability and usefulness of pull-request impact analysis.
- Making dependency relationships and evidence easier to understand.
- Exploring code-level issue detection and connecting potential issues to affected areas.
- Improving analysis reports and validation guidance.
- Gathering feedback from developers and refining the product based on real use.

This is a direction of development, not a guarantee that every listed capability is currently available.

## Feedback and collaboration

Impactlia is being built iteratively, and feedback from developers is welcome.

If you try the product, useful feedback includes:

- What was clear or confusing?
- Did the analysis identify meaningful relationships?
- Were the findings actionable?
- Were there false positives or important missed cases?
- What would make the tool useful in your everyday pull-request workflow?

For collaboration or partnership enquiries, visit the website and use the contact options currently available there.

## Important limitations

Impactlia's output should be treated as decision support, not a guarantee.

- A completed analysis does not mean a pull request is safe to merge.
- No findings does not prove that a change is free of bugs or vulnerabilities.
- Unsupported languages, incomplete parsing, missing context, or unavailable checks may limit results.
- Potentially affected files are not necessarily confirmed failures.
- Developers remain responsible for reviewing changes, running appropriate tests, and applying their organization's security and release practices.

## Security

Only connect repositories you are authorized to access. Do not submit secrets or credentials through issues, discussions, or other public channels.

If you discover a security concern, avoid publishing sensitive exploit details publicly. Use the project's established private reporting channel if one is available.

## License

A license has not been specified in this README. Check the repository for a `LICENSE` file before reusing, modifying, or distributing this project. If you maintain this repository, add the intended license and update this section.

---

**Impactlia — know what your code changes could affect.**
