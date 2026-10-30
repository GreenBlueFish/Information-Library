// tests/src/ingest/flagged-not-authored.property.test.js
//
// Property-based test for the SNN Material Ingestion "unreliable text is never
// authored" guarantee.
//
//   Feature: snn-material-ingestion, Property 8
//   Property 8: Flagged documents are not authored from unreliable text
//   **Validates: Requirements 2.4, 8.4**
//
// A document is "untrustworthy as a source" when its inventory record is either
// low-confidence (`confidence === "low"`) or flagged for review
// (`flaggedForReview === true`): Req 2.4 says a low-confidence extraction is NOT
// emitted as author-ready, and Req 8.4 says every flagged record is surfaced for
// a maintainer decision rather than silently used. So the invariant is:
//
//   for every flagged / low-confidence inventory record, NO authored page under
//   content/pages/** names that document as a source.
//
// Authored attribution lives in a `callout`/`prose` block whose text names the
// source document(s) it draws from (the same attribution convention Property 4
// checks for presence). This property checks the complementary direction: the
// named source must never be one of the untrustworthy documents.
//
// The checker is pure and injectable. Given
//   - a set of "forbidden mention forms" derived from each flagged/low record's
//     filename (full name, extension-stripped stem, basename, and a
//     human-title form with separators turned into spaces), and
//   - the attribution text harvested from a page's callout/prose blocks,
// it reports every page whose attribution text references a forbidden form.
// Empty problem list = the property holds.
//
// The test exercises that checker across generated scenarios in BOTH
// directions — pages that only cite trustworthy documents (must pass) and pages
// that cite a flagged document (must be caught) — and then applies it to the
// REAL `inventory.json` + every authored page on disk, which is graceful when
// few/no feature pages exist yet (the current state).
//
// fast-check is loaded as an ES module from the jsDelivr ESM CDN with NO build
// step, following the established convention (see
// tests/src/router.additivity.property.test.js and the sibling ingest property
// tests): import the module namespace and normalize the `fc` handle whether the
// API sits on the namespace or under `default`. Run via `node tests/run.js`.
// Each property runs a minimum of 100 iterations.

