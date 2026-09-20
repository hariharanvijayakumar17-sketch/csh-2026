import "server-only";
import postgres from "postgres";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { settings } from "../db/schema";

/**
 * P3 addendum 5: production startup guard.
 *
 * The app REFUSES TO START when NODE_ENV=production and any of these is
 * detected (fail-closed):
 *   - DATABASE_URL missing, loopback host, missing/empty password, or a
 *     known dev-default password
 *   - trust / no-password database auth (detected by an EMPTY-PASSWORD
 *     PROBE connection: if a connection with no password succeeds, the
 *     server accepts no-password auth)
 *   - SESSION_SECRET missing, a known default, or shorter than 32 chars
 *   - the demo seed marker (settings.demo_seed = true)
 *
 * In development/preview the checks run but only WARN — the sandbox Postgres
 * uses loopback `trust` (SANDBOX-ONLY, documented in DECISIONS.md D14 and
 * docs/evidence/) and would otherwise block every dev session.
 */

export interface GuardReport {
  ok: boolean;
  failures: string[];
  warnings: string[];
}

export const KNOWN_DEFAULT_DB_PASSWORDS = ["csh_dev_local_only", "csh_dev", "postgres", "password"];
export const KNOWN_DEFAULT_SESSION_SECRETS = [
  "dev-session-secret-csh2026",
  "changeme",
  "secret",
  "supersecret",
];

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

/** Pure env checks (unit-testable, no DB). */
export function checkEnv(env: Record<string, string | undefined>): {
  ok: boolean;
  failures: string[];
} {
  if (env.NODE_ENV !== "production") return { ok: true, failures: [] };
  const failures: string[] = [];

  const url = env.DATABASE_URL;
  if (!url) {
    failures.push("production: DATABASE_URL is missing");
  } else {
    let u: URL | undefined;
    try {
      u = new URL(url);
    } catch {
      failures.push("production: DATABASE_URL is not a valid URL");
    }
    if (u) {
      if (LOOPBACK_HOSTS.has(u.hostname)) {
        failures.push(`production: database host is loopback (${u.hostname}) — dev DB shape`);
      }
      if (!u.password) {
        failures.push("production: DATABASE_URL has no password");
      } else if (KNOWN_DEFAULT_DB_PASSWORDS.includes(u.password)) {
        failures.push("production: DATABASE_URL uses a known dev-default password");
      }
    }
  }

  const secret = env.SESSION_SECRET;
  if (!secret) failures.push("production: SESSION_SECRET is missing");
  else if (KNOWN_DEFAULT_SESSION_SECRETS.includes(secret)) {
    failures.push("production: SESSION_SECRET is a known default value");
  } else if (secret.length < 32) {
    failures.push("production: SESSION_SECRET is shorter than 32 characters");
  }

  return { ok: failures.length === 0, failures };
}

/**
 * Detect trust/no-password DB auth: attempt a real connection with an EMPTY
 * password. Success ⇒ the server grants access without a password ⇒ refuse
 * in production. A normal SCRAM server rejects the probe (expected).
 */
export async function checkDbAuth(databaseUrl: string | undefined): Promise<GuardReport> {
  if (!databaseUrl) return { ok: true, failures: [], warnings: [] };
  let u: URL;
  try {
    u = new URL(databaseUrl);
  } catch {
    return { ok: false, failures: ["cannot parse DATABASE_URL for auth probe"], warnings: [] };
  }
  u.password = "";
  const probe = postgres(u.toString(), { max: 1, connect_timeout: 3 });
  try {
    await probe`select 1`;
    return {
      ok: false,
      failures: [
        "production: database accepted a connection with NO password (trust/no-password auth)",
      ],
      warnings: [],
    };
  } catch {
    // probe rejected → password auth is enforced
    return { ok: true, failures: [], warnings: [] };
  } finally {
    await probe.end();
  }
}

/** Demo seed marker check (runs against the live DB). */
export async function checkDemoSeed(): Promise<GuardReport> {
  const rows = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, "demo_seed"))
    .limit(1);
  if (rows[0]?.value === true || rows[0]?.value === "true") {
    return {
      ok: false,
      failures: ["production: demo seed data present (settings.demo_seed)"],
      warnings: [],
    };
  }
  return { ok: true, failures: [], warnings: [] };
}

export class ProductionGuardError extends Error {
  constructor(failures: string[]) {
    super(`production startup guard refused to start: ${failures.join("; ")}`);
    this.name = "ProductionGuardError";
  }
}

export interface GuardOptions {
  env?: Record<string, string | undefined>;
  /** run the empty-password DB auth probe (default: only in production) */
  checkDb?: boolean;
}

export async function runProductionGuard(opts: GuardOptions = {}): Promise<GuardReport> {
  const env = opts.env ?? (process.env as Record<string, string | undefined>);
  const isProd = env.NODE_ENV === "production";
  const report: GuardReport = { ok: true, failures: [], warnings: [] };

  report.failures.push(...checkEnv(env).failures);

  if (isProd || opts.checkDb) {
    const dbReport = await checkDbAuth(env.DATABASE_URL);
    (isProd ? report.failures : report.warnings).push(...dbReport.failures);
    if (isProd) {
      const seedReport = await checkDemoSeed();
      report.failures.push(...seedReport.failures);
    }
  }

  report.ok = report.failures.length === 0;
  if (isProd && !report.ok) throw new ProductionGuardError(report.failures);
  return report;
}
