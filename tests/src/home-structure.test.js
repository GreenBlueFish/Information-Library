// tests/src/home-structure.test.js
//
// Unit tests for the Home_Page STRUCTURE and SORTING (home-topic-browse —
// task 5.2) — Requirements 1.1, 1.8 (labeled search control + grid), 2.1, 2.2,
// 2.5 (collapsible subtopics: toggle + hidden children for parents, neither for
// childless cards), 3.1, 3.2, 3.4, 3.5 (alphabetical, case-insensitive, stable
// ordering of cards and subtopics), 3.3 (sortByTitle is non-mutating), and 4.3
// (titles/subtopics via textContent — markup stays literal).
//
// DOM SETUP (no build step, no install)
// -------------------------------------
// Unlike `renderer.test.js` — which exercises the block renderers against a
// MINIMAL hand-rolled `document` stub — these home tests drive `renderHome`
// (via `renderPage(resolution, null, mount)`), which calls `installHome` at the
// end of the build. `installHome` uses real DOM APIs the minimal stub does not
// implement (`querySelector`/`querySelectorAll`/`addEventListener`/`dataset`/
// `hidden`). So this suite uses the shared, spec-shaped DOM from `tests/dom.js`
// (`ensureDom()`), the same real DOM the boot/integration tests use. That makes
// the whole home build — search control, sorted cards, collapsible children,
// and the behavior wiring — run exactly as in a browser, with no stubbing.
//
// Other test files in this shared Node process install their own minimal
// `document` stub at import time, and the runner interleaves every file's
// cases, so this suite RE-PINS the ambient `globalThis.document`/`window` to the
// real linkedom DOM at the start of each test (renderer.js reads the `document`
// global at call time). See tests/README.md and boot-navigation.test.js for the
// same pinning rationale.

import { describe, it, expect } from "../harness.js";
import { ensureDom } from "../dom.js";

// Install the real DOM once and pin it as the ambient globals. renderer.js reads
// the `document` global when its builders run, so the global must point at this
// real DOM for the home build to use `dataset`/`hidden`/selection APIs.
const dom = await ensureDom();
globalThis.document = dom.document;
globalThis.window = dom.window;

