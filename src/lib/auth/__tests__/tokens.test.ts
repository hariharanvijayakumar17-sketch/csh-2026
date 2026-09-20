import { describe, expect, it } from "vitest";
import { generateToken, hashToken } from "../tokens";

describe("S7 single-use tokens", () => {
  it("generates 256-bit hex tokens with a distinct sha256 hash", () => {
    const { token, tokenHash } = generateToken();
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(tokenHash).toBe(hashToken(token));
    expect(tokenHash).not.toBe(token);
  });

  it("two tokens are never equal (randomness)", () => {
    const a = generateToken();
    const b = generateToken();
    expect(a.token).not.toBe(b.token);
  });
});
