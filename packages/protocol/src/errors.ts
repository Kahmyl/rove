export const ROVE_ERROR_CODES = [
  "SESSION_NOT_FOUND",
  "SESSION_NOT_ACTIVE",
  "SESSION_ALREADY_ENDED",
  "INVALID_SESSION_MODE",
  "CONTROL_NOT_OWNED",
  "HUMAN_CONTROL_REQUIRED",
  "CONTROL_TRANSFER_PENDING",
  "PAGE_NOT_FOUND",
  "PAGE_CHANGED",
  "TARGET_NOT_FOUND",
  "TARGET_STALE",
  "TARGET_AMBIGUOUS",
  "TARGET_NOT_VISIBLE",
  "TARGET_DISABLED",
  "TARGET_NOT_INTERACTIVE",
  "NAVIGATION_FAILED",
  "ACTION_TIMEOUT",
  "BROWSER_CLOSED",
  "BROWSER_LAUNCH_FAILED",
  "PROFILE_NOT_FOUND",
  "PROFILE_LOCKED",
  "PROFILE_LAUNCH_FAILED",
  "INVALID_PROFILE_NAME",
  "EVIDENCE_NOT_FOUND",
  "EVIDENCE_WRITE_FAILED",
  "INVALID_CONFIGURATION",
  "MCP_AUTH_REQUIRED",
  "MCP_AUTH_INVALID",
  "PORT_IN_USE",
  "NOT_IMPLEMENTED",
] as const;

export type RoveErrorCode = (typeof ROVE_ERROR_CODES)[number];

export interface RoveErrorShape {
  code: RoveErrorCode;
  message: string;
  retryable?: boolean;
  details?: Record<string, unknown>;
}

export class RoveError extends Error {
  readonly code: RoveErrorCode;
  readonly retryable: boolean;
  readonly details: Record<string, unknown> | undefined;

  constructor(shape: RoveErrorShape) {
    super(shape.message);
    this.name = "RoveError";
    this.code = shape.code;
    this.retryable = shape.retryable ?? false;
    this.details = shape.details;
  }

  toJSON(): { ok: false; error: RoveErrorShape } {
    return {
      ok: false,
      error: {
        code: this.code,
        message: this.message,
        retryable: this.retryable,
        ...(this.details === undefined ? {} : { details: this.details }),
      },
    };
  }
}

export function asRoveError(error: unknown): RoveError {
  return error instanceof RoveError
    ? error
    : new RoveError({ code: "INVALID_CONFIGURATION", message: "Unexpected Rove failure." });
}
