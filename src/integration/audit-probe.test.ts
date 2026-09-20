import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserLike } from "@/lib/authz/permissions";
import { can, Permissions } from "@/lib/authz/permissions";
import { mentorships, evaluations } from "@/lib/db/schema";
import { uploadDocument, getDocument } from "@/lib/documents";
import { createTeam, inviteMember, acceptInvite, resolveTeamScope, setTeamProblems } from "@/lib/teams";
import { createProposal, updateProposalDraft, submitProposal } from "@/lib/proposals";
import { bootDb, makeActiveRound, makeInstitution, makeProblem, makeUser, type TestDb } from "./helpers";

let t: TestDb; let team: { id: string }; let leader: UserLike; let invitee: UserLike;
let mentor: UserLike; let evaluator: UserLike; let creator: UserLike; let proposal: { id: string }; let docId: string;
beforeAll(async () => {
  t = await bootDb();
  const inst = await makeInstitution(t.db);
  leader = await makeUser(t.db, { prefix: "p-l", institutionId: inst, gender: "male" });
  team = await createTeam(leader, { name: "Probe Team" });
  invitee = await makeUser(t.db, { prefix: "p-i", institutionId: inst, gender: "female" });
  await inviteMember(leader, team.id, { email: invitee.email! }); // NOT accepted
  mentor = await makeUser(t.db, { prefix: "p-m", role: "mentor" });
  evaluator = await makeUser(t.db, { prefix: "p-e", role: "evaluator" });
  creator = await makeUser(t.db, { prefix: "p-c", role: "problem_creator" });
  const roundId = await makeActiveRound(t.db);
  const problem = await makeProblem(t.db);
  await setTeamProblems(leader, team.id, [problem.id]);
  proposal = await createProposal(leader, { teamId: team.id, problemId: problem.id, roundId, title: "P" });
  await updateProposalDraft(leader, proposal.id, { title: "P", solution: "s" });
  await submitProposal(leader, proposal.id).catch(() => {});
  await t.db.insert(mentorships).values({ mentorUserId: mentor.id, teamId: team.id });
  await t.db.insert(evaluations).values({ proposalId: proposal.id, roundId, evaluatorUserId: evaluator.id });
  const d = await uploadDocument(leader, { ownerKind: "team", ownerId: team.id, purpose: "other",
    file: { originalFilename: "a.pdf", mime: "application/pdf", bytes: Buffer.from("%PDF-1.4 x") } });
  docId = d.id;
}, 120000);
afterAll(async () => { await t.raw.end(); });

describe("AUDIT PROBES (each should pass if the system is correct)", () => {
  it("A: invited-but-not-accepted user must NOT read team documents", async () => {
    await expect(getDocument(invitee, docId)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("B1: assigned mentor must NOT upload documents", async () => {
    await expect(uploadDocument(mentor, { ownerKind: "team", ownerId: team.id, purpose: "other",
      file: { originalFilename: "m.pdf", mime: "application/pdf", bytes: Buffer.from("%PDF-1.4 m") } }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("B2: assigned evaluator must NOT upload documents", async () => {
    await expect(uploadDocument(evaluator, { ownerKind: "team", ownerId: team.id, purpose: "other",
      file: { originalFilename: "e.pdf", mime: "application/pdf", bytes: Buffer.from("%PDF-1.4 e") } }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("C: a file declared as docx but not a zip/OOXML must be rejected", async () => {
    await expect(uploadDocument(leader, { ownerKind: "team", ownerId: team.id, purpose: "other",
      file: { originalFilename: "x.docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        bytes: Buffer.from("<html><script>alert(1)</script>") } })).rejects.toBeTruthy();
  });
  it("D: assigned evaluator can view the team via resolveTeamScope + can()", async () => {
    const ctx = await resolveTeamScope(evaluator, team.id);
    expect(can(evaluator, Permissions.teamView, ctx)).toBe(true);
  });
  it("E: a problem_creator must NOT review an arbitrary team's proposal", async () => {
    const ctx = await resolveTeamScope(leader, team.id);
    expect(can(creator, Permissions.proposalReview, ctx)).toBe(false);
  });
  it("F: uploads after a SUCCESSFUL final submission must be rejected", async () => {
    const inst2 = await makeInstitution(t.db);
    const l2 = await makeUser(t.db, { prefix: "f-l", institutionId: inst2, gender: "male" });
    const tm = await createTeam(l2, { name: "Late Team" });
    const m2 = await makeUser(t.db, { prefix: "f-m", institutionId: inst2, gender: "female" });
    await inviteMember(l2, tm.id, { email: m2.email! });
    await acceptInvite(m2, tm.id);
    const rid = await makeActiveRound(t.db);
    const pr = await makeProblem(t.db);
    await setTeamProblems(l2, tm.id, [pr.id]);
    const pp = await createProposal(l2, { teamId: tm.id, problemId: pr.id, roundId: rid, title: "F" });
    await updateProposalDraft(l2, pp.id, { title: "F", solution: "s" });
    await submitProposal(l2, pp.id); // must succeed
    await expect(uploadDocument(l2, { ownerKind: "proposal", ownerId: pp.id, purpose: "other",
      file: { originalFilename: "late.pdf", mime: "application/pdf", bytes: Buffer.from("%PDF-1.4 late") } }))
      .rejects.toBeTruthy();
  });
});
