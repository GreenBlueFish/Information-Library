// src/lookup/search-index.js
//
// Search index build + longest-match query (design.md — Low-Level Design: The
// Lookup Search Algorithm → "Index construction" and "Query: longest
// token-prefix match").
//
// This module turns the flat `terms.json` array into an in-memory token-level
// trie (built once at boot) and answers a user's selection with the LONGEST
// known term that is a token-prefix of that selection. Multi-word terms beat
// single words because walking token-by-token and overwriting the best
// terminal means a 2-token terminal ("neural network") is recorded after the
// 1-token terminal ("neural") and therefore wins. When no exact token path
// exists, the query hands off to the fuzzy fallback (typos/plurals).
//
// It builds on `trie.js`:
//   - `createTrieNode()` — the trie root.
//   - `insert(root, tokens, entry)` — add a surface form's token path.
//   - `normalize(text)` — the SHARED normalization (lowercase, trim, collapse
//     whitespace, strip edge punctuation, split) used by BOTH build and query
//     so indexing and querying agree on how text becomes tokens.
//
// Requirements: 4.1 (normalize + query the index), 4.2 (return the deepest
// terminal on the token path), 4.3 (longer term wins over the shorter prefix),
// 4.5 (empty selection → no query), 4.6 (no exact path → fuzzy fallback),
// 5.1/5.2 (single-word resolution), 6.1/6.2 (acronym indexed + resolves),
// 6.3/6.4 (aliases indexed + resolve), 6.5 (acronym omitted when absent — no
// empty/null surface form), 9.1/9.3 (terms.json is the source of truth, matched
// on the normalized form), 11.2 (exact lookup time scales with selection
// length, not the number of indexed terms — the trie is why).

import { createTrieNode, insert, normalize } from "./trie.js";

/**
 * @typedef {import("../content-loader.js").TermEntry} TermEntry
 */

/**
 * The in-memory lookup index: a token-level trie rooted at `root`.
 *
 * @typedef {Object} SearchIndex
 * @property {import("./trie.js").TrieNode} root The trie root; walk its
 *   `children` by normalized token to reach terminal `TermEntry` nodes.
 * @property {Map<string, TermEntry[]>} byTerm Every entry grouped by its
 *   normalized canonical `term`, in `terms.json` order, so a term with several
 *   definitions can show all of them.
 */

/**
 * One definition of a matched term, as the UI shows it.
 *
 * @typedef {Object} Definition
 * @property {string} term The entry's canonical term.
 * @property {string} definition The definition text.
 * @property {string|null} pageRef Route to a page explaining it, or null.
 * @property {string|null} acronym The entry's acronym, or null.
 */

/**
 * The resolved answer for a selection (design.md — Component 4, `LookupResult`).
 *
 * @typedef {Object} LookupResult
 * @property {string} term The canonical matched term (always the entry's
 *   `term`, even when the user selected an alias or acronym).
 * @property {string} definition The term's definition text.
 * @property {string|null} pageRef Route to a page explaining the term, or null.
 * @property {string|null} acronym The entry's acronym when it has one, else
 *   `null`. Carried through so the panel can show it alongside the canonical
 *   term (Requirement 8.3). Omitted entries resolve to `null` (Requirement 6.5).
 * @property {"exact"|"fuzzy"} matchKind How the match was found: an exact
 *   token-path walk, or the bounded fuzzy fallback.
 * @property {Definition[]} definitions Every definition of the matched term,
 *   the resolved one first; more than one when `terms.json` defines the same
 *   term (or surface form) more than once, so the panel can cycle through them.
 */

/**
 * The bounded edit distance used for the fuzzy fallback (design.md — Query:
 * `fuzzyNearest(index, selectionText, maxDistance = 2)`; Requirement 7.1).
 */
const FUZZY_MAX_DISTANCE = 2;

