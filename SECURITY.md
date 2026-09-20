# SECURITY.md — CSH 2026 platform (SIH hackathon portal)

Every claim below is **test-verified** as of the P5 external-audit fix
commits (2026-09-20). Where a protection is NOT yet in place, it is listed
under **Known gaps** — nothing here is aspirational.

Evidence: `docs/evidence/p5-audit-red.txt` (probe RED),
`docs/evidence/p5-audit-green.txt` (probe GREEN + full runs),
`docs/evidence/p5-smoke.txt` (live HTTP smoke).

## Authentication

| Control | State (verified) |
|---|---|
| Password hashing: scrypt **N=16384, r=8, p=1, keyLen=64**; unknown users get a **dummy hash with identical parameters** before comparison; comparison via `timingSafeEqual` | unit: `src/lib/auth/__tests__/password-params.test.ts`, `password.test.ts` |
| Login rate limits: 60/min per IP, 10/min per account (settings-driven) | unit: `src/lib/rate-limit/__tests__/ip.test.ts`; integration: `src/integration/auth.test.ts` |
| Sessions: httpOnly, sameSite=strict, secure-in-prod cookie; server-side session rows; re-login after user changes | integration: `src/integration/auth.test.ts` |
| Registration requires email format + password policy (service-enforced) | integration: `src/integration/auth.test.ts` |

## Authorisation (S1 — one central gate)

| Control | State (verified) |
|---|---|
| Every API route goes through `makeRouteHandler` with an explicit policy in `route-policies.ts`; the inventory unit test fails if any route lacks a policy entry | unit: `src/lib/authz/__tests__/route-inventory.test.ts` |
| `can(user, permission, ctx)` is the only permission engine; services re-check internally (route layer is a second gate, not the only one) | unit: `src/lib/authz/__tests__/permissions.test.ts` |
| **F1** invited ≠ member: membership = ACCEPTED rows only; invited rows grant nothing; stale invites auto-decline on create/accept; `POST /teams/:id/decline` | integration: probe A + `src/integration/teams.test.ts` (F1 tests) |
| **F2** uploads separated from views: `document.upload` = accepted team members only (mentors/evaluators read-only); SPOC authorization letter via dedicated route + `document.upload_letter` (own institution, fail-closed) | probes B1/B2 + integration: `src/integration/documents.test.ts` (F2) |
| **F4** mentor/evaluator assignment sets: per-role checks, **fail-closed** (`=== true`, no `??` fall-through), both sets populated by every scope resolver | probe D + unit (F4) + integration: `src/integration/teams.test.ts` (F4) |
| **F5** `proposal.review` = creator of the proposal's problem statement, or SPOC of the team's institution; other problem_crectors denied | probe E + unit (F5) + integration: `src/integration/proposals.test.ts` (F5) |
| **F7** SPOC portal permissions fail-closed (missing ctx institution denies); `announcement.update` = author or own-institution SPOC | unit: `src/lib/authz/__tests__/permissions.test.ts` (F7) |
| Admin (`super_admin`) is the only cross-scope role; early-return in `can()` | unit: `permissions.test.ts` ("admin has everything") |

## Data integrity

| Control | State (verified) |
|---|---|
| **S4** submitted proposal content is immutable: DB trigger raises on any change to a final version row (conditional: draft edits + the one-shot freeze are allowed) | integration: `src/integration/proposals.test.ts` + `src/integration/schema.test.ts` |
| **S5** conflict declaration blocks scoring (both levels) | unit: `permissions.test.ts` (S5) |
| Team composition rules (2–6 members, ≥1 female for submission, 1–2 problems) are settings-driven and service-enforced | integration: `src/integration/teams.test.ts`, `src/integration/p3-addendum.test.ts` |

## File uploads (S10 scope)

