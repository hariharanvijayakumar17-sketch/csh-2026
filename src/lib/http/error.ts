/**
 * Consistent API error envelope (brief §5.6):
 * { success: false, error: { code, message, details }, requestId }
 * Success responses: { success: true, data }
 */

export type ApiErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "LOCKED"
  | "DEADLINE_PASSED"
  | "RATE_LIMITED"
  | "VALIDATION_ERROR"
  | "INTERNAL_ERROR";

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(
    code: ApiErrorCode,
    message: string,
    opts?: { status?: number; details?: unknown }
  ) {
    super(message);
    this.code = code;
    this.status = opts?.status ?? defaultStatus(code);
    this.details = opts?.details;
  }
}

function defaultStatus(code: ApiErrorCode): number {
  switch (code) {
    case "BAD_REQUEST":
    case "VALIDATION_ERROR":
      return 400;
    case "UNAUTHORIZED":
      return 401;
    case "FORBIDDEN":
    case "LOCKED":
    case "DEADLINE_PASSED":
      return 403;
    case "NOT_FOUND":
      return 404;
    case "CONFLICT":
      return 409;
    case "RATE_LIMITED":
      return 429;
    default:
      return 500;
  }
}

export function ok<T>(data: T, requestId: string, status = 200) {
  return Response.json({ success: true as const, data, requestId }, { status });
}

export function fail(err: unknown, requestId: string) {
  if (err instanceof ApiError) {
    return Response.json(
      {
        success: false as const,
        error: {
          code: err.code,
          message: err.message,
          ...(err.details !== undefined ? { details: err.details } : {}),
        },
        requestId,
      },
      { status: err.status }
    );
  }
  // Never leak internals of unexpected errors (brief S-security hygiene).
  console.error("[api] unhandled error", err);
  return Response.json(
    {
      success: false as const,
      error: {
        code: "INTERNAL_ERROR" as const,
        message: "Something went wrong",
      },
      requestId,
    },
    { status: 500 }
  );
}
