import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { hashPassword } from "@/lib/auth/password";
import { login } from "@/lib/auth/login";
import {
  getNumberSetting,
  invalidateSettingsCache,
  setSetting,
  seedDefaultSettings,
} from "@/lib/settings";
import { activateRound } from "@/lib/eval/rounds";
import { checkDbAuth, checkDemoSeed, runProductionGuard } from "@/lib/production-guard";
import { runDemoSeed } from "@/lib/db/seed";

/**
 * P3 ADDENDUM tests (all written failing-first, 2026-09-20):
 *  1. IP rate limits generous + configurable in `settings` (per-account stays strict)
 *  2. progressive delay keyed on account+IP (attacker slowed, legitimate IP not)
 *  4. round criteria weights must sum to exactly 100 at activation
 *  5. production guard: trust/no-password DB detection + demo seed + startup refusal
 */

const TEST_URL =
  process.env.DATABASE_URL_TEST ??
  "postgres://csh_dev:***@127.0.0.1:5432/csh2026_test";

let raw: postgres.Sql;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  const admin = postgres(TEST_URL, { max: 1 });
  await admin`drop schema if exists drizzle cascade`;
  await admin`drop schema if exists public cascade`;
  await admin`create schema public`;
  await admin.end();
  raw = postgres(TEST_URL, { max: 10 });
  db = drizzle(raw, { schema });
  await migrate(db, { migrationsFolder: "./drizzle" });
  await seedDefaultSettings();
}, 120000);

afterAll(async () => {
  await raw?.end();
});

let seq = 0;
function ip() {
  seq += 1;
  return `10.88.${(seq % 200)}.${seq}`;
}
async function makeUser(email: string, pw: string) {
  const hash = await hashPassword(pw);
  const rows = await db
    .insert(schema.users)
    .values({ email, passwordHash: hash, fullName: "Addendum Test", role: "participant" })
    .returning({ id: schema.users.id, email: schema.users.email });
  return rows[0];
}
async function setSettingRaw(key: string, value: unknown) {
  await setSetting(key, value);
  invalidateSettingsCache();
}

describe("item 1: rate limits generous + configurable in settings", () => {
  it("defaults are seeded: IP limit generous (60/min), account limit strict (10/min)", async () => {
    expect(await getNumberSetting("ratelimit.login.ip_per_min", 0)).toBe(60);
    expect(await getNumberSetting("ratelimit.login.account_per_min", 0)).toBe(10);
  });

  it("admin can change limits at runtime (not hard-coded)", async () => {
    await setSettingRaw("ratelimit.login.account_per_min", 4);
    expect(await getNumberSetting("ratelimit.login.account_per_min", 99)).toBe(4);
    await setSettingRaw("ratelimit.login.account_per_min", 10);
    expect(await getNumberSetting("ratelimit.login.account_per_min", 99)).toBe(10);
  });

  it("per-ACCOUNT limit is strict and independent of IP", async () => {
    await setSettingRaw("ratelimit.login.account_per_min", 3);
    const u = await makeUser(`acc.${Date.now()}@t.io`, "Passw0rd!xyz");
    for (let i = 0; i < 3; i++) {
      await login({ email: u.email, password: "nope-123", clientIp: ip() });
    }
    const r4 = await login({ email: u.email, password: "nope-123", clientIp: ip() });
    // fresh IP does NOT reset the per-account bucket
    expect(r4.status).toBe("rate_limited");
    await setSettingRaw("ratelimit.login.account_per_min", 10);
  });

  it("per-IP limit is the generous one (campus NAT safe)", async () => {
    await setSettingRaw("ratelimit.login.ip_per_min", 4);
    const u = await makeUser(`ipl.${Date.now()}@t.io`, "Passw0rd!xyz");
    const myIp = ip();
    for (let i = 0; i < 4; i++) {
      await login({ email: u.email, password: "Passw0rd!xyz", clientIp: myIp });
    }
    const r5 = await login({ email: u.email, password: "Passw0rd!xyz", clientIp: myIp });
    expect(r5.status).toBe("rate_limited");
    // a different account from the SAME IP still has its own budget... but the
    // IP bucket is exhausted for the window:
    const u2 = await makeUser(`ipl2.${Date.now()}@t.io`, "Passw0rd!xyz");
    const r = await login({ email: u2.email, password: "Passw0rd!xyz", clientIp: myIp });
    expect(r.status).toBe("rate_limited");
    await setSettingRaw("ratelimit.login.ip_per_min", 60);
  });
});

