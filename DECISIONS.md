# CSH 2026 — DECISIONS LOG

Format: date | decision | alternatives | rejected because | reason + evidence.

## D1 — 2026-09-20 — Primary stack: Next.js 15 App Router (TypeScript) + Drizzle ORM + PostgreSQL 17
- Alternatives considered: (a) plain Express + Postgres, (b) SvelteKit, (c) Django, (d) serverless Node + managed DB only.
- Rejected: (a) separate frontend/backend = 2 deploys for a 1-student team; (b)/(c) weaker India-hosting free-tier fit and smaller ecosystem for this shape of app; (d) serverless alone cannot host durable email-retry workers without extra services.
- Reason: single deployable for API + portals + public site; boring, well-documented, few moving parts; the working default proven in this sandbox; Drizzle = thin SQL-ish ORM, real migrations, no black box. Evidence: create-next-app scaffold succeeded (docs/evidence/p0-scaffold.txt), local Postgres 17.11 running (p0-capability-audit.txt).
- Status: DECISION (production host still TBD at human gate; see D4).

## D2 — 2026-09-20 — Auth: home-grown session auth on Postgres, no external IdP
- Alternatives: Auth.js, Keycloak, Clerk, Firebase Auth.
- Rejected: all add an external service (Rs 0 budget, 1-student ops, no sleeping third parties) or a heavy ops surface.
- Reason: requirements (hashed expiring single-use email tokens, session rotation, per-account/IP lockout, reset-revokes-sessions) are explicit and testable; Postgres is already in the stack; node:crypto scrypt for password hashing (no native deps). Status: DECISION, to be implemented in P3 with tests.

## D3 — 2026-09-20 — Password hashing: node:crypto scrypt (built-in)
- Alternatives: bcrypt (native module), argon2 (native/extra dep), pbkdf2.
- Rejected: native deps complicate builds/CI; pbkdf2 has weaker per-core throughput.
- Reason: zero extra dependencies, standard library, adequate with per-user random salt + iteration count; will be covered by unit test. Status: DECISION.

## D4 — 2026-09-20 — Production hosting: TBD at human gate (user's accounts required)
- Constraint set (from brief): Rs 0 recurring, no sleeping on deadline days, S3-compatible storage, India latency, 500 concurrent users, 1-student ops.
- Candidates to verify at P1 (provider pricing/terms pages, marked OBSERVED/UNVERIFIED): Vercel (hobby non-commercial + sleeps → likely rejected for prod event day), Railway/Render (paid tiers), Oracle Cloud Always Free VM (verify current terms; possible card requirement), Hetzner (cheap but not Rs 0), Cloudflare Workers+D1/R2 (verify limits), Fly.io (verify free tier existence), college-hosted VPS (likely best: institutional, local latency, near-Rs 0 via college IT).
- Status: OPEN — will be resolved at the Phase A (research) step and requires a human gate (account creation). Cheapest upgrade path will be recorded per service.

## D5 — 2026-09-20 — Email: provider-agnostic queue with pluggable transport; dev transport = console
- Alternatives: hard-wire Resend/SendGrid/Mailgun in P3.
- Reason: no card, no account yet; the queue (retry/backoff/delivery status) is the durable part and is provider-independent. Production transport chosen at human gate. Status: DECISION (interface) — provider OPEN.

## D6 — 2026-09-20 — Local dev database: PostgreSQL 17.11 via apt in sandbox
- Reason: integration tests must run against REAL Postgres (brief §5.5/§9); sandbox has no Docker, so apt install is the boring path. Evidence: p0-capability-audit.txt.

## D7 — 2026-09-20 — CI test database: same local Postgres, separate database csh2026_test; E2E uses a fresh schema per run
- Reason: no Docker; single-node simplicity. Evidence: DB created (p0-capability-audit.txt).

## D8 — 2026-09-20 — Row-Level Security: NOT used in v1 (recorded explicitly per §5.5)
- Reason: single application DB role with enforced central `can(user, action, resource)` layer (S1) + integration permission-matrix tests is the verifiable control; RLS with app context switching adds a second, harder-to-test enforcement layer and is a no-op if the app role has BYPASSRLS. If a future DB role split is introduced (read-only analytics role), RLS will be reconsidered then. Status: DECISION (documented non-use, not a claim of protection).

## D9 — 2026-09-20 — Object storage: S3-compatible bucket in production; local-disk fallback for dev/staging only
- Reason: serverless hosts do not persist local disk (re-verified at P1 against chosen host). Bucket chosen with the host at human gate. Status: DECISION (interface), provider OPEN.

## D10 — 2026-09-20 — Commit identity for the sandbox bot
- user.name "csh-2026-bot", user.email "csh-2026-bot@users.noreply.github.com" (local git config).
- Reason: no card/account; noreply style email is non-secret. Status: DECISION.
