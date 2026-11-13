// tests/src/lookup/also-defined-in.property.test.js
//
// Feature: glossary-scoped-search, Property 4: "Also defined in" never repeats
//   an already-shown definition
// Feature: glossary-scoped-search, Property 5: Local results stay in the chain;
//   global results stay outside it
//
// Property-based tests for the Search_All "already-shown" filter and the
// local/global scope partition (design.md — Correctness Properties → Property 4
// and Property 5).
//
//   Property 4: "Also defined in" never repeats an already-shown definition
//   **Validates: Requirements 8.4, 8.5**
//
//   Property 5: Local results stay in the chain; global results stay outside it
//   **Validates: Requirements 6.1, 8.1**
//
// Property 4 exercises `withoutShownDefinitions(matches, shown)` from
// src/lookup/matches.js (task 5.1). The helper removes, from the global
// (non-chain) Search_All matches, every Definition already visible in
// Local_Results — compared by the same "already shown" key the module uses:
// `normalize(term).join(" ") + "\u0000" + trim-lowercase(definition)` (R8.5) —
// and drops any Match whose definitions are all filtered away (R8.4). The test
// generates Match[] with definitions plus a shown Definition[] (deliberately
// overlapping a subset of them under case/whitespace re-decoration) and asserts
// the result carries no shown (term, definition) pair and leaves no empty match.
//
// Property 5 models the data the UI partitions on: a Scope_Chain (a set of
// chain route scopes) and the rest of the Manifest (non-chain scopes). Every
// definition carries a runtime-only `source.route` (the Scope_Annotation from
// the loader). Partitioning local = chain-route definitions and global =
// non-chain-route definitions, the test asserts every local definition's
// `source.route` is a chain scope and every global definition's `source.route`
// is not — the data-model guarantee behind R6.1 (Local_Results only from
// Scope_Chain glossaries) and R8.1 (Search_All only over non-chain glossaries).
//
// fast-check is loaded as an ES module with NO build step, matching the sibling
// lookup property tests' convention exactly (design.md — Testing Strategy:
// "fast-check (vanilla JS, no build step needed to run)"). The module is
// imported from the jsDelivr ESM CDN below; `node tests/net/register.js`
// resolves it offline from the vendored copy under tests/vendor/ (written by
// `node tests/net/vendor.js`). To run fully offline without the net hooks,
// replace the import specifier with a locally vendored copy of fast-check's ESM
// build and keep the rest of this file unchanged.

import { describe, it, expect } from "../../harness.js";
import * as fcNS from "https://cdn.jsdelivr.net/npm/fast-check/+esm";
import { withoutShownDefinitions } from "../../../src/lookup/matches.js";
import { normalize } from "../../../src/lookup/trie.js";

// fast-check's ESM build exposes its API on the module namespace; some bundles
// also nest it under `default`. Normalize to a single `fc` handle either way.
const fc = fcNS && typeof fcNS.property === "function" ? fcNS : fcNS.default;

/**
 * The module's "already shown" key for a (term, definition) pair, reproduced
 * here as the test oracle: the term normalized the shared way
 * (`normalize(...).join(" ")`), a NUL separator, then the definition trimmed
 * and lowercased (R8.5). Importing `normalize` (not re-implementing it) keeps
 * the oracle faithful to the production normalization.
 *
 * @param {string} term
 * @param {string} definition
 * @returns {string}
 */
function shownKey(term, definition) {
  const t = normalize(typeof term === "string" ? term : "").join(" ");
  const d = (typeof definition === "string" ? definition : "").trim().toLowerCase();
  return `${t}\u0000${d}`;
}

/**
 * A single lowercase token of letters only, so `normalize` is the identity on
 * each token (no case to fold, no edge punctuation, no whitespace to collapse).
 * Mirrors the sibling lookup property tests' token arbitrary.
 */
const letterArb = fc.integer({ min: 97, max: 122 }).map((c) => String.fromCharCode(c));
const tokenArb = fc
  .array(letterArb, { minLength: 1, maxLength: 6 })
  .map((chars) => chars.join(""))
  .filter((t) => normalize(t).length === 1);

/** A short multi-token phrase (1–3 tokens) for term and definition text. */
const phraseArb = fc
  .array(tokenArb, { minLength: 1, maxLength: 3 })
  .map((tokens) => tokens.join(" "));

