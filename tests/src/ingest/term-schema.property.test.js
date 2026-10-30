// tests/src/ingest/term-schema.property.test.js
//
// Property-based test for TermEntry schema validity and dedup uniqueness
// (design.md — Correctness Properties → "Property 5: TermEntry schema validity
// and dedup uniqueness").
//
//   Feature: snn-material-ingestion, Property 5
//   **Validates: Requirements 6.2, 6.4**
//
//   Property 5: TermEntry schema validity and dedup uniqueness
//   *For all* entries in `terms.json`: `term` and `definition` are non-empty
//   strings; `aliases`, when present, is an array of strings; `acronym`, when
//   present, is a non-empty string (the key is omitted entirely when there is
//   none — never "" or null); `pageRef` is a string or null. *For all* distinct
//   pairs of entries: their normalized surface forms (case/whitespace-
//   insensitive) do not collide. Dedup is expressed by extending `aliases`
//   rather than duplicating, so a normalized surface form belongs to at most
//   one entry.
//
// The test defines two pure checkers that return the problems they find
// (rather than throwing), so the test can assert both directions:
//   - `checkTermEntry(entry)`  — the per-entry schema rules;
//   - `checkNoCollision(entries)` — the cross-entry surface-form uniqueness.
// It then exercises them three ways:
//   (a) on randomly generated VALID term sets, asserting no problems;
//   (b) on randomly generated INVALID term sets — a valid set mutated to inject
//       exactly one violation (empty term/definition, acronym "" or null,
//       non-string alias, non-string/non-null pageRef, or a cross-entry
//       surface-form collision) — asserting the checker reports it;
//   (c) on the real content/terms.json, asserting every entry passes schema and
//       no surface forms collide.
//
// fast-check is loaded as an ES module with NO build step, matching the sibling
// property tests: import the module namespace from the jsDelivr ESM CDN and
// normalize the `fc` handle whether the API sits on the namespace or under
// `default`. Run via `node tests/run.js` (Node 18+, with global fetch).

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "../../harness.js";
import * as fcNS from "https://cdn.jsdelivr.net/npm/fast-check/+esm";

// fast-check's ESM build exposes its API on the module namespace; some bundles
// also nest it under `default`. Normalize to a single `fc` handle either way.
const fc = fcNS && typeof fcNS.property === "function" ? fcNS : fcNS.default;

const here = dirname(fileURLToPath(import.meta.url));
// tests/src/ingest -> repo root is three levels up.
const repoRoot = join(here, "..", "..", "..");

/**
 * Normalize a surface form for case/whitespace-insensitive matching: lowercase,
 * trim, and collapse any run of internal whitespace to a single space. This is
 * the single definition of "same surface form" the dedup rule relies on, so
 * both the schema checker and the collision checker use it.
 *
 * @param {string} s
 * @returns {string}
 */
export function normalizeSurface(s) {
  return s.toLowerCase().trim().replace(/\s+/g, " ");
}

/**
 * Collect every surface form an entry contributes: its `term`, each `alias`,
 * and its `acronym` (when present). Non-string members are skipped here — the
 * schema checker is responsible for reporting those.
 *
 * @param {any} entry
 * @returns {string[]} Normalized surface forms contributed by the entry.
 */
function surfaceFormsOf(entry) {
  /** @type {string[]} */
  const forms = [];
  if (entry && typeof entry.term === "string") forms.push(normalizeSurface(entry.term));
  if (Array.isArray(entry && entry.aliases)) {
    for (const a of entry.aliases) {
      if (typeof a === "string") forms.push(normalizeSurface(a));
    }
  }
  if (entry && typeof entry.acronym === "string") forms.push(normalizeSurface(entry.acronym));
  return forms;
}

/**
 * Pure checker for the per-entry half of Property 5. Returns every schema
 * problem it finds in a single `TermEntry`.
 *
 * Rules enforced:
 *   - `term` is a non-empty string (`empty-term`);
 *   - `definition` is a non-empty string (`empty-definition`);
 *   - `aliases`, when the key is present, is an array of strings
 *     (`bad-aliases`);
 *   - `acronym`, when the key is present, is a non-empty string — the key must
 *     be omitted entirely when there is none, so `""` or `null` is a violation
 *     (`bad-acronym`);
 *   - `pageRef` is a string or `null` (`bad-pageref`).
 *
 * @param {any} entry
 * @returns {Array<{kind: string, term: string}>} Problems found; empty when valid.
 */
