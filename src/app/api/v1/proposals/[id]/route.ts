import { z } from "@/lib/zod";
import { makeRouteHandler } from "@/lib/http/request-context";
import { ok } from "@/lib/http/error";
import {
  getProposal,
  resolveProposalScope,
  updateProposalDraft,
} from "@/lib/proposals";

export const runtime = "nodejs";

export const draftFieldsSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    abstract: z.string().max(5000).nullable().optional(),
    problemUnderstanding: z.string().max(10000).nullable().optional(),
    solution: z.string().max(20000).nullable().optional(),
    innovation: z.string().max(10000).nullable().optional(),
    architecture: z.string().max(10000).nullable().optional(),
    techStack: z.string().max(5000).nullable().optional(),
    plan: z.string().max(10000).nullable().optional(),
    impact: z.string().max(10000).nullable().optional(),
    feasibility: z.string().max(10000).nullable().optional(),
    sustainability: z.string().max(10000).nullable().optional(),
    futureScope: z.string().max(10000).nullable().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: "At least one field required",
  });

export const GET = makeRouteHandler<{ id: string }>({
  permission: "proposal.view",
  resolveCtx: (call, params) => resolveProposalScope(call.user!, params.id).then((ctx) => { Object.assign(call.ctx, ctx); }),
  handler: async (_req, params, call) => {
    const proposal = await getProposal(call.user!, params.id);
    return ok({ proposal }, call.requestId);
  },
});

export const PATCH = makeRouteHandler<{ id: string }>({
  permission: "proposal.update",
  resolveCtx: (call, params) => resolveProposalScope(call.user!, params.id).then((ctx) => { Object.assign(call.ctx, ctx); }),
  handler: async (req, params, call) => {
    const body = draftFieldsSchema.safeParse(await req.json().catch(() => null));
    if (!body.success) {
      return Response.json(
        {
          success: false,
          error: { code: "VALIDATION_ERROR", message: "Invalid draft payload", details: body.error.issues },
          requestId: call.requestId,
        },
        { status: 400 }
      );
    }
    const proposal = await updateProposalDraft(call.user!, params.id, body.data);
    return ok({ proposal }, call.requestId);
  },
});
