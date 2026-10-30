// tests/src/lookup/search-index.longest-match.property.test.js
//
// Property-based test for the lookup query's longest-match resolution
// (design.md — Correctness Properties → "Property 1: Longest-match wins").
//
//   Property 1: Longest-match wins
//   **Validates: Requirements 4.2, 4.3**
//
// For any selection whose normalized tokens form a path in the trie, `query`
// returns the entry of the DEEPEST terminal on that path — the longest known
// term that is a token-prefix of the selection wins over any shorter prefix
// (R4.2: return the deepest terminal node reached; R4.3: when a shorter term
// and a longer term that extends it are both indexed, the longer term wins when
// the selection matches the longer term's full token path).
//
// Strategy: generate random term sets in which some terms are proper
// token-prefix extensions of others (e.g. "neural" and "neural network"), build
// the index, then assert, for a selection drawn from the indexed surface forms:
//   (a) query resolves to the entry of the LONGEST indexed term that is a
//       token-prefix of the selection (longest-match wins), and
//   (b) the resolved term is itself a token-prefix of the selection and the
//       entry's own token path matches those leading selection tokens (query
//       never returns a term that is not a token-prefix of the selection).
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
 * token sequences we build are exactly the trie paths we expect.
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
 * Build a `TermEntry` from a token array. The canonical `term` is the tokens
 * joined by single spaces, so `normalize(entry.term)` reproduces `tokens`
 * exactly. Definition/pageRef are present so the resolved result is well-formed.
 *
 * @param {string[]} tokens
 * @returns {{term: string, definition: string, pageRef: string|null}}
 */
function entryFromTokens(tokens) {
  const term = tokens.join(" ");
  return { term, definition: `def:${term}`, pageRef: null };
}

/**
 * Generate a "prefix chain": a base token sequence plus one or more strictly
 * longer sequences that each EXTEND the previous by appending tokens. Every
 * proper prefix along the chain is also emitted as its own term, guaranteeing
 * that shorter terms and longer terms that extend them are both indexed — the
 * exact precondition of R4.3.
 *
 * Returns the chain of token arrays in increasing length, e.g.
 *   [ ["neural"], ["neural","network"], ["neural","network","model"] ].
 */
const prefixChainArb = fc
  .array(tokenArb, { minLength: 2, maxLength: 5 })
  .map((tokens) => {
    const chain = [];
    for (let len = 1; len <= tokens.length; len++) {
      chain.push(tokens.slice(0, len));
    }
    return chain;
  });

/**
 * Compute, by brute force independent of the trie, the longest indexed token
 * sequence that is a prefix of `selectionTokens`. This is the oracle the
 * property checks `query` against.
 *
 * @param {string[][]} indexedTokenPaths All indexed terms as token arrays.
 * @param {string[]} selectionTokens The normalized selection.
 * @returns {string[]|null} The longest indexed token-prefix, or null.
 */
function longestIndexedPrefix(indexedTokenPaths, selectionTokens) {
  let best = null;
  for (const path of indexedTokenPaths) {
    if (path.length > selectionTokens.length) continue;
    const isPrefix = path.every((tok, i) => tok === selectionTokens[i]);
    if (!isPrefix) continue;
    if (best === null || path.length > best.length) best = path;
  }
  return best;
}

describe("search-index longest-match (Property 1) \u2014 Validates: Requirements 4.2, 4.3", () => {
  it("query resolves a selection to the deepest terminal on its token path (longest-match wins)", () => {
    fc.assert(
      fc.property(prefixChainArb, fc.nat(), (chain, pick) => {
        // Index every term in the chain. Because each link extends the previous
        // by appending tokens, the chain contains a shorter term AND a longer
        // term that extends it (R4.3's precondition). De-dupe identical paths
        // that distinct random chains might collide on.
        const seen = new Set();
        const entries = [];
        const indexedTokenPaths = [];
        for (const tokens of chain) {
          const key = tokens.join("\u0000");
          if (seen.has(key)) continue;
          seen.add(key);
          entries.push(entryFromTokens(tokens));
          indexedTokenPaths.push(tokens);
        }

        const index = buildIndex(entries);

        // Choose a selection: the tokens of one indexed term from the chain,
        // which is itself a valid token path and shares its leading tokens with
        // every shorter term in the chain. Selecting the LONGEST term must
        // resolve to the longest term, not any shorter prefix.
        const selPath = indexedTokenPaths[pick % indexedTokenPaths.length];
        const selectionText = selPath.join(" ");
        const selectionTokens = normalize(selectionText);

        const result = query(index, selectionText);

        // The oracle: the longest indexed term that is a prefix of the selection.
        const expected = longestIndexedPrefix(indexedTokenPaths, selectionTokens);

        // Such a prefix exists (the selection is itself an indexed term), so the
        // query must return a result (an exact longest match, never fuzzy here).
        expect(result !== null).toBe(true);
        expect(result.matchKind).toBe("exact");

        // (a) Longest-match wins: the resolved term equals the longest indexed
        //     token-prefix of the selection.
        expect(result.term).toBe(expected.join(" "));

        // (b) The resolved term is a genuine token-prefix of the selection — its
        //     own token path matches the leading selection tokens — so query
        //     never returns a term that is not a token-prefix of the selection.
        const resolvedTokens = normalize(result.term);
        const resolvedIsPrefix =
          resolvedTokens.length <= selectionTokens.length &&
          resolvedTokens.every((tok, i) => tok === selectionTokens[i]);
        expect(resolvedIsPrefix).toBe(true);

        // And it is the LONGEST eligible one: no indexed term that is a prefix
        // of the selection is longer than the resolved term.
        const longestEligibleLen = indexedTokenPaths.reduce((max, path) => {
          const fits =
            path.length <= selectionTokens.length &&
            path.every((tok, i) => tok === selectionTokens[i]);
          return fits && path.length > max ? path.length : max;
        }, 0);
        expect(resolvedTokens.length).toBe(longestEligibleLen);
      }),
      { numRuns: 200 },
    );
  });
});
