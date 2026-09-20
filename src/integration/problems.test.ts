import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { eq, sql } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import {
  getProblem,
  listClarifications,
  listProblems,
} from "@/lib/problems";

/**
 * P4: public problem repository (service level, real Postgres).
 * Public surface must expose ONLY published, non-deleted problems.
 */

const TEST_URL =
  process.env.DATABASE_URL_TEST ??
  "postgres://csh_dev:***@127.0.0.1:5432/csh2026_test";

let raw: postgres.Sql;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  const admin = postgres(TEST_URL, { max: 1 });
  await admin`drop schema if exists drizzle cascade`;
  await admin`drop schema if exists public cascade`;
  await admin`create schema public`;
  await admin.end();
  raw = postgres(TEST_URL, { max: 10 });
  db = drizzle(raw, { schema });
  await migrate(db, { migrationsFolder: "./drizzle" });
}, 120000);

afterAll(async () => {
  await raw?.end();
});

const stamp = Date.now().toString(36);
const P = (n: number) => `PS-DEMO-P4-${stamp}-${n}`;

async function makeProblem(
  code: string,
  title: string,
  status: "published" | "draft" | "archived",
  extra: Partial<{ category: string; theme: string; deleted: boolean }> = {}
) {
  const [row] = await db
    .insert(schema.problemStatements)
    .values({
      code,
      title,
      description: `Desc for ${title}`,
      category: extra.category ?? "general",
      theme: extra.theme ?? "tech",
      status,
      publishedAt: status === "published" ? new Date() : null,
      searchVector: sql`to_tsvector('english', coalesce(${title}, '') || ' ' || coalesce('Desc for ' || ${title}, ''))`,
    })
    .returning({ id: schema.problemStatements.id });
  if (extra.deleted) {
    await db
      .update(schema.problemStatements)
      .set({ deletedAt: new Date() })
      .where(eq(schema.problemStatements.id, row.id));
  }
  return row.id;
}

describe("P4 public problem repository", () => {
  beforeAll(async () => {
    await makeProblem(P(1), "Solar charger for campus labs", "published", {
      category: "energy",
      theme: "sustainability",
    });
    await makeProblem(P(2), "Hostel load shedding predictor", "published", {
      category: "energy",
    });
    await makeProblem(P(3), "Campus waste sorting bot", "published", {
      category: "sustainability",
    });
    await makeProblem(P(4), "SECRET draft problem", "draft");
    await makeProblem(P(5), "Deleted published problem", "published", {
      deleted: true,
    });
  });

  it("lists ONLY published, non-deleted problems", async () => {
    const r = await listProblems();
    expect(r.total).toBe(3);
    const codes = r.items.map((i) => i.code).sort();
    expect(codes).toEqual([P(1), P(2), P(3)].sort());
  });

  it("search filters by title/description/code (case-insensitive)", async () => {
    const r = await listProblems({ q: "hostel" });
    expect(r.items.map((i) => i.code)).toEqual([P(2)]);
    const byCode = await listProblems({ q: P(3).slice(0, 14) });
    expect(byCode.items.map((i) => i.code)).toContain(P(3));
  });

  it("filters by category and theme", async () => {
    const energy = await listProblems({ category: "energy" });
    expect(energy.items.map((i) => i.code).sort()).toEqual([P(1), P(2)].sort());
    const sus = await listProblems({ theme: "sustainability" });
    expect(sus.items.map((i) => i.code)).toEqual([P(1)]);
  });

  it("paginates with correct totals", async () => {
    const p1 = await listProblems({ page: 1, pageSize: 2 });
    expect(p1.items.length).toBe(2);
    expect(p1.total).toBe(3);
    const p2 = await listProblems({ page: 2, pageSize: 2 });
    expect(p2.items.length).toBe(1);
    const p3 = await listProblems({ page: 3, pageSize: 2 });
    expect(p3.items.length).toBe(0);
  });

  it("getProblem by code AND by uuid; draft returns null (public view)", async () => {
    const byCode = await getProblem(P(1));
    expect(byCode?.title).toBe("Solar charger for campus labs");
    const [row] = await db
      .select({ id: schema.problemStatements.id })
      .from(schema.problemStatements)
      .where(eq(schema.problemStatements.code, P(1)));
    const byUuid = await getProblem(row.id);
    expect(byUuid?.code).toBe(P(1));
    const draftId = await makeProblem(P(9), "another draft", "draft");
    expect(await getProblem(P(9))).toBeNull();
    void draftId;
    expect(await getProblem("PS-NOPE-0000")).toBeNull();
  });

  it("clarifications: visible for published problems, hidden for drafts", async () => {
    const pubId = (
      await db
        .select({ id: schema.problemStatements.id })
        .from(schema.problemStatements)
        .where(eq(schema.problemStatements.code, P(1)))
    )[0].id;
    await db.insert(schema.clarifications).values([
      { problemId: pubId, question: "Is a demo required?", answer: "A working prototype is required." },
      { problemId: pubId, question: "Team size?", answer: null },
    ]);
    const cl = await listClarifications(pubId);
    expect(cl.length).toBe(2);
    expect(cl[0].answer).toBe("A working prototype is required.");
    expect(cl[1].answer).toBeNull();

    const draftId = (
      await db
        .select({ id: schema.problemStatements.id })
        .from(schema.problemStatements)
        .where(eq(schema.problemStatements.code, P(9)))
    )[0].id;
    await db.insert(schema.clarifications).values({
      problemId: draftId,
      question: "draft clarification must not be public",
    });
    expect(await listClarifications(draftId)).toEqual([]);
    // unknown problem id
    expect(
      await listClarifications("00000000-0000-0000-0000-000000000000")
    ).toEqual([]);
  });
});
