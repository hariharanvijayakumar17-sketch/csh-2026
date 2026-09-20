import "server-only";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { rounds, roundCriteria } from "../db/schema";
import { writeAudit } from "../audit";

/**
 * Round state transitions (P3 addendum 4).
 *
 * Per-row weight bounds (0..100) are DB-checked (P2). THIS is the
 * activation-time rule: the criteria weights of a round must sum to
 * EXACTLY 100 (2-dp precision — the column is numeric(5,2)). A round
 * that does not total 100 cannot be activated.
 */

export type ActivateRoundResult =
  | { ok: true; id: string; status: "active" }
  | { ok: false; code: "not_found" | "invalid_state" | "no_criteria" | "weights_sum_100"; detail?: string };

const ROUND_STATES = ["draft", "scheduled", "active", "closed"] as const;

export async function activateRound(
  roundId: string,
  actor?: { userId?: string | null; ip?: string | null; requestId?: string | null }
): Promise<ActivateRoundResult> {
  const [round] = await db
    .select()
    .from(rounds)
    .where(eq(rounds.id, roundId))
    .limit(1);
  if (!round) return { ok: false, code: "not_found" };
  if (round.status === "active" || round.status === "closed") {
    return { ok: false, code: "invalid_state", detail: `round is ${round.status}` };
  }

  const criteria = await db
    .select({ weight: roundCriteria.weight })
    .from(roundCriteria)
    .where(eq(roundCriteria.roundId, roundId));
  if (criteria.length === 0) return { ok: false, code: "no_criteria" };

  // numeric(5,2) → string from the driver; sum in integer cents to avoid
  // float drift, then require exactly 100.00.
  const cents = criteria.reduce((sum, c) => {
    const w = Number(c.weight);
    if (!Number.isFinite(w)) return Number.NaN;
    return sum + Math.round(w * 100);
  }, 0);
  if (Number.isNaN(cents) || cents !== 100 * 100) {
    const total = (cents / 100).toFixed(2);
    await writeAudit({
      action: "round.activate_rejected",
      actorUserId: actor?.userId ?? null,
      actorIp: actor?.ip ?? null,
      requestId: actor?.requestId ?? null,
      entityKind: "round",
      entityId: roundId,
      metadata: { weightSum: total },
    });
    return {
      ok: false,
      code: "weights_sum_100",
      detail: `criteria weights sum to ${total}; they must total exactly 100`,
    };
  }

  await db.update(rounds).set({ status: "active" }).where(eq(rounds.id, roundId));
  await writeAudit({
    action: "round.activated",
    actorUserId: actor?.userId ?? null,
    actorIp: actor?.ip ?? null,
    requestId: actor?.requestId ?? null,
    entityKind: "round",
    entityId: roundId,
  });
  return { ok: true, id: roundId, status: "active" };
}

export { ROUND_STATES };
