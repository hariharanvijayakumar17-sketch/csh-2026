/**
 * Next.js instrumentation hook — runs once at server startup (node runtime).
 * P3 addendum 5: in production the guard THROWS on any detected misconfig
 * (trust/no-password DB auth, dev-default credentials, default/missing
 * SESSION_SECRET, demo seed) — the process refuses to start (fail-closed).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { runProductionGuard } = await import("./lib/production-guard");
    await runProductionGuard({ env: process.env });
  }
}
