import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq as equals, sql } from "drizzle-orm";
import {
  problemStatements,
  proposals,
  proposalVersions,
  rounds,
  teamMembers,
} from "@/lib/db/schema";
import { can, Permissions } from "@/lib/authz/permissions";
import {
  createProposal,
  updateProposalDraft,
  submitProposal,
  getProposal,
} from "@/lib/proposals";
import { createTeam, inviteMember, acceptInvite, setTeamProblems } from "@/lib/teams";
import { resolveProposalScope } from "@/lib/proposals";
import {
  bootDb,
  makeActiveRound,
  makeInstitution,
  makeProblem,
  makeUser,
  type TestDb,
} from "./helpers";

/**
 * P5 proposals — S4 immutable versions + round-window enforcement.
 */

let t: TestDb;
beforeAll(async () => {
  t = await bootDb();
}, 120000);
afterAll(async () => {
  await t.raw.end();
});

async function seededTeam(genders: string[], instId?: string) {
  const inst = instId ?? (await makeInstitution(t.db));
  const leader = await makeUser(t.db, { prefix: "pl", institutionId: inst, gender: genders[0] as never });
  const team = await createTeam(leader, { name: `P5T ${Math.random().toString(36).slice(2, 6)}` });
  for (const g of genders.slice(1)) {
    const u = await makeUser(t.db, { prefix: "pm", institutionId: inst, gender: g as never });
    await inviteMember(leader, team.id, { email: u.email });
    await acceptInvite(u, team.id);
  }
  const problem = await makeProblem(t.db);
  await setTeamProblems(leader, team.id, [problem.id]);
  return { team, leader, inst, problem };
}

