import { makeRouteHandler } from "@/lib/http/request-context";
import { ok } from "@/lib/http/error";
import { acceptInvite, resolveTeamScope } from "@/lib/teams";

export const runtime = "nodejs";

/** The INVITEE accepts: must hold a pending invitation row on this team
 * (service validates; same-institution re-checked). */
export const POST = makeRouteHandler<{ id: string }>({
  permission: "team.accept_invite", // F1: self-scoped; service validates the pending invite
  resolveCtx: (call, params) => resolveTeamScope(call.user!, params.id).then((ctx) => { Object.assign(call.ctx, ctx); }),
  handler: async (_req, params, call) => {
    const team = await acceptInvite(call.user!, params.id);
    return ok({ team }, call.requestId);
  },
});
