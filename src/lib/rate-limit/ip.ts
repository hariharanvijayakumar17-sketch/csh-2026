/**
 * S8: derive the real client IP WITHOUT trusting a raw x-forwarded-for.
 *
 * trustedProxyCount = 0 (default, app behind no proxy):
 *   the header is IGNORED — only the socket address counts. A spoofed
 *   header cannot rotate the rate-limit bucket.
 * trustedProxyCount = n (app behind n trusted reverse proxies):
 *   the proxies append their own address to XFF from the right, so the
 *   client is the entry at index len-1-n. If the header is missing, empty,
 *   or shorter than the trusted count, we fall back to the socket address
 *   (never guess, never use an attacker-controlled value).
 */
export function deriveClientIp(
  forwardedFor: string | null,
  trustedProxyCount: number,
  socketAddr: string
): string {
  if (!Number.isInteger(trustedProxyCount) || trustedProxyCount < 0) {
    return socketAddr;
  }
  if (trustedProxyCount === 0 || !forwardedFor) {
    return socketAddr;
  }
  const parts = forwardedFor
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (parts.length <= trustedProxyCount) {
    return socketAddr;
  }
  return parts[parts.length - 1 - trustedProxyCount];
}

export function trustedProxyCountFromEnv(): number {
  const raw = process.env.TRUSTED_PROXY_COUNT;
  const n = raw ? Number(raw) : 0;
  return Number.isInteger(n) && n >= 0 ? n : 0;
}
