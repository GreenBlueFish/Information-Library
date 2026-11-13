// tests/src/integration/topic-untouched.guard.test.js
//
// REMOVABLE GUARD TEST — delete this file after the glossary-scoped-search
// branch is merged.
//
// This test enforces the hard rule (R13) of the glossary-scoped-search feature:
// no topic, subtopic, or page may change. Specifically, `content/topics.json`,
// everything under `content/pages/**`, and everything under `assets/figures/**`
// (collectively "Protected_Content") MUST remain byte-identical to the base
// branch the feature forked from (Base_Branch).
//
// It is branch-relative: it only has meaning while this feature is in
// development, comparing the working tree against the merge base. Once the
// change is merged there is no "before" branch to compare to, so the test is
// to be REMOVED after merge (per the design's "Topic-untouched guard (R13)").
//
// How it works (read-only git only — it never writes to the repo):
//   - Resolve Base_Branch: `process.env.BASE` if set, else the merge base of
//     HEAD with `origin/main` (falling back to `main`). If no base can be
//     resolved (detached/no-remote/no-git environment), the guard SKIPS with a
//     clear message rather than hard-failing the whole suite.
//   - Assert `git diff --name-only <BASE> -- <protected paths>` is empty.
//   - Also catch brand-new, untracked files under those paths via
//     `git ls-files --others --exclude-standard -- <protected paths>` (a plain
//     diff against the base does not surface a never-committed file).
//   - On any difference, FAIL and name every differing file (R13.5).

import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "../../harness.js";

// This file lives at <repo>/tests/src/integration/, so the git repo root is
// three directories up. All git commands run with this as their cwd so the
// protected paths below resolve relative to the repo root.
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..", "..");

// The Protected_Content paths, relative to the repo root (R13.1–R13.3).
const PROTECTED_PATHS = ["content/topics.json", "content/pages", "assets/figures"];

/**
 * Run git read-only from the repo root. Returns the trimmed stdout on success,
 * or `null` if git is unavailable or the command failed (so callers can
 * degrade gracefully instead of throwing).
 * @param {string[]} args
 * @returns {string | null}
 */
function git(args) {
  const res = spawnSync("git", args, { cwd: repoRoot, encoding: "utf8" });
  if (res.error || res.status !== 0 || typeof res.stdout !== "string") return null;
  return res.stdout.trim();
}

/**
 * Resolve the Base_Branch commit to compare against.
 * Preference order: explicit BASE env override, then the merge base with
 * `origin/main`, then the merge base with `main`.
 * @returns {string | null} a commit-ish, or null if none could be resolved.
 */
function resolveBase() {
  const override = process.env.BASE;
  if (override && override.trim()) {
    // Verify the override actually resolves before trusting it.
    const resolved = git(["rev-parse", "--verify", `${override.trim()}^{commit}`]);
    if (resolved) return resolved;
    return null;
  }
  for (const ref of ["origin/main", "main"]) {
    const base = git(["merge-base", "HEAD", ref]);
    if (base) return base;
  }
  return null;
}

describe("Topic-untouched guard (R13) [removable after merge]", () => {
  it("leaves content/topics.json, content/pages, and assets/figures byte-identical to Base_Branch", () => {
    // Is this even a git working tree? If not, there is nothing to guard here.
    const inRepo = git(["rev-parse", "--is-inside-work-tree"]);
    if (inRepo !== "true") {
      console.log(
        "  (skipped) topic-untouched guard: not a git working tree — nothing to compare.",
      );
      return;
    }

    const base = resolveBase();
    if (!base) {
      console.log(
        "  (skipped) topic-untouched guard: could not resolve Base_Branch " +
          "(no BASE override and neither origin/main nor main is available).",
      );
      return;
    }

    // Tracked changes against the base: modified, deleted, moved, or renamed.
    const diffOut = git(["diff", "--name-only", base, "--", ...PROTECTED_PATHS]);
    // A null here means git itself failed; treat that as unable-to-verify and
    // skip rather than claiming a false pass or a false failure.
    if (diffOut === null) {
      console.log(
        "  (skipped) topic-untouched guard: git diff against Base_Branch could not run.",
      );
      return;
    }

    // Brand-new files under the protected paths won't show in a diff against
    // the base (they were never committed), so list untracked files too.
    const untrackedOut = git([
      "ls-files",
      "--others",
      "--exclude-standard",
      "--",
      ...PROTECTED_PATHS,
    ]);

    const changed = [
      ...splitLines(diffOut),
      ...splitLines(untrackedOut ?? "").map((f) => `${f} (new/untracked)`),
    ];

    if (changed.length > 0) {
      // Name every differing file (R13.5).
      throw new Error(
        `Protected_Content differs from Base_Branch (${base.slice(0, 12)}). ` +
          `The following topic/page/figure files must be byte-identical but changed:\n` +
          changed.map((f) => `  - ${f}`).join("\n"),
      );
    }

    expect(changed.length).toBe(0);
  });
});

/**
 * Split git porcelain-ish output into a clean list of non-empty lines.
 * @param {string} out
 * @returns {string[]}
 */
function splitLines(out) {
  return out
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}
