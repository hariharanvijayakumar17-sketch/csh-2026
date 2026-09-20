import { makeRouteHandler } from "@/lib/http/request-context";
import { ApiError, ok } from "@/lib/http/error";
import { getProblem } from "@/lib/problems";

export const runtime = "nodejs";

export const GET = makeRouteHandler<{ id: string }>({
  permission: null,
  handler: async (_req, params, call) => {
    const problem = await getProblem(params.id);
    if (!problem) throw new ApiError("NOT_FOUND", "Problem not found");
    return ok(problem, call.requestId);
  },
});
