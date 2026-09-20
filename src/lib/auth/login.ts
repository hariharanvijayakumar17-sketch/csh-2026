import "server-only";
import { eq, and, sql } from "drizzle-orm";
import { db } from "../db/client";
import { users } from "../db/schema";
import { dummyVerify, verifyPassword } from "./password";
import { createSession, type SessionInfo } from "./sessions";
import { rateLimit } from "../rate-limit";
import { writeAudit } from "../audit";

/**
 * Login (brief S7/S8):
 * - per-IP rate limit via trusted-proxy-derived IP (never raw XFF)
 * - per-account lockout: MAX_FAILURES wrong passwords → LOCK_MINUTES
 * - unknown email performs a dummy scrypt compare (timing equalisation)
 * - non-enumerating: unknown email and wrong password return the SAME result
 */

export const MAX_FAILURES = 5;
export const LOCK_MINUTES = 15;

export type LoginResult =
  | { status: "ok"; session: SessionInfo; user: { id: string; role: string; email: string } }
  | { status: "invalid_credentials" }
  | { status: "locked"; retryAfterMin: number }
  | { status: "rate_limited"; retryAfterSec: number };

export async function login(
  input: {
    email: string;
    password: string;
    clientIp: string;
    userAgent?: string | null;
    requestId?: string | null;
  },
  limits: { perIpPerMinute: number } = { perIpPerMinute: 10 }
): Promise<LoginResult> {
  const rl = await rateLimit(
    "login",
    input.clientIp,
    limits.perIpPerMinute,
    60
  );
  if (!rl.allowed) return { status: "rate_limited", retryAfterSec: rl.retryAfterSec };

  const email = input.email.trim().toLowerCase();
  const found = await db
    .select()
    .from(users)
    .where(and(eq(sql`lower(${users.email})`, email), sql`deleted_at is null`))
    .limit(1);
  const user = found[0];

  if (!user) {
    // Timing equalisation (S7): real scrypt work even for unknown emails.
    await dummyVerify(input.password);
    return { status: "invalid_credentials" };
  }

  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    return {
      status: "locked",
      retryAfterMin: Math.max(1, Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000)),
    };
  }

  const okPw = await verifyPassword(input.password, user.passwordHash);
  if (!okPw) {
    const attempts = user.failedAttempts + 1;
    const lockNow = attempts >= MAX_FAILURES;
    await db
      .update(users)
      .set({
        failedAttempts: lockNow ? 0 : attempts,
        lockedUntil: lockNow ? new Date(Date.now() + LOCK_MINUTES * 60000) : null,
      })
      .where(eq(users.id, user.id));
    await writeAudit({
      action: lockNow ? "auth.account_locked" : "auth.login_failed",
      actorUserId: user.id,
      actorIp: input.clientIp,
      requestId: input.requestId ?? null,
      metadata: { attempts },
    });
    return { status: "invalid_credentials" };
  }

  if (user.failedAttempts > 0) {
    await db.update(users).set({ failedAttempts: 0 }).where(eq(users.id, user.id));
  }
  const session = await createSession(user.id, {
    userAgent: input.userAgent,
    ip: input.clientIp,
  });
  await db
    .update(users)
    .set({ lastLoginAt: new Date() })
    .where(eq(users.id, user.id));
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
