import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * F8: repository hygiene. Build/runtime artifacts must NEVER be committed:
 * uploaded documents (user data), Playwright reports, test results, env
 * files. This test shells out to `git ls-files` so it fails if anyone
 * re-tracks an artifact (acceptance check from the P5 external audit).
 */

const REPO_ROOT = process.cwd();

function lsFiles(prefixes: string[]): string[] {
  if (!existsSync(path.join(REPO_ROOT, ".git"))) {
    return []; // not a git checkout (unit run outside the repo) — nothing to police
  }
  const out: string[] = [];
  for (const p of prefixes) {
    try {
      out.push(
        ...execFileSync("git", ["ls-files", p], { cwd: REPO_ROOT, encoding: "utf8" })
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean)
      );
    } catch {
      /* git error (e.g. bad pathspec) => treat as empty */
    }
  }
  return out;
}

describe("F8: no runtime artifacts tracked in git", () => {
  it("data/ (user-uploaded documents) is never committed", () => {
    expect(lsFiles(["data/"])).toEqual([]);
  });

  it("playwright-report/ and test-results/ are never committed", () => {
    expect(lsFiles(["playwright-report/", "test-results/"])).toEqual([]);
  });

  it("no .env files are committed (only .env.example may be)", () => {
    const envFiles = execFileSyncSafe();
    expect(envFiles).toEqual([]);
  });
});

function execFileSyncSafe(): string[] {
  if (!existsSync(path.join(REPO_ROOT, ".git"))) return [];
  const all = execFileSync("git", ["ls-files"], { cwd: REPO_ROOT, encoding: "utf8" })
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  return all.filter((f) => /^\.env($|\..*)/.test(f) && f !== ".env.example");
}
