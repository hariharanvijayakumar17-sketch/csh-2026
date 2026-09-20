import { makeRouteHandler } from "@/lib/http/request-context";
import { ok } from "@/lib/http/error";
import { listMyTeams } from "@/lib/teams";

export const runtime = "nodejs";

export const GET = makeRouteHandler({
  permission: "team.view",
  handler: async (_req, _params, call) => {
    const teams = await listMyTeams(call.user!);
    return ok({ teams }, call.requestId);
  },
});
