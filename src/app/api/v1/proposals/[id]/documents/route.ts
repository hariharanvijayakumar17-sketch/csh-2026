import { z } from "@/lib/zod";
import { makeRouteHandler } from "@/lib/http/request-context";
import { ok } from "@/lib/http/error";
import { resolveProposalScope } from "@/lib/proposals";
import { uploadDocument } from "@/lib/documents";

export const runtime = "nodejs";

export const POST = makeRouteHandler<{ id: string }>({
  permission: "document.upload",
  resolveCtx: (call, params) =>
    resolveProposalScope(call.user!, params.id).then((ctx) => {
      Object.assign(call.ctx, ctx);
      Object.assign(call.ctx, {
        document: { ownerKind: "proposal", ownerId: params.id, teamId: call.ctx.team?.id ?? "" },
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
    const purpose = z
      .enum(["authorization_letter", "consent_form", "proposal_presentation", "project_report", "demo_video", "other"])
      .safeParse(String(fd.get("purpose") ?? "other"));
    if (!(file instanceof File) || !purpose.success) {
      return Response.json(
        { success: false, error: { code: "BAD_REQUEST", message: "field 'file' (File) and 'purpose' required" }, requestId: call.requestId },
        { status: 400 }
      );
    }
    const bytes = Buffer.from(await file.arrayBuffer());
    const doc = await uploadDocument(call.user!, {
      ownerKind: "proposal",
      ownerId: params.id,
      purpose: purpose.data,
      file: { originalFilename: file.name, mime: file.type || "application/octet-stream", bytes },
    });
    return ok({ document: doc }, call.requestId, 201);
  },
});
