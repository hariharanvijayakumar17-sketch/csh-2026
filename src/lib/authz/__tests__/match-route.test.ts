import { describe, expect, it } from "vitest";
import { matchRoutePolicy } from "../match-route";

/**
 * S1 enforcement core: every /api/v1 request must resolve to an EXPLICIT
 * policy from the registry. Unregistered route → not_found (404), known path
 * + wrong method → method_not_allowed (405). No bare "authenticated".
 */

describe("matchRoutePolicy (S1 middleware core)", () => {
  it("matches literal routes", () => {
    const r = matchRoutePolicy("GET", "/api/v1/health");
    expect(r.kind).toBe("matched");
    if (r.kind === "matched") expect(r.entry.policy.kind).toBe("public");
  });

  it("matches :id parameters and extracts them", () => {
    const r = matchRoutePolicy("GET", "/api/v1/problems/PS-2026-0001");
    expect(r.kind).toBe("matched");
    if (r.kind === "matched") {
      expect(r.params).toEqual({ id: "PS-2026-0001" });
      expect(r.entry.policy.kind).toBe("public");
    }
  });

  it("returns method_not_allowed with the allowed methods", () => {
    const r = matchRoutePolicy("DELETE", "/api/v1/problems");
    expect(r.kind).toBe("method_not_allowed");
    if (r.kind === "method_not_allowed") expect(r.allowed).toEqual(["GET"]);
  });

  it("unknown routes are not_found (never a fallback 'authenticated')", () => {
    expect(matchRoutePolicy("GET", "/api/v1/nope").kind).toBe("not_found");
  });

  it("public mutations exist ONLY for the token/registration endpoints", () => {
    const r = matchRoutePolicy("POST", "/api/v1/auth/login");
    expect(r.kind).toBe("matched");
    if (r.kind === "matched") expect(r.entry.policy.kind).toBe("public");
    // same path family, mutating, non-public policy:
    const r2 = matchRoutePolicy("POST", "/api/v1/teams");
    expect(r2.kind).toBe("matched");
    if (r2.kind === "matched") expect(r2.entry.policy.kind).toBe("permission");
  });

  it("non-/api/v1 paths are out of scope (next() in middleware)", () => {
    expect(matchRoutePolicy("GET", "/problems").kind).toBe("not_api");
  });
});
