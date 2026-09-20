import "server-only";
import { eq, and, isNull, sql } from "drizzle-orm";
import { db } from "../db/client";
import { loginDelays, passwordResetTokens, users } from "../db/schema";
import { generateToken, hashToken } from "./tokens";
import { hashPassword, passwordStrengthIssues } from "./password";
import { revokeAllSessions } from "./sessions";
import { dummyVerify } from "./password";
import { writeAudit } from "../audit";

/**
 * Password reset (brief S7): hashed, expiring, single-use; confirmation
 * REVOKES ALL EXISTING SESSIONS. Non-enumerating: requests for unknown
 * emails perform dummy work and report success-without-token identically.
 */

const TTL_MS = 60 * 60 * 1000; // 60 minutes

export async function requestResetToken(email: string): Promise<{ token: string | null }> {
  const norm = email.trim().toLowerCase();
  const found = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(sql`lower(${users.email})`, norm))
    .limit(1);
  const user = found[0];
  if (!user) {
    await dummyVerify("timing-equalisation");
    return { token: null }; // handler still answers "if it exists, check your email"
  }
  const { token, tokenHash } = generateToken();
  await db.insert(passwordResetTokens).values({
    userId: user.id,
    tokenHash,
    expiresAt: new Date(Date.now() + TTL_MS),
  });
  return { token };
}

export type ResetConfirmResult =
  | { status: "ok" }
  | { status: "invalid" }
  | { status: "weak_password"; issues: string[] };

export async function confirmReset(
  token: string,
  newPassword: string,
  requestId?: string | null
): Promise<ResetConfirmResult> {
  const rows = await db
    .select()
    .from(passwordResetTokens)
    .where(eq(passwordResetTokens.tokenHash, hashToken(token)))
    .limit(1);
  const row = rows[0];
  if (!row || row.usedAt || row.expiresAt.getTime() < Date.now()) {
    await dummyVerify(newPassword);
    return { status: "invalid" };
  }
  const issues = passwordStrengthIssues(newPassword);
  if (issues.length > 0) return { status: "weak_password", issues };

  const used = await db
    .update(passwordResetTokens)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(passwordResetTokens.id, row.id),
        isNull(passwordResetTokens.usedAt)
      )
    )
    .returning({ id: passwordResetTokens.id });
  if (used.length === 0) return { status: "invalid" };

  const hash = await hashPassword(newPassword);
  await db
    .update(users)
    .set({ passwordHash: hash })
    .where(eq(users.id, row.userId));
  // clear any progressive login delays for this account
  await db.delete(loginDelays).where(eq(loginDelays.userId, row.userId));
  const revoked = await revokeAllSessions(row.userId); // S7: reset revokes all sessions
  await writeAudit({
    action: "auth.password_reset",
    actorUserId: row.userId,
    requestId: requestId ?? null,
    metadata: { sessionsRevoked: revoked },
  });
  return { status: "ok" };
}
