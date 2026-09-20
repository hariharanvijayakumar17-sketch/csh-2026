import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserLike } from "@/lib/authz/permissions";
import { eq } from "drizzle-orm";
import {
  documents,
  mentorships,
  evaluations,
} from "@/lib/db/schema";
import { uploadDocument, getDocument, listTeamDocuments } from "@/lib/documents";
import { createTeam, inviteMember, acceptInvite } from "@/lib/teams";
import { createProposal, updateProposalDraft, submitProposal } from "@/lib/proposals";
import {
  bootDb,
  makeActiveRound,
  makeInstitution,
  makeProblem,
  makeUser,
  type TestDb,
} from "./helpers";

/**
 * P5 documents — S2 document ACL. The matrix below is the acceptance test:
 * team members, own-institution SPOC, assigned mentor, assigned evaluator,
 * admins ONLY. Cross-team / cross-institution / unassigned callers are DENIED.
 */

let t: TestDb;
let teamA: { id: string };
let leaderA: UserLike;
let memberA: UserLike;
let teamB: { id: string };
let memberB: UserLike;
let spocA: UserLike;
let spocB: UserLike;
let mentorAssigned: UserLike;
let mentorUnassigned: UserLike;
let evalAssigned: UserLike;
let evalUnassigned: UserLike;
let proposalA: { id: string };
let roundId: string;
let teamAInst: string;

beforeAll(async () => {
  t = await bootDb();
  teamAInst = await makeInstitution(t.db);
  const instB = await makeInstitution(t.db);

  leaderA = await makeUser(t.db, { prefix: "doc-la", institutionId: teamAInst, gender: "male" });
  teamA = await createTeam(leaderA, { name: "Doc Team A" });
  memberA = await makeUser(t.db, { prefix: "doc-ma", institutionId: teamAInst, gender: "female" });
  await inviteMember(leaderA, teamA.id, { email: memberA.email! });
  await acceptInvite(memberA, teamA.id);

  const leaderB = await makeUser(t.db, { prefix: "doc-lb", institutionId: instB, gender: "male" });
  teamB = await createTeam(leaderB, { name: "Doc Team B" });
  memberB = await makeUser(t.db, { prefix: "doc-mb", institutionId: instB, gender: "female" });
  await inviteMember(leaderB, teamB.id, { email: memberB.email! });
  await acceptInvite(memberB, teamB.id);

  spocA = await makeUser(t.db, { prefix: "doc-sa", role: "spoc", institutionId: teamAInst });
  spocB = await makeUser(t.db, { prefix: "doc-sb", role: "spoc", institutionId: instB });
  mentorAssigned = await makeUser(t.db, { prefix: "doc-ma1", role: "mentor" });
  mentorUnassigned = await makeUser(t.db, { prefix: "doc-mu", role: "mentor" });
  evalAssigned = await makeUser(t.db, { prefix: "doc-va", role: "evaluator" });
  evalUnassigned = await makeUser(t.db, { prefix: "doc-vu", role: "evaluator" });

  roundId = await makeActiveRound(t.db);
  const problem = await makeProblem(t.db);
  // select problem for team A and create a submitted proposal (evaluation refs a proposal)
  const { setTeamProblems } = await import("@/lib/teams");
  await setTeamProblems(leaderA, teamA.id, [problem.id]);
  proposalA = await createProposal(leaderA, { teamId: teamA.id, problemId: problem.id, roundId, title: "Doc proposal" });
  await updateProposalDraft(leaderA, proposalA.id, { title: "Doc proposal", solution: "s" });
  await submitProposal(leaderA, proposalA.id);

  await t.db.insert(mentorships).values({ mentorUserId: mentorAssigned.id, teamId: teamA.id });
  await t.db
    .insert(evaluations)
    .values({ proposalId: proposalA.id, roundId, evaluatorUserId: evalAssigned.id });
}, 120000);
afterAll(async () => {
  await t.raw.end();
});

const sampleFile = (name = "report.pdf", mime = "application/pdf") => ({
  originalFilename: name,
  mime: mime,
  bytes: Buffer.from(`%PDF-1.4 P5 sample ${name}`),
});

