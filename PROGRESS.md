# CSH 2026 — PROGRESS (updated 2026-09-20, session 1)

## Completed
- P0 capability audit (docs/evidence/p0-capability-audit.txt)
- PostgreSQL 17.11 installed locally; dev/test DBs created (csh2026_dev, csh2026_test)
- Next.js 15.5.25 (App Router, TS, ESLint, Tailwind, src/) scaffolded
- Tooling: Vitest (unit + integration configs), @playwright/test (Chromium installed), Drizzle ORM + postgres driver + drizzle-kit, Zod, tsx
- Scripts: lint, typecheck, test, test:int, test:e2e, db:generate/migrate/seed/bootstrap-admin
- .env.example with PUBLIC / SERVER_ONLY / SECRET sections
- **All P0 checks PASSED, evidence in docs/evidence/**: p0-checks.txt (lint OK, typecheck OK, vitest 1/1), p0-e2e.txt (Playwright smoke 2/2 desktop+mobile), p0-build.txt (prod build OK), p0-npm-audit.txt
- Local git repo with 2 commits (97f77af + CNA initial)

## Current
Starting P1 research: SIH public workflow → SIH_FINDINGS.md; DPDP Act → DPDP_NOTES.md; provider limits → PROVIDER_RESEARCH.md (all time-boxed, marked OBSERVED/INFERRED/CSH DECISION/UNVERIFIED).

## Blocked
- **GitHub push: NO CREDENTIALS in sandbox.** No gh CLI, no token in env, no .git-credentials/.netrc, no connector tool; anonymous read of github.com works. Human-only action required — consolidated request sent in chat (repo `csh-2026` private + sandbox ed25519 public key as WRITE deployment key, or platform secret/env with a fine-grained PAT; user must not paste secrets in chat). Until then all commits live ONLY in /home/user/csh-2026 (sandbox snapshot persists files but is not the memory protocol we want).
- If `csh-2026` already contains a Next.js/Drizzle project on GitHub, say so — we will fetch and list it first, then HARDEN instead of rebuild (mode switch, §2 MODE).

## Known issues
- `npm audit`: 6 vulnerabilities (5 moderate, 1 high) — dominated by `next` depending on vulnerable `postcss` versions (ecosystem advisory; next 15.5.25 is latest 15.x at install date). Re-verify each release; upgrade path = bump next, document in P14. Evidence: docs/evidence/p0-npm-audit.txt.
- Sandbox ~2 GB RAM: E2E runs with workers=1 (playwright.config.ts).
- No systemd in sandbox: Postgres started via `sudo service postgresql start` (will not survive sandbox restart; documented for TROUBLESHOOTING).

## Test status
- Unit (vitest): 1/1 PASS (smoke). Integration/E2E journey: not yet written (P3+).
- Prod build: PASS. Lint + typecheck: PASS.

NEXT ACTION: P1 research files — (1) SIH_FINDINGS.md from official SIH pages/PDFs via web search (mark sources + dates), (2) DPDP_NOTES.md (DPDP Act 2023 + Rules 2025 status), (3) PROVIDER_RESEARCH.md (host/db/auth/storage/email/cron/monitoring/domain at Rs 0, with real pricing/terms URLs, capacity estimate for 500 concurrent users); then commit locally. No GitHub push until the human gate clears.
