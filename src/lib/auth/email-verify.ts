import "server-only";
import { eq, and, isNull } from "drizzle-orm";
import { db } from "../db/client";
import { emailVerificationTokens, users } from "../db/schema";
import { generateToken, hashToken } from "./tokens";
import { writeAudit } from "../audit";

/**
 * Real email verification (brief S7): hashed, expiring, single-use token.
 * A user is NOT marked verified at sign-up (S7).
 */

const TTL_MS = 30 * 60 * 1000; // 30 minutes

export async function issueVerificationToken(userId: string): Promise<string> {
  const { token, tokenHash } = generateToken();
  await db.insert(emailVerificationTokens).values({
    userId,
    tokenHash,
    expiresAt: new Date(Date.now() + TTL_MS),
  });
  return token; // returned to the email layer ONLY (never logged)
}

export type VerifyResult =
  | { status: "verified"; userId: string }
  | { status: "invalid" };

export async function consumeVerificationToken(
  token: string,
  requestId?: string | null
): Promise<VerifyResult> {
  const rows = await db
    .select()
    .from(emailVerificationTokens)
    .where(eq(emailVerificationTokens.tokenHash, hashToken(token)))
    .limit(1);
  const row = rows[0];
  if (!row || row.usedAt || row.expiresAt.getTime() < Date.now()) {
    return { status: "invalid" };
  }
  // Single-use: mark used and verify in one update, then flip the user.
  const used = await db
    .update(emailVerificationTokens)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(emailVerificationTokens.id, row.id),
        isNull(emailVerificationTokens.usedAt)
      )
    )
    .returning({ id: emailVerificationTokens.id });
  if (used.length === 0) return { status: "invalid" }; // lost the single-use race
  await db
    .update(users)
    .set({ emailVerifiedAt: new Date() })
    .where(eq(users.id, row.userId));
  await writeAudit({
    action: "auth.email_verified",
    actorUserId: row.userId,
    requestId: requestId ?? null,
  });
  return { status: "verified", userId: row.userId };
}