describe("item 2: progressive delay keyed on account+IP (no cross-IP lockout)", () => {
  it("attacker IP is progressively slowed; legitimate IP is NOT", async () => {
    const u = await makeUser(`delay.${Date.now()}@t.io`, "Passw0rd!xyz");
    const attacker = ip();
    // 3 wrong attempts from the attacker IP
    for (let i = 0; i < 3; i++) {
      const r = await login({ email: u.email, password: "bad-pass-1", clientIp: attacker });
      expect(r.status).toBe("invalid_credentials");
    }
    // 4th attempt from the attacker IP: now slowed — even with the RIGHT password
    const r4 = await login({ email: u.email, password: "Passw0rd!xyz", clientIp: attacker });
    expect(r4.status).toBe("slowed");
    if (r4.status === "slowed") expect(r4.retryAfterSec).toBeGreaterThan(0);

    // legitimate IP: completely unaffected — immediate success
    const legit = await login({ email: u.email, password: "Passw0rd!xyz", clientIp: ip() });
    expect(legit.status).toBe("ok");

    // attacker still slowed after the legit success
    const r5 = await login({ email: u.email, password: "Passw0rd!xyz", clientIp: attacker });
    expect(r5.status).toBe("slowed");
  });

  it("delay expires and success resets the counter for that (account, IP)", async () => {
    const u = await makeUser(`delay2.${Date.now()}@t.io`, "Passw0rd!xyz");
    const attacker = ip();
    for (let i = 0; i < 3; i++) {
      await login({ email: u.email, password: "bad-pass-2", clientIp: attacker });
    }
    expect((await login({ email: u.email, password: "Passw0rd!xyz", clientIp: attacker })).status).toBe(
      "slowed"
    );
    // expire the delay window
    await raw`update login_delays set delay_until = now() - interval '1 second'`;
    const ok = await login({ email: u.email, password: "Passw0rd!xyz", clientIp: attacker });
    expect(ok.status).toBe("ok");
    // counter reset: two more failures must NOT re-delay immediately
    for (let i = 0; i < 2; i++) {
      const r = await login({ email: u.email, password: "bad-pass-3", clientIp: attacker });
      expect(r.status).toBe("invalid_credentials");
    }
  });
});

