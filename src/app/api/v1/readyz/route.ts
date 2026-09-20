import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { makeRouteHandler } from "@/lib/http/request-context";
import { ok } from "@/lib/http/error";

export const runtime = "nodejs";

export const GET = makeRouteHandler({
  permission: null,
  handler: async (_req, _params, call) => {
    try {
      await db.execute(sql`select 1`);
      return ok({ status: "ready", db: "up" }, call.requestId);
    } catch {
      return Response.json(
        {
          success: false,
          error: { code: "INTERNAL_ERROR", message: "database unavailable" },
          requestId: call.requestId,
        },
        { status: 503 }
      );
    }
  },
});
