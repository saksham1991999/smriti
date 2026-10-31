/** A reason the publisher refuses to publish. Nothing is written when one is thrown. */
export class PublishError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(`${code}: ${message}`);
  }
}