import { describe, it, expect } from "../../harness.js";
import * as fcNS from "https://cdn.jsdelivr.net/npm/fast-check/+esm";
import { readdirSync, statSync, readFileSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { INVENTORY_PATH } from "../../../tools/ingest/run-inventory.js";

// fast-check's ESM build exposes its API on the module namespace; some bundles
// also nest it under `default`. Normalize to a single `fc` handle either way.
const fc = fcNS && typeof fcNS.property === "function" ? fcNS : fcNS.default;

// Attribution blocks are callout/prose blocks that name a source — the same
// convention Property 4 uses for attribution presence.
const ATTRIBUTION_BLOCK_TYPES = ["callout", "prose"];

// ---------------------------------------------------------------------------
// Pure helpers (the things under test).
// ---------------------------------------------------------------------------

/** Is a record untrustworthy as a source? (low confidence OR flagged — Req 2.4, 8.4) */
function isUntrustworthy(record) {
  if (!record || typeof record !== "object") return false;
  return record.confidence === "low" || record.flaggedForReview === true;
}

/**
 * Derive the set of "mention forms" a filename could plausibly appear as inside
 * an authored attribution line. We match conservatively on several surface
 * forms so a citation can't dodge the check by using the title rather than the
 * raw filename:
 *   - the full corpus-relative filename ("A_Review.pdf", "zip/x/index.html");
 *   - its basename (last path segment);
 *   - the basename with its extension stripped (the "stem");
 *   - a human-title form of the stem (underscores/hyphens/dots → spaces).
 * All forms are lower-cased and trimmed; blanks and ultra-short tokens are
 * dropped so we never match on noise.
 *
 * @param {string} filename
 * @returns {string[]} lower-cased mention forms (deduped, length >= 4)
 */
function mentionFormsFor(filename) {
  if (typeof filename !== "string" || filename.length === 0) return [];
  const base = basename(filename);
  const stem = base.replace(/\.[^.]+$/, "");
  const title = stem.replace(/[_\-.]+/g, " ").replace(/\s+/g, " ").trim();
  const forms = [filename, base, stem, title]
    .map((s) => s.toLowerCase().trim())
    .filter((s) => s.length >= 4);
  return [...new Set(forms)];
}

/** Collect attribution text from a page's callout/prose blocks (lower-cased). */
function attributionTextOf(page) {
  if (!page || typeof page !== "object" || !Array.isArray(page.blocks)) return "";
  return page.blocks
    .filter((b) => b && typeof b === "object" && ATTRIBUTION_BLOCK_TYPES.includes(b.type) && typeof b.text === "string")
    .map((b) => b.text.toLowerCase())
    .join("\n");
}

/**
 * Pure checker for Property 8. Given the untrustworthy records and a list of
 * authored pages (each `{ id, page }`), return a list of violations — one per
 * (page, forbidden form) where the page's attribution text names an
 * untrustworthy document. Empty list = the property holds.
 *
 * @param {Array<{confidence?: string, flaggedForReview?: boolean, filename?: string}>} records
 * @param {Array<{ id: string, page: unknown }>} pages
 * @returns {Array<{ pageId: string, filename: string, form: string }>}
 */
function findForbiddenCitations(records, pages) {
  const forbidden = [];
  for (const rec of records) {
    if (!isUntrustworthy(rec)) continue;
    for (const form of mentionFormsFor(rec.filename)) {
      forbidden.push({ filename: rec.filename, form });
    }
  }
  /** @type {Array<{ pageId: string, filename: string, form: string }>} */
  const violations = [];
  for (const { id, page } of pages) {
    const text = attributionTextOf(page);
    if (!text) continue;
    for (const { filename, form } of forbidden) {
      if (text.includes(form)) violations.push({ pageId: id, filename, form });
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// Generators.
// ---------------------------------------------------------------------------

const nonEmptyToken = fc
  .string({ minLength: 4, maxLength: 16 })
  .map((s) => `d${s.replace(/[^a-z0-9]/gi, "x")}`); // non-empty, >= 4 chars, no separators

/** A plausible corpus filename ("<stem>.pdf" / "<stem>.html"). */
const filenameArb = fc
  .record({ stem: nonEmptyToken, ext: fc.constantFrom("pdf", "html") })
  .map(({ stem, ext }) => `${stem}.${ext}`);

/** An inventory-ish record with controllable trust. */
function recordArb(trust) {
  // trust: "untrustworthy" | "trustworthy"
  return fc.record({ filename: filenameArb }).map(({ filename }) =>
    trust === "untrustworthy"
      ? { filename, confidence: "low", flaggedForReview: true }
      : { filename, confidence: "high", flaggedForReview: false },
  );
}

// A small inventory: some trustworthy, some untrustworthy, all distinct stems.
const inventoryArb = fc
  .record({
    trusted: fc.array(recordArb("trustworthy"), { minLength: 0, maxLength: 4 }),
    untrusted: fc.array(recordArb("untrustworthy"), { minLength: 1, maxLength: 4 }),
  })
  .map(({ trusted, untrusted }) => {
    const seen = new Set();
    const all = [...trusted, ...untrusted].filter((r) => {
      if (seen.has(r.filename)) return false;
      seen.add(r.filename);
      return true;
    });
    const untrustworthy = all.filter(isUntrustworthy);
    // Ensure at least one untrustworthy record survived dedup.
    return { all, untrustworthy, trusted: all.filter((r) => !isUntrustworthy(r)) };
  })
  .filter(({ untrustworthy }) => untrustworthy.length > 0);

/** Build a one-attribution-block page that cites `filename`. */
function pageCiting(filename, id) {
  const stem = filename.replace(/\.[^.]+$/, "");
  return {
    id,
    page: {
      title: `Page ${id}`,
      blocks: [
        { type: "callout", text: `Source: ${stem} — paraphrased for this page.` },
        { type: "prose", text: "Body prose with no citation." },
      ],
    },
  };
}

// ---------------------------------------------------------------------------
// Enumerate authored pages on disk (graceful when none exist yet).
// ---------------------------------------------------------------------------

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..", ".."); // tests/src/ingest -> repo root
const pagesRoot = join(repoRoot, "content", "pages");

function collectPageFiles(dir) {
  /** @type {string[]} */
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out; // directory absent — nothing authored there yet
  }
  for (const name of entries) {
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) out.push(...collectPageFiles(full));
    else if (name.endsWith(".json")) out.push(full);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Tests.
// ---------------------------------------------------------------------------

describe("snn-material-ingestion \u2014 Flagged documents are not authored (Property 8) \u2014 Feature: snn-material-ingestion, Property 8 \u2014 Validates: Requirements 2.4, 8.4", () => {
  it("passes when authored pages only cite trustworthy (non-flagged, high-confidence) documents", () => {
    fc.assert(
      fc.property(
        inventoryArb.chain(({ all, trusted, untrustworthy }) =>
          // Build pages that cite ONLY trusted documents (or nothing).
          fc
            .array(fc.constantFrom(...(trusted.length ? trusted : [null])), { maxLength: 4 })
            .map((picks) => {
              const pages = picks
                .map((rec, i) => (rec ? pageCiting(rec.filename, `p${i}`) : null))
                .filter(Boolean);
              return { all, pages, untrustworthy };
            }),
        ),
        ({ all, pages }) => {
          const violations = findForbiddenCitations(all, pages);
          expect(violations).toEqual([]);
        },
      ),
      { numRuns: 150 },
    );
  });

  it("catches an authored page that cites a flagged / low-confidence document", () => {
    fc.assert(
      fc.property(
        inventoryArb.chain(({ all, untrustworthy }) =>
          fc.integer({ min: 0, max: Math.max(0, untrustworthy.length - 1) }).map((idx) => {
            const bad = untrustworthy[idx];
            return { all, bad, pages: [pageCiting(bad.filename, "offender")] };
          }),
        ),
        ({ all, bad, pages }) => {
          const violations = findForbiddenCitations(all, pages);
          // At least one violation, and it fingers the flagged document.
          expect(violations.length > 0).toBe(true);
          expect(violations.some((v) => v.filename === bad.filename && v.pageId === "offender")).toBe(true);
        },
      ),
      { numRuns: 150 },
    );
  });

  it("only attribution text is scanned: a flagged name inside a non-attribution block (heading/list/code) is not a citation", () => {
    fc.assert(
      fc.property(
        inventoryArb.map(({ all, untrustworthy }) => {
          const bad = untrustworthy[0];
          const stem = bad.filename.replace(/\.[^.]+$/, "");
          return {
            all,
            // The flagged name appears only in non-attribution blocks.
            pages: [
              {
                id: "safe",
                page: {
                  title: "T",
                  blocks: [
                    { type: "heading", text: stem, level: 2 },
                    { type: "list", items: [stem] },
                    { type: "code", lang: "text", source: stem },
                    { type: "callout", text: "Source: a trustworthy paper." },
                  ],
                },
              },
            ],
          };
        }),
        ({ all, pages }) => {
          const violations = findForbiddenCitations(all, pages);
          expect(violations).toEqual([]);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("the real inventory.json + every authored page on disk satisfies the invariant (no-op-safe when few pages exist)", () => {
    const records = JSON.parse(readFileSync(INVENTORY_PATH, "utf8"));
    expect(Array.isArray(records)).toBe(true);
    expect(records.length > 0).toBe(true);

    // Sanity: the corpus genuinely contains untrustworthy records, so this
    // guard is meaningful rather than vacuously empty.
    expect(records.some(isUntrustworthy)).toBe(true);

    const files = collectPageFiles(pagesRoot);
    const pages = files.map((file) => {
      let page;
      try {
        page = JSON.parse(readFileSync(file, "utf8"));
      } catch (e) {
        throw new Error(`authored page is not valid JSON: ${file} (${e.message})`);
      }
      return { id: file.slice(repoRoot.length + 1), page };
    });

    const violations = findForbiddenCitations(records, pages);
    if (violations.length !== 0) {
      const lines = violations.map((v) => `  ${v.pageId} cites flagged source "${v.filename}" (matched "${v.form}")`);
      throw new Error(`authored pages cite flagged/low-confidence documents:\n${lines.join("\n")}`);
    }

    // Enumeration is graceful whether or not feature pages exist yet.
    expect(Array.isArray(files)).toBe(true);
  });
});
