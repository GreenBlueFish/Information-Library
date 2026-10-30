// tests/src/ingest/topicnode-schema.property.test.js
//
// Property-based test for TopicNode schema validity
// (design.md — Correctness Properties → "Property 3: TopicNode schema
// validity").
//
//   Feature: snn-material-ingestion, Property 3
//   **Validates: Requirements 3.3**
//
//   Property 3: TopicNode schema validity
//   *For all* nodes in `topics.json`, the node has a non-empty `title`, its
//   `slug` matches `^[a-z0-9]+(-[a-z0-9]+)*$`, its `slug` is unique among its
//   siblings, and if it is a leaf (no `children`) it has a `page`.
//
// The test defines a pure `checkTopicNodeSchema` walker that returns the list
// of problems it finds in a tree, then exercises it two ways:
//   (a) on randomly generated VALID trees (and the real content/topics.json),
//       asserting the walker reports no problems;
//   (b) on randomly generated INVALID trees — a valid tree mutated to inject
//       exactly one of the four violations (empty title, bad slug, duplicate
//       sibling slug, leaf missing `page`) — asserting the walker reports that
//       specific problem.
//
// The root node is a pure container (slug "root") whose OWN slug is not a
// routable segment; following the router (which walks `tree.children`) and the
// existing tests/src/router.additivity.property.test.js convention, slug
// validation is applied to the root's DESCENDANTS, not to the root's own slug.
//
// fast-check is loaded as an ES module with NO build step, matching
// tests/src/router.additivity.property.test.js: import the module namespace
// from the jsDelivr ESM CDN and normalize the `fc` handle whether the API sits
// on the namespace or under `default`. SLUG_PATTERN is imported from the
// runtime router so the test checks against the real pattern. Run via
// `node tests/run.js` (Node 18+, with global fetch).

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "../../harness.js";
import * as fcNS from "https://cdn.jsdelivr.net/npm/fast-check/+esm";
import { SLUG_PATTERN } from "../../../src/router.js";

// fast-check's ESM build exposes its API on the module namespace; some bundles
// also nest it under `default`. Normalize to a single `fc` handle either way.
const fc = fcNS && typeof fcNS.property === "function" ? fcNS : fcNS.default;

const here = dirname(fileURLToPath(import.meta.url));
// tests/src/ingest -> repo root is three levels up.
const repoRoot = join(here, "..", "..", "..");

/**
 * Pure checker for Property 3. Walks a topic tree (the root is a container
 * whose children are the topics) and returns every schema problem it finds.
 *
 * Rules enforced on every DESCENDANT node (not the root container itself):
 *   - `title` is a non-empty string (`empty-title`);
 *   - `slug` matches {@link SLUG_PATTERN} (`bad-slug`);
 *   - `slug` is unique among its siblings (`duplicate-slug`);
 *   - a leaf (no `children` array, or an empty one) carries a non-empty
 *     `page` string (`missing-page`).
 *
 * Returning problems (rather than throwing) lets the test assert both the
 * "no problems" direction for valid trees and the "reports the problem"
 * direction for deliberately invalid trees.
 *
 * @param {any} root The root container node (its `children` are the topics).
 * @returns {Array<{kind: string, path: string[]}>} Problems found; empty when valid.
 */
export function checkTopicNodeSchema(root) {
  /** @type {Array<{kind: string, path: string[]}>} */
  const problems = [];

  /**
   * @param {any[]} siblings
   * @param {string[]} prefix Slug path to the parent (for reporting).
   */
  function walk(siblings, prefix) {
    const seen = new Set();

    for (const node of siblings) {
      const slug = node && typeof node.slug === "string" ? node.slug : undefined;
      const path = prefix.concat(slug ?? "<?>");

      // Non-empty title.
      if (typeof node.title !== "string" || node.title.trim() === "") {
        problems.push({ kind: "empty-title", path });
      }

      // Slug matches the pattern.
      if (typeof slug !== "string" || !SLUG_PATTERN.test(slug)) {
        problems.push({ kind: "bad-slug", path });
      } else {
        // Sibling uniqueness (only meaningful for a pattern-valid slug).
        if (seen.has(slug)) {
          problems.push({ kind: "duplicate-slug", path });
        }
        seen.add(slug);
      }

      // Leaf ⇒ has a non-empty `page`.
      const isLeaf = !Array.isArray(node.children) || node.children.length === 0;
      if (isLeaf) {
        if (typeof node.page !== "string" || node.page.trim() === "") {
          problems.push({ kind: "missing-page", path });
        }
      } else {
        walk(node.children, path);
      }
    }
  }

  walk(Array.isArray(root && root.children) ? root.children : [], []);
  return problems;
}

