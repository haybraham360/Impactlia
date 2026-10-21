// An error whose message was written for the person who started the run. Any
// other error is logged on the server and shown only as a generic sentence.
//
// `retryable` marks the failures that trying again later can fix: GitHub
// could not be reached, was too slow, or was rate limiting. A member simply
// tries again; an automatic analysis schedules its own retry, no sooner than
// `retryAt` when GitHub said when.
export class IngestionError extends Error {
  readonly retryable: boolean;
  readonly retryAt: number | null;

  constructor(message: string, options: { retryable?: boolean; retryAt?: number | null } = {}) {
    super(message);
    this.name = "IngestionError";
    this.retryable = options.retryable ?? false;
    this.retryAt = options.retryAt ?? null;
  }
}
