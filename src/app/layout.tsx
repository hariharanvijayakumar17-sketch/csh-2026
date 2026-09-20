import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Campus Solution Hackathon 2026",
  description:
    "CSH 2026 — SRM TRP Engineering College, Tiruchirappalli. Problems, teams, proposals, evaluation.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
            <Link href="/" className="font-semibold text-slate-900 hover:underline">
              CSH 2026
            </Link>
            <nav className="flex gap-4 text-sm">
              <Link href="/problems" className="text-slate-600 hover:text-slate-900 hover:underline">
                Problems
              </Link>
              <Link href="/login" className="text-slate-600 hover:text-slate-900 hover:underline">
                Log in
              </Link>
              <Link
                href="/register"
                className="rounded bg-slate-900 px-3 py-1.5 text-white hover:bg-slate-700"
              >
                Register
              </Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
        <footer className="border-t border-slate-200 py-6 text-center text-xs text-slate-500">
          Campus Solution Hackathon 2026 · SRM TRP Engineering College, Tiruchirappalli
        </footer>
      </body>
    </html>
  );
}
