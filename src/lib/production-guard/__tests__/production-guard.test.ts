import { describe, expect, it } from "vitest";
import {
  checkEnv,
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
