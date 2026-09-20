import { timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Shared column factories (brief §5.5): UUID keys, timestamps,
 * created_by/updated_by, soft delete where sensible.
 */

export const pk = () => uuid("id").primaryKey().defaultRandom();

export const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const auditBy = {
  createdBy: uuid("created_by"),
  updatedBy: uuid("updated_by"),
};

/** Soft delete (brief §5.5 "where sensible"). */
export const softDelete = {
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
};
