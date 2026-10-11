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

export const SIGN_IN_PATH = "/sign-in";
export const SIGN_UP_PATH = "/sign-up";

// Where someone who is signed in but has no active organization is sent.
export const CHOOSE_ORGANIZATION_PATH = "/choose-organization";
