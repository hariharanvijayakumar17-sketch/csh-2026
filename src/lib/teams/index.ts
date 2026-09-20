import "server-only";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../db/client";
import {
  documents,
  institutions,
  problemStatements,
  teamMembers,
  teamProblems,
  teams,
  users,
} from "../db/schema";
import { evaluatorAssignedTeamIds, mentorAssignedTeamIds } from "../authz/assigned-teams";
import { can, Permissions, type CanContext, type UserLike } from "../authz/permissions";
import { getNumberSetting, getSetting } from "../settings";
import { ApiError } from "../http/error";

/**
 * P5: teams — composition rules (settings-driven), same-institution only,
 * caps, leader-only powers. Every operation starts from can() (S1).
 */

export interface TeamMemberDTO {
  userId: string;
  email: string;
  fullName: string;
  gender: string | null;
  role: "leader" | "member";
  status: "invited" | "accepted" | "removed" | "withdrawn" | "declined";
  acceptedAt: Date | null;
}

export interface TeamDTO {
  id: string;
  name: string;
  status: string;
  leaderUserId: string;
  institutionId: string;
  institutionName: string;
  problemIds: string[];
  problems: { id: string; code: string; title: string; isPrimary: boolean }[];
  members: TeamMemberDTO[];
  createdAt: Date;
}

const TEAM_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 _\-]{1,59}$/;

async function loadTeamOr404(teamId: string) {
  const rows = await db
    .select({
      id: teams.id,
      name: teams.name,
      status: teams.status,
      leaderUserId: teams.leaderUserId,
      institutionId: teams.institutionId,
    })
    .from(teams)
    .where(and(eq(teams.id, teamId), isNull(teams.deletedAt)))
    .limit(1);
  if (rows.length === 0) throw new ApiError("NOT_FOUND", "Team not found");
  return rows[0];
}

/**
 * F1: membership for EVERY permission check = ACCEPTED rows in a team that
 * is not withdrawn/rejected. Invited-but-not-accepted rows grant NOTHING
 * (probe A); stale invites and withdrawn teams never block a person
 * (probe F1 rule). Invited-only lookups live in pendingInvite/declineInvite.
 */
export async function activeMembershipTeamIds(userId: string): Promise<Set<string>> {
  const rows = await db
    .select({ teamId: teamMembers.teamId })
    .from(teamMembers)
    .innerJoin(teams, eq(teamMembers.teamId, teams.id))
    .where(
      and(
        eq(teamMembers.userId, userId),
        eq(teamMembers.status, "accepted"),
        inArray(teams.status, ["draft", "pending_verification", "verified", "shortlisted", "finalist", "winner"])
      )
    );
  return new Set(rows.map((r) => r.teamId));
}

async function ownTeamIds(userId: string): Promise<Set<string>> {
  return activeMembershipTeamIds(userId);
}

async function isAcceptedMember(userId: string, teamId: string): Promise<boolean> {
  const r = await db
    .select({ x: teamMembers.id })
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId), eq(teamMembers.status, "accepted")))
    .limit(1);
  return r.length > 0;
}

/** Pending (not yet accepted/declined) invitation rows for a user. */
async function pendingInviteRows(userId: string) {
  return db
    .select({ teamId: teamMembers.teamId })
    .from(teamMembers)
    .where(and(eq(teamMembers.userId, userId), eq(teamMembers.status, "invited")));
}

async function declineStaleInvites(userId: string, keepTeamId?: string) {
  const rows = await pendingInviteRows(userId);
  for (const r of rows) {
    if (r.teamId === keepTeamId) continue;
    await db
      .update(teamMembers)
      .set({ status: "declined" })
      .where(and(eq(teamMembers.teamId, r.teamId), eq(teamMembers.userId, userId), eq(teamMembers.status, "invited")));
  }
}

function requireCan(user: UserLike, permission: Parameters<typeof can>[1], team: { id: string; leaderUserId: string; institutionId: string }) {
  const ctx = { team, ownTeamIds: new Set([team.id]) };
  if (!can(user, permission, ctx)) {
    throw new ApiError("FORBIDDEN", "You do not have access to this team");
  }
}

function assertDraft(team: { status: string }, what: string) {
  if (team.status !== "draft") {
    throw new ApiError("CONFLICT", `Team is ${team.status}; cannot ${what} in this state`);
  }
}

