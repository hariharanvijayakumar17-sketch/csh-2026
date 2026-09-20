import { createHash, randomBytes } from "node:crypto";

/**
 * Single-use token handling (brief S7): tokens are 32 random bytes (hex);
 * only the SHA-256 hash is stored in the DB.
 */

export function generateToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("hex");
  return { token, tokenHash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
