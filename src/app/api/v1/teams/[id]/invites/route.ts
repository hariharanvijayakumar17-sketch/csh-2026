import { z } from "@/lib/zod";
import { makeRouteHandler } from "@/lib/http/request-context";
import { ok } from "@/lib/http/error";
import { inviteMember, resolveTeamScope } from "@/lib/teams";

export const runtime = "nodejs";

export const inviteSchema = z.object({
  email: z.email().max(200),
});

export const POST = makeRouteHandler<{ id: string }>({
  permission: "team.invite_member",
  resolveCtx: (call, params) => resolveTeamScope(call.user!, params.id).then((ctx) => { Object.assign(call.ctx, ctx); }),
  handler: async (req, params, call) => {
    const body = inviteSchema.safeParse(await req.json().catch(() => null));
    if (!body.success) {
      return Response.json(
        {
          success: false,
          error: { code: "VALIDATION_ERROR", message: "Invalid invite payload", details: body.error.issues },
          requestId: call.requestId,
        },
        { status: 400 }
      );
    }
    const member = await inviteMember(call.user!, params.id, body.data);
    return ok({ member }, call.requestId, 201);
  },
});
