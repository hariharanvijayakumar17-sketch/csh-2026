import "server-only";
import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import type { Permission, CanContext, UserLike } from "@/lib/authz/permissions";
import { can } from "@/lib/authz/permissions";
import { resolveSession, type ResolvedSession } from "@/lib/auth/sessions";
import { ApiError, fail, ok } from "./error";

/**
 * P4 route-layer enforcement (S1): every API route handler goes through
 * makeRouteHandler() (permission or public deps). The edge middleware (src/middleware.ts)
 * already guarantees the route has an explicit policy and passed CSRF;
 * HERE the session is resolved from the DB and can() is applied.
 */

export const SESSION_COOKIE = "csh_session";

/**
 * F10: URL params are validated BEFORE authentication/authorisation.
 * Every P5 route param is a UUID; a malformed one must produce a 400
 * envelope immediately — not a 200-with-error, not 401/403 (those would
 * depend on auth state and leak that ordering into the response).
 * Returns the first offending param key, or null when all string params
 * are valid UUIDs.
 */
export const UUID_PARAM_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function uuidParamError(params: Record<string, unknown> | null | undefined): string | null {
  for (const [key, value] of Object.entries(params ?? {})) {
    if (typeof value === "string" && !UUID_PARAM_RE.test(value)) return key;
  }
  return null;
}

export function sessionCookieOptions(): {
  httpOnly: boolean;
  sameSite: "strict";
  secure: boolean;
  path: string;
  maxAge: number;
} {
  return {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 30 * 24 * 60 * 60,
  };
}

export interface RequestContext {
  requestId: string;
  session: ResolvedSession | null;
  user: UserLike | null;
  ctx: CanContext;
}

function emptyCtx(): CanContext {
  return {
    ownTeamIds: new Set<string>(),
    mentorAssignedTeamIds: new Set<string>(),
    evaluatorAssignedTeamIds: new Set<string>(),
  };
}

function toUserLike(s: ResolvedSession): UserLike {
  return {
    id: s.user.id,
    role: s.user.role as UserLike["role"],
    institutionId: s.user.institutionId,
  };
}

/**
 * Resolve the caller (session cookie → DB) and run can() for `permission`.
 * Scope (team/problem/doc ids) is passed by the handler AFTER it resolves
 * the resource — the service fills ctx.ownTeamIds etc. from the DB.
 */
export async function getCaller(req?: NextRequest): Promise<RequestContext> {
  const requestId =
    (req?.headers.get("x-request-id") as string | null) ?? randomUUID();
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  const session = await resolveSession(token);
  const user = session ? toUserLike(session) : null;
  return { requestId, session, user, ctx: emptyCtx() };
}

type Handler<TParams> = (
  req: NextRequest,
  params: TParams,
  call: RequestContext
) => Promise<Response>;


export interface RouteDeps<TParams extends { id?: string }> {
  permission: Permission | null; // null = public (asPublic)
  handler: Handler<TParams>;
  /** fill caller.ctx from the DB using resolved params (service layer) */
  resolveCtx?: (call: RequestContext, params: TParams) => Promise<void>;
}

/**
 * The single factory every /api/v1 route uses. Enforces:
 *  - permission routes: valid session + can(user, permission, ctx)
 *  - public routes: optional session (caller attached when present)
 *  - the standard success/error envelope with requestId
 */
export function makeRouteHandler<TParams extends { id?: string }>(
  deps: RouteDeps<TParams>
): (req: NextRequest, ctx: { params: Promise<TParams> }) => Promise<Response> {
  return async (req, ctx) => {
    const params = (await ctx.params) ?? ({} as TParams);
    // F10: parameter validation FIRST — before session resolution and
    // authorisation. Invalid id → 400 envelope, uniformly, for everyone.
    const badParam = uuidParamError(params as Record<string, unknown>);
    if (badParam) {
      return fail(
        new ApiError("BAD_REQUEST", `Invalid UUID in URL parameter '${badParam}'`),
        (req?.headers.get("x-request-id") as string | null) ?? randomUUID()
      );
    }
    const call = await getCaller(req);
    try {
      if (deps.permission) {
        if (!call.user || !call.session) {
          throw new ApiError("UNAUTHORIZED", "Authentication required");
        }
        if (deps.resolveCtx) await deps.resolveCtx(call, params);
        if (!can(call.user, deps.permission, call.ctx)) {
          throw new ApiError("FORBIDDEN", "You do not have permission for this action");
        }
      }
      return await deps.handler(req, params, call);
    } catch (e) {
      return fail(e, call.requestId);
    }
  };
}

/** Convenience: a public read that returns ok(data). */
export { ok };
