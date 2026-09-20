import "server-only";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../db/client";
import {
  problemStatements,
  proposalVersions,
  proposals,
  rounds,
  teamMembers,
  teamProblems,
  teams,
  users,
} from "../db/schema";
import { evaluatorAssignedTeamIds, mentorAssignedTeamIds } from "../authz/assigned-teams";
import { can, Permissions, type CanContext, type UserLike } from "../authz/permissions";
import { getNumberSetting } from "../settings";
import { ApiError } from "../http/error";

/**
 * P5: proposals with IMMUTABLE versions (S4).
 *
 * Model:
 *  - working draft  = version row (currentVersion + 1, is_final=false)
 *  - submit         = ONE transaction: freeze that row (is_final=true),
 *                     set proposals.current_version/final_version_id/status
 *  - after submit   = no update path exists; DB trigger also blocks
 *                     UPDATE/DELETE of version rows (defense in depth)
 *  - resubmission   = only while status='changes_requested' (admin sets that
 *                     in P7); creates the NEXT version, never edits the old
 */

export interface ProposalDTO {
  id: string;
  teamId: string;
  problemId: string | null;
  roundId: string;
  status: string;
  title: string;
  currentVersion: number;
  finalVersionId: string | null;
  submittedAt: Date | null;
  version: ProposalVersionDTO | null;
}

export interface ProposalVersionDTO {
  id: string;
  versionNo: number;
  title: string;
  abstract: string | null;
  problemUnderstanding: string | null;
  solution: string;
  innovation: string | null;
  architecture: string | null;
  techStack: string | null;
  plan: string | null;
  impact: string | null;
  feasibility: string | null;
  sustainability: string | null;
  futureScope: string | null;
  isFinal: boolean;
}

export type DraftFields = {
  title?: string;
  solution?: string | null;
} & Partial<
  Pick<
    ProposalVersionDTO,
    "abstract" | "problemUnderstanding" | "innovation" | "architecture" | "techStack" | "plan" | "impact" | "feasibility" | "sustainability" | "futureScope"
  >
>;

const DRAFT_STATES = ["draft", "changes_requested"] as const;

async function loadTeam(teamId: string) {
  const rows = await db
    .select({ id: teams.id, leaderUserId: teams.leaderUserId, institutionId: teams.institutionId, status: teams.status })
    .from(teams)
    .where(and(eq(teams.id, teamId), isNull(teams.deletedAt)))
    .limit(1);
  if (rows.length === 0) throw new ApiError("NOT_FOUND", "Team not found");
  return rows[0];
}

async function ownTeamIds(userId: string): Promise<Set<string>> {
  // F1: accepted membership in a live team only (invited rows grant nothing)
  const rows = await db
    .select({ teamId: teamMembers.teamId })
    .from(teamMembers)
    .where(and(eq(teamMembers.userId, userId), eq(teamMembers.status, "accepted")));
  return new Set(rows.map((r) => r.teamId));
}

async function ctxFor(user: UserLike, teamId: string, problemId?: string | null) {
  const team = await loadTeam(teamId);
  const own = await ownTeamIds(user.id);
  // F4: both assignment sets populated — proposalView/feedback/check are
  // fail-closed per role
  // F5: the proposal's problem + its creator feed proposalReview scoping
  let creatorUserId: string | null = null;
  if (problemId) {
    const [ps] = await db
      .select({ creatorUserId: problemStatements.creatorUserId })
      .from(problemStatements)
      .where(eq(problemStatements.id, problemId))
      .limit(1);
    creatorUserId = ps?.creatorUserId ?? null;
  }
  return {
    team,
    ownTeamIds: own,
    proposal: { teamId, problemId: problemId ?? null, creatorUserId },
    mentorAssignedTeamIds: user.role === "mentor" ? await mentorAssignedTeamIds(user.id) : undefined,
    evaluatorAssignedTeamIds: user.role === "evaluator" ? await evaluatorAssignedTeamIds(user.id) : undefined,
  };
}

async function loadProposalOr404(id: string) {
  const rows = await db
    .select()
    .from(proposals)
    .where(and(eq(proposals.id, id), isNull(proposals.deletedAt)))
    .limit(1);
  if (rows.length === 0) throw new ApiError("NOT_FOUND", "Proposal not found");
  return rows[0];
}

function toVersion(r: typeof proposalVersions.$inferSelect): ProposalVersionDTO {
  return {
    id: r.id,
    versionNo: r.versionNo,
    title: r.title,
    abstract: r.abstract,
    problemUnderstanding: r.problemUnderstanding,
    solution: r.solution,
    innovation: r.innovation,
    architecture: r.architecture,
    techStack: r.techStack,
    plan: r.plan,
    impact: r.impact,
    feasibility: r.feasibility,
    sustainability: r.sustainability,
    futureScope: r.futureScope,
    isFinal: r.isFinal,
  };
}

