import Link from "next/link";
import { listProblems } from "@/lib/problems";

export const dynamic = "force-dynamic";

export default async function ProblemsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string; theme?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  let list = { items: [] as Awaited<ReturnType<typeof listProblems>>["items"], total: 0, page, pageSize: 20 };
  try {
    list = await listProblems({
      q: sp.q,
      category: sp.category,
      theme: sp.theme,
      page,
      pageSize: 20,
    });
  } catch {
    // DB down: show an empty state, not a 500
  }
  const pages = Math.max(1, Math.ceil(list.total / list.pageSize));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Problem statements</h1>
          <p className="text-sm text-slate-500">{list.total} published</p>
        </div>
        <form className="flex gap-2" action="/problems" method="get">
          <input
            name="q"
            defaultValue={sp.q ?? ""}
            placeholder="Search title, description, code…"
            className="rounded border border-slate-300 px-3 py-1.5 text-sm focus:border-slate-500 focus:outline-none"
          />
          <button className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white hover:bg-slate-700">
            Search
          </button>
        </form>
      </div>

      {list.items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center text-slate-500">
          No published problems match yet.
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {list.items.map((p) => (
            <li key={p.id} className="flex flex-col rounded-xl border border-slate-200 bg-white p-5">
              <div className="text-xs font-mono text-slate-400">{p.code}</div>
              <h2 className="mt-1 font-semibold">{p.title}</h2>
              <p className="mt-2 line-clamp-3 flex-1 text-sm text-slate-600">{p.description}</p>
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                {p.category && (
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-slate-600">{p.category}</span>
                )}
                {p.theme && (
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-slate-600">{p.theme}</span>
                )}
                <span className="rounded bg-slate-100 px-2 py-0.5 text-slate-600">{p.difficulty}</span>
              </div>
              <Link
                href={`/problems/${encodeURIComponent(p.code)}`}
                className="mt-4 text-sm font-medium text-slate-900 underline"
              >
                View details
              </Link>
            </li>
          ))}
        </ul>
      )}

      {pages > 1 && (
        <div className="flex gap-2">
          {Array.from({ length: pages }, (_, i) => i + 1).map((n) => (
            <Link
              key={n}
              href={`/problems?page=${n}${sp.q ? `&q=${encodeURIComponent(sp.q)}` : ""}`}
              className={
                n === page
                  ? "rounded bg-slate-900 px-3 py-1 text-sm text-white"
                  : "rounded border border-slate-300 px-3 py-1 text-sm text-slate-600 hover:bg-slate-100"
              }
            >
              {n}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
