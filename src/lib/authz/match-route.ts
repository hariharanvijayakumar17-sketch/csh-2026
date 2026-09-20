import { ROUTE_POLICIES, type RouteEntry } from "./route-policies";

/**
 * S1 enforcement core (pure — runs in edge middleware AND is unit-tested).
 * A request is "matched" only against an EXPLICIT registry entry. There is
 * deliberately no default: unregistered → not_found, wrong method →
 * method_not_allowed.
 */

export type MatchResult =
  | { kind: "matched"; entry: RouteEntry; params: Record<string, string> }
  | { kind: "not_api" }
  | { kind: "not_found" }
  | { kind: "method_not_allowed"; allowed: string[] };

export function matchRoutePolicy(
  method: string,
  pathname: string
): MatchResult {
  if (!pathname.startsWith("/api/v1/")) return { kind: "not_api" };

  const segs = pathname.split("/").filter(Boolean);
  let allowedHere: string[] | null = null;

  for (const [pattern, entries] of Object.entries(ROUTE_POLICIES)) {
    const psegs = pattern.split("/").filter(Boolean);
    if (psegs.length !== segs.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < psegs.length; i++) {
      if (psegs[i].startsWith(":")) params[psegs[i].slice(1)] = decodeURIComponent(segs[i]);
      else if (psegs[i] !== segs[i]) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    const allowed: string[] = entries.map((e) => e.method);
    if (allowed.includes(method)) {
      const entry = entries.find((e) => e.method === method)!;
      return { kind: "matched", entry, params };
    }
    allowedHere = allowed;
  }

  if (allowedHere) return { kind: "method_not_allowed", allowed: allowedHere };
  return { kind: "not_found" };
}
