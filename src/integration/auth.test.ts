import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { eq, sql } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { hashPassword } from "@/lib/auth/password";
import {
  createSession,
  resolveSession,
  revokeAllSessions,
  revokeSession,
  rotateSessions,
} from "@/lib/auth/sessions";
import { login } from "@/lib/auth/login";
import { seedDefaultSettings } from "@/lib/settings";
import {
  consumeVerificationToken,
  issueVerificationToken,
} from "@/lib/auth/email-verify";
import { confirmReset, requestResetToken } from "@/lib/auth/password-reset";
import { rateLimit } from "@/lib/rate-limit";

/**
 * P3 integration: auth flows against REAL Postgres (S7/S8/S9).
 * Each test uses a unique IP so rate-limit buckets never collide.
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
  return `10.99.${(seq % 200)}.${seq}`;
}
async function makeUser(email: string, pw: string, role = "participant") {
  const hash = await hashPassword(pw);
  const rows = await db
    .insert(schema.users)
    .values({ email, passwordHash: hash, fullName: "Test User", role: role as never })
    .returning({ id: schema.users.id });
  return rows[0].id;
}

describe("S9 sessions: hashed, revocable, rotated", () => {
  it("create + resolve by token only; wrong token rejected", async () => {
    const uid = await makeUser(`s1.${Date.now()}@t.io`, "Passw0rd!xyz");
    const s = await createSession(uid, { ip: ip() });
    const resolved = await resolveSession(s.token);
    expect(resolved?.user.id).toBe(uid);
    expect(await resolveSession("deadbeef".repeat(8))).toBeNull();
    expect(await resolveSession(undefined)).toBeNull();
  });

  it("revoked and expired sessions are rejected", async () => {
    const uid = await makeUser(`s2.${Date.now()}@t.io`, "Passw0rd!xyz");
    const s = await createSession(uid);
    await revokeSession(s.id);
    expect(await resolveSession(s.token)).toBeNull();
    const s2 = await createSession(uid);
    // force expiry
    await raw`update user_sessions set expires_at = now() - interval '1 minute' where id = ${s2.id}`;
    expect(await resolveSession(s2.token)).toBeNull();
  });

  it("revokeAllSessions kills every session (S7)", async () => {
    const uid = await makeUser(`s3.${Date.now()}@t.io`, "Passw0rd!xyz");
    const a = await createSession(uid);
    const b = await createSession(uid);
    const n = await revokeAllSessions(uid);
    expect(n).toBe(2);
    expect(await resolveSession(a.token)).toBeNull();
    expect(await resolveSession(b.token)).toBeNull();
  });

  it("rotateSessions invalidates old tokens and yields a new one (S9)", async () => {
    const uid = await makeUser(`s4.${Date.now()}@t.io`, "Passw0rd!xyz");
    const old = await createSession(uid);
    const fresh = await rotateSessions(uid);
    expect(await resolveSession(old.token)).toBeNull();
    expect((await resolveSession(fresh.token))?.user.id).toBe(uid);
  });
});

describe("S7 login: lockout, non-enumeration, per-IP rate limit", () => {
  it("successful login returns a session; user record updated", async () => {
    const email = `ok.${Date.now()}@t.io`;
    await makeUser(email, "Passw0rd!xyz");
    const res = await login({ email, password: "Passw0rd!xyz", clientIp: ip() });
    expect(res.status).toBe("ok");
    if (res.status !== "ok") throw new Error("unreachable");
    expect((await resolveSession(res.session.token))?.user.email.toLowerCase()).toBe(
      email.toLowerCase()
    );
  });

  it("unknown email and wrong password return the SAME result (non-enumerating)", async () => {
    await makeUser(`ex.${Date.now()}@t.io`, "Passw0rd!xyz");
    const a = await login({
      email: `ghost.${Date.now()}@t.io`,
      password: "whatever123!",
      clientIp: ip(),
    });
    const b = await login({
      email: `ex.${Date.now()}@t.io`,
      password: "wrongpass999!",
      clientIp: ip(),
    });
    expect(a.status).toBe("invalid_credentials");
    expect(b.status).toBe("invalid_credentials");
  });

  // NOTE (P3 addendum 2): the old hard 5-fail/15-min account lockout was
  // replaced by progressive delay keyed on (account, client IP) — covered in
  // src/integration/p3-addendum.test.ts ("item 2" suite).

  it("per-ACCOUNT rate limit (strict, settings-driven) rejects beyond the window", async () => {
    const email = `rl.${Date.now()}@t.io`;
    await makeUser(email, "Passw0rd!xyz");
    let last: { status: string } = { status: "" };
    for (let i = 0; i < 11; i++) {
      last = (await login({ email, password: "x", clientIp: ip() })) as { status: string };
    }
    // 11 attempts on one account (fresh IP each time — IP limit is generous)
    expect(last.status).toBe("rate_limited");
  });
});

describe("S8 rate limiter: spoofed XFF cannot bypass (trustedProxyCount=0)", () => {
  it("all buckets key on the socket address, not the header", async () => {
    const socket = "10.55.0.1";
    // attacker rotates fake XFF values; derivation must return socket each time
    const { deriveClientIp } = await import("@/lib/rate-limit/ip");
    expect(deriveClientIp("1.1.1.1", 0, socket)).toBe(socket);
    expect(deriveClientIp("2.2.2.2", 0, socket)).toBe(socket);
    // and the limiter counts them in ONE bucket (unique scope per run)
    const scope = `spoof-test-${Date.now()}`;
    for (let i = 0; i < 5; i++) {
      const r = await rateLimit(scope, deriveClientIp(`${i}.${i}.0.1`, 0, socket), 5, 60);
      expect(r.allowed).toBe(true);
      expect(r.remaining).toBe(4 - i);
    }
    const r6 = await rateLimit(scope, deriveClientIp("9.9.9.9", 0, socket), 5, 60);
    expect(r6.allowed).toBe(false);
    expect(r6.retryAfterSec).toBeGreaterThan(0);
  });
});

describe("S7 email verification: hashed, expiring, single-use", () => {
  it("verify marks user verified; token single-use; expired rejected", async () => {
    const uid = await makeUser(`v1.${Date.now()}@t.io`, "Passw0rd!xyz");
    const token = await issueVerificationToken(uid);
    // not verified before consuming
    const before = await db
      .select({ v: schema.users.emailVerifiedAt })
      .from(schema.users)
      .where(eq(schema.users.id, uid));
    expect(before[0].v).toBeNull();

    const r1 = await consumeVerificationToken(token);
    expect(r1.status).toBe("verified");
    const after = await db
      .select({ v: schema.users.emailVerifiedAt })
      .from(schema.users)
      .where(eq(schema.users.id, uid));
    expect(after[0].v).not.toBeNull();

    // single-use: replay rejected
    expect((await consumeVerificationToken(token)).status).toBe("invalid");

    // expired token rejected
    const uid2 = await makeUser(`v2.${Date.now()}@t.io`, "Passw0rd!xyz");
    const token2 = await issueVerificationToken(uid2);
    await raw`update email_verification_tokens set expires_at = now() - interval '1 minute' where user_id = ${uid2}`;
    expect((await consumeVerificationToken(token2)).status).toBe("invalid");
  });
});

describe("S7 password reset: single-use, strength, revokes all sessions", () => {
  it("reset flow changes password and revokes every session", async () => {
    const email = `r1.${Date.now()}@t.io`;
    await makeUser(email, "OldPassw0rd!1");
    const { token } = await requestResetToken(email);
    expect(token).toBeTruthy();

    const active = await createSession(
      (
        await db
          .select({ id: schema.users.id })
          .from(schema.users)
          .where(eq(sql`lower(${schema.users.email})`, email))
      )[0].id
    );
    expect(await resolveSession(active.token)).not.toBeNull();

    // weak password rejected (S6 strength rules)
    expect((await confirmReset(token!, "weak")).status).toBe("weak_password");

    const r = await confirmReset(token!, "NewPassw0rd!1");
    expect(r.status).toBe("ok");
    // old sessions revoked (S7)
    expect(await resolveSession(active.token)).toBeNull();
    // old password no longer works, new one does
    expect(
      (await login({ email, password: "OldPassw0rd!1", clientIp: ip() })).status
    ).toBe("invalid_credentials");
    expect(
      (await login({ email, password: "NewPassw0rd!1", clientIp: ip() })).status
    ).toBe("ok");
    // token single-use
    expect((await confirmReset(token!, "AnotherPass1!x")).status).toBe("invalid");
  });

  it("unknown email: no token issued, response identical (non-enumerating)", async () => {
    const r = await requestResetToken(`nobody.${Date.now()}@t.io`);
    expect(r.token).toBeNull();
  });
});
