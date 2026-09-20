# CSH 2026 — PROGRESS (updated 2026-09-20, session 1)

## Completed
- **P0** audit, Postgres 17.11, Next.js 15.5.25 scaffold, tooling (Vitest unit+int, Playwright d+m, Drizzle, Zod, tsx), .env.example, evidence — all green
- **P1** research: SIH_FINDINGS.md, DPDP_NOTES.md, PROVIDER_RESEARCH.md (first-party pricing/terms, 2026-09-20), DECISIONS D4 resolved (primary: India always-on VM — OCI Always Free or college IT; fallback: Cloudflare edge)
- **GitHub gate CLEARED**: deployment key approved by user; push verified (e6a8434 → main; e369dc9/e6a8434 era). Remote: hariharanvijayakumar17-sketch/csh-2026 (contained only a 1-line README — no prior project, from-scratch build continues)
- **P2** schema v1 + committed migration `drizzle/0000_init.sql`:
  - 29 tables (identity, teams, problems/rounds/criteria/proposals/immutable versions, evaluations/scores/results/certificates, system: settings, flags, announcements, notifications, email queue, append-only audit, CMS, import/export jobs, rate-limit buckets)
  - UUID PKs, FKs with explicit ON DELETE, unique + check constraints, lower() unique indexes, FTS tsvector+GIN+sync trigger, DB triggers making audit_log & status_histories append-only
  - **Integration proof: 10/10 PASS on real Postgres 17** (docs/evidence/p2-checks.txt)
  - Full checks green: lint 0/0, typecheck, unit 1/1, integration 10/10, prod build

## Current
Starting **P3**: auth (scrypt, hashed single-use tokens, session rotation, lockout, non-enumerating), central `can(user, action, resource)` authorisation, trusted-IP rate limiting, audit writer, and the route-inventory + permission-matrix tests (failing tests FIRST, per brief §6).

## Blocked
- None hard. (Deployment/college/DPDP gates consolidated later at P13 — see DPDP_NOTES.md §"Decisions needing college or legal approval".)

## Known issues
- Sandbox quirk: TCP loopback Postgres SCRAM/MD5 auth broken (sandbox network layer) → local loopback set to `trust`; production will use real SCRAM on a real host. Documented for TROUBLESHOOTING.
- npm audit: 6 vulns (5 moderate, 1 high) dominated by next→postcss ecosystem advisory (p0-npm-audit.txt). Re-check each release.
- Sandbox ~2 GB RAM: E2E workers=1. No systemd: `sudo service postgresql start` after sandbox restart.
- Resend free 100/day < notification burst estimates → mitigations designed (in-app first, queue spread, college SMTP fallback); top free-tier risk.
- Drizzle migrator tracks applied migrations in schema `drizzle` (not public) — test setup drops both; deploy docs must note this for clean test databases.

## Test status
- Unit 1/1 · Integration 10/10 · Lint 0/0 · Typecheck · Build · E2E smoke 2/2 (P0) — all PASS
- S1–S12 security tests: NOT YET WRITTEN (P3, this increment)

NEXT ACTION: P3 — (1) write failing tests: permission matrix (route inventory walk fails without explicit policy), S2 doc ACL matrix, S4 evaluation transaction/double-submit, S5 conflict, S7 email-verify/reset/lockout, S8 spoofed X-Forwarded-For bypass, S9 CSRF/Origin; (2) implement: src/lib/auth (scrypt hash, tokens, sessions, lockout, can()), src/lib/rate-limit (trusted-proxy IP), src/lib/audit; (3) make tests pass; (4) commit + push.
