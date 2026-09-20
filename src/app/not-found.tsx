import Link from "next/link";

export default function NotFound() {
  return (
    <div className="py-16 text-center">
      <h1 className="text-2xl font-bold">Not found</h1>
      <p className="mt-2 text-sm text-slate-500">
        This page or problem does not exist (it may be unpublished).
      </p>
      <Link href="/problems" className="mt-4 inline-block text-sm underline">
        Back to problems
      </Link>
    </div>
  );
}
