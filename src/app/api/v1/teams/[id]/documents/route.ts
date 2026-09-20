import { z } from "@/lib/zod";
import { makeRouteHandler } from "@/lib/http/request-context";
import { ok } from "@/lib/http/error";
import { resolveTeamScope } from "@/lib/teams";
import { listTeamDocuments, uploadDocument } from "@/lib/documents";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GET = makeRouteHandler<{ id: string }>({
  permission: "document.view",
  resolveCtx: (call, params) =>
    resolveTeamScope(call.user!, params.id).then((ctx) => {
      Object.assign(call.ctx, ctx);
      Object.assign(call.ctx, { document: { ownerKind: "team", ownerId: params.id, teamId: params.id } });
    }),
  handler: async (_req, params, call) => {
    const documents = await listTeamDocuments(call.user!, params.id);
    return ok({ documents }, call.requestId);
  },
});

export const POST = makeRouteHandler<{ id: string }>({
  permission: "document.upload",
  resolveCtx: (call, params) =>
    resolveTeamScope(call.user!, params.id).then((ctx) => {
      Object.assign(call.ctx, ctx);
      Object.assign(call.ctx, { document: { ownerKind: "team", ownerId: params.id, teamId: params.id } });
    }),
  handler: async (req, params, call) => {
    if (!UUID_RE.test(params.id)) return ok({ error: "bad id" }, call.requestId);
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
    if (purpose.data === "authorization_letter") {
      // F2: the letter has a dedicated SPOC endpoint — keep the split visible
      return Response.json(
        {
          success: false,
          error: {
            code: "BAD_REQUEST",
            message: "authorization_letter is uploaded via POST /teams/:id/documents/authorization-letter (SPOC only)",
          },
          requestId: call.requestId,
        },
        { status: 400 }
      );
    }
    const bytes = Buffer.from(await file.arrayBuffer());
    const doc = await uploadDocument(call.user!, {
      ownerKind: "team",
      ownerId: params.id,
      purpose: purpose.data,
      file: { originalFilename: file.name, mime: file.type || "application/octet-stream", bytes },
    });
    return ok({ document: doc }, call.requestId, 201);
  },
});
