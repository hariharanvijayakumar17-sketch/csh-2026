import { describe, expect, it } from "vitest";
import { checkMutatingRequest } from "../csrf";

/**
 * S9 CSRF: Origin/Host checks + JSON content-type enforcement on mutating
 * routes. Browser POST/PUT/PATCH/DELETE requests always carry Origin;
 * non-matching or missing origins are rejected.
 */
function headers(extra: Record<string, string>): Headers {
  return new Headers({ host: "csh.example.in", ...extra });
}

describe("S9 CSRF protection for mutating routes", () => {
  it("accepts a same-origin JSON POST", () => {
    const h = headers({
      origin: "https://csh.example.in",
      "content-type": "application/json",
    });
    expect(checkMutatingRequest(h)).toBe("ok");
  });

  it("accepts same host with different scheme port-normalised (HTTP->HTTPS preview)", () => {
    const h = headers({
      origin: "http://csh.example.in",
      "content-type": "application/json",
    });
    expect(checkMutatingRequest(h)).not.toBe("origin_mismatch");
  });

  it("rejects a cross-origin POST (evil site)", () => {
    const h = headers({
      origin: "https://evil.example.com",
      "content-type": "application/json",
    });
    expect(checkMutatingRequest(h)).toBe("origin_mismatch");
  });

  it("rejects missing origin (browsers always send it on mutations)", () => {
    const h = headers({ "content-type": "application/json" });
    expect(checkMutatingRequest(h)).toBe("origin_mismatch");
  });

  it("accepts a same-origin multipart POST (file upload)", () => {
    const h = headers({
      origin: "https://csh.example.in",
      "content-type": "multipart/form-data; boundary=xyz",
    });
    expect(checkMutatingRequest(h)).toBe("ok");
  });

  it("rejects non-JSON content types (form-encoded CSRF weapon)", () => {
    const h = headers({
      origin: "https://csh.example.in",
      "content-type": "application/x-www-form-urlencoded",
    });
    expect(checkMutatingRequest(h)).toBe("bad_content_type");
  });

  it("accepts JSON with charset parameter", () => {
    const h = headers({
      origin: "https://csh.example.in",
      "content-type": "application/json; charset=utf-8",
    });
    expect(checkMutatingRequest(h)).toBe("ok");
  });
});
