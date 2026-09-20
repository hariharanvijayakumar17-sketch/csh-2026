// NOTE: no `import "server-only"` here — this module is also imported by
// CLI scripts (db:seed) under plain node/tsx where Next does not resolve the
// package. It is still only ever invoked from server-side code.
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { settings } from "../db/schema";

/**
 * DB-backed event rules & limits (brief §5.2: everything admin-editable).
 * 60 s in-process cache keeps hot paths (login) off the DB; admin edits
 * call invalidateSettingsCache() (the admin API does this in P8).
 *
 * P3 addendum 1: rate-limit thresholds live HERE (settings table), not in
 * code. Defaults below are CSH DECISIONs for a college-scale event where
 * thousands of students share one campus egress IP:
 *   - IP-level limits are GENEROUS (protect the app, not the network)
 *   - account-level limits are STRICT (throttle credential guessing)
 */

export const DEFAULT_SETTINGS: Record<string, { value: unknown; description: string }> = {
  "ratelimit.login.ip_per_min": {
    value: 60,
    description:
      "Login attempts per minute per CLIENT IP (generous: campus NAT shares one IP). P3 addendum 1.",
  },
  "ratelimit.login.account_per_min": {
    value: 10,
    description: "Login attempts per minute per ACCOUNT (strict: credential guessing).",
  },
  "ratelimit.register.ip_per_hour": {
    value: 10,
    description: "Registrations per hour per client IP.",
  },
  "ratelimit.reset.ip_per_hour": {
    value: 5,
    description: "Password-reset requests per hour per client IP.",
  },
};

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { value: unknown; at: number }>();

export function invalidateSettingsCache(key?: string): void {
  if (key) cache.delete(key);
  else cache.clear();
}

export async function getSetting<T>(key: string): Promise<T | null> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value as T | null;
  const rows = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, key))
    .limit(1);
  const value = (rows[0]?.value ?? null) as T | null;
  cache.set(key, { value, at: Date.now() });
  return value;
}

export async function getNumberSetting(key: string, fallback: number): Promise<number> {
  const v = await getSetting<number>(key);
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/** Upsert a setting (admin API in P8 uses this; cache-busted on write). */
export async function setSetting(
  key: string,
  value: unknown,
  description?: string
): Promise<void> {
  const set: Record<string, unknown> = { value: value as never };
  if (description !== undefined) set.description = description;
  await db
    .insert(settings)
    .values({ key, value: value as never, description: description ?? null })
    .onConflictDoUpdate({ target: settings.key, set });
  invalidateSettingsCache(key);
}

/** Insert default settings only if absent (idempotent; safe at boot/seed). */
export async function seedDefaultSettings(): Promise<void> {
  for (const [key, { value, description }] of Object.entries(DEFAULT_SETTINGS)) {
    await db
      .insert(settings)
      .values({ key, value: value as never, description })
      .onConflictDoNothing({ target: settings.key });
  }
  invalidateSettingsCache();
}
