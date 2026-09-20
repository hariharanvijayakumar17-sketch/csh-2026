import { z } from "@/lib/zod";
import { makeRouteHandler } from "@/lib/http/request-context";
import { ok } from "@/lib/http/error";
import { setTeamProblems, resolveTeamScope } from "@/lib/teams";

export const runtime = "nodejs";

export const setProblemsSchema = z.object({
  problemIds: z.array(z.string().uuid()).min(1).max(2),
});

export const POST = makeRouteHandler<{ id: string }>({
  permission: "team.update",
  resolveCtx: (call, params) => resolveTeamScope(call.user!, params.id).then((ctx) => { Object.assign(call.ctx, ctx); }),
  handler: async (req, params, call) => {
    const body = setProblemsSchema.safeParse(await req.json().catch(() => null));
    if (!body.success) {
      return Response.json(
        {
          success: false,
          error: { code: "VALIDATION_ERROR", message: "Invalid problems payload", details: body.error.issues },
          requestId: call.requestId,
        },
        { status: 400 }
      );
    }
    const team = await setTeamProblems(call.user!, params.id, body.data.problemIds);
    return ok({ team }, call.requestId);
  },
});
