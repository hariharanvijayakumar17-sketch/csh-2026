# CSH 2026 — PROGRESS (updated 2026-09-20, session 1)

## Completed
- P0: capability audit, Postgres 17.11 local, Next.js 15.5.25 scaffold, tooling (Vitest unit+int, Playwright desktop+mobile, Drizzle, Zod, tsx), .env.example, evidence for lint/typecheck/vitest/e2e/build — ALL PASSED (docs/evidence/*)
- P1 research (all in repo, sources + dates cited):
  - SIH_FINDINGS.md (sih.gov.in 403s bots → official-mirror sources, marked secondary; numbers table incl. 50/institute, 500/PS, 2 PS/team, 6 members, letterhead letter)
  - DPDP_NOTES.md (Rules 2025 notified 2025-11-13; phased: DPB now, consent managers 2026-11-13, full fiduciary duties 2027-05-13; 6 college/legal decision items listed)
  - PROVIDER_RESEARCH.md (Vercel/Render/Railway/Neon/Oracle/Cloudflare/Resend from first-party pages; capacity table; PRIMARY = always-on India VM (OCI Always Free or college IT), FALLBACK = Cloudflare edge stack; email burst cap flagged with mitigations)
  - DECISIONS.md D4 resolved (primary/fallback/upgrade paths)

## Current
Done for this increment. Next is P2 (schema + migrations) — pure code, no human dependency.

## Blocked
- **GitHub push: NO CREDENTIALS in sandbox** (no gh, no token in env, no .git-credentials/.netrc, no connector; anonymous read works). Human-only action — consolidated request sent in chat: create private repo `csh-2026` + add sandbox ed25519 public key (shown in chat) as a WRITE deployment key, or supply a fine-grained PAT through the platform's env/secret mechanism (never paste into chat). All commits meanwhile live in /home/user/csh-2026 only.
- If `csh-2026` already contains a project on GitHub, say so — we will fetch, list, and HARDEN instead of rebuild.
- Later gates (not asked yet, consolidated at P13): OCI account (card question) / college IT server + base domain + SMTP; one-month Resend Pro OK-or-not; DPDP officer name/retention sign-off.

## Known issues
- npm audit: 6 vulns (5 moderate, 1 high) dominated by next→postcss ecosystem advisory (docs/evidence/p0-npm-audit.txt). Re-check each release; bump next as soon as patched.
- Sandbox ~2 GB RAM: E2E workers=1.
- No systemd in sandbox: `sudo service postgresql start` needed after sandbox restart.
- Resend free 100/day < estimated notification bursts → mitigations designed (in-app first, queue spread, college SMTP fallback); still the top free-tier risk.

## Test status
- Unit 1/1 PASS · typecheck PASS · lint PASS · prod build PASS · E2E smoke 2/2 PASS (desktop+mobile).
- Journey E2E, permission matrix, S1–S12 tests: not yet written (P3–P9 plan).

NEXT ACTION: P2 — Drizzle schema for users/sessions/tokens/teams/team_members/institutions/problems/proposals/proposal_versions/documents/notifications/announcements/evaluations/eval_scores/certificates/audit_log/settings/feature_flags + migrations via drizzle-kit, index on real query paths, FK/unique/check constraints, soft-delete columns where sensible; integration test boots the schema against csh2026_test; commit.
