// tests/src/ingest/additivity.property.test.js
//
// Property-based test for the ingestion Additivity guarantee
// (design.md — Correctness Properties → "Property 1: Additivity").
//
//   Feature: snn-material-ingestion, Property 1
//   **Validates: Requirements 3.4, 6.5, 7.1, 7.5, 8.3**
//
//   Property 1: Additivity
//   *For all* pre-existing routes, the SAME route resolves (against the
//   post-ingestion topic tree) to a node with the SAME slug-path and the SAME
//   `page` as it did before ingestion; and *for all* pre-existing `TermEntry`s,
//   an EQUAL record (deep-equal) is still present in the post-ingestion term
//   set. In other words, an ingestion increment may only ADD nodes/pages and
//   term entries — it may never move, re-page, or drop anything that already
//   existed (R3.4 additive topic nodes, R6.5 additive glossary, R7.1/R7.5
//   nothing old breaks, R8.3 each increment leaves the library valid).
//
// This mirrors the tree builder of tests/src/router.additivity.property.test.js
// (a per-parent counter suffix guarantees sibling-unique slugs; leaves always
// carry a `page` so resolveRoute accepts them) but frames the invariant as an
// INGESTION step rather than a single-node router addition:
//
//   pre-ingestion  = { tree: treeA, terms: termsA }
//   post-ingestion = { tree: treeB, terms: termsB }   where
//       treeB  = treeA with brand-new leaf nodes appended under existing
//                parents (never editing an existing node or its page), and
//       termsB = termsA with brand-new TermEntrys appended (never editing or
//                dropping an existing entry).
//
// A pure `checkAdditivity(pre, post)` returns the list of violations it finds,
// letting the test assert both directions:
//   (a) POSITIVE — a genuinely additive post state yields ZERO violations: every
//       pre route resolves to the same slug-path + page, and every pre term is
//       still present as an equal record;
//   (b) NEGATIVE — if a single existing node's `page` is changed, or a single
//       existing term is removed (or altered), the checker FLAGS it. This is
//       what makes the property a real gate rather than a tautology.
//
// fast-check is loaded as an ES module with NO build step, matching
// tests/src/router.additivity.property.test.js and the sibling ingest tests:
// import the module namespace from the jsDelivr ESM CDN and normalize the `fc`
// handle whether the API sits on the namespace or under `default`.
// resolveRoute + SLUG_PATTERN come from the runtime router so the property is
// checked against real resolution behavior. Run via
// `node --experimental-network-imports tests/run.js`.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "../../harness.js";
import * as fcNS from "https://cdn.jsdelivr.net/npm/fast-check/+esm";
import { resolveRoute, SLUG_PATTERN } from "../../../src/router.js";

// fast-check's ESM build exposes its API on the module namespace; some bundles
// also nest it under `default`. Normalize to a single `fc` handle either way.
const fc = fcNS && typeof fcNS.property === "function" ? fcNS : fcNS.default;

const here = dirname(fileURLToPath(import.meta.url));
// tests/src/ingest -> repo root is three levels up.
const repoRoot = join(here, "..", "..", "..");

// ---------------------------------------------------------------------------
// The property under test: a pure additivity checker.
// ---------------------------------------------------------------------------

/**
 * Enumerate every node path in a built tree (walking `root.children`), i.e. the
 * routes resolveRoute should accept. Returned paths are the slug segments a
 * hash would parse to.
 *
 * @param {any} root
 * @returns {string[][]}
 */
function enumeratePaths(root) {
  /** @type {string[][]} */
  const out = [];
  (function walk(nodes, prefix) {
    for (const n of nodes || []) {
      const path = prefix.concat(n.slug);
      out.push(path);
      if (Array.isArray(n.children)) walk(n.children, path);
    }
  })(root && root.children, []);
  return out;
}

/** Structural deep-equality for plain JSON values (objects/arrays/primitives). */
function deepEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  return ak.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]));
}

/** A stable key for a TermEntry used to find its counterpart in the post set. */
function termKey(entry) {
  return typeof entry.term === "string" ? entry.term : JSON.stringify(entry);
}

