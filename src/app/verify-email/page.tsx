"use client";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { Suspense } from "react";

function VerifyInner() {
  const token = useSearchParams().get("token") ?? "";
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<"ok" | "fail" | null>(null);

  async function verify() {
    setBusy(true);
    setResult(null);
    const res = await fetch("/api/v1/auth/verify-email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });
    setResult(res.ok ? "ok" : "fail");
    setBusy(false);
  }

  return (
    <div className="mx-auto max-w-sm space-y-4">
      <h1 className="text-2xl font-bold">Verify your email</h1>
      {!token ? (
        <p className="text-sm text-slate-600">
          This link has no token. Use the link from your verification email.
        </p>
      ) : result === "ok" ? (
        <div className="rounded-xl border border-green-200 bg-green-50 p-5 text-sm text-green-800">
          Email verified. You can log in now.
        </div>
      ) : result === "fail" ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">
          This link is invalid or has expired. Request a new one from the register page.
        </div>
      ) : (
        <button
          onClick={verify}
          disabled={busy}
          className="w-full rounded bg-slate-900 px-4 py-2 font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {busy ? "Verifying…" : "Verify my email"}
        </button>
      )}
    </div>
  );
}

export default function VerifyPage() {
  return (
    <Suspense>
      <VerifyInner />
    </Suspense>
  );
}