/** Route-level scope resolver: fills call.ctx for can() BEFORE the handler
 * (makeRouteHandler.resolveCtx). The service re-checks internally — the route
 * layer is a second, not the only, gate. */
export async function resolveTeamScope(user: UserLike, teamId: string): Promise<CanContext> {
  const team = await loadTeamOr404(teamId);
  // F1: per-team ACCEPTED membership for the scope (invited rows grant nothing;
  // withdrawn teams remain visible to their members)
  const memberOk = await isAcceptedMember(user.id, teamId);
  // F4: populate BOTH assignment sets (fail-closed per role; no fall-through)
  return {
    team,
    ownTeamIds: memberOk ? new Set<string>([teamId]) : new Set<string>(),
    mentorAssignedTeamIds: user.role === "mentor" ? await mentorAssignedTeamIds(user.id) : undefined,
    evaluatorAssignedTeamIds: user.role === "evaluator" ? await evaluatorAssignedTeamIds(user.id) : undefined,
  };
}

export async function createTeam(
  user: UserLike,
  input: { name: string }
): Promise<TeamDTO> {
  if (!can(user, Permissions.teamCreate)) {
    throw new ApiError("FORBIDDEN", "Only registered participants can create teams");
  }
  const name = input.name.trim();
  if (!TEAM_NAME_RE.test(name)) {
    throw new ApiError("BAD_REQUEST", "Team name: 2–60 chars, letters/digits/space/-/_ (no leading symbol)");
  }
  const userRows = await db
    .select({ institutionId: users.institutionId })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);
  const instId = userRows[0]?.institutionId ?? user.institutionId;
  if (!instId) {
    throw new ApiError("BAD_REQUEST", "Your profile has no institution — contact your SPOC to be added to your college");
  }

  const existing = await ownTeamIds(user.id);
  if (existing.size > 0) {
    throw new ApiError("CONFLICT", "You are already part of a team (one team per person)");
  }
  // F1: forming a team auto-declines stale pending invitations
  await declineStaleInvites(user.id);

  const dup = await db
    .select({ id: teams.id })
    .from(teams)
    .where(and(eq(sql`lower(${teams.name})`, sql`${name.toLowerCase()}`), isNull(teams.deletedAt)))
    .limit(1);
  if (dup.length > 0) throw new ApiError("CONFLICT", "A team with this name already exists");

  const [team] = await db
    .insert(teams)
    .values({ name, institutionId: instId, leaderUserId: user.id, status: "draft" })
    .returning({ id: teams.id, status: teams.status, leaderUserId: teams.leaderUserId, institutionId: teams.institutionId, name: teams.name });

  await db.insert(teamMembers).values({
    teamId: team.id,
    userId: user.id,
    role: "leader",
    status: "accepted",
    acceptedAt: new Date(),
  });

  const instRows = await db.select({ name: institutions.name }).from(institutions).where(eq(institutions.id, instId)).limit(1);
  return {
    id: team.id,
    name: team.name,
    status: team.status,
    leaderUserId: team.leaderUserId,
    institutionId: team.institutionId,
    institutionName: instRows[0]?.name ?? "",
    problemIds: [],
    problems: [],
    members: [
      {
        userId: user.id,
        email: user.email ?? "",
        fullName: user.fullName ?? "",
        gender: null,
        role: "leader",
        status: "accepted",
        acceptedAt: new Date(),
      },
    ],
    createdAt: new Date(),
  };
}

async function teamCapacity(): Promise<number> {
  const cap = await getNumberSetting("team.max_members", 6);
  return Math.min(cap, 6); // hard ceiling: brief rule
}

