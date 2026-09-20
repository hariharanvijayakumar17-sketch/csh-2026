import {
  boolean,
  customType,
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
import { teams } from "./teams";
import { users } from "./identity";
import { auditBy, pk, softDelete, timestamps } from "./_common";

/** drizzle 0.45's pg-core does not export tsvector; minimal custom type. */
const tsvectorColumnType = customType<{ data: string; driverData: string }>({
  dataType() {
    return "tsvector";
  },
});

export const problemStatus = pgEnum("problem_status", [
  "draft",
  "pending_review",
  "approved",
  "published",
  "closed",
  "archived",
]);

export const problemDifficulty = pgEnum("problem_difficulty", [
  "easy",
  "medium",
  "hard",
]);

export const problemStatements = pgTable(
  "problem_statements",
  {
    id: pk(),
    // human-friendly public id, e.g. PS-2026-0001 (brief §5.4)
    code: text("code").notNull(),
    title: text("title").notNull(),
    department: text("department"),
    theme: text("theme"),
    category: text("category"),
    description: text("description").notNull(),
    background: text("background"),
    expectedSolution: text("expected_solution"),
    tags: text("tags").array(),
    difficulty: problemDifficulty("difficulty").notNull().default("medium"),
    status: problemStatus("status").notNull().default("draft"),
    // per-problem cap (SIH: 500 ideas then frozen; CSH: DB setting per PS)
    maxSubmissions: integer("max_submissions"),
    creatorUserId: uuid("creator_user_id").references(() => users.id, { onDelete: "set null" }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    // full-text search (brief §5.5): kept in sync by trigger (see migration)
    searchVector: tsvectorColumnType("search_vector").notNull(),
    ...timestamps,
    ...auditBy,
    ...softDelete,
  },
  (t) => [
    uniqueIndex("ps_code_uq").on(t.code),
    index("ps_status_idx").on(t.status),
    index("ps_theme_dept_idx").on(t.theme, t.department),
    index("ps_difficulty_idx").on(t.difficulty),
  ]
);

export const clarifications = pgTable(
  "clarifications",
  {
    id: pk(),
    problemId: uuid("problem_id").notNull().references(() => problemStatements.id, { onDelete: "cascade" }),
    question: text("question").notNull(),
    answer: text("answer"),
    postedBy: uuid("posted_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
    ...auditBy,
    ...softDelete,
  },
  (t) => [index("clarifications_problem_idx").on(t.problemId, t.createdAt)]
);

export const rounds = pgTable(
  "rounds",
  {
    id: pk(),
    name: text("name").notNull(),
    ordinal: integer("ordinal").notNull(),
    status: text("status").notNull().default("draft"),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    ...timestamps,
    ...auditBy,
  },
  (t) => [
    uniqueIndex("rounds_ordinal_uq").on(t.ordinal),
    index("rounds_status_idx").on(t.status),
  ]
);

/**
 * Weighted criteria per round. Weights must total exactly 100 —
 * validated server-side on create/edit/activate (brief §5.2) and
 * guarded per-row by check constraints (0..100).
 */
export const roundCriteria = pgTable(
  "round_criteria",
  {
    id: pk(),
    roundId: uuid("round_id").notNull().references(() => rounds.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    weight: numeric("weight", { precision: 5, scale: 2 }).notNull(),
    ordinal: integer("ordinal").notNull(),
    ...timestamps,
    ...auditBy,
  },
  (t) => [
    uniqueIndex("round_criteria_round_ordinal_uq").on(t.roundId, t.ordinal),
    index("round_criteria_round_idx").on(t.roundId),
  ]
);

export const proposalStatus = pgEnum("proposal_status", [
  "draft",
  "submitted",
  "under_review",
  "changes_requested",
  "approved",
  "shortlisted",
  "rejected",
  "locked",
]);

export const proposals = pgTable(
  "proposals",
  {
    id: pk(),
    teamId: uuid("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
    problemId: uuid("problem_id").references(() => problemStatements.id, { onDelete: "set null" }), // null = open innovation (brief §5.2)
    roundId: uuid("round_id").notNull().references(() => rounds.id, { onDelete: "restrict" }),
    status: proposalStatus("status").notNull().default("draft"),
    title: text("title").notNull(),
    // version_no that is currently editable (DRAFT) or the submitted one
    currentVersion: integer("current_version").notNull().default(0),
    finalVersionId: text("final_version_id"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    ...timestamps,
    ...auditBy,
    ...softDelete,
  },
  (t) => [
    index("proposals_team_round_idx").on(t.teamId, t.roundId),
    index("proposals_problem_status_idx").on(t.problemId, t.status),
    index("proposals_status_idx").on(t.status),
  ]
);

/**
 * IMMUTABLE proposal versions (brief §5.4). A version row, once submitted,
 * is never updated — corrections create a new version. Enforced in app code
 * (no update API) + integration test; re-open only via authorised admin.
 */
export const proposalVersions = pgTable(
  "proposal_versions",
  {
    id: pk(),
    proposalId: uuid("proposal_id").notNull().references(() => proposals.id, { onDelete: "cascade" }),
    versionNo: integer("version_no").notNull(),
    title: text("title").notNull(),
    abstract: text("abstract"),
    problemUnderstanding: text("problem_understanding"),
    solution: text("solution").notNull(),
    innovation: text("innovation"),
    architecture: text("architecture"),
    techStack: text("tech_stack"),
    plan: text("plan"),
    impact: text("impact"),
    feasibility: text("feasibility"),
    sustainability: text("sustainability"),
    futureScope: text("future_scope"),
    isFinal: boolean("is_final").notNull().default(false),
    ...timestamps,
    ...auditBy,
  },
  (t) => [
    uniqueIndex("proposal_versions_proposal_no_uq").on(t.proposalId, t.versionNo),
    index("proposal_versions_proposal_idx").on(t.proposalId),
  ]
);
