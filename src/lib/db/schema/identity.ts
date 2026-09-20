import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { auditBy, pk, softDelete, timestamps } from "./_common";

export const userRole = pgEnum("user_role", [
  "super_admin",
  "spoc",
  "problem_creator",
  "mentor",
  "evaluator",
  "participant",
]);

export const institutions = pgTable(
  "institutions",
  {
    id: pk(),
    name: text("name").notNull(),
    code: text("code").notNull(),
    city: text("city"),
    state: text("state"),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
    ...auditBy,
    ...softDelete,
  },
  (t) => [
    uniqueIndex("institutions_code_uq").on(t.code),
    index("institutions_name_idx").on(t.name),
  ]
);

export const users = pgTable(
  "users",
  {
    id: pk(),
    institutionId: uuid("institution_id").references(() => institutions.id, {
      onDelete: "restrict",
    }),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    fullName: text("full_name").notNull(),
    collegeId: text("college_id"),
    department: text("department"),
    phone: text("phone"),
    role: userRole("role").notNull().default("participant"),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    mustChangePassword: boolean("must_change_password").notNull().default(false),
    failedAttempts: integer("failed_attempts").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    ...timestamps,
    ...auditBy,
    ...softDelete,
  },
  (t) => [
    uniqueIndex("users_email_lower_uq").on(sql`lower(${t.email})`),
    index("users_institution_idx").on(t.institutionId),
    index("users_role_idx").on(t.role),
    index("users_collegeid_idx").on(t.collegeId),
  ]
);

export const userSessions = pgTable(
  "user_sessions",
  {
    id: pk(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    // sha256 hex of the session token — sessions stored hashed (brief S9)
    tokenHash: text("token_hash").notNull(),
    userAgent: text("user_agent"),
    ip: text("ip"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("sessions_token_hash_uq").on(t.tokenHash),
    index("sessions_user_idx").on(t.userId, t.createdAt),
    index("sessions_expiry_idx").on(t.expiresAt),
  ]
);

export const emailVerificationTokens = pgTable(
  "email_verification_tokens",
  {
    id: pk(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    // hashed, expiring, single-use (brief S7)
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("email_verify_token_hash_uq").on(t.tokenHash),
    index("email_verify_user_idx").on(t.userId),
  ]
);

export const passwordResetTokens = pgTable(
  "password_reset_tokens",
  {
    id: pk(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("pwreset_token_hash_uq").on(t.tokenHash),
    index("pwreset_user_idx").on(t.userId),
  ]
);
