// tests/src/migrate/split-terms.property.test.js
//
// Feature: glossary-scoped-search, Property 3: Migration conserves every entry
// Feature: glossary-scoped-search, Property 8: Migration is deterministic
//
// Property-based tests for the one-time migration that splits the single
// `content/terms.json` into one Glossary_File per Top_Level_Topic plus a
// Manifest (design.md — "Migration script design", R3; Correctness Properties
// → Property 3 and Property 8).
//
//   Property 3: Migration conserves every entry exactly
//   **Validates: Requirements 3.8, 3.9, 3.12, 12.6**
//
//   For any input `terms.json` array, the multiset union of entries across all
//   Glossary_Files the migration writes equals the input multiset: the total
//   count is preserved, every entry appears exactly once, and each entry's
//   `term`, `aliases`, `acronym`, `definition`, and `pageRef` fields are
//   byte-for-byte identical to the input (no field added, removed, reordered,
//   or retyped).
//
//   Property 8: Migration is deterministic
//   **Validates: Requirements 3.10**
//
//   For any fixed input (`terms.json`, `topics.json`, page text), running the
//   migration twice produces byte-identical Glossary_Files, Manifest, and
//   change summary.
//
// **Validates: Requirements 3.8, 3.9, 3.12, 3.10, 12.6**
//
// Strategy. The migration's write step (`writeGlossaries`) is the only part
// that touches disk; everything upstream is pure and injectable. These tests
// drive the exact pipeline `main()` runs — `classifyAll({ terms, tree,
// readPage })` → `buildGlossaries` → serialize — but feed it generated inputs
// in memory and compare the *bytes* that would be written via the same
// `serializeGlossary` / `serializeManifest` the script uses to write files, so
// "byte-for-byte" and "byte-identical" are tested against the real serializer
// without going near the filesystem. A generated `readPage` closure stands in
// for `content/pages/**`, so null-`pageRef` mention counting varies across
// runs exactly as it would on real pages.
//
// fast-check is loaded as an ES module with NO build step, matching the sibling
// lookup property tests' convention exactly (design.md — Testing Strategy:
// "fast-check (vanilla JS, no build step needed to run)"; tests/README.md —
// "Loading fast-check"). The module is imported from the jsDelivr ESM CDN so
// that `node tests/run.js` resolves it, and `scripts/hive-test.sh` runs the
// suite with `--import ./tests/net/register.js`, whose hooks load the committed
// copy under `tests/vendor/` so the suite runs offline on a fixed version.

import { describe, it, expect } from "../../harness.js";
import * as fcNS from "https://cdn.jsdelivr.net/npm/fast-check/+esm";
import {
  classifyAll,
  buildGlossaries,
  serializeGlossary,
  serializeManifest,
} from "../../../scripts/migrate/split-terms.js";

// fast-check's ESM build exposes its API on the module namespace; some bundles
// also nest it under `default`. Normalize to a single `fc` handle either way.
const fc = fcNS && typeof fcNS.property === "function" ? fcNS : fcNS.default;

const NUM_RUNS = 200;

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/**
 * A slug: a short lowercase-letter token. Top_Level_Topic slugs are the first
 * route segment of a `pageRef`, so keeping them to `[a-z]` makes the generated
 * `pageRef` routes and the topic tree line up without normalization surprises.
 */
const letterArb = fc.integer({ min: 97, max: 122 }).map((c) => String.fromCharCode(c));
const slugArb = fc
  .array(letterArb, { minLength: 2, maxLength: 6 })
  .map((chars) => chars.join(""));

/**
 * A non-empty SET of distinct Top_Level_Topic slugs — the direct children of
 * the generated topic tree's root. De-duping guarantees each slug maps to one
 * top-level subtree, so classification by first route segment is unambiguous.
 */
const slugSetArb = fc
  .array(slugArb, { minLength: 1, maxLength: 5 })
  .map((slugs) => [...new Set(slugs)])
  .filter((slugs) => slugs.length >= 1);

