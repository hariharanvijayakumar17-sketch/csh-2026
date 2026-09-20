import { makeRouteHandler } from "@/lib/http/request-context";
import { ok } from "@/lib/http/error";
import { buildOpenApi } from "@/lib/openapi";

export const runtime = "nodejs";

export const GET = makeRouteHandler({
  permission: null,
  handler: async (_req, _params, call) => ok(buildOpenApi(), call.requestId),
});
