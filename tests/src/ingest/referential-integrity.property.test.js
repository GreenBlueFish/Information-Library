// tests/src/ingest/referential-integrity.property.test.js
//
// Property-based test for referential integrity across the ingested content
// (design.md — Correctness Properties → "Property 2: Referential integrity —
// every reference resolves to a real target").
//
//   Feature: snn-material-ingestion, Property 2
//   **Validates: Requirements 3.5, 6.3, 7.2, 7.3, 7.5, 8.3**
//
//   Property 2: Referential integrity
//   *For all* `TopicNode`s with a `page`, the file at that path exists; and
//   *for all* `TermEntry` records whose `pageRef` is non-null, `resolveRoute`
//   against the post-ingestion `topics.json` resolves that route to a node.
//   Equivalently: every added route resolves, no page path dangles, and no
//   `pageRef` dangles.
//
// The test defines a pure `checkReferentialIntegrity(root, terms, pageExists)`
// walker that returns the list of problems it finds, then exercises it both
// ways the design calls for:
//
//   (a) REAL-CONTENT direction — read the live `content/topics.json` +
//       `content/terms.json` via `node:fs` and assert the walker reports no
//       problems: every node `page` path exists on disk (joined under the repo
//       root) and every non-null `pageRef` resolves via `parseHash` +
//       `resolveRoute` against the real topic tree.
//
//   (b) PROPERTY direction — generate random valid topic trees (mirroring the
//       builder in tests/src/router.additivity.property.test.js) plus matching
//       `pageRef`s drawn from real routes in the generated tree, assert
//       integrity holds; then inject exactly one defect (a dangling page path
//       OR a dangling pageRef) and assert the walker catches that specific
//       defect.
//
// Page existence is injected as a predicate so the SAME walker runs against the
// real filesystem (direction a) and against purely in-memory generated trees
// (direction b) without touching disk. `resolveRoute`/`parseHash` are imported
// from the runtime router so the test resolves pageRefs exactly as the browser
// would — the same seam the dev validator (tools/ingest/validate-content.js)
// reuses.
//
// fast-check is loaded as an ES module with NO build step, matching the
// established convention (tests/src/router.additivity.property.test.js,
// tests/src/ingest/topicnode-schema.property.test.js): import the module
// namespace from the jsDelivr ESM CDN and normalize the `fc` handle whether the
// API sits on the namespace or under `default`. Run via
// `node --experimental-network-imports tests/run.js` (Node 20, global fetch).

import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "../../harness.js";
import * as fcNS from "https://cdn.jsdelivr.net/npm/fast-check/+esm";
import { resolveRoute, parseHash, SLUG_PATTERN } from "../../../src/router.js";

// fast-check's ESM build exposes its API on the module namespace; some bundles
// also nest it under `default`. Normalize to a single `fc` handle either way.
const fc = fcNS && typeof fcNS.property === "function" ? fcNS : fcNS.default;

const here = dirname(fileURLToPath(import.meta.url));
// tests/src/ingest -> repo root is three levels up.
const repoRoot = join(here, "..", "..", "..");

// ---------------------------------------------------------------------------
// Pure checker for Property 2.
// ---------------------------------------------------------------------------

/**
 * Pure referential-integrity checker. Walks the whole topic tree and the
 * glossary and returns every dangling-reference problem it finds.
 *
 * Rules:
 *   - For every node (at any depth) that carries a non-empty `page` string,
 *     `pageExists(page)` must be true, else a `missing-page` problem is
 *     reported (Req 7.2, 3.5).
 *   - For every `TermEntry` whose `pageRef` is a non-null string, parsing it
 *     with `parseHash` and resolving it with `resolveRoute` against `root` must
 *     yield a resolution with a real `node`, else a `dangling-pageRef` problem
 *     is reported (Req 7.3, 6.3). `null`/absent `pageRef` is a valid "no backing
 *     page" and is skipped.
 *
 * Returning problems (rather than throwing) lets the test assert both the
 * "no problems" direction for valid content and the "reports the problem"
 * direction for deliberately broken content.
 *
 * @param {any} root The root container node (its `children` are the topics).
 * @param {any[]} terms The glossary (array of TermEntry).
 * @param {(page: string) => boolean} pageExists Does this page path exist?
 * @returns {Array<{kind: string, where: string}>} Problems found; empty when sound.
 */
