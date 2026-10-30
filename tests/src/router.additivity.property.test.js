// tests/src/router.additivity.property.test.js
//
// Property-based test for the router's additivity guarantee
// (design.md — Correctness Properties → "Property 4: Additivity of topics").
//
//   Property 4: Additivity of topics
//   **Validates: Requirements 11.1, 1.4**
//
// Adding a TopicNode to the topic tree plus its backing page makes the new
// route resolvable WITHOUT editing any existing node or page (R11.1), and
// because the tree nests to arbitrary depth the new node resolves wherever it
// is attached (R1.4). Concretely, for a random valid topic tree we:
//   - pick a random existing node to be the parent,
//   - append a NEW leaf node (fresh, sibling-unique slug + a `page`) to its
//     children — a pure addition producing treeB from treeA,
// then assert:
//   (a) resolveRoute(treeB, newNodePath) resolves to the new node — its route
//       is now reachable at its depth (R11.1 "resolve the new Route"; R1.4
//       arbitrary-depth nesting);
//   (b) every route that resolved in treeA still resolves identically in treeB
//       (same node identity + pageFile) — the addition changed nothing for
//       existing routes (R11.1 "without any change to existing ... Routes");
//   (c) no existing node or page object was mutated — treeB differs from treeA
//       only by the single appended child (R11.1 "without any change to
//       existing Topic_Nodes or page files").
//
// The generators enforce the TopicNode validation rules so resolveRoute never
// rejects for validation reasons (R11.5: slug matches
// `^[a-z0-9]+(-[a-z0-9]+)*$` and is unique among siblings; R11.3: a leaf
// carries a `page`). That isolates the property to additivity rather than
// validation behavior (covered elsewhere).
//
// fast-check is loaded as an ES module with NO build step, following the
// established convention in
// tests/src/lookup/search-index.longest-match.property.test.js: import the
// module namespace from the jsDelivr ESM CDN and normalize the `fc` handle
// whether the API sits on the namespace or under `default`. Run via
// `node tests/run.js` (Node 18+, with global fetch); to run offline, vendor
// fast-check's ESM build and swap the import specifier, leaving the rest alone.

import { describe, it, expect } from "../harness.js";
import * as fcNS from "https://cdn.jsdelivr.net/npm/fast-check/+esm";
import { resolveRoute, SLUG_PATTERN } from "../../src/router.js";

// fast-check's ESM build exposes its API on the module namespace; some bundles
// also nest it under `default`. Normalize to a single `fc` handle either way.
const fc = fcNS && typeof fcNS.property === "function" ? fcNS : fcNS.default;

/**
 * A generator for a single valid slug segment. Built from a letter/digit
 * arbitrary joined into dash-separated groups so it always matches
 * SLUG_PATTERN (`^[a-z0-9]+(-[a-z0-9]+)*$`): no leading/trailing/double dash,
 * lowercase alphanumerics only. A `filter` backstops the construction so a
 * generated slug is guaranteed valid regardless of fast-check version.
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

/**
 * Deterministically build a random valid topic tree. Rather than fight
 * fast-check's recursive combinators (whose availability varies by version),
 * we drive construction from a finite "budget" of integers the framework
 * supplies, which keeps slug uniqueness among siblings and the leaf-has-page
 * rule as hard invariants of the builder.
 *
 * The result is a ROOT node shaped the way resolveRoute expects: resolution
 * walks `tree.children`, so the root itself is a pure container. Every
 * generated node gets a unique slug among its siblings (a per-parent counter
 * appended to a random base guarantees it), and every leaf carries a `page`.
 * Some non-leaf nodes also carry a `page` (a valid grouping-with-page), which
 * must likewise be preserved across the addition.
 *
 * @param {object} shape
 * @param {string[]} shape.bases      Pool of random slug bases to draw from.
 * @param {number[]} shape.childCounts Random child-count decisions, consumed FIFO.
 * @param {number[]} shape.pageFlags  Random 0/1 flags deciding grouping pages, FIFO.
 * @returns {{root: import("../../src/router.js").TopicNode, nodes: Array<{node: any, path: string[]}>}}
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

  /** @type {Array<{node: any, path: string[]}>} */
  const nodes = [];

  // Build children for a node at `path`, down to `remainingDepth` levels. A
  // per-call counter appended to each child's base slug guarantees sibling
  // uniqueness without any post-hoc de-duping.
  function makeChildren(path, remainingDepth) {
    // 1..3 children at this level (clamped from the random budget).
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
      const node = {
        slug,
        title: `Title ${childPath.join("/")}`,
      };

      if (makeLeaf) {
        // Leaf: MUST carry a page (R11.3) so resolveRoute accepts it.
        node.page = `content/pages/${childPath.join("/")}.json`;
      } else {
        // Grouping: recurse. Some groupings also carry their own page.
        node.children = makeChildren(childPath, remainingDepth - 1);
        if (nextFlag() === 1) {
          node.page = `content/pages/${childPath.join("/")}.json`;
        }
      }

      children.push(node);
      nodes.push({ node, path: childPath });
    }
    return children;
  }

  const root = {
    slug: "__root__",
    title: "Library of Alexandria",
    children: makeChildren([], 3), // up to 4 levels deep => exercises R1.4
  };

  return { root, nodes };
}

/**
 * Arbitrary producing a random valid tree plus the pools needed to build it.
 * `bases` are validated slugs; the numeric arrays are consumed as a budget by
 * buildTree. Separating the random "shape" from the pure builder keeps slug
 * uniqueness and the leaf-page rule as builder invariants.
 */
