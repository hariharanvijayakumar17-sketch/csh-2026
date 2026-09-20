/**
 * S9 CSRF protection for mutating routes (POST/PUT/PATCH/DELETE):
 *  1. Origin/Host check — browsers always send Origin on mutations; it must
 *     match the request Host (scheme-agnostic comparison: dev proxies serve
 *     http while Origin may say https on the same host).
 *  2. Content-type allow-list — only application/json and
 *     multipart/form-data (file upload) are accepted; form-encoded and other
 *     types are the classic CSRF weapon.
 * GET/HEAD never require these (safe methods, read-only by design).
 */

export type CsrfResult = "ok" | "origin_mismatch" | "bad_content_type";

function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}

export function checkMutatingRequest(headers: Headers): CsrfResult {
  const host = headers.get("host");
  const origin = headers.get("origin");

  const originHost = hostOf(origin);
  if (!host || !originHost || originHost !== host.toLowerCase()) {
    return "origin_mismatch";
  }

  const ct = (headers.get("content-type") ?? "").toLowerCase();
  const allowed =
    ct.startsWith("application/json") || ct.startsWith("multipart/form-data");
  if (!allowed) {
    return "bad_content_type";
  }
  return "ok";
}

/**
 * Apply the S9 checks in a route handler for mutating requests.
 * Returns a Response to short-circuit, or null when the request may proceed.
 */
export function csrfGuard(headers: Headers): Response | null {
  const res = checkMutatingRequest(headers);
  if (res === "ok") return null;
  return Response.json(
    {
      success: false,
      error: {
        code: "BAD_REQUEST",
        message:
          res === "origin_mismatch"
            ? "Origin does not match host (CSRF protection)"
            : "Content-Type must be application/json or multipart/form-data",
      },
    },
    { status: 400 }
  );
}
