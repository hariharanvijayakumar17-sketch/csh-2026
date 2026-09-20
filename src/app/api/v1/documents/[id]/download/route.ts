import { makeRouteHandler } from "@/lib/http/request-context";
import { getDocument, resolveDocumentScope } from "@/lib/documents";
import { contentDisposition } from "@/lib/documents/content-detect";

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
        // F3: RFC 5987 — UTF-8 name in filename*, ASCII fallback in filename
        "content-disposition": contentDisposition(doc.originalFilename),
        "x-request-id": call.requestId,
      },
    });
  },
});

