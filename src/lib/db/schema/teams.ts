import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { institutions, users } from "./identity";
import { problemStatements } from "./problems";
import { auditBy, pk, softDelete, timestamps } from "./_common";

export const teamStatus = pgEnum("team_status", [
  "draft",
  "pending_verification",
  "verified",
  "shortlisted",
  "finalist",
  "winner",
  "rejected",
  "withdrawn",
]);

export const teamMemberRole = pgEnum("team_member_role", [
  "leader",
  "member",
]);

export const teamMemberStatus = pgEnum("team_member_status", [
  "invited",
  "accepted",
  "removed",
  "withdrawn",
  "declined",
]);

export const teams = pgTable(
  "teams",
  {
    id: pk(),
    institutionId: uuid("institution_id").notNull().references(() => institutions.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    status: teamStatus("status").notNull().default("draft"),
    leaderUserId: uuid("leader_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    // authorization/consent letter (brief §5.4; SIH_FINDINGS.md §6)
    authorizationLetterDocId: text("authorization_letter_doc_id"),
    spocNotes: text("spoc_notes"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    verifiedBy: text("verified_by"),
    ...timestamps,
    ...auditBy,
    ...softDelete,
  },
  (t) => [
    uniqueIndex("teams_name_lower_uq").on(sql`lower(${t.name})`),
    index("teams_institution_idx").on(t.institutionId, t.status),
    index("teams_leader_idx").on(t.leaderUserId),
    index("teams_status_idx").on(t.status),
  ]
);

export const teamMembers = pgTable(
  "team_members",
  {
    id: pk(),
    teamId: uuid("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    role: teamMemberRole("role").notNull(),
    status: teamMemberStatus("status").notNull().default("invited"),
    invitedAt: timestamp("invited_at", { withTimezone: true }).notNull().defaultNow(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    ...timestamps,
    ...auditBy,
  },
  (t) => [
    uniqueIndex("team_members_team_user_uq").on(t.teamId, t.userId),
    index("team_members_user_idx").on(t.userId),
  ]
);

export const teamProblems = pgTable(
  "team_problems",
  {
    id: pk(),
    teamId: uuid("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
    problemId: uuid("problem_id").notNull().references(() => problemStatements.id, { onDelete: "restrict" }),
    isPrimary: boolean("is_primary").notNull().default(false),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("team_problems_team_problem_uq").on(t.teamId, t.problemId),
    index("team_problems_problem_idx").on(t.problemId),
  ]
);

/** Generic file storage, owned by a team or a proposal (brief S2/S10). */
export const documentPurpose = pgEnum("document_purpose", [
  "authorization_letter",
  "consent_form",
  "proposal_presentation",
  "project_report",
  "demo_video",
  "other",
]);

export const documents = pgTable(
  "documents",
  {
    id: pk(),
    ownerKind: text("owner_kind").notNull(),
    ownerId: text("owner_id").notNull(),
    uploaderId: uuid("uploader_id").references(() => users.id, { onDelete: "set null" }),
    purpose: documentPurpose("purpose").notNull().default("other"),
    originalFilename: text("original_filename").notNull(),
    storedFilename: text("stored_filename").notNull(),
    mimeDetected: text("mime_detected").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    sha256: text("sha256").notNull(),
    storageKey: text("storage_key").notNull(),
    status: text("status").notNull().default("active"),
    ...timestamps,
    ...auditBy,
    ...softDelete,
  },
  (t) => [
    index("documents_owner_idx").on(t.ownerKind, t.ownerId),
    check("documents_owner_kind_chk", sql`owner_kind in ('team','proposal')`),
    check("documents_status_chk", sql`status in ('active','replaced','deleted')`),
    check("documents_size_chk", sql`size_bytes > 0`),
  ]
);

export const mentorships = pgTable(
  "mentorships",
  {
    id: pk(),
    mentorUserId: uuid("mentor_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    teamId: uuid("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("active"),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    ...timestamps,
    ...auditBy,
  },
  (t) => [
    uniqueIndex("mentorships_mentor_team_uq").on(t.mentorUserId, t.teamId),
    index("mentorships_team_idx").on(t.teamId),
  ]
);

/** Mentor feedback — kept separate from evaluation scores (brief §5.1). */
export const mentorFeedback = pgTable(
  "mentor_feedback",
  {
    id: pk(),
    mentorshipId: uuid("mentorship_id").notNull().references(() => mentorships.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    ...timestamps,
    ...auditBy,
  },
  (t) => [index("mentor_feedback_ms_idx").on(t.mentorshipId, t.createdAt)]
);
