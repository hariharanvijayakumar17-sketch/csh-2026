import { NextRequest, NextResponse } from "next/server";
import { matchRoutePolicy } from "@/lib/authz/match-route";
import { checkMutatingRequest } from "@/lib/http/csrf";

/**
 * Edge middleware (S1 + S9 enforcement layer).
 *
 * What CAN run on the edge: pure logic only. So the middleware:
 *  1. resolves EVERY /api/v1 request against the route-policy registry —
 *     unregistered route → 404 envelope, wrong method → 405 (S1: no route
 *     can ship without an explicit policy);
 *  2. applies the S9 CSRF checks to ALL mutating requests (same-origin
 *     Origin + JSON-only) — including the public POST endpoints (login etc.);
 *  3. stamps x-request-id.
 *
 * What needs the DB (session validity + can()) runs in the route handlers
 * via withPermission()/asPublic() — the edge runtime has no Postgres access.
 */

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function envelope(code: string, message: string, status: number) {
  return NextResponse.json(
    { success: false, error: { code, message } },
    { status }
  );
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const match = matchRoutePolicy(req.method, pathname);

  if (match.kind === "matched") {
    const res = NextResponse.next();
    if (MUTATING.has(req.method)) {
      const csrf = checkMutatingRequest(req.headers);
      if (csrf !== "ok") {
        return envelope(
          "BAD_REQUEST",
          csrf === "origin_mismatch"
            ? "Origin does not match host (CSRF protection)"
            : "Content-Type must be application/json",
          400
        );
      }
    }
    return res;
  }

  if (match.kind === "not_api") return NextResponse.next();
  if (match.kind === "method_not_allowed") {
    return envelope(
      "METHOD_NOT_ALLOWED",
      `Method ${req.method} not allowed; allowed: ${match.allowed.join(", ")}`,
      405
    );
  }
  return envelope("NOT_FOUND", "Unknown API route", 404);
}

export const config = {
  matcher: ["/api/:path*"],
};
