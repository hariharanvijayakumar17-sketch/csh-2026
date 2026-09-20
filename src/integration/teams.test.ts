import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { problemStatements } from "@/lib/db/schema";
import { ApiError } from "@/lib/http/error";
import {
  createTeam,
  inviteMember,
  acceptInvite,
  declineInvite,
  removeMember,
  withdrawTeam,
  setTeamProblems,
  getTeam,
} from "@/lib/teams";
import { can, Permissions } from "@/lib/authz/permissions";
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


  it("F1: invited-but-not-accepted is NOT a member (no visibility, not blocked, auto-decline)", async () => {
    const inst = await makeInstitution(t.db);
    const leader = await makeUser(t.db, { prefix: "f1l", institutionId: inst, gender: "male" });
    const invitee = await makeUser(t.db, { prefix: "f1i", institutionId: inst, gender: "female" });
    const team = await createTeam(leader, { name: "F1 Probe Team" });
    await inviteMember(leader, team.id, { email: invitee.email! });
    // 1) invited user cannot VIEW the team
    await expect(getTeam(invitee, team.id), "invited user must not read team").rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    // 2) invited user is NOT blocked from forming their own team
    const own = await createTeam(invitee, { name: "My Own Team" });
    expect(own.id).not.toEqual(team.id);
    // 3) the stale pending invite was auto-declined
    const row = await t.raw`SELECT status FROM team_members WHERE team_id = ${team.id} AND user_id = ${invitee.id}`;
    expect(row[0].status).toBe("declined");
    // 4) explicit decline works once, then NOT_FOUND (fresh invitee — the first
    //    one now has an accepted team and would correctly be CONFLICT)
    const decliner = await makeUser(t.db, { prefix: "f1d", institutionId: inst, gender: "female" });
    const l3 = await makeUser(t.db, { prefix: "f1l3", institutionId: inst, gender: "male" });
    const t3 = await createTeam(l3, { name: "F1 Decline Team" });
    await inviteMember(l3, t3.id, { email: decliner.email! });
    await declineInvite(decliner, t3.id);
    await expect(declineInvite(decliner, t3.id), "second decline -> NOT_FOUND").rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    // 5) can(teamView) is false for the invited-only user (probe D sibling)
    const scope = {
      team: { id: team.id, institutionId: inst, leaderUserId: leader.id },
      teamLeaderUserId: leader.id,
      ownTeamIds: new Set<string>(),
      institutionId: inst,
      mentorAssignedTeamIds: new Set<string>(),
      evaluatorAssignedTeamIds: new Set<string>(),
    };
    expect(can(invitee, Permissions.teamView, scope)).toBe(false);
  });

  it("F1: a user whose only team is withdrawn can form a new team", async () => {
    const inst = await makeInstitution(t.db);
    const u = await makeUser(t.db, { prefix: "f1w", institutionId: inst, gender: "male" });
    const t1 = await createTeam(u, { name: "Doomed Team" });
    await withdrawTeam(u, t1.id);
    const t2 = await createTeam(u, { name: "Fresh Team" });
    expect(t2.id).not.toEqual(t1.id);
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
