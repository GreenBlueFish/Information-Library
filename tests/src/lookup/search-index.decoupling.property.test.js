// tests/src/lookup/search-index.decoupling.property.test.js
//
// Property-based test for the lookup system's decoupling guarantee
// (design.md — Correctness Properties → "Property 3: Lookup decoupling").
//
//   Property 3: Lookup decoupling
//   **Validates: Requirements 9.1, 9.2**
//
// Adding a `TermEntry` to `terms.json` and rebuilding the Search_Index changes
// lookup results for THAT term only; results for every pre-existing, unrelated
// term are unchanged, and no page file or renderer code must change. Because
// `terms.json` is the single source of truth (R9.1) and the index rebuilds from
// data (R9.2), rebuilding with one extra entry is the whole of "adding a term".
//
// Strategy: generate a random BASE set of term entries plus one additional
// "new" term whose surface forms share NO token with the base set (disjoint
// token paths, so the new term cannot be a prefix of — or extend — any base
// term and vice versa). Build index A from the base set and index B from
// base + new. Then assert:
//   (a) for every base term's surface form, `query(A, s)` and `query(B, s)`
//       return the SAME entry (same term/definition/pageRef/matchKind) — adding
//       the new term did not perturb any existing result; and
//   (b) `query(B, newSurface)` resolves to the new term while `query(A,
//       newSurface)` does NOT resolve to it (null, since the new term shares no
//       tokens with the base set and fuzzy is not loaded in-process here) —
//       demonstrating the new term is resolvable ONLY after the additive change.
//
// fast-check is loaded as an ES module with NO build step, matching the sibling
// longest-match property test's convention exactly (design.md — Testing
// Strategy: "fast-check (vanilla JS, no build step needed to run)"). The module
// is imported from the jsDelivr ESM CDN so that `node tests/run.js` (Node 18+,
// with global fetch) resolves it directly from the network with no install and
// no bundler. To run fully offline, replace the import specifier with a locally
// vendored copy of fast-check's ESM build and keep the rest of this file
// unchanged.

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
 * token sequences we build are exactly the trie paths we expect. Mirrors the
 * sibling longest-match property test's token arbitrary.
 */
const letterArb = fc.integer({ min: 97, max: 122 }).map((c) => String.fromCharCode(c));
const tokenArb = fc
  .array(letterArb, { minLength: 1, maxLength: 8 })
  .map((chars) => chars.join(""))
  .filter((t) => normalize(t).length === 1);

/**
 * A single-token term arbitrary. Each base term is one indexed token, which is
 * enough to exercise decoupling without entangling this property with
 * longest-match prefix behavior (covered by Property 1). The canonical `term`
 * is the token itself, so `normalize(entry.term)` reproduces `[token]`.
 */
const termTokenArb = tokenArb;

/**
 * Build a `TermEntry` from a single surface token. Definition/pageRef are
 * present so the resolved `LookupResult` is well-formed and distinguishable per
 * term (the definition encodes the term, so equality checks are meaningful).
 *
 * @param {string} token A one-token surface form.
 * @returns {{term: string, definition: string, pageRef: string|null}}
 */
function entryFromToken(token) {
  return { term: token, definition: `def:${token}`, pageRef: `/t/${token}` };
}

describe(
  "search-index decoupling (Property 3) \u2014 Validates: Requirements 9.1, 9.2",
  () => {
    it(
      "adding a new term changes results for that term only; all pre-existing results are unchanged",
      () => {
        fc.assert(
          fc.property(
            // A base set of distinct single-token terms...
            fc.uniqueArray(termTokenArb, { minLength: 1, maxLength: 12 }),
            // ...plus one extra token for the brand-new term.
            tokenArb,
            (baseTokens, rawNewToken) => {
              // Ensure the new term's token is DISJOINT from the base set, so
              // its token path cannot collide with, extend, or be a prefix of
              // any base term (and vice versa). If the random draw collides,
              // derive a guaranteed-fresh token by extending it with a letter
              // not already a base token; the base tokens are single letters at
              // most 8 long, so appending keeps it a valid single token and the
              // constructed value is checked to be absent from the base set.
              const baseSet = new Set(baseTokens);
              let newToken = rawNewToken;
              while (baseSet.has(newToken)) {
                newToken = newToken + "x";
              }
              // `newToken` is `[a-z]`-only, so it stays a single normalized token.

              const baseEntries = baseTokens.map(entryFromToken);
              const newEntry = entryFromToken(newToken);

              // Index A: base only. Index B: base + the new term appended
              // (the additive edit to terms.json, R9.2), rebuilt from data.
              const indexA = buildIndex(baseEntries);
              const indexB = buildIndex([...baseEntries, newEntry]);

              // (a) Every pre-existing term's surface form resolves identically
              //     in A and B — adding the new term perturbed nothing else.
              for (const token of baseTokens) {
                const rA = query(indexA, token);
                const rB = query(indexB, token);

                // Each base term is indexed, so both must resolve (exactly).
                expect(rA !== null).toBe(true);
                expect(rB !== null).toBe(true);

                // Same resolved entry, field for field: term, definition,
                // pageRef, and matchKind are all unchanged by the addition.
                expect(rB.term).toBe(rA.term);
                expect(rB.definition).toBe(rA.definition);
                expect(rB.pageRef).toBe(rA.pageRef);
                expect(rB.matchKind).toBe(rA.matchKind);

                // And it still resolves to its own canonical term.
                expect(rB.term).toBe(token);
                expect(rB.matchKind).toBe("exact");
              }

              // (b) The new term is resolvable ONLY after the additive change.
              //     In B it resolves (exactly) to the new term; in A, which
              //     never indexed it and shares no tokens, it does not resolve
              //     to the new term. The new token shares no surface with any
              //     base term, so A has no exact path for it; fuzzy.js is not
              //     loaded synchronously in-process, so A returns null here.
              const newInB = query(indexB, newToken);
              expect(newInB !== null).toBe(true);
              expect(newInB.term).toBe(newToken);
              expect(newInB.definition).toBe(`def:${newToken}`);
              expect(newInB.matchKind).toBe("exact");

              const newInA = query(indexA, newToken);
              // A must not surface the new term (it was never part of A).
              const resolvedToNewInA = newInA !== null && newInA.term === newToken;
              expect(resolvedToNewInA).toBe(false);
            },
          ),
          { numRuns: 200 },
        );
      },
    );
  },
);
