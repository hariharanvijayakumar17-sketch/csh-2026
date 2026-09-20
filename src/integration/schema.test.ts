import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "@/lib/db/schema";

/**
 * P2 integration test (real Postgres, throwaway schema; committed
 * migrations only — brief §5.5/§9).
 *
 * Constraint-rejection assertions use the RAW driver (not drizzle) because
 * drizzle wraps driver errors as "Failed query: …" and hides the PG error
 * message; the raw PostgresError carries the constraint name we must prove.
 */

const TEST_URL =
  process.env.DATABASE_URL_TEST ??
  "postgres://csh_dev:***@127.0.0.1:5432/csh2026_test";

let admin: postgres.Sql;
let raw: postgres.Sql;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  admin = postgres(TEST_URL, { max: 1 });
  // NOTE: drizzle's migrator tracks applied migrations in the "drizzle"
  // schema (not public) — both must be dropped for a clean re-apply.
  await admin`drop schema if exists drizzle cascade`;
  await admin`drop schema if exists public cascade`;
  await admin`create schema public`;
  raw = postgres(TEST_URL, { max: 10 });
  db = drizzle(raw, { schema });
  await migrate(db, { migrationsFolder: "./drizzle" });
}, 120000);

afterAll(async () => {
  await raw?.end();
  await admin?.end();
});

/** Run a raw statement; assert it fails with a message matching `re`. */
async function expectDbError(query: () => Promise<unknown>, re: RegExp) {
  let threw: unknown;
  try {
    await query();
  } catch (e) {
    threw = e;
  }
  expect(threw, "expected the statement to fail").toBeInstanceOf(Error);
  expect((threw as Error).message).toMatch(re);
}

async function seedBase() {
  const n = Math.random().toString(36).slice(2, 10);
  const instName = `College ${n}`;
  const instCode = `C-${n}`;
  const leaderEmail = `leader.${n}@example.test`;
  const memberEmail = `member.${n}@example.test`;
  const inst = (
    await raw`insert into institutions (name, code) values (${instName}, ${instCode}) returning id`
  )[0].id as string;
  const leader = (
    await raw`insert into users (institution_id, email, password_hash, full_name)
      values (${inst}::uuid, ${leaderEmail}, 'x', 'Leader One') returning id`
  )[0].id as string;
  const member = (
    await raw`insert into users (institution_id, email, password_hash, full_name)
      values (${inst}::uuid, ${memberEmail}, 'x', 'Member One') returning id`
  )[0].id as string;
  return { inst, leader, member, n };
}