/**
 * A short free-text string for `term` / `definition` / alias values. Includes
 * spaces and mixed case so the byte-for-byte checks exercise non-trivial
 * values, and so whole-word mention counting over generated page text is a real
 * (not vacuous) classification path for null-`pageRef` entries.
 */
const wordArb = fc
  .array(fc.integer({ min: 97, max: 122 }), { minLength: 1, maxLength: 7 })
  .map((codes) => codes.map((c) => String.fromCharCode(c)).join(""));
const phraseArb = fc
  .array(wordArb, { minLength: 1, maxLength: 3 })
  .map((words) => words.join(" "));

/**
 * Build a TermEntry generator whose `pageRef` is either null (→ mention-count
 * classification) or `/slug/...` for one of the known top-level slugs (→ first
 * route segment classification).
 *
 * The generated entries model the real `content/terms.json` input space: each
 * carries exactly the five canonical TermEntry fields and nothing else (the
 * loader's runtime-only `source` annotation never reaches disk, so the
 * migration never sees it). To stress Property 3's "no field reordered" clause
 * (R3.9), the five keys are emitted in a RANDOMIZED per-entry order, so a
 * faithful byte-for-byte pass must preserve each entry's own field order rather
 * than normalize to a fixed schema order.
 *
 * @param {string[]} slugs The valid Top_Level_Topic slugs.
 */
function termEntryArb(slugs) {
  const pageRefArb = fc.oneof(
    fc.constant(null),
    fc
      .tuple(
        fc.constantFrom(...slugs),
        fc.array(slugArb, { minLength: 0, maxLength: 2 }),
      )
      .map(([head, rest]) => `/${[head, ...rest].join("/")}`),
  );

  return fc
    .record({
      term: phraseArb,
      aliases: fc.array(phraseArb, { minLength: 0, maxLength: 3 }),
      acronym: fc.oneof(fc.constant(null), wordArb.map((w) => w.toUpperCase())),
      definition: phraseArb,
      pageRef: pageRefArb,
      // Order in which the five canonical keys are written on this entry.
      keyOrder: fc.shuffledSubarray(
        ["term", "aliases", "acronym", "definition", "pageRef"],
        { minLength: 5, maxLength: 5 },
      ),
    })
    .map(({ term, aliases, acronym, definition, pageRef, keyOrder }) => {
      const values = { term, aliases, acronym, definition, pageRef };
      /** @type {Record<string, unknown>} */
      const entry = {};
      for (const key of keyOrder) entry[key] = values[key];
      return entry;
    });
}

/**
 * A full generated input: a set of top-level slugs, a topic tree whose root
 * children are those slugs (each with a single `page` file reference so the
 * reader is exercised), a `terms` array, and a page-text map keyed by the
 * page file path. The returned `readPage(relPath)` closure returns a minimal
 * PageContent whose `intro` is the slug's page text, so null-`pageRef` entries
 * classify by whole-word mentions over that text — deterministically.
 */
const inputArb = slugSetArb.chain((slugs) =>
  fc
    .record({
      terms: fc.array(termEntryArb(slugs), { minLength: 0, maxLength: 20 }),
      // Page text per top-level slug: a bag of words, some of which may be
      // surface forms of null-pageRef terms, so mention counting is non-trivial.
      pageWords: fc.array(
        fc.array(wordArb, { minLength: 0, maxLength: 8 }).map((w) => w.join(" ")),
        { minLength: slugs.length, maxLength: slugs.length },
      ),
    })
    .map(({ terms, pageWords }) => {
      const pageFileFor = (slug) => `content/pages/${slug}/index.json`;
      const textByFile = new Map();
      const children = slugs.map((slug, i) => {
        const page = pageFileFor(slug);
        textByFile.set(page, pageWords[i] ?? "");
        return { slug, title: slug.toUpperCase(), page, children: [] };
      });
      const tree = { slug: "", title: "root", children };
      const readPage = (relPath) => {
        if (!textByFile.has(relPath)) return null;
        return { title: "", intro: textByFile.get(relPath), blocks: [] };
      };
      return { slugs, tree, terms, readPage };
    }),
);

