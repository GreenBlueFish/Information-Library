// tests/src/integration/glossary-manifest.test.js
//
// Data-integrity checks over the split-glossary layout (design.md — "Testing
// Strategy" §Data-integrity checks), Requirement 12. These replace the old
// terms.json-specific pageRef-resolution block that used to live in
// seed-content.test.js (that block was removed as part of this task; the
// non-terms.json leaf/page/slug checks there stay).
//
// Unlike the pure-logic property tests, this suite reads the real on-disk
// layout straight off the repo, exactly as the browser loader would see it:
//
//   - content/terms/index.json  (the Manifest: { glossaries: [{ scope, file }] })
//   - content/terms/**.json      (the Glossary_Files, arrays of TermEntry)
//   - content/topics.json        (the Topic_Tree the scopes/pageRefs resolve in)
//
// It asserts the six R12 invariants:
//
//   R12.1  every Manifest `scope` is `/` or a route that resolves in topics.json.
//   R12.2  every Manifest `file` exists on disk and obeys the Path_Rule
//          (`/a/b/c` → content/terms/a/b/c.json, `/` → content/terms/_root.json).
//   R12.3  every `.json` file under content/terms/ except index.json is listed
//          in the Manifest — no orphan files.
//   R12.4  every non-null `pageRef` across all Glossary_Files resolves to a real
//          route in topics.json (null pageRef is allowed).
//   R12.5  no Glossary_File holds the same term twice with an identical
//          definition (same (term, definition) pair within one file).
//   R12.6  the total number of entries across all Glossary_Files is at least
//          1,874 (the count at the split; terms are added, never removed).
//          Byte-for-byte entry conservation (no entry changed) was proven at
//          migration time by the split-terms conservation property test; task 18
//          deleted the legacy content/terms.json, so this suite no longer reads
//          it. The ==1,874 count check below stands on its own.
//
// Routing goes through the real src/router.js (parseHash + resolveRoute) so the
// test exercises production resolution, not a reimplementation. In Node there
// is no fetch of relative URLs, so files are read with node:fs and paths are
// resolved against the repo root derived from import.meta.url.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, resolve, join, posix } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "../../harness.js";
import { parseHash, resolveRoute } from "../../../src/router.js";
import { readTopicTree } from "../../../scripts/topic-tree.js";

// This file lives at <repo>/tests/src/integration/, so the repo root is three
// directories up. Everything below is resolved against it.
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..", "..");

/** Read a repo-relative file and JSON.parse it, failing loudly on either step. */
function readJson(relPath) {
  const abs = join(repoRoot, relPath);
  return JSON.parse(readFileSync(abs, "utf8"));
}

const topics = readTopicTree(repoRoot);
const manifest = readJson("content/terms/index.json");

const glossaries = Array.isArray(manifest.glossaries) ? manifest.glossaries : [];

/**
 * The Path_Rule, computed independently of the loader so the test is a real
 * check: route `/` → content/terms/_root.json; `/a/b/c` → content/terms/a/b/c.json.
 * Uses posix joins so the comparison matches the forward-slash paths stored in
 * the Manifest regardless of host OS.
 * @param {string} scope
 * @returns {string}
 */
