# CSH 2026 — PROGRESS
_Last updated: 2026-09-20 (IST)_

## Completed
- **P0** audit, repo, tooling.
- **P1** research (labelled docs).
- **P2** schema + migration 0000 + integration proof.
- **P3 core** (96b0379): can(), S1 route registry, scrypt, tokens, CSRF,
  trusted-proxy IP, S9 sessions, S7 login/tokens, S8 rate limiter, audit.
- **P3 ADDENDUM** (20d2bb1, all 5 items TDD): settings-driven rate limits;
  progressive (account,IP) delay; scrypt cost bound; round weights sum=100
  guard; production startup guard; db:seed + bootstrap-admin.
- **P4** (b219baa): public site + problem repository + auth API + S1
  enforcement wiring (edge middleware registry+CSRF, makeRouteHandler
  session+can), openapi 3.1 from Zod, live smoke. Unit 53/53, int 42/42.
- **P5** (this commit): teams, proposals with immutable versions (S4),
  documents with the S2 ACL matrix.
  - migration 0002: users.gender (+check), conditional immutability trigger
    on proposal_versions (D23)
  - teams service: create/invite/accept/remove/withdraw/setProblems/
    update/list; same-institution, one-team-per-user, settings caps
    (max 6, min 1 female on submit, max 2 PS)
  - proposals service: draft autosave → submit freezes version in ONE
    transaction; resubmit after changes_requested creates a NEW version;
    round-window check; composition check (min_female)
  - documents service: sha256 + disk storage, MIME allow-list + magic
    sniffing, size cap, S2 ACL exclusively via can() (members / own-inst
    SPOC / assigned mentor / assigned evaluator / admin)
  - 15 API routes on makeRouteHandler with route-level can() (scope
    resolvers) + registry entries (proposal create team-scoped, D22)
  - S9 CSRF extended to multipart/form-data (D21)
  - failing tests first: teams 9, proposals 7, documents 6 (RED observed:
    missing packages; S2 matrix includes cross-team, cross-institution,
    unassigned mentor/evaluator)
  - live HTTP smoke all green (docs/evidence/p5-smoke.txt)
  - checks: unit 54/54, integration 64/64, tsc clean, lint 0, build 23/23
  - evidence: docs/evidence/p5-checks.txt + p5-smoke.txt; DECISIONS D21–D23

## Current
- **P6** NOT STARTED (awaiting user go-ahead per task instruction: stop after P5).

## Blocked
- Human-gate items pending (one consolidated request at P13/P14).

## Known issues / deferred
- S4 eval-transaction tests → P7. S10 signed URLs → P8 (current download is
  authenticated streaming). E2E browser suite → P9.
- Invites have no email link yet (invitee acts after login; D22).
- npm audit: 6 advisories via next→postcss (tracked).

## Test status (run 2026-09-20, output in docs/evidence/)
- unit 54/54 (10 files); integration 64/64 (7 files: schema 10, auth 11,
  p3-addendum 15, problems 6, teams 9, proposals 7, documents 6);
  typecheck clean; lint 0; build 23/23; no schema drift.
- E2E: not yet built (P9 per plan) — HTTP-level proof = p5-smoke.txt.

Git: origin/main — see `git log` (P5 commit next).

## NEXT ACTION:
STOP after P5 (user instruction). When told to continue: P6 — creator/SPOC
portals (problems create/edit/clarify flow, SPOC team verify/shortlist,
mentor feedback) + the remaining registry surfaces + UI pages for
team/proposal/document flows.
