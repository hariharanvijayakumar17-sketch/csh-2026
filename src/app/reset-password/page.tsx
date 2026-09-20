"use client";
import { useSearchParams } from "next/navigation";
import { useState, Suspense } from "react";

function ResetInner() {
  const token = useSearchParams().get("token") ?? "";
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await fetch("/api/v1/auth/password-reset/confirm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, newPassword: password }),
    });
    const body = await res.json();
    setResult({ ok: res.ok, msg: body?.error?.message ?? "Password changed. All your other sessions were signed out." });
    setBusy(false);
  }

  return (
    <div className="mx-auto max-w-sm space-y-4">
      <h1 className="text-2xl font-bold">Reset password</h1>
      {!token ? (
        <p className="text-sm text-slate-600">This link has no token. Use the link from your reset email.</p>
      ) : result?.ok ? (
        <div className="rounded-xl border border-green-200 bg-green-50 p-5 text-sm text-green-800">
          {result.msg}
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
          <label className="block text-sm">
            New password <span className="text-xs text-slate-400">(12+ chars, upper & lower case, a digit)</span>
            <input
              type="password"
              required
              minLength={12}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 focus:border-slate-500 focus:outline-none"
            />
          </label>
          {result && !result.ok && <p className="text-sm text-red-600">{result.msg}</p>}
          <button
            disabled={busy}
            className="w-full rounded bg-slate-900 px-4 py-2 font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {busy ? "Setting password…" : "Set new password"}
          </button>
        </form>
      )}
    </div>
  );
}

export default function ResetPage() {
  return (
    <Suspense>
      <ResetInner />
    </Suspense>
  );
}
