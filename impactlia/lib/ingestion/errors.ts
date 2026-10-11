// An error whose message was written for the person who started the run. Any
// other error is logged on the server and shown only as a generic sentence.
export class IngestionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IngestionError";
  }
}
