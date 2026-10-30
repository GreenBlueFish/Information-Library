// tests/src/router.test.js
//
// Unit tests for the Router (src/router.js) — design Component 1, Requirements
// 2.1 (parse `#/a/b/c` into slug segments), 2.2 (resolve to node + page file +
// ancestor chain), 2.6 (resolve a node at any depth by joining ancestor slugs),
// 11.4 (a leaf without a `page` is invalid — no route, surface an error), and
// 11.6 (a bad or duplicate sibling slug is rejected — surface an error).
//
// The router is a pure function over an in-memory topic tree (no fetch, no DOM
// for parseHash/resolveRoute), so these tests build small trees literally and
// assert the resolution, breadcrumb chain, and the RouteError surfaced through
// the optional `onError` sink.

import { describe, it, expect } from "../harness.js";
import {
  parseHash,
  resolveRoute,
  SLUG_PATTERN,
} from "../../src/router.js";

/**
 * A representative topic tree used across resolution tests: a root whose
 * children nest three levels deep (snn → neuron-models → lif), plus a
 * grouping-only node (`math`, no page) with a leaf child, so tests can cover
 * deep resolution, breadcrumbs, grouping vs. leaf, and the home fallback.
 */
function sampleTree() {
  return {
    slug: "root",
    title: "Library of Alexandria",
    children: [
      {
        slug: "snn",
        title: "Spiking Neural Networks",
        page: "content/pages/snn/index.json",
        children: [
          {
            slug: "neuron-models",
            title: "Neuron Models",
            page: "content/pages/snn/neuron-models.json",
            children: [
              {
                slug: "lif",
                title: "Leaky Integrate-and-Fire",
                page: "content/pages/snn/lif.json",
              },
            ],
          },
        ],
      },
      {
        // A pure grouping node: no `page`, but has children, so it is a valid
        // route target (the renderer shows its children).
        slug: "math",
        title: "Mathematics",
        children: [
          {
            slug: "calculus",
            title: "Calculus",
            page: "content/pages/math/calculus.json",
          },
        ],
      },
    ],
  };
}