/**
 * Re-present a phrase so it differs from the original ONLY by things the
 * "already shown" comparison folds away: letter case, and surrounding (or
 * collapsible interior) whitespace. `shownKey` of the result must equal
 * `shownKey` of the original, so the filter must still treat them as the same.
 *
 * @param {string} phrase A lowercase space-joined phrase.
 * @param {number[]} caseBits One bit per character: 1 ⇒ uppercase that char.
 * @param {number} padLeft Leading spaces.
 * @param {number} padRight Trailing spaces.
 * @returns {string} The re-decorated, key-equivalent phrase.
 */
function reDecorate(phrase, caseBits, padLeft, padRight) {
  let out = "";
  let bit = 0;
  for (let i = 0; i < phrase.length; i++) {
    const ch = phrase[i];
    if (ch === " ") {
      // Interior whitespace: widen a single space to several, which `normalize`
      // (for the term) and `trim`/lowercase alone do NOT collapse for the
      // definition — so keep interior runs single-space to stay key-equivalent.
      out += " ";
      continue;
    }
    out += (caseBits[bit] ?? 0) ? ch.toUpperCase() : ch;
    bit++;
  }
  return " ".repeat(padLeft) + out + " ".repeat(padRight);
}

/**
 * One generated definition: a (term, definition) pair. `pageRef`/`acronym` are
 * present so the shape matches a real Definition, though the filter only reads
 * `term` and `definition`.
 */
const definitionArb = fc.record({
  term: phraseArb,
  definition: phraseArb,
  pageRef: fc.constant(null),
  acronym: fc.constant(null),
});

/** A Match: a term plus a non-empty list of its definitions. */
const matchArb = fc.record({
  term: phraseArb,
  matchKind: fc.constantFrom("exact", "within", "contains", "prefix", "fuzzy"),
  definitions: fc.array(definitionArb, { minLength: 1, maxLength: 4 }),
});

describe(
  "withoutShownDefinitions \u2014 Property 4: never repeats an already-shown definition \u2014 Validates: Requirements 8.4, 8.5",
  () => {
    it(
      "drops every (term, definition) equal to a shown one (case-insensitive, trimmed) and drops matches left empty",
      () => {
        fc.assert(
          fc.property(
            fc.array(matchArb, { minLength: 0, maxLength: 6 }),
            // Which definitions of the generated matches to mark as "shown",
            // re-decorated so only case/whitespace differs from the original.
            fc.array(
              fc.record({
                pickMatch: fc.nat(),
                pickDef: fc.nat(),
                caseBits: fc.array(fc.integer({ min: 0, max: 1 }), { maxLength: 24 }),
                padLeft: fc.integer({ min: 0, max: 3 }),
                padRight: fc.integer({ min: 0, max: 3 }),
              }),
              { minLength: 0, maxLength: 8 },
            ),
            // A few extra shown definitions unrelated to the matches, to make
            // sure the filter only removes genuine collisions.
            fc.array(definitionArb, { minLength: 0, maxLength: 4 }),
            (matches, picks, extraShown) => {
              // Build the shown set: re-decorated copies of chosen match
              // definitions (key-equivalent to an original) plus the extras.
              const shown = [];
              for (const p of picks) {
                if (matches.length === 0) continue;
                const m = matches[p.pickMatch % matches.length];
                const d = m.definitions[p.pickDef % m.definitions.length];
                shown.push({
                  term: reDecorate(d.term, p.caseBits, p.padLeft, p.padRight),
                  definition: reDecorate(d.definition, p.caseBits, p.padLeft, p.padRight),
                  pageRef: null,
                  acronym: null,
                });
              }
              for (const d of extraShown) shown.push(d);

              const shownKeys = new Set(shown.map((d) => shownKey(d.term, d.definition)));

              const result = withoutShownDefinitions(matches, shown);

              // (1) No surviving definition has a key present in `shown`
              //     (R8.4/R8.5: an already-shown definition is excluded).
              for (const m of result) {
                for (const d of m.definitions) {
                  expect(shownKeys.has(shownKey(d.term, d.definition))).toBe(false);
                }
              }

              // (2) Every surviving match keeps at least one definition — a
              //     match whose definitions were all shown is dropped (R8.4).
              for (const m of result) {
                expect(m.definitions.length > 0).toBe(true);
              }

              // (3) Completeness: every input definition NOT in the shown set
              //     survives exactly once (the filter removes only shown ones,
              //     never anything else). Count per key across input and output.
              const countKept = new Map();
              for (const m of result) {
                for (const d of m.definitions) {
                  const k = shownKey(d.term, d.definition);
                  countKept.set(k, (countKept.get(k) ?? 0) + 1);
                }
              }
              const countInput = new Map();
              for (const m of matches) {
                for (const d of m.definitions) {
                  const k = shownKey(d.term, d.definition);
                  countInput.set(k, (countInput.get(k) ?? 0) + 1);
                }
              }
              for (const [k, n] of countInput) {
                const kept = countKept.get(k) ?? 0;
                if (shownKeys.has(k)) {
                  // Shown keys are entirely removed.
                  expect(kept).toBe(0);
                } else {
                  // Non-shown keys are preserved with the same multiplicity.
                  expect(kept).toBe(n);
                }
              }

              // (4) The helper is non-mutating: it returns new match objects.
              for (let i = 0; i < result.length; i++) {
                expect(matches.includes(result[i])).toBe(false);
              }
            },
          ),
          { numRuns: 200 },
        );
      },
    );
  },
);

