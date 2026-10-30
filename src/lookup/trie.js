// src/lookup/trie.js
//
// Token-level term trie (design.md — Low-Level Design: The Lookup Search
// Algorithm → "Data structure: term trie").
//
// Multi-word terms are indexed as sequences of *tokens* (words), not raw
// characters, so "neural network" is the path `neural -> network`. Each trie
// node may carry a terminal `TermEntry`, which makes "longest known term" a
// natural walk down the token path (see `search-index.js` query).
//
// This module owns two things the rest of the lookup system builds on:
//   1. The `TrieNode` structure and a `createTrieNode` factory.
//   2. `insert(root, tokens, entry)` — add a token path with a terminal entry.
//   3. `normalize(text)` — the SHARED normalization used by BOTH index build
//      and query, so matching is case- and whitespace-insensitive and robust to
//      edge punctuation (Requirement 9.3). Indexing and querying must agree on
//      exactly how text becomes tokens, which is why it lives here, once.
//
// Requirements: 4.4 (index each term as a sequence of normalized tokens so
// multi-word terms are reachable by their token path), 9.3 (match on the
// normalized form so matching is case- and whitespace-insensitive).

/**
 * A node in the token-level term trie.
 *
 * @typedef {Object} TrieNode
 * @property {Map<string, TrieNode>} children Child nodes keyed by normalized
 *   token. A missing key means no term continues with that token from here.
 * @property {import("../content-loader.js").TermEntry|null} entry The terminal
 *   `TermEntry` set when some term/alias/acronym ends exactly at this node;
 *   `null` for interior-only nodes.
 */

/**
 * Create an empty trie node. A fresh node has no children and is not terminal.
 *
 * @returns {TrieNode}
 */
export function createTrieNode() {
  return { children: new Map(), entry: null };
}

/**
 * Insert a token path into the trie, marking the final node terminal for the
 * given entry. Walks/creates child nodes token by token, then stamps `entry`
 * on the node reached by the last token. An empty token list is a no-op (there
 * is no path to mark, so nothing is indexed).
 *
 * Re-inserting the same token path simply overwrites the terminal `entry`,
 * which keeps the build idempotent per surface form.
 *
 * @param {TrieNode} root The trie root to insert into.
 * @param {string[]} tokens Normalized tokens (as produced by `normalize`).
 * @param {import("../content-loader.js").TermEntry} entry The term this path
 *   resolves to; stamped on the terminal node.
 * @returns {TrieNode} The terminal node that now carries `entry`, or `root`
 *   when `tokens` is empty.
 */
export function insert(root, tokens, entry) {
  let node = root;
  for (const token of tokens) {
    let next = node.children.get(token);
    if (next === undefined) {
      next = createTrieNode();
      node.children.set(token, next);
    }
    node = next;
  }
  if (tokens.length > 0) {
    node.entry = entry;
  }
  return node;
}

/**
 * Characters stripped from the leading and trailing edges of the whole text
 * before tokenizing: commas, periods, semicolons, colons, exclamation/question
 * marks, straight and curly quotes, parentheses/brackets/braces. These are the
 * punctuation marks that typically cling to a double-clicked word or a
 * highlighted phrase ("neural network." or “SNN”) without being part of the
 * term itself. Interior punctuation (e.g. a hyphen in "leaky-integrate") is
 * left intact — only the edges are trimmed.
 */
const EDGE_PUNCTUATION = `.,;:!?'"\`“”‘’()[]{}`;

/**
 * Escape a string for safe inclusion in a `RegExp` character class.
 * @param {string} s
 * @returns {string}
 */
function escapeForCharClass(s) {
  return s.replace(/[\\\]^-]/g, "\\$&");
}

/**
 * Matches runs of leading or trailing edge punctuation on the whole string.
 * Built once from `EDGE_PUNCTUATION`.
 */
const EDGE_PUNCTUATION_RE = new RegExp(
  `^[${escapeForCharClass(EDGE_PUNCTUATION)}]+|[${escapeForCharClass(EDGE_PUNCTUATION)}]+$`,
  "g",
);

/**
 * Normalize selection/term text into an array of comparison tokens — the SINGLE
 * normalization shared by index build and query so both agree on exactly how
 * text becomes tokens (design.md "Normalization (shared by index and query)").
 *
 * Steps, in order:
 *   1. lowercase          — case-insensitive matching ("SNN" vs "snn")
 *   2. trim               — drop leading/trailing whitespace
 *   3. collapse whitespace — runs of spaces/tabs/newlines become one space
 *   4. strip edge punctuation — remove leading/trailing commas, periods, quotes…
 *   5. split on whitespace — yield the token array
 *
 * Returns an empty array for empty, whitespace-only, or punctuation-only input,
 * which the query layer treats as "no query" (Requirement 4.5).
 *
 * @param {string} text Raw selection or surface-form text.
 * @returns {string[]} The normalized tokens (possibly empty).
 */
export function normalize(text) {
  if (typeof text !== "string") return [];

  let s = text.toLowerCase();
  // Collapse all whitespace runs to single spaces, then trim the edges.
  s = s.replace(/\s+/g, " ").trim();
  // Strip punctuation clinging to the leading/trailing edges of the phrase.
  s = s.replace(EDGE_PUNCTUATION_RE, "").trim();

  if (s === "") return [];
  return s.split(" ");
}
