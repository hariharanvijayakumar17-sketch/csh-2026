import { makeRouteHandler } from "@/lib/http/request-context";
import { ok } from "@/lib/http/error";

export const runtime = "nodejs";

export const GET = makeRouteHandler({
  permission: null,
  handler: async (_req, _params, call) => ok({ status: "ok" }, call.requestId),
});
