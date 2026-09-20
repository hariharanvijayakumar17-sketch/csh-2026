// NOTE: no `import "server-only"` — this client is also imported by CLI
// scripts (db:seed, drizzle) under plain node where Next does not resolve the
// package. Auth modules (route-only) keep their server-only guards.
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgres://csh_dev:csh_dev_local_only@127.0.0.1:5432/csh2026_dev";

/**
 * Single shared connection pool (Node process level).
 * Pool is intentionally small: one Node process per VM, PG on the same box
 * (PROVIDER_RESEARCH.md §9: pool=20 against default max_connections=100).
 */
const globalForDb = globalThis as unknown as {
  cshPool?: postgres.Sql;
};

export const sql =
  globalForDb.cshPool ??
  postgres(DATABASE_URL, {
    max: 20,
    idle_timeout: 30,
    connect_timeout: 10,
    onnotice: () => {},
  });

if (process.env.NODE_ENV !== "production") globalForDb.cshPool = sql;

export const db = drizzle(sql, { schema });
