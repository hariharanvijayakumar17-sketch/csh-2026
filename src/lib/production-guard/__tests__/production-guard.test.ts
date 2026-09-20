import { describe, expect, it } from "vitest";
import {
  checkDbAuth,
  checkEnv,
  classifyProbeError,
  runProductionGuard,
  KNOWN_DEFAULT_SESSION_SECRETS,
  KNOWN_DEFAULT_DB_PASSWORDS,
} from "..";

/**
 * P3 addendum item 5: the app must refuse to start in production when it
 * detects trust/no-password DB auth, dev-default DB credentials, default or
 * missing session secrets, or the demo seed. These unit tests cover the
 * pure-env checks (no DB); DB-level detection (empty-password probe,
 * demo_seed setting) is covered in src/integration/p3-addendum.test.ts.
 */

const GOOD = {
  NODE_ENV: "production",
  DATABASE_URL: "postgres://csh_app:S3cure-Random-Value-9f2a7c@db.internal:5432/csh2026",
  SESSION_SECRET: "0123456789abcdef0123456789abcdef01234567",
};

function envWith(over: Record<string, string | undefined>) {
  const base: Record<string, string> = { ...GOOD };
  for (const [k, v] of Object.entries(over)) {
    if (v === undefined) delete base[k];
    else base[k] = v;
  }
  return base;
}

describe("production guard: env checks (P3 addendum 5)", () => {
  it("development mode: never refuses (sandbox trust DB, dev creds are fine)", () => {
    const r = checkEnv(
      envWith({
        NODE_ENV: "development",
        DATABASE_URL: "postgres://csh_dev:***@127.0.0.1:5432/csh2026_dev",
      })
    );
    expect(r.ok).toBe(true);
    expect(r.failures).toEqual([]);
  });

  it("production: missing DATABASE_URL → refuse", () => {
    const r = checkEnv(envWith({ DATABASE_URL: undefined }));
    expect(r.ok).toBe(false);
    expect(r.failures.join(" ")).toMatch(/database/i);
  });

  it("production: loopback database host → refuse (dev DB shape)", () => {
    const r = checkEnv(
      envWith({
        DATABASE_URL: "postgres://csh_dev:***@127.0.0.1:5432/csh2026_dev",
      })
    );
    expect(r.ok).toBe(false);
    expect(r.failures.join(" ")).toMatch(/loopback|localhost|127\.0\.0\.1/);
  });

  it("production: missing/empty password in DATABASE_URL → refuse", () => {
    const r = checkEnv(
      envWith({ DATABASE_URL: "postgres://csh_app@db.internal:5432/csh2026" })
    );
    expect(r.ok).toBe(false);
    expect(r.failures.join(" ")).toMatch(/password/i);
  });

  it("production: known dev-default password → refuse", () => {
    expect(KNOWN_DEFAULT_DB_PASSWORDS).toContain("csh_dev_local_only");
    const r = checkEnv(
      envWith({
        DATABASE_URL: "postgres://csh_app:csh_dev_local_only@db.internal:5432/csh2026",
      })
    );
    expect(r.ok).toBe(false);
    expect(r.failures.join(" ")).toMatch(/default/i);
  });

  it("production: missing SESSION_SECRET → refuse", () => {
    const r = checkEnv(envWith({ SESSION_SECRET: undefined }));
    expect(r.ok).toBe(false);
    expect(r.failures.join(" ")).toMatch(/session/i);
  });

  it("production: default SESSION_SECRET → refuse", () => {
    const def = KNOWN_DEFAULT_SESSION_SECRETS[0];
    expect(typeof def).toBe("string");
    const r = checkEnv(envWith({ SESSION_SECRET: def }));
    expect(r.ok).toBe(false);
    expect(r.failures.join(" ")).toMatch(/default|session/i);
  });

  it("production: short SESSION_SECRET (<32 chars) → refuse", () => {
    const r = checkEnv(envWith({ SESSION_SECRET: "short-secret" }));
    expect(r.ok).toBe(false);
  });

  it("production: healthy values → ok", () => {
    const r = checkEnv(envWith({}));
    expect(r.ok).toBe(true);
    expect(r.failures).toEqual([]);
  });
});


describe("F9: empty-password probe is injectable; verdict mapping is pure", () => {
  it("accepted ⇒ fail-closed (trust/no-password auth detected)", async () => {
    const r = await checkDbAuth("postgres://u:***@db.internal:5432/x", async () => "accepted");
    expect(r.ok).toBe(false);
    expect(r.failures.join(" ")).toMatch(/no password|trust/i);
  });

  it("rejected ⇒ password auth enforced ⇒ ok", async () => {
    const r = await checkDbAuth("postgres://u:***@db.internal:5432/x", async () => "rejected");
    expect(r.ok).toBe(true);
    expect(r.failures).toEqual([]);
  });

  it("unreachable ⇒ no evidence of trust ⇒ ok, with a warning", async () => {
    const r = await checkDbAuth("postgres://u:***@db.internal:5432/x", async () => "unreachable");
    expect(r.ok).toBe(true);
    expect(r.warnings.join(" ")).toMatch(/unverified|reach/i);
  });

  it("classifies auth-rejection vs unreachable errors", () => {
    expect(classifyProbeError(new Error('password authentication failed for user "csh_app"'))).toBe("rejected");
    expect(classifyProbeError(new Error('FATAL:  no pg_hba.conf entry for host "1.2.3.4"'))).toBe("rejected");
    expect(classifyProbeError(new Error("connect ECONNREFUSED 1.2.3.4:5432"))).toBe("unreachable");
  });

  it("runProductionGuard (production env, injected probe): accepted ⇒ throws; rejected ⇒ passes the DB gate", async () => {
    const env = {
      NODE_ENV: "production",
      DATABASE_URL: "postgres://csh_app:S3cure-Random-Value-9f2a7c@db.internal:5432/csh2026",
      SESSION_SECRET: "0123456789abcdef0123456789abcdef01234567",
    };
    await expect(runProductionGuard({ env, probe: async () => "accepted" })).rejects.toThrow(/no password/i);
    // with a rejecting probe the DB gate passes; the demo-seed check needs a
    // live DB, so assert via checkDbAuth directly instead of a full run
    const r = await checkDbAuth(env.DATABASE_URL, async () => "rejected");
    expect(r.ok).toBe(true);
  });
});
