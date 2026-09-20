import { OpenApiGeneratorV31, OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { z } from "@/lib/zod";
import { loginSchema } from "@/app/api/v1/auth/login/route";
import { registerSchema } from "@/app/api/v1/auth/register/route";
import { verifyEmailSchema } from "@/app/api/v1/auth/verify-email/route";
import { resetRequestSchema } from "@/app/api/v1/auth/password-reset/request/route";
import { resetConfirmSchema } from "@/app/api/v1/auth/password-reset/confirm/route";
import { passwordChangeSchema } from "@/app/api/v1/auth/password/change/route";
import { listProblemsQuery } from "@/app/api/v1/problems/route";

/**
 * OpenAPI 3.1 document generated FROM THE ZOD CONTRACTS (brief §5.6).
 * The route schemas are the single source of truth; this file only wires
 * them into the registry. Served at GET /api/v1/openapi.
 */

const IdParam = z.object({ id: z.string().describe("Problem code (PS-…) or uuid") });

const okEnvelope = <T extends z.ZodTypeAny>(data: T) =>
  z.object({ success: z.literal(true), data, requestId: z.string() });

const problemSummary = z.object({
  id: z.string(),
  code: z.string(),
  title: z.string(),
  category: z.string().nullable(),
  theme: z.string().nullable(),
  difficulty: z.string(),
  publishedAt: z.string().nullable(),
});

const listProblemsData = z.object({
  items: z.array(problemSummary),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});

const json = (schema: z.ZodTypeAny) => ({ "application/json": { schema } });
const err = (code: string, status: number, message: string) => ({
  [status]: {
    description: message,
    content: json(
      z.object({
        success: z.literal(false),
        error: z.object({ code: z.literal(code), message: z.string(), details: z.unknown().optional() }),
        requestId: z.string(),
      })
    ),
  },
});

let built: ReturnType<typeof build> | null = null;

function build() {
  const registry = new OpenAPIRegistry();
  registry.register("LoginBody", loginSchema);
  registry.register("RegisterBody", registerSchema);
  registry.register("VerifyEmailBody", verifyEmailSchema);
  registry.register("ResetRequestBody", resetRequestSchema);
  registry.register("ResetConfirmBody", resetConfirmSchema);
  registry.register("PasswordChangeBody", passwordChangeSchema);
  registry.register("ListProblemsQuery", listProblemsQuery);
  registry.registerComponent(
    "securitySchemes",
    "sessionCookie",
    {
      type: "apiKey",
      in: "cookie",
      name: "csh_session",
      description: "HttpOnly session cookie set by /api/v1/auth/login",
    }
  );

  registry.registerPath({
    method: "get",
    path: "/api/v1/health",
    summary: "Liveness",
    responses: { 200: { description: "ok" } },
  });
  registry.registerPath({
    method: "get",
    path: "/api/v1/readyz",
    summary: "Readiness (checks the database)",
    responses: { 200: { description: "ready" }, 503: { description: "database unavailable" } },
  });
  registry.registerPath({
    method: "get",
    path: "/api/v1/problems",
    operationId: "listProblems",
    summary: "Published problems (paginated, filterable)",
    request: { query: listProblemsQuery },
    responses: {
      200: { description: "published problems", content: json(okEnvelope(listProblemsData)) },
      ...err("VALIDATION_ERROR", 400, "invalid query parameters"),
    },
  });
  registry.registerPath({
    method: "get",
    path: "/problems/{id}",
    operationId: "getProblem",
    summary: "One published problem (by code or uuid)",
    request: { params: IdParam },
    responses: { 200: { description: "problem" }, ...err("NOT_FOUND", 404, "not found / not published") },
  });
  registry.registerPath({
    method: "get",
    path: "/problems/{id}/clarifications",
    operationId: "listClarifications",
    summary: "Public Q&A for a published problem",
    request: { params: IdParam },
    responses: { 200: { description: "clarifications" }, ...err("NOT_FOUND", 404, "not found") },
  });
  registry.registerPath({
    method: "post",
    path: "/api/v1/auth/register",
    operationId: "register",
    summary: "Register (queues verification email; non-enumerating)",
    request: { body: { required: true, content: json(registerSchema) } },
    responses: {
      201: { description: "registered / verification email queued" },
      ...err("VALIDATION_ERROR", 400, "validation"),
      ...err("FORBIDDEN", 403, "registration closed"),
      ...err("RATE_LIMITED", 429, "rate limited"),
    },
  });
  registry.registerPath({
    method: "post",
    path: "/api/v1/auth/verify-email",
    operationId: "verifyEmail",
    summary: "Consume a single-use verification token",
    request: { body: { required: true, content: json(verifyEmailSchema) } },
    responses: { 200: { description: "verified" }, ...err("BAD_REQUEST", 400, "invalid/expired") },
  });
  registry.registerPath({
    method: "post",
    path: "/api/v1/auth/login",
    operationId: "login",
    summary:
      "Login. Non-enumerating: unknown email and wrong password return the same 401. " +
      "Progressive per-(account,IP) delay → 423; per-IP/per-account limits → 429.",
    request: { body: { required: true, content: json(loginSchema) } },
    responses: {
      200: { description: "ok; sets HttpOnly session cookie" },
      ...err("BAD_REQUEST", 401, "invalid credentials (generic)"),
      ...err("LOCKED", 423, "this IP is slowed"),
      ...err("RATE_LIMITED", 429, "rate limited"),
    },
  });
  registry.registerPath({
    method: "post",
    path: "/api/v1/auth/logout",
    operationId: "logout",
    summary: "Revoke the current session",
    security: [{ sessionCookie: [] }],
    responses: { 200: { description: "ok" }, ...err("UNAUTHORIZED", 401, "unauthenticated") },
  });
  registry.registerPath({
    method: "get",
    path: "/api/v1/auth/session",
    operationId: "getSession",
    summary: "Current session profile",
    security: [{ sessionCookie: [] }],
    responses: { 200: { description: "profile" }, ...err("UNAUTHORIZED", 401, "unauthenticated") },
  });
  registry.registerPath({
    method: "post",
    path: "/api/v1/auth/password-reset/request",
    operationId: "requestReset",
    summary: "Queue a reset email (non-enumerating)",
    request: { body: { required: true, content: json(resetRequestSchema) } },
    responses: { 200: { description: "ok (identical for unknown email)" }, ...err("RATE_LIMITED", 429, "rate limited") },
  });
  registry.registerPath({
    method: "post",
    path: "/api/v1/auth/password-reset/confirm",
    operationId: "confirmReset",
    summary: "Consume reset token; revokes ALL sessions of the account",
    request: { body: { required: true, content: json(resetConfirmSchema) } },
    responses: { 200: { description: "ok" }, ...err("BAD_REQUEST", 400, "invalid/expired/weak") },
  });
  registry.registerPath({
    method: "post",
    path: "/api/v1/auth/password/change",
    operationId: "changePassword",
    summary: "Change own password; revokes all other sessions (rotates)",
    security: [{ sessionCookie: [] }],
    request: { body: { required: true, content: json(passwordChangeSchema) } },
    responses: {
      200: { description: "ok" },
      ...err("BAD_REQUEST", 400, "validation / wrong current password"),
      ...err("UNAUTHORIZED", 401, "unauthenticated"),
    },
  });

  return new OpenApiGeneratorV31(registry.definitions).generateDocument({
    openapi: "3.1.0",
    info: {
      title: "Campus Solution Hackathon (CSH) 2026 — API v1",
      version: "1.0.0",
      description:
        "SRM TRP Engineering College, Tiruchirappalli. Base path /api/v1. " +
        "Success: { success:true, data, requestId }. Errors: " +
        "{ success:false, error:{code,message,details?}, requestId }.",
    },
  });
}

export function buildOpenApi() {
  return built ?? (built = build());
}
