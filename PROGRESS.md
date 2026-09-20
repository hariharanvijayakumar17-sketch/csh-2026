# CSH 2026 — PROGRESS
_Last updated: 2026-09-20 (IST)_

## Completed
- **P0** audit, repo, tooling.
- **P1** research (labelled docs).
- **P2** schema + migration 0000 + integration proof.
- **P3 core** (96b0379): can(), S1 route registry, scrypt, tokens, CSRF,
  trusted-proxy IP, S9 sessions, S7 login/tokens, S8 rate limiter, audit.
- **P3 ADDENDUM** (20d2bb1, all 5 items TDD): settings-driven rate limits
  (IP 60/min generous, account 10/min strict); progressive (account,IP)
  delay; scrypt costs exported/tested (16 MiB/hash bound); round weights
  sum=100 activation guard; production startup guard (trust probe, live
  refusal captured); db:seed + db:bootstrap-admin implemented.
- **P4** (this commit): public site + problem repository + auth API.
  - S1 enforcement: edge middleware (registry resolve 404/405 + CSRF on all
    mutations) + makeRouteHandler() node factory (session + can() + envelope)
  - /api/v1: health, readyz, problems (list/detail/clarifications, public,
    Zod-validated, published-only), openapi (OpenAPI 3.1 from the Zod
    contracts — 13 paths), auth register/verify-email/login/logout/session/
    password-reset(request+confirm)/password/change — all wired to P3 services
  - public SSR site: home, /problems (search+pagination), /problems/[id]
    (+clarifications), /login, /register, /verify-email, /reset-password
    (email links functional), 404 page
  - live smoke over real HTTP (docs/evidence/p4-smoke.txt): CSRF rejection
    (wrong origin + form-encoded), login → HttpOnly cookie → session →
    logout → 401; 404/405 envelopes; openapi 200
  - tests: unit 53/53 (incl. match-route 6), integration 42/42 (incl.
    problems 6), tsc+lint clean, build OK
  - evidence: docs/evidence/p4-checks.txt + p4-smoke.txt; DECISIONS D18–D20

## Current
- **P5**: teams, proposals (immutable versions), documents (S2 ACL).

## Blocked
- None technical. Human-gate items pending (one consolidated request at P13/P14).

## Known issues / deferred
- S2 doc-ACL failing tests → NOW in P5. S4 eval-transaction tests → P7.
- /api/v1/teams etc. return registry-shaped 404 until P5 ships handlers (expected).
- npm audit: 6 advisories via next→postcss (tracked).

## Test status (run 2026-09-20)
- unit 53/53; integration 42/42; typecheck clean; lint 0; build OK; no drift.

Git: origin/main — see `git log` (P4 commit next).

## NEXT ACTION:
P5 — (a) migration 0002 (users.gender; proposal_versions immutable trigger),
(b) failing tests first: teams composition/same-institution/caps, proposals
submit→immutable version (S4) + round-window, documents S2 ACL matrix
(cross-team, cross-institution, unassigned mentor/evaluator), (c) services +
route handlers + file upload (disk), (d) settings defaults (team.max_members
6, team.min_female 1, max 2 PS).
