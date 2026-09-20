import { describe, expect, it } from "vitest";
import { ROUTE_POLICIES, type RouteEntry } from "../route-policies";
import { Permissions } from "../permissions";

/**
 * S1 route inventory test: walks the registry and FAILS if any route lacks
 * an explicit policy. This is the automated guard required by brief §6 S1 —
 * a route cannot be served without a declared, checkable policy.
 */

const ALL_PERMISSIONS = new Set<string>(Object.values(Permissions));

describe("S1 route inventory (every route has an explicit policy)", () => {
  const entries = Object.entries(ROUTE_POLICIES);

  it("registry is non-empty and covers the core surfaces", () => {
    expect(entries.length).toBeGreaterThan(30);
    for (const required of [
      "/api/v1/auth/login",
      "/api/v1/teams/:id",
      "/api/v1/proposals/:id/submit",
      "/api/v1/spoc/teams/:id/verify",
      "/api/v1/evaluator/evaluations/:id/submit",
      "/api/v1/admin/results/publish",
      "/api/v1/documents/:id/download",
    ]) {
      expect(ROUTE_POLICIES[required], required).toBeDefined();
    }
  });

  it("every registered route has an explicit policy", () => {
    for (const [path, routes] of entries) {
      expect(routes.length, `${path} has no routes`).toBeGreaterThan(0);
      for (const r of routes) {
        expect(r.method, `${path}`).toBeTruthy();
        expect(r.policy, `${path} ${r.method} has no policy`).toBeDefined();
        if (r.policy.kind === "permission") {
          expect(
            ALL_PERMISSIONS.has(r.policy.permission),
            `${path} ${r.method} references unknown permission ${r.policy.permission}`
          ).toBe(true);
        } else if (r.policy.kind === "public") {
          expect(r.policy.reason.length, `${path} public without reason`).toBeGreaterThan(5);
        }
      }
    }
  });

  it("no route relies on a bare 'authenticated' policy (scope must be expressible via can)", () => {
    for (const [, routes] of entries) {
      for (const r of routes) {
        expect(
          (r.policy as { kind: string }).kind !== "authenticated",
          "bare authenticated policy is forbidden"
        ).toBe(true);
      }
    }
  });

  it("scoped resource routes map to scoped permissions, not public", () => {
    const mustNotBePublic: [string, string][] = [
      ["/api/v1/teams/:id", "GET"],
      ["/api/v1/teams/:id", "PATCH"],
      ["/api/v1/proposals/:id", "GET"],
      ["/api/v1/proposals/:id", "PATCH"],
      ["/api/v1/proposals/:id/submit", "POST"],
      ["/api/v1/documents/:id", "GET"],
      ["/api/v1/documents/:id/download", "GET"],
      ["/api/v1/spoc/teams", "GET"],
      ["/api/v1/spoc/teams/:id/verify", "POST"],
      ["/api/v1/evaluator/evaluations", "GET"],
      ["/api/v1/evaluator/evaluations/:id/submit", "POST"],
      ["/api/v1/mentor/teams", "GET"],
      ["/api/v1/admin/results/publish", "POST"],
      ["/api/v1/notifications", "GET"],
    ];
    for (const [path, method] of mustNotBePublic) {
      const r = (ROUTE_POLICIES[path] as RouteEntry[]).find(
        (x) => x.method === method
      );
      expect(r, `${path} ${method} missing`).toBeDefined();
      expect(
        (r as RouteEntry).policy.kind,
        `${path} ${method} must not be public`
      ).toBe("permission");
    }
  });

  it("public routes are read-only or token-bearing auth endpoints only", () => {
    const allowedPublicPost = new Set([
      "/api/v1/auth/register",
      "/api/v1/auth/verify-email",
      "/api/v1/auth/login",
      "/api/v1/auth/password-reset/request",
      "/api/v1/auth/password-reset/confirm",
    ]);
    for (const [path, routes] of entries) {
      for (const r of routes) {
        if (r.policy.kind === "public" && r.method === "POST") {
          const inv = path === "/api/v1/invites/:token/accept";
          expect(
            allowedPublicPost.has(path) || inv,
            `${path}: public POST requires explicit allow-list entry`
          ).toBe(true);
        }
        if (r.policy.kind === "public" && r.method === "PATCH") {
          throw new Error(`${path}: public PATCH is not allowed`);
        }
      }
    }
  });
});
