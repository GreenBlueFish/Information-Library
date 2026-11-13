// scripts/migrate/split-terms.js
//
// One-time migration (design.md — "Migration script design", R3).
//
// Splits the single `content/terms.json` (1,874 TermEntry records) into one
// Glossary_File per Top_Level_Topic under a new `content/terms/` folder whose
// paths mirror topic routes, plus a Manifest (`content/terms/index.json`). The
// schema and every field value are preserved byte-for-byte; only the grouping
// into files is new.
//
// No dependencies. Run with `node scripts/migrate/split-terms.js` from the
// repo root (`Information-Library/`). The script reads page JSON under
// `content/pages/**` READ-ONLY and never writes Protected_Content
// (`content/topics.json`, `content/pages/**`, `assets/figures/**`).
//
// This file covers Algorithm steps 1–6: load the inputs, classify each
// TermEntry to a Top_Level_Topic, group the entries into Glossary_Files and
// write them plus the Manifest (`content/terms/index.json`) with the entries
// preserved byte-for-byte, then run the conservation check and emit the
// human-readable change summary. The script NEVER deletes `content/terms.json`
// (deletion is gated to a later, human-reviewed task, R3.14).
//
// Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11,
// 3.12, 3.13, 1.1, 1.2, 1.3, 2.1, 2.3, 2.4, 2.5.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Repo root (`Information-Library/`), one level up from `scripts/migrate/`. */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Canonical input paths, relative to the repo root. */
export const TERMS_PATH = "content/terms.json";
export const TOPICS_PATH = "content/topics.json";

/** The Glossary_File for the `/` scope (Path_Rule). */
export const ROOT_SCOPE = "/";
export const ROOT_FILE = "content/terms/_root.json";

/** The new glossary folder and the Manifest within it. */
export const TERMS_DIR = "content/terms";
export const MANIFEST_PATH = "content/terms/index.json";

// ---------------------------------------------------------------------------
// Step 1 — Load inputs
// ---------------------------------------------------------------------------

/**
 * Read and parse a JSON file under the repo root.
 * @param {string} relPath Path relative to {@link REPO_ROOT}.
 * @returns {unknown}
 */
function readJson(relPath) {
  return JSON.parse(readFileSync(resolve(REPO_ROOT, relPath), "utf8"));
}

/**
 * Load `content/terms.json` as the flat TermEntry array (R3.1).
 * @returns {Array<object>} The parsed TermEntry records, in source order.
 */
export function loadTerms() {
  const terms = readJson(TERMS_PATH);
  if (!Array.isArray(terms)) {
    throw new Error(`${TERMS_PATH} did not parse as an array of TermEntry records.`);
  }
  return terms;
}

/**
 * Load `content/topics.json` as the root topic tree.
 * @returns {object} The root node (its `children` are the Top_Level_Topics).
 */
export function loadTopics() {
  return readJson(TOPICS_PATH);
}

/**
 * The Top_Level_Topics of the tree: the direct children of the root, in tree
 * order. Each is `{ slug, title, node }` where `slug` is the first route
 * segment and `title` is used by later steps for the change summary / Manifest.
 * @param {object} tree The root topic tree.
 * @returns {Array<{ slug: string, title: string, node: object }>}
 */
export function topLevelTopics(tree) {
  const children = Array.isArray(tree?.children) ? tree.children : [];
  return children
    .filter((c) => c && typeof c.slug === "string")
    .map((c) => ({ slug: c.slug, title: typeof c.title === "string" ? c.title : c.slug, node: c }));
}