/**
 * Build the Search_Index from the lookup table.
 *
 * For each entry, every surface form — the canonical `term`, each `alias`, and
 * the `acronym` WHEN PRESENT — is inserted under the SAME entry, because an
 * alias/acronym is just another way to spell the same term. The acronym is
 * omitted entirely when absent (Requirement 6.5): there is no empty/null
 * surface form to index. All matching is done on the normalized token form, so
 * it is case- and whitespace-insensitive (Requirement 9.3).
 *
 * Surface forms that normalize to zero tokens (empty/whitespace/punctuation
 * only) are skipped — `insert` with an empty path is a no-op anyway, so they
 * never create a spurious terminal.
 *
 * Complexity: O(T) time and space, where T is the total number of tokens
 * across all terms, aliases, and acronyms (design.md — Index construction).
 *
 * @param {TermEntry[]} termEntries The parsed `terms.json` array.
 * @returns {SearchIndex} The built index (pass to `query`).
 */
export function buildIndex(termEntries) {
  const root = createTrieNode();
  /** @type {Map<string, TermEntry[]>} */
  const byTerm = new Map();

  const entries = Array.isArray(termEntries) ? termEntries : [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;

    for (const surface of surfaceForms(entry)) {
      const tokens = normalize(surface);
      if (tokens.length === 0) continue; // nothing to index for this surface
      insert(root, tokens, entry);
    }

    const key = termKey(entry.term);
    if (key !== "") {
      if (!byTerm.has(key)) byTerm.set(key, []);
      byTerm.get(key).push(entry);
    }
  }

  return { root, byTerm };
}

/**
 * Collect an entry's surface forms in a stable order: canonical term first,
 * then aliases (in declared order), then the acronym WHEN PRESENT. A missing,
 * empty, or non-string surface is left out so it never becomes a trie path.
 *
 * @param {TermEntry} entry
 * @returns {string[]} The surface-form strings to index for this entry.
 */
function surfaceForms(entry) {
  const surfaces = [];

  if (typeof entry.term === "string") surfaces.push(entry.term);

  if (Array.isArray(entry.aliases)) {
    for (const alias of entry.aliases) {
      if (typeof alias === "string") surfaces.push(alias);
    }
  }

  // Acronym is an OPTIONAL additional surface form; it is omitted entirely when
  // the entry has no acronym (Requirement 6.5), so only index a non-empty one.
  if (typeof entry.acronym === "string" && entry.acronym !== "") {
    surfaces.push(entry.acronym);
  }

  return surfaces;
}

/**
 * Resolve a user's selection to a definition using longest-match, then fuzzy.
 *
 * Algorithm (design.md — Query: longest token-prefix match):
 *   1. Normalize the selection into tokens. Empty → return `null` (no query):
 *      a selection that normalizes to zero tokens is not looked up and shows no
 *      panel (Requirement 4.5).
 *   2. Walk the tokens down the trie as far as it allows, remembering the
 *      DEEPEST terminal entry seen. Because a longer terminal is reached after
 *      a shorter one on the same path, the longer term overwrites the shorter —
 *      so longest-match wins (Requirements 4.2, 4.3). A single indexed token
 *      resolves on the first step (Requirements 5.1, 5.2).
 *   3. If a terminal was seen, return an "exact" result.
 *   4. Otherwise fall back to the bounded fuzzy match over the whole selection
 *      (typos/plurals) and return a "fuzzy" result, or `null` when nothing is
 *      within distance (Requirements 4.6, 7.x).
 *
 * The index is never mutated. Exact-walk cost is O(k) token-map lookups where k
 * is the selection length in tokens — independent of how many terms are indexed
 * (Requirement 11.2).
 *
 * @param {SearchIndex} index An index built by `buildIndex`.
 * @param {string} selectionText The user's double-clicked word or highlight.
 * @returns {LookupResult|null} The longest exact match, else the nearest fuzzy
 *   candidate within distance, else `null`.
 */
