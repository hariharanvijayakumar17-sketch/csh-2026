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

## D4 — 2026-09-20 — Production hosting: RESOLVED (primary + fallback chosen; accounts still need the human gate)
- **Primary:** single always-on India-region VM — Oracle Cloud Always Free (Chennai region) OR college IT server, whichever the gate provides first. Limits OBSERVED on provider pages 2026-09-20 (see PROVIDER_RESEARCH.md §1, §9).
- **Fallback:** Cloudflare Workers + D1 + R2 (adapter work ≈1 day). **Staging/preview:** Vercel Hobby (rejected for production: "personal project" positioning, 1M req/month, no durable workers) and Render/Railway/Neon free tiers rejected for sleeping/pausing/30-day expiry (all observed, cited in PROVIDER_RESEARCH.md).
- Storage: MinIO on VM (S3-compatible) + R2 10 GB free for backups/overflow. Email: Resend free (3,000/mo, 100/day — burst cap is a known gap with queue mitigations + college SMTP fallback). Cron: systemd timers.
- Alternatives considered + rejected: Vercel+Neon (sleeps, hobby non-commercial), Render free (15-min spin-down, free PG expires 30 days), Railway (trial-then-$1/mo), Supabase free (pause behaviour UNVERIFIED; not used), Cloudflare-only primary (D1=SQLite, 10 ms CPU/req, 100k writes/day).
- Evidence: PROVIDER_RESEARCH.md (all first-party pages fetched 2026-09-20). Human gate: OCI account (card question) and/or college IT server + domain + SMTP — consolidated at P13.
- (Original TBD text retained below for history.)
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

## D11 — Rate limits: generous per-IP, strict per-account, stored in `settings` (2026-09-20, P3 addendum 1)
- Decision: thresholds live in the `settings` table (admin-editable, 60 s cache):
  `ratelimit.login.ip_per_min=60` (campus NAT shares one egress IP),
  `ratelimit.login.account_per_min=10`, register/reset defaults. Code carries
  only fallbacks identical to the seeded defaults.
- Alternatives: hard-coded constants (rejected: brief requires admin-editable
  event rules; campus IP pressure makes hard-coded strict IP limits a
  registration-day outage); per-IP Redis (rejected: no Redis in v1 stack,
  Postgres fixed-window is sufficient at college scale).
- Evidence: p3-addendum integration tests "item 1" (runtime edit changes
  behaviour); docs/evidence/p3-addendum-checks.txt §1/§2.

## D12 — Progressive (account, IP) login delay replaces hard account lockout (2026-09-20, P3 addendum 2)
- Decision: on password failure, (account, client IP) row in `login_delays`
  increments; from the 3rd failure a delay applies: 30 s, doubling per
  failure, cap 30 min. Success from an IP deletes the row. Users-level
  `failed_attempts`/`locked_until` dropped (migration 0001).
- Rejected alternative: keep 5-fail/15-min global lock — a stranger can
  lock a real user out by failing from another IP (self-DoS, support burden
  during registration week).
- Residual risk (accepted, documented): a single attacker IP can still
  delay logins from that IP only; the strict per-account rate limit bounds
  guessing speed. Evidence: "item 2" tests (attacker slowed, legitimate
  IP immediate).

## D13 — Round criteria weights must sum to exactly 100 at activation (2026-09-20, P3 addendum 4)
- Decision: `activateRound()` rejects unless the sum of the round's
  `round_criteria.weight` (numeric(5,2)) equals exactly 100.00 (compared in
  integer cents). Rejection audited (`round.activate_rejected`). Per-row
  0..100 DB check remains as backstop.
- Rejected alternative: DB-level cross-row constraint (Postgres has no
  aggregate CHECK); application-level is auditable and testable.

## D14 — Production startup guard + sandbox `trust` is sandbox-only (2026-09-20, P3 addendum 5)
- Decision: `src/instrumentation.ts` runs `runProductionGuard()` at server
  start. In production it THROWS (fail-closed) on: missing/loopback/
  no-password/dev-default DATABASE_URL; SESSION_SECRET missing/default/
  <32 chars; `settings.demo_seed=true`; or an empty-password PROBE
  connection succeeding (= trust/no-password auth detected live).
  In development the same checks only warn (the sandbox Postgres uses
  loopback `trust` — SANDBOX-ONLY; production MUST be SCRAM + real creds).