/**
 * Pure checker for Property 1 (Additivity). Compares a pre-ingestion state to a
 * post-ingestion state and returns every additivity violation it finds; an
 * empty list means the post state is a valid additive successor of the pre
 * state.
 *
 * It enforces, for every PRE-EXISTING route (a node path that resolved before):
 *   - it still resolves post-ingestion (`route-unresolved`);
 *   - to the same slug-path (`route-path-changed`);
 *   - with the same `page` / pageFile (`route-page-changed`),
 * and, for every PRE-EXISTING term:
 *   - an equal record (deep-equal) is still present post-ingestion
 *     (`term-missing` when no entry shares its key / no equal record exists,
 *      `term-changed` when a same-keyed entry exists but is not deep-equal).
 *
 * Only pre-existing routes/terms are checked — new nodes and new terms added by
 * the increment are free to appear; additivity is one-directional (old ⊆ new).
 *
 * @param {{tree: any, terms: any[]}} pre  Pre-ingestion topic tree + term set.
 * @param {{tree: any, terms: any[]}} post Post-ingestion topic tree + term set.
 * @returns {Array<{kind: string, path?: string[], term?: string}>} Violations; empty when additive.
 */
export function checkAdditivity(pre, post) {
  /** @type {Array<{kind: string, path?: string[], term?: string}>} */
  const violations = [];

  // --- Routes: every pre route must still resolve to the same path + page. ---
  for (const segments of enumeratePaths(pre.tree)) {
    const before = resolveRoute(pre.tree, segments);
    // Only routes that actually resolved pre-ingestion are "pre-existing".
    if (before === null || before.node === null) continue;

    const after = resolveRoute(post.tree, segments);
    if (after === null || after.node === null) {
      violations.push({ kind: "route-unresolved", path: segments });
      continue;
    }
    if (after.path.join("/") !== before.path.join("/")) {
      violations.push({ kind: "route-path-changed", path: segments });
    }
    if ((after.pageFile ?? null) !== (before.pageFile ?? null)) {
      violations.push({ kind: "route-page-changed", path: segments });
    }
  }

  // --- Terms: every pre term must still be present as an equal record. ---
  const postByKey = new Map();
  for (const entry of post.terms || []) {
    const key = termKey(entry);
    if (!postByKey.has(key)) postByKey.set(key, []);
    postByKey.get(key).push(entry);
  }
  for (const entry of pre.terms || []) {
    const key = termKey(entry);
    const candidates = postByKey.get(key);
    if (!candidates || candidates.length === 0) {
      violations.push({ kind: "term-missing", term: key });
      continue;
    }
    if (!candidates.some((c) => deepEqual(c, entry))) {
      violations.push({ kind: "term-changed", term: key });
    }
  }

  return violations;
}

// ---------------------------------------------------------------------------
// Generators for pre/post ingestion scenarios.
// ---------------------------------------------------------------------------

/**
 * A generator for a single valid slug segment, built from letters/digits joined
 * into dash-separated groups so it always matches SLUG_PATTERN. A `filter`
 * backstops the construction regardless of fast-check version.
 */
const slugCharArb = fc
  .integer({ min: 0, max: 35 })
  .map((n) => (n < 26 ? String.fromCharCode(97 + n) : String.fromCharCode(48 + (n - 26))));

const slugGroupArb = fc
  .array(slugCharArb, { minLength: 1, maxLength: 5 })
  .map((chars) => chars.join(""));

const slugArb = fc
  .array(slugGroupArb, { minLength: 1, maxLength: 3 })
  .map((groups) => groups.join("-"))
  .filter((s) => SLUG_PATTERN.test(s));

/** A short non-empty free-text arbitrary for term/definition fields. */
const textArb = fc
  .array(fc.integer({ min: 97, max: 122 }), { minLength: 1, maxLength: 8 })
  .map((codes) => codes.map((c) => String.fromCharCode(c)).join(""));

