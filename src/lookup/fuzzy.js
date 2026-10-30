// src/lookup/fuzzy.js
//
// Fuzzy fallback for the lookup system — typos and plurals (design.md —
// Low-Level Design: The Lookup Search Algorithm → "Fuzzy fallback (typos /
// plurals)"). This is the second stage of a selection lookup: `search-index.js`
// `query` walks the trie for an EXACT longest token-path match first, and only
// when that finds nothing does it hand the whole selection here.
//
// `search-index.js` imports this module LAZILY and calls it with exactly this
// signature:
//
//     import("./fuzzy.js").then((mod) => mod.fuzzyNearest(index, text, maxDistance))
//
// so the one required export is `fuzzyNearest(index, text, maxDistance)`,
// returning a `TermEntry` or `null`. The caller marks the returned entry as a
// "fuzzy" match (search-index sets matchKind "fuzzy"); this module only decides
// WHICH entry (if any) is the nearest candidate.
//
// Strategy, in the order the design prescribes:
//   1. Normalize the selection to a single joined string (shared `normalize`
//      from `./trie.js`, joined with spaces) so we compare apples to apples.
//   2. CHEAP PRE-STEP — strip a trailing `s`/`es` and retry an EXACT trie walk
//      against `index.root`, so "neurons" → "neuron" resolves without paying
//      for edit distance (Requirement 7.2).
//   3. Otherwise build a SMALL candidate bucket of indexed surface forms
//      (bucketed by first token and by length window) and run a bounded
//      Levenshtein (maxDistance 2, early-exit past the bound). Smallest
//      distance wins; ties break by lexicographic order of the surface form
//      (Requirements 7.1, 7.3). Nothing within distance → `null` (7.4).
//
// Requirements: 7.1 (fuzzy match within Levenshtein distance ≤ 2), 7.2 (a
// trailing `s`/`es` difference resolves to the surface form's entry), 7.3
// (smallest distance wins, ties by lexicographic surface order, mark fuzzy —
// marking is the caller's job), 7.4 (nothing within distance → no result).

import { normalize } from "./trie.js";

/**
 * @typedef {import("../content-loader.js").TermEntry} TermEntry
 * @typedef {import("./trie.js").TrieNode} TrieNode
 * @typedef {import("./search-index.js").SearchIndex} SearchIndex
 */

/**
 * A single indexed surface form paired with the entry it resolves to and some
 * precomputed shape used for cheap bucketing.
 *
 * @typedef {Object} Candidate
 * @property {string} normalized The surface form as a single normalized string
 *   (tokens joined with a space), e.g. "neural network".
 * @property {string} firstToken The first normalized token, used to bucket.
 * @property {number} length `normalized.length`, used to bucket by size.
 * @property {TermEntry} entry The term this surface form resolves to.
 */

/**
 * The window (in characters) around the selection length within which a
 * candidate is considered plausible. A candidate whose length differs from the
 * selection by more than `maxDistance` characters can never be within
 * `maxDistance` edits (each insert/delete changes length by one), so there is
 * no point edit-distancing it. We widen the window to this constant so the
 * bucket stays small without ever excluding a genuine neighbor.
 */
const LENGTH_WINDOW = 2;

/**
 * Find the nearest indexed surface form to `text` within `maxDistance` edits.
 *
 * Called by `search-index.js` `query` only AFTER the exact trie walk misses, so
 * by contract `text` has no exact token-path match. Returns the winning
 * candidate's `TermEntry`, or `null` when nothing is within distance. The
 * caller tags the result as a fuzzy match.
 *
 * @param {SearchIndex} index The index built by `buildIndex` (walk `index.root`).
 * @param {string} text The user's selection (raw; normalized here).
 * @param {number} maxDistance Inclusive edit-distance bound (design default 2).
 * @returns {TermEntry|null} The nearest entry within distance, else `null`.
 */
