import { describe, expect, it } from "vitest";
import { deriveClientIp } from "../ip";

/**
 * S8: rate limiting must not trust a raw x-forwarded-for header.
 * deriveClientIp(forwardedFor, trustedProxyCount, socketAddr):
 *  - trustedProxyCount = 0  → the header is IGNORED entirely (socket only)
 *  - trustedProxyCount = n  → client = entry at index len-1-n (rightmost n
 *    are the trusted proxies that appended to the list)
 *  - header missing or too short for the trusted count → socket (never guess)
 */
describe("S8 client IP derivation (no raw XFF trust)", () => {
  it("ignores x-forwarded-for entirely when no trusted proxies are configured", () => {
    expect(deriveClientIp("1.2.3.4", 0, "10.0.0.9")).toBe("10.0.0.9");
    expect(deriveClientIp("1.2.3.4, 5.6.7.8, 9.9.9.9", 0, "10.0.0.9")).toBe(
      "10.0.0.9"
    );
  });

  it("a spoofed header cannot bypass limits with trustedProxyCount=0", () => {
    // attacker rotates fake client IPs; all must map to the same socket
    const a = deriveClientIp("8.8.8.8", 0, "10.0.0.9");
    const b = deriveClientIp("8.8.4.4", 0, "10.0.0.9");
    expect(a).toBe(b);
  });

  it("with one trusted proxy, the client is the entry left of that proxy", () => {
    // XFF: client, proxy1 (trusted). Socket = proxy1.
    expect(deriveClientIp("93.184.216.34, 203.0.113.5", 1, "203.0.113.5")).toBe(
      "93.184.216.34"
    );
    // entry left of the trusted proxy is the client even with extra spoofed
    // prefixes (they shift, but the rule is positional from the right)
    expect(deriveClientIp("6.6.6.6, 93.184.216.34, 203.0.113.5", 1, "203.0.113.5")).toBe(
      "93.184.216.34"
    );
  });

  it("falls back to the socket when the header is missing or too short", () => {
    expect(deriveClientIp(null, 1, "10.0.0.9")).toBe("10.0.0.9");
    expect(deriveClientIp("", 1, "10.0.0.9")).toBe("10.0.0.9");
    expect(deriveClientIp("onlyone", 2, "10.0.0.9")).toBe("10.0.0.9");
  });

  it("trims and skips empty tokens", () => {
    expect(deriveClientIp(" , 93.184.216.34 , 203.0.113.5 ", 1, "203.0.113.5")).toBe(
      "93.184.216.34"
    );
  });
});
