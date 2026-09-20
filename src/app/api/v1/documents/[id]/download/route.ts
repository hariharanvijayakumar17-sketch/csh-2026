import { makeRouteHandler } from "@/lib/http/request-context";
import { getDocument, resolveDocumentScope } from "@/lib/documents";

export const runtime = "nodejs";

/** Authenticated streaming (S10). Signed URLs are the P8 hardening path. */
export const GET = makeRouteHandler<{ id: string }>({
  permission: "document.view",
  resolveCtx: (call, params) => resolveDocumentScope(call.user!, params.id).then((ctx) => { Object.assign(call.ctx, ctx); }),
  handler: async (_req, params, call) => {
    const { bytes, ...doc } = await getDocument(call.user!, params.id);
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "content-type": doc.mimeDetected,
        "content-length": String(bytes.length),
        "content-disposition": `attachment; filename="${encodeURIComponent(doc.originalFilename)}"`,
        "x-request-id": call.requestId,
      },
    });
  },
});