export function fuzzyNearest(index, text, maxDistance) {
  if (!index || !index.root) return null;

  const tokens = normalize(text);
  if (tokens.length === 0) return null; // nothing to match against

  const norm = tokens.join(" ");

  // 1. Cheap plural pre-step: strip a trailing `es` then `s` and retry an exact
  //    trie walk. This resolves "neurons" → "neuron" (and "boxes" → "box")
  //    without computing any edit distances (Requirement 7.2).
  const singular = stripTrailingPlural(tokens);
  if (singular) {
    const entry = exactWalk(index.root, singular);
    if (entry) return entry;
  }

  // 2. Bounded Levenshtein over a small candidate bucket. Collect candidates
  //    once (first token OR a length-window neighborhood), then score each with
  //    an early-exiting edit distance.
  const candidates = candidateBucket(index, norm, tokens[0], maxDistance);

  /** @type {TermEntry|null} */
  let best = null;
  /** @type {string|null} */
  let bestSurface = null;
  let bestDist = maxDistance + 1; // strictly beatable by anything within bound

  for (const cand of candidates) {
    const d = boundedEditDistance(norm, cand.normalized, maxDistance);
    if (d > maxDistance) continue; // early-exit sentinel: out of bound

    if (
      d < bestDist ||
      // Tie: break by lexicographic order of the surface form (Requirement 7.3).
      (d === bestDist && bestSurface !== null && cand.normalized < bestSurface)
    ) {
      bestDist = d;
      best = cand.entry;
      bestSurface = cand.normalized;
    }
  }

  return best; // null when nothing landed within maxDistance (Requirement 7.4)
}

/**
 * Strip a trailing plural suffix from the LAST token of a token list and return
 * the resulting token list, or `null` when no plural suffix applies.
 *
 * Tries `es` first (so "boxes" → "box", "classes" → "class"), then a single
 * `s` ("neurons" → "neuron"). Only the final token is de-pluralized, which is
 * where an English plural actually lands ("spiking neurons" → "spiking
 * neuron"). Very short stems are left alone so we do not strip "as"/"is" down
 * to a single letter.
 *
 * @param {string[]} tokens Normalized tokens of the selection.
 * @returns {string[]|null} A new token list with the last token singularized,
 *   or `null` when there is nothing sensible to strip.
 */
function stripTrailingPlural(tokens) {
  const last = tokens[tokens.length - 1];

  let stem = null;
  if (last.endsWith("es") && last.length > 3) {
    stem = last.slice(0, -2);
  } else if (last.endsWith("s") && last.length > 2) {
    stem = last.slice(0, -1);
  }
  if (stem === null) return null;

  const out = tokens.slice();
  out[out.length - 1] = stem;
  return out;
}

/**
 * Walk a token list down the trie and return the entry at the EXACT terminal
 * reached by the full path, or `null` when the path does not end on a terminal.
 *
 * Unlike the longest-match walk in `query`, this requires the WHOLE token list
 * to land exactly on a terminal node — it is the plural retry, where we have a
 * concrete candidate spelling and want a yes/no answer for it.
 *
 * @param {TrieNode} root The trie root.
 * @param {string[]} tokens The (singularized) tokens to look up exactly.
 * @returns {TermEntry|null} The terminal entry, or `null`.
 */
function exactWalk(root, tokens) {
  let node = root;
  for (const token of tokens) {
    const next = node.children.get(token);
    if (next === undefined) return null;
    node = next;
  }
  return node.entry;
}

/**
 * Build a SMALL bucket of plausible candidates to edit-distance against, so we
 * never score the whole index. A surface form is plausible when either:
 *   - it shares the selection's FIRST token (a typo in a later token still
 *     shares the lead word, e.g. "neural netwrk" vs "neural network"), OR
 *   - its length is within `maxDistance + LENGTH_WINDOW` of the selection's
 *     (a single-token typo like "nueron" vs "neuron" is caught here even when
 *     the lead token differs).
 *
 * Both filters are cheap and keep C (candidates) small by construction, which
 * is what bounds the O(C · L²) fuzzy cost (design.md complexity note). A
 * `Set` of entries would still dedupe, but we instead dedupe by surface string
 * so distinct surface forms of the same entry can each be scored and the
 * lexicographic tie-break stays well defined.
 *
 * @param {SearchIndex} index The index to enumerate surface forms from.
 * @param {string} norm The normalized selection string.
 * @param {string} firstToken The selection's first token (bucket key).
 * @param {number} maxDistance The edit-distance bound (for the length window).
 * @returns {Candidate[]} The plausible candidates (deduped by surface form).
 */
