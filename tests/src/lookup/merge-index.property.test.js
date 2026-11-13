// tests/src/lookup/merge-index.property.test.js
//
// Feature: glossary-scoped-search, Property 2
//
// Property-based test for `mergeIndexes` equivalence and source preservation
// (design.md — Correctness Properties → "Property 2: Merging equals building
// over the concatenation, preserving order and source").
//
//   Property 2: Merging equals building over the concatenation, preserving
//               order and source
//   **Validates: Requirements 4.4, 4.5, 6.2, 11.2, 1.6, 4.7**
//
// For any ordered list of Glossary_Files (each an array of TermEntry objects
// carrying a distinct runtime-only `source`), building each file into its own
// `SearchIndex` and folding them with `mergeIndexes` must produce an index that
// is INDISTINGUISHABLE from building a single index over the concatenation of
// those files in input order:
//
//   mergeIndexes(files.map(buildIndex))  ≡  buildIndex(files.flat())
//
// "Indistinguishable" is checked two ways:
//   (a) Answer equivalence — for every probed selection (drawn from the indexed
//       surface forms, plus some miss/stopword probes), `query` and
//       `findMatches` return the SAME answer from the merged index as from the
//       single concatenation build: same ordered list of matches, same term /
//       matchKind, same ordered definitions (so ranking is unchanged and the
//       nearer-first input order is preserved — R4.4, R4.5, R6.2, R11.2).
//   (b) Source preservation — `source` rides on the `TermEntry` objects that
//       the index carries by reference (never on the trie keys), and
//       `mergeIndexes` re-inserts those same objects without reshaping them.
//       So every entry the merged index holds (grouped in `byTerm`, and stamped
//       on each trie terminal) is the SAME object, with the SAME `source`, as
//       the one the concatenation build holds — nothing copies, drops, or
//       rewrites the runtime-only annotation (R1.6, R4.7).
//
// Strategy: generate several "files", each a list of single- and multi-token
// TermEntry objects, and give every file a distinct `source` so a definition's
// originating glossary is identifiable. Terms are reused across files on
// purpose (so merge has to concatenate same-term groups and dedupe surface
// forms exactly as a single build would), and multi-token terms that extend
// shorter ones appear so longest-match ranking is exercised through the merge.
//
// fast-check is loaded as an ES module with NO build step, matching the sibling
// lookup property tests' convention exactly (design.md — Testing Strategy:
// "fast-check (vanilla JS, no build step needed to run)"). The module is
// imported from the jsDelivr ESM CDN so that `node tests/run.js` resolves it;
// run under `node --import ./tests/net/register.js tests/run.js`, the net hook
// serves it from the vendored copy under tests/vendor so the suite runs
// offline on a pinned version.

import { describe, it, expect } from "../../harness.js";
import * as fcNS from "https://cdn.jsdelivr.net/npm/fast-check/+esm";
import { buildIndex, mergeIndexes, query } from "../../../src/lookup/search-index.js";
import { findMatches } from "../../../src/lookup/matches.js";
import { normalize } from "../../../src/lookup/trie.js";

// fast-check's ESM build exposes its API on the module namespace; some bundles
// also nest it under `default`. Normalize to a single `fc` handle either way.
const fc = fcNS && typeof fcNS.property === "function" ? fcNS : fcNS.default;

/**
 * A single lowercase token made of letters only. Keeping tokens to plain
 * `[a-z]` means `normalize` is the identity on each token (no edge punctuation
 * to strip, no case to fold, no whitespace to collapse), so the token sequences
 * we build are exactly the trie paths we expect. Mirrors the sibling lookup
 * property tests' token arbitrary.
 */
const letterArb = fc.integer({ min: 97, max: 122 }).map((c) => String.fromCharCode(c));
const tokenArb = fc
  .array(letterArb, { minLength: 1, maxLength: 6 })
  .map((chars) => chars.join(""))
  .filter((t) => normalize(t).length === 1);

/**
 * A term is 1–3 whitespace-joined tokens. Multi-token terms let the merge be
 * tested against longest-match ranking (a 2-token term beating its 1-token
 * prefix) exactly as a single build would resolve it.
 */
const termTokensArb = fc.array(tokenArb, { minLength: 1, maxLength: 3 });

/**
 * One TermEntry. The canonical `term` is the tokens joined by single spaces
 * (so `normalize(term)` reproduces the tokens), the definition encodes the term
 * AND a per-entry salt so entries that share a term are still distinguishable,
 * and a per-entry `pageRef` is present so results are well-formed. `source` is
 * attached by `fileArb` (shared across a file's entries), matching how the
 * loader annotates a Glossary_File at runtime.
 *
 * @param {string[]} tokens
 * @param {number} salt
 * @returns {{term: string, definition: string, pageRef: string|null}}
 */
function entryFromTokens(tokens, salt) {
  const term = tokens.join(" ");
  return { term, definition: `def:${term}:${salt}`, pageRef: `/t/${term}/${salt}` };
}

/**
 * A "Glossary_File": a non-empty list of TermEntry objects all carrying the
 * SAME `source` (a distinct `{ route, title }` per file, as the loader attaches
 * per Glossary_File). The `fileIndex` makes the route/title distinct and salts
 * the definitions so a definition's originating file is identifiable.
 */
const fileArb = (fileIndex) =>
  fc
    .array(termTokensArb, { minLength: 1, maxLength: 6 })
    .map((termList) => {
      const source = { route: `/g${fileIndex}`, title: `Glossary ${fileIndex}` };
      return termList.map((tokens, i) => ({
        ...entryFromTokens(tokens, `${fileIndex}.${i}`),
        source,
      }));
    });

