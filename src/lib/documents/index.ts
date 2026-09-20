import "server-only";
import { createHash } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "../db/client";
import {
  documents,
  evaluations,
  mentorships,
  proposals,
  teamMembers,
  teams,
} from "../db/schema";
import { can, Permissions, type CanContext, type UserLike } from "../authz/permissions";
import { getNumberSetting } from "../settings";
import { ApiError } from "../http/error";

/**
 * P5: documents — S2 document ACL. Access is resolved exclusively through
 * can(document.view / document.upload) with the document's owning TEAM:
 * team members, own-institution SPOC, assigned mentor, assigned evaluator,
 * admins. Everyone else (cross-team, cross-institution, unassigned) is DENIED
 * — that matrix is the acceptance test in src/integration/documents.test.ts.
 *
 * Storage: local disk (data/uploads) keyed by sha256. The provider abstraction
 * (S10) lives behind this service so P8 can swap it without touching routes.
 */

export interface DocumentDTO {
  id: string;
  ownerKind: string;
  ownerId: string;
  teamId: string;
  purpose: string;
  originalFilename: string;
  mimeDetected: string;
  sizeBytes: number;
  sha256: string;
  status: string;
  uploadedBy: string | null;
  createdAt: Date;
}

const PURPOSES = new Set([
  "authorization_letter",
  "consent_form",
  "proposal_presentation",
  "project_report",
  "demo_video",
  "other",
]);

const UPLOAD_ROOT = path.resolve(process.env.CSH_UPLOAD_DIR ?? "data/uploads");

const ALLOWED_MIME = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation", // pptx
  "application/vnd.ms-powerpoint", // ppt
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // docx
  "application/msword", // doc
  "video/mp4",
  "application/zip",
  "image/jpeg",
  "image/png",
]);

function magicLooksLike(buf: Buffer, mime: string): boolean {
  if (buf.length < 4) return false;
  switch (mime) {
    case "application/pdf":
      return buf.subarray(0, 4).equals(Buffer.from("%PDF"));
    case "application/zip":
      return buf[0] === 0x50 && buf[1] === 0x4b;
    case "video/mp4": {
      const ftyp = buf.subarray(4, 8).toString("latin1");
      return ftyp === "ftyp";
    }
    case "image/jpeg":
      return buf[0] === 0xff && buf[1] === 0xd8;
    case "image/png":
      return buf.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    default:
      return true; // office formats: magic sniff skipped (validated by allowlist + size)
  }
}

/** teamId a document resolves to (team-owned directly, proposal-owned via team). */
async function resolveDocTeam(ownerKind: "team" | "proposal", ownerId: string): Promise<string | null> {
  if (ownerKind === "team") {
    const [t] = await db
      .select({ id: teams.id })
      .from(teams)
      .where(and(eq(teams.id, ownerId), isNull(teams.deletedAt)))
      .limit(1);
    return t?.id ?? null;
  }
  if (ownerKind === "proposal") {
    const [p] = await db
      .select({ teamId: proposals.teamId })
      .from(proposals)
      .where(and(eq(proposals.id, ownerId), isNull(proposals.deletedAt)))
      .limit(1);
    return p?.teamId ?? null;
  }
  return null;
}

/** F1: ACCEPTED membership in a live team only (invited rows grant nothing;
 *  duplicate of the teams-service rule — documents cannot import teams,
 *  which imports documents). */
async function ownTeamIds(userId: string): Promise<Set<string>> {
  const rows = await db
    .select({ teamId: teamMembers.teamId })
    .from(teamMembers)
    .where(and(eq(teamMembers.userId, userId), eq(teamMembers.status, "accepted")));
  return new Set(rows.map((r) => r.teamId));
}

/**
 * The ACL context for a document: resolves the assigned mentor + assigned
 * evaluator for the owning team. "Assigned evaluator" = has an evaluation row
 * for any proposal of that team (blind-mode hiding is a display concern, P7).
 */
