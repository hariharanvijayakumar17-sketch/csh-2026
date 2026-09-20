import { z } from "@/lib/zod";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import {
  makeRouteHandler,
  SESSION_COOKIE,
  sessionCookieOptions,
} from "@/lib/http/request-context";
import { ApiError, ok } from "@/lib/http/error";
import { Permissions } from "@/lib/authz/permissions";
import { hashPassword, passwordStrengthIssues, verifyPassword } from "@/lib/auth/password";
import { rotateSessions } from "@/lib/auth/sessions";
import { writeAudit } from "@/lib/audit";

export const runtime = "nodejs";

export const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(12).max(200),
});

export const POST = makeRouteHandler({
  permission: Permissions.passwordChangeSelf,
  handler: async (req, _params, call) => {
    const body = passwordChangeSchema.safeParse(await req.json().catch(() => null));
    if (!body.success) throw new ApiError("VALIDATION_ERROR", "Invalid password change payload");

    const [user] = await db
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, call.user!.id))
      .limit(1);
    if (!(await verifyPassword(body.data.currentPassword, user.passwordHash))) {
      throw new ApiError("BAD_REQUEST", "Current password is incorrect");
    }
    const issues = passwordStrengthIssues(body.data.newPassword);
    if (issues.length > 0) {
      throw new ApiError("VALIDATION_ERROR", `New password needs: ${issues.join("; ")}`);
    }
    await db
      .update(users)
      .set({ passwordHash: await hashPassword(body.data.newPassword) })
      .where(eq(users.id, call.user!.id));
    // S7/S9: change revokes ALL sessions; issue a fresh one for this client.
    const fresh = await rotateSessions(call.user!.id, {
      userAgent: req.headers.get("user-agent"),
    });
    const store = await cookies();
    store.set(SESSION_COOKIE, fresh.token, sessionCookieOptions());
    await writeAudit({
      action: "auth.password_changed",
      actorUserId: call.user!.id,
      requestId: call.requestId,
    });
    return ok({ message: "Password changed. Other devices were signed out." }, call.requestId);
  },
});
