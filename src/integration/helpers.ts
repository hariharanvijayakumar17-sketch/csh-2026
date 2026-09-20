import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { sql } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { hashPassword } from "@/lib/auth/password";
import { seedDefaultSettings } from "@/lib/settings";

/** Shared boot for P5+ integration suites (serial — see vitest.int.config). */

export const TEST_URL =
  process.env.DATABASE_URL_TEST ??
  "postgres://csh_dev:***@127.0.0.1:5432/csh2026_test";

export type TestDb = { raw: postgres.Sql; db: ReturnType<typeof drizzle<typeof schema>> };

export async function bootDb(): Promise<TestDb> {
  const admin = postgres(TEST_URL, { max: 1 });
  await admin`drop schema if exists drizzle cascade`;
  await admin`drop schema if exists public cascade`;
  await admin`create schema public`;
  await admin.end();
  const raw = postgres(TEST_URL, { max: 10 });
  const db = drizzle(raw, { schema });
  await migrate(db, { migrationsFolder: "./drizzle" });
  await seedDefaultSettings();
  return { raw, db };
}

let n = 0;
const stamp = Date.now().toString(36);
export function email(prefix: string) {
  n += 1;
  return `${prefix}.${stamp}.${n}@p5.test`;
}

export async function makeInstitution(db: TestDb["db"], name?: string) {
  const s = name ?? `Inst ${stamp} ${Math.random().toString(36).slice(2, 6)}`;
  const [row] = await db
    .insert(schema.institutions)
    .values({ name: s, code: `P5-${stamp}-${Math.random().toString(36).slice(2, 8)}` })
    .returning({ id: schema.institutions.id });
  return row.id;
}

export async function makeUser(
  db: TestDb["db"],
  opts: {
    prefix: string;
    role?: string;
    gender?: "female" | "male" | "other";
    institutionId?: string | null;
    pw?: string;
  }
) {
  const [row] = await db
    .insert(schema.users)
    .values({
      email: email(opts.prefix),
      passwordHash: await hashPassword(opts.pw ?? "Passw0rd!xyz"),
      fullName: `${opts.prefix} ${stamp}`,
      role: (opts.role ?? "participant") as never,
      gender: opts.gender,
      institutionId: opts.institutionId ?? null,
      emailVerifiedAt: new Date(),
    })
    .returning({
      id: schema.users.id,
      email: schema.users.email,
      role: schema.users.role,
      gender: schema.users.gender,
      institutionId: schema.users.institutionId,
    });
  return row;
}

export async function makeProblem(db: TestDb["db"], title?: string) {
  const code = `PS-P5-${stamp}-${Math.random().toString(36).slice(2, 8)}`;
  const [row] = await db
    .insert(schema.problemStatements)
    .values({
      code,
      title: title ?? `P5 problem ${Math.random().toString(36).slice(2, 6)}`,
      description: "P5 test problem",
      status: "published",
      publishedAt: new Date(),
      searchVector: sql`to_tsvector('english', 'P5 test problem')`,
    })
    .returning({ id: schema.problemStatements.id, code: schema.problemStatements.code });
  return row;
}

/** Round in status 'active' with weights summing to 100 (set directly — the
 * activation service is P3 addendum territory, not under test here). */
export async function makeActiveRound(db: TestDb["db"]) {
  const [round] = await db
    .insert(schema.rounds)
    .values({ name: `P5 round ${stamp}`, ordinal: 9000 + Math.floor(Math.random() * 999) })
    .returning({ id: schema.rounds.id });
  await db.insert(schema.roundCriteria).values([
    { roundId: round.id, name: "innovation", weight: "50", ordinal: 1 },
    { roundId: round.id, name: "feasibility", weight: "30", ordinal: 2 },
    { roundId: round.id, name: "impact", weight: "20", ordinal: 3 },
  ]);
  await db.update(schema.rounds).set({ status: "active", startsAt: new Date(Date.now() - 3600e3), endsAt: new Date(Date.now() + 30 * 86400e3) }).where(eq(schema.rounds.id, round.id));
  return round.id;
}