async function docCtx(
  caller: UserLike,
  doc: { ownerKind: "team" | "proposal"; ownerId: string; teamId: string | null },
  purpose?: string
) {
  if (!doc.teamId) throw new ApiError("NOT_FOUND", "Document's owning team not found");
  const own = await ownTeamIds(caller.id);
  const [teamRow] = await db
    .select({ id: teams.id, institutionId: teams.institutionId, leaderUserId: teams.leaderUserId })
    .from(teams)
    .where(eq(teams.id, doc.teamId))
    .limit(1);
  if (!teamRow) throw new ApiError("NOT_FOUND", "Document's owning team not found");
  let mentorAssignedTeamIds: Set<string> | undefined;
  let evaluatorAssignedTeamIds: Set<string> | undefined;
  if (caller.role === "mentor") {
    const rows = await db
      .select({ teamId: mentorships.teamId })
      .from(mentorships)
      .where(eq(mentorships.mentorUserId, caller.id));
    mentorAssignedTeamIds = new Set(rows.map((r) => r.teamId));
  }
  if (caller.role === "evaluator") {
    const rows = await db
      .select({ teamId: proposals.teamId })
      .from(evaluations)
      .innerJoin(proposals, eq(evaluations.proposalId, proposals.id))
      .where(eq(evaluations.evaluatorUserId, caller.id));
    evaluatorAssignedTeamIds = new Set(rows.map((r) => r.teamId));
  }
  return {
    document: { ownerKind: doc.ownerKind, ownerId: doc.ownerId, teamId: doc.teamId, purpose },
    team: {
      id: teamRow.id,
      institutionId: teamRow.institutionId,
      leaderUserId: teamRow.leaderUserId,
    },
    ownTeamIds: own,
    mentorAssignedTeamIds,
    evaluatorAssignedTeamIds,
  };
}

function toDTO(r: typeof documents.$inferSelect, teamId: string | null): DocumentDTO {
  return {
    id: r.id,
    ownerKind: r.ownerKind,
    ownerId: r.ownerId,
    teamId: teamId ?? "",
    purpose: r.purpose,
    originalFilename: r.originalFilename,
    mimeDetected: r.mimeDetected,
    sizeBytes: Number(r.sizeBytes),
    sha256: r.sha256,
    status: r.status,
    uploadedBy: r.uploaderId,
    createdAt: r.createdAt,
  };
}

export async function resolveDocumentScope(
  caller: UserLike,
  docId: string
): Promise<CanContext> {
  const rows = await db
    .select()
    .from(documents)
    .where(and(eq(documents.id, docId), isNull(documents.deletedAt)))
    .limit(1);
  if (rows.length === 0) throw new ApiError("NOT_FOUND", "Document not found");
  const doc = rows[0];
  const ownerKind = doc.ownerKind as "team" | "proposal";
  const teamId = (await resolveDocTeam(ownerKind, doc.ownerId)) ?? undefined;
  if (!teamId) throw new ApiError("NOT_FOUND", "Document's owning team not found");
  return docCtx(caller, { ownerKind, ownerId: doc.ownerId, teamId }, doc.purpose as string | undefined);
}