// ---------------------------------------------------------------------------
// Helpers shared by both properties
// ---------------------------------------------------------------------------

/**
 * Run the migration's pure pipeline on one generated input, returning the
 * ordered Glossary_File records (as `buildGlossaries` produces them) and the
 * serialized bytes the script would write for each file and the Manifest.
 * @param {{ tree: object, terms: object[], readPage: (p: string) => object|null }} input
 */
function runPipeline(input) {
  const classified = classifyAll({
    terms: input.terms,
    tree: input.tree,
    readPage: input.readPage,
  });
  const glossaries = buildGlossaries(classified);
  const files = glossaries.map(({ scope, file, entries }) => ({
    scope,
    file,
    count: entries.length,
    bytes: serializeGlossary(entries),
  }));
  const manifestBytes = serializeManifest(glossaries);
  return { glossaries, files, manifestBytes, classified };
}

/**
 * A deterministic, human-readable change summary derived from the same pure
 * pipeline the script uses (design.md §Step 6: per-topic counts, null-`pageRef`
 * ties, zero-mention `_root` terms, conservation result). Reproduced here so
 * Property 8 can assert the SUMMARY is byte-identical across runs too, matching
 * R3.10's "byte-identical ... change summary". It reads only deterministic
 * fields of the pipeline output, so two runs on the same input yield the same
 * string by construction of the pipeline — which is exactly the property.
 * @param {ReturnType<typeof runPipeline>} run
 * @param {number} inputCount The `terms.json` entry count.
 */
function changeSummary(run, inputCount) {
  const total = run.files.reduce((n, f) => n + f.count, 0);
  const lines = [];
  for (const f of run.files) lines.push(`${f.scope}\t${f.count}\t${f.file}`);
  const ties = [];
  const zero = [];
  for (const { entry, classification } of run.classified.entries) {
    if (classification.tied) {
      ties.push(`${entry.term} :: ${classification.tiedSlugs.join(",")}`);
    }
    if (classification.reason === "zero-mentions") zero.push(entry.term);
  }
  lines.push(`ties\t${ties.join(" | ")}`);
  lines.push(`zero-mentions\t${zero.join(" | ")}`);
  lines.push(`conservation\t${total}==${inputCount}\t${total === inputCount}`);
  return `${lines.join("\n")}\n`;
}

/**
 * The byte-for-byte identity key of a TermEntry's FIVE canonical fields, in the
 * entry's own key order, excluding any extra field. Two entries share this key
 * iff their `term`, `aliases`, `acronym`, `definition`, `pageRef` are identical
 * in value AND in written order — i.e. they serialize identically within a
 * Glossary_File. Used to compare the output multiset to the input multiset.
 * @param {Record<string, unknown>} entry
 */
function fiveFieldKey(entry) {
  const five = new Set(["term", "aliases", "acronym", "definition", "pageRef"]);
  const ordered = {};
  for (const key of Object.keys(entry)) {
    if (five.has(key)) ordered[key] = entry[key];
  }
  return JSON.stringify(ordered);
}

/** Count occurrences of each key into a Map (a multiset). */
function multiset(keys) {
  const m = new Map();
  for (const k of keys) m.set(k, (m.get(k) ?? 0) + 1);
  return m;
}

/** Deep multiset equality by key counts. */
function multisetsEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const [k, n] of a) if (b.get(k) !== n) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Property 3 — Migration conserves every entry exactly
// ---------------------------------------------------------------------------

