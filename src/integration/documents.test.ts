import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserLike } from "@/lib/authz/permissions";
import { eq } from "drizzle-orm";
import {
  documents,
  mentorships,
  evaluations,
} from "@/lib/db/schema";
import { uploadDocument, getDocument, listTeamDocuments } from "@/lib/documents";
import { createTeam, inviteMember, acceptInvite, setTeamProblems, withdrawTeam } from "@/lib/teams";
import { createProposal, updateProposalDraft, submitProposal } from "@/lib/proposals";
import { setSetting } from "@/lib/settings";
import { proposals } from "@/lib/db/schema";
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
    // F6: proposal documents freeze after submission — the ACL upload uses a
    // DRAFT proposal (proposalA was submitted in beforeAll)
    const aclProblem = await makeProblem(t.db);
    await setTeamProblems(leaderA, teamA.id, [aclProblem.id]);
    const aclRound = await makeActiveRound(t.db); // one proposal per team per round
    const draftP = await createProposal(leaderA, { teamId: teamA.id, problemId: aclProblem.id, roundId: aclRound, title: "Draft for docs" });
    const doc = await uploadDocument(leaderA, {
      ownerKind: "proposal",
      ownerId: draftP.id,
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
    // F3: detection is the gate — real executable bytes (MZ/PE) are unknown
    // content → rejected, whatever the declared mime says
    await expect(
      uploadDocument(leaderA, {
        ownerKind: "team",
        ownerId: teamA.id,
        purpose: "other",
        file: { originalFilename: "evil.exe", mime: "application/x-msdownload", bytes: Buffer.concat([Buffer.from([0x4d, 0x5a, 0x90, 0x00]), Buffer.alloc(32, 7)]) },
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


  it("F3: content is detected server-side — real docx accepted (mimeDetected = docx), fake docx + legacy .doc rejected", async () => {
    const pdf = (tag: string) => Buffer.from(`%PDF-1.4 ${tag}`);
    // minimal valid OOXML docx (store-method zip with central directory)
    const crcTable = (() => {
      const t = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c >>> 0;
      }
      return t;
    })();
    const crc32 = (b: Buffer) => {
      let c = 0xffffffff;
      for (let i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]) & 0xff] ^ (c >>> 8);
      return (c ^ 0xffffffff) >>> 0;
    };
    const zip = (entries: Record<string, string>) => {
      const locals: Buffer[] = [];
      const centrals: Buffer[] = [];
      let offset = 0;
      for (const [name, content] of Object.entries(entries)) {
        const nb = Buffer.from(name, "utf8");
        const data = Buffer.from(content, "utf8");
        const crc = crc32(data);
        const lh = Buffer.alloc(30);
        lh.writeUInt32LE(0x04034b50, 0);
        lh.writeUInt16LE(20, 4);
        lh.writeUInt32LE(crc, 14);
        lh.writeUInt32LE(data.length, 18);
        lh.writeUInt32LE(data.length, 22);
        lh.writeUInt16LE(nb.length, 26);
        locals.push(Buffer.concat([lh, nb, data]));
        const ch = Buffer.alloc(46);
        ch.writeUInt32LE(0x02014b50, 0);
        ch.writeUInt16LE(20, 4);
        ch.writeUInt16LE(20, 6);
        ch.writeUInt32LE(crc, 16);
        ch.writeUInt32LE(data.length, 20);
        ch.writeUInt32LE(data.length, 24);
        ch.writeUInt16LE(nb.length, 28);
        ch.writeUInt32LE(offset, 42);
        centrals.push(Buffer.concat([ch, nb]));
        offset += 30 + nb.length + data.length;
      }
      const cd = Buffer.concat(centrals);
      const eo = Buffer.alloc(22);
      eo.writeUInt32LE(0x06054b50, 0);
      eo.writeUInt16LE(Object.keys(entries).length, 8);
      eo.writeUInt16LE(Object.keys(entries).length, 10);
      eo.writeUInt32LE(cd.length, 12);
      eo.writeUInt32LE(offset, 16);
      return Buffer.concat([...locals, cd, eo]);
    };
    const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    // 1) a REAL docx, even with a lie in the declared mime, is stored as docx
    const real = await uploadDocument(leaderA, {
      ownerKind: "team",
      ownerId: teamA.id,
      purpose: "project_report",
      file: { originalFilename: "r.docx", mime: "text/plain", bytes: zip({ "[Content_Types].xml": "<T/>", "word/document.xml": "<d/>" }) },
    });
    expect(real.mimeDetected).toBe(DOCX_MIME);
    // 2) a file DECLARED as docx but actually html: rejected (probe C)
    await expect(
      uploadDocument(leaderA, {
        ownerKind: "team",
        ownerId: teamA.id,
        purpose: "project_report",
        file: { originalFilename: "x.docx", mime: DOCX_MIME, bytes: Buffer.from("<html><script>alert(1)</script>") },
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // 3) legacy .doc: not a supported type
    await expect(
      uploadDocument(leaderA, {
        ownerKind: "team",
        ownerId: teamA.id,
        purpose: "project_report",
        file: { originalFilename: "old.doc", mime: "application/msword", bytes: Buffer.from("\xd0\xcf\x11\xe0") },
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // 4) pdf declared as zip is still detected+stored as pdf
    const lie = await uploadDocument(leaderA, {
      ownerKind: "team",
      ownerId: teamA.id,
      purpose: "other",
      file: { originalFilename: "lie.zip", mime: "application/zip", bytes: pdf("lie") },
    });
    expect(lie.mimeDetected).toBe("application/pdf");
  });


  it("F6: uploads locked after submission / withdrawn team; deadline enforced; admin override audited", async () => {
    const pdf = (tag: string) => Buffer.from(`%PDF-1.4 ${tag}`);
    const file = (b: Buffer, name = "f.pdf") => ({ originalFilename: name, mime: "application/pdf", bytes: b });

    const roundId = await makeActiveRound(t.db);
    const problem = await makeProblem(t.db);
    await setTeamProblems(leaderA, teamA.id, [problem.id]);
    const p = await createProposal(leaderA, { teamId: teamA.id, problemId: problem.id, roundId, title: "F6" });
    await updateProposalDraft(leaderA, p.id, { title: "F6", solution: "s" });
    // before submission: uploads are fine
    await uploadDocument(leaderA, { ownerKind: "team", ownerId: teamA.id, purpose: "other", file: file(pdf("pre")) });
    await submitProposal(leaderA, p.id);
    // after final submission: proposal-owned uploads LOCKED (probe F); team-level
    // documents stay manageable (the probe suite's own contract)
    await expect(
      uploadDocument(leaderA, { ownerKind: "proposal", ownerId: p.id, purpose: "other", file: file(pdf("b")) })
    ).rejects.toMatchObject({ code: "LOCKED" });
    await uploadDocument(leaderA, { ownerKind: "team", ownerId: teamA.id, purpose: "other", file: file(pdf("team-level")) });
    // changes_requested: unlocked again
    await t.db.update(proposals).set({ status: "changes_requested" }).where(eq(proposals.id, p.id));
    const rev = await uploadDocument(leaderA, { ownerKind: "proposal", ownerId: p.id, purpose: "project_report", file: file(pdf("rev")) });
    expect(rev.purpose).toBe("project_report");

    // deadline gate (team B has no submissions)
    await setSetting("document.upload_deadline", new Date(Date.now() - 60_000).toISOString());
    await expect(
      uploadDocument(memberB, { ownerKind: "team", ownerId: teamB.id, purpose: "other", file: file(pdf("late")) })
    ).rejects.toMatchObject({ code: "DEADLINE_PASSED" });
    await setSetting("document.upload_deadline", new Date(Date.now() + 3_600_000).toISOString());
    await uploadDocument(memberB, { ownerKind: "team", ownerId: teamB.id, purpose: "other", file: file(pdf("ok")) });
    await setSetting("document.upload_deadline", ""); // reset: no deadline

    // withdrawn team: LOCKED for members, super_admin overrides WITH an audit row
    const instC = await makeInstitution(t.db);
    const lc = await makeUser(t.db, { prefix: "f6c", institutionId: instC, gender: "male" });
    const tc = await createTeam(lc, { name: "F6 Doom Team" });
    await withdrawTeam(lc, tc.id);
    await expect(
      uploadDocument(lc, { ownerKind: "team", ownerId: tc.id, purpose: "other", file: file(pdf("w")) })
    ).rejects.toMatchObject({ code: "LOCKED" });
    const admin = await makeUser(t.db, { prefix: "f6adm", role: "super_admin" });
    const aDoc = await uploadDocument(admin, { ownerKind: "team", ownerId: tc.id, purpose: "other", file: file(pdf("admin")) });
    expect(aDoc.id).toBeTruthy();
    const rows = await t.raw`SELECT action FROM audit_log WHERE entity_kind = 'team' AND entity_id = ${tc.id} AND action = 'document.upload_override'`;
    expect(rows).toHaveLength(1);
  });

});