export async function resolveProposalScope(user: UserLike, proposalId: string): Promise<CanContext> {
  const p = await loadProposalOr404(proposalId);
  return ctxFor(user, p.teamId, p.problemId);
}

export async function createProposal(
  user: UserLike,
  input: { teamId: string; problemId: string | null; roundId: string; title: string }
): Promise<ProposalDTO> {
  const title = input.title.trim();
  if (!title || title.length > 200) throw new ApiError("BAD_REQUEST", "Title: 1–200 chars");

  const ctx = await ctxFor(user, input.teamId, input.problemId);
  if (!can(user, Permissions.proposalCreate, ctx)) {
    throw new ApiError("FORBIDDEN", "Only the team leader can create proposals");
  }
  if (ctx.team.status === "withdrawn") throw new ApiError("CONFLICT", "Team is withdrawn");

  const [round] = await db.select().from(rounds).where(eq(rounds.id, input.roundId)).limit(1);
  if (!round) throw new ApiError("NOT_FOUND", "Round not found");

  if (input.problemId) {
    const sel = await db
      .select({ problemId: teamProblems.problemId })
      .from(teamProblems)
      .where(eq(teamProblems.teamId, input.teamId));
    if (!sel.some((s) => s.problemId === input.problemId)) {
      throw new ApiError("BAD_REQUEST", "This problem is not in your team's selection (or use open innovation: problemId=null)");
    }
    const [p] = await db
      .select({ id: problemStatements.id, status: problemStatements.status })
      .from(problemStatements)
      .where(eq(problemStatements.id, input.problemId))
      .limit(1);
    if (!p || p.status !== "published") throw new ApiError("BAD_REQUEST", "Problem must exist and be published");
  }

  // one proposal per (team, round)
  const dup = await db
    .select({ id: proposals.id })
    .from(proposals)
    .where(and(eq(proposals.teamId, input.teamId), eq(proposals.roundId, input.roundId), isNull(proposals.deletedAt)))
    .limit(1);
  if (dup.length > 0) throw new ApiError("CONFLICT", "Your team already has a proposal in this round");

  const [row] = await db
    .insert(proposals)
    .values({ teamId: input.teamId, problemId: input.problemId ?? null, roundId: input.roundId, title, status: "draft", currentVersion: 0 })
    .returning();
  return {
    id: row.id,
    teamId: row.teamId,
    problemId: row.problemId,
    roundId: row.roundId,
    status: row.status,
    title: row.title,
    currentVersion: row.currentVersion,
    finalVersionId: row.finalVersionId,
    submittedAt: row.submittedAt,
    version: null,
  };
}

/** Autosave: upsert the WORKING draft version (currentVersion + 1). */
export async function updateProposalDraft(
  user: UserLike,
  proposalId: string,
  fields: DraftFields
): Promise<ProposalDTO> {
  const p = await loadProposalOr404(proposalId);
  const ctx = await ctxFor(user, p.teamId, p.problemId);
  if (!can(user, Permissions.proposalUpdate, ctx)) {
    throw new ApiError("FORBIDDEN", "Only the team leader can edit this proposal");
  }
  if (!(DRAFT_STATES as readonly string[]).includes(p.status)) {
    throw new ApiError("CONFLICT", `Proposal is ${p.status}; edits allowed only while draft or after 'changes requested'`);
  }

  const versionNo = p.currentVersion + 1;
  const patch: Partial<Record<keyof DraftFields, string | null>> = {};
  for (const k of Object.keys(fields) as (keyof DraftFields)[]) {
    if (fields[k] !== undefined) patch[k] = fields[k];
  }

  await db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: proposalVersions.id })
      .from(proposalVersions)
      .where(and(eq(proposalVersions.proposalId, p.id), eq(proposalVersions.versionNo, versionNo)))
      .limit(1);
    if (existing.length === 0) {
      await tx.insert(proposalVersions).values({
        proposalId: p.id,
        versionNo,
        title: patch.title !== undefined ? String(patch.title) : p.title,
        solution: patch.solution !== undefined ? String(patch.solution) : "",
        abstract: patch.abstract ?? null,
        problemUnderstanding: patch.problemUnderstanding ?? null,
        innovation: patch.innovation ?? null,
        architecture: patch.architecture ?? null,
        techStack: patch.techStack ?? null,
        plan: patch.plan ?? null,
        impact: patch.impact ?? null,
        feasibility: patch.feasibility ?? null,
        sustainability: patch.sustainability ?? null,
        futureScope: patch.futureScope ?? null,
        isFinal: false,
      });
    } else {
      const set: Record<string, unknown> = { ...patch };
      if (set.title === undefined) set.title = p.title;
      if (set.solution === undefined) delete set.solution;
      await tx.update(proposalVersions).set(set).where(eq(proposalVersions.id, existing[0].id));
    }
    if (patch.title !== undefined) {
      await tx.update(proposals).set({ title: String(patch.title) }).where(eq(proposals.id, p.id));
    }
  });

  return getProposal(user, proposalId);
}

