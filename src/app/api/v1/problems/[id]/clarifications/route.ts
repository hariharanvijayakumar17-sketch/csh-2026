import { makeRouteHandler } from "@/lib/http/request-context";
import { ApiError, ok } from "@/lib/http/error";
import { getProblem, listClarifications } from "@/lib/problems";

export const runtime = "nodejs";

export const GET = makeRouteHandler<{ id: string }>({
  permission: null,
  handler: async (_req, params, call) => {
    // params.id may be the human code or a uuid — normalise first.
    // published-only: drafts have no public clarifications (service enforces).
    const problem = await getProblem(params.id);
    if (!problem) throw new ApiError("NOT_FOUND", "Problem not found");
    const clarifications = await listClarifications(problem.id);
    return ok({ problemId: problem.id, clarifications }, call.requestId);
  },
});
