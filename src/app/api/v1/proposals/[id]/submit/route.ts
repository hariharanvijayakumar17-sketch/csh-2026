import { makeRouteHandler } from "@/lib/http/request-context";
import { ok } from "@/lib/http/error";
import { resolveProposalScope, submitProposal } from "@/lib/proposals";

export const runtime = "nodejs";

export const POST = makeRouteHandler<{ id: string }>({
  permission: "proposal.submit",
  resolveCtx: (call, params) => resolveProposalScope(call.user!, params.id).then((ctx) => { Object.assign(call.ctx, ctx); }),
  handler: async (_req, params, call) => {
    const proposal = await submitProposal(call.user!, params.id);
    return ok({ proposal }, call.requestId);
  },
});
