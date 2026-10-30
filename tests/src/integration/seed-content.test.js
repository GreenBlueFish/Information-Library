// tests/src/integration/seed-content.test.js
//
// Integration test over the real seed content (task 8.4) — Requirements 11.1,
// 11.3, and 2.6. Unlike the router unit tests, which build tiny literal trees,
// this suite loads the actual authored seed files straight off disk:
//
//   - content/topics.json   (the Topic_Tree manifest)
//   - content/terms.json    (the Lookup_System's Term_Entry records)
//   - content/pages/**.json  (the Page_Content backing each leaf)
//
// and asserts the three invariants that keep navigation and lookup coherent:
//
//   1. Every non-null `pageRef` in terms.json resolves to a real route in the
//      topic tree — a learner following a definition's link never lands on a
//      dead route (R11.1, 2.6).
//   2. Every LEAF node in topics.json carries a `page` reference, and that page
//      file exists on disk and parses as PageContent (a title + a blocks array)
//      — a browsable topic always has something to render (R11.3).
//   3. resolveRoute surfaces no slug/validation errors anywhere in the real
//      tree (every slug is well-formed and unique among siblings).
//
// In Node there is no browser fetch of relative URLs, so we read the JSON files
// directly with node:fs and resolve paths relative to the repo root derived
// from import.meta.url. Routing itself goes through the real src/router.js so
// the test exercises the production resolution logic, not a reimplementation.

import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "../../harness.js";
import { parseHash, resolveRoute } from "../../../src/router.js";

// This file lives at <repo>/tests/src/integration/, so the repo root is three
// directories up. Everything below is resolved against it.
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..", "..");

/** Read a repo-relative file and JSON.parse it, failing loudly on either step. */
function readJson(relPath) {
  const abs = join(repoRoot, relPath);
  const raw = readFileSync(abs, "utf8");
  return JSON.parse(raw);
}

// Load the real seed content once; every case below reads from these.
const topics = readJson("content/topics.json");
const terms = readJson("content/terms.json");

/**
 * Collect every leaf node (no children) in the topic tree, remembering the
 * slug path to each so failures name the offender. The root itself is skipped:
 * its slug ("root") is the tree container, not a routable child.
 * @param {import("../../../src/router.js").TopicNode} node
 * @param {string[]} path
 * @param {{ path: string[], node: any }[]} out
 */
function collectLeaves(node, path, out) {
  const children = Array.isArray(node.children) ? node.children : [];
  if (children.length === 0) {
    out.push({ path, node });
    return out;
  }
  for (const child of children) {
    collectLeaves(child, path.concat(child.slug), out);
  }
  return out;
}

// Leaves are discovered from the root's children (the root is a container).
const leaves = [];
for (const child of topics.children ?? []) {
  collectLeaves(child, [child.slug], leaves);
}

describe("seed content integration", () => {
  describe("terms.json pageRefs resolve to real routes (R11.1, R2.6)", () => {
    const withRefs = terms.filter(
      (t) => t.pageRef !== null && t.pageRef !== undefined,
    );

    it("has at least one term with a non-null pageRef to exercise", () => {
      // A trivially-empty set would make the loop below pass vacuously; guard it.
      expect(withRefs.length > 0).toBeTruthy();
    });

    for (const entry of withRefs) {
      it(`"${entry.term}" → ${entry.pageRef} resolves`, () => {
        // A pageRef is a route string like "/snn/neuron-models/lif": parse it
        // exactly as the hash router would, then resolve against the real tree.
        const segments = parseHash(entry.pageRef);
        expect(segments.length > 0).toBeTruthy();

        const errors = [];
        const res = resolveRoute(topics, segments, (e) => errors.push(e));

        // Non-null resolution with no validation errors, and the resolved node's
        // slug must be the last segment of the pageRef (we landed where we aimed).
        expect(res).toBeTruthy();
        expect(errors).toEqual([]);
        expect(res.node.slug).toBe(segments[segments.length - 1]);
        expect(res.path).toEqual(segments);
      });
    }
  });

  describe("every leaf node has a loadable page (R11.3)", () => {
    it("finds leaf nodes to check", () => {
      expect(leaves.length > 0).toBeTruthy();
    });

    for (const leaf of leaves) {
      const route = "/" + leaf.path.join("/");

      it(`leaf ${route} carries a page reference`, () => {
        // R11.3: a leaf topic must carry a `page` to its backing content.
        expect(typeof leaf.node.page).toBe("string");
        expect(leaf.node.page.length > 0).toBeTruthy();
      });

      it(`leaf ${route} page file exists and parses as PageContent`, () => {
        const pagePath = join(repoRoot, leaf.node.page);
        // Name the file in the assertion so a missing page is obvious.
        expect(existsSync(pagePath)).toBeTruthy();

        const page = JSON.parse(readFileSync(pagePath, "utf8"));
        // PageContent shape: a string title and an ordered `blocks` array.
        expect(typeof page.title).toBe("string");
        expect(page.title.length > 0).toBeTruthy();
        expect(Array.isArray(page.blocks)).toBe(true);
      });
    }
  });

  describe("the real tree surfaces no slug/validation errors (R11.5, R11.6)", () => {
    for (const leaf of leaves) {
      const segments = leaf.path;
      it(`resolving /${segments.join("/")} reports no errors`, () => {
        const errors = [];
        const res = resolveRoute(topics, segments, (e) => errors.push(e));
        expect(errors).toEqual([]);
        expect(res).toBeTruthy();
      });
    }
  });
});
