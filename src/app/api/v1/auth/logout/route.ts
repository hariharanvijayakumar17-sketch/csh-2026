import { cookies } from "next/headers";
import { makeRouteHandler, SESSION_COOKIE } from "@/lib/http/request-context";
import { Permissions } from "@/lib/authz/permissions";
import { ok } from "@/lib/http/error";
import { revokeSession } from "@/lib/auth/sessions";
import { writeAudit } from "@/lib/audit";

export const runtime = "nodejs";

export const POST = makeRouteHandler({
  permission: Permissions.sessionLogoutSelf,
  handler: async (_req, _params, call) => {
    if (call.session) {
      await revokeSession(call.session.sessionId);
      await writeAudit({
        action: "auth.logout",
        actorUserId: call.user!.id,
        requestId: call.requestId,
      });
    }
    const store = await cookies();
    store.delete(SESSION_COOKIE);
    return ok({ message: "Logged out" }, call.requestId);
  },
});