/**
 * Deterministically build a random VALID topic tree from a finite integer
 * "budget". Sibling slug uniqueness (a per-parent `-N` suffix) and the
 * leaf-has-page rule are hard invariants of the builder, so resolveRoute never
 * rejects a generated node for a validation reason; that isolates the test to
 * additivity. The `nodes` list carries each node with its path and the array it
 * lives in, so the post state can append new siblings.
 *
 * @param {object} shape
 * @param {string[]} shape.bases      Pool of random slug bases.
 * @param {number[]} shape.childCounts Random child-count decisions (FIFO).
 * @param {number[]} shape.pageFlags  Random 0/1 grouping/leaf split flags (FIFO).
 * @returns {{root: any, nodes: Array<{node: any, parentChildren: any[], path: string[]}>}}
 */
function buildTree(shape) {
  const bases = shape.bases.length ? shape.bases : ["topic"];
  let baseCursor = 0;
  let countCursor = 0;
  let flagCursor = 0;

  const nextBase = () => bases[baseCursor++ % bases.length];
  const nextCount = () =>
    shape.childCounts.length ? shape.childCounts[countCursor++ % shape.childCounts.length] : 0;
  const nextFlag = () =>
    shape.pageFlags.length ? shape.pageFlags[flagCursor++ % shape.pageFlags.length] : 0;

  /** @type {Array<{node: any, parentChildren: any[], path: string[]}>} */
  const nodes = [];

  /**
   * @param {string[]} path
   * @param {number} remainingDepth
   * @returns {any[]}
   */
  function makeChildren(path, remainingDepth) {
    const raw = nextCount();
    const count = 1 + (((raw % 3) + 3) % 3); // 1, 2, or 3
    /** @type {any[]} */
    const children = [];

    for (let i = 0; i < count; i++) {
      const slug = `${nextBase()}-${i}`; // `-N` suffix => unique among siblings
      const childPath = path.concat(slug);
      const canHaveChildren = remainingDepth > 0;
      const makeLeaf = !canHaveChildren || nextFlag() === 0;

      /** @type {any} */
      const node = { slug, title: `Title ${childPath.join("/")}` };

      if (makeLeaf) {
        node.page = `content/pages/${childPath.join("/")}.json`;
      } else {
        node.children = makeChildren(childPath, remainingDepth - 1);
        if (nextFlag() === 1) {
          node.page = `content/pages/${childPath.join("/")}.json`;
        }
      }

      children.push(node);
      nodes.push({ node, parentChildren: children, path: childPath });
    }
    return children;
  }

  const root = {
    slug: "root",
    title: "Library of Alexandria",
    children: makeChildren([], 3), // up to 4 levels deep
  };

  return { root, nodes };
}

const treeShapeArb = fc.record({
  bases: fc.array(slugArb, { minLength: 3, maxLength: 10 }),
  childCounts: fc.array(fc.nat(), { minLength: 4, maxLength: 20 }),
  pageFlags: fc.array(fc.nat(), { minLength: 4, maxLength: 20 }).map((xs) => xs.map((x) => x % 2)),
});

/**
 * Build a set of pre-ingestion TermEntrys with distinct `term` keys. Each entry
 * carries the fields a real TermEntry has (term, definition, pageRef, and
 * sometimes aliases/acronym) so deep-equality is a meaningful check.
 *
 * @param {Array<{term: string, def: string, hasAcronym: boolean, hasAliases: boolean}>} specs
 * @returns {any[]}
 */
function buildTerms(specs) {
  /** @type {any[]} */
  const terms = [];
  const seen = new Set();
  specs.forEach((s, i) => {
    // Guarantee a unique `term` key with an index suffix.
    const term = `${s.term}-${i}`;
    if (seen.has(term)) return;
    seen.add(term);
    /** @type {any} */
    const entry = {
      term,
      definition: s.def,
      pageRef: null,
    };
    if (s.hasAcronym) entry.acronym = s.term.toUpperCase();
    if (s.hasAliases) entry.aliases = [`${term} alias`];
    terms.push(entry);
  });
  return terms;
}

const termSpecsArb = fc.array(
  fc.record({
    term: textArb,
    def: textArb,
    hasAcronym: fc.boolean(),
    hasAliases: fc.boolean(),
  }),
  { minLength: 1, maxLength: 8 },
);

