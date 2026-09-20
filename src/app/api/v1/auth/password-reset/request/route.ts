import { z } from "@/lib/zod";
import { db } from "@/lib/db/client";
import { emailQueue } from "@/lib/db/schema";
import { makeRouteHandler } from "@/lib/http/request-context";
import { ApiError, ok } from "@/lib/http/error";
import { requestResetToken } from "@/lib/auth/password-reset";
import { rateLimit } from "@/lib/rate-limit";
import { deriveClientIp, trustedProxyCountFromEnv } from "@/lib/rate-limit/ip";
import { getNumberSetting } from "@/lib/settings";

export const runtime = "nodejs";

export const resetRequestSchema = z.object({ email: z.email().max(200) });

const BASE_URL = process.env.PUBLIC_BASE_URL ?? "http://localhost:3000";

export const POST = makeRouteHandler({
  permission: null,
  handler: async (req, _params, call) => {
    const body = resetRequestSchema.safeParse(await req.json().catch(() => null));
    if (!body.success) throw new ApiError("VALIDATION_ERROR", "Invalid email payload");
    const clientIp = deriveClientIp(
      req.headers.get("x-forwarded-for"),
      trustedProxyCountFromEnv(),
      req.headers.get("x-real-ip") ?? "127.0.0.1"
    );
    const rl = await rateLimit(
      "reset-ip",
      clientIp,
      await getNumberSetting("ratelimit.reset.ip_per_hour", 5),
      3600
    );
    if (!rl.allowed) {
      throw new ApiError("RATE_LIMITED", "Too many reset requests, try later", {
        status: 429,
        details: { retryAfterSec: rl.retryAfterSec },
      });
    }
    const { token } = await requestResetToken(body.data.email);
    if (token) {
      const link = `${BASE_URL}/reset-password?token=${token}`;
      await db.insert(emailQueue).values({
        toEmail: body.data.email.trim().toLowerCase(),
        subject: "Reset your CSH 2026 password",
        bodyText: `Reset your Campus Solution Hackathon 2026 password:\n${link}\n\nThe link expires in 60 minutes. If you did not ask for this, ignore this email.`,
        bodyHtml: `<p>Reset your Campus Solution Hackathon 2026 password:</p><p><a href="${link}">${link}</a></p><p>The link expires in 60 minutes. If you did not ask for this, ignore this email.</p>`,
      });
    }
    // Non-enumerating: identical response whether or not the account exists.
    return ok(
      { message: "If that account exists and is eligible, a reset link has been sent." },
      call.requestId
    );
  },
});