export function query(index, selectionText) {
  const tokens = normalize(selectionText);
  if (tokens.length === 0) return null; // no query for an empty selection (R4.5)

  let node = index.root;
  /** @type {TermEntry|null} */
  let bestEntry = null;
  /** @type {TermEntry[]} */
  let bestEntries = [];

  // Walk as far as the trie allows; the deepest terminal on the walked path is
  // the longest known term that is a token-prefix of the selection.
  for (let i = 0; i < tokens.length; i++) {
    const next = node.children.get(tokens[i]);
    if (next === undefined) break; // the token path ends here
    node = next;
    if (node.entry !== null) {
      // A longer terminal overwrites the shorter one. When several entries end
      // here, the first in `terms.json` order is shown first.
      bestEntries = node.entries?.length ? node.entries : [node.entry];
      bestEntry = bestEntries[0];
    }
  }

  if (bestEntry !== null) {
    return makeResult(bestEntry, "exact", alternatives(index, bestEntries, bestEntry));
  }

  // No exact token path: hand the whole selection to the fuzzy fallback
  // (Requirement 4.6). The fuzzy module is implemented in a later task; until
  // it exists, `fuzzyNearest` resolves to null and the exact path above is the
  // only one that returns — which is correct for everything already indexed.
  const candidate = fuzzyNearest(index, selectionText, FUZZY_MAX_DISTANCE);
  if (candidate) {
    return makeResult(candidate, "fuzzy", alternatives(index, [candidate], candidate));
  }

  return null;
}

/**
 * Shape a `TermEntry` into the `LookupResult` the UI consumes. The result
 * always carries the CANONICAL term, so selecting an alias or acronym still
 * shows the entry's canonical name. `pageRef` and `acronym` default to `null`
 * when the entry omits them (the `acronym` field is absent entirely, not empty,
 * on entries without one — Requirement 6.5).
 *
 * @param {TermEntry} entry The resolved term entry.
 * @param {"exact"|"fuzzy"} matchKind How it was matched.
 * @param {TermEntry[]} [all] Every entry to offer, `entry` first.
 * @returns {LookupResult}
 */
function makeResult(entry, matchKind, all = [entry]) {
  return { ...toDefinition(entry), matchKind, definitions: all.map(toDefinition) };
}

/**
 * Shape one `TermEntry` as a `Definition`.
 *
 * @param {TermEntry} entry
 * @returns {Definition}
 */
function toDefinition(entry) {
  return {
    term: entry.term,
    definition: entry.definition,
    pageRef: entry.pageRef ?? null,
    acronym: typeof entry.acronym === "string" && entry.acronym !== "" ? entry.acronym : null,
  };
}

/**
 * Every entry the reader can cycle through for a match: the entries ending at
 * the matched surface form, plus every other entry sharing one of their
 * canonical terms, without repeats and with `first` leading.
 *
 * @param {SearchIndex} index
 * @param {TermEntry[]} matched The entries the match landed on.
 * @param {TermEntry} first The entry to show first.
 * @returns {TermEntry[]}
 */
function alternatives(index, matched, first) {
  const out = [first];
  for (const entry of matched) {
    for (const same of [entry, ...(index.byTerm?.get(termKey(entry.term)) ?? [])]) {
      if (!out.includes(same)) out.push(same);
    }
  }
  return out;
}

/**
 * The grouping key for a canonical term: its normalized tokens, space-joined.
 *
 * @param {unknown} term
 * @returns {string}
 */
function termKey(term) {
  return normalize(typeof term === "string" ? term : "").join(" ");
}

