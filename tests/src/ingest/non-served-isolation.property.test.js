// tests/src/ingest/non-served-isolation.property.test.js
//
// Feature: snn-material-ingestion, Property 7
//
// Property-based test for the ingestion pipeline's "non-served isolation"
// guarantee (design.md — Correctness Properties → "Property 7: Non-served
// isolation").
//
//   Property 7: Non-served isolation
//   **Validates: Requirements 1.6, 2.6, 7.6**
//
// The dev-only ingestion tooling lives under `tools/ingest/` and must never be
// referenced by anything the browser actually loads. The set of SERVED files is
// exactly:
//   - `index.html` at the repo root (the single HTML entry point),
//   - every file under `src/` (recursively) — the runtime JS modules,
//   - every file under `content/` (recursively) — the JSON data the runtime
//     fetches.
//
// For every served file we read its text and assert it contains NO reference to
// any path under `tools/` — in particular `tools/ingest` (forward-slash, the
// web/import form) or `tools\ingest` (backslash, the Windows path form). Because
// no served file names a `tools/` path, deleting the entire `tools/` tree leaves
// the site loadable: nothing the browser loads can resolve into it (R1.6 "not
// served or imported by src/"; R2.6 extractor/vendor code is dev-only; R7.6 the
// site stays loadable with tooling removed).
//
// fast-check is loaded as an ES module with NO build step, mirroring the
// established convention in tests/src/router.additivity.property.test.js: import
// the module namespace from the jsDelivr ESM CDN and normalize the `fc` handle
// whether the API sits on the namespace or under `default`. The property samples
// over the enumerated served-file set (`fc.constantFrom(...served)`) across
// >=100 iterations, asserting the no-reference invariant on each sampled file; a
// concrete, non-property assertion backstops it by scanning every served file
// directly. Run via `node tests/run.js` (Node 18+, with global fetch); to run
// offline, vendor fast-check's ESM build and swap the import specifier.

import { readdirSync, statSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "../../harness.js";
import * as fcNS from "https://cdn.jsdelivr.net/npm/fast-check/+esm";

// fast-check's ESM build exposes its API on the module namespace; some bundles
// also nest it under `default`. Normalize to a single `fc` handle either way.
const fc = fcNS && typeof fcNS.property === "function" ? fcNS : fcNS.default;

// The test lives at tests/src/ingest/, so the repo root is three levels up.
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");

/**
 * Recursively collect every file (absolute paths) under `dir`. Returns an empty
 * list if `dir` does not exist, so the enumeration is robust to layout changes.
 * @param {string} dir
 * @returns {string[]}
 */
function collectFiles(dir) {
  /** @type {string[]} */
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out; // directory absent — nothing to enumerate
  }
  for (const name of entries) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...collectFiles(full));
    } else {
      out.push(full);
    }
  }
  return out;
}

/**
 * The exact set of served files: the root HTML entry point plus every file the
 * runtime imports (`src/`) or fetches (`content/`).
 * @returns {string[]}
 */
function enumerateServedFiles() {
  return [
    join(repoRoot, "index.html"),
    ...collectFiles(join(repoRoot, "src")),
    ...collectFiles(join(repoRoot, "content")),
  ];
}

/**
 * A served file "references tools/" if its text names a path under `tools/` in
 * either the web/import form (`tools/...`) or the Windows path form
 * (`tools\...`). We specifically care about `tools/ingest`, but any `tools/`
 * reference from a served file would break the isolation guarantee, so we check
 * the broader `tools` segment too.
 * @param {string} text
 * @returns {boolean}
 */
function referencesTools(text) {
  return (
    text.includes("tools/ingest") ||
    text.includes("tools\\ingest") ||
    // Any path segment under tools/ (forward or back slash) from a served file.
    /tools[\\/]/.test(text)
  );
}

const servedFiles = enumerateServedFiles();

describe("ingestion non-served isolation (Property 7) \u2014 Validates: Requirements 1.6, 2.6, 7.6", () => {
  it("there is at least one served file to check (index.html + src/ + content/)", () => {
    // Guard against a false-green run where the enumeration silently finds
    // nothing (e.g. a path typo): the property must sample a real population.
    expect(servedFiles.length > 0).toBe(true);
  });

  it("no served file references any tools/ingest path (property over the served set)", () => {
    fc.assert(
      fc.property(fc.constantFrom(...servedFiles), (file) => {
        const text = readFileSync(file, "utf8");
        // The sampled served file must not reference the dev-only tooling tree.
        expect(referencesTools(text)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it("concretely, scanning every served file finds no tools/ reference", () => {
    const offenders = servedFiles.filter((file) =>
      referencesTools(readFileSync(file, "utf8")),
    );
    // Report offenders by repo-relative path if the invariant is ever violated.
    const relative = offenders.map((f) => f.slice(repoRoot.length + 1));
    expect(relative).toEqual([]);
  });
});
