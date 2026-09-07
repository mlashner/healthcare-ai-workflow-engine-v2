export const toolErrorCodes = [
  "VALIDATION_ERROR",
  "UNAUTHORIZED",
  "POLICY_DENIED",
  "NOT_FOUND",
  "UNKNOWN_TOOL",
  "EXECUTION_ERROR",
] as const;

export type ToolErrorCode = (typeof toolErrorCodes)[number];

export class ToolError extends Error {
  readonly code: ToolErrorCode;
  readonly details: unknown;

  constructor(code: ToolErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "ToolError";
    this.code = code;
    this.details = details;
  }
}

export type StructuredToolError = {
  code: ToolErrorCode;
  message: string;
  details?: unknown;
};

export function toStructuredError(error: unknown): StructuredToolError {
  if (error instanceof ToolError) {
    return { code: error.code, message: error.message, details: error.details };
  }

  return {
    code: "EXECUTION_ERROR",
    message: error instanceof Error ? error.message : "tool execution failed",
  };
}