export async function uploadDocument(
  caller: UserLike,
  input: {
    ownerKind: "team" | "proposal";
    ownerId: string;
    purpose: string;
    file: { originalFilename: string; mime: string; bytes: Buffer };
  }
): Promise<DocumentDTO> {
  const teamId = await resolveDocTeam(input.ownerKind, input.ownerId);
  if (!teamId) throw new ApiError("NOT_FOUND", "Owning team/proposal not found");

  if (!PURPOSES.has(input.purpose)) {
    throw new ApiError("BAD_REQUEST", `Invalid document purpose (${input.purpose})`);
  }

  // F2: upload is a strict split — accepted team members, OR the SPOC of the
  // team's institution for authorization letters ONLY. Mentors/evaluators
  // cannot upload; other-institution SPOCs cannot upload.
  const ctx = await docCtx(caller, { ownerKind: input.ownerKind, ownerId: input.ownerId, teamId }, input.purpose);
  if (input.purpose === "authorization_letter") {
    if (!can(caller, Permissions.documentUploadLetter, ctx)) {
      throw new ApiError("FORBIDDEN", "Only the SPOC of the team's institution can upload the authorization letter");
    }
  } else if (!can(caller, Permissions.documentUpload, ctx)) {
    throw new ApiError("FORBIDDEN", "You cannot upload documents to this team/proposal");
  }

  const { originalFilename, mime, bytes } = input.file;
  if (!originalFilename || originalFilename.length > 255) {
    throw new ApiError("BAD_REQUEST", "Invalid filename");
  }
  if (!ALLOWED_MIME.has(mime)) {
    throw new ApiError("BAD_REQUEST", `File type not allowed (${mime})`);
  }
  const maxBytes = await getNumberSetting("document.max_bytes", 10 * 1024 * 1024);
  if (bytes.length === 0) throw new ApiError("BAD_REQUEST", "Empty file");
  if (bytes.length > maxBytes) {
    throw new ApiError("PAYLOAD_TOO_LARGE", `File exceeds ${Math.round(maxBytes / (1024 * 1024))} MiB limit`);
  }
  if (!magicLooksLike(bytes, mime)) {
    throw new ApiError("BAD_REQUEST", "File content does not match its declared type");
  }

  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const storedFilename = `${sha256}-${originalFilename.replace(/[^A-Za-z0-9._-]/g, "_").slice(-60)}`;
  await mkdir(UPLOAD_ROOT, { recursive: true });
  await writeFile(path.join(UPLOAD_ROOT, storedFilename), bytes);

  const [row] = await db
    .insert(documents)
    .values({
      ownerKind: input.ownerKind,
      ownerId: input.ownerId,
      uploaderId: caller.id,
      purpose: input.purpose as never, // validated against PURPOSES above
      originalFilename,
      storedFilename,
      mimeDetected: mime,
      sizeBytes: bytes.length,
      sha256,
      storageKey: path.join(UPLOAD_ROOT, storedFilename),
    })
    .returning();
  return toDTO(row, teamId);
}

export async function getDocument(caller: UserLike, docId: string): Promise<DocumentDTO & { bytes: Buffer }> {
  const rows = await db
    .select()
    .from(documents)
    .where(and(eq(documents.id, docId), isNull(documents.deletedAt)))
    .limit(1);
  if (rows.length === 0) throw new ApiError("NOT_FOUND", "Document not found");
  const doc = rows[0];
  const ownerKind = doc.ownerKind as "team" | "proposal";
  const teamId = await resolveDocTeam(ownerKind, doc.ownerId);
  const ctx = await docCtx(caller, { ownerKind, ownerId: doc.ownerId, teamId });
  if (!can(caller, Permissions.documentView, ctx)) {
    throw new ApiError("FORBIDDEN", "You do not have access to this document");
  }

  let bytes: Buffer;
  try {
    bytes = await readFile(doc.storageKey);
  } catch {
    throw new ApiError("NOT_FOUND", "File is missing from storage");
  }
  return { ...toDTO(doc, teamId), bytes };
}

export async function listTeamDocuments(caller: UserLike, teamId: string): Promise<DocumentDTO[]> {
  const [t] = await db
    .select({ id: teams.id })
    .from(teams)
    .where(and(eq(teams.id, teamId), isNull(teams.deletedAt)))
    .limit(1);
  if (!t) throw new ApiError("NOT_FOUND", "Team not found");

  const ctx = await docCtx(caller, { ownerKind: "team", ownerId: teamId, teamId });
  if (!can(caller, Permissions.documentView, ctx)) {
    throw new ApiError("FORBIDDEN", "You do not have access to this team's documents");
  }

  const rows = await db
    .select()
    .from(documents)
    .where(and(isNull(documents.deletedAt), orOwner(teamId)));
  const out: DocumentDTO[] = [];
  for (const r of rows) {
    const tid = r.ownerKind === "team" ? r.ownerId : (await resolveDocTeam(r.ownerKind as "team" | "proposal", r.ownerId)) ?? "";
    out.push(toDTO(r, tid));
  }
  return out;
}

/** matches docs owned by the team directly OR by any of the team's proposals */
function orOwner(teamId: string) {
  return sql`(${documents.ownerKind} = 'team' and ${documents.ownerId} = ${teamId} or ${documents.ownerKind} = 'proposal' and ${documents.ownerId} in (select (${proposals.id})::text from ${proposals} where ${proposals.teamId} = ${teamId}))`;
}

