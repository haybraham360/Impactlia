import { IngestionError } from "../ingestion/errors";

// A repository as someone named it. GitHub treats owner and name without
// regard to case and keeps old names working after a rename, so this is not
// yet an identity: that is GitHub's own repository id, looked up from here.
export type RepositoryReference = { owner: string; name: string };

// A repository and, for automatic analysis only, a GitHub App installation
// token for it. With a token, requests count against the installation's own
// limit rather than the small shared one for requests without a sign-in. A
// token is held only by server code and never stored.
export type RepositoryAccess = RepositoryReference & { token?: string };

const EXAMPLE = "https://github.com/owner/repository";
export const MAX_URL_LENGTH = 300;

// GitHub's own rules for the two names.
const OWNER = /^[a-z\d](?:[a-z\d-]{0,38})$/i;
const NAME = /^[\w.-]{1,100}$/;

// Accepts the forms people actually paste: with or without the scheme or
// "www.", with a trailing slash or ".git", and the SSH form. Anything deeper
// than the repository itself is refused rather than trimmed, because a link to
// a branch or a pull request reads as a request to analyse that, and this
// always analyses the default branch.
export function parseRepositoryUrl(input: string): RepositoryReference {
  const text = input.trim();
  if (text === "") {
    throw new IngestionError(`Enter a GitHub repository address, like ${EXAMPLE}.`);
  }
  if (text.length > MAX_URL_LENGTH) {
    throw new IngestionError(`That address is too long to be a GitHub repository. It should look like ${EXAMPLE}.`);
  }

  const ssh = /^git@github\.com:(.+)$/i.exec(text);
  let path: string;
  if (ssh) {
    path = ssh[1];
  } else {
    const withScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(text) ? text : `https://${text}`;
    if (!URL.canParse(withScheme)) {
      throw new IngestionError(`That is not a web address. It should look like ${EXAMPLE}.`);
    }
    const url = new URL(withScheme);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new IngestionError(`Only github.com web addresses are supported, like ${EXAMPLE}.`);
    }
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (host !== "github.com") {
      throw new IngestionError(
        `Only repositories on github.com are supported, and that address is on ${url.hostname}.`,
      );
    }
    if (url.username !== "" || url.password !== "") {
      throw new IngestionError("Remove the sign-in details from the address. Only public repositories are supported.");
    }
    path = url.pathname;
  }

  const segments = path.split("/").filter((segment) => segment !== "");
  if (segments.length < 2) {
    throw new IngestionError(`That address has no repository name. It should look like ${EXAMPLE}.`);
  }
  if (segments.length > 2) {
    throw new IngestionError(
      `Link to the repository itself, like https://github.com/${segments[0]}/${segments[1]}. ` +
        "Its default branch is what gets analysed.",
    );
  }

  const owner = segments[0];
  const name = segments[1].replace(/\.git$/i, "");
  if (!OWNER.test(owner) || !NAME.test(name) || name === "." || name === "..") {
    throw new IngestionError(
      `"${owner}/${name}" is not a valid GitHub owner and repository name. It should look like ${EXAMPLE}.`,
    );
  }
  return { owner, name };
}

export const repositoryUrl = ({ owner, name }: RepositoryReference) =>
  `https://github.com/${owner}/${name}`;
