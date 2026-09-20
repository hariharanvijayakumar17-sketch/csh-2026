import { z } from "@/lib/zod";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { emailQueue, users } from "@/lib/db/schema";
import { makeRouteHandler } from "@/lib/http/request-context";
import { ApiError, ok } from "@/lib/http/error";
import { hashPassword, passwordStrengthIssues } from "@/lib/auth/password";
import { issueVerificationToken } from "@/lib/auth/email-verify";
import { rateLimit } from "@/lib/rate-limit";
import { deriveClientIp, trustedProxyCountFromEnv } from "@/lib/rate-limit/ip";
import { getNumberSetting, getSetting } from "@/lib/settings";
import { writeAudit } from "@/lib/audit";

export const runtime = "nodejs";

export const registerSchema = z.object({
  fullName: z.string().trim().min(3).max(120),
  email: z.email().max(200),
  password: z.string().min(12).max(200),
});

const BASE_URL = process.env.PUBLIC_BASE_URL ?? "http://localhost:3000";

export const POST = makeRouteHandler({
  permission: null,
  handler: async (req, _params, call) => {
    const body = registerSchema.safeParse(await req.json().catch(() => null));
    if (!body.success) {
      return Response.json(
        {
          success: false,
          error: { code: "VALIDATION_ERROR", message: "Invalid registration", details: body.error.issues },
          requestId: call.requestId,
        },
        { status: 400 }
      );
    }
    const { fullName, email, password } = body.data;
    const clientIp = deriveClientIp(req.headers.get("x-forwarded-for"), trustedProxyCountFromEnv(), "127.0.0.1");

    const mode = (await getSetting("registration_mode")) ?? "open";
    if (mode === "closed") {
      throw new ApiError("FORBIDDEN", "Registration is currently closed", { status: 403 });
    }

    const rl = await rateLimit(
      "register-ip",
      clientIp,
      await getNumberSetting("ratelimit.register.ip_per_hour", 10),
      3600
    );
    if (!rl.allowed) {
      throw new ApiError("RATE_LIMITED", "Too many registration attempts, try later", {
        status: 429,
        details: { retryAfterSec: rl.retryAfterSec },
      });
    }

    const issues = passwordStrengthIssues(password);
    if (issues.length > 0) {
      throw new ApiError("VALIDATION_ERROR", `Password needs: ${issues.join("; ")}`);
    }

    const norm = email.trim().toLowerCase();
    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(sql`lower(${users.email})`, norm))
      .limit(1);

    if (existing.length === 0) {
      await db.insert(users).values({
        email: norm,
        passwordHash: await hashPassword(password),
        fullName,
        role: "participant",
      });
    }
    // Always (re)issue a verification token + queue the email — non-enumerating
    // and self-heals "I lost the email".
    const [user] = await db
      .select()
      .from(users)
      .where(eq(sql`lower(${users.email})`, norm))
      .limit(1);
    const token = await issueVerificationToken(user.id);
    const link = `${BASE_URL}/verify-email?token=${token}`;
    await db.insert(emailQueue).values({
      toEmail: norm,
      subject: "Verify your CSH 2026 account",
      bodyText: `Hello ${fullName},\n\nverify your email for Campus Solution Hackathon 2026:\n${link}\n\nThe link expires in 30 minutes.`,
      bodyHtml: `<p>Hello ${fullName},</p><p>verify your email for Campus Solution Hackathon 2026:</p><p><a href="${link}">${link}</a></p><p>The link expires in 30 minutes.</p>`,
    });
    await writeAudit({
      action: "auth.register",
      actorUserId: user.id,
      actorIp: clientIp,
      requestId: call.requestId,
    });
    return ok(
      { message: "If that email is not registered yet, it is now — a verification link has been sent (check spam)." },
      call.requestId,
      201
    );
  },
});
