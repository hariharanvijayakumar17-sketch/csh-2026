# CSH 2026 — PROGRESS
_Last updated: 2026-09-20 (IST)_

## Completed
- **P0** audit, repo, tooling (committed).
- **P1** research: SIH rules (mirrors; sih.gov.in 403s bots — marked), DPDP Act/Rules, provider free-tier research → docs/ (all OBSERVED/INFERRED/UNVERIFIED labelled).
- **P2** schema: 29 tables (Drizzle), migration 0000, append-only audit trigger, unique
  certificate/public IDs, integration proof 10/10 vs real Postgres (commit 514382e).
- **P3 (core complete)** auth + authorisation BEFORE features:
  - central `can(user, permission, ctx)` + permission matrix (roles never string-checked),
  - route-policy registry: full /api/v1 inventory, no bare "authenticated" (S1 enforced by test),
  - scrypt password hashing (real bug caught: empty salt/hash timingSafeEqual — fixed),
  - hashed single-use tokens, CSRF guard, trusted-proxy IP derivation (XFF ignored unless trusted),
  - **S9** sessions: hashed tokens, 30 d TTL, revoke-all on password change, rotation,
  - **S7** login: 5 fails → 15 min lockout; dummy-verify non-enumeration (unknown email ≡ wrong pw),
  - **S7** email-verify (30 min single-use) + password-reset (60 min single-use, revokes ALL sessions),
  - **S8** fixed-window DB rate limiter keyed ONLY on derived client IP,
  - append-only audit writer (DB trigger rejects UPDATE/DELETE).

## Current
- Committing P3 evidence (docs/evidence/p3-checks.txt) + this update.

## Blocked
- None technical. Human gate items pending (one consolidated request drafted, not yet sent —
  see P13/P14 notes): college domain/officials, provider accounts.

## Known issues / deferred
- S2 doc-ACL + S4 eval-transaction failing tests: deferred to P5/P7 (target service code
  that does not exist yet). Route enforcement (middleware wiring of the registry),
  session cookie attributes, and CSRF wiring land with the first API routes in P4.
- npm audit: 6 advisories via next→postcss (tracked, no known-impact on this app's surface).

## Test status (run 2026-09-20)
- unit: 7 files / 34 tests PASS — `npx vitest run`
- integration: 2 files / 22 tests PASS — `npm run test:int`
- typecheck: clean; lint: 0 problems; build: OK; drizzle drift: none
- evidence: docs/evidence/p2-checks.txt, docs/evidence/p3-checks.txt

Git: HEAD 85e1ab5 = origin/main (10 commits).

## NEXT ACTION:
P4 — public site + problem repository: first API routes (problems list/detail/clarifications)
+ Next middleware enforcing the route-policy registry (session cookie attributes, CSRF on
mutating routes, rate-limit calls), Zod contracts → OpenAPI, static problem catalog page.
