import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { problemStatements } from "@/lib/db/schema";
import { ApiError } from "@/lib/http/error";
import {
  createTeam,
  inviteMember,
  acceptInvite,
  removeMember,
  withdrawTeam,
  setTeamProblems,
  getTeam,
} from "@/lib/teams";
import {
  bootDb,
  email,
  makeActiveRound,
  makeInstitution,
  makeProblem,
  makeUser,
  type TestDb,
} from "./helpers";

/**
 * P5 teams: composition rules from settings, same-institution, caps.
 * Services throw ApiError (mapped by the route layer to the envelope).
 */

let t: TestDb;
beforeAll(async () => {
  t = await bootDb();
}, 120000);
afterAll(async () => {
  await t.raw.end();
});

describe("P5 team lifecycle + composition rules", () => {
  it("only participants may create teams (S1: can() enforced in service)", async () => {
    const inst = await makeInstitution(t.db);
    const spoc = await makeUser(t.db, { prefix: "spoc", role: "spoc", institutionId: inst });
    await expect(createTeam(spoc, { name: "Spoc Team" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const leader = await makeUser(t.db, {
      prefix: "l1",
      institutionId: inst,
      gender: "male",
    });
    const team = await createTeam(leader, { name: "Alpha Squad" });
    expect(team.status).toBe("draft");
    expect(team.leaderUserId).toBe(leader.id);
  });

  it("creation requires an institution (same-college rule)", async () => {
    const wanderer = await makeUser(t.db, { prefix: "nowhere", institutionId: null });
    await expect(createTeam(wanderer, { name: "No Inst" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("a user can be in only ONE team", async () => {
    const inst = await makeInstitution(t.db);
    const u = await makeUser(t.db, { prefix: "duo", institutionId: inst, gender: "female" });
    await createTeam(u, { name: "Team One" });
    await expect(createTeam(u, { name: "Team Two" })).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("invite: leader only, same institution, cap from settings (max 6)", async () => {
    const inst = await makeInstitution(t.db);
    const leader = await makeUser(t.db, { prefix: "cap-l", institutionId: inst, gender: "male" });
    const team = await createTeam(leader, { name: "Cap Team" });

    // non-leader cannot invite
    const member = await makeUser(t.db, { prefix: "cap-m1", institutionId: inst, gender: "female" });
    await inviteMember(leader, team.id, { email: member.email });
    await acceptInvite(member, team.id);
    await expect(
      inviteMember(member, team.id, { email: email("x") })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    // cross-institution invite rejected
    const otherInst = await makeInstitution(t.db);
    const outsider = await makeUser(t.db, { prefix: "cap-out", institutionId: otherInst, gender: "female" });
    await expect(
      inviteMember(leader, team.id, { email: outsider.email })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    // fill to 6 (leader + cap-m1 + 4)
    const m = await Promise.all(
      Array.from({ length: 4 }, (_, i) =>
        makeUser(t.db, {
          prefix: `cap-f${i}`,
          institutionId: inst,
          gender: i % 2 === 0 ? "female" : "male",
        })
      )
    );
    for (const u of m) {
      await inviteMember(leader, team.id, { email: u.email });
      await acceptInvite(u, team.id);
    }
    const full = await getTeam(leader, team.id);
    expect(full.members.filter((x) => x.status === "accepted").length).toBe(6);

    // 7th invite exceeds team.max_members (6)
    const extra = await makeUser(t.db, { prefix: "cap-x", institutionId: inst, gender: "male" });
    await expect(
      inviteMember(leader, team.id, { email: extra.email })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("removeMember: leader only; cannot remove the leader", async () => {
    const inst = await makeInstitution(t.db);
    const leader = await makeUser(t.db, { prefix: "rm-l", institutionId: inst, gender: "male" });
    const team = await createTeam(leader, { name: "Remove Team" });
    const m1 = await makeUser(t.db, { prefix: "rm-m1", institutionId: inst, gender: "female" });
    await inviteMember(leader, team.id, { email: m1.email });
    await acceptInvite(m1, team.id);

    await expect(
      removeMember(m1, team.id, m1.id)
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      removeMember(leader, team.id, leader.id)
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await removeMember(leader, team.id, m1.id);
    const after = await getTeam(leader, team.id);
    expect(after.members.map((x) => x.userId)).not.toContain(m1.id);
  });

  it("leader can withdraw the team", async () => {
    const inst = await makeInstitution(t.db);
    const leader = await makeUser(t.db, { prefix: "wd-l", institutionId: inst, gender: "male" });
    const team = await createTeam(leader, { name: "Withdraw Team" });
    await expect(
      withdrawTeam({ id: "other", role: "participant" }, team.id)
    ).rejects.toThrow(ApiError);
    await withdrawTeam(leader, team.id);
    const after = await getTeam(leader, team.id);
    expect(after.status).toBe("withdrawn");
  });

  it("team problems: max 2 (settings), duplicates rejected, published only", async () => {
    const inst = await makeInstitution(t.db);
    const leader = await makeUser(t.db, { prefix: "tp-l", institutionId: inst, gender: "male" });
    const team = await createTeam(leader, { name: "Problem Team" });
    const p1 = await makeProblem(t.db);
    const p2 = await makeProblem(t.db);
    await setTeamProblems(leader, team.id, [p1.id, p2.id]);
    const p3 = await makeProblem(t.db);
    await expect(setTeamProblems(leader, team.id, [p1.id, p2.id, p3.id])).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await expect(setTeamProblems(leader, team.id, [p1.id, p1.id])).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    // draft problem cannot be selected
    const [draft] = await t.db
      .insert(problemStatements)
      .values({
        code: `PS-DRAFT-${Date.now()}`,
        title: "draft ps",
        description: "x",
        status: "draft",
        searchVector: sql`to_tsvector('english', 'x')`,
      })
      .returning({ id: problemStatements.id });
    await expect(setTeamProblems(leader, team.id, [draft.id])).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("member visibility: own team only (cross-team denied)", async () => {
    const inst = await makeInstitution(t.db);
    const leader = await makeUser(t.db, { prefix: "vis-l", institutionId: inst, gender: "male" });
    const team = await createTeam(leader, { name: "Visible Team" });
    const stranger = await makeUser(t.db, { prefix: "vis-s", institutionId: inst, gender: "female" });
    await expect(getTeam(stranger, team.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const own = await getTeam(leader, team.id);
    expect(own.name).toBe("Visible Team");
  });

  it("an active round exists for proposal tests (sanity of helper)", async () => {
    const roundId = await makeActiveRound(t.db);
    expect(roundId).toBeTruthy();
  });
});
