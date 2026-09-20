import { describe, expect, it } from "vitest";
import { uuidParamError } from "../request-context";

/**
 * F10: URL params are validated BEFORE authentication/authorisation.
 * A malformed id must yield a 400 envelope — never a 200-with-error,
 * never 401/403 (which would also reveal auth state for bad input).
 */
describe("F10: uuidParamError — pre-auth parameter validation", () => {
  const GOOD = "018f1c2e-6f7e-7c10-9f3a-2b5e6d7c8a9b";

  it("valid UUID params → no error", () => {
    expect(uuidParamError({ id: GOOD })).toBeNull();
    expect(uuidParamError({ id: GOOD, userId: GOOD })).toBeNull();
  });

  it("malformed params → the offending key (case-insensitive hex accepted)", () => {
    expect(uuidParamError({ id: "not-a-uuid" })).toBe("id");
    expect(uuidParamError({ id: "1234" })).toBe("id");
    expect(uuidParamError({ id: "" })).toBe("id");
    expect(uuidParamError({ id: GOOD.toUpperCase() })).toBeNull();
  });

  it("non-string params are ignored (route typing keeps them out)", () => {
    expect(uuidParamError({ id: GOOD })).toBeNull();
  });

  it("routes without params (null/undefined) pass cleanly", () => {
    expect(uuidParamError(null)).toBeNull();
    expect(uuidParamError(undefined)).toBeNull();
    expect(uuidParamError({})).toBeNull();
  });
});