export function checkReferentialIntegrity(root, terms, pageExists) {
  /** @type {Array<{kind: string, where: string}>} */
  const problems = [];

  // --- Node page-path existence (every node, any depth). ---
  (function walk(node, prefix) {
    if (node === null || typeof node !== "object") return;
    const path = node.slug ? prefix.concat(node.slug) : prefix;

    if (typeof node.page === "string" && node.page.length > 0) {
      if (!pageExists(node.page)) {
        problems.push({ kind: "missing-page", where: `/${path.join("/")}` });
      }
    }

    const children = Array.isArray(node.children) ? node.children : [];
    for (const child of children) walk(child, path);
  })(root, []);

  // --- Glossary pageRef resolution. ---
  const entries = Array.isArray(terms) ? terms : [];
  entries.forEach((entry, i) => {
    if (entry === null || typeof entry !== "object") return;
    const pageRef = entry.pageRef;
    const label =
      typeof entry.term === "string" ? `term "${entry.term}"` : `terms[${i}]`;

    // null / absent pageRef is an explicit "no backing page" — nothing to check.
    if (pageRef === null || pageRef === undefined) return;

    if (typeof pageRef !== "string") {
      problems.push({ kind: "dangling-pageRef", where: label });
      return;
    }

    const segments = parseHash(pageRef);
    // A non-null pageRef must name an actual route; an empty parse (e.g. "/" or
    // "") would resolve to HOME_ROUTE, which is not a real backing page.
    if (segments.length === 0) {
      problems.push({ kind: "dangling-pageRef", where: label });
      return;
    }

    const resolution = resolveRoute(root, segments);
    if (resolution === null || !resolution.node) {
      problems.push({ kind: "dangling-pageRef", where: label });
    }
  });

  return problems;
}

// ---------------------------------------------------------------------------
// Generators for valid topic trees (mirrors the builder in
// tests/src/router.additivity.property.test.js and topicnode-schema.property).
// ---------------------------------------------------------------------------

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
 * suffix) and the leaf-has-page rule are hard invariants of the builder, so the
 * tree is valid by construction and `resolveRoute` never rejects for validation
 * reasons. Every node that carries a `page` uses a deterministic path mirroring
 * its slug path; the test's `pageExists` predicate treats exactly these paths as
 * present (direction b is purely in-memory).
 *
 * @param {object} shape
 * @param {string[]} shape.bases      Pool of random slug bases.
 * @param {number[]} shape.childCounts Random child-count decisions (FIFO).
 * @param {number[]} shape.pageFlags  Random 0/1 flags for grouping/leaf split (FIFO).
 * @returns {{root: any, pages: Set<string>, routes: string[][]}}
 *   root: the built tree; pages: every page path the tree references (all
 *   "exist"); routes: every routable slug path (targets for valid pageRefs).
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

  /** @type {Set<string>} */
  const pages = new Set();
  /** @type {string[][]} */
  const routes = [];

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
      routes.push(childPath);

      if (makeLeaf) {
        node.page = `content/pages/${childPath.join("/")}.json`;
        pages.add(node.page);
      } else {
        node.children = makeChildren(childPath, remainingDepth - 1);
        if (nextFlag() === 1) {
          node.page = `content/pages/${childPath.join("/")}.json`;
          pages.add(node.page);
        }
      }

      children.push(node);
    }
    return children;
  }

  const root = {
    slug: "root",
    title: "Library of Alexandria",
    children: makeChildren([], 3), // up to 4 levels deep
  };

  return { root, pages, routes };
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

/**
 * Build glossary entries whose non-null pageRefs point at real routes of the
 * generated tree (plus some explicit-null entries, which are always sound).
 *
 * @param {string[][]} routes All routable slug paths in the tree.
 * @param {number[]} picks     FIFO budget of indices selecting routes.
 * @returns {any[]} TermEntry-shaped records (only the fields the checker reads).
 */
