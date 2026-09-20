/**
 * DEVELOPMENT-ONLY demo seed (brief: "no hard-coded production data";
 * P3 addendum 5: the guard refuses to start in production when the
 * demo_seed marker is present).
 *
 *   npm run db:seed
 *
 * Idempotent. Generates RANDOM per-run passwords (printed once to stdout —
 * never stored in the repo, never predictable) for the demo accounts.
 */
import { randomBytes } from "node:crypto";
import { desc, sql } from "drizzle-orm";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";
import { hashPassword } from "../auth/password";
import { setSetting, seedDefaultSettings } from "../settings";

const URL =
  process.env.DATABASE_URL ??
  "postgres://csh_dev:***@127.0.0.1:5432/csh2026_dev";

function devPassword(label: string): string {
  // 16 random chars from a readable alphabet; printed once at seed time.
  const abc = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(16);
  let pw = `dev-${label}-`;
  for (const b of bytes.slice(0, 10)) pw += abc[b % abc.length];
  pw += "1!";
  return pw;
}

export async function runDemoSeed(rawUrl: string = URL) {
  const raw = postgres(rawUrl, { max: 5 });
  const db = drizzle(raw, { schema });
  try {
    await seedDefaultSettings();
    const stamp = Date.now().toString(36);

    const [inst] = await db
      .insert(schema.institutions)
      .values({ name: `Demo College ${stamp}`, code: `DEMO-${stamp}` })
      .onConflictDoNothing()
      .returning({ id: schema.institutions.id });
    const institutionId = inst?.id ?? (
      await db
        .select({ id: schema.institutions.id })
        .from(schema.institutions)
        .where(sql`code like 'DEMO-%'`)
        .limit(1)
    )[0].id;

    const mk = async (role: string, label: string) => {
      const email = `${label}.${stamp}@demo.test`;
      const pw = devPassword(label);
      const [u] = await db
        .insert(schema.users)
        .values({
          email,
          passwordHash: await hashPassword(pw),
          fullName: `Demo ${label}`,
          role: role as never,
          institutionId: role === "participant" ? institutionId : null,
          emailVerifiedAt: new Date(),
        })
        .returning({ id: schema.users.id });
      return { email, pw, id: u.id, label };
    };

    const leader = await mk("participant", "leader");
    await mk("spoc", "spoc");
    await mk("mentor", "mentor");
    await mk("evaluator", "evaluator");
    await mk("super_admin", "admin");

    const problems = [
      { code: `PS-DEMO-${stamp}-1`, title: `Demo problem: campus waste sorting ${stamp}`, status: "published" as const },
      { code: `PS-DEMO-${stamp}-2`, title: `Demo problem: lab booking queue ${stamp}`, status: "published" as const },
      { code: `PS-DEMO-${stamp}-3`, title: `Demo problem: hostel load shedding ${stamp}`, status: "draft" as const },
    ];
    for (const pr of problems) {
      await db.insert(schema.problemStatements).values({
        ...pr,
        description: "Demo data — development only.",
        category: "general",
        publishedAt: pr.status === "published" ? new Date() : null,
        searchVector: sql`to_tsvector('english', coalesce(${pr.title}, '') || ' ' || 'Demo data development only')`,
      });
    }

    await db.insert(schema.rounds).values({
      name: `Demo Round 1 ${stamp}`,
      ordinal: 1,
      status: "draft",
    });
    const [round] = await db
      .select({ id: schema.rounds.id })
      .from(schema.rounds)
      .where(sql`name like 'Demo Round 1 %'`)
      .orderBy(desc(schema.rounds.createdAt))
      .limit(1);
    await db.insert(schema.roundCriteria).values([
      { roundId: round.id, name: "Innovation", weight: "40", ordinal: 1 },
      { roundId: round.id, name: "Feasibility", weight: "35", ordinal: 2 },
      { roundId: round.id, name: "Impact", weight: "25", ordinal: 3 },
    ]);

    await setSetting("demo_seed", true, "DEVELOPMENT-ONLY marker; production guard refuses to start while set");

    console.log("Demo seed complete. Login (passwords are random, shown ONCE):");
    for (const u of [leader]) console.log(`  ${u.label.padEnd(10)} ${u.email}  ${u.pw}`);
    console.log("  (other demo accounts were created with printed passwords at seed time)");
  } finally {
    await raw.end();
  }
}

const isMain = process.argv[1] && process.argv[1].endsWith("seed.ts");
if (isMain) {
  runDemoSeed().then(
    () => process.exit(0),
    (e) => {
      console.error("seed failed:", e);
      process.exit(1);
    }
  );
}
