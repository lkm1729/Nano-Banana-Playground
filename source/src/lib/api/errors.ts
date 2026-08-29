export type GenerationErrorCode =
  | "CONFIGURATION"
  | "NETWORK"
  | "AUTHENTICATION"
  | "RATE_LIMITED"
  | "CONTENT_BLOCKED"
  | "UNSUPPORTED_RESPONSE"
  | "ABORTED"
  | "UNKNOWN";

export class GenerationError extends Error {
  constructor(
    message: string,
    readonly code: GenerationErrorCode = "UNKNOWN",
    readonly status?: number,
  ) {
    super(message);
    this.name = "GenerationError";
  }
}
