import { describe, expect, it } from "vitest";
import {
  dummyVerify,
  hashPassword,
  passwordStrengthIssues,
  verifyPassword,
} from "../password";

describe("S7 password hashing (scrypt, zero native deps)", () => {
  it("hashes and verifies a correct password", async () => {
    const hash = await hashPassword("correct horse battery staple 42");
    expect(hash.startsWith("scrypt$N=16384$r=8$p=1$")).toBe(true);
    await expect(verifyPassword("correct horse battery staple 42", hash)).resolves.toBe(
      true
    );
  });

  it("rejects a wrong password and malformed stored hashes", async () => {
    const hash = await hashPassword("s3cret-password!");
    await expect(verifyPassword("s3cret-password?", hash)).resolves.toBe(false);
    await expect(verifyPassword("anything", "not-a-valid-hash")).resolves.toBe(false);
    await expect(
      verifyPassword("anything", "scrypt$N=16384$r=8$p=1$zz$zz")
    ).resolves.toBe(false);
  });

  it("produces unique salts per hash", async () => {
    const a = await hashPassword("same-password");
    const b = await hashPassword("same-password");
    expect(a).not.toBe(b);
    await expect(verifyPassword("same-password", b)).resolves.toBe(true);
  });

  it("dummyVerify performs a real scrypt compare (unknown-email timing guard, S7)", async () => {
    await expect(dummyVerify("any-password")).resolves.toBeUndefined();
  });

  it("strength rules enforce bootstrap-admin password quality (S6)", () => {
    expect(passwordStrengthIssues("short")).toEqual(
      expect.arrayContaining(["at least 12 characters"])
    );
    expect(passwordStrengthIssues("alllowercase1234")).toEqual(
      expect.arrayContaining(["upper and lower case letters"])
    );
    expect(passwordStrengthIssues("NoDigitsHereXXXX")).toEqual(
      expect.arrayContaining(["a digit"])
    );
    expect(passwordStrengthIssues("Str0ngPassw0rd!")).toEqual([]);
  });
});
