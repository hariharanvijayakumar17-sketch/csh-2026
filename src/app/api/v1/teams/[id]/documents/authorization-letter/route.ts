import { makeRouteHandler } from "@/lib/http/request-context";
import { ok } from "@/lib/http/error";
import { resolveTeamScope } from "@/lib/teams";
import { uploadDocument } from "@/lib/documents";

export const runtime = "nodejs";

/**
 * F2: the SPOC of the team's institution uploads the authorization letter.
 * Purpose is fixed by the URL — the purpose field in the body is ignored.
 */
export const POST = makeRouteHandler<{ id: string }>({
  permission: "document.upload_letter",
  resolveCtx: (call, params) =>
    resolveTeamScope(call.user!, params.id).then((ctx) => {
      Object.assign(call.ctx, ctx);
      Object.assign(call.ctx, {
        document: { ownerKind: "team", ownerId: params.id, teamId: params.id, purpose: "authorization_letter" },
      });
    }),
  handler: async (req, params, call) => {
    const fd = await req.formData().catch(() => null);
    if (!fd) {
      return Response.json(
        { success: false, error: { code: "BAD_REQUEST", message: "Multipart form data required" }, requestId: call.requestId },
        { status: 400 }
      );
    }
    const file = fd.get("file");
    if (!(file instanceof File)) {
      return Response.json(
        { success: false, error: { code: "BAD_REQUEST", message: "field 'file' (File) required" }, requestId: call.requestId },
        { status: 400 }
      );
    }
    const bytes = Buffer.from(await file.arrayBuffer());
    const doc = await uploadDocument(call.user!, {
      ownerKind: "team",
      ownerId: params.id,
      purpose: "authorization_letter",
      file: { originalFilename: file.name, mime: file.type || "application/octet-stream", bytes },
    });
    return ok({ document: doc }, call.requestId, 201);
  },
});