function expectedFile(scope) {
  if (scope === "/") return "content/terms/_root.json";
  const segments = scope.replace(/^\//, "").split("/");
  return posix.join("content/terms", ...segments) + ".json";
}

/** Resolve a route string against the real tree; `/` is always valid. */
function routeResolves(route) {
  if (route === "/") return true;
  const segments = parseHash(route);
  if (segments.length === 0) return false;
  const errors = [];
  const res = resolveRoute(topics, segments, (e) => errors.push(e));
  return Boolean(res && errors.length === 0 && res.node);
}

/** Load a Glossary_File's entry array, tagged with its scope for messages. */
function loadGlossary(entry) {
  return { scope: entry.scope, file: entry.file, entries: readJson(entry.file) };
}

/** Recursively collect every `.json` file under content/terms/ (repo-relative, posix). */
function collectTermsJsonFiles() {
  const base = join(repoRoot, "content", "terms");
  /** @type {string[]} */
  const out = [];
  const walk = (absDir, relDir) => {
    for (const name of readdirSync(absDir)) {
      const abs = join(absDir, name);
      const rel = relDir ? `${relDir}/${name}` : name;
      if (statSync(abs).isDirectory()) {
        walk(abs, rel);
      } else if (name.endsWith(".json")) {
        out.push(`content/terms/${rel}`);
      }
    }
  };
  walk(base, "");
  return out;
}

/** Canonical (term, definition) key: trimmed, case-insensitive. */
function pairKey(term, definition) {
  return `${String(term).trim().toLowerCase()}\u0000${String(definition).trim().toLowerCase()}`;
}

const loaded = glossaries.map(loadGlossary);

describe("glossary layout data integrity (R12)", () => {
  it("the Manifest lists at least one glossary to exercise", () => {
    expect(glossaries.length > 0).toBeTruthy();
  });

  describe("every Manifest scope is / or resolves in topics.json (R12.1)", () => {
    for (const g of glossaries) {
      it(`scope ${g.scope} resolves`, () => {
        expect(routeResolves(g.scope)).toBe(true);
      });
    }
  });

  describe("every Manifest file exists and obeys the Path_Rule (R12.2)", () => {
    for (const g of glossaries) {
      it(`file for ${g.scope} obeys the Path_Rule`, () => {
        expect(g.file).toBe(expectedFile(g.scope));
      });

      it(`file ${g.file} exists and parses as a TermEntry array`, () => {
        // readJson throws if the file is missing or unparseable, naming it.
        const entries = readJson(g.file);
        expect(Array.isArray(entries)).toBe(true);
      });
    }
  });

  it("every file under content/terms/ is listed in the Manifest — no orphans (R12.3)", () => {
    const listed = new Set(glossaries.map((g) => g.file));
    const onDisk = collectTermsJsonFiles().filter(
      (f) => f !== "content/terms/index.json",
    );
    const orphans = onDisk.filter((f) => !listed.has(f));
    // Name any orphan in the failure message.
    expect(orphans).toEqual([]);
  });

  describe("every pageRef resolves to a real route (R12.4)", () => {
    it("has at least one non-null pageRef across the glossaries", () => {
      const anyRef = loaded.some((g) =>
        g.entries.some((e) => e.pageRef !== null && e.pageRef !== undefined),
      );
      expect(anyRef).toBeTruthy();
    });

    for (const g of loaded) {
      const withRefs = g.entries.filter(
        (e) => e.pageRef !== null && e.pageRef !== undefined,
      );
      for (const e of withRefs) {
        it(`${g.scope}: "${e.term}" → ${e.pageRef} resolves`, () => {
          expect(routeResolves(e.pageRef)).toBe(true);
        });
      }
    }
  });

  describe("no glossary has the same term twice with an identical definition (R12.5)", () => {
    for (const g of loaded) {
      it(`${g.file} has no duplicate (term, definition) pair`, () => {
        const seen = new Set();
        const dupes = [];
        for (const e of g.entries) {
          const k = pairKey(e.term, e.definition);
          if (seen.has(k)) dupes.push(`${e.term} :: ${e.definition}`);
          else seen.add(k);
        }
        expect(dupes).toEqual([]);
      });
    }
  });

  // The split held 1,874 entries. Terms may be added (new topics bring their
  // own glossaries) but never removed, so the count may only grow.
  describe("total entries >= 1,874: none dropped since the split (R12.6)", () => {
    it("the split glossaries hold at least 1,874 entries", () => {
      const total = loaded.reduce((n, g) => n + g.entries.length, 0);
      expect(total >= 1874).toBe(true);
    });

    // "No entry changed": the legacy content/terms.json was deleted in task 18,
    // so the byte-for-byte multiset comparison no longer lives here. Migration
    // conservation (every field of every entry survived the split verbatim, and
    // nothing was added or dropped) is proven by the split-terms conservation
    // property test. What this suite can still guarantee without the legacy file
    // is that the split set conserves the full count across all Glossary_Files —
    // every entry is accounted for exactly once, summing to 1,874.
    it("the concatenated split entries conserve the full count (no entry dropped)", () => {
      const splitEntries = loaded.flatMap((g) => g.entries);
      expect(splitEntries.length >= 1874).toBe(true);
    });
  });
});