describe("P5 proposals: lifecycle, S4 immutability, round window", () => {
  it("leader creates a draft proposal for a team-selected problem in an active round", async () => {
    const { team, leader, problem } = await seededTeam(["male", "female"]);
    const roundId = await makeActiveRound(t.db);
    const p = await createProposal(leader, {
      teamId: team.id,
      problemId: problem.id,
      roundId,
      title: "Draft title",
    });
    expect(p.status).toBe("draft");
    expect(p.currentVersion).toBe(0);
  });

  it("non-leader cannot create or update proposals (can() in service)", async () => {
    const { team, problem, inst } = await seededTeam(["male", "female"]);
    const roundId = await makeActiveRound(t.db);
    const member = (await t.db
      .select({ userId: teamMembers.userId, teamId: teamMembers.teamId })
      .from(teamMembers)
      .where(sql`${teamMembers.teamId} = ${team.id} and ${teamMembers.role} = 'member'`))[0];
    const memberUser = { id: member.userId, role: "participant" } as const;
    await expect(
      createProposal(memberUser, { teamId: team.id, problemId: problem.id, roundId, title: "x" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const lead = await makeUser(t.db, { prefix: "upd", institutionId: inst });
    // a fresh leader of a DIFFERENT team cannot touch this proposal either
    const other = await seededTeam(["female"]);
    await expect(
      createProposal(other.leader, { teamId: team.id, problemId: problem.id, roundId, title: "x" })
    ).rejects.toThrow();
    void lead;
  });

  it("autosave keeps updating the working version; submit freezes it (S4)", async () => {
    const { team, leader, problem } = await seededTeam(["male", "female"]);
    const roundId = await makeActiveRound(t.db);
    const p = await createProposal(leader, { teamId: team.id, problemId: problem.id, roundId, title: "V1 title" });

    await updateProposalDraft(leader, p.id, {
      title: "V1 title",
      solution: "first draft solution",
    });
    await updateProposalDraft(leader, p.id, {
      title: "V1 title (edited)",
      solution: "second draft solution",
    });

    await submitProposal(leader, p.id);
    const after = await getProposal(leader, p.id);
    expect(after.status).toBe("submitted");
    expect(after.currentVersion).toBe(1);
    expect(after.finalVersionId).toBeTruthy();

    // the submitted version row exists exactly once, marked final
    const rows = await t.db
      .select({ v: proposalVersions.versionNo, fin: proposalVersions.isFinal })
      .from(proposalVersions)
      .where(sql`${proposalVersions.proposalId} = ${p.id}`);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ v: 1, fin: true });
  });

  it("S4: submitted version rows are IMMUTABLE at the database level (trigger)", async () => {
    const { team, leader, problem } = await seededTeam(["male", "female"]);
    const roundId = await makeActiveRound(t.db);
    const p = await createProposal(leader, { teamId: team.id, problemId: problem.id, roundId, title: "T" });
    await updateProposalDraft(leader, p.id, { title: "T", solution: "s" });
    await submitProposal(leader, p.id);

    const [row] = await t.db
      .select({ id: proposalVersions.id })
      .from(proposalVersions)
      .where(sql`${proposalVersions.proposalId} = ${p.id}`);
    // postgres-js wraps the PG error; the trigger's message rides in the
    // (non-enumerable) cause chain, so assert on a deep serialization
    const deep = (v: unknown, seen: Set<object> = new Set()): string => {
      if (v === null || typeof v !== "object") return String(v);
      if (seen.has(v as object)) return "[circular]";
      seen.add(v as object);
      const o = v as Record<string, unknown>;
      return `{${Object.getOwnPropertyNames(o)
        .map((k) => `${k}:${deep(o[k], seen)}`)
        .join(",")}}`;
    };
    const expectImmutable = async (p: Promise<unknown>) => {
      let caught: unknown = null;
      try {
        await p;
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(Error);
      expect(deep(caught)).toMatch(/immutable/i);
    };
    await expectImmutable(
      t.db
        .update(proposalVersions)
        .set({ solution: "TAMPERED" })
        .where(sql`${proposalVersions.id} = ${row.id}`)
    );
    await expectImmutable(
      t.db.delete(proposalVersions).where(sql`${proposalVersions.id} = ${row.id}`)
    );
    // and the row is unchanged
    const after = (
      await t.db
        .select({ s: proposalVersions.solution })
        .from(proposalVersions)
        .where(sql`${proposalVersions.id} = ${row.id}`)
    )[0];
    expect(after.s).not.toBe("TAMPERED");
  });

  it("submission outside an active round window is rejected (S4 window rule)", async () => {
    const { team, leader, problem } = await seededTeam(["male", "female"]);
    // round created but left in 'draft' status (not activated)
    const [round] = await t.db
      .insert(rounds)
      .values({ name: `inactive ${Date.now()}`, ordinal: 9500 })
      .returning({ id: rounds.id });
    const p = await createProposal(leader, { teamId: team.id, problemId: problem.id, roundId: round.id, title: "T" });
    await updateProposalDraft(leader, p.id, { title: "T", solution: "s" });
    await expect(submitProposal(leader, p.id)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("resubmission after changes-requested creates a NEW version; v1 stays byte-identical (S4)", async () => {
    const { team, leader, problem } = await seededTeam(["male", "female"]);
    const roundId = await makeActiveRound(t.db);
    const p = await createProposal(leader, { teamId: team.id, problemId: problem.id, roundId, title: "Rev title" });
    await updateProposalDraft(leader, p.id, { title: "Rev title", solution: "v1 solution" });
    await submitProposal(leader, p.id);
    const v1 = (
      await t.db
        .select({ s: proposalVersions.solution, t: proposalVersions.title })
        .from(proposalVersions)
        .where(sql`${proposalVersions.proposalId} = ${p.id} and ${proposalVersions.versionNo} = 1`)
    )[0];

    // simulate admin "changes requested" (the admin route itself is P7)
    await t.db
      .update(proposals)
      .set({ status: "changes_requested" })
      .where(sql`${proposals.id} = ${p.id}`);

    await updateProposalDraft(leader, p.id, { title: "Rev title v2", solution: "v2 solution" });
    await submitProposal(leader, p.id);

    const final = (
      await t.db
        .select({ v: proposalVersions.versionNo, s: proposalVersions.solution })
        .from(proposalVersions)
        .where(sql`${proposalVersions.proposalId} = ${p.id} and ${proposalVersions.isFinal} = true`)
        .orderBy(proposalVersions.versionNo)
    );
    expect(final).toEqual([
      { v: 1, s: "v1 solution" },
      { v: 2, s: "v2 solution" },
    ]);
    // v1 untouched
    const v1again = (
      await t.db
        .select({ s: proposalVersions.solution, t: proposalVersions.title })
        .from(proposalVersions)
        .where(sql`${proposalVersions.proposalId} = ${p.id} and ${proposalVersions.versionNo} = 1`)
    )[0];
    expect(v1again).toEqual(v1);
  });

  it("team composition: submission blocked until ≥1 female member (settings min_female=1)", async () => {
    const { team, leader, problem, inst } = await seededTeam(["male", "male"]);
    const roundId = await makeActiveRound(t.db);
    const p = await createProposal(leader, { teamId: team.id, problemId: problem.id, roundId, title: "T" });
    await updateProposalDraft(leader, p.id, { title: "T", solution: "s" });
    await expect(submitProposal(leader, p.id)).rejects.toMatchObject({ code: "CONFLICT" });

    // fix the composition, then submission succeeds
    const female = await makeUser(t.db, { prefix: "fix-f", institutionId: inst, gender: "female" });
    await inviteMember(leader, team.id, { email: female.email });
    await acceptInvite(female, team.id);
    await submitProposal(leader, p.id);
    const after = await getProposal(leader, p.id);
    expect(after.status).toBe("submitted");
  });

  it("F5: proposalReview = creator of the proposal's problem, or SPOC of the team's institution", async () => {
    const { team, leader, inst, problem } = await seededTeam(["male", "female"]);
    const roundId = await makeActiveRound(t.db);
    const p = await createProposal(leader, { teamId: team.id, problemId: problem.id, roundId, title: "F5" });

    const creatorOf = await makeUser(t.db, { prefix: "f5c1", role: "problem_creator" });
    const otherCreator = await makeUser(t.db, { prefix: "f5c2", role: "problem_creator" });
    const spocOwn = await makeUser(t.db, { prefix: "f5s1", role: "spoc", institutionId: inst });
    const spocOther = await makeUser(t.db, { prefix: "f5s2", role: "spoc" });
    const instB = await makeInstitution(t.db);
    spocOther.institutionId = instB;

    // the creator OF THIS PROBLEM'S PS can review
    await t.db.update(problemStatements).set({ creatorUserId: creatorOf.id }).where(equals(problemStatements.id, problem.id));
    let ctx = await resolveProposalScope(creatorOf, p.id);
    expect(can(creatorOf, Permissions.proposalReview, ctx)).toBe(true);
    // a different problem_creator cannot
    ctx = await resolveProposalScope(otherCreator, p.id);
    expect(can(otherCreator, Permissions.proposalReview, ctx)).toBe(false);
    // SPOC of the team's institution can; other institution cannot
    ctx = await resolveProposalScope(spocOwn, p.id);
    expect(can(spocOwn, Permissions.proposalReview, ctx)).toBe(true);
    ctx = await resolveProposalScope(spocOther, p.id);
    expect(can(spocOther, Permissions.proposalReview, ctx)).toBe(false);
    // a participant (team leader) cannot review
    ctx = await resolveProposalScope(leader, p.id);
    expect(can(leader, Permissions.proposalReview, ctx)).toBe(false);
  });

});
