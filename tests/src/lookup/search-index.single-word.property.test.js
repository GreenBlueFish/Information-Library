// tests/src/lookup/search-index.single-word.property.test.js
//
// Property-based test for the lookup query's single-word resolution
// (design.md — Correctness Properties → "Property 2: Single-word resolution").
//
//   Property 2: Single-word resolution
//   **Validates: Requirements 5.1, 5.2**
//
// For any single token t that is an indexed term, `query` returns t's entry, so
// a double-clicked word always resolves when a definition exists (R5.1: a
// double-clicked single word that is an indexed term returns that term's entry;
// R5.2: a single-token selection that normalizes to a token terminating a
// Term_Entry resolves to that entry).
//
// Strategy: generate a random SET of distinct single-token terms, build the
// index, then for a selection drawn from those indexed terms assert that
// querying that one word resolves to its own entry with matchKind "exact".
// Crucially, the selection is presented in randomized case and wrapped in
// random surrounding whitespace, so the test also exercises the shared
// `normalize` step (R5.2: resolution is on the NORMALIZED token) — a word typed
// as "  SNN  " or "Neuron" still resolves to the entry indexed under "snn" /
// "neuron". Because every indexed term here is a single token, there is no
// longer term that extends it, so the deepest terminal on the one-token walk is
// the term itself.
//
// fast-check is loaded as an ES module with NO build step (design.md — Testing
// Strategy: "fast-check (vanilla JS, no build step needed to run)"; tests/
// README.md — "Property-based tests ... use fast-check, loaded as an ES module
// per the design's testing strategy"). No vendoring convention is established
// in this repo, so the module is imported from the jsDelivr ESM CDN below, so
// that `node tests/run.js` (Node 18+, with global fetch) resolves it directly
// from the network with no install and no bundler. To run fully offline,
// replace the import specifier with a locally vendored copy of fast-check's ESM
// build and keep the rest of this file unchanged.

import { describe, it, expect } from "../../harness.js";
import * as fcNS from "https://cdn.jsdelivr.net/npm/fast-check/+esm";
import { buildIndex, query } from "../../../src/lookup/search-index.js";
import { normalize } from "../../../src/lookup/trie.js";

// fast-check's ESM build exposes its API on the module namespace; some bundles
// also nest it under `default`. Normalize to a single `fc` handle either way.
const fc = fcNS && typeof fcNS.property === "function" ? fcNS : fcNS.default;

/**
 * A generator for a single lowercase token made of letters only. Keeping tokens
 * to plain `[a-z]` means `normalize` is the identity on each token (no edge
 * punctuation to strip, no case to fold, no whitespace to collapse), so the
 * token we build is exactly the one-token trie path we expect.
 *
 * Built from a letter arbitrary + array join (widely-available fast-check
 * primitives) rather than a regex-string arbitrary, so the test does not depend
 * on a newer arbitrary being present in whichever fast-check version the CDN
 * serves. The `filter` is belt-and-suspenders: it guarantees each generated
 * token normalizes to exactly one token.
 */
const letterArb = fc.integer({ min: 97, max: 122 }).map((c) => String.fromCharCode(c));
const tokenArb = fc
  .array(letterArb, { minLength: 1, maxLength: 8 })
  .map((chars) => chars.join(""))
  .filter((t) => normalize(t).length === 1);

/**
 * A non-empty SET of distinct single tokens — the single-word terms to index.
 * De-duping by normalized form guarantees each is its own one-token trie path
 * with a distinct terminal, so resolving any one of them is unambiguous.
 */
const termSetArb = fc
  .array(tokenArb, { minLength: 1, maxLength: 12 })
  .map((tokens) => {
    const seen = new Set();
    const unique = [];
    for (const t of tokens) {
      const key = normalize(t).join("\u0000");
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(t);
    }
    return unique;
  })
  .filter((unique) => unique.length >= 1);

/**
 * Build a `TermEntry` from a single token. The canonical `term` is the token
 * itself, so `normalize(entry.term)` reproduces `[token]` exactly.
 * Definition/pageRef are present so the resolved result is well-formed.
 *
 * @param {string} token
 * @returns {{term: string, definition: string, pageRef: string|null}}
 */
function entryFromToken(token) {
  return { term: token, definition: `def:${token}`, pageRef: null };
}

/**
 * Re-present a token with randomized letter case and surrounding whitespace, so
 * the selection text differs from the indexed surface form by exactly the
 * things `normalize` is required to fold away (case, leading/trailing/collapsed
 * whitespace). `normalize` of the result must still yield `[token]`, so the
 * one-token resolution is being tested THROUGH normalization (R5.2), not around
 * it.
 *
 * @param {string} token Lowercase single token.
 * @param {number[]} caseBits One bit per character: 1 ⇒ uppercase that char.
 * @param {number} padLeft Count of leading spaces.
 * @param {number} padRight Count of trailing spaces.
 * @returns {string} The decorated selection text.
 */
function decorate(token, caseBits, padLeft, padRight) {
  let out = "";
  for (let i = 0; i < token.length; i++) {
    const ch = token[i];
    out += (caseBits[i] ?? 0) ? ch.toUpperCase() : ch;
  }
  return " ".repeat(padLeft) + out + " ".repeat(padRight);
}

describe("search-index single-word resolution (Property 2) \u2014 Validates: Requirements 5.1, 5.2", () => {
  it("query resolves a double-clicked indexed single word to its own entry (through normalization)", () => {
    fc.assert(
      fc.property(
        termSetArb,
        fc.nat(),
        fc.array(fc.integer({ min: 0, max: 1 }), { minLength: 0, maxLength: 8 }),
        fc.integer({ min: 0, max: 3 }),
        fc.integer({ min: 0, max: 3 }),
        (terms, pick, caseBits, padLeft, padRight) => {
          // Index the set of single-word terms. Each is a one-token trie path
          // with its own terminal entry.
          const entries = terms.map(entryFromToken);
          const index = buildIndex(entries);

          // Choose one indexed single word as the selection.
          const token = terms[pick % terms.length];

          // Present it in randomized case and with surrounding whitespace, so
          // resolution must go through `normalize` (R5.2). Sanity-check that the
          // decorated selection still normalizes to exactly the one token — this
          // keeps the property about single-word resolution, not about
          // normalization edge cases.
          const selectionText = decorate(token, caseBits, padLeft, padRight);
          const selectionTokens = normalize(selectionText);
          expect(selectionTokens.length).toBe(1);
          expect(selectionTokens[0]).toBe(token);

          const result = query(index, selectionText);

          // R5.1 / R5.2: the single indexed word resolves to its own entry.
          expect(result !== null).toBe(true);
          // The resolved match is an exact token-path walk, never fuzzy here.
          expect(result.matchKind).toBe("exact");
          // The resolved entry is the one indexed under this token: its
          // canonical term and definition are exactly that term's.
          expect(result.term).toBe(token);
          expect(result.definition).toBe(`def:${token}`);

          // And the resolved term's own token path is precisely the single
          // selected token — a single-word selection resolves to a single-word
          // term, never to some longer/other entry.
          const resolvedTokens = normalize(result.term);
          expect(resolvedTokens.length).toBe(1);
          expect(resolvedTokens[0]).toBe(token);
        },
      ),
      { numRuns: 200 },
    );
  });
});
