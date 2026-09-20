import { z } from "@/lib/zod";
import { makeRouteHandler } from "@/lib/http/request-context";
import { ok } from "@/lib/http/error";
import { createProposal } from "@/lib/proposals";
import { resolveTeamScope } from "@/lib/teams";

export const runtime = "nodejs";

export const createProposalSchema = z.object({
  problemId: z.string().uuid().nullable(),
  roundId: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
});

export const POST = makeRouteHandler<{ id: string }>({
  permission: "proposal.create",
  resolveCtx: (call, params) => resolveTeamScope(call.user!, params.id).then((ctx) => { Object.assign(call.ctx, ctx); }),
  handler: async (req, params, call) => {
    const body = createProposalSchema.safeParse(await req.json().catch(() => null));
    if (!body.success) {
      return Response.json(
        {
          success: false,
          error: { code: "VALIDATION_ERROR", message: "Invalid proposal payload", details: body.error.issues },
          requestId: call.requestId,
        },
        { status: 400 }
      );
    }
    const proposal = await createProposal(call.user!, { ...body.data, teamId: params.id });
    return ok({ proposal }, call.requestId, 201);
  },
});

