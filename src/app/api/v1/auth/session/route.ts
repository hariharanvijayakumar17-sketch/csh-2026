import { makeRouteHandler } from "@/lib/http/request-context";
import { Permissions } from "@/lib/authz/permissions";
import { ok } from "@/lib/http/error";

export const runtime = "nodejs";

export const GET = makeRouteHandler({
  permission: Permissions.sessionViewSelf,
  handler: async (_req, _params, call) => {
    return ok(
      {
        user: {
          id: call.user!.id,
          email: call.session!.user.email,
          fullName: call.session!.user.fullName,
          role: call.user!.role,
          institutionId: call.user!.institutionId ?? null,
          emailVerified: call.session!.user.emailVerifiedAt !== null,
        },
        expiresAt: call.session!.expiresAt,
      },
      call.requestId
    );
  },
});
