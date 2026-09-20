import "server-only";
import { randomUUID } from "node:crypto";
import { eq, and, isNull } from "drizzle-orm";
import { db } from "../db/client";
import { userSessions, users } from "../db/schema";
import { generateToken, hashToken } from "./tokens";

/**
 * DB-backed sessions (brief S9):
 * - token is a random 256-bit value; ONLY the sha256 hash is stored
 * - created on login; rotated on privilege change; revoked on password change
 * - expires after SESSION_TTL_DAYS; last-activity refreshed by the caller
 *   (throttled in the route middleware)
 */

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface SessionInfo {
  id: string;
  userId: string;
  token: string; // live token — never persisted
  expiresAt: Date;
}

export async function createSession(
  userId: string,
  meta: { userAgent?: string | null; ip?: string | null } = {}
): Promise<SessionInfo> {
  const { token, tokenHash } = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const rows = await db
    .insert(userSessions)
    .values({
      userId,
      tokenHash,
      userAgent: meta.userAgent ?? null,
      ip: meta.ip ?? null,
      expiresAt,
    })
    .returning({ id: userSessions.id });
  return { id: rows[0].id, userId, token, expiresAt };
}

export interface ResolvedSession {
  sessionId: string;
  user: {
    id: string;
    email: string;
    fullName: string;
    role: string;
    institutionId: string | null;
    emailVerifiedAt: Date | null;
    mustChangePassword: boolean;
  };
  expiresAt: Date;
}

export async function resolveSession(
  token: string | null | undefined
): Promise<ResolvedSession | null> {
  if (!token) return null;
  const tokenHash = hashToken(token);
  const rows = await db
    .select({
      sessionId: userSessions.id,
      userId: userSessions.userId,
      expiresAt: userSessions.expiresAt,
      email: users.email,
      fullName: users.fullName,
      role: users.role,
      institutionId: users.institutionId,
      emailVerifiedAt: users.emailVerifiedAt,
      mustChangePassword: users.mustChangePassword,
    })
    .from(userSessions)
    .innerJoin(users, eq(userSessions.userId, users.id))
    .where(
      and(
        eq(userSessions.tokenHash, tokenHash),
        isNull(userSessions.revokedAt),
        isNull(users.deletedAt)
      )
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  if (row.expiresAt.getTime() < Date.now()) return null;
  return {
    sessionId: row.sessionId,
    user: {
      id: row.userId,
      email: row.email,
      fullName: row.fullName,
      role: row.role,
      institutionId: row.institutionId,
      emailVerifiedAt: row.emailVerifiedAt,
      mustChangePassword: row.mustChangePassword,
    },
    expiresAt: row.expiresAt,
  };
}

export async function revokeSession(sessionId: string): Promise<void> {
  await db
    .update(userSessions)
    .set({ revokedAt: new Date() })
    .where(eq(userSessions.id, sessionId));
}

/** Revokes EVERY active session for a user (password change/reset — S7). */
export async function revokeAllSessions(userId: string): Promise<number> {
  const rows = await db
    .update(userSessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(userSessions.userId, userId), isNull(userSessions.revokedAt)))
    .returning({ id: userSessions.id });
  return rows.length;
}

/**
 * Rotate on privilege change (S9): all current sessions die, a fresh one is
 * returned for the caller. Used after role changes / admin unlock.
 */
export async function rotateSessions(
  userId: string,
  meta: { userAgent?: string | null; ip?: string | null } = {}
): Promise<SessionInfo> {
  await revokeAllSessions(userId);
  return createSession(userId, meta);
}

export { randomUUID };
