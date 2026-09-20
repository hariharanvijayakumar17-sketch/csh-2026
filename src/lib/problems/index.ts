import "server-only";
import { and, desc, eq, ilike, isNull, or, sql, type SQL } from "drizzle-orm";
import { db } from "../db/client";
import { clarifications, problemStatements } from "../db/schema";

/**
 * P4: public problem repository.
 * Public surface exposes ONLY status='published' AND non-deleted problems —
 * drafts/archived are invisible to anonymous callers (creator/admin views
 * come in P6 with can()-gated variants).
 */

export interface ProblemDTO {
  id: string;
  code: string;
  title: string;
  department: string | null;
  theme: string | null;
  category: string | null;
  description: string;
  background: string | null;
  expectedSolution: string | null;
  tags: string[] | null;
  difficulty: string;
  publishedAt: Date | null;
}

export interface ClarificationDTO {
  id: string;
  question: string;
  answer: string | null;
  createdAt: Date;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toDTO(r: typeof problemStatements.$inferSelect): ProblemDTO {
  return {
    id: r.id,
    code: r.code,
    title: r.title,
    department: r.department,
    theme: r.theme,
    category: r.category,
    description: r.description,
    background: r.background,
    expectedSolution: r.expectedSolution,
    tags: r.tags,
    difficulty: r.difficulty,
    publishedAt: r.publishedAt,
  };
}

export interface ListProblemsOptions {
  q?: string;
  category?: string;
  theme?: string;
  page?: number;
  pageSize?: number;
}

export async function listProblems(opts: ListProblemsOptions = {}) {
  const page = Math.max(1, Math.floor(opts.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Math.floor(opts.pageSize ?? 20)));
  const conds: SQL<unknown>[] = [
    eq(problemStatements.status, "published"),
    isNull(problemStatements.deletedAt),
  ];
  if (opts.q) {
    const q = `%${opts.q.trim()}%`;
    const search = or(
      ilike(problemStatements.title, q),
      ilike(problemStatements.description, q),
      ilike(problemStatements.code, q)
    );
    if (search) conds.push(search);
  }
  if (opts.category) conds.push(eq(problemStatements.category, opts.category));
  if (opts.theme) conds.push(eq(problemStatements.theme, opts.theme));
  const where = and(...conds);

  const [totalRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(problemStatements)
    .where(where);
  const rows = await db
    .select()
    .from(problemStatements)
    .where(where)
    .orderBy(desc(problemStatements.publishedAt), desc(problemStatements.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return {
    items: rows.map(toDTO),
    total: totalRow?.count ?? 0,
    page,
    pageSize,
  };
}

/** Public lookup by human code (PS-2026-0001) or uuid; published only. */
export async function getProblem(ref: string): Promise<ProblemDTO | null> {
  const cond = UUID_RE.test(ref)
    ? eq(problemStatements.id, ref)
    : eq(problemStatements.code, ref);
  const rows = await db
    .select()
    .from(problemStatements)
    .where(and(cond, eq(problemStatements.status, "published"), isNull(problemStatements.deletedAt)))
    .limit(1);
  return rows[0] ? toDTO(rows[0]) : null;
}

/** Public Q&A for a published problem; draft problems expose nothing. */
export async function listClarifications(problemId: string): Promise<ClarificationDTO[]> {
  if (!UUID_RE.test(problemId)) return [];
  const rows = await db
    .select({
      id: clarifications.id,
      question: clarifications.question,
      answer: clarifications.answer,
      createdAt: clarifications.createdAt,
      status: problemStatements.status,
      deletedAt: problemStatements.deletedAt,
    })
    .from(clarifications)
    .innerJoin(problemStatements, eq(clarifications.problemId, problemStatements.id))
    .where(and(eq(clarifications.problemId, problemId), isNull(clarifications.deletedAt)))
    .orderBy(clarifications.createdAt)
    .limit(500);
  return rows
    .filter((r) => r.status === "published" && r.deletedAt === null)
    .map((r) => ({ id: r.id, question: r.question, answer: r.answer, createdAt: r.createdAt }));
}
