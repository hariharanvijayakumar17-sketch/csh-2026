# CSH 2026 — PROGRESS
_Last updated: 2026-09-20 (IST)_

## Completed
- **P0** audit, repo, tooling.
- **P1** research (SIH mirrors, DPDP, provider free tiers — labelled docs).
- **P2** schema: 29 tables + migration 0000 + integration proof 10/10.
- **P3 core** central can(), route-policy registry (S1), scrypt, hashed tokens,
  CSRF, trusted-proxy IP, S9 sessions, S7 login/tokens, S8 DB rate limiter,
  append-only audit — 34 unit + 22 integration green (commit 96b0379).
- **P3 ADDENDUM (all 5 items, TDD failing-first, pushed):**
  1. rate limits in `settings` (IP 60/min generous, account 10/min strict),
     runtime-editable proven by test; TRUSTED_PROXY_COUNT misconfig documented
  2. progressive (account, IP) delay (3 fails → 30 s doubling, cap 30 min)
     replaces hard lockout; attacker IP slowed, legitimate IP NOT (tested);
     migration 0001 drops users.failed_attempts/locked_until
  3. scrypt costs exported + tested (N=16384 r=8 p=1, keyLen 64; dummy same
     cost; timingSafeEqual; 16 MiB/hash ≤ 64 MiB concurrent bound documented)
  4. round activation requires criteria weights summing to exactly 100
     (90/105/empty rejected & audited; fractional honoured)
  5. production guard: refuses start (NODE_ENV=production) on trust/no-password
     DB (live empty-password probe), dev-default/loopback DB creds,
     default/missing SESSION_SECRET, demo seed; live refusal captured in
     evidence; sandbox `trust` documented SANDBOX-ONLY
  - also closed gap: db:seed + db:bootstrap-admin implemented & exercised
  - tests: unit 47/47 (9 files), integration 36/36 (3 files), tsc+lint+build clean
  - evidence: docs/evidence/p3-addendum-checks.txt; DECISIONS D11–D17

## Current
- P4: public site + problem repository (routes, middleware enforcement, Zod→OpenAPI).

## Blocked
- None technical. Human-gate items (college domain/officials, provider
  accounts) still pending — consolidated request to be sent at P13/P14.

## Known issues / deferred
- S2 doc-ACL + S4 eval-transaction failing tests: P5/P7 (target services not
  yet built). Route enforcement = middleware (public/CSRF/registry) +
  `withPermission()` handler guard (edge middleware cannot touch the DB).
- npm audit: 6 advisories via next→postcss (tracked).

## Test status (run 2026-09-20)
- unit 47/47; integration 36/36; typecheck clean; lint 0; build OK; no drift.

Git: origin/main (see `git log`); last pushed commit covers P3 addendum.

## NEXT ACTION:
P4 — (a) middleware enforcing the route-policy registry + CSRF on mutations,
(b) /api/v1/health, /api/v1/problems, /api/v1/problems/[id],
/api/v1/problems/[id]/clarifications (public, Zod-validated, error envelope),
(c) auth API routes (register/verify/login/logout/reset) wiring the P3
services + session cookie attributes, (d) OpenAPI JSON from Zod,
(e) public site: home + /problems + /problems/[id] SSR pages.
