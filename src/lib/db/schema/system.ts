import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./identity";
import { auditBy, pk, softDelete, timestamps } from "./_common";

/**
 * All event rules live in the DB, admin-editable (brief §5.2):
 * registration_mode, team composition, caps, deadlines (rounds table),
 * feature flags, templates, contacts. Values are validated by Zod at the
 * API boundary (P3+); this table is the store.
 */
export const settings = pgTable(
  "settings",
  {
    key: text("key").primaryKey(),
    value: jsonb("value").notNull(),
    description: text("description"),
    ...timestamps,
    ...auditBy,
  }
);

export const featureFlags = pgTable(
  "feature_flags",
  {
    key: text("key").primaryKey(),
    isEnabled: boolean("is_enabled").notNull().default(false),
    description: text("description"),
    updatedBy: text("updated_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  }
);

export const announcements = pgTable(
  "announcements",
  {
    id: pk(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    // audience: public | participants | spocs | mentors | evaluators | admins
    audience: text("audience").notNull().default("public"),
    isPinned: boolean("is_pinned").notNull().default(false),
    status: text("status").notNull().default("draft"),
    publishAt: timestamp("publish_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    ...timestamps,
    ...auditBy,
    ...softDelete,
  },
  (t) => [
    index("announcements_status_publish_idx").on(t.status, t.publishAt),
    check(
      "announcements_status_chk",
      sql`status in ('draft','scheduled','published','archived')`
    ),
    check(
      "announcements_audience_chk",
      sql`audience in ('public','participants','spocs','mentors','evaluators','admins')`
    ),
  ]
);

/** In-app notifications first; email is a queued side-channel (brief §5.4/S7). */
export const notifications = pgTable(
  "notifications",
  {
    id: pk(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    data: jsonb("data").notNull().default({}),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("notifications_user_unread_idx").on(t.userId).where(sql`read_at is null`),
    index("notifications_user_idx").on(t.userId, t.createdAt),
  ]
);

/**
 * Queued email with retry, backoff, delivery status (brief §5.4).
 * Request handlers never send mail directly — they enqueue.
 */
export const emailQueue = pgTable(
  "email_queue",
  {
    id: pk(),
    toEmail: text("to_email").notNull(),
    subject: text("subject").notNull(),
    bodyText: text("body_text").notNull(),
    bodyHtml: text("body_html"),
    priority: integer("priority").notNull().default(0),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    lastError: text("last_error"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("email_queue_work_idx").on(t.status, t.nextAttemptAt),
    check(
      "email_queue_status_chk",
      sql`status in ('pending','sending','sent','failed','bounced','canceled')`
    ),
  ]
);

/**
 * Append-only audit log (brief §5.4). UPDATE/DELETE blocked by DB trigger
 * (see migration hand-edit). requestId correlates with structured logs.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: pk(),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    actorIp: text("actor_ip"),
    requestId: text("request_id"),
    action: text("action").notNull(),
    entityKind: text("entity_kind"),
    entityId: text("entity_id"),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_entity_idx").on(t.entityKind, t.entityId),
    index("audit_actor_idx").on(t.actorUserId, t.createdAt),
    index("audit_created_idx").on(t.createdAt),
  ]
);

/** CMS with drafts and versions (brief §5.4). */
export const cmsPages = pgTable(
  "cms_pages",
  {
    id: pk(),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    bodyMarkdown: text("body_markdown").notNull(),
    status: text("status").notNull().default("draft"),
    version: integer("version").notNull().default(1),
    publishedVersion: integer("published_version"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    ...timestamps,
    ...auditBy,
    ...softDelete,
  },
  (t) => [
    uniqueIndex("cms_pages_slug_uq").on(t.slug),
    check("cms_pages_status_chk", sql`status in ('draft','published')`),
  ]
);

/** CSV import jobs: preview → row errors → transactional commit (brief §5.4). */
export const importJobs = pgTable(
  "import_jobs",
  {
    id: pk(),
    kind: text("kind").notNull(),
    originalFilename: text("original_filename").notNull(),
    storageKey: text("storage_key").notNull(),
    status: text("status").notNull().default("previewing"),
    totalRows: integer("total_rows"),
    okRows: integer("ok_rows"),
    errorRows: integer("error_rows"),
    rowErrors: jsonb("row_errors").notNull().default([]),
    committedAt: timestamp("committed_at", { withTimezone: true }),
    rolledBackAt: timestamp("rolled_back_at", { withTimezone: true }),
    ...timestamps,
    ...auditBy,
  },
  () => [
    check(
      "import_jobs_status_chk",
      sql`status in ('previewing','processing','committed','rolled_back','failed')`
    ),
  ]
);

/** CSV export jobs (SPOC/admin analytics, brief §5.1). */
export const exportJobs = pgTable(
  "export_jobs",
  {
    id: pk(),
    kind: text("kind").notNull(),
    requesterId: uuid("requester_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    status: text("status").notNull().default("pending"),
    rowCount: integer("row_count"),
    storageKey: text("storage_key"),
    error: text("error"),
    ...timestamps,
    ...auditBy,
  },
  () => [
    check(
      "export_jobs_status_chk",
      sql`status in ('pending','running','done','failed')`
    ),
  ]
);

/**
 * Sliding-window rate limit buckets keyed by (hash(clientIp+scope), window).
 * Client IP is derived from trusted-proxy config (brief S8), never from a
 * raw x-forwarded-for header.
 */
export const ipRateLimits = pgTable(
  "ip_rate_limits",
  {
    bucketKey: text("bucket_key").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(1),
  },
  (t) => [
    primaryKey({ name: "ip_rate_limits_pk", columns: [t.bucketKey, t.windowStart] }),
  ]
);
