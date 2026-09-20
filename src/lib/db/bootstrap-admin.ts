/**
 * One-time super-admin bootstrap (brief: "no default/predictable production
 * credentials"). CLI-only; the admin identity comes from ENV, never from
 * code.
 *
 *   ADMIN_EMAIL=ops@example.com ADMIN_PASSWORD='…12+ chars…' npm run db:bootstrap-admin
 *
 * Fails if the email already exists (refuses to silently re-point the
 * super-admin role) or if the password does not meet strength rules.
 */
import { eq, sql } from "drizzle-orm";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";
import { hashPassword, passwordStrengthIssues } from "../auth/password";

const URL =
  process.env.DATABASE_URL ??
  "postgres://csh_dev:***@127.0.0.1:5432/csh2026_dev";

async function main() {
  const email = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? "";
  if (!email) {
    console.error("ADMIN_EMAIL is required");
    process.exit(1);
  }
  if (!password) {
    console.error("ADMIN_PASSWORD is required (set it in the environment; never commit it)");
    process.exit(1);
  }
  const issues = passwordStrengthIssues(password);
  if (issues.length > 0) {
    console.error(`ADMIN_PASSWORD rejected — needs: ${issues.join("; ")}`);
    process.exit(1);
  }

  const raw = postgres(URL, { max: 2 });
  try {
    const db = drizzle(raw, { schema });
    const existing = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(sql`lower(${schema.users.email})`, email))
      .limit(1);
    if (existing.length > 0) {
      console.error("a user with this email already exists — refusing (no silent role re-point)");
      process.exit(1);
    }
    await db.insert(schema.users).values({
      email,
      passwordHash: await hashPassword(password),
      fullName: "Super Admin",
      role: "super_admin",
      emailVerifiedAt: new Date(),
    });
    console.log(`super-admin created: ${email} (password from env, never logged again)`);
  } finally {
    await raw.end();
  }
}

const isMain = process.argv[1] && process.argv[1].endsWith("bootstrap-admin.ts");
if (isMain) void main();