describe("item 4: round criteria weights must sum to exactly 100 at activation", () => {
  async function makeRoundWithCriteria(name: string, weights: number[]) {
    const [round] = await db
      .insert(schema.rounds)
      .values({ name, ordinal: 100 + Math.floor(Math.random() * 900) })
      .returning({ id: schema.rounds.id });
    for (let i = 0; i < weights.length; i++) {
      await db.insert(schema.roundCriteria).values({
        roundId: round.id,
        name: `c${i}`,
        weight: String(weights[i]),
        ordinal: i + 1,
      });
    }
    return round.id;
  }

  it("weights summing to 90 → NOT activatable, round stays draft", async () => {
    const id = await makeRoundWithCriteria("bad-90", [40, 30, 20]);
    const r = await activateRound(id);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("weights_sum_100");
      expect(r.detail).toMatch(/100/);
    }
    const [row] = await db.select().from(schema.rounds).where(eq(schema.rounds.id, id));
    expect(row.status).toBe("draft");
  });

  it("weights summing to 105 → NOT activatable", async () => {
    const id = await makeRoundWithCriteria("bad-105", [60, 45]);
    const r = await activateRound(id);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("weights_sum_100");
  });

  it("no criteria → NOT activatable", async () => {
    const [round] = await db
      .insert(schema.rounds)
      .values({ name: "empty", ordinal: 555 })
      .returning({ id: schema.rounds.id });
    const r = await activateRound(round.id);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("no_criteria");
  });

  it("weights summing to exactly 100 → activates", async () => {
    const id = await makeRoundWithCriteria("good-100", [50, 30, 20]);
    const r = await activateRound(id);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const [row] = await db.select().from(schema.rounds).where(eq(schema.rounds.id, id));
      expect(row.status).toBe("active");
    }
  });

  it("fractional weights are honoured (33.33+33.33+33.34 = 100)", async () => {
    const id = await makeRoundWithCriteria("frac", [33.33, 33.33, 33.34]);
    const r = await activateRound(id);
    expect(r.ok).toBe(true);
  });
});

describe("item 5: production guard DB checks (trust auth, demo seed, refusal)", () => {
  it("F9: probe verdict mapping is environment-independent (injected probe)", async () => {
    // The test DB may run trust (sandbox) OR SCRAM (a properly configured
    // Postgres) — the suite must not assume which. The GUARD's behaviour for
    // each probe outcome is what we assert, with an injected probe.
    const accepted = await checkDbAuth(TEST_URL, async () => "accepted");
    expect(accepted.ok).toBe(false);
    expect(accepted.failures.join(" ")).toMatch(/trust|no-password/i);
    const rejected = await checkDbAuth(TEST_URL, async () => "rejected");
    expect(rejected.ok).toBe(true);
    expect(rejected.failures).toEqual([]);
    const unreachable = await checkDbAuth(TEST_URL, async () => "unreachable");
    expect(unreachable.ok).toBe(true);
    expect(unreachable.warnings.length).toBeGreaterThan(0);
  });

  it("F9: the real probe runs against the test DB without throwing (any auth mode)", async () => {
    // env-agnostic smoke: whatever the test Postgres is configured with,
    // the real network probe returns a well-formed report and never throws
    const r = await checkDbAuth(TEST_URL);
    expect(typeof r.ok).toBe("boolean");
    expect(Array.isArray(r.failures)).toBe(true);
    expect(Array.isArray(r.warnings)).toBe(true);
  });

  it("probe failure path: unreachable server → no evidence of trust (probe fails cleanly)", async () => {
    const unreachable = TEST_URL.replace("127.0.0.1:5432", "127.0.0.1:59999");
    const r = await checkDbAuth(unreachable);
    // probe failed to connect (expected) → the guard cannot PROVE trust → ok
    expect(r.ok).toBe(true);
  });

  it("demo seed marker: absent → ok; after runDemoSeed → detected", async () => {
    expect((await checkDemoSeed()).ok).toBe(true);
    await runDemoSeed(TEST_URL);
    const r = await checkDemoSeed();
    expect(r.ok).toBe(false);
    expect(r.failures.join(" ")).toMatch(/demo/i);
    // cleanup for later suites
    await db.delete(schema.settings).where(eq(schema.settings.key, "demo_seed"));
  });

  it("runProductionGuard: production + sandbox env → THROWS; development → never throws", async () => {
    const prodEnv = {
      NODE_ENV: "production",
      DATABASE_URL: TEST_URL, // trust auth + loopback + dev password → all detected
      SESSION_SECRET: "x".repeat(40),
    };
    await expect(runProductionGuard({ env: prodEnv })).rejects.toThrow(
      /production/i
    );
    const devReport = await runProductionGuard({
      env: { ...prodEnv, NODE_ENV: "development" },
    });
    expect(devReport.ok).toBe(true);
    expect(devReport.failures).toEqual([]);
  });
});
