import { makeRouteHandler } from "@/lib/http/request-context";
import { ok } from "@/lib/http/error";
import { getDocument, resolveDocumentScope } from "@/lib/documents";

export const runtime = "nodejs";

export const GET = makeRouteHandler<{ id: string }>({
  permission: "document.view",
  resolveCtx: (call, params) => resolveDocumentScope(call.user!, params.id).then((ctx) => { Object.assign(call.ctx, ctx); }),
  handler: async (_req, params, call) => {
    const { bytes, ...doc } = await getDocument(call.user!, params.id);
    void bytes; // content served via /download
    return ok({ document: doc }, call.requestId);
  },
});
