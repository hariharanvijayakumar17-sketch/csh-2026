import { makeRouteHandler } from "@/lib/http/request-context";
import { ok } from "@/lib/http/error";
import { removeMember, resolveTeamScope } from "@/lib/teams";

export const runtime = "nodejs";

export const DELETE = makeRouteHandler<{ id: string; userId: string }>({
  permission: "team.remove_member",
  resolveCtx: (call, params) => resolveTeamScope(call.user!, params.id).then((ctx) => { Object.assign(call.ctx, ctx); }),
  handler: async (_req, params, call) => {
    const team = await removeMember(call.user!, params.id, params.userId);
    return ok({ team }, call.requestId);
  },
});
