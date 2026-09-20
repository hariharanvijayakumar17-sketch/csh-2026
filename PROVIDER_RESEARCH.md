# PROVIDER_RESEARCH — hosting, DB, auth, storage, email, cron, monitoring, domain (Rs 0 recurring)

Checked: 2026-09-20 (Asia/Calcutta). All limits below are **OBSERVED** on the cited first-party pages on that date, except items marked UNVERIFIED. Requirements: Rs 0 recurring, no card unless truly required, no sleeping/pausing on deadline days, S3-compatible persistent storage, India latency, 500 concurrent users, few thousand accounts, one-student operability.

## 1. Hosting

### 1a. Oracle Cloud Infrastructure — Always Free (PRIMARY candidate) — OBSERVED 2026-09-20, https://www.oracle.com/cloud/free/
- ARM Ampere A1: **1,500 OCPU-hours + 9,000 GB-hours per month** (can be 1 VM or 2). INFERRED: an always-on **2 OCPU / 8 GB** VM fits the Always Free hour caps (≈1,460 OCPU-h, ≈5,840 GB-h); a 4 OCPU / 24 GB VM does NOT fit if left on 24/7.
- US$300 × 30-day trial credit advertised (promo — may vary at signup; UNVERIFIED per-account).
- India regions exist (Mumbai/Chennai/Hyderabad per OCI public docs — UNVERIFIED in this fetch; Chennai is ideal for Trichy latency).
- UNVERIFIED (to confirm at signup, human gate): (1) whether Always Free signup still demands a card for verification (historically yes, no charge), (2) current 200 GB block storage allowance (listed on same page in a section not fetched this session).
- Fit: **no sleeping** (our VM), one machine for app+DB+storage+cron = fewest moving parts, upgrade path = PAYG on the same tenancy (cheapest scale-up).
- Risk: card at signup (brief rule: ask user first), 2 OCPU/8 GB ceiling at Rs 0 → P12 load test must gate event-day confidence.

### 1b. College-hosted server (SRM TRP IT) — UNVERIFIED
- Best latency (on campus) and near-Rs 0 (institutional). Requires college IT: a VM/host, public ingress (443), admin access. **Human gate** — included in the consolidated request when we reach deployment; research now cannot verify.