/**
 * Find the terms a typed search text names, for the home page's search: an
 * entry matches when the normalized text is a substring of its normalized
 * term, any alias, or its acronym. Entries sharing a canonical term are grouped
 * into one result whose `definitions` holds each of them, so a term defined
 * several times appears once and the reader cycles through its definitions.
 *
 * Results are ordered by how well they match (a surface form equal to the text,
 * then one starting with it, then one containing it), then alphabetically by
 * term, and capped at `limit`.
 *
 * @param {TermEntry[]} termEntries The parsed `terms.json` array.
 * @param {string} text The typed search text.
 * @param {number} [limit] The most results to return.
 * @returns {Array<{term: string, definitions: Definition[]}>} Empty for an
 *   empty text or no match.
 */
export function findTerms(termEntries, text, limit = 8) {
  const q = normalize(text).join(" ");
  if (q === "" || !Array.isArray(termEntries)) return [];

  /** @type {Map<string, {term: string, rank: number, entries: TermEntry[]}>} */
  const groups = new Map();
  for (const entry of termEntries) {
    if (!entry || typeof entry !== "object") continue;
    let rank = Infinity;
    for (const surface of surfaceForms(entry)) {
      const form = normalize(surface).join(" ");
      if (form === q) rank = Math.min(rank, 0);
      else if (form.startsWith(q)) rank = Math.min(rank, 1);
      else if (form.includes(q)) rank = Math.min(rank, 2);
    }
    if (rank === Infinity) continue;

    const key = termKey(entry.term);
    const group = groups.get(key);
    if (group) {
      group.rank = Math.min(group.rank, rank);
      group.entries.push(entry);
    } else {
      groups.set(key, { term: entry.term, rank, entries: [entry] });
    }
  }

  return [...groups.values()]
    .sort((a, b) => a.rank - b.rank || a.term.localeCompare(b.term, undefined, { sensitivity: "base" }))
    .slice(0, limit)
    .map((g) => ({ term: g.term, definitions: g.entries.map(toDefinition) }));
}

/**
 * The fuzzy fallback (typos / plurals) lives in `./fuzzy.js`, implemented in a
 * later task (5.6). It is imported LAZILY here so that:
 *   - `query`'s exact-match path works today, before `fuzzy.js` exists; and
 *   - once `fuzzy.js` lands, no change to this module is needed — the lazy
 *     import resolves it and `query` automatically uses it.
 *
 * The real module is expected to export `fuzzyNearest(index, text, maxDistance)`
 * returning a `TermEntry` or `null`. Because trie-walk `query` is synchronous
 * and the module may not exist yet, we kick off a one-time dynamic import and
 * use the resolved function on subsequent calls; while the module is absent (or
 * still loading on the very first miss), this returns `null`, which simply
 * means "no fuzzy candidate" — the exact path is unaffected.
 *
 * @type {((index: SearchIndex, text: string, maxDistance: number) => (TermEntry|null)) | null}
 */
let resolvedFuzzyNearest = null;
/** @type {boolean} True once a load of `./fuzzy.js` has been attempted. */
let fuzzyLoadAttempted = false;

/**
 * Synchronous shim over the lazily-loaded `fuzzyNearest`. Triggers a one-time
 * dynamic import of `./fuzzy.js`; returns the resolved function's result once
 * available, or `null` when the module is absent or not yet loaded.
 *
 * @param {SearchIndex} index
 * @param {string} text
 * @param {number} maxDistance
 * @returns {TermEntry|null}
 */
function fuzzyNearest(index, text, maxDistance) {
  if (resolvedFuzzyNearest) {
    return resolvedFuzzyNearest(index, text, maxDistance);
  }
  if (!fuzzyLoadAttempted) {
    fuzzyLoadAttempted = true;
    // Fire-and-forget: wire up the real implementation for later calls. A
    // missing module (before task 5.6) rejects harmlessly and leaves the
    // exact-only behavior in place.
    import("./fuzzy.js")
      .then((mod) => {
        if (mod && typeof mod.fuzzyNearest === "function") {
          resolvedFuzzyNearest = mod.fuzzyNearest;
        }
      })
      .catch(() => {
        /* fuzzy.js not present yet (task 5.6); exact-only is correct for now. */
      });
  }
  return null;
}
