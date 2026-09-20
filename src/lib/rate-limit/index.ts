import "server-only";
import { sql } from "drizzle-orm";
import { db } from "../db/client";
import { createHash } from "node:crypto";

/**
 * Fixed-window rate limiter on Postgres (brief S8).
 * Bucket key = sha256(scope + clientIp) so raw IPs never touch the table
 * and the key is stable. Window is aligned to clock boundaries.
 *
 * The client IP MUST come from deriveClientIp() (trusted-proxy aware),
 * never from a raw x-forwarded-for header.
 */

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
}

export async function rateLimit(
  scope: string,
  clientIp: string,
  limit: number,
  windowSec: number
): Promise<RateLimitResult> {
  const bucketKey = createHash("sha256")
    .update(`${scope}|${clientIp}`)
    .digest("hex")
    .slice(0, 32);
  const now = new Date();
  const windowStart = new Date(Math.floor(now.getTime() / 1000 / windowSec) * windowSec * 1000);

  // Atomic increment-or-insert (single statement → no race).
  const rows = (await db.execute(sql`
    insert into ip_rate_limits (bucket_key, window_start, count)
    values (${bucketKey}, ${windowStart.toISOString()}, 1)
    on conflict (bucket_key, window_start)
    do update set count = ip_rate_limits.count + 1
    returning count, window_start
  `)) as unknown as Array<{ count: number; window_start: Date | string }>;
  const count = Number(rows[0].count);
  const allowed = count <= limit;
  const retryAfterSec = allowed
    ? 0
    : Math.max(1, Math.ceil((windowStart.getTime() + windowSec * 1000 - now.getTime()) / 1000));
  return { allowed, remaining: Math.max(0, limit - count), retryAfterSec };
}

/** Convenience: scoped, IP-derived limiter for one route. */
export async function guard(
  scope: string,
  clientIp: string,
  limit: number,
  windowSec: number
): Promise<RateLimitResult> {
  return rateLimit(scope, clientIp, limit, windowSec);
}