describe("P2 schema constraints (real Postgres)", () => {
  it("rejects duplicate emails case-insensitively", async () => {
    const { inst, n } = await seedBase();
    const firstEmail = `dup.${n}@example.test`;
    const dupEmail = `DUP.${n}@example.test`;
    await raw`insert into users (institution_id, email, password_hash, full_name)
      values (${inst}::uuid, ${firstEmail}, 'x', 'First')`;
    await expectDbError(
      () =>
        raw`insert into users (institution_id, email, password_hash, full_name)
      values (${inst}::uuid, ${dupEmail}, 'x', 'Clone')`,
      /users_email_lower_uq/i
    );
  });

  it("enforces team name uniqueness (case-insensitive) and default status draft", async () => {
    const { inst, leader } = await seedBase();
    const team = (
      await raw`insert into teams (institution_id, name, leader_user_id)
      values (${inst}::uuid, 'ByteBlitz', ${leader}::uuid) returning id, status`
    )[0] as { id: string; status: string };
    expect(team.status).toBe("draft");
    await expectDbError(
      () =>
        raw`insert into teams (institution_id, name, leader_user_id)
      values (${inst}::uuid, 'byteblitz', ${leader}::uuid)`,
      /teams_name_lower_uq/i
    );
  });

  it("enforces FK integrity: team must belong to a real institution", async () => {
    const { leader } = await seedBase();
    await expectDbError(
      () =>
        raw`insert into teams (institution_id, name, leader_user_id)
      values ('00000000-0000-0000-0000-000000000000', 'GhostTeam', ${leader}::uuid)`,
      /foreign key|institutions/i
    );
  });

  it("enforces unique (team, user) membership", async () => {
    const { inst, leader, member } = await seedBase();
    const team = (
      await raw`insert into teams (institution_id, name, leader_user_id)
      values (${inst}::uuid, 'Duo', ${leader}::uuid) returning id`
    )[0].id as string;
    await raw`insert into team_members (team_id, user_id, role) values (${team}::uuid, ${member}::uuid, 'member')`;
    await expectDbError(
      () =>
        raw`insert into team_members (team_id, user_id, role) values (${team}::uuid, ${member}::uuid, 'member')`,
      /team_members_team_user_uq/i
    );
  });

  it("rejects invalid document owner kind via check constraint", async () => {
    const { leader } = await seedBase();
    await expectDbError(
      () =>
        raw`insert into documents (owner_kind, owner_id, original_filename, stored_filename, mime_detected, size_bytes, sha256, storage_key, uploader_id)
      values ('planet', '11111111-1111-1111-1111-111111111111', 'a.pdf', 'a.pdf', 'application/pdf', 10, 'abc', 'k', ${leader}::uuid)`,
      /documents_owner_kind_chk/i
    );
  });

  it("blocks UPDATE and DELETE on audit_log (append-only trigger)", async () => {
    const row = (
      await raw`insert into audit_log (action, entity_kind, entity_id) values ('test.bootstrap', 'team', 'x') returning id`
    )[0].id as string;
    await expectDbError(
      () => raw`update audit_log set action = 'tampered' where id = ${row}::uuid`,
      /append-only/i
    );
    await expectDbError(
      () => raw`delete from audit_log where id = ${row}::uuid`,
      /append-only/i
    );
  });

  it("blocks UPDATE and DELETE on status_histories (append-only trigger)", async () => {
    const row = (
      await raw`insert into status_histories (entity_kind, entity_id, to_status) values ('team', 'x', 'draft') returning id`
    )[0].id as string;
    await expectDbError(
      () => raw`update status_histories set to_status = 'winner' where id = ${row}::uuid`,
      /append-only/i
    );
    await expectDbError(
      () => raw`delete from status_histories where id = ${row}::uuid`,
      /append-only/i
    );
  });

  it("keeps the problem full-text vector in sync and searchable (GIN)", async () => {
    await raw`insert into problem_statements (code, title, description, tags)
      values ('PS-2026-0001', 'Solar pump for irrigation',
              'Low-cost solar water pumping for small farmers', '{energy,agri}')`;
    const rows = await raw`select count(*)::int as n from problem_statements
      where search_vector @@ to_tsquery('english', 'solar & irrigation')`;
    expect(rows[0].n).toBe(1);
  });

  it("enforces round criteria weight bounds (0..100)", async () => {
    const round = (
      await raw`insert into rounds (name, ordinal) values ('Internal Round 1', 100) returning id`
    )[0].id as string;
    await expectDbError(
      () =>
        raw`insert into round_criteria (round_id, name, weight, ordinal)
      values (${round}::uuid, 'Too heavy', '150.00', 1)`,
      /round_criteria_weight_chk/i
    );
  });

  it("enforces evaluation score bounds and unique (evaluation, criterion)", async () => {
    const { inst, leader } = await seedBase();
    const round = (
      await raw`insert into rounds (name, ordinal) values ('R2', 200) returning id`
    )[0].id as string;
    const c1 = (
      await raw`insert into round_criteria (round_id, name, weight, ordinal)
      values (${round}::uuid, 'Innovation', '50.00', 1) returning id`
    )[0].id as string;
    const c2 = (
      await raw`insert into round_criteria (round_id, name, weight, ordinal)
      values (${round}::uuid, 'Feasibility', '50.00', 2) returning id`
    )[0].id as string;
    const team = (
      await raw`insert into teams (institution_id, name, leader_user_id)
      values (${inst}::uuid, 'EvalTeam', ${leader}::uuid) returning id`
    )[0].id as string;
    const proposal = (
      await raw`insert into proposals (team_id, round_id, title) values (${team}::uuid, ${round}::uuid, 'P') returning id`
    )[0].id as string;
    const evalEmail = `eval.${leader.slice(0, 8)}@example.test`;
    const evaluator = (
      await raw`insert into users (institution_id, email, password_hash, full_name, role)
      values (${inst}::uuid, ${evalEmail}, 'x', 'Eval', 'evaluator') returning id`
    )[0].id as string;
    const ev = (
      await raw`insert into evaluations (proposal_id, round_id, evaluator_user_id)
      values (${proposal}::uuid, ${round}::uuid, ${evaluator}::uuid) returning id`
    )[0].id as string;

    await expectDbError(
      () =>
        raw`insert into evaluation_scores (evaluation_id, criterion_id, score)
      values (${ev}::uuid, ${c1}::uuid, '101.00')`,
      /eval_scores_range_chk/i
    );
    await raw`insert into evaluation_scores (evaluation_id, criterion_id, score)
      values (${ev}::uuid, ${c1}::uuid, '80.00')`;
    await expectDbError(
      () =>
        raw`insert into evaluation_scores (evaluation_id, criterion_id, score)
      values (${ev}::uuid, ${c1}::uuid, '55.00')`,
      /eval_scores_eval_criterion_uq/i
    );
    // second criterion of the same evaluation is still scorable
    await raw`insert into evaluation_scores (evaluation_id, criterion_id, score)
      values (${ev}::uuid, ${c2}::uuid, '70.00')`;
  });
});
