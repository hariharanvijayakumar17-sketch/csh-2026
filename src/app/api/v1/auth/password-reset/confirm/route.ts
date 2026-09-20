import { z } from "@/lib/zod";
import { makeRouteHandler } from "@/lib/http/request-context";
import { ApiError, ok } from "@/lib/http/error";
import { confirmReset } from "@/lib/auth/password-reset";
import { passwordStrengthIssues } from "@/lib/auth/password";

export const runtime = "nodejs";

export const resetConfirmSchema = z.object({
  token: z.string().min(16).max(256),
  newPassword: z.string().min(12).max(200),
});

export const POST = makeRouteHandler({
  permission: null,
  handler: async (req, _params, call) => {
    const body = resetConfirmSchema.safeParse(await req.json().catch(() => null));
    if (!body.success) throw new ApiError("VALIDATION_ERROR", "Invalid reset payload");
    const issues = passwordStrengthIssues(body.data.newPassword);
    if (issues.length > 0) {
      throw new ApiError("VALIDATION_ERROR", `Password needs: ${issues.join("; ")}`);
    }
    const result = await confirmReset(body.data.token, body.data.newPassword, call.requestId);
    if (result.status === "weak_password") {
      throw new ApiError("VALIDATION_ERROR", `Password needs: ${result.issues.join("; ")}`);
    }
    if (result.status !== "ok") {
      throw new ApiError("BAD_REQUEST", "Reset link is invalid or has expired");
    }
    return ok(
      { message: "Password changed. All your other sessions were signed out." },
      call.requestId
    );
  },
});