export function checkTermEntry(entry) {
  /** @type {Array<{kind: string, term: string}>} */
  const problems = [];
  const label = entry && typeof entry.term === "string" ? entry.term : "<?>";
  const push = (kind) => problems.push({ kind, term: label });

  // term: non-empty string.
  if (typeof entry.term !== "string" || entry.term.trim() === "") {
    push("empty-term");
  }

  // definition: non-empty string.
  if (typeof entry.definition !== "string" || entry.definition.trim() === "") {
    push("empty-definition");
  }

  // aliases: when present, an array of strings.
  if ("aliases" in entry) {
    if (!Array.isArray(entry.aliases) || !entry.aliases.every((a) => typeof a === "string")) {
      push("bad-aliases");
    }
  }

  // acronym: key present only when it is a non-empty string (never "" / null).
  if ("acronym" in entry) {
    if (typeof entry.acronym !== "string" || entry.acronym.trim() === "") {
      push("bad-acronym");
    }
  }

  // pageRef: string or null (when the key is present).
  if ("pageRef" in entry) {
    if (entry.pageRef !== null && typeof entry.pageRef !== "string") {
      push("bad-pageref");
    }
  }

  return problems;
}

/**
 * Pure checker for the cross-entry half of Property 5. Returns a `collision`
 * problem for every normalized surface form that is claimed by more than one
 * distinct entry — i.e. dedup should have extended an existing entry's aliases
 * instead of introducing a second owner for the same surface form.
 *
 * @param {any[]} entries
 * @returns {Array<{kind: string, form: string, terms: string[]}>} Problems found; empty when valid.
 */
