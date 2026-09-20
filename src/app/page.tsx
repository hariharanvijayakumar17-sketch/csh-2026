import Link from "next/link";
import { listProblems } from "@/lib/problems";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  let count = 0;
  try {
    const r = await listProblems({ pageSize: 1 });
    count = r.total;
  } catch {
    count = 0; // DB unavailable at build/dev: show page, not an error
  }
  return (
    <div className="space-y-10">
      <section className="rounded-2xl bg-slate-900 p-8 text-white sm:p-12">
        <h1 className="text-3xl font-bold sm:text-4xl">Campus Solution Hackathon 2026</h1>
        <p className="mt-3 max-w-2xl text-slate-300">
          Build solutions to real campus problems. Form a team, submit a proposal, get
          mentored, and compete for the top awards.
        </p>
        <div className="mt-6 flex gap-3">
          <Link
            href="/problems"
            className="rounded bg-white px-4 py-2 font-medium text-slate-900 hover:bg-slate-200"
          >
            Browse problems
          </Link>
          <Link
            href="/register"
            className="rounded border border-slate-500 px-4 py-2 font-medium text-white hover:bg-slate-800"
          >
            Register
          </Link>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="text-2xl font-bold text-slate-900">{count}</div>
          <div className="text-sm text-slate-500">published problems</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="text-2xl font-bold text-slate-900">Up to 6</div>
          <div className="text-sm text-slate-500">team members (rules in the event settings)</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="text-2xl font-bold text-slate-900">2 PS</div>
          <div className="text-sm text-slate-500">problem statements per team (max)</div>
        </div>
      </section>

      <section className="prose max-w-none">
        <h2 className="text-xl font-semibold">How it works</h2>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-slate-600">
          <li>Register with your college email and verify it.</li>
          <li>Create or join a team (your team leader handles submissions).</li>
          <li>Choose up to two published problems and submit a proposal before the deadline.</li>
          <li>Work with your mentor; respond to evaluation and submit final documents.</li>
          <li>Results and certificates are published after the evaluation rounds.</li>
        </ol>
      </section>
    </div>
  );
}