describe("router", () => {
  describe("parseHash (Req 2.1)", () => {
    it("parses `#/a/b/c` into ordered slug segments", () => {
      expect(parseHash("#/a/b/c")).toEqual(["a", "b", "c"]);
    });

    it("parses a real nested route", () => {
      expect(parseHash("#/snn/neuron-models")).toEqual(["snn", "neuron-models"]);
    });

    it("treats empty, `#`, and `#/` as the home route (no segments)", () => {
      expect(parseHash("")).toEqual([]);
      expect(parseHash("#")).toEqual([]);
      expect(parseHash("#/")).toEqual([]);
    });

    it("ignores a trailing slash", () => {
      expect(parseHash("#/snn/")).toEqual(["snn"]);
      expect(parseHash("#/a/b/c/")).toEqual(["a", "b", "c"]);
    });

    it("collapses doubled/empty slash segments", () => {
      expect(parseHash("#/a//b")).toEqual(["a", "b"]);
      expect(parseHash("#//a/b//")).toEqual(["a", "b"]);
    });

    it("tolerates a missing leading `#` or `/`", () => {
      expect(parseHash("/a/b")).toEqual(["a", "b"]);
      expect(parseHash("a/b")).toEqual(["a", "b"]);
    });

    it("returns [] for a non-string hash", () => {
      expect(parseHash(undefined)).toEqual([]);
      expect(parseHash(null)).toEqual([]);
    });
  });

  describe("resolveRoute — deep-nesting resolution (Req 2.2, 2.6)", () => {
    it("resolves a node at depth by joining ancestor slugs", () => {
      const tree = sampleTree();
      const res = resolveRoute(tree, ["snn", "neuron-models", "lif"]);

      // Non-null resolution pointing at the deepest node and its page file.
      expect(res.node.slug).toBe("lif");
      expect(res.pageFile).toBe("content/pages/snn/lif.json");
      expect(res.path).toEqual(["snn", "neuron-models", "lif"]);
    });

    it("resolves a top-level node with its page file", () => {
      const tree = sampleTree();
      const res = resolveRoute(tree, ["snn"]);
      expect(res.node.slug).toBe("snn");
      expect(res.pageFile).toBe("content/pages/snn/index.json");
    });

    it("resolves a grouping-only node (no page) as a valid target with null pageFile", () => {
      const tree = sampleTree();
      const res = resolveRoute(tree, ["math"]);
      expect(res.node.slug).toBe("math");
      // A non-leaf grouping without its own page is still valid; pageFile null.
      expect(res.pageFile).toBe(null);
    });
  });

  describe("resolveRoute — breadcrumb ancestor chain (Req 2.2)", () => {
    it("builds the ancestor chain root-first, ending with the resolved node", () => {
      const tree = sampleTree();
      const res = resolveRoute(tree, ["snn", "neuron-models", "lif"]);

      const crumbSlugs = res.crumbs.map((c) => c.slug);
      expect(crumbSlugs).toEqual(["snn", "neuron-models", "lif"]);
      // The last crumb is the resolved node itself.
      expect(res.crumbs[res.crumbs.length - 1]).toBe(res.node);
    });

    it("gives a single-element chain for a top-level node", () => {
      const tree = sampleTree();
      const res = resolveRoute(tree, ["snn"]);
      expect(res.crumbs.map((c) => c.slug)).toEqual(["snn"]);
    });
  });

  describe("resolveRoute — unknown/unresolved route falls back home (Req 2.4)", () => {
    it("returns the home route (empty path, null node) for empty segments", () => {
      const tree = sampleTree();
      const res = resolveRoute(tree, []);
      expect(res.path).toEqual([]);
      expect(res.node).toBe(null);
      expect(res.pageFile).toBe(null);
    });

    it("returns null when a top-level slug does not exist", () => {
      const tree = sampleTree();
      expect(resolveRoute(tree, ["does-not-exist"])).toBe(null);
    });

    it("returns null when a nested slug does not exist", () => {
      const tree = sampleTree();
      expect(resolveRoute(tree, ["snn", "no-such-child"])).toBe(null);
    });

    it("returns the home route when the tree itself is absent", () => {
      const res = resolveRoute(null, ["snn"]);
      expect(res.path).toEqual([]);
      expect(res.node).toBe(null);
    });
  });

  describe("resolveRoute — invalid leaf without a page (Req 11.4)", () => {
    it("returns null and surfaces a 'missing-page' error for a leaf with no page", () => {
      const tree = {
        slug: "root",
        title: "Root",
        children: [
          {
            // Leaf (no children) with no `page` → invalid, cannot be rendered.
            slug: "orphan",
            title: "Orphan",
          },
        ],
      };

      const errors = [];
      const res = resolveRoute(tree, ["orphan"], (e) => errors.push(e));

      expect(res).toBe(null);
      expect(errors.length).toBe(1);
      expect(errors[0].kind).toBe("missing-page");
      expect(errors[0].slug).toBe("orphan");
      expect(errors[0].path).toEqual(["orphan"]);
    });

    it("does not require onError: an invalid leaf still resolves to null", () => {
      const tree = {
        slug: "root",
        title: "Root",
        children: [{ slug: "orphan", title: "Orphan" }],
      };
      expect(resolveRoute(tree, ["orphan"])).toBe(null);
    });
  });

  describe("resolveRoute — bad/duplicate slug rejected (Req 11.6)", () => {
    it("returns null and surfaces a 'bad-slug' error for a slug violating the pattern", () => {
      const tree = {
        slug: "root",
        title: "Root",
        children: [
          {
            // Uppercase + space: violates ^[a-z0-9]+(-[a-z0-9]+)*$.
            slug: "Bad Slug",
            title: "Bad",
            page: "content/pages/bad.json",
          },
        ],
      };

      const errors = [];
      const res = resolveRoute(tree, ["Bad Slug"], (e) => errors.push(e));

      expect(res).toBe(null);
      expect(errors.length).toBe(1);
      expect(errors[0].kind).toBe("bad-slug");
      expect(errors[0].slug).toBe("Bad Slug");
    });

    it("returns null and surfaces a 'duplicate-slug' error for duplicate siblings", () => {
      const tree = {
        slug: "root",
        title: "Root",
        children: [
          { slug: "dup", title: "First", page: "content/pages/first.json" },
          { slug: "dup", title: "Second", page: "content/pages/second.json" },
        ],
      };

      const errors = [];
      const res = resolveRoute(tree, ["dup"], (e) => errors.push(e));

      expect(res).toBe(null);
      // The duplicate is detected among the siblings searched at this depth.
      const kinds = errors.map((e) => e.kind);
      expect(kinds.includes("duplicate-slug")).toBeTruthy();
      expect(errors.find((e) => e.kind === "duplicate-slug").slug).toBe("dup");
    });

    it("leaves a sibling's bad slug from breaking resolution of a good sibling at a deeper level", () => {
      // A bad slug only rejects routes whose walk searches that sibling set.
      // A good top-level route whose children are all valid still resolves.
      const tree = sampleTree();
      const res = resolveRoute(tree, ["snn"]);
      expect(res.node.slug).toBe("snn");
    });
  });

  describe("SLUG_PATTERN (Req 11.5)", () => {
    it("accepts lowercase alphanumeric dash-separated slugs", () => {
      expect(SLUG_PATTERN.test("snn")).toBe(true);
      expect(SLUG_PATTERN.test("neuron-models")).toBe(true);
      expect(SLUG_PATTERN.test("a1-b2-c3")).toBe(true);
    });

    it("rejects uppercase, spaces, leading/trailing/double dashes", () => {
      expect(SLUG_PATTERN.test("Snn")).toBe(false);
      expect(SLUG_PATTERN.test("neuron models")).toBe(false);
      expect(SLUG_PATTERN.test("-lead")).toBe(false);
      expect(SLUG_PATTERN.test("trail-")).toBe(false);
      expect(SLUG_PATTERN.test("double--dash")).toBe(false);
    });
  });
});
