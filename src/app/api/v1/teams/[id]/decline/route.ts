import { makeRouteHandler } from "@/lib/http/request-context";
import { ok } from "@/lib/http/error";
import { declineInvite, resolveTeamScope } from "@/lib/teams";

export const runtime = "nodejs";

/** F1: the invitee declines a pending invitation. */
export const POST = makeRouteHandler<{ id: string }>({
  permission: "team.decline_invite", // F1: self-scoped; service validates the pending invite
  resolveCtx: (call, params) =>
    resolveTeamScope(call.user!, params.id).then((ctx) => { Object.assign(call.ctx, ctx); }),
  handler: async (_req, params, call) => {
    await declineInvite(call.user!, params.id);
    return ok({ declined: true }, call.requestId);
  },
});