| Control | State (verified) |
|---|---|
| **F3** server-side content detection — the client-declared MIME is **never trusted**: `%PDF`/`ftyp`/JPEG/PNG signatures; PK → real zip **central-directory parse** (`[Content_Types].xml` + `word/` ⇒ docx, `ppt/` ⇒ pptx, else zip; unparsable PK ⇒ rejected). `mimeDetected` stores the server's verdict. Legacy `.doc`/`.ppt` rejected (classify as unknown) | unit: `src/lib/documents/__tests__/content-detect.test.ts`; integration: probe C + `documents.test.ts` (F3) |
| Purpose allow-list (zod at route + service); size limit `document.max_bytes` (default 10 MiB) | integration: `documents.test.ts` |
| **F6** state gates: withdrawn/rejected team ⇒ `LOCKED`; proposal-owned doc beyond draft/changes-requested ⇒ `LOCKED`; `document.upload_deadline` (ISO) ⇒ `DEADLINE_PASSED`; super_admin override writes an `audit_log` row | integration: probe F + `documents.test.ts` (F6) |
| Downloads: authenticated, RFC 5987 `Content-Disposition` (UTF-8 `filename*` + ASCII fallback) | unit: `content-detect.test.ts` (RFC 5987) |

## Transport / input

| Control | State (verified) |
|---|---|
| **S9** CSRF: mutating requests require same-origin `Origin`/`Host` **and** content-type JSON or multipart | unit: `src/lib/http/__tests__/csrf.test.ts`; live smoke |
| **F10** URL params validated **before** auth: malformed UUID ⇒ 400 envelope for everyone (no 200-with-error, no 401/403 ordering leak) | unit: `src/lib/http/__tests__/param-validation.test.ts`; live smoke (evidence) |
| Input parsing via Zod (single re-export point, `src/lib/zod.ts`) | unit + build |

## Production hardening (startup guard)

| Control | State (verified) |
|---|---|
| `NODE_ENV=production` startup **refuses** on: missing/loopback/dev-default DB URL, missing/empty password in URL, known-default or short `SESSION_SECRET`, demo-seed marker, or a database that **accepts an empty-password connection** | unit: `src/lib/production-guard/__tests__/production-guard.test.ts`; integration: `src/integration/p3-addendum.test.ts` (item 5) |
| **F9** the empty-password probe is dependency-injected; verdict mapping is pure and tested (accepted ⇒ fail-closed; rejected/unreachable ⇒ no evidence of trust). Verified against a real Postgres in both trust and reject modes | unit + one-shot live check (see commit message `8146ad6`) |

## Repository hygiene

| Control | State (verified) |
|---|---|
| **F8** no runtime artifacts tracked in git: `data/` (user uploads), `playwright-report/`, `test-results/`, no `.env*` — enforced by a unit test that shells out to `git ls-files` | unit: `src/lib/__tests__/repo-hygiene.test.ts` |
| No secrets in the repo (dev credentials are seed-generated per run and printed once) | `git ls-files` + seed design |

## Known gaps (verified absence — do not rely on these)

1. **Document storage is local disk** (`data/uploads`, sha256-keyed). This is NOT
   suitable for serverless/multi-instance deployment. Signed URLs and a blob
   provider (S10) are the P8 path — until then, document bytes live on the app
   instance's filesystem and the authenticated streaming endpoint is the only
   delivery path.
2. **Blind evaluation is NOT applied.** Evaluators can currently see the team
   identity behind an evaluation; the blind-mode hiding (S3 display concern)
   lands in P7.
3. **Rate limits are in-process** (per node). Across multiple instances or
   after a serverless cold start the counters reset. A shared store is a P8
   concern.
4. **Email flows do not exist yet** (P8): invite links, reset emails are
   DB-queue-only; nothing is sent.
5. **Single Postgres instance**, no replication/HA. The startup guard and
   backups are deployment concerns (P8).
6. **Demo-seed refusal runs at Node startup only.** A process that bypasses
   the entrypoint (e.g. a worker importing routes directly) does not re-run
   the guard; the `demo_seed` setting check is the deployable last line.
7. **Evaluation scores are visible to the assigned evaluator before
   submission** (required to score them); submission-time locking is the S5
   path and is tested at the permission level, not yet at a P7 scoring UI.