export async function inviteMember(
  leader: UserLike,
  teamId: string,
  input: { email: string }
): Promise<TeamMemberDTO> {
  const team = await loadTeamOr404(teamId);
  requireCan(leader, Permissions.teamInvite, team);
  assertDraft(team, "invite members");

  const [invitee] = await db
    .select({
      id: users.id,
      email: users.email,
      fullName: users.fullName,
      gender: users.gender,
      institutionId: users.institutionId,
    })
    .from(users)
    .where(eq(sql`lower(${users.email})`, sql`${input.email.toLowerCase()}`))
    .limit(1);
  if (!invitee) {
    // non-enumerating: say the user is not registered (no per-email hints beyond that)
    throw new ApiError("BAD_REQUEST", "That email is not registered");
  }
  if (invitee.institutionId !== team.institutionId) {
    throw new ApiError("FORBIDDEN", "All members must be from the same institution (your SPOC must add them to your college first)");
  }
  const cap = await teamCapacity();
  const members = await db
    .select({ id: teamMembers.id })
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), inArray(teamMembers.status, ["invited", "accepted"])));
  if (members.length >= cap) {
    throw new ApiError("CONFLICT", `Team is full (max ${cap} members, settings team.max_members)`);
  }
  const already = await db
    .select({ id: teamMembers.id })
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, invitee.id), inArray(teamMembers.status, ["invited", "accepted"])))
    .limit(1);
  if (already.length > 0) throw new ApiError("CONFLICT", "This member is already on the team");

  // one-team-per-person at the point of invitation too (ACCEPTED only — F1)
  const busy = await ownTeamIds(invitee.id);
  if (busy.size > 0) {
    throw new ApiError("CONFLICT", "That user is already part of another team");
  }

  const [m] = await db
    .insert(teamMembers)
    .values({ teamId, userId: invitee.id, role: "member", status: "invited" })
    .returning({
      userId: teamMembers.userId,
      role: teamMembers.role,
      status: teamMembers.status,
      acceptedAt: teamMembers.acceptedAt,
    });
  return { userId: invitee.id, email: invitee.email, fullName: invitee.fullName, gender: invitee.gender, role: m.role, status: m.status, acceptedAt: m.acceptedAt };
}

export async function acceptInvite(user: UserLike, teamId: string): Promise<TeamDTO> {
  const team = await loadTeamOr404(teamId);
  const [member] = await db
    .select({ userId: teamMembers.userId, status: teamMembers.status })
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, user.id)))
    .limit(1);
  if (!member || member.status !== "invited") {
    throw new ApiError("NOT_FOUND", "No pending invitation for you on this team");
  }
  const [profile] = await db
    .select({ institutionId: users.institutionId })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);
  if ((profile?.institutionId ?? user.institutionId) !== team.institutionId) {
    throw new ApiError("FORBIDDEN", "You must belong to the same institution as this team");
  }
  const cap = await teamCapacity();
  const count = await db
    .select({ id: teamMembers.id })
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), inArray(teamMembers.status, ["invited", "accepted"])));
  if (count.length > cap) throw new ApiError("CONFLICT", "Team is full");

  await db
    .update(teamMembers)
    .set({ status: "accepted", acceptedAt: new Date() })
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, user.id), eq(teamMembers.status, "invited")));
  // F1: accepting here declines every other pending invitation
  await declineStaleInvites(user.id, teamId);
  return getTeam(user, teamId);
}

/** F1: the invitee declines a pending invitation (the invitee's own team
 *  stays blocked-free because invited rows never count as membership). */
export async function declineInvite(user: UserLike, teamId: string): Promise<void> {
  const member = await db
    .select({ id: teamMembers.id })
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, user.id), eq(teamMembers.status, "invited")))
    .limit(1);
  if (member.length === 0) {
    throw new ApiError("NOT_FOUND", "No pending invitation for you on this team");
  }
  await db
    .update(teamMembers)
    .set({ status: "declined" })
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, user.id), eq(teamMembers.status, "invited")));
}

export async function removeMember(
  leader: UserLike,
  teamId: string,
  userId: string
): Promise<TeamDTO> {
  const team = await loadTeamOr404(teamId);
  requireCan(leader, Permissions.teamRemoveMember, team);
  assertDraft(team, "remove members");
  if (userId === team.leaderUserId) {
    throw new ApiError("BAD_REQUEST", "The leader cannot be removed from the team");
  }
  await db
    .update(teamMembers)
    .set({ status: "removed" })
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId), inArray(teamMembers.status, ["invited", "accepted"])));
  return getTeam(leader, teamId);
}

export async function withdrawTeam(user: UserLike, teamId: string): Promise<TeamDTO> {
  const team = await loadTeamOr404(teamId);
  requireCan(user, Permissions.teamWithdraw, team);
  if (team.status === "withdrawn") throw new ApiError("CONFLICT", "Team already withdrawn");
  await db.update(teams).set({ status: "withdrawn" }).where(eq(teams.id, teamId));
  return getTeam(user, teamId);
}

