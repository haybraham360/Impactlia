// The public landing page owns "/", so everything that needs a session and an
// organization lives under this prefix.
export const WORKSPACE_PATH = "/app";
export const TEAM_PATH = `${WORKSPACE_PATH}/team`;
export const AI_RUNS_PATH = `${WORKSPACE_PATH}/ai-runs`;
export const repositoryPath = (repositoryId: string) =>
  `${WORKSPACE_PATH}/repositories/${repositoryId}`;
export const runPath = (runId: string) => `${WORKSPACE_PATH}/runs/${runId}`;
export const PULL_REQUESTS_PATH = `${WORKSPACE_PATH}/pull-requests`;
export const pullRequestsPath = (repositoryId: string) =>
  `${PULL_REQUESTS_PATH}?repository=${repositoryId}`;
export const analysisPath = (analysisId: string) => `${WORKSPACE_PATH}/analyses/${analysisId}`;

// Where GitHub sends a member back after installing the Impactlia GitHub
// App, and the cookie that proves the trip started in Impactlia.
export const GITHUB_INSTALLED_PATH = "/api/github/installed";
export const GITHUB_INSTALL_COOKIE = "impactlia_github_install";
// Called by GitHub and by Vercel Cron, never by a signed-in browser.
export const GITHUB_WEBHOOK_PATH = "/api/github/webhook";
export const AUTOMATION_SWEEP_PATH = "/api/github/jobs";

export const SIGN_IN_PATH = "/sign-in";
export const SIGN_UP_PATH = "/sign-up";

// Where every sign-in and sign-up lands, and where a session without an
// active workspace is sent: it sets one up or opens the one there is.
export const START_PATH = "/start";
// The earlier address of the start page, kept so old links still work.
export const CHOOSE_ORGANIZATION_PATH = "/choose-organization";