function candidateBucket(index, norm, firstToken, maxDistance) {
  const all = enumerateSurfaceForms(index.root);
  const window = maxDistance + LENGTH_WINDOW;

  /** @type {Map<string, Candidate>} */
  const picked = new Map();
  for (const cand of all) {
    const lengthClose = Math.abs(cand.length - norm.length) <= window;
    const sameLead = cand.firstToken === firstToken;
    if (lengthClose || sameLead) {
      if (!picked.has(cand.normalized)) picked.set(cand.normalized, cand);
    }
  }
  return [...picked.values()];
}

/**
 * Enumerate every indexed surface form in the trie as `Candidate` records by a
 * depth-first traversal, collecting the token path at each terminal node. The
 * path's tokens are joined with spaces to reconstruct the normalized surface
 * string the term was indexed under.
 *
 * @param {TrieNode} root The trie root.
 * @returns {Candidate[]} One record per terminal surface form.
 */
function enumerateSurfaceForms(root) {
  /** @type {Candidate[]} */
  const out = [];

  /**
   * @param {TrieNode} node
   * @param {string[]} path Tokens from the root down to (but excluding) `node`
   *   is misleading — `path` holds the tokens that REACH `node`.
   */
  function walk(node, path) {
    if (node.entry !== null && path.length > 0) {
      const normalized = path.join(" ");
      out.push({
        normalized,
        firstToken: path[0],
        length: normalized.length,
        entry: node.entry,
      });
    }
    for (const [token, child] of node.children) {
      path.push(token);
      walk(child, path);
      path.pop();
    }
  }

  walk(root, []);
  return out;
}

/**
 * Levenshtein edit distance between `a` and `b` with an early exit: as soon as
 * an entire row's best value exceeds `maxDistance`, no completion can come back
 * under the bound, so we stop and return `maxDistance + 1` as an "out of bound"
 * sentinel. This keeps the fuzzy fallback cheap — most candidates are rejected
 * after a row or two rather than filling the whole DP table.
 *
 * Uses a single rolling row of size `b.length + 1` (classic two-row DP folded
 * to one) for O(min(|a|,|b|)) space.
 *
 * @param {string} a First string (the normalized selection).
 * @param {string} b Second string (a candidate surface form).
 * @param {number} maxDistance Inclusive bound; results above it are not needed.
 * @returns {number} The edit distance when ≤ `maxDistance`, else
 *   `maxDistance + 1`.
 */
function boundedEditDistance(a, b, maxDistance) {
  if (a === b) return 0;

  // A length gap alone already exceeds the bound: nothing to compute.
  if (Math.abs(a.length - b.length) > maxDistance) return maxDistance + 1;

  const n = a.length;
  const m = b.length;

  // Row `prev[j]` = distance between a[0..i-1] and b[0..j-1].
  let prev = new Array(m + 1);
  for (let j = 0; j <= m; j++) prev[j] = j;

  const curr = new Array(m + 1);

  for (let i = 1; i <= n; i++) {
    curr[0] = i;
    let rowBest = curr[0];

    const ai = a.charCodeAt(i - 1);
    for (let j = 1; j <= m; j++) {
      const cost = ai === b.charCodeAt(j - 1) ? 0 : 1;
      const del = prev[j] + 1;
      const ins = curr[j - 1] + 1;
      const sub = prev[j - 1] + cost;
      let v = del < ins ? del : ins;
      if (sub < v) v = sub;
      curr[j] = v;
      if (v < rowBest) rowBest = v;
    }

    // Every cell in this row is already ≥ rowBest, and distances never shrink
    // as we add more of `a`, so once the row's minimum exceeds the bound the
    // final answer must too. Early-exit (Requirement 7.1 bound).
    if (rowBest > maxDistance) return maxDistance + 1;

    // Swap rows (reuse arrays to avoid per-row allocation).
    for (let j = 0; j <= m; j++) prev[j] = curr[j];
  }

  return prev[m] <= maxDistance ? prev[m] : maxDistance + 1;
}