export function checkNoCollision(entries) {
  /** @type {Map<string, Set<string>>} form -> set of owning entry terms */
  const owners = new Map();

  entries.forEach((entry, i) => {
    const key = entry && typeof entry.term === "string" ? entry.term : `#${i}`;
    for (const form of surfaceFormsOf(entry)) {
      if (!owners.has(form)) owners.set(form, new Set());
      owners.get(form).add(key);
    }
  });

  /** @type {Array<{kind: string, form: string, terms: string[]}>} */
  const problems = [];
  for (const [form, termSet] of owners) {
    if (termSet.size > 1) {
      problems.push({ kind: "collision", form, terms: [...termSet] });
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Generators for valid term sets.
// ---------------------------------------------------------------------------

// A non-empty word made of lowercase letters; the `-1` suffix trick in the set
// builder keeps surface forms disjoint across generated entries.
const wordArb = fc
  .array(
    fc.integer({ min: 0, max: 25 }).map((n) => String.fromCharCode(97 + n)),
    { minLength: 2, maxLength: 7 },
  )
  .map((chars) => chars.join(""));

// A short non-empty phrase (1–3 words) used for definitions.
const phraseArb = fc
  .array(wordArb, { minLength: 1, maxLength: 3 })
  .map((ws) => ws.join(" "));

/**
 * Deterministically build a VALID set of `TermEntry`s. Each entry's surface
 * forms are seeded from a unique index (`t{i}`, `t{i}-a{j}`, `ac{i}`), so the
 * set is collision-free by construction and every field respects the schema.
 * `aliases`, `acronym`, and `pageRef` presence/shape vary off random flags —
 * but only in schema-valid ways (acronym omitted rather than ""/null; pageRef
 * either a string or null; aliases always an array of strings when present).
 *
 * @param {object} shape
 * @param {number} shape.count     How many entries (1..N).
 * @param {number[]} shape.flags   Random decisions (FIFO), used mod their length.
 * @returns {any[]}
 */
function buildTermSet(shape) {
  const count = 1 + (((shape.count % 6) + 6) % 6); // 1..6
  const flags = shape.flags.length ? shape.flags : [0];
  let cursor = 0;
  const nextFlag = () => flags[cursor++ % flags.length];

  /** @type {any[]} */
  const entries = [];
  for (let i = 0; i < count; i++) {
    /** @type {any} */
    const entry = {
      term: `Term t${i}`,
      definition: `definition of term ${i}`,
    };

    // aliases: present on roughly half the entries; always disjoint strings.
    if (nextFlag() % 2 === 0) {
      const aliasCount = 1 + (nextFlag() % 3); // 1..3
      const aliases = [];
      for (let j = 0; j < aliasCount; j++) aliases.push(`t${i}-a${j}`);
      entry.aliases = aliases;
    }

    // acronym: present on roughly half the entries, always a non-empty string
    // (omitted entirely otherwise — never "" or null).
    if (nextFlag() % 2 === 0) {
      entry.acronym = `AC${i}`;
    }

    // pageRef: a string for some entries, explicit null for others.
    entry.pageRef = nextFlag() % 2 === 0 ? `/route/t${i}` : null;

    entries.push(entry);
  }
  return entries;
}

const termSetShapeArb = fc.record({
  count: fc.nat(),
  flags: fc.array(fc.nat(), { minLength: 6, maxLength: 24 }),
});

/** Deep-clone a plain value so a mutation can't leak between runs/assertions. */
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

describe(
  "TermEntry schema validity and dedup uniqueness (Property 5) \u2014 Validates: Requirements 6.2, 6.4",
  () => {
    it("accepts every randomly generated valid term set (no schema problems)", () => {
      fc.assert(
        fc.property(termSetShapeArb, (shape) => {
          const entries = buildTermSet(shape);
          for (const entry of entries) {
            expect(checkTermEntry(entry)).toEqual([]);
          }
        }),
        { numRuns: 100 },
      );
    });

    it("accepts every randomly generated valid term set (no surface-form collisions)", () => {
      fc.assert(
        fc.property(termSetShapeArb, (shape) => {
          const entries = buildTermSet(shape);
          expect(checkNoCollision(entries)).toEqual([]);
        }),
        { numRuns: 100 },
      );
    });

    it("reports the injected per-entry schema violation for each invalid mutation", () => {
      fc.assert(
        fc.property(
          termSetShapeArb,
          fc.nat(),
          fc.integer({ min: 0, max: 5 }),
          (shape, pick, kind) => {
            const entries = buildTermSet(shape);
            const idx = pick % entries.length;
            const entry = clone(entries[idx]);

            let expectedKind;
            switch (kind) {
              case 0: {
                // Empty term.
                entry.term = "   ";
                expectedKind = "empty-term";
                break;
              }
              case 1: {
                // Empty definition.
                entry.definition = "";
                expectedKind = "empty-definition";
                break;
              }
              case 2: {
                // acronym present as the empty string (should be omitted).
                entry.acronym = "";
                expectedKind = "bad-acronym";
                break;
              }
              case 3: {
                // acronym present as null (should be omitted).
                entry.acronym = null;
                expectedKind = "bad-acronym";
                break;
              }
              case 4: {
                // aliases containing a non-string member.
                entry.aliases = ["ok", 42];
                expectedKind = "bad-aliases";
                break;
              }
              case 5: {
                // pageRef neither string nor null.
                entry.pageRef = 123;
                expectedKind = "bad-pageref";
                break;
              }
            }

            const problems = checkTermEntry(entry);
            expect(problems.some((p) => p.kind === expectedKind)).toBe(true);
          },
        ),
        { numRuns: 100 },
      );
    });

    it("reports a collision when two entries share a normalized surface form", () => {
      fc.assert(
        fc.property(termSetShapeArb, fc.nat(), fc.integer({ min: 0, max: 2 }), (shape, pick, via) => {
          const entries = buildTermSet(shape);
          if (entries.length < 2) return; // need a distinct pair to collide

          const i = pick % entries.length;
          const j = (i + 1) % entries.length; // a distinct second entry
          const set = clone(entries);

          // The surface form of entry i's term, re-cased and re-spaced so the
          // collision is only caught by the case/whitespace-insensitive rule.
          const collidingForm = `  ${set[i].term.toUpperCase()}  `;

          switch (via) {
            case 0: {
              // Entry j's term equals entry i's term (modulo case/whitespace).
              set[j].term = collidingForm;
              break;
            }
            case 1: {
              // Entry j lists entry i's term as one of its aliases.
              set[j].aliases = [...(set[j].aliases ?? []), collidingForm];
              break;
            }
            case 2: {
              // Entry j's acronym collides with entry i's term.
              set[j].acronym = collidingForm;
              break;
            }
          }

          const problems = checkNoCollision(set);
          expect(problems.some((p) => p.kind === "collision")).toBe(true);
        }),
        { numRuns: 100 },
      );
    });

    it("accepts the real content/terms.json (schema + no surface-form collisions)", () => {
      const raw = readFileSync(join(repoRoot, "content", "terms.json"), "utf8");
      const entries = JSON.parse(raw);

      for (const entry of entries) {
        expect(checkTermEntry(entry)).toEqual([]);
      }
      expect(checkNoCollision(entries)).toEqual([]);
    });
  },
);
