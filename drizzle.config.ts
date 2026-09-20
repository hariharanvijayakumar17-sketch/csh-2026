import { defineConfig } from "drizzle-kit";

/**
 * Drizzle Kit config (migrations only — brief §5.5: committed migrations,
 * never schema push in production).
 *
 * NOTE: the generated 0000 migration is hand-augmented with raw SQL that
 * drizzle-kit cannot express (FTS sync trigger + GIN index, append-only
 * triggers on audit_log/status_histories). Do NOT delete those sections
 * when generating subsequent migrations (new generates create NEW files).
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/lib/db/schema/index.ts",
  out: "./drizzle",
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      "postgres://csh_dev:csh_dev_local_only@127.0.0.1:5432/csh2026_dev",
  },
  verbose: true,
  strict: true,
});
