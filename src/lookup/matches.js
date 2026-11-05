// src/lookup/matches.js
//
// Ranked matches for a highlighted selection: the best definition first, then
// the next closest terms, so the lookup panel can step through them with the
// arrow keys when the first one is not the term the reader meant.
//
// `findMatches(index, text)` starts from `query` (the longest exact match, or
// the fuzzy fallback) and then adds, in this order, every other term that is
// close to the selection:
//
//   1. "within"   — terms that appear inside the selection ("apical dendrite
//                   of a pyramidal neuron" → Apical Tuft is not, but
//                   Pyramidal Neuron is), longest first.
//   2. "contains" — terms that contain the selected words as whole words
//                   ("pyramidal" → Pyramidal Neuron, Layer 2/3 Pyramidal Cell),
//                   fewest extra words first.
//   3. "prefix"   — terms with a word that starts with the selected word, or
//                   shares a long stem with it ("dendrit" → Dendrite).
//   4. "fuzzy"    — terms within a small edit distance (typos, plurals).
//
// Words such as "the" or "and" never match on their own, and short words only
// match exactly, so highlighting ordinary words shows no definition. Each match
// is one term with all of its definitions (a term defined twice in
// `terms.json` is one match whose card cycles through both).

import { normalize } from "./trie.js";
import { query } from "./search-index.js";

/**
 * @typedef {import("./search-index.js").SearchIndex} SearchIndex
 * @typedef {import("./search-index.js").Definition} Definition
 * @typedef {import("../content-loader.js").TermEntry} TermEntry
 */

/**
 * One candidate the panel can show.
 *
 * @typedef {Object} Match
 * @property {string} term The canonical term.
 * @property {"exact"|"fuzzy"|"within"|"contains"|"prefix"} matchKind How it
 *   relates to the selection.
 * @property {Definition[]} definitions Every definition of the term.
 */

/** The most matches the panel offers. */
export const MAX_MATCHES = 25;

/**
 * English function words that never resolve on their own. A term whose name
 * is one of these (none today) would still resolve exactly.
 */
export const STOPWORDS = new Set(
  (
    "a an the and or nor but if then else so as at by for from in into of off on onto out over to up " +
    "with without within upon about above after again against all am any are aren't be because been " +
    "before being below between both can can't could did do does doing done down during each few " +
    "further had has have having he her here hers herself him himself his how i i'm is isn't it it's " +
    "its itself just me more most my myself no not now once only other our ours ourselves own same " +
    "she should some such than that that's their theirs them themselves there these they this those " +
    "through too under until very was we were what when where which while who whom why will would " +
    "you your yours yourself yourselves also via per may might must shall one two three first second " +
    "new use used using uses like many much well even still yet thus hence however therefore though " +
    "although whether either neither etc e.g i.e vs let lets get gets got make makes made way ways"
  ).split(" ")
);

/** Characters stripped from the edges of each selected word. */
const EDGE = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;

/**
 * Words of a selection: normalized, edge punctuation removed per word.
 *
 * @param {string} text
 * @returns {string[]}
 */
function words(text) {
  return normalize(text)
    .map((t) => t.replace(EDGE, ""))
    .filter((t) => t !== "");
}

/** A word with a plural ending removed, for loose comparison. */
function stem(word) {
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && /(ches|shes|xes|ses|zes)$/.test(word)) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

/** Whether two words are the same up to a plural ending. */
function sameWord(a, b) {
  return a === b || stem(a) === stem(b);
}

/** The edit distance allowed for a word of this length. */
function allowedDistance(length) {
  if (length <= 3) return 0;
  if (length <= 5) return 1;
  return 2;
}

/** Length of the common prefix of two strings. */
function commonPrefix(a, b) {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  return i;
}

/**
 * Levenshtein distance, giving up (returning `max + 1`) once it must exceed
 * `max`.
 */
function distance(a, b, max) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      curr.push(v);
      if (v < best) best = v;
    }
    if (best > max) return max + 1;
    prev = curr;
  }
  return prev[b.length] <= max ? prev[b.length] : max + 1;
}

/** Surface forms of an entry: term, aliases and acronym. */
function surfaces(entry) {
  const out = [];
  if (typeof entry.term === "string") out.push(entry.term);
  if (Array.isArray(entry.aliases)) for (const a of entry.aliases) if (typeof a === "string") out.push(a);
  if (typeof entry.acronym === "string" && entry.acronym !== "") out.push(entry.acronym);
  return out;
}

/** @type {WeakMap<object, Array<{key: string, words: string[], joined: string}>>} */
const surfaceCache = new WeakMap();

/**
 * Every surface form in the index, with the term it belongs to, built once per
 * index.
 *
 * @param {SearchIndex} index
 */
function allSurfaces(index) {
  const cached = surfaceCache.get(index);
  if (cached) return cached;
  const out = [];
  for (const [key, entries] of index.byTerm ?? []) {
    const seen = new Set();
    for (const entry of entries) {
      for (const s of surfaces(entry)) {
        const w = words(s);
        const joined = w.join(" ");
        if (joined === "" || seen.has(joined)) continue;
        seen.add(joined);
        out.push({ key, words: w, joined });
      }
    }
  }
  surfaceCache.set(index, out);
  return out;
}

/** The grouping key of a canonical term (same as search-index's). */
function termKey(term) {
  return normalize(typeof term === "string" ? term : "").join(" ");
}

