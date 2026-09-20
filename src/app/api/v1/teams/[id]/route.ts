import { z } from "@/lib/zod";
import { makeRouteHandler } from "@/lib/http/request-context";
import { ok } from "@/lib/http/error";
import { getTeam, resolveTeamScope, updateTeam, withdrawTeam } from "@/lib/teams";

export const runtime = "nodejs";

export const updateTeamSchema = z.object({
  name: z.string().trim().min(2).max(60),
});

export const GET = makeRouteHandler<{ id: string }>({
  permission: "team.view",
  resolveCtx: (call, params) => resolveTeamScope(call.user!, params.id).then((ctx) => { Object.assign(call.ctx, ctx); }),
  handler: async (_req, params, call) => {
    const team = await getTeam(call.user!, params.id);
    return ok({ team }, call.requestId);
  },
});

export const PATCH = makeRouteHandler<{ id: string }>({
  permission: "team.update",
  resolveCtx: (call, params) => resolveTeamScope(call.user!, params.id).then((ctx) => { Object.assign(call.ctx, ctx); }),
  handler: async (req, params, call) => {
    const body = updateTeamSchema.safeParse(await req.json().catch(() => null));
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
    const team = await updateTeam(call.user!, params.id, body.data);
    return ok({ team }, call.requestId);
  },
});

export const DELETE = makeRouteHandler<{ id: string }>({
  permission: "team.withdraw",
  resolveCtx: (call, params) => resolveTeamScope(call.user!, params.id).then((ctx) => { Object.assign(call.ctx, ctx); }),
  handler: async (_req, params, call) => {
    const team = await withdrawTeam(call.user!, params.id);
    return ok({ team }, call.requestId);
  },
});
