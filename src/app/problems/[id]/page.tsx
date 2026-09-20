import Link from "next/link";
import { notFound } from "next/navigation";
import { getProblem, listClarifications } from "@/lib/problems";

export const dynamic = "force-dynamic";

export default async function ProblemPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const problem = await getProblem(decodeURIComponent(id));
  if (!problem) notFound();
  const clarifications = await listClarifications(problem.id);

  return (
    <article className="mx-auto max-w-3xl space-y-8">
      <Link href="/problems" className="text-sm text-slate-500 hover:underline">
        ← All problems
      </Link>
      <header>
        <div className="font-mono text-xs text-slate-400">{problem.code}</div>
        <h1 className="mt-1 text-3xl font-bold">{problem.title}</h1>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          {problem.category && (
            <span className="rounded bg-slate-100 px-2 py-0.5 text-slate-600">{problem.category}</span>
          )}
          {problem.theme && (
            <span className="rounded bg-slate-100 px-2 py-0.5 text-slate-600">{problem.theme}</span>
          )}
          {problem.department && (
            <span className="rounded bg-slate-100 px-2 py-0.5 text-slate-600">{problem.department}</span>
          )}
          <span className="rounded bg-slate-100 px-2 py-0.5 text-slate-600">{problem.difficulty}</span>
        </div>
      </header>

      <section>
        <h2 className="text-lg font-semibold">Description</h2>
        <p className="mt-2 whitespace-pre-line text-slate-700">{problem.description}</p>
      </section>

      {problem.background && (
        <section>
          <h2 className="text-lg font-semibold">Background</h2>
          <p className="mt-2 whitespace-pre-line text-slate-700">{problem.background}</p>
        </section>
      )}

      {problem.expectedSolution && (
        <section>
          <h2 className="text-lg font-semibold">Expected solution</h2>
          <p className="mt-2 whitespace-pre-line text-slate-700">{problem.expectedSolution}</p>
        </section>
      )}

      {problem.tags && problem.tags.length > 0 && (
        <section className="flex flex-wrap gap-2">
          {problem.tags.map((t) => (
            <span key={t} className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
              {t}
            </span>
          ))}
        </section>
      )}

      <section>
        <h2 className="text-lg font-semibold">Clarifications</h2>
        {clarifications.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">No clarifications yet.</p>
        ) : (
          <ul className="mt-3 space-y-4">
            {clarifications.map((c) => (
              <li key={c.id} className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="font-medium">{c.question}</div>
                {c.answer ? (
                  <div className="mt-2 whitespace-pre-line text-slate-600">
                    <span className="text-xs font-semibold text-slate-400">ANSWER: </span>
                    {c.answer}
                  </div>
                ) : (
                  <div className="mt-2 text-xs text-slate-400">Awaiting answer from the problem creator.</div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </article>
  );
}