// ---------------------------------------------------------------------------
// Generators for valid topic trees.
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

/**
 * Deterministically build a random VALID topic tree from a finite "budget" of
 * integers fast-check supplies. Sibling slug uniqueness (a per-parent counter
 * suffix) and the leaf-has-page rule are hard invariants of the builder, so a
 * generated tree is valid by construction. Some groupings also carry their own
 * `page` (a valid grouping-with-page) — only leaves are REQUIRED to.
 *
 * @param {object} shape
 * @param {string[]} shape.bases      Pool of random slug bases.
 * @param {number[]} shape.childCounts Random child-count decisions (FIFO).
 * @param {number[]} shape.pageFlags  Random 0/1 flags for grouping/leaf split (FIFO).
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

/** Deep-clone a plain tree so a mutation can't leak between runs/assertions. */
function clone(node) {
  return JSON.parse(JSON.stringify(node));
}

describe("TopicNode schema validity (Property 3) \u2014 Validates: Requirements 3.3", () => {
  it("accepts every randomly generated valid tree (no problems reported)", () => {
    fc.assert(
      fc.property(treeShapeArb, (shape) => {
        const { root } = buildTree(shape);
        const problems = checkTopicNodeSchema(root);
        expect(problems).toEqual([]);
      }),
      { numRuns: 100 },
    );
  });

  it("reports the injected violation for each invalid mutation", () => {
    fc.assert(
      fc.property(treeShapeArb, fc.nat(), fc.integer({ min: 0, max: 3 }), (shape, pick, kind) => {
        const { root, nodes } = buildTree(shape);
        if (nodes.length === 0) return; // builder always yields ≥1 node, but guard anyway

        const tree = clone(root);
        // Re-enumerate on the clone so our handles point at the cloned nodes.
        /** @type {Array<{node: any, parentChildren: any[]}>} */
        const flat = [];
        (function collect(siblings) {
          for (const n of siblings) {
            flat.push({ node: n, parentChildren: siblings });
            if (Array.isArray(n.children)) collect(n.children);
          }
        })(tree.children);

        const target = flat[pick % flat.length];
        const node = target.node;

        let expectedKind;
        switch (kind) {
          case 0: {
            // Empty title.
            node.title = "   ";
            expectedKind = "empty-title";
            break;
          }
          case 1: {
            // Bad slug (uppercase + underscore is not in the pattern).
            node.slug = "Bad_Slug";
            expectedKind = "bad-slug";
            break;
          }
          case 2: {
            // Duplicate sibling slug: clone a valid leaf sibling with the same
            // slug so the pair collides among siblings.
            const dup = {
              slug: node.slug,
              title: "Duplicate",
              page: "content/pages/dup.json",
            };
            target.parentChildren.push(dup);
            expectedKind = "duplicate-slug";
            break;
          }
          case 3: {
            // Leaf missing page: strip children + page so it is a leaf with no page.
            delete node.children;
            delete node.page;
            expectedKind = "missing-page";
            break;
          }
        }

        const problems = checkTopicNodeSchema(tree);
        expect(problems.some((p) => p.kind === expectedKind)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it("accepts the real content/topics.json (every node passes)", () => {
    const raw = readFileSync(join(repoRoot, "content", "topics.json"), "utf8");
    const tree = JSON.parse(raw);
    const problems = checkTopicNodeSchema(tree);
    expect(problems).toEqual([]);
  });
});