/**
 * Collect the readable page text for every Top_Level_Topic's subtree, used to
 * count whole-word mentions of null-`pageRef` terms (R3.3).
 *
 * For each top-level topic we walk its subtree, read each node's `page` JSON
 * (read-only, R3.7), extract the §3.2 block fields (excluding `code` blocks),
 * whitespace-normalize, and case-fold. Text is cached per page file so a node
 * referenced twice contributes once per distinct file.
 *
 * @param {object} tree The root topic tree.
 * @param {(relPath: string) => (object|null)} [readPage] Injectable page reader
 *   for tests; defaults to reading the on-disk JSON. Returns `null` when the
 *   file is missing or unreadable.
 * @returns {Map<string, string>} Map of top-level slug → lowercased,
 *   whitespace-normalized concatenated page text for that subtree.
 */
export function collectTopicText(tree, readPage = defaultReadPage) {
  /** @type {Map<string, string>} */
  const byTopic = new Map();
  const seenFiles = new Set();

  for (const { slug, node } of topLevelTopics(tree)) {
    const parts = [];
    walkPages(node, (pageFile) => {
      if (seenFiles.has(pageFile)) return;
      seenFiles.add(pageFile);
      const page = readPage(pageFile);
      if (page) parts.push(pageText(page));
    });
    byTopic.set(slug, normalizeText(parts.join(" ")).toLowerCase());
  }
  return byTopic;
}

/**
 * Default page reader: parse the page JSON under the repo root, returning
 * `null` on any read/parse failure so a bad page never aborts the migration.
 * @param {string} relPath
 * @returns {object|null}
 */
function defaultReadPage(relPath) {
  try {
    const page = JSON.parse(readFileSync(resolve(REPO_ROOT, relPath), "utf8"));
    return page && typeof page === "object" ? page : null;
  } catch {
    return null;
  }
}

/**
 * Visit every `page` file reference in a topic subtree (depth-first, tree
 * order), invoking `visit(pageFile)` for each non-empty `page` string.
 * @param {object} node A topic node.
 * @param {(pageFile: string) => void} visit
 */
function walkPages(node, visit) {
  if (!node || typeof node !== "object") return;
  if (typeof node.page === "string" && node.page.length > 0) visit(node.page);
  const children = Array.isArray(node.children) ? node.children : [];
  for (const child of children) walkPages(child, visit);
}

// ---------------------------------------------------------------------------
// Page text extraction (PROJECT_GUIDE §3.2 block fields; `code` excluded)
// ---------------------------------------------------------------------------

/**
 * Extract the readable text of a PageContent document from the §3.2 block
 * fields, excluding `code` blocks. Fields pulled, per the design:
 *   - page `title`, `intro`
 *   - `prose.text`, `heading.text`, `list.items`, `callout.text`
 *   - `problem.title/text/hint/solution/answer`
 *   - `figure.caption`, `math.caption`
 * The returned string is a space-joined concatenation, not yet normalized.
 * @param {object} page
 * @returns {string}
 */
export function pageText(page) {
  const parts = [];
  if (typeof page?.title === "string") parts.push(page.title);
  if (typeof page?.intro === "string") parts.push(page.intro);

  const blocks = Array.isArray(page?.blocks) ? page.blocks : [];
  for (const block of blocks) {
    if (!block || typeof block !== "object") continue;
    switch (block.type) {
      case "code":
        // Excluded by design — never contributes to mention counts.
        break;
      case "prose":
      case "heading":
      case "callout":
        pushString(parts, block.text);
        break;
      case "list":
        if (Array.isArray(block.items)) {
          for (const item of block.items) pushString(parts, item);
        }
        break;
      case "problem":
        pushString(parts, block.title);
        pushString(parts, block.text);
        pushString(parts, block.hint);
        if (Array.isArray(block.solution)) {
          for (const s of block.solution) pushString(parts, s);
        } else {
          pushString(parts, block.solution);
        }
        pushString(parts, block.answer);
        break;
      case "figure":
        pushString(parts, block.caption);
        break;
      case "math":
        pushString(parts, block.caption);
        break;
      default:
        // widget and any unknown block type contribute no readable text.
        break;
    }
  }
  return parts.join(" ");
}

/** Push `value` onto `parts` when it is a non-empty string. */
function pushString(parts, value) {
  if (typeof value === "string" && value.length > 0) parts.push(value);
}

