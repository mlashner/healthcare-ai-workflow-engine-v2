export const modelErrorCodes = [
  "PROVIDER_FAILURE",
  "EMPTY_RESPONSE",
  "TIMEOUT",
  "SCHEMA_FAILURE",
  "RATE_LIMITED",
] as const;

export type ModelErrorCode = (typeof modelErrorCodes)[number];

export class ModelError extends Error {
  readonly code: ModelErrorCode;
  readonly details: unknown;

  constructor(code: ModelErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "ModelError";
    this.code = code;
    this.details = details;
  }
}

export function isModelError(error: unknown): error is ModelError {
  return error instanceof ModelError;
}