describe(
  "split-terms migration conservation (Property 3) \u2014 Validates: Requirements 3.8, 3.9, 3.12, 12.6",
  () => {
    it("writes every entry exactly once with its five fields byte-for-byte identical", () => {
      fc.assert(
        fc.property(inputArb, (input) => {
          const run = runPipeline(input);

          // Flatten every written entry across all Glossary_Files, in file +
          // source order.
          const written = run.glossaries.flatMap((g) => g.entries);

          // (a) Total count preserved (R3.12 / Property 3 "total count"): the
          // number of entries written equals the input count.
          expect(written.length).toBe(input.terms.length);

          // (b) No field added or removed (R3.9 "adding, removing ... no
          // field"): every written entry carries exactly the five canonical
          // keys — never fewer (nothing dropped) and never more (nothing
          // introduced, in particular no runtime-only `source`).
          const canonical = ["term", "aliases", "acronym", "definition", "pageRef"];
          const allowed = new Set(canonical);
          for (const entry of written) {
            const keys = Object.keys(entry);
            expect(keys.length).toBe(canonical.length);
            for (const key of keys) {
              expect(allowed.has(key)).toBe(true);
            }
          }

          // (c) Multiset union across files == input multiset, keyed by the
          // byte-for-byte identity of the five fields in written order (R3.8,
          // R3.9, Property 3 "every entry appears exactly once ... byte-for-byte
          // identical"). The input key strips any extra field so it compares on
          // the five fields the migration is required to preserve.
          const inputKeys = input.terms.map(fiveFieldKey);
          const writtenKeys = written.map(fiveFieldKey);
          expect(multisetsEqual(multiset(inputKeys), multiset(writtenKeys))).toBe(true);

          // (d) pageRef copied verbatim (R3.8): the exact string/null values,
          // as a multiset, survive unchanged. (Subsumed by (c), asserted
          // directly as a focused guard on the `pageRef`-specific requirement.)
          const inPageRefs = multiset(input.terms.map((e) => JSON.stringify(e.pageRef)));
          const outPageRefs = multiset(written.map((e) => JSON.stringify(e.pageRef)));
          expect(multisetsEqual(inPageRefs, outPageRefs)).toBe(true);
        }),
        { numRuns: NUM_RUNS },
      );
    });

    it("places each entry in exactly one Glossary_File (no entry stored twice)", () => {
      fc.assert(
        fc.property(inputArb, (input) => {
          const run = runPipeline(input);

          // Summing per-file counts equals the single flattened count, which
          // equals the input count: no entry is duplicated across files and
          // none is dropped (R3.12, Property 3 "exactly once").
          const perFileTotal = run.files.reduce((n, f) => n + f.count, 0);
          expect(perFileTotal).toBe(input.terms.length);

          // `_root` (scope "/") is always present even when empty, so an
          // all-`_root` or empty input still yields a well-formed file set.
          const hasRoot = run.files.some((f) => f.scope === "/");
          expect(hasRoot).toBe(true);
        }),
        { numRuns: NUM_RUNS },
      );
    });
  },
);

// ---------------------------------------------------------------------------
// Property 8 — Migration is deterministic
// ---------------------------------------------------------------------------

describe(
  "split-terms migration determinism (Property 8) \u2014 Validates: Requirements 3.10",
  () => {
    it("produces byte-identical Glossary_Files, Manifest, and change summary on a re-run", () => {
      fc.assert(
        fc.property(inputArb, (input) => {
          const first = runPipeline(input);
          const second = runPipeline(input);

          // Same ordered set of files (scope + path), in the same Manifest
          // order (`/` first, then slugs ascending — R3.10).
          expect(first.files.length).toBe(second.files.length);
          for (let i = 0; i < first.files.length; i++) {
            expect(first.files[i].scope).toBe(second.files[i].scope);
            expect(first.files[i].file).toBe(second.files[i].file);
            // Byte-identical Glossary_File contents (R3.10 "byte-identical
            // Glossary_Files").
            expect(first.files[i].bytes).toBe(second.files[i].bytes);
          }

          // Byte-identical Manifest (R3.10 "byte-identical ... Manifest").
          expect(first.manifestBytes).toBe(second.manifestBytes);

          // Byte-identical change summary (R3.10 "byte-identical ... change
          // summary"), derived from the same deterministic pipeline fields.
          const s1 = changeSummary(first, input.terms.length);
          const s2 = changeSummary(second, input.terms.length);
          expect(s1).toBe(s2);
        }),
        { numRuns: NUM_RUNS },
      );
    });
  },
);
