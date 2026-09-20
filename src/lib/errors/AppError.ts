export const ERROR_CODES = [
  "NOT_FOUND",
  "FORBIDDEN",
  "UNAUTHENTICATED",
  "VALIDATION",
  "CONFLICT",
  "RATE_LIMITED",
  "INTERNAL",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const HTTP_STATUS: Record<ErrorCode, number> = {
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  UNAUTHENTICATED: 401,
  VALIDATION: 400,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

/**
 * The only error type that may cross the action boundary to the client.
 * `message` is a Persian, user-safe string; `details` is optional structured data (e.g. field errors).
 * Anything else thrown inside an action is logged and converted to INTERNAL.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message?: string, details?: unknown) {
    super(message ?? code);
    this.name = "AppError";
    this.code = code;
    this.status = HTTP_STATUS[code];
    this.details = details;
  }

  static is(err: unknown): err is AppError {
    return err instanceof AppError;
  }

  toJSON() {
    return { code: this.code, message: this.message, details: this.details };
  }
}