/** Shape a term's entries as definitions. */
function toDefinitions(entries) {
  return entries.map((entry) => ({
    term: entry.term,
    definition: entry.definition,
    pageRef: entry.pageRef ?? null,
    acronym: typeof entry.acronym === "string" && entry.acronym !== "" ? entry.acronym : null,
  }));
}

/**
 * Whether `needle` occurs in `hay` as consecutive whole words (plurals
 * allowed).
 */
function containsWords(hay, needle) {
  for (let i = 0; i + needle.length <= hay.length; i++) {
    let ok = true;
    for (let j = 0; j < needle.length; j++) {
      if (!sameWord(hay[i + j], needle[j])) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

/**
 * Rank the terms a selection could mean, closest first.
 *
 * @param {SearchIndex} index The index built by `buildIndex`.
 * @param {string} text The highlighted text.
 * @param {number} [limit] The most matches to return.
 * @returns {Match[]} Empty when nothing is close (and for words like "the").
 */
export function findMatches(index, text, limit = MAX_MATCHES) {
  if (!index || !index.root || typeof text !== "string") return [];
  const sel = words(text);
  if (sel.length === 0) return [];
  const content = sel.filter((w) => !STOPWORDS.has(w));

  /** @type {Map<string, {rank: number[], kind: Match["matchKind"], first?: Definition[]}>} */
  const found = new Map();
  /** Record a candidate term, keeping its best rank. */
  function add(key, kind, rank, first) {
    const prev = found.get(key);
    if (!prev || compare(rank, prev.rank) < 0) found.set(key, { rank, kind, first: first ?? prev?.first });
  }

  // 0. The primary answer: `query`'s exact longest match. Its fuzzy guess is
  //    not taken as is (it allows two typos even in a three-letter word); the
  //    fuzzy step below finds close spellings with a bound that fits the word.
  //    A plural ("FPGAs") or a possessive ("HTM's") of a term counts as exact.
  let primary = query(index, text);
  if (!primary || primary.matchKind !== "exact") {
    const plain = query(index, sel.map((w) => stem(w.replace(/'s$/, ""))).join(" "));
    if (plain && plain.matchKind === "exact") primary = plain;
  }
  // A selection made only of words like "it" resolves only when written the
  // way the term is ("IT" the neuron type, not "it" the pronoun).
  if (primary && primary.matchKind === "exact" && content.length === 0) {
    const raw = text.trim().replace(EDGE, "");
    const forms = (index.byTerm?.get(termKey(primary.term)) ?? []).flatMap(surfaces);
    if (!forms.includes(raw)) primary = null;
  }
  if (primary && primary.matchKind === "exact") {
    add(termKey(primary.term), "exact", [0], primary.definitions);
  }

  if (content.length === 0) return finish(index, found, limit);

  // 1. Terms inside the selection, at any starting word, longest first. The
  //    parts of hyphenated words count too, so "STDP-like" finds STDP.
  const parts = sel.flatMap((w) => w.replace(/'s$/, "").split(/[-\u2013\u2014/]/)).filter((w) => w !== "");
  for (const seq of parts.join(" ") === sel.join(" ") ? [sel] : [sel, parts]) {
  for (let i = 0; i < seq.length; i++) {
    let node = index.root;
    for (let j = i; j < seq.length; j++) {
      node = node.children.get(seq[j]) ?? node.children.get(stem(seq[j]));
      if (!node) break;
      const len = j - i + 1;
      if (node.entry !== null && !(len === 1 && STOPWORDS.has(seq[i]))) {
        for (const entry of node.entries?.length ? node.entries : [node.entry]) {
          add(termKey(entry.term), "within", [1, -len, i]);
        }
      }
    }
  }
  }

  const joinedContent = content.join(" ");
  for (const s of allSurfaces(index)) {
    // 2. Terms containing all the selected words, fewest extra words first.
    if (containsWords(s.words, content)) {
      add(s.key, "contains", [2, s.words.length - content.length, s.joined.length]);
      continue;
    }

    // Single-word checks for the last content word, the head of most phrases.
    const w = content[content.length - 1];
    if (content.length === 1 && w.length >= 4) {
      for (const sw of s.words) {
        // 3. A word of the term starts with the selection, or they share a
        //    long stem ("thalamic" / "thalamus").
        const shared = commonPrefix(w, sw);
        if (
          (sw.startsWith(w) && w.length >= 0.5 * sw.length) ||
          (shared >= 5 && shared >= 0.7 * Math.min(w.length, sw.length))
        ) {
          add(s.key, "prefix", [3, -shared, s.words.length, s.joined.length]);
          break;
        }
      }
    }

    // 4. Close spellings of the whole selection, or of one word of the term.
    const max = allowedDistance(joinedContent.length);
    if (max === 0) continue;
    let d = distance(joinedContent, s.joined, max);
    if (content.length === 1) {
      for (const sw of s.words) d = Math.min(d, distance(joinedContent, sw, max) + (s.words.length > 1 ? 0.5 : 0));
    }
    if (d <= max) add(s.key, "fuzzy", [4, d, s.words.length, s.joined.length]);
  }

  return finish(index, found, limit);
}

/** Lexicographic comparison of rank tuples. */
function compare(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x - y;
  }
  return 0;
}

/** Sort the found terms and shape them as matches. */
function finish(index, found, limit) {
  return [...found.entries()]
    .sort((a, b) => compare(a[1].rank, b[1].rank) || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([key, f]) => {
      const entries = index.byTerm?.get(key) ?? [];
      const definitions = f.first ?? toDefinitions(entries);
      return { term: definitions[0]?.term ?? key, matchKind: f.kind, definitions };
    })
    .filter((m) => m.definitions.length > 0);
}