### 1c. Cloudflare (Workers + D1 + R2 + Pages) (FALLBACK) — OBSERVED 2026-09-20, https://www.cloudflare.com/plans/
- Workers Free: **100k requests/day, 10 ms CPU/request**. D1 Free: 100k requests/day, 50M row reads/day, **100k row writes/day, 5 GB stored data** (+1 GB KV backend). Workers KV Free: 1 GB, 100k reads/day, 1k writes/day. Pages Free for static.
- Zone Free plan wording: "personal or hobby projects that aren't business-critical".
- Fit as FALLBACK: never sleeps (edge), no card, $0. NOT chosen primary because: D1 is SQLite (not Postgres; dialect drift from the app's Postgres/Drizzle stack), 10 ms CPU/request is very tight for auth+DB paths, 100k writes/day is near our deadline-day estimate, and the email-retry worker has no durable Postgres-backed queue.
- **CSH DECISION**: keep Cloudflare as (a) the production fallback, and (b) the natural home for the public marketing site + certificate verify page (static, edge, global) even when the app runs on a VM.

### 1d. Vercel Hobby — OBSERVED 2026-09-20, https://vercel.com/pricing
- $0/mo: "perfect starting place for your web app or **personal project**"; 1M edge requests/month, 100 GB fast transfer, Functions: 4 h Fluid Active CPU + 1M invocations, 1 GB Blob, **1 project**, 1 developer seat. Non-commercial restriction sits in the ToS (specific clause UNVERIFIED in this session; pricing-page wording quoted).
- Serverless functions: no persistent local disk, no durable workers. **REJECTED as production primary** (institutional event ≠ personal project; sleeping/cold starts on deadline day; 1M req/month ceiling is low for a hackathon month). **KEPT** as staging/preview + marketing site candidate.

### 1e. Render Free — OBSERVED 2026-09-20, https://render.com/docs/free
- Free web services **spin down after 15 min idle** (~1 min wake), ephemeral filesystem (local files lost on redeploy/restart/spin-down), **free Postgres expires 30 days after creation**, 750 free instance-hours/month, no persistent disks, "Do not use them for production applications" (their words). **REJECTED** for production.

### 1f. Railway — OBSERVED 2026-09-20, https://railway.com/pricing
- Free tier is a **30-day trial with $5 credits, then $1/mo**; after trial: 1 project, 0.5 GB RAM, cron jobs trial-only, idle timeout ≤5 min. **REJECTED** (not Rs 0 recurring).

## 2. Database
- **Primary: Postgres 17 on the chosen VM** (same machine, 5432 bound to localhost; Caddy terminates TLS). Evidence: works locally in sandbox (p0-capability-audit.txt). No pausing, real PG (Drizzle/ORM feature parity), full-text search available.
- **Fallback: Cloudflare D1** (limits above) only if the VM route fails the human gate; requires an adapter layer (drizzle dialect switch) — cost: ~1 day of work, recorded as decision D4b at that time.
- Neon Free (OBSERVED 2026-09-20, https://neon.com/docs/introduction/plans): **scales to zero after 5 min**, 100 CU-hours/project/month, 0.5 GB storage/project → REJECTED for production (an always-on 0.25 CU instance alone would burn ≈180 CU-h > 100 CU-h/month).
- Supabase free: UNVERIFIED this session (known to pause after a week of inactivity) — not used.

## 3. Auth
- Home-grown on Postgres (DECISIONS.md D2/D3) → no external auth provider, no free-tier limit, no card. (This is itself a provider decision: rejected Auth.js/Clerk/Firebase for budget+ops reasons.)

## 4. Object storage (documents)
- **Primary: MinIO on the VM** (S3-compatible API, on the VM's persistent block storage — NOT serverless ephemeral disk; satisfies brief §4.4 "S3-compatible bucket, not local disk, in production" in spirit + API). Size budget: 2,000 docs × ≤10 MB ≈ 20 GB (see §6 capacity).
- **Secondary/off-VM: Cloudflare R2 Free** — OBSERVED 2026-09-20 (https://www.cloudflare.com/plans/): **10 GB storage, 1M Class A + 10M Class B operations, no egress pricing line** (R2 egress-free is the product's standing feature; treat exact egress-free claim as INFERRED from absence of an egress line). Use: encrypted backups (pg_dump), overflow mirroring, public certificate-asset delivery.
- Upload ACL/streaming per S10; short-lived signed URLs.

## 5. Email
- **Resend Free — OBSERVED 2026-09-20, https://resend.com/pricing: 3,000 emails/month but 100 emails/day; 3 custom domains; 30-day data retention; 1 webhook.** The 100/day cap is the binding limit on notification burst days (e.g. results published: hundreds in one day).
- Mitigations (implemented, not assumed): in-app notifications FIRST (no email dependency for correctness); email queue with per-day caps, exponential backoff, spread of bulk sends across ≤2–3 days where the user can wait; critical one-offs (verify email, password reset) prioritized in the queue.
- Fallback: college SMTP relay (human gate with college IT) for bulk sends; upgrade trigger (cheapest): Resend Pro $20/mo only for the event month — **NOT Rs 0, so flagged as the one likely exception; user decides at human gate**.

## 6. Cron / jobs
- On the VM: **systemd timers** (email queue worker poll, keep-alive ping if any external pause risk, nightly encrypted pg_dump to R2, retention sweeps). No external cron service needed on the primary path. (Vercel/CF scheduled functions only used in fallback path.)

## 7. Monitoring
- UptimeRobot free (50 monitors, 5-min intervals) — **UNVERIFIED this session**; verify at deployment (P13) or swap for a Cloudflare Health Checks free tier (also UNVERIFIED). Plus in-app /health + /readyz + structured logs with request IDs (built in P3/P8).
- Sentry free tier (5k errors/mo) — UNVERIFIED this session; optional, non-blocking.

## 8. Domain
- Options: (a) college subdomain, e.g. `csh.srmtrp<something>.in` — requires college IT (gate; exact base domain is official college info we must NOT invent — UNVERIFIED); (b) own `.in` domain (NIC.in — institutional/educational pricing UNVERIFIED); (c) fallback `*.workers.dev` / `*.vercel.app` for staging only (not production).
- Exact DNS records (A/AAAA/CNAME/MX/SPF/DKIM/DMARC) will be emitted in DEPLOYMENT.md once real values exist (P13).

## 9. Capacity estimate vs limits (CSH DECISION math)
Assumptions: 3,000 accounts; 500 concurrent at deadline/finale peaks; event window ≈ 6 weeks; mobile-heavy (smaller payloads).
| Resource | Estimate | Limit (primary path) | Headroom |
|---|---|---|---|
| Requests | ~60k–100k/day on peak day (≈100 rps); ≈1–2M/month | No hard cap on VM (CPU-bound) | P12 load test gates |
| CPU/RAM | 500 concurrent on Next.js+PG | 2 OCPU / 8 GB always-free cap | Tight; mitigations: static public pages, pagination, response caching, pool=20, queue for heavy ops; upgrade trigger: sustained p95 > 1s under P12 load → PAYG 4 OCPU/24 GB for event days |
| DB size | < 300 MB (tables+indexes) | 200 GB block storage (UNVERIFIED current value) | ~1000× |
| Object storage | ~20 GB (docs) + ~2 GB (dumps ×14) | MinIO on VM (≈200 GB) + R2 10 GB | OK; R2 holds dumps + overflow, not all docs |
| Email/day | 300–1,500 on notification day vs 100/day (Resend free) | 100/day | **BROKEN by default** → queue spread + college SMTP fallback + possible one-month paid upgrade (human decision) |
| Email/month | ≤ 8,000 total | 3,000/month (Resend free) | BROKEN → same mitigations; worst case self-send via college SMTP (Rs 0) |
| Connections | pool 20 from single Node process | PG default max_connections 100 | OK |

## 10. Stack decision (resolves DECISIONS.md D4)
- **PRIMARY (production):** single always-on India-region VM (OCI Always Free Chennai **or** college IT server — whichever the human gate provides first) running: Caddy (TLS) → Next.js (Node 20) → Postgres 17 (localhost) + MinIO (localhost) + systemd timers. R2 for backups/overflow. Resend for email (queue-capped).
- **FALLBACK:** Cloudflare Workers+D1+R2 (adapter work ≈1 day), or Vercel Hobby for the public site + VM for API/DB.
- **STAGING/preview:** Vercel Hobby (free, non-commercial wording is fine for internal preview) or the VM itself.
- Cheapest upgrade paths recorded: OCI PAYG (same tenancy), Resend Pro (1 month), NIC `.in` domain (one-time), 4 OCPU/24 GB VM for finale week.
- **Human gate items arising from this file:** (1) OCI account (card-at-signup question), (2) college IT server + base domain + SMTP relay, (3) whether a one-month Resend Pro is acceptable. All will be consolidated in the single deployment gate (P13) — nothing is asked now beyond the GitHub access gate.