export async function setTeamProblems(
  leader: UserLike,
  teamId: string,
  problemIds: string[]
): Promise<TeamDTO> {
  const team = await loadTeamOr404(teamId);
  requireCan(leader, Permissions.teamUpdate, team);
  assertDraft(team, "change problems");

  const ids = [...new Set(problemIds)];
  if (ids.length !== problemIds.length) throw new ApiError("BAD_REQUEST", "Duplicate problems in selection");
  if (ids.length === 0) throw new ApiError("BAD_REQUEST", "Select at least one problem");
  const max = await getNumberSetting("team.max_problems", 2);
  if (ids.length > Math.min(max, 2)) {
    throw new ApiError("CONFLICT", `Teams may select at most ${Math.min(max, 2)} problem statements`);
  }
  const rows = await db
    .select({ id: problemStatements.id, status: problemStatements.status })
    .from(problemStatements)
    .where(and(inArray(problemStatements.id, ids), isNull(problemStatements.deletedAt)));
  const found = new Set(rows.map((r) => r.id));
  if (rows.length !== ids.length) throw new ApiError("BAD_REQUEST", "One or more problems do not exist");
  if (rows.some((r) => r.status !== "published")) {
    throw new ApiError("BAD_REQUEST", "Only published problems can be selected");
  }

  await db.transaction(async (tx) => {
    await tx.delete(teamProblems).where(eq(teamProblems.teamId, teamId));
    for (let i = 0; i < ids.length; i++) {
      await tx.insert(teamProblems).values({ teamId, problemId: ids[i], isPrimary: i === 0 });
    }
  });
  void found;
  return getTeam(leader, teamId);
}

export async function getTeam(user: UserLike, teamId: string): Promise<TeamDTO> {
  const team = await loadTeamOr404(teamId);
  // F1: per-team ACCEPTED membership (invited rows grant nothing; withdrawn
  // teams stay visible to their members — uploads are locked by state gates)
  const memberOk = await isAcceptedMember(user.id, teamId);
  const ctx = {
    team,
    ownTeamIds: memberOk ? new Set<string>([teamId]) : new Set<string>(),
    mentorAssignedTeamIds: undefined,
    evaluatorAssignedTeamIds: undefined,
  };
  // F4: assigned mentors/evaluators see assigned teams — each role's own set,
  // fail-closed (no fall-through)
  const mentorIds = user.role === "mentor" ? await mentorAssignedTeamIds(user.id) : undefined;
  const evaluatorIds = user.role === "evaluator" ? await evaluatorAssignedTeamIds(user.id) : undefined;
  if (!can(user, Permissions.teamView, { ...ctx, mentorAssignedTeamIds: mentorIds, evaluatorAssignedTeamIds: evaluatorIds })) {
    throw new ApiError("FORBIDDEN", "You do not have access to this team");
  }

  const members = await db
    .select({
      userId: teamMembers.userId,
      email: users.email,
      fullName: users.fullName,
      gender: users.gender,
      role: teamMembers.role,
      status: teamMembers.status,
      acceptedAt: teamMembers.acceptedAt,
    })
    .from(teamMembers)
    .innerJoin(users, eq(teamMembers.userId, users.id))
    .where(and(eq(teamMembers.teamId, teamId), inArray(teamMembers.status, ["invited", "accepted"])))
    .orderBy(asc(teamMembers.role), asc(teamMembers.createdAt));

  const probs = await db
    .select({
      id: problemStatements.id,
      code: problemStatements.code,
      title: problemStatements.title,
      isPrimary: teamProblems.isPrimary,
    })
    .from(teamProblems)
    .innerJoin(problemStatements, eq(teamProblems.problemId, problemStatements.id))
    .where(eq(teamProblems.teamId, teamId))
    .orderBy(asc(problemStatements.code));

  const instRows = await db.select({ name: institutions.name }).from(institutions).where(eq(institutions.id, team.institutionId)).limit(1);

  return {
    id: team.id,
    name: team.name,
    status: team.status,
    leaderUserId: team.leaderUserId,
    institutionId: team.institutionId,
    institutionName: instRows[0]?.name ?? "",
    problemIds: probs.map((p) => p.id),
    problems: probs,
    members: members.map((m) => ({
      userId: m.userId,
      email: m.email,
      fullName: m.fullName,
      gender: m.gender,
      role: m.role,
      status: m.status,
      acceptedAt: m.acceptedAt,
    })),
    createdAt: new Date(),
  };
}