- Rejected alternative: attestation env flag only (weak: a misconfigured
  deploy could lie); live probe + static checks is stronger.
- Caveat (documented): if the DB is unreachable the probe fails with "no
  evidence of trust" and the guard passes — the app then fails to start
  anyway on its real connection (no fail-open window for serving).
- Evidence: live refusal captured in docs/evidence/p3-addendum-checks.txt §1
  item 5 + unit (9) + integration (4) tests.

## D15 — scrypt costs and memory limit (2026-09-20, P3 addendum 3)
- Decision: N=16384 (2^14), r=8, p=1, keyLen 64 — EXPORTED and covered by
  unit tests; dummy hash regenerated to the identical parameters (incl.
  64-byte output) so unknown-email timing equalisation costs the same.
- Memory limit: 128·N·r = 16 MiB per hash; libuv pool (UV_THREADPOOL_SIZE=4,
  pinned in deploy docs) ⇒ ≤ ~64 MiB concurrent. Safe on a 1 GB host.
  Raising N requires re-checking this bound.

## D16 — `server-only` guards: where they stay, where they go (2026-09-20)
- Decision: auth modules (login/sessions/tokens/csrf/rate-limit) keep
  `import "server-only"` (route-only code). The shared DB client and
  `settings` module drop it because CLI scripts (`db:seed`,
  `db:bootstrap-admin`) run under plain tsx where Next does not provide
  the package. Test config aliases `server-only` to a no-op stub.

## D17 — db:seed + db:bootstrap-admin implemented (were missing) (2026-09-20)
- Decision: `src/lib/db/seed.ts` (dev-only demo data, random passwords
  printed once, sets demo_seed marker) and `src/lib/db/bootstrap-admin.ts`
  (env-driven super-admin, strength-checked, refuses existing email).
  package.json already referenced both paths; the files did not exist —
  gap closed, both exercised (`db:migrate` + `db:seed` ran clean).

## D18 — Enforcement split: edge middleware (registry+CSRF) vs node handlers (session+can) (2026-09-20, P4)
- Decision: Next middleware (edge runtime, no Postgres access) resolves every
  /api/v1 request against the route-policy registry and applies S9 CSRF on
  mutations; DB-backed auth (session lookup + can()) runs in the single
  route factory makeRouteHandler() on the node runtime.
- Rejected alternative: all enforcement in middleware (impossible: edge
  runtime cannot query Postgres; replicating the DB on edge is out of scope).
- Residual risk (accepted): a route handler that skips makeRouteHandler()
  would bypass session/can checks — mitigated by convention + the registry
  test (every route has a policy) + code review; P9 E2E will exercise the
  HTTP path end-to-end.

## D19 — Email tokens ride in the email body (queue rows carry rendered content) (2026-09-20, P4)
- Decision: verify/reset tokens are single-use, hashed, 30/60 min (P3). The
  emailQueue row stores the RENDERED email (subject + body text/HTML with the
  token link) because the queue schema has no payload column and the raw
  token exists only in memory at issuance. P8 sender reads pending rows and
  sends bodyText/Html.
- Rejected alternatives: schema migration to add payload (deferred — the
  email itself IS the payload carrier by design); synchronous sending
  (no provider in sandbox; would be fake).
- Residual risk (documented): raw token at rest in the email queue row until
  sent/used (30–60 min token lifetime bounds exposure); P8 marks rows sent
  and tokens are single-use regardless.

## D20 — All Zod imports go through src/lib/zod.ts (extended once for OpenAPI) (2026-09-20, P4)
- Decision: src/lib/zod.ts re-exports z after extendZodWithOpenApi(z); every
  route schema imports from "@/lib/zod".
- Reason: live bug found in P4 — the Next bundle created two zod instances,
  so schemas' .openapi() (added by the extension) was missing at runtime
  (500 on /api/v1/openapi, observed + logged). Single re-export point makes
  the extension and the schemas share one instance regardless of bundler
  dedupe behaviour.
- Rejected alternative: in-repo zod→JSON-Schema converter (larger surface,
  duplicates library behaviour); the library (zod-to-openapi 9.1.0, peer
  zod ^4) works once the instance problem is solved.