/** A list of 1–4 files, each with its own distinct `source`. */
const filesArb = fc
  .integer({ min: 1, max: 4 })
  .chain((n) => fc.tuple(...Array.from({ length: n }, (_, i) => fileArb(i))));

/**
 * The selection probes for a generated file set: every indexed surface form
 * (so each exact/within path is exercised), plus a couple of fixed probes for
 * a stopword and an empty/whitespace selection (no-query paths), plus a token
 * unlikely to be indexed (a near-certain miss). The same probe list is run
 * against both indexes and compared, so we never assume WHAT the answer is —
 * only that the two indexes agree.
 *
 * @param {Array<Array<{term: string}>>} files
 * @returns {string[]}
 */
function selectionProbes(files) {
  const probes = new Set(["", "   ", "the", "zzzzzzqx"]);
  for (const file of files) {
    for (const entry of file) probes.add(entry.term);
  }
  return [...probes];
}

/**
 * Shape a `query` result for comparison: the identity-bearing fields plus the
 * ordered definitions (term + definition + pageRef + acronym). `null` stays
 * `null`. Source is NOT compared here — it is checked separately against the
 * entries the index carries (query/findMatches intentionally project entries to
 * a `Definition` shape; this property is about the merge being equivalent to a
 * single build, and both sides project identically).
 *
 * @param {import("../../../src/lookup/search-index.js").LookupResult|null} r
 */
function normalizeQuery(r) {
  if (r === null) return null;
  return {
    term: r.term,
    definition: r.definition,
    pageRef: r.pageRef,
    acronym: r.acronym,
    matchKind: r.matchKind,
    definitions: r.definitions.map((d) => ({
      term: d.term,
      definition: d.definition,
      pageRef: d.pageRef,
      acronym: d.acronym,
    })),
  };
}

/**
 * Shape a `findMatches` result list for comparison: the ordered matches, each
 * with term, matchKind, and ordered definitions.
 *
 * @param {import("../../../src/lookup/matches.js").Match[]} matches
 */
function normalizeMatches(matches) {
  return matches.map((m) => ({
    term: m.term,
    matchKind: m.matchKind,
    definitions: m.definitions.map((d) => ({
      term: d.term,
      definition: d.definition,
      pageRef: d.pageRef,
      acronym: d.acronym,
    })),
  }));
}

/**
 * Flatten an index's `byTerm` groups into a single list in iteration order
 * (Map iteration is insertion order), recovering the entry sequence the index
 * was built over. Used to compare, entry-for-entry, that the merged index and
 * the concatenation build carry the SAME entry objects — including `source`.
 *
 * @param {import("../../../src/lookup/search-index.js").SearchIndex} index
 * @returns {object[]}
 */
function entriesOf(index) {
  const out = [];
  for (const group of index.byTerm.values()) {
    for (const entry of group) out.push(entry);
  }
  return out;
}

describe(
  "search-index mergeIndexes (Property 2) \u2014 Validates: Requirements 4.4, 4.5, 6.2, 11.2, 1.6, 4.7",
  () => {
    it(
      "merging per-file indexes answers query/findMatches identically to building over the concatenation",
      () => {
        fc.assert(
          fc.property(filesArb, (files) => {
            // Build each file into its own index, then merge — the production
            // path (build-per-file, cache, fold).
            const merged = mergeIndexes(files.map((f) => buildIndex(f)));
            // The oracle: a single build over the concatenation in input order.
            const single = buildIndex(files.flat());

            // (a) Answer equivalence: the two indexes agree on every probe for
            //     both `query` and `findMatches` (ranking + nearer-first order
            //     preserved — R4.4, R4.5, R6.2, R11.2).
            for (const sel of selectionProbes(files)) {
              expect(normalizeQuery(query(merged, sel))).toEqual(
                normalizeQuery(query(single, sel)),
              );
              expect(normalizeMatches(findMatches(merged, sel))).toEqual(
                normalizeMatches(findMatches(single, sel)),
              );
            }
          }),
          { numRuns: 150 },
        );
      },
    );

    it(
      "every entry the merged index carries keeps its originating source, exactly as the concatenation build",
      () => {
        fc.assert(
          fc.property(filesArb, (files) => {
            const merged = mergeIndexes(files.map((f) => buildIndex(f)));
            const single = buildIndex(files.flat());

            const mergedEntries = entriesOf(merged);
            const singleEntries = entriesOf(single);

            // The entry sequence the merged index carries matches the
            // concatenation build's, entry-for-entry and in the same order:
            // merge is defined to reproduce `buildIndex(files.flat())`.
            expect(mergedEntries.length).toBe(singleEntries.length);

            // Also equals the raw concatenation length — no entry dropped or
            // duplicated by the merge.
            expect(mergedEntries.length).toBe(files.flat().length);

            for (let i = 0; i < mergedEntries.length; i++) {
              const m = mergedEntries[i];
              const s = singleEntries[i];

              // Same canonical term and definition, in the same position.
              expect(m.term).toBe(s.term);
              expect(m.definition).toBe(s.definition);

              // Source preserved untouched (R1.6, R4.7): the runtime-only
              // annotation rides through the merge unchanged — same route and
              // title as the originating glossary, by reference.
              expect(m.source).toBe(s.source);
              expect(m.source.route).toBe(s.source.route);
              expect(m.source.title).toBe(s.source.title);
            }

            // Every trie terminal in the merged index is an entry that still
            // carries a `source` (nothing on the trie path strips it).
            const stack = [merged.root];
            while (stack.length) {
              const node = stack.pop();
              for (const entry of node.entries) {
                expect(entry.source !== undefined).toBe(true);
                expect(typeof entry.source.route).toBe("string");
                expect(typeof entry.source.title).toBe("string");
              }
              for (const child of node.children.values()) stack.push(child);
            }
          }),
          { numRuns: 150 },
        );
      },
    );
  },
);