// Import the module under test AFTER the DOM is installed. `renderPage` builds
// the home view; `sortByTitle` is tested directly for its non-mutation contract.
const { renderPage, sortByTitle } = await import("../../src/renderer.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Re-pin the ambient DOM to this suite's real linkedom document and return a
 * fresh, detached mount element. Call at the top of every test: other test
 * files set their own `globalThis.document` stub at import time, and the runner
 * interleaves cases across files, so whichever ran last would otherwise win.
 * @returns {HTMLElement}
 */
function freshHome() {
  globalThis.document = dom.document;
  globalThis.window = dom.window;
  return dom.document.createElement("div");
}

/**
 * Render the Home_Page for a given root topic tree and return the mount
 * element. The home resolution carries `node: null` (home route) and the tree
 * on `resolution.tree`, which is how `renderHome` reads the root children.
 * @param {object} tree The root TopicNode whose `children` are the root topics.
 * @returns {HTMLElement} The mount element containing the built `.home`.
 */
function renderHomeTree(tree) {
  const mount = freshHome();
  renderPage({ node: null, path: [], tree }, null, mount);
  return mount;
}

/** Collect the ordered titles of the root cards (from each card's link text). */
function cardTitles(mount) {
  return [...mount.querySelectorAll(".home-card")].map((card) =>
    card.querySelector(".home-card__link").textContent,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("home structure + sorting (renderHome / sortByTitle)", () => {
  // =========================================================================
  // Search control + grid (R1.1, R1.8).
  // =========================================================================
  describe("search control and grid (R1.1, R1.8)", () => {
    it("renders a .home-search control and a .home-grid above/around it", () => {
      const mount = renderHomeTree({
        slug: "root",
        title: "Root",
        children: [{ slug: "a", title: "Alpha" }],
      });

      const search = mount.querySelector(".home-search");
      expect(search).toBeTruthy();

      const grid = mount.querySelector(".home-grid");
      expect(grid).toBeTruthy();
      expect(grid.tagName).toBe("UL");
    });

    it("the search input carries an accessible label (a <label for> and aria-label)", () => {
      const mount = renderHomeTree({
        slug: "root",
        title: "Root",
        children: [{ slug: "a", title: "Alpha" }],
      });

      const input = mount.querySelector(".home-search__input");
      expect(input).toBeTruthy();

      // Accessible name via aria-label.
      expect(input.getAttribute("aria-label")).toBe("Search topics");

      // And a visually-associated <label for> that matches the input's id.
      const inputId = input.getAttribute("id");
      expect(typeof inputId).toBe("string");
      const label = mount.querySelector(".home-search__label");
      expect(label).toBeTruthy();
      expect(label.getAttribute("for")).toBe(inputId);
    });
  });

  // =========================================================================
  // Alphabetical, case-insensitive, stable card ordering (R3.1, R3.4, R3.5).
  // =========================================================================
  describe("root card ordering (R3.1, R3.4, R3.5)", () => {
    it("orders root cards alphabetically, case-insensitively", () => {
      const mount = renderHomeTree({
        slug: "root",
        title: "Root",
        children: [
          { slug: "z", title: "Zebra" },
          { slug: "a", title: "apple" },
          { slug: "m", title: "Mango" },
        ],
      });

      // Mixed case must sort as apple, Mango, Zebra (case-insensitive).
      expect(cardTitles(mount)).toEqual(["apple", "Mango", "Zebra"]);
    });

    it("keeps equal-under-case titles in their original input order (stable)", () => {
      // Two titles equal under case-insensitive comparison; distinct slugs let
      // us confirm which object kept which position.
      const mount = renderHomeTree({
        slug: "root",
        title: "Root",
        children: [
          { slug: "first", title: "Topic" },
          { slug: "second", title: "topic" },
        ],
      });

      // Both read as "Topic"/"topic"; stability means the first-authored node
      // (slug "first") stays first, so its link href comes first.
      const hrefs = [...mount.querySelectorAll(".home-card__link")].map((a) =>
        a.getAttribute("href"),
      );
      expect(hrefs).toEqual(["#/first", "#/second"]);
    });
  });

  // =========================================================================
  // Subtopic ordering (R3.2).
  // =========================================================================
  describe("subtopic ordering (R3.2)", () => {
    it("orders each card's subtopics alphabetically, case-insensitively", () => {
      const mount = renderHomeTree({
        slug: "root",
        title: "Root",
        children: [
          {
            slug: "parent",
            title: "Parent",
            children: [
              { slug: "zeta", title: "Zeta" },
              { slug: "alpha", title: "alpha" },
              { slug: "mu", title: "Mu" },
            ],
          },
        ],
      });

      const children = [...mount.querySelectorAll(".home-card__child")].map(
        (li) => li.textContent,
      );
      expect(children).toEqual(["alpha", "Mu", "Zeta"]);
    });
  });

  // =========================================================================
  // Collapsible subtopics: parent vs childless cards (R2.1, R2.2, R2.5).
  // =========================================================================
  describe("collapsible subtopics (R2.1, R2.2, R2.5)", () => {
    it("a card WITH children has a collapsed toggle and a hidden children list", () => {
      const mount = renderHomeTree({
        slug: "root",
        title: "Root",
        children: [
          {
            slug: "parent",
            title: "Parent",
            children: [{ slug: "kid", title: "Kid" }],
          },
        ],
      });

      const card = mount.querySelector(".home-card");

      // A toggle button exists and starts collapsed (R2.2, R2.1).
      const toggle = card.querySelector(".home-card__toggle");
      expect(toggle).toBeTruthy();
      expect(toggle.getAttribute("aria-expanded")).toBe("false");

      // The children list exists and is hidden by default (R2.1).
      const childrenList = card.querySelector(".home-card__children");
      expect(childrenList).toBeTruthy();
      expect(childrenList.hidden).toBe(true);
    });

    it("a CHILDLESS card has neither a toggle nor a children list (R2.5)", () => {
      const mount = renderHomeTree({
        slug: "root",
        title: "Root",
        children: [{ slug: "lonely", title: "Lonely" }],
      });

      const card = mount.querySelector(".home-card");
      expect(card.querySelector(".home-card__toggle")).toBe(null);
      expect(card.querySelector(".home-card__children")).toBe(null);
    });
  });

  // =========================================================================
  // Titles/subtopics via textContent — markup stays literal (R4.3).
  // =========================================================================
  describe("titles/subtopics render as literal text (R4.3)", () => {
    it("a title containing markup appears as literal text with no child element", () => {
      const evil = "<b>x</b>";
      const mount = renderHomeTree({
        slug: "root",
        title: "Root",
        children: [
          {
            slug: "p",
            title: evil,
            children: [{ slug: "c", title: "<i>child</i>" }],
          },
        ],
      });

      const link = mount.querySelector(".home-card__link");
      // The exact markup string is the link's text…
      expect(link.textContent).toBe(evil);
      // …and it produced NO element child (no parsed <b> node anywhere).
      expect(link.querySelector("b")).toBe(null);
      expect(mount.querySelector("b")).toBe(null);

      // Same for the subtopic name: literal text, no parsed <i> element.
      const child = mount.querySelector(".home-card__child");
      expect(child.textContent).toBe("<i>child</i>");
      expect(mount.querySelector("i")).toBe(null);
    });
  });

  // =========================================================================
  // sortByTitle is non-mutating (R3.3): a new array, same elements, input
  // untouched.
  // =========================================================================
  describe("sortByTitle is non-mutating (R3.3)", () => {
    it("returns a new array and leaves the input array order unchanged", () => {
      const input = [
        { slug: "z", title: "Zebra" },
        { slug: "a", title: "apple" },
        { slug: "m", title: "Mango" },
      ];
      const inputSnapshotOrder = input.map((n) => n.slug);

      const sorted = sortByTitle(input);

      // A separate array instance — never the same reference.
      expect(sorted === input).toBe(false);

      // The input array is left in its original order (no mutation).
      expect(input.map((n) => n.slug)).toEqual(inputSnapshotOrder);

      // The result is correctly sorted (case-insensitive).
      expect(sorted.map((n) => n.title)).toEqual(["apple", "Mango", "Zebra"]);
    });

    it("the result is a permutation of the input (same elements, none lost/added)", () => {
      const input = [
        { slug: "z", title: "Zebra" },
        { slug: "a", title: "apple" },
        { slug: "m", title: "Mango" },
      ];

      const sorted = sortByTitle(input);

      // Same count…
      expect(sorted.length).toBe(input.length);
      // …and the exact same node objects (by identity), just reordered.
      const sortedSet = new Set(sorted);
      expect(input.every((n) => sortedSet.has(n))).toBe(true);
      expect(sorted.every((n) => input.includes(n))).toBe(true);
    });
  });
});
