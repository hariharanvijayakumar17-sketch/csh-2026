import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { evaluations, mentorships, proposals } from "../db/schema";

/**
 * F4: the two assignment sets can() checks. EVERY scope resolver that serves
 * a mentor/evaluator call MUST populate its caller's own set — a missing or
 * empty set denies access (fail-closed). Both sets are always populated in
 * resolveTeamScope / docCtx / ctxFor so a role swap or stale ctx can never
 * leak visibility through a `??` fall-through.
 */

/** Teams this user mentors (mentorships rows). */
export async function mentorAssignedTeamIds(userId: string): Promise<Set<string>> {
  const rows = await db
    .select({ teamId: mentorships.teamId })
    .from(mentorships)
    .where(eq(mentorships.mentorUserId, userId));
  return new Set(rows.map((r) => r.teamId));
}

/** Teams this user evaluates (has an evaluation on any proposal of the team). */
export async function evaluatorAssignedTeamIds(userId: string): Promise<Set<string>> {
  const rows = await db
    .select({ teamId: proposals.teamId })
    .from(evaluations)
    .innerJoin(proposals, eq(evaluations.proposalId, proposals.id))
    .where(eq(evaluations.evaluatorUserId, userId));
  return new Set(rows.map((r) => r.teamId));
}