/** Deep-clone a plain JSON value so a mutation can't leak between runs. */
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * Produce a genuinely-additive post state from a pre state: append new unique
 * leaf nodes under randomly chosen existing parents, and append new unique
 * TermEntrys. The pre state is deep-cloned first so the pre snapshot used for
 * comparison is never touched by the additions.
 *
 * @param {{root: any, nodes: any[]}} built The built pre tree + node handles.
 * @param {any[]} preTerms The pre term set.
 * @param {number[]} parentPicks FIFO parent-choice budget.
 * @param {string[]} newBases FIFO fresh slug bases for new nodes.
 * @param {Array<{term: string, def: string}>} newTermSpecs Specs for new terms.
 * @returns {{pre: {tree: any, terms: any[]}, post: {tree: any, terms: any[]}}}
 */
function makeScenario(built, preTerms, parentPicks, newBases, newTermSpecs) {
  const preTree = clone(built.root);
  const pre = { tree: preTree, terms: clone(preTerms) };

  // Post starts as an independent clone of pre, then grows.
  const postTree = clone(built.root);
  const postTerms = clone(preTerms);

  // Re-enumerate the post tree so our parent handles point at post nodes.
  /** @type {Array<{node: any, path: string[]}>} */
  const postNodes = [];
  (function collect(siblings, prefix) {
    for (const n of siblings || []) {
      const path = prefix.concat(n.slug);
      postNodes.push({ node: n, path });
      if (Array.isArray(n.children)) collect(n.children, path);
    }
  })(postTree.children, []);

  const candidates = [{ node: postTree, path: [] }, ...postNodes];
  const bases = newBases.length ? newBases : ["added"];

  // Append one fresh leaf per parent pick (at least one addition).
  const additions = Math.max(1, parentPicks.length);
  for (let i = 0; i < additions; i++) {
    const parent = candidates[(parentPicks[i] ?? i) % candidates.length];
    if (!Array.isArray(parent.node.children)) parent.node.children = [];
    const existingSlugs = new Set(parent.node.children.map((c) => c.slug));
    let slug = `${bases[i % bases.length]}-new-${i}`;
    let bump = 0;
    while (existingSlugs.has(slug)) slug = `${bases[i % bases.length]}-new-${i}-${bump++}`;
    const newPath = parent.path.concat(slug);
    parent.node.children.push({
      slug,
      title: `Title ${newPath.join("/")}`,
      page: `content/pages/${newPath.join("/")}.json`,
    });
  }

  // Append fresh terms whose keys cannot collide with any pre term.
  const existingTermKeys = new Set(postTerms.map(termKey));
  newTermSpecs.forEach((s, i) => {
    let term = `added-${s.term}-${i}`;
    let bump = 0;
    while (existingTermKeys.has(term)) term = `added-${s.term}-${i}-${bump++}`;
    existingTermKeys.add(term);
    postTerms.push({ term, definition: s.def, pageRef: null });
  });

  return { pre, post: { tree: postTree, terms: postTerms } };
}

const newTermSpecsArb = fc.array(fc.record({ term: textArb, def: textArb }), {
  minLength: 0,
  maxLength: 5,
});

