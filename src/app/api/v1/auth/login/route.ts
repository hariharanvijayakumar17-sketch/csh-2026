import { z } from "@/lib/zod";
import { cookies } from "next/headers";
import { makeRouteHandler, SESSION_COOKIE, sessionCookieOptions } from "@/lib/http/request-context";
import { ok } from "@/lib/http/error";
import { login } from "@/lib/auth/login";
import { deriveClientIp, trustedProxyCountFromEnv } from "@/lib/rate-limit/ip";

export const runtime = "nodejs";

export const loginSchema = z.object({
  email: z.email().max(200),
  password: z.string().min(1).max(200),
});

export const POST = makeRouteHandler({
  permission: null,
  handler: async (req, _params, call) => {
    const body = loginSchema.safeParse(await req.json().catch(() => null));
    if (!body.success) {
      return Response.json(
        {
          success: false,
          error: { code: "VALIDATION_ERROR", message: "Invalid login", details: body.error.issues },
          requestId: call.requestId,
        },
        { status: 400 }
      );
    }
    const clientIp = deriveClientIp(
      req.headers.get("x-forwarded-for"),
      trustedProxyCountFromEnv(),
      req.headers.get("x-real-ip") ?? "127.0.0.1"
    );
    const result = await login({
      email: body.data.email,
      password: body.data.password,
      clientIp,
      userAgent: req.headers.get("user-agent"),
      requestId: call.requestId,
    });

    if (result.status === "ok") {
      const store = await cookies();
      store.set(SESSION_COOKIE, result.session.token, sessionCookieOptions());
      return ok(
        {
          user: { id: result.user.id, email: result.user.email, role: result.user.role },
          expiresAt: result.session.expiresAt,
        },
        call.requestId
      );
    }
    if (result.status === "rate_limited") {
      return Response.json(
        {
          success: false,
          error: { code: "RATE_LIMITED", message: "Too many attempts from this network", details: { retryAfterSec: result.retryAfterSec } },
          requestId: call.requestId,
        },
        { status: 429 }
      );
    }
    if (result.status === "slowed") {
      return Response.json(
        {
          success: false,
          error: { code: "LOCKED", message: "Too many failed attempts — this IP is temporarily slowed", details: { retryAfterSec: result.retryAfterSec } },
          requestId: call.requestId,
        },
        { status: 423 }
      );
    }
    // invalid_credentials — SAME response for unknown email and wrong password (S7)
    return Response.json(
      {
        success: false,
        error: { code: "BAD_REQUEST", message: "Invalid email or password" },
        requestId: call.requestId,
      },
      { status: 401 }
    );
  },
});