describe("P5 documents — S2 ACL matrix", () => {
  it("team leader uploads a document (stored + hashed)", async () => {
    const doc = await uploadDocument(leaderA, {
      ownerKind: "team",
      ownerId: teamA.id,
      purpose: "other",
      file: sampleFile(),
    });
    expect(doc.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(doc.sizeBytes).toBeGreaterThan(0);
    expect(doc.status).toBe("active");
  });

  it("ACL: view is ALLOWED for the right callers only (S2 matrix)", async () => {
    const [doc] = await t.db
      .select({ id: documents.id })
      .from(documents)
      .where(eq(documents.ownerId, teamA.id));
    const id = doc.id;

    // allowed
    for (const caller of [leaderA, memberA, spocA, mentorAssigned, evalAssigned,
      { id: "00000000-0000-0000-0000-000000000000", role: "super_admin" } as UserLike]) {
      const d = await getDocument(caller, id);
      expect(d.id).toBe(id);
    }

    // DENIED: cross-team participant, cross-institution SPOC, unassigned mentor/evaluator, no-team participant
    const stranger = await makeUser(t.db, { prefix: "doc-no", institutionId: teamAInst, gender: "female" });
    for (const caller of [memberB, spocB, mentorUnassigned, evalUnassigned, stranger]) {
      await expect(getDocument(caller, id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });

  it("ACL: upload to someone else's team is DENIED (cross-team)", async () => {
    await expect(
      uploadDocument(memberB, {
        ownerKind: "team",
        ownerId: teamA.id,
        purpose: "other",
        file: sampleFile("b.pdf"),
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("ACL: proposal-owned documents resolve through the owning team", async () => {
    const doc = await uploadDocument(leaderA, {
      ownerKind: "proposal",
      ownerId: proposalA.id,
      purpose: "proposal_presentation",
      file: sampleFile("slides.pdf"),
    });
    expect((await getDocument(memberA, doc.id)).purpose).toBe("proposal_presentation");
    await expect(getDocument(memberB, doc.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getDocument(spocB, doc.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getDocument(mentorAssigned, doc.id)).resolves.toBeTruthy();
  });

  it("file constraints: oversize and disallowed mime rejected", async () => {
    const big = {
      originalFilename: "huge.pdf",
      mime: "application/pdf",
      bytes: Buffer.alloc(10 * 1024 * 1024 + 1, 1), // over 10 MiB default
    };
    await expect(
      uploadDocument(leaderA, { ownerKind: "team", ownerId: teamA.id, purpose: "other", file: big })
    ).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
    await expect(
      uploadDocument(leaderA, {
        ownerKind: "team",
        ownerId: teamA.id,
        purpose: "other",
        file: sampleFile("evil.exe", "application/x-msdownload"),
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("team document list is scoped to the caller's team", async () => {
    const list = await listTeamDocuments(leaderA, teamA.id);
    expect(list.length).toBeGreaterThanOrEqual(2);
    expect(list.every((d) => d.id)).toBe(true);
    await expect(listTeamDocuments(memberB, teamA.id)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("F2: authorization letter is the SPOC's upload — own institution only, members/other SPOC denied", async () => {
    const pdf = (tag: string) => Buffer.from(`%PDF-1.4 ${tag}`);
    const file = (b: Buffer, name = "f.pdf") => ({ originalFilename: name, mime: "application/pdf", bytes: b });
    // the SPOC of the team's institution CAN upload the letter
    const letter = await uploadDocument(spocA, {
      ownerKind: "team",
      ownerId: teamA.id,
      purpose: "authorization_letter",
      file: file(pdf("letter")),
    });
    expect(letter.purpose).toBe("authorization_letter");
    // SPOC of a DIFFERENT institution: denied
    await expect(
      uploadDocument(spocB, { ownerKind: "team", ownerId: teamA.id, purpose: "authorization_letter", file: file(pdf("b")) })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    // a team member uploading letter purpose: denied (letter is SPOC-only)
    await expect(
      uploadDocument(memberA, { ownerKind: "team", ownerId: teamA.id, purpose: "authorization_letter", file: file(pdf("m")) })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

});