/**
 * Submit: freeze the working draft as the new final version, in ONE
 * transaction (S4). Rejected unless the round window is open and the team
 * composition is legal (min female members, settings-driven).
 */
export async function submitProposal(user: UserLike, proposalId: string): Promise<ProposalDTO> {
  const p = await loadProposalOr404(proposalId);
  const ctx = await ctxFor(user, p.teamId, p.problemId);
  if (!can(user, Permissions.proposalSubmit, ctx)) {
    throw new ApiError("FORBIDDEN", "Only the team leader can submit this proposal");
  }
  if (!(DRAFT_STATES as readonly string[]).includes(p.status)) {
    throw new ApiError("CONFLICT", `Proposal is ${p.status}; nothing to submit`);
  }

  // round window (S4)
  const [round] = await db.select().from(rounds).where(eq(rounds.id, p.roundId)).limit(1);
  const now = new Date();
  if (
    !round ||
    round.status !== "active" ||
    !round.startsAt ||
    !round.endsAt ||
    round.startsAt > now ||
    round.endsAt < now
  ) {
    throw new ApiError("CONFLICT", "The submission window for this round is not open");
  }

  // team composition (settings-driven; hard rules: ≥1 female per brief)
  const minFemale = await getNumberSetting("team.min_female", 1);
  const members = await db
    .select({ gender: users.gender, status: teamMembers.status })
    .from(teamMembers)
    .innerJoin(users, eq(teamMembers.userId, users.id))
    .where(and(eq(teamMembers.teamId, p.teamId), eq(teamMembers.status, "accepted")));
  if (members.length === 0) throw new ApiError("CONFLICT", "No accepted team members");
  const females = members.filter((m) => m.gender === "female").length;
  if (females < Math.max(1, minFemale)) {
    throw new ApiError("CONFLICT", `Team needs at least ${Math.max(1, minFemale)} female member(s) (current: ${females})`);
  }

  const versionNo = p.currentVersion + 1;
  const [draft] = await db
    .select({ id: proposalVersions.id, solution: proposalVersions.solution })
    .from(proposalVersions)
    .where(and(eq(proposalVersions.proposalId, p.id), eq(proposalVersions.versionNo, versionNo), eq(proposalVersions.isFinal, false)))
    .limit(1);
  if (!draft) throw new ApiError("CONFLICT", "Nothing to submit — save a draft first");

  const [final] = await db
    .update(proposalVersions)
    .set({ isFinal: true })
    .where(eq(proposalVersions.id, draft.id))
    .returning({ id: proposalVersions.id });

  await db
    .update(proposals)
    .set({
      status: "submitted",
      currentVersion: versionNo,
      finalVersionId: final.id,
      submittedAt: now,
    })
    .where(and(eq(proposals.id, p.id), inArray(proposals.status, ["draft", "changes_requested"])));

  return getProposal(user, proposalId);
}

export async function getProposal(user: UserLike, proposalId: string): Promise<ProposalDTO> {
  const p = await loadProposalOr404(proposalId);
  const ctx = await ctxFor(user, p.teamId, p.problemId);
  if (!can(user, Permissions.proposalView, ctx)) {
    throw new ApiError("FORBIDDEN", "You do not have access to this proposal");
  }

  // the version shown: the final one if submitted, else the working draft
  const vrows = await db
    .select()
    .from(proposalVersions)
    .where(
      and(
        eq(proposalVersions.proposalId, p.id),
        p.status === "draft" || p.status === "changes_requested"
          ? eq(proposalVersions.versionNo, p.currentVersion + 1)
          : eq(proposalVersions.versionNo, p.currentVersion)
      )
    )
    .limit(1);
  return {
    id: p.id,
    teamId: p.teamId,
    problemId: p.problemId,
    roundId: p.roundId,
    status: p.status,
    title: p.title,
    currentVersion: p.currentVersion,
    finalVersionId: p.finalVersionId,
    submittedAt: p.submittedAt,
    version: vrows[0] ? toVersion(vrows[0]) : null,
  };
}

export async function listMyProposals(user: UserLike): Promise<ProposalDTO[]> {
  const own = await ownTeamIds(user.id);
  if (own.size === 0) return [];
  const rows = await db
    .select()
    .from(proposals)
    .where(and(inArray(proposals.teamId, [...own]), isNull(proposals.deletedAt)));
  const out: ProposalDTO[] = [];
  for (const p of rows) out.push(await getProposal(user, p.id));
  return out;
}
