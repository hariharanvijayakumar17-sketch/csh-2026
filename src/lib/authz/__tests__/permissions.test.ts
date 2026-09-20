import { describe, expect, it } from "vitest";
import {
  Permissions,
  can,
  type CanContext,
  type UserLike,
} from "../permissions";

/**
 * S1/S2/S3/S5 permission matrix (unit). The DB layer (P2) proves storage;
 * this proves DECISIONS. Every case here is a requirement from brief §5.1/§6.
 */

const INST_A = "11111111-0000-0000-0000-00000000000a";
const INST_B = "22222222-0000-0000-0000-00000000000b";

const leader: UserLike = {
  id: "u-leader",
  role: "participant",
  institutionId: INST_A,
};
const member: UserLike = {
  id: "u-member",
  role: "participant",
  institutionId: INST_A,
};
const otherInstMember: UserLike = {
  id: "u-other",
  role: "participant",
  institutionId: INST_B,
};
const spocA: UserLike = { id: "u-spoc-a", role: "spoc", institutionId: INST_A };
const spocB: UserLike = { id: "u-spoc-b", role: "spoc", institutionId: INST_B };
const mentor: UserLike = { id: "u-mentor", role: "mentor", institutionId: INST_A };
const evaluator: UserLike = { id: "u-eval", role: "evaluator" };
const creator: UserLike = { id: "u-creator", role: "problem_creator" };
const admin: UserLike = { id: "u-admin", role: "super_admin" };

const teamA = { id: "t-a", institutionId: INST_A, leaderUserId: "u-leader" };
const teamB = { id: "t-b", institutionId: INST_B, leaderUserId: "u-other" };

const ctxLeaderOwn: CanContext = {
  team: teamA,
  ownTeamIds: new Set(["t-a"]),
};
const ctxMemberOwn: CanContext = {
  team: teamA,
  ownTeamIds: new Set(["t-a"]),
};
// ownTeamIds is ALWAYS the caller's membership set (service resolves it).
const ctxOtherTeam: CanContext = {
  team: teamB,
  ownTeamIds: new Set(["t-a"]), // caller = leader (of t-a), viewing t-b
};
const ctxOtherInstOwn: CanContext = {
  team: teamB,
  ownTeamIds: new Set(["t-b"]), // caller = u-other (of t-b)
};
const ctxSpocOwn: CanContext = { team: teamA };
const ctxSpocForeign: CanContext = { team: teamB };
const ctxMentorAssigned: CanContext = {
  team: teamA,
  mentorAssignedTeamIds: new Set(["t-a"]),
};
const ctxMentorUnassigned: CanContext = {
  team: teamA,
  mentorAssignedTeamIds: new Set(["t-z"]),
};
const evalCtx = (over: Partial<NonNullable<CanContext["evaluation"]>> = {}) => ({
  evaluation: {
    id: "e-1",
    evaluatorUserId: "u-eval",
    proposalTeamId: "t-a",
    conflict: null,
    status: "in_progress" as const,
    ...over,
  },
});