function buildTerms(routes, picks) {
  if (routes.length === 0) return [];
  /** @type {any[]} */
  const terms = [];
  picks.forEach((p, i) => {
    // Every other entry is an explicit null pageRef (valid "no backing page").
    if (i % 3 === 2) {
      terms.push({ term: `Term ${i}`, definition: "d", pageRef: null });
      return;
    }
    const route = routes[p % routes.length];
    terms.push({ term: `Term ${i}`, definition: "d", pageRef: `/${route.join("/")}` });
  });
  return terms;
}

// ---------------------------------------------------------------------------
// Tests.
// ---------------------------------------------------------------------------

describe(
  "Referential integrity (Property 2) \u2014 Validates: Requirements 3.5, 6.3, 7.2, 7.3, 7.5, 8.3",
  () => {
    // (b) PROPERTY direction — sound content reports no problems.
    it("accepts random valid trees + pageRefs pointing at real routes (no problems)", () => {
      fc.assert(
        fc.property(
          treeShapeArb,
          fc.array(fc.nat(), { minLength: 1, maxLength: 12 }),
          (shape, picks) => {
            const { root, pages, routes } = buildTree(shape);
            const terms = buildTerms(routes, picks);
            const pageExists = (p) => pages.has(p);

            const problems = checkReferentialIntegrity(root, terms, pageExists);
            expect(problems).toEqual([]);
          },
        ),
        { numRuns: 150 },
      );
    });

    // (b) PROPERTY direction — inject exactly one defect; the checker catches it.
    it("reports the injected defect (dangling page path OR dangling pageRef)", () => {
      fc.assert(
        fc.property(
          treeShapeArb,
          fc.array(fc.nat(), { minLength: 1, maxLength: 12 }),
          fc.nat(),
          fc.boolean(),
          (shape, picks, pick, danglePage) => {
            const built = buildTree(shape);
            const root = clone(built.root);
            const { pages, routes } = built;
            const terms = buildTerms(routes, picks);

            // Flatten the cloned tree so we can mutate a specific node.
            /** @type {any[]} */
            const flat = [];
            (function collect(siblings) {
              for (const n of siblings) {
                flat.push(n);
                if (Array.isArray(n.children)) collect(n.children);
              }
            })(root.children);
            if (flat.length === 0) return; // builder always yields ≥1 node

            let expectedKind;
            if (danglePage) {
              // Dangling PAGE path: point a node at a path that does not "exist".
              const target = flat[pick % flat.length];
              target.page = "content/pages/__does_not_exist__.json";
              expectedKind = "missing-page";
            } else {
              // Dangling pageRef: add a term whose pageRef names no real route.
              terms.push({
                term: "Dangling",
                definition: "d",
                pageRef: "/no/such/route/here",
              });
              expectedKind = "dangling-pageRef";
            }

            // pageExists recognizes exactly the (un-mutated) generated pages, so
            // the injected bogus page path is correctly seen as missing.
            const pageExists = (p) => pages.has(p);

            const problems = checkReferentialIntegrity(root, terms, pageExists);
            expect(problems.some((pr) => pr.kind === expectedKind)).toBe(true);
          },
        ),
        { numRuns: 150 },
      );
    });

    // (a) REAL-CONTENT direction — the live library is referentially sound.
    it("accepts the real content/topics.json + content/terms.json (every reference resolves)", () => {
      const tree = JSON.parse(
        readFileSync(join(repoRoot, "content", "topics.json"), "utf8"),
      );
      const terms = JSON.parse(
        readFileSync(join(repoRoot, "content", "terms.json"), "utf8"),
      );
      // Real page existence: join the repo-relative page path under repoRoot.
      const pageExists = (p) => existsSync(join(repoRoot, p));

      const problems = checkReferentialIntegrity(tree, terms, pageExists);
      expect(problems).toEqual([]);
    });
  },
);