/**
 * A route scope: "/" or "/" + 1–3 single-token segments (e.g. "/a", "/a/b").
 * Keeping segments to letter tokens makes scopes easy to compare by value.
 */
const scopeArb = fc
  .array(tokenArb, { minLength: 0, maxLength: 3 })
  .map((segs) => (segs.length === 0 ? "/" : "/" + segs.join("/")));

describe(
  "scope partition \u2014 Property 5: local results stay in the chain; global results stay outside it \u2014 Validates: Requirements 6.1, 8.1",
  () => {
    it(
      "every local definition's source.route is a chain scope; every global definition's source.route is not",
      () => {
        fc.assert(
          fc.property(
            // A set of distinct scopes, split into chain (a prefix of the set)
            // and non-chain (the rest), so chain ∩ non-chain = ∅.
            fc.uniqueArray(scopeArb, { minLength: 1, maxLength: 8 }),
            fc.nat(),
            // Definitions, each tagged with an index into the full scope set.
            fc.array(
              fc.record({ scopeIdx: fc.nat(), term: phraseArb, definition: phraseArb }),
              { minLength: 0, maxLength: 20 },
            ),
            (scopes, splitAt, rawDefs) => {
              // Partition the scope universe into a chain set and its complement.
              const cut = scopes.length === 1 ? 1 : (splitAt % (scopes.length - 1)) + 1;
              const chainScopes = scopes.slice(0, cut);
              const chainSet = new Set(chainScopes);
              const nonChainScopes = scopes.slice(cut);

              // Every scope is either in the chain or outside it, never both.
              for (const s of nonChainScopes) expect(chainSet.has(s)).toBe(false);

              // Tag each generated definition with a Source_Annotation route
              // drawn from the full universe, so some land in the chain and some
              // outside it.
              const definitions = rawDefs.map((d) => {
                const route = scopes[d.scopeIdx % scopes.length];
                return {
                  term: d.term,
                  definition: d.definition,
                  pageRef: null,
                  acronym: null,
                  source: { route, title: route },
                };
              });

              // The UI's partition: Local_Results are the chain-scope
              // definitions (R6.1); Search_All results are the non-chain ones
              // (R8.1). Express it as the pure data-model partition the design's
              // Property 5 describes.
              const local = definitions.filter((d) => chainSet.has(d.source.route));
              const global = definitions.filter((d) => !chainSet.has(d.source.route));

              // Partition is total and disjoint: every definition is in exactly
              // one side.
              expect(local.length + global.length).toBe(definitions.length);

              // (R6.1) Every Local_Results definition comes from a chain scope.
              for (const d of local) {
                expect(chainSet.has(d.source.route)).toBe(true);
              }

              // (R8.1) Every Search_All definition comes from a NON-chain scope.
              for (const d of global) {
                expect(chainSet.has(d.source.route)).toBe(false);
                // And its scope is a real non-chain scope from the universe.
                expect(nonChainScopes.includes(d.source.route)).toBe(true);
              }
            },
          ),
          { numRuns: 200 },
        );
      },
    );
  },
);
