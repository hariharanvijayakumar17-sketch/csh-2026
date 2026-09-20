import { makeRouteHandler } from "@/lib/http/request-context";
import { ok } from "@/lib/http/error";
import { listMyProposals } from "@/lib/proposals";

export const runtime = "nodejs";

export const GET = makeRouteHandler({
  permission: "proposal.view",
  handler: async (_req, _params, call) => {
    const proposals = await listMyProposals(call.user!);
    return ok({ proposals }, call.requestId);
  },
});
