import "server-only";
import { db } from "../db/client";
import { auditLog } from "../db/schema";

/**
 * Append-only audit writer (brief §5.4). The table rejects UPDATE/DELETE at
 * the DB level (P2 trigger); this is the single write path.
 */
export interface AuditInput {
  action: string;
  actorUserId?: string | null;
  actorIp?: string | null;
  requestId?: string | null;
  entityKind?: string | null;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
}

export async function writeAudit(input: AuditInput): Promise<void> {
  await db.insert(auditLog).values({
    actorUserId: input.actorUserId ?? null,
    actorIp: input.actorIp ?? null,
    requestId: input.requestId ?? null,
    action: input.action,
    entityKind: input.entityKind ?? null,
    entityId: input.entityId ?? null,
    metadata: (input.metadata ?? {}) as never,
  });
}
