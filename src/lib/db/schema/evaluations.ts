import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./identity";
import { rounds, problemStatements, proposals, roundCriteria } from "./problems";
import { teams } from "./teams";
import { auditBy, pk, timestamps } from "./_common";

export const evaluationStatus = pgEnum("evaluation_status", [
  "assigned",
  "in_progress",
  "submitted",
  "locked",
  "reopened",
]);

export const conflictLevel = pgEnum("conflict_level", [
  "potential",
  "conflict",
]);

/**
 * One evaluator x proposal x round (brief S4/S5).
 * Saves + final submit run in ONE transaction, every criterion scored,
 * unmodifiable after submit until admin reopens — enforced in app code
 * (P7) with integration tests; DB gives the immutable state column set.
 */
export const evaluations = pgTable(
  "evaluations",
  {
    id: pk(),
    proposalId: uuid("proposal_id").notNull().references(() => proposals.id, { onDelete: "cascade" }),
    roundId: uuid("round_id").notNull().references(() => rounds.id, { onDelete: "restrict" }),
    evaluatorUserId: uuid("evaluator_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    status: evaluationStatus("status").notNull().default("assigned"),
    // conflict declaration (brief S5): blocks scoring, notifies admins
    conflict: conflictLevel("conflict"),
    conflictDeclaredAt: timestamp("conflict_declared_at", { withTimezone: true }),
    overallComments: text("overall_comments"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    reopenedAt: timestamp("reopened_at", { withTimezone: true }),
    ...timestamps,
    ...auditBy,
  },
  (t) => [
    uniqueIndex("evaluations_proposal_round_eval_uq").on(
      t.proposalId,
      t.roundId,
      t.evaluatorUserId
    ),
    index("evaluations_evaluator_idx").on(t.evaluatorUserId, t.status),
    index("evaluations_round_idx").on(t.roundId),
    check(
      "evaluations_conflict_chk",
      sql`conflict is null or conflict in ('potential','conflict')`
    ),
  ]
);

/** Score per criterion for an evaluation; 0..100 per criterion. */
export const evaluationScores = pgTable(
  "evaluation_scores",
  {
    id: pk(),
    evaluationId: uuid("evaluation_id").notNull().references(() => evaluations.id, { onDelete: "cascade" }),
    criterionId: uuid("criterion_id").notNull().references(() => roundCriteria.id, { onDelete: "restrict" }),
    score: numeric("score", { precision: 5, scale: 2 }).notNull(),
    comments: text("comments"),
    ...timestamps,
    ...auditBy,
  },
  (t) => [
    uniqueIndex("eval_scores_eval_criterion_uq").on(t.evaluationId, t.criterionId),
    index("eval_scores_criterion_idx").on(t.criterionId),
    check("eval_scores_range_chk", sql`score >= 0 and score <= 100`),
  ]
);

export const awardKind = pgEnum("award_kind", [
  "winner",
  "runner_up_1",
  "runner_up_2",
  "participation",
  "shortlisted",
  "none",
]);

/** Results workflow output; participants never see unpublished rows (P7). */
export const results = pgTable(
  "results",
  {
    id: pk(),
    roundId: uuid("round_id").notNull().references(() => rounds.id, { onDelete: "restrict" }),
    problemId: uuid("problem_id").references(() => problemStatements.id, { onDelete: "set null" }),
    teamId: uuid("team_id").notNull().references(() => teams.id, { onDelete: "restrict" }),
    rank: integer("rank"),
    award: awardKind("award").notNull().default("none"),
    isPublished: boolean("is_published").notNull().default(false),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    ...timestamps,
    ...auditBy,
  },
  (t) => [
    uniqueIndex("results_round_problem_team_uq").on(t.roundId, t.problemId, t.teamId),
    index("results_team_idx").on(t.teamId),
    index("results_published_idx").on(t.isPublished, t.publishedAt),
  ]
);

/**
 * Certificates: templated PDF, unique ID, public verify page shows only
 * validity, name, team, event, award, date, ID (brief §5.4).
 */
export const certificates = pgTable(
  "certificates",
  {
    id: pk(),
    certificateNo: text("certificate_no").notNull(),
    resultId: uuid("result_id").references(() => results.id, { onDelete: "set null" }),
    teamId: uuid("team_id").notNull().references(() => teams.id, { onDelete: "restrict" }),
    recipientDisplay: text("recipient_display").notNull(),
    award: awardKind("award").notNull(),
    eventLabel: text("event_label").notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
    pdfStorageKey: text("pdf_storage_key").notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ...timestamps,
    ...auditBy,
  },
  (t) => [
    uniqueIndex("certificates_no_uq").on(t.certificateNo),
    index("certificates_team_idx").on(t.teamId),
    index("certificates_result_idx").on(t.resultId),
  ]
);

/**
 * Append-only status history for every state machine (brief §5.3):
 * entity_kind in ('team','proposal','evaluation','problem').
 * UPDATE/DELETE are blocked by DB trigger (see migration hand-edit).
 */
export const statusHistories = pgTable(
  "status_histories",
  {
    id: pk(),
    entityKind: text("entity_kind").notNull(),
    entityId: text("entity_id").notNull(),
    fromStatus: text("from_status"),
    toStatus: text("to_status").notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("status_histories_entity_idx").on(t.entityKind, t.entityId, t.createdAt),
    check(
      "status_histories_kind_chk",
      sql`entity_kind in ('team','proposal','evaluation','problem')`
    ),
  ]
);
