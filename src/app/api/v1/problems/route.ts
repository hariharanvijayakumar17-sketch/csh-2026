import { z } from "@/lib/zod";
import { makeRouteHandler } from "@/lib/http/request-context";
import { ok } from "@/lib/http/error";
import { listProblems } from "@/lib/problems";

export const runtime = "nodejs";

export const listProblemsQuery = z.object({
  q: z.string().trim().max(200).optional(),
  category: z.string().trim().max(60).optional(),
  theme: z.string().trim().max(60).optional(),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const GET = makeRouteHandler({
  permission: null,
  handler: async (req, _params, call) => {
    const parsed = listProblemsQuery.safeParse(Object.fromEntries(req.nextUrl.searchParams));
    if (!parsed.success) {
      return Response.json(
        {
          success: false,
          error: { code: "VALIDATION_ERROR", message: "Invalid query parameters", details: parsed.error.issues },
          requestId: call.requestId,
        },
        { status: 400 }
      );
    }
    const data = await listProblems(parsed.data);
    return ok(data, call.requestId);
  },
});
