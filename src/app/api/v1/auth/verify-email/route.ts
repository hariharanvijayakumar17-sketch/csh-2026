import { z } from "@/lib/zod";
import { makeRouteHandler } from "@/lib/http/request-context";
import { ApiError, ok } from "@/lib/http/error";
import { consumeVerificationToken } from "@/lib/auth/email-verify";

export const runtime = "nodejs";

export const verifyEmailSchema = z.object({ token: z.string().min(16).max(256) });

export const POST = makeRouteHandler({
  permission: null,
  handler: async (req, _params, call) => {
    const body = verifyEmailSchema.safeParse(await req.json().catch(() => null));
    if (!body.success) throw new ApiError("VALIDATION_ERROR", "Invalid token payload");
    const result = await consumeVerificationToken(body.data.token, call.requestId);
    if (result.status !== "verified") {
      throw new ApiError("BAD_REQUEST", "Verification link is invalid or has expired");
    }
    return ok({ message: "Email verified" }, call.requestId);
  },
});
