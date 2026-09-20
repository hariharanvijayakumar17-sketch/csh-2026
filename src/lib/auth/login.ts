import "server-only";
import { eq, and, sql } from "drizzle-orm";
import { db } from "../db/client";
import { loginDelays, users } from "../db/schema";
import { dummyVerify, verifyPassword } from "./password";
import { createSession, type SessionInfo } from "./sessions";
import { rateLimit } from "../rate-limit";
import { getNumberSetting } from "../settings";
import { writeAudit } from "../audit";

/**
 * Login — P3 addendum 2 (progressive delay) + addendum 1 (configurable limits):
 *
 * - per-CLIENT-IP rate limit: GENEROUS default 60/min (campus NAT) — from settings
 * - per-ACCOUNT rate limit: STRICT default 10/min — from settings
 * - progressive DELAY keyed on (account, client IP): 3 failures → 30 s,
 *   doubling per further failure, capped at 30 min. A stranger failing
 *   logins from IP B slows only (account, B); the user's own IP is untouched
 *   → no cross-IP self-DoS (replaces the old hard 5-fail/15-min lockout).
 * - unknown email: dummy scrypt compare (S7 non-enumeration, timing equal)
 * - success resets the (account, IP) delay counter
 */

export const DELAY_MIN_FAILURES = 3;
export const DELAY_BASE_SEC = 30;
export const DELAY_CAP_SEC = 30 * 60;

export type LoginResult =
  | { status: "ok"; session: SessionInfo; user: { id: string; role: string; email: string } }
  | { status: "invalid_credentials" }
  | { status: "slowed"; retryAfterSec: number }
  | { status: "rate_limited"; retryAfterSec: number };

/** 3→30 s, 4→60 s, 5→2 min … capped at 30 min. */
export function delaySecForFailure(n: number): number {
  if (n < DELAY_MIN_FAILURES) return 0;
  return Math.min(DELAY_CAP_SEC, DELAY_BASE_SEC * 2 ** (n - DELAY_MIN_FAILURES));
}

export async function login(
  input: {
    email: string;
    password: string;
    clientIp: string;
    userAgent?: string | null;
    requestId?: string | null;
  },
  defaults: { ipPerMinute: number; accountPerMinute: number } = {
    ipPerMinute: 60,
    accountPerMinute: 10,
  }
): Promise<LoginResult> {
  const ipLimit = await getNumberSetting("ratelimit.login.ip_per_min", defaults.ipPerMinute);
  const rlIp = await rateLimit("login-ip", input.clientIp, ipLimit, 60);
  if (!rlIp.allowed) return { status: "rate_limited", retryAfterSec: rlIp.retryAfterSec };

  const email = input.email.trim().toLowerCase();
  const acctLimit = await getNumberSetting(
    "ratelimit.login.account_per_min",
    defaults.accountPerMinute
  );
  const rlAcct = await rateLimit("login-acct", email, acctLimit, 60);
  if (!rlAcct.allowed) return { status: "rate_limited", retryAfterSec: rlAcct.retryAfterSec };

  const found = await db
    .select()
    .from(users)
    .where(and(eq(sql`lower(${users.email})`, email), sql`deleted_at is null`))
    .limit(1);
  const user = found[0];

  if (!user) {
    await dummyVerify(input.password); // S7 timing equalisation
    return { status: "invalid_credentials" };
  }

  const [delay] = await db
    .select()
    .from(loginDelays)
    .where(and(eq(loginDelays.userId, user.id), eq(loginDelays.clientIp, input.clientIp)))
    .limit(1);
  if (delay?.delayUntil && delay.delayUntil.getTime() > Date.now()) {
    await writeAudit({
      action: "auth.login_slowed",
      actorUserId: user.id,
      actorIp: input.clientIp,
      requestId: input.requestId ?? null,
      metadata: { retryAfterSec: Math.ceil((delay.delayUntil.getTime() - Date.now()) / 1000) },
    });
    return {
      status: "slowed",
      retryAfterSec: Math.max(1, Math.ceil((delay.delayUntil.getTime() - Date.now()) / 1000)),
    };
  }

  const okPw = await verifyPassword(input.password, user.passwordHash);
  if (!okPw) {
    const attempts = (delay?.failedAttempts ?? 0) + 1;
    const delaySec = delaySecForFailure(attempts);
    await db
      .insert(loginDelays)
      .values({
        userId: user.id,
        clientIp: input.clientIp,
        failedAttempts: attempts,
        delayUntil:
          delaySec > 0 ? new Date(Date.now() + delaySec * 1000) : delay?.delayUntil ?? null,
      })
      .onConflictDoUpdate({
        target: [loginDelays.userId, loginDelays.clientIp],
        set: {
          failedAttempts: attempts,
          delayUntil:
            delaySec > 0 ? sql`now() + make_interval(secs => ${delaySec})` : sql`null`,
          updatedAt: sql`now()`,
        },
      });
    await writeAudit({
      action: "auth.login_failed",
      actorUserId: user.id,
      actorIp: input.clientIp,
      requestId: input.requestId ?? null,
      metadata: { attempts, delaySec },
    });
    return { status: "invalid_credentials" };
  }

  // success: reset the (account, IP) counter
  await db
    .delete(loginDelays)
    .where(and(eq(loginDelays.userId, user.id), eq(loginDelays.clientIp, input.clientIp)));
  const session = await createSession(user.id, {
    userAgent: input.userAgent,
    ip: input.clientIp,
  });
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
  await writeAudit({
    action: "auth.login_success",
    actorUserId: user.id,
    actorIp: input.clientIp,
    requestId: input.requestId ?? null,
  });
  return {
    status: "ok",
    session,
    user: { id: user.id, role: user.role, email: user.email },
  };
}
