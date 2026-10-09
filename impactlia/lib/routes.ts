// The public landing page owns "/", so everything that needs a session and an
// organization lives under this prefix.
export const WORKSPACE_PATH = "/app";
export const TEAM_PATH = `${WORKSPACE_PATH}/team`;

export const SIGN_IN_PATH = "/sign-in";
export const SIGN_UP_PATH = "/sign-up";

// Where someone who is signed in but has no active organization is sent.
export const CHOOSE_ORGANIZATION_PATH = "/choose-organization";