export async function updateTeam(
  leader: UserLike,
  teamId: string,
  input: { name: string }
): Promise<TeamDTO> {
  const team = await loadTeamOr404(teamId);
  requireCan(leader, Permissions.teamUpdate, team);
  assertDraft(team, "rename the team");
  const name = input.name.trim();
  if (!TEAM_NAME_RE.test(name)) {
    throw new ApiError("BAD_REQUEST", "Team name: 2–60 chars, letters/digits/space/-/_ (no leading symbol)");
  }
  const dup = await db
    .select({ id: teams.id })
    .from(teams)
    .where(
      and(
        eq(sql`lower(${teams.name})`, sql`${name.toLowerCase()}`),
        sql`${teams.id} <> ${teamId}`,
        isNull(teams.deletedAt)
      )
    )
    .limit(1);
  if (dup.length > 0) throw new ApiError("CONFLICT", "A team with this name already exists");
  await db.update(teams).set({ name }).where(eq(teams.id, teamId));
  return getTeam(leader, teamId);
}

/** "My teams" for the dashboard: participants see their own, SPOCs theirs' institution, mentors their assignments. */
export async function listMyTeams(user: UserLike): Promise<TeamDTO[]> {
  if (user.role === "spoc") return listInstitutionTeams(user);
  if (user.role === "mentor") {
    const rows = Array.from(await mentorAssignedTeamIds(user.id));
    const out: TeamDTO[] = [];
    for (const r of rows) out.push(await getTeam(user, r));
    return out;
  }
  const own = await ownTeamIds(user.id);
  const out: TeamDTO[] = [];
  for (const tid of own) out.push(await getTeam(user, tid));
  return out;
}

/** All teams of the caller's own institution — SPOC portal (P6 uses this). */
export async function listInstitutionTeams(spoc: UserLike): Promise<TeamDTO[]> {
  if (spoc.role !== "spoc" || !spoc.institutionId) {
    throw new ApiError("FORBIDDEN", "SPOCs of an institution list their own teams");
  }
  const rows = await db
    .select({ id: teams.id })
    .from(teams)
    .where(and(eq(teams.institutionId, spoc.institutionId), isNull(teams.deletedAt)));
  const out: TeamDTO[] = [];
  for (const r of rows) out.push(await getTeam(spoc, r.id));
  return out;
}

/** Team state a SPOC can verify (same institution, via can() S2-style). */
export async function verifyTeam(
  spoc: UserLike,
  teamId: string,
  input: { authorizationLetterDocId: string; notes?: string }
): Promise<TeamDTO> {
  const team = await loadTeamOr404(teamId);
  const ctx = { team, ownTeamIds: new Set<string>() };
  if (!can(spoc, Permissions.teamVerify, ctx)) {
    throw new ApiError("FORBIDDEN", "Only the SPOC of the team's institution can verify it");
  }
  const [doc] = await db
    .select({ id: documents.id })
    .from(documents)
    .where(and(eq(documents.id, input.authorizationLetterDocId), isNull(documents.deletedAt)))
    .limit(1);
  if (!doc) throw new ApiError("BAD_REQUEST", "Authorization letter document not found");
  await db
    .update(teams)
    .set({
      status: "verified",
      authorizationLetterDocId: input.authorizationLetterDocId,
      spocNotes: input.notes ?? null,
      verifiedAt: new Date(),
      verifiedBy: spoc.email ?? "spoc",
    })
    .where(eq(teams.id, teamId));
  return getTeam(spoc, teamId);
}

/** P5 note: setting key used for display in the UI (single source). */
export async function teamRules(): Promise<{ maxMembers: number; minFemale: number; maxProblems: number }> {
  const [maxMembers, minFemale, maxProblems] = await Promise.all([
    getNumberSetting("team.max_members", 6),
    getNumberSetting("team.min_female", 1),
    getNumberSetting("team.max_problems", 2),
  ]);
  void getSetting;
  return { maxMembers: Math.min(maxMembers, 6), minFemale, maxProblems: Math.min(maxProblems, 2) };
}