/** Collapse all runs of whitespace to a single space and trim. */
export function normalizeText(text) {
  return String(text).replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Step 2 — Classify each entry to a Top_Level_Topic
// ---------------------------------------------------------------------------

/**
 * The first route segment of a `pageRef` route, i.e. its Top_Level_Topic slug.
 * `/analog-design/noise/noise-basics` → `analog-design`. Returns `null` when
 * the ref is null/empty or has no first segment.
 * @param {string|null} pageRef
 * @returns {string|null}
 */
export function firstRouteSegment(pageRef) {
  if (typeof pageRef !== "string") return null;
  const trimmed = pageRef.trim();
  if (trimmed === "" || trimmed === "/") return null;
  const segments = trimmed.replace(/^\//, "").split("/").filter((s) => s.length > 0);
  return segments.length > 0 ? segments[0] : null;
}

/**
 * The surface forms counted for a term: its `term`, each `alias`, and its
 * `acronym`, filtered to non-empty strings and de-duplicated case-insensitively
 * so a form that appears as both term and alias is not double-counted.
 * @param {object} entry A TermEntry.
 * @returns {string[]} The distinct surface forms (original casing of the first
 *   occurrence, order: term, aliases, acronym).
 */
export function surfaceForms(entry) {
  const raw = [];
  if (typeof entry?.term === "string") raw.push(entry.term);
  if (Array.isArray(entry?.aliases)) {
    for (const a of entry.aliases) if (typeof a === "string") raw.push(a);
  }
  if (typeof entry?.acronym === "string") raw.push(entry.acronym);

  const seen = new Set();
  const forms = [];
  for (const form of raw) {
    const trimmed = form.trim();
    if (trimmed === "") continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    forms.push(trimmed);
  }
  return forms;
}

/** Escape a string for safe use as a literal inside a RegExp. */
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Count whole-word, case-insensitive mentions of any of `forms` in the
 * already-lowercased, whitespace-normalized `haystack`. A "whole word" is
 * bounded by a non-word character or string edge on each side, matching the
 * fixed regex the design specifies so counts are reproducible (R3.3, R3.10).
 * Overlapping forms are counted independently (each form scanned on its own).
 * @param {string} haystack Lowercased, normalized page text.
 * @param {string[]} forms Surface forms (any casing; folded here).
 * @returns {number}
 */
export function countMentions(haystack, forms) {
  if (!haystack) return 0;
  let total = 0;
  for (const form of forms) {
    const needle = normalizeText(form).toLowerCase();
    if (needle === "") continue;
    const re = new RegExp(`(?<![\\w])${escapeRegExp(needle)}(?![\\w])`, "g");
    const matches = haystack.match(re);
    if (matches) total += matches.length;
  }
  return total;
}

/**
 * Pick the winning Top_Level_Topic from a map of slug → mention count.
 *
 * Applies the tie rule: the topic whose first route segment (its slug) sorts
 * first in case-insensitive ascending order wins among those with the maximum
 * count (R3.4). Returns the winning slug and whether a tie occurred among a
 * positive maximum (for the change summary), or `null` when every count is
 * zero (the zero-mention case → `_root`, R3.5).
 *
 * @param {Map<string, number>} counts slug → mention count.
 * @returns {{ slug: string, tied: boolean, tiedSlugs: string[] } | null}
 */
export function pickTopTopic(counts) {
  let max = 0;
  for (const n of counts.values()) if (n > max) max = n;
  if (max === 0) return null;

  const winners = [];
  for (const [slug, n] of counts) if (n === max) winners.push(slug);
  winners.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

  return { slug: winners[0], tied: winners.length > 1, tiedSlugs: winners };
}

/**
 * Classify one TermEntry to a Top_Level_Topic slug, or `null` for `_root`.
 *
 * Rules (R3.2–R3.5):
 *   - non-null `pageRef` → the first route segment of that route.
 *   - `pageRef === null` → the top-level topic whose subtree has the most
 *     whole-word, case-insensitive mentions of the entry's surface forms; ties
 *     broken by slug ascending; zero mentions anywhere → `_root`.
 *
 * @param {object} entry A TermEntry.
 * @param {Map<string, string>} topicText slug → lowercased normalized subtree
 *   text (from {@link collectTopicText}).
 * @param {Set<string>} validSlugs The set of Top_Level_Topic slugs.
 * @returns {{
 *   slug: string | null,          // null ⇒ _root
 *   reason: "pageRef" | "mentions" | "zero-mentions",
 *   tied: boolean,                 // a positive-count tie was broken
 *   tiedSlugs: string[],           // the tied slugs when `tied`
 *   counts: Record<string, number> // per-topic counts (mentions case only)
 * }}
 */
export function classifyEntry(entry, topicText, validSlugs) {
  if (entry?.pageRef !== null && entry?.pageRef !== undefined) {
    const slug = firstRouteSegment(entry.pageRef);
    // A non-null pageRef always routes by its first segment (R3.2). The segment
    // is expected to be a real top-level topic; if somehow absent, fall through
    // to _root so no entry is dropped.
    if (slug && validSlugs.has(slug)) {
      return { slug, reason: "pageRef", tied: false, tiedSlugs: [], counts: {} };
    }
    return { slug: null, reason: "pageRef", tied: false, tiedSlugs: [], counts: {} };
  }

  // null pageRef → mention counting across every top-level subtree.
  const forms = surfaceForms(entry);
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const slug of validSlugs) {
    counts.set(slug, countMentions(topicText.get(slug) ?? "", forms));
  }

  const winner = pickTopTopic(counts);
  const countsObj = Object.fromEntries(counts);
  if (!winner) {
    return { slug: null, reason: "zero-mentions", tied: false, tiedSlugs: [], counts: countsObj };
  }
  return {
    slug: winner.slug,
    reason: "mentions",
    tied: winner.tied,
    tiedSlugs: winner.tiedSlugs,
    counts: countsObj,
  };
}

/**
 * Classify every TermEntry, preserving source order (R3.10). Returns one
 * classification per entry, carrying the original entry so later steps can
 * write it byte-for-byte.
 *
 * @param {object} [options]
 * @param {Array<object>} [options.terms] TermEntry records; defaults to
 *   {@link loadTerms}.
 * @param {object} [options.tree] Root topic tree; defaults to {@link loadTopics}.
 * @param {(relPath: string) => (object|null)} [options.readPage] Page reader;
 *   defaults to reading on-disk JSON.
 * @returns {{
 *   entries: Array<{ entry: object, classification: ReturnType<typeof classifyEntry> }>,
 *   topics: Array<{ slug: string, title: string }>,
 * }}
 */
export function classifyAll(options = {}) {
  const terms = options.terms ?? loadTerms();
  const tree = options.tree ?? loadTopics();
  const readPage = options.readPage ?? defaultReadPage;

  const topics = topLevelTopics(tree).map(({ slug, title }) => ({ slug, title }));
  const validSlugs = new Set(topics.map((t) => t.slug));
  const topicText = collectTopicText(tree, readPage);

  const entries = terms.map((entry) => ({
    entry,
    classification: classifyEntry(entry, topicText, validSlugs),
  }));

  return { entries, topics };
}

// ---------------------------------------------------------------------------
// Step 3 — Group classified entries into Glossary_Files + the Manifest
// ---------------------------------------------------------------------------

/**
 * The scope route for a classified top-level slug: `/<slug>`, or `/` for the
 * `_root` bucket (a null slug) (Path_Rule, R1.1).
 * @param {string|null} slug A Top_Level_Topic slug, or `null` for `_root`.
 * @returns {string}
 */
export function scopeForSlug(slug) {
  return slug ? `/${slug}` : ROOT_SCOPE;
}

/**
 * The Glossary_File path for a classified top-level slug, per the Path_Rule:
 * `/<slug>` → `content/terms/<slug>.json`, `/` → `content/terms/_root.json`
 * (R1.1). Migration only ever classifies to a Top_Level_Topic or `_root`, so a
 * file is always a single segment under `content/terms/`.
 * @param {string|null} slug A Top_Level_Topic slug, or `null` for `_root`.
 * @returns {string}
 */
export function fileForSlug(slug) {
  return slug ? `${TERMS_DIR}/${slug}.json` : ROOT_FILE;
}

/**
 * Group classified entries into the ordered set of Glossary_Files to write
 * (Algorithm step 3). Every entry is placed in exactly one file — its
 * classified Top_Level_Topic, or `_root` for a null slug (R2.1, R2.3) — so an
 * entry is stored at most once per file (R2.4) and each file's `entries` keep
 * `terms.json` source order (R3.10). `_root` and its `/` scope are always
 * present even when empty (per the task), and the output is ordered
 * deterministically: `/` first, then Top_Level_Topics by route segment
 * ascending (R3.10). Senses of one surface word that classified to different
 * topics naturally land in different files (R2.2); several genuinely different
 * senses that classify to the same file remain multiple entries under that one
 * file (R2.5) — the migration never merges or rewrites entries.
 *
 * @param {ReturnType<typeof classifyAll>} classified The `classifyAll` result.
 * @returns {Array<{ scope: string, file: string, entries: object[] }>}
 *   One record per Glossary_File, in Manifest order.
 */
export function buildGlossaries(classified) {
  const { entries } = classified;

  // Preserve source order within every bucket by pushing in iteration order.
  /** @type {Map<string, object[]>} keyed by slug ("" sentinel ⇒ _root). */
  const bySlug = new Map();
  const rootKey = "";
  bySlug.set(rootKey, []); // _root always exists, even if empty.

  for (const { entry, classification } of entries) {
    const key = classification.slug ?? rootKey;
    if (!bySlug.has(key)) bySlug.set(key, []);
    bySlug.get(key).push(entry);
  }

  // Deterministic Manifest order: `/` first, then slugs ascending (R3.10).
  const slugs = [...bySlug.keys()].filter((k) => k !== rootKey);
  slugs.sort((a, b) => a.localeCompare(b));

  const out = [
    { scope: ROOT_SCOPE, file: ROOT_FILE, entries: bySlug.get(rootKey) },
  ];
  for (const slug of slugs) {
    out.push({ scope: scopeForSlug(slug), file: fileForSlug(slug), entries: bySlug.get(slug) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Step 4 — Serialize Glossary_Files + the Manifest (byte-for-byte entries)
// ---------------------------------------------------------------------------

/**
 * Serialize one Glossary_File: the entry array, each entry written with its
 * original fields in their original order, no field added, removed, reordered,
 * or retyped (R3.8, R3.9, R1.6 — no `source` is ever introduced because the
 * entries are written exactly as read). `JSON.stringify(entry, 2)` preserves
 * the parsed key-insertion order, i.e. the `terms.json` source order, so the
 * five fields ride through verbatim and `pageRef` is copied as-is. Output ends
 * with a trailing newline and uses two-space indentation (fixed, R3.10).
 * @param {object[]} entries TermEntry records in source order.
 * @returns {string}
 */
export function serializeGlossary(entries) {
  return `${JSON.stringify(entries, null, 2)}\n`;
}

/**
 * Serialize the Manifest `content/terms/index.json`: `{ glossaries: [...] }`
 * listing every Glossary_File as `{ scope, file }` in Manifest order (R1.3,
 * R3.11). The `scope`/`file` key order is fixed and the whole document is
 * two-space-indented with a trailing newline so re-runs are byte-identical
 * (R3.10).
 * @param {Array<{ scope: string, file: string }>} glossaries Manifest order.
 * @returns {string}
 */
export function serializeManifest(glossaries) {
  const manifest = {
    glossaries: glossaries.map(({ scope, file }) => ({ scope, file })),
  };
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/**
 * Write the Glossary_Files and the Manifest to disk under the repo root.
 * Creates parent directories as needed. Writes nothing outside
 * `content/terms/` and never touches Protected_Content (R3.7). Returns the
 * written file list for the caller's conservation/summary steps.
 * @param {Array<{ scope: string, file: string, entries: object[] }>} glossaries
 * @returns {Array<{ scope: string, file: string, count: number }>}
 */
export function writeGlossaries(glossaries) {
  const written = [];
  for (const { scope, file, entries } of glossaries) {
    const abs = resolve(REPO_ROOT, file);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, serializeGlossary(entries), "utf8");
    written.push({ scope, file, count: entries.length });
  }

  const manifestAbs = resolve(REPO_ROOT, MANIFEST_PATH);
  mkdirSync(dirname(manifestAbs), { recursive: true });
  writeFileSync(manifestAbs, serializeManifest(glossaries), "utf8");

  return written;
}

// ---------------------------------------------------------------------------
// Step 5 — Conservation check (R3.12, R3.13)
// ---------------------------------------------------------------------------

/**
 * Verify that the total number of entries across all written Glossary_Files
 * equals the number of entries in `content/terms.json` (R3.12). This is a pure
 * check so it is directly testable: it neither reads nor writes files.
 *
 * @param {number} sourceCount Entry count in `content/terms.json`.
 * @param {Array<{ file: string, count: number }>} written The per-file entry
 *   counts returned by {@link writeGlossaries} (or {@link buildGlossaries}).
 * @returns {{ ok: boolean, sourceCount: number, writtenTotal: number, difference: number }}
 *   `ok` is true only when the written total equals the source count;
 *   `difference` is `writtenTotal - sourceCount` (0 when conserved).
 */
export function checkConservation(sourceCount, written) {
  let writtenTotal = 0;
  for (const { count } of written) writtenTotal += count;
  return {
    ok: writtenTotal === sourceCount,
    sourceCount,
    writtenTotal,
    difference: writtenTotal - sourceCount,
  };
}

// ---------------------------------------------------------------------------
// Step 6 — Change summary (R3.4, R3.5, R3.6, R3.12)
// ---------------------------------------------------------------------------

/**
 * Build the human-readable change summary data from a classification result,
 * the written-file counts, and the conservation result. Kept pure (returns a
 * plain object) so it is testable without touching the console or the disk; the
 * CLI {@link formatSummary} renders it. Reports, per the design (step 6):
 *   - per-topic (per-file) entry counts, in Manifest order;
 *   - the null-`pageRef` ties that were broken by slug ascending (R3.4);
 *   - the zero-mention terms placed in `_root` for human review (R3.5);
 *   - the conservation result (R3.12).
 *
 * @param {ReturnType<typeof classifyAll>} classified The `classifyAll` result.
 * @param {Array<{ scope: string, file: string, count: number }>} written
 *   Per-file counts (from {@link writeGlossaries}).
 * @param {ReturnType<typeof checkConservation>} conservation
 * @returns {{
 *   perTopic: Array<{ scope: string, file: string, count: number }>,
 *   ties: Array<{ term: string, chosenSlug: string, tiedSlugs: string[] }>,
 *   zeroMentionRootTerms: string[],
 *   conservation: ReturnType<typeof checkConservation>,
 * }}
 */
export function buildChangeSummary(classified, written, conservation) {
  const ties = [];
  const zeroMentionRootTerms = [];

  for (const { entry, classification } of classified.entries) {
    const term = typeof entry?.term === "string" ? entry.term : "";
    if (classification.reason === "mentions" && classification.tied) {
      ties.push({ term, chosenSlug: classification.slug, tiedSlugs: classification.tiedSlugs });
    }
    if (classification.reason === "zero-mentions") {
      zeroMentionRootTerms.push(term);
    }
  }

  return {
    perTopic: written.map(({ scope, file, count }) => ({ scope, file, count })),
    ties,
    zeroMentionRootTerms,
    conservation,
  };
}

/**
 * Render a {@link buildChangeSummary} result as deterministic, human-readable
 * text (R3.10: the summary is byte-identical across runs on the same inputs).
 * @param {ReturnType<typeof buildChangeSummary>} summary
 * @returns {string}
 */
export function formatSummary(summary) {
  const { perTopic, ties, zeroMentionRootTerms, conservation } = summary;
  const lines = [];

  lines.push("Migration change summary");
  lines.push("========================");
  lines.push("");

  lines.push("Per-topic entry counts:");
  for (const { scope, file, count } of perTopic) {
    lines.push(`  ${scope.padEnd(28)} ${String(count).padStart(5)}  ${file}`);
  }
  lines.push("");

  lines.push(`null-pageRef ties broken by slug (${ties.length}):`);
  for (const { term, chosenSlug, tiedSlugs } of ties) {
    lines.push(`  "${term}" → ${chosenSlug}  (tied among: ${tiedSlugs.join(", ")})`);
  }
  lines.push("");

  lines.push(`zero-mention terms → _root (${zeroMentionRootTerms.length}):`);
  for (const term of zeroMentionRootTerms) {
    lines.push(`  "${term}"`);
  }
  lines.push("");

  lines.push("Conservation:");
  lines.push(`  terms.json entries : ${conservation.sourceCount}`);
  lines.push(`  written entries    : ${conservation.writtenTotal}`);
  if (conservation.ok) {
    lines.push("  result             : OK (all entries conserved)");
  } else {
    lines.push(`  result             : MISMATCH (difference ${conservation.difference})`);
  }

  return `${lines.join("\n")}\n`;
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

/**
 * Run the migration end to end (Algorithm steps 1–6): load the inputs,
 * classify every entry, group them into Glossary_Files, write `content/terms/**`
 * plus the Manifest (`content/terms/index.json`), then run the conservation
 * check and print the human-readable change summary.
 *
 * On a conservation MISMATCH (written total ≠ `content/terms.json` count) the
 * run reports the discrepancy and returns a non-zero exit code; the caller maps
 * that onto `process.exitCode` so the process exits non-zero (R3.13). The
 * script NEVER deletes `content/terms.json` — deletion is a separate,
 * human-gated step (R3.14).
 *
 * @returns {number} Process exit code: 0 when all entries are conserved,
 *   1 on a conservation mismatch.
 */
export function main() {
  const classified = classifyAll();
  const { entries, topics } = classified;

  const glossaries = buildGlossaries(classified);
  const written = writeGlossaries(glossaries);

  // Step 5 — conservation check against the terms.json source count (R3.12).
  const conservation = checkConservation(entries.length, written);

  // Step 6 — human-readable change summary (per-topic counts, ties, zero-
  // mention _root terms, and the conservation result).
  const summary = buildChangeSummary(classified, written, conservation);

  console.log(`Loaded ${entries.length} terms across ${topics.length} top-level topics.`);
  console.log(`Wrote ${written.length} Glossary_Files + Manifest (${MANIFEST_PATH}).`);
  console.log("");
  process.stdout.write(formatSummary(summary));

  if (!conservation.ok) {
    console.error(
      `\nConservation check FAILED: wrote ${conservation.writtenTotal} entries but ` +
        `${TERMS_PATH} has ${conservation.sourceCount} ` +
        `(difference ${conservation.difference}). ` +
        `Leaving ${TERMS_PATH} in place and exiting non-zero.`,
    );
    return 1;
  }
  return 0;
}

// Run as a script (not when imported by a test), matching the repo's ESM style.
// A non-zero return (conservation mismatch) sets process.exitCode so the
// process exits non-zero without aborting an in-progress write (R3.13).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
