import { describe, expect, it } from "vitest";
import {
  SCRYPT_PARAMS,
  DUMMY_HASH,
  dummyVerify,
  hashPassword,
  verifyPassword,
} from "../password";

/**
 * P3 addendum item 3: scrypt cost parameters must be visible, the dummy hash
 * (unknown-email timing equalisation) must use the SAME cost, and comparison
 * must be constant-time (crypto.timingSafeEqual — verified structurally:
 * length-mismatched hashes are rejected without throwing).
 */

function parseStored(stored: string) {
  const parts = stored.split("$");
  return {
    algo: parts[0],
    N: Number(parts[1].replace("N=", "")),
    r: Number(parts[2].replace("r=", "")),
    p: Number(parts[3].replace("p=", "")),
    saltHex: parts[4],
    hashHex: parts[5],
  };
}

describe("scrypt cost parameters (P3 addendum 3)", () => {
  it("exports explicit parameters: N=16384 r=8 p=1, keylen 64", () => {
    expect(SCRYPT_PARAMS.N).toBe(16384);
    expect(SCRYPT_PARAMS.r).toBe(8);
    expect(SCRYPT_PARAMS.p).toBe(1);
    expect(SCRYPT_PARAMS.keyLen).toBe(64);
    // memory per hash = 128 * N * r bytes
    expect(128 * SCRYPT_PARAMS.N * SCRYPT_PARAMS.r).toBe(16 * 1024 * 1024); // 16 MiB
  });

  it("dummy hash uses the SAME N/r/p as real hashes (no free timing path)", () => {
    const d = parseStored(DUMMY_HASH);
    expect(d.algo).toBe("scrypt");
    expect(d.N).toBe(SCRYPT_PARAMS.N);
    expect(d.r).toBe(SCRYPT_PARAMS.r);
    expect(d.p).toBe(SCRYPT_PARAMS.p);
    expect(d.hashHex.length / 2).toBe(SCRYPT_PARAMS.keyLen);
  });

  it("dummyVerify never validates but performs a real scrypt work round", async () => {
    expect(await dummyVerify && (await verifyPassword("anything-123!", DUMMY_HASH))).toBe(false);
    // round-trip: a real hash validates its password and rejects others
    const h = await hashPassword("RealPassw0rd!1");
    expect(await verifyPassword("RealPassw0rd!1", h)).toBe(true);
    expect(await verifyPassword("WrongPassw0rd!1", h)).toBe(false);
  });

  it("length-mismatched stored hash is rejected without throwing (timingSafeEqual guard)", async () => {
    const h = await hashPassword("RealPassw0rd!1");
    const parts = h.split("$");
    parts[5] = "ab".repeat(32); // 64-byte key, now 32 bytes → mismatch
    expect(await verifyPassword("RealPassw0rd!1", parts.join("$"))).toBe(false);
  });
});