describe("S1 central authorisation: can(user, permission, ctx)", () => {
  it("leader powers are scoped to own team only", () => {
    for (const p of [
      Permissions.teamUpdate,
      Permissions.teamInvite,
      Permissions.teamRemoveMember,
      Permissions.teamWithdraw,
      Permissions.proposalCreate,
      Permissions.proposalUpdate,
      Permissions.proposalSubmit,
    ] as const) {
      expect(can(leader, p, ctxLeaderOwn), p).toBe(true);
      expect(can(leader, p, ctxOtherTeam), p).toBe(false);
      // members do NOT inherit leader powers (brief §5.1)
      expect(can(member, p, ctxMemberOwn), p).toBe(false);
    }
  });

  it("participants see only their own teams", () => {
    expect(can(leader, Permissions.teamView, ctxLeaderOwn)).toBe(true);
    expect(can(leader, Permissions.teamView, ctxOtherTeam)).toBe(false);
    expect(can(otherInstMember, Permissions.teamView, ctxOtherInstOwn)).toBe(true);
  });

  it("SPOC is scoped to own institution", () => {
    // spocA (INST_A) over teamA (INST_A): allowed
    expect(can(spocA, Permissions.teamVerify, ctxSpocOwn)).toBe(true);
    expect(can(spocA, Permissions.teamShortlist, ctxSpocOwn)).toBe(true);
    expect(can(spocA, Permissions.teamView, ctxSpocOwn)).toBe(true);
    // spocA (INST_A) over teamB (INST_B): cross-institution SPOC — FORBIDDEN
    expect(can(spocA, Permissions.teamVerify, ctxSpocForeign)).toBe(false);
    expect(can(spocA, Permissions.teamShortlist, ctxSpocForeign)).toBe(false);
    expect(can(spocA, Permissions.teamView, ctxSpocForeign)).toBe(false);
    // spocB (INST_B) over teamB (INST_B): their own institution — allowed
    expect(can(spocB, Permissions.teamVerify, ctxSpocForeign)).toBe(true);
    expect(spocAInstitutionOnly(spocA)).toBe(true);
  });

  it("mentor powers apply to assigned teams only (feedback separate from scores)", () => {
    expect(can(mentor, Permissions.mentorViewTeams, ctxMentorAssigned)).toBe(true);
    expect(can(mentor, Permissions.mentorFeedback, ctxMentorAssigned)).toBe(true);
    expect(can(mentor, Permissions.mentorViewTeams, ctxMentorUnassigned)).toBe(false);
    expect(can(mentor, Permissions.mentorFeedback, ctxMentorUnassigned)).toBe(false);
    // mentors never score
    expect(can(mentor, Permissions.evaluationScore, evalCtx())).toBe(false);
  });

  it("evaluator sees ONLY own evaluations (S3 own vs all split)", () => {
    const otherEval: UserLike = { id: "u-eval-2", role: "evaluator" };
    const mine = evalCtx();
    const theirs = evalCtx({ evaluatorUserId: "u-eval-2" });
    expect(can(evaluator, Permissions.evaluationViewOwn, mine)).toBe(true);
    expect(can(evaluator, Permissions.evaluationViewOwn, theirs)).toBe(false);
    expect(can(evaluator, Permissions.evaluationScore, mine)).toBe(true);
    expect(can(evaluator, Permissions.evaluationScore, theirs)).toBe(false);
    expect(can(otherEval, Permissions.evaluationViewOwn, mine)).toBe(false);
    // view_all is admin-only
    expect(can(evaluator, Permissions.evaluationViewAll, mine)).toBe(false);
    expect(can(admin, Permissions.evaluationViewAll, mine)).toBe(true);
  });

  it("S5: conflict declaration blocks scoring for both levels", () => {
    expect(
      can(evaluator, Permissions.evaluationScore, evalCtx({ conflict: "potential" }))
    ).toBe(false);
    expect(
      can(evaluator, Permissions.evaluationScore, evalCtx({ conflict: "conflict" }))
    ).toBe(false);
    expect(
      can(evaluator, Permissions.evaluationSubmit, evalCtx({ conflict: "conflict" }))
    ).toBe(false);
    // but the declaration itself + admin reopen remain possible
    expect(
      can(evaluator, Permissions.evaluationConflictDeclare, evalCtx({ conflict: "potential" }))
    ).toBe(true);
    expect(can(admin, Permissions.evaluationReopen, evalCtx({ conflict: "conflict" }))).toBe(
      true
    );
    // locked evaluations: no scoring until admin reopens
    expect(can(evaluator, Permissions.evaluationScore, evalCtx({ status: "locked" }))).toBe(
      false
    );
    expect(can(admin, Permissions.evaluationReopen, evalCtx({ status: "locked" }))).toBe(
      true
    );
  });

  it("S2 document ACL: team / own-inst SPOC / assigned mentor / assigned evaluator / admin", () => {
    const docTeam: CanContext = {
      team: teamA,
      document: { ownerKind: "team", ownerId: "t-a", teamId: "t-a" },
      ownTeamIds: new Set(["t-a"]),
      mentorAssignedTeamIds: new Set(["t-a"]),
      evaluatorAssignedTeamIds: new Set(["t-a"]),
    };
    expect(can(leader, Permissions.documentView, docTeam)).toBe(true);
    expect(can(member, Permissions.documentUpload, docTeam)).toBe(true);
    expect(can(spocA, Permissions.documentView, docTeam)).toBe(true);
    expect(can(mentor, Permissions.documentView, docTeam)).toBe(true);
    expect(can(evaluator, Permissions.documentView, docTeam)).toBe(true);
    expect(can(admin, Permissions.documentView, docTeam)).toBe(true);
    // cross-team participant, cross-institution SPOC, unassigned mentor/evaluator: NO
    // foreign doc: team t-b (INST_B); callers evaluated with THEIR OWN sets
    const foreignForSpocA: CanContext = {
      team: teamB,
      document: { ownerKind: "team", ownerId: "t-b", teamId: "t-b" },
      ownTeamIds: new Set(["t-a"]),
      mentorAssignedTeamIds: new Set(["t-z"]),
      evaluatorAssignedTeamIds: new Set(["t-z"]),
    };
    expect(can(spocA, Permissions.documentView, foreignForSpocA)).toBe(false);
    expect(can(mentor, Permissions.documentView, foreignForSpocA)).toBe(false);
    expect(can(evaluator, Permissions.documentView, foreignForSpocA)).toBe(false);
    expect(can(member, Permissions.documentView, foreignForSpocA)).toBe(false);
  });

  it("F5: proposalReview — problem creator of THIS proposal's PS, or own-institution SPOC only", () => {
    const teamAProposal = { teamId: "t-a", problemId: "ps-1", creatorUserId: "u-creator" };
    expect(can(creator, Permissions.proposalReview, { team: teamA, proposal: teamAProposal })).toBe(true);
    // a DIFFERENT problem creator: denied
    const other: UserLike = { id: "u-creator-2", role: "problem_creator" };
    expect(can(other, Permissions.proposalReview, { team: teamA, proposal: teamAProposal })).toBe(false);
    // problem creator with NO proposal ctx: denied (fail-closed)
    expect(can(creator, Permissions.proposalReview, { team: teamA })).toBe(false);
    // PS without recorded creator: no one can claim it
    expect(
      can(creator, Permissions.proposalReview, { team: teamA, proposal: { teamId: "t-a", problemId: "ps-1", creatorUserId: null } })
    ).toBe(false);
    // SPOC: own institution only, fail-closed on missing institution
    expect(can(spocA, Permissions.proposalReview, { team: teamA })).toBe(true);
    expect(can(spocB, Permissions.proposalReview, { team: teamA })).toBe(false);
    const spocNone: UserLike = { id: "u-spoc-none", role: "spoc", institutionId: null };
    expect(can(spocNone, Permissions.proposalReview, { team: teamA })).toBe(false);
    // other roles: denied
    expect(can(leader, Permissions.proposalReview, { team: teamA, proposal: teamAProposal })).toBe(false);
    expect(can(mentor, Permissions.proposalReview, { team: teamA, proposal: teamAProposal })).toBe(false);
  });

  it("F4: role sets are checked per-role and fail closed — no ?? fall-through", () => {
    const ctx: CanContext = {
      team: teamA,
      ownTeamIds: new Set<string>(),
      // a DEFINED, EMPTY mentor set plus a populated evaluator set:
      // a buggy `a ?? b` would hand a mentor the evaluator's team.
      mentorAssignedTeamIds: new Set<string>(),
      evaluatorAssignedTeamIds: new Set(["t-a"]),
    };
    expect(can(mentor, Permissions.teamView, ctx)).toBe(false);
    const ctx2: CanContext = {
      ...ctx,
      mentorAssignedTeamIds: new Set(["t-a"]),
      evaluatorAssignedTeamIds: new Set<string>(),
    };
    expect(can(evaluator, Permissions.teamView, ctx2)).toBe(false);
    expect(can(mentor, Permissions.teamView, ctx2)).toBe(true);
    expect(can(evaluator, Permissions.teamView, ctx)).toBe(true);
    // undefined sets: fail closed
    expect(can(mentor, Permissions.teamView, { team: teamA })).toBe(false);
    expect(can(evaluator, Permissions.teamView, { team: teamA })).toBe(false);
  });

  it("F2: upload is members-only; the SPOC letter is a separate institution-scoped permission", () => {
    const docTeam: CanContext = {
      team: teamA,
      document: { ownerKind: "team", ownerId: "t-a", teamId: "t-a" },
      ownTeamIds: new Set(["t-a"]),
      mentorAssignedTeamIds: new Set(["t-a"]),
      evaluatorAssignedTeamIds: new Set(["t-a"]),
    };
    // read-only roles cannot upload, even when assigned
    expect(can(mentor, Permissions.documentUpload, docTeam)).toBe(false);
    expect(can(evaluator, Permissions.documentUpload, docTeam)).toBe(false);
    // cross-team member cannot upload
    const foreignForMember: CanContext = {
      team: teamB,
      document: { ownerKind: "team", ownerId: "t-b", teamId: "t-b" },
      ownTeamIds: new Set(["t-a"]),
    };
    expect(can(member, Permissions.documentUpload, foreignForMember)).toBe(false);
    // letter: only the SPOC of the TEAM's institution, letter purpose, fail-closed
    const letterCtx: CanContext = {
      team: teamA,
      document: { ownerKind: "team", ownerId: "t-a", teamId: "t-a", purpose: "authorization_letter" },
      ownTeamIds: new Set<string>(),
    };
    expect(can(spocA, Permissions.documentUploadLetter, letterCtx)).toBe(true);
    expect(can(spocB, Permissions.documentUploadLetter, letterCtx)).toBe(false);
    expect(can(leader, Permissions.documentUploadLetter, letterCtx)).toBe(false);
    // non-letter purpose: the letter permission never grants
    const nonLetter: CanContext = {
      ...letterCtx,
      document: { ...letterCtx.document!, purpose: "consent_form" },
    };
    expect(can(spocA, Permissions.documentUploadLetter, nonLetter)).toBe(false);
    // SPOC without institution: fail-closed
    const spocNoInst: UserLike = { id: "u-spoc-none", role: "spoc", institutionId: null };
    expect(can(spocNoInst, Permissions.documentUploadLetter, letterCtx)).toBe(false);
    // (members uploading letter-purpose docs are blocked in the SERVICE:
    //  letter purpose routes through documentUploadLetter only — integration
    //  documents.test.ts covers it)
  });

  it("problem creator: draft/edit own PS before approval; approve/publish admin-only", () => {
    const mine = { problem: { creatorUserId: "u-creator" } };
    const other = { problem: { creatorUserId: "u-creator-2" } };
    expect(can(creator, Permissions.problemCreate, {})).toBe(true);
    expect(can(creator, Permissions.problemUpdate, mine)).toBe(true);
    expect(can(creator, Permissions.problemUpdate, other)).toBe(false);
    expect(can(creator, Permissions.problemApprove, mine)).toBe(false);
    expect(can(admin, Permissions.problemApprove, mine)).toBe(true);
    expect(can(admin, Permissions.problemPublish, mine)).toBe(true);
  });

  it("SPOC portal actions are institution-scoped", () => {
    expect(can(spocA, Permissions.spocViewTeams, { institutionId: INST_A })).toBe(true);
    expect(can(spocA, Permissions.spocAnalytics, { institutionId: INST_B })).toBe(false);
    expect(can(spocA, Permissions.spocExport, { institutionId: INST_B })).toBe(false);
    expect(can(participantAsSpoc(), Permissions.spocViewTeams, {})).toBe(false);
  });

  it("F1: invite accept/decline are the invitee's self-actions only", () => {
    expect(can(leader, Permissions.teamAcceptInvite)).toBe(true);
    expect(can(member, Permissions.teamDeclineInvite)).toBe(true);
    expect(can(spocA, Permissions.teamAcceptInvite)).toBe(false);
    expect(can(evaluator, Permissions.teamDeclineInvite)).toBe(false);
    expect(can(creator, Permissions.teamAcceptInvite)).toBe(false);
  });

  it("admin has everything; unauthenticated user has nothing", () => {
    const perms = Object.values(Permissions);
    for (const p of perms) expect(can(admin, p, ctxLeaderOwn)).toBe(true);
    for (const p of perms) expect(can(null, p, ctxLeaderOwn)).toBe(false);
  });
});

function participantAsSpoc(): UserLike {
  return { id: "u-p", role: "participant", institutionId: INST_A };
}
function spocAInstitutionOnly(u: UserLike): boolean {
  return can(u, Permissions.spocViewTeams, { institutionId: u.institutionId ?? "x" });
}