describe("Ingestion additivity (Property 1) \u2014 Validates: Requirements 3.4, 6.5, 7.1, 7.5, 8.3", () => {
  it("a purely additive increment preserves every pre route (path + page) and every pre term", () => {
    fc.assert(
      fc.property(
        treeShapeArb,
        termSpecsArb,
        fc.array(fc.nat(), { minLength: 1, maxLength: 6 }),
        fc.array(slugArb, { minLength: 1, maxLength: 6 }),
        newTermSpecsArb,
        (shape, termSpecs, parentPicks, newBases, newTermSpecs) => {
          const built = buildTree(shape);
          const preTerms = buildTerms(termSpecs);
          const { pre, post } = makeScenario(built, preTerms, parentPicks, newBases, newTermSpecs);

          // The post state genuinely grew (sanity: additivity is non-trivial).
          expect(enumeratePaths(post.tree).length >= enumeratePaths(pre.tree).length).toBe(true);
          expect(post.terms.length >= pre.terms.length).toBe(true);

          // The invariant: no additivity violations for a purely-additive step.
          const violations = checkAdditivity(pre, post);
          expect(violations).toEqual([]);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("flags a non-additive increment that re-pages an existing node or drops/alters a term", () => {
    fc.assert(
      fc.property(
        treeShapeArb,
        termSpecsArb,
        fc.array(fc.nat(), { minLength: 1, maxLength: 6 }),
        fc.array(slugArb, { minLength: 1, maxLength: 6 }),
        newTermSpecsArb,
        fc.integer({ min: 0, max: 2 }),
        fc.nat(),
        (shape, termSpecs, parentPicks, newBases, newTermSpecs, breakKind, pick) => {
          const built = buildTree(shape);
          const preTerms = buildTerms(termSpecs);
          const { pre, post } = makeScenario(built, preTerms, parentPicks, newBases, newTermSpecs);

          let expectedKinds;
          switch (breakKind) {
            case 0: {
              // Re-page an existing leaf: change the `page` on a pre node that
              // resolves to a pageFile. Find the first such node in post.
              const prePaths = enumeratePaths(pre.tree).filter((p) => {
                const r = resolveRoute(pre.tree, p);
                return r && r.node && r.pageFile;
              });
              if (prePaths.length === 0) return; // nothing re-pageable this run
              const victim = prePaths[pick % prePaths.length];
              // Walk post tree to the same path and mutate its page.
              let siblings = post.tree.children;
              let node = null;
              for (const seg of victim) {
                node = siblings.find((c) => c.slug === seg);
                if (!node) break;
                siblings = Array.isArray(node.children) ? node.children : [];
              }
              if (!node || !node.page) return;
              node.page = `${node.page}#MOVED`;
              expectedKinds = ["route-page-changed"];
              break;
            }
            case 1: {
              // Drop an existing term from the post set.
              if (pre.terms.length === 0) return;
              const victim = pre.terms[pick % pre.terms.length];
              post.terms = post.terms.filter((t) => termKey(t) !== termKey(victim));
              expectedKinds = ["term-missing"];
              break;
            }
            case 2: {
              // Alter an existing term's definition (same key, different record).
              if (pre.terms.length === 0) return;
              const victim = pre.terms[pick % pre.terms.length];
              const target = post.terms.find((t) => termKey(t) === termKey(victim));
              if (!target) return;
              target.definition = `${target.definition} (edited)`;
              expectedKinds = ["term-changed"];
              break;
            }
          }

          const violations = checkAdditivity(pre, post);
          expect(violations.some((v) => expectedKinds.includes(v.kind))).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("accepts a real, additive step over content/topics.json + content/terms.json", () => {
    const tree = JSON.parse(readFileSync(join(repoRoot, "content", "topics.json"), "utf8"));
    const terms = JSON.parse(readFileSync(join(repoRoot, "content", "terms.json"), "utf8"));

    const pre = { tree, terms };

    // Simulate an additive ingestion increment: append a new top-level topic
    // with a leaf page, and a new glossary term. Nothing existing is touched.
    // The slug/term below are intentionally synthetic ("ingest-additivity-
    // probe") so this simulated increment never collides with a topic/term
    // that a real ingestion increment has already landed in the live content
    // files — the point of the check is that appending a BRAND-NEW node + term
    // yields zero additivity violations, not that any particular topic is new.
    const post = {
      tree: {
        ...tree,
        children: [
          ...tree.children,
          {
            slug: "ingest-additivity-probe",
            title: "Ingest Additivity Probe",
            page: "content/pages/neuromorphic-hardware/index.json",
            children: [
              {
                slug: "probe-leaf",
                title: "Probe Leaf",
                page: "content/pages/neuromorphic-hardware/loihi.json",
              },
            ],
          },
        ],
      },
      terms: [
        ...terms,
        {
          term: "Ingest Additivity Probe Term",
          definition: "A synthetic glossary entry used only to exercise the additivity checker against a brand-new, non-colliding term.",
          pageRef: "/ingest-additivity-probe",
        },
      ],
    };

    expect(checkAdditivity(pre, post)).toEqual([]);
  });
});
