import { z } from "@/lib/zod";
import { makeRouteHandler } from "@/lib/http/request-context";
import { ok } from "@/lib/http/error";
import { createTeam, teamRules } from "@/lib/teams";

export const runtime = "nodejs";

export const createTeamSchema = z.object({
  name: z.string().trim().min(2).max(60),
});

export const POST = makeRouteHandler({
  permission: "team.create",
  handler: async (req, _params, call) => {
    const body = createTeamSchema.safeParse(await req.json().catch(() => null));
    if (!body.success) {
      return Response.json(
        {
          success: false,
          error: { code: "VALIDATION_ERROR", message: "Invalid team payload", details: body.error.issues },
          requestId: call.requestId,
        },
        { status: 400 }
      );
    }
    const [team, rules] = await Promise.all([
      createTeam(call.user!, body.data),
      teamRules(),
    ]);
    return ok({ team, rules }, call.requestId, 201);
  },
});