const treeShapeArb = fc.record({
  bases: fc.array(slugArb, { minLength: 3, maxLength: 10 }),
  childCounts: fc.array(fc.nat(), { minLength: 4, maxLength: 20 }),
  pageFlags: fc.array(fc.nat(), { minLength: 4, maxLength: 20 }).map((xs) => xs.map((x) => x % 2)),
});

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
  })(root.children, []);
  return out;
}

/**
 * Structural fingerprint of a tree, independent of object identity, so we can
 * assert treeB differs from treeA ONLY by the appended child (no existing node
 * or page mutated). Captures slug, title, page, and child order recursively.
 *
 * @param {any} node
 * @returns {string}
 */
function fingerprint(node) {
  const kids = Array.isArray(node.children) ? node.children.map(fingerprint) : null;
  return JSON.stringify({
    slug: node.slug,
    title: node.title,
    page: node.page ?? null,
    children: kids,
  });
}

/**
 * A resolution identity used to compare "did this route resolve to the same
 * thing before and after the addition". We compare node identity (same object
 * reference) and the resolved pageFile — both must be unchanged for existing
 * routes. Home/null resolutions compare by a sentinel.
 *
 * @param {import("../../src/router.js").RouteResolution | null} r
 */
function resolutionIdentity(r) {
  if (r === null) return { kind: "null" };
  return { kind: "ok", node: r.node, pageFile: r.pageFile ?? null };
}

describe("router additivity (Property 4) \u2014 Validates: Requirements 11.1, 1.4", () => {
  it("adding a node + its page makes the new route resolvable without changing existing routes or nodes", () => {
    fc.assert(
      fc.property(treeShapeArb, fc.nat(), slugArb, (shape, parentPick, newBase) => {
        // ---- treeA: a random valid tree (the "before" state). ----
        const { root: treeA, nodes } = buildTree(shape);

        // All existing routes and a fingerprint of the untouched tree.
        const existingPaths = enumeratePaths(treeA);
        const fingerprintBefore = fingerprint(treeA);

        // Resolve every existing route against treeA up front; these are the
        // identities that must survive the addition unchanged.
        const beforeResolutions = existingPaths.map((p) => ({
          path: p,
          id: resolutionIdentity(resolveRoute(treeA, p)),
        }));

        // ---- Pick a parent. The root (so the new node is a top-level topic)
        // OR any existing node (so the new node nests at that node's depth+1,
        // exercising arbitrary-depth additivity, R1.4). ----
        const candidates = [{ node: treeA, path: [] }, ...nodes];
        const parent = candidates[parentPick % candidates.length];

        // A fresh slug that does NOT collide with the parent's existing
        // children (R11.5 sibling uniqueness). Append a marker + a counter if
        // needed so the new slug is guaranteed unique while still matching the
        // slug pattern.
        const parentHadChildrenArray = Array.isArray(parent.node.children);
        const siblings = parentHadChildrenArray ? parent.node.children : [];
        const existingSlugs = new Set(siblings.map((c) => c.slug));
        let newSlug = `${newBase}-new`;
        let suffix = 0;
        while (existingSlugs.has(newSlug)) {
          newSlug = `${newBase}-new-${suffix++}`;
        }

        const newPath = parent.path.concat(newSlug);
        // The new node is a LEAF carrying its page (a node + its page JSON).
        const newNode = {
          slug: newSlug,
          title: `Title ${newPath.join("/")}`,
          page: `content/pages/${newPath.join("/")}.json`,
        };

        // ---- treeB: treeA with ONLY the new child appended to `parent`. This
        // is a pure addition: we mutate the shared tree by pushing one child.
        // Because the fingerprint-before was captured as a string, we can still
        // prove nothing else changed. ----
        if (!Array.isArray(parent.node.children)) parent.node.children = [];
        parent.node.children.push(newNode);
        const treeB = treeA;

        // (a) The new route now resolves to the new node at its depth (R11.1,
        //     R1.4: nesting to arbitrary depth resolves by joining slugs).
        const newResolution = resolveRoute(treeB, newPath);
        expect(newResolution !== null).toBe(true);
        expect(newResolution.node).toBe(newNode);
        expect(newResolution.pageFile).toBe(newNode.page);
        expect(newResolution.path.join("/")).toBe(newPath.join("/"));
        // The crumb chain ends at the new node (reachable at its full depth).
        expect(newResolution.crumbs[newResolution.crumbs.length - 1]).toBe(newNode);
        expect(newResolution.crumbs.length).toBe(newPath.length);

        // (b) Every previously-resolvable route still resolves identically:
        //     same resolved node object and same pageFile. The addition changed
        //     nothing for existing routes (R11.1).
        for (const { path, id } of beforeResolutions) {
          const after = resolutionIdentity(resolveRoute(treeB, path));
          expect(after.kind).toBe(id.kind);
          if (id.kind === "ok") {
            expect(after.node).toBe(id.node); // same node identity, not mutated
            expect(after.pageFile).toBe(id.pageFile);
          }
        }

        // (c) The addition is purely additive: treeB's fingerprint equals the
        //     before-fingerprint with exactly one new leaf inserted under the
        //     chosen parent. We verify by removing the appended child and
        //     confirming the structure is byte-for-byte the original — proving
        //     no existing node or page object was mutated.
        parent.node.children.pop();
        if (!parentHadChildrenArray) {
          // The parent had no `children` array originally; we created one to
          // append. Restore the original shape so the fingerprint matches the
          // true "before".
          delete parent.node.children;
        }
        expect(fingerprint(treeA)).toBe(fingerprintBefore);
      }),
      { numRuns: 200 },
    );
  });
});
