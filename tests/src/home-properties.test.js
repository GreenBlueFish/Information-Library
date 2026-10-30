// tests/src/home-properties.test.js
//
// Property-based tests for the Home_Page sorting and filtering
// (home-topic-browse — task 5.4, design.md "Correctness Properties").
// These back the example-based unit/behavior tests (5.2, 5.3) with the
// universal invariants the design names, one `fc.property` per property:
//
//   Property 1 — Order is a permutation (no loss/duplication)   R3.1, R3.2
//   Property 2 — Order is sorted and stable                     R3.4, R3.5
//   Property 3 — Sorting is non-mutating                        R3.3
//   Property 4 — Empty query shows all; visibility = substring  R1.2, R1.4,
//                inclusion on title-or-child                     R1.5, R1.7
//   Property 5 — No-match status is exact                       R1.6
//   Property 6 — Toggle isolation and reversibility             R2.3, R2.4, R2.7
//
// DOM SETUP (no build step, no install)
// -------------------------------------
// Properties 4–6 drive the real home DOM: they render the Home_Page via
// `renderPage({ node: null, path: [], tree }, null, mount)` (which calls
// `installHome`) and then exercise `applyFilter` / `toggleCard` against it.
// That build uses real DOM APIs (`querySelector(All)`, `dataset`, `hidden`,
// `addEventListener`), so this suite uses the shared, spec-shaped linkedom DOM
// from `tests/dom.js` (`ensureDom()`) — the same real DOM the boot/integration
// and `home-structure` tests use. Other test files in this shared Node process
// install their own minimal `document` stub at import time and the runner
// interleaves every file's cases, so this suite RE-PINS the ambient
// `globalThis.document`/`window` to the real DOM before each DOM-dependent
// render (renderer.js reads the `document` global at call time). This mirrors
// the pinning rationale in `home-structure.test.js` and
// `renderer.idempotent.property.test.js`.
//
// fast-check is loaded as an ES module with NO build step, matching the sibling
// property tests' convention exactly (e.g.
// `renderer.idempotent.property.test.js`, the lookup property tests): imported
// from the jsDelivr ESM CDN so `node tests/run.js` (Node 18+, with global
// fetch) resolves it directly from the network with no install and no bundler.
// To run fully offline, replace the import specifier with a locally vendored
// copy of fast-check's ESM build and keep the rest of this file unchanged.

import { describe, it, expect } from "../harness.js";
import * as fcNS from "https://cdn.jsdelivr.net/npm/fast-check/+esm";
import { ensureDom } from "../dom.js";

// fast-check's ESM build exposes its API on the module namespace; some bundles
// also nest it under `default`. Normalize to a single `fc` handle either way.
const fc = fcNS && typeof fcNS.property === "function" ? fcNS : fcNS.default;

// Install the real DOM once and pin it as the ambient globals BEFORE importing
// the modules under test: renderer.js reads the `document` global when its
// builders run, so the global must point at this real DOM for the home build to
// use `dataset`/`hidden`/selection APIs.
const dom = await ensureDom();
globalThis.document = dom.document;
globalThis.window = dom.window;

const { renderPage, normalizeTitle, sortByTitle } = await import(
  "../../src/renderer.js"
);
const { applyFilter, toggleCard } = await import("../../src/home.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Re-pin the ambient DOM to this suite's real linkedom document and return a
 * fresh, detached mount element. Call before each DOM-dependent render: other
 * test files set their own `globalThis.document` stub at import time, and the
 * runner interleaves cases across files, so whichever ran last would otherwise
 * win (see home-structure.test.js / renderer.idempotent.property.test.js).
 * @returns {HTMLElement}
 */
function freshMount() {
  globalThis.document = dom.document;
  globalThis.window = dom.window;
  return dom.document.createElement("div");
}

/**
 * Render the Home_Page for a root topic tree and return the mount element. The
 * home resolution carries `node: null` (home route) with the tree on
 * `resolution.tree`, which is how `renderHome` reads the root children.
 * @param {object} tree The root TopicNode whose `children` are the root topics.
 * @returns {HTMLElement}
 */
function renderHomeTree(tree) {
  const mount = freshMount();
  renderPage({ node: null, path: [], tree }, null, mount);
  return mount;
}

/** Collect the `.home-card` elements of a rendered home, in document order. */
function cardsOf(mount) {
  return [...mount.querySelectorAll(".home-card")];
}

/** The `.home-search__status` region of a rendered home (or null). */
function statusOf(mount) {
  return mount.querySelector(".home-search__status");
}

/**
 * Compare two normalized titles the same way `sortByTitle` does — case- and
 * accent-insensitive via `localeCompare(sensitivity: "base")`. Returns <0, 0,
 * or >0. Used by Property 2 to reason about order and ties on the SAME basis
 * the implementation uses.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function cmp(a, b) {
  return a.localeCompare(b, undefined, { sensitivity: "base" });
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

// Short slug: lowercase alnum, 1..6 chars (valid, unique-able per sibling set).
const slugCharArb = fc
  .integer({ min: 0, max: 35 })
  .map((n) => (n < 26 ? String.fromCharCode(97 + n) : String(n - 26)));
const slugArb = fc
  .array(slugCharArb, { minLength: 1, maxLength: 6 })
  .map((cs) => cs.join(""));

// A small, deliberately clash-prone title alphabet so sorts exercise real
// ordering AND ties (case-only differences, whitespace, shared prefixes):
// drawn from a tiny pool plus optional surrounding whitespace / case flips.
const baseWordArb = fc.constantFrom(
  "alpha",
  "Alpha",
  "beta",
  "Beta",
  "gamma",
  "GAMMA",
  "delta",
  "mango",
  "Mango",
  "zebra",
  "apple",
  "a",
  "ab",
);
const titleArb = fc
  .tuple(
    fc.constantFrom("", " ", "  "),
    baseWordArb,
    fc.constantFrom("", " "),
  )
  .map(([lead, word, trail]) => lead + word + trail);

/**
 * A node arbitrary carrying a stable `_idx` tag (its position in the generated
 * list is added later) so Property 1/2 can reason about identity and original
 * order. `title` may be absent (falls back to slug in `normalizeTitle`).
 */
const nodeArb = fc.record({
  slug: slugArb,
  title: titleArb,
  hasTitle: fc.boolean(),
});

/**
 * A list of nodes with UNIQUE slugs (so identity/original-order claims are
 * unambiguous) and each tagged with its original index. Titles are dropped on
 * some nodes to exercise the slug fallback in `normalizeTitle`.
 */
const nodeListArb = fc
  .array(nodeArb, { minLength: 0, maxLength: 8 })
  .map((raw) => {
    const seen = new Set();
    const out = [];
    for (const n of raw) {
      let slug = n.slug;
      // Ensure slug uniqueness within the list without changing the space.
      while (seen.has(slug)) slug = slug + "x";
      seen.add(slug);
      const node = { slug };
      if (n.hasTitle) node.title = n.title;
      out.push(node);
    }
    // Tag original order AFTER uniqueness so indices are contiguous 0..n-1.
    return out.map((node, i) => ({ ...node, _idx: i }));
  });

// ---------------------------------------------------------------------------
// Tree + query arbitraries for the DOM properties (4, 5, 6)
// ---------------------------------------------------------------------------

/** A child subtopic node: a unique-able slug + optional title. */
const childArb = fc.record({ slug: slugArb, title: titleArb, hasTitle: fc.boolean() });

/** A root topic node: slug/title plus a small set of child subtopics. */
const rootArb = fc.record({
  slug: slugArb,
  title: titleArb,
  hasTitle: fc.boolean(),
  children: fc.array(childArb, { minLength: 0, maxLength: 4 }),
});

/**
 * A root TopicTree (the object `renderHome` reads via `resolution.tree`) whose
 * root `children` are the top-level topic cards. Slugs are made unique across
 * the whole tree so generated `aria-controls`/children ids never collide within
 * one render. Titles are optionally dropped to exercise the slug fallback.
 */
const treeArb = fc.array(rootArb, { minLength: 0, maxLength: 5 }).map((roots) => {
  const seen = new Set();
  const uniq = (s) => {
    let v = s;
    while (seen.has(v)) v = v + "x";
    seen.add(v);
    return v;
  };
  const children = roots.map((r) => {
    const node = { slug: uniq(r.slug) };
    if (r.hasTitle) node.title = r.title;
    node.children = r.children.map((c) => {
      const child = { slug: uniq(c.slug) };
      if (c.hasTitle) child.title = c.title;
      return child;
    });
    if (node.children.length === 0) delete node.children;
    return node;
  });
  return { slug: "root", title: "Root", children };
});

/**
 * Build a query arbitrary biased to hit real matches: it draws from the
 * normalized titles already present in the tree (whole + substrings) as well as
 * arbitrary short strings and the empty string. This makes Property 4's
 * "visible IFF substring" claim meaningful across both matching and
 * non-matching queries.
 * @param {object} tree
 * @returns {import("fast-check").Arbitrary<string>}
 */
function queryArbFor(tree) {
  const titles = [];
  for (const card of tree.children ?? []) {
    titles.push(normalizeTitle(card));
    for (const child of card.children ?? []) titles.push(normalizeTitle(child));
  }
  const nonEmpty = titles.filter((t) => t.length > 0);

  // Substrings taken from present titles (so some queries definitely match).
  const substringArb =
    nonEmpty.length > 0
      ? fc.constantFrom(...nonEmpty).chain((t) => {
          const maxStart = Math.max(0, t.length - 1);
          return fc
            .tuple(
              fc.integer({ min: 0, max: maxStart }),
              fc.integer({ min: 1, max: t.length }),
            )
            .map(([start, len]) => t.slice(start, start + len));
        })
      : fc.constant("x");

  // Arbitrary short strings (letters) + case/whitespace variants, so some
  // queries miss and some exercise normalization.
  const randomArb = fc
    .array(slugCharArb, { minLength: 1, maxLength: 4 })
    .map((cs) => cs.join(""));

  return fc.oneof(
    { weight: 1, arbitrary: fc.constantFrom("", " ", "   ") },
    { weight: 3, arbitrary: substringArb },
    { weight: 2, arbitrary: randomArb },
    // Case/whitespace-decorated substring, to exercise normalization in filter.
    {
      weight: 2,
      arbitrary: substringArb.map((s) => "  " + s.toUpperCase() + " "),
    },
  );
}

/** A tree paired with a query valid for THAT tree (generation chained). */
const treeWithQueryArb = treeArb.chain((tree) =>
  fc.record({ tree: fc.constant(tree), query: queryArbFor(tree) }),
);

// A tree guaranteed to have >= 2 parent cards (cards with children), for the
// toggle-isolation property. Built by generating parents (each with >=1 child)
// and ensuring at least two exist.
const parentArb = fc.record({
  slug: slugArb,
  title: titleArb,
  hasTitle: fc.boolean(),
  children: fc.array(childArb, { minLength: 1, maxLength: 3 }),
});
const multiParentTreeArb = fc
  .array(parentArb, { minLength: 2, maxLength: 5 })
  .map((parents) => {
    const seen = new Set();
    const uniq = (s) => {
      let v = s;
      while (seen.has(v)) v = v + "x";
      seen.add(v);
      return v;
    };
    const children = parents.map((p) => ({
      slug: uniq(p.slug),
      ...(p.hasTitle ? { title: p.title } : {}),
      children: p.children.map((c) => ({
        slug: uniq(c.slug),
        ...(c.hasTitle ? { title: c.title } : {}),
      })),
    }));
    return { slug: "root", title: "Root", children };
  });

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

describe("home sorting (sortByTitle) \u2014 Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5", () => {
  // Property 1 — permutation (R3.1, R3.2).
  it("Property 1: sortByTitle returns a permutation of its input (no loss/duplication)", () => {
    fc.assert(
      fc.property(nodeListArb, (nodes) => {
        const sorted = sortByTitle(nodes);

        // Same length…
        expect(sorted.length).toBe(nodes.length);
        // …and the exact same node objects by identity (multiset equality,
        // leveraging the unique `_idx` tag each node carries).
        const inputIdx = nodes.map((n) => n._idx).sort((a, b) => a - b);
        const sortedIdx = sorted.map((n) => n._idx).sort((a, b) => a - b);
        expect(sortedIdx).toEqual(inputIdx);
        // Every result element is one of the input objects (by reference).
        const inputSet = new Set(nodes);
        expect(sorted.every((n) => inputSet.has(n))).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  // Property 2 — sorted + stable (R3.4, R3.5).
  it("Property 2: result is non-decreasing (case-insensitive) and stable on ties", () => {
    fc.assert(
      fc.property(nodeListArb, (nodes) => {
        const sorted = sortByTitle(nodes);

        for (let i = 1; i < sorted.length; i++) {
          const prev = normalizeTitle(sorted[i - 1]);
          const curr = normalizeTitle(sorted[i]);
          const order = cmp(prev, curr);

          // Non-decreasing under the SAME comparison the sort uses (R3.4).
          expect(order <= 0).toBe(true);

          // Stable: when two adjacent titles are EQUAL under that comparison,
          // their original relative order (the `_idx` tag) is preserved (R3.5).
          if (order === 0) {
            expect(sorted[i - 1]._idx < sorted[i]._idx).toBe(true);
          }
        }
      }),
      { numRuns: 200 },
    );
  });

  // Property 3 — non-mutating (R3.3).
  it("Property 3: sortByTitle does not mutate the input array or its nodes", () => {
    fc.assert(
      fc.property(nodeListArb, (nodes) => {
        // Snapshot the input array order (by identity) and each node's own keys.
        const beforeRefs = [...nodes];
        const beforeSnapshots = nodes.map((n) => JSON.stringify(n));

        const sorted = sortByTitle(nodes);

        // A separate array instance.
        expect(sorted === nodes).toBe(false);

        // The input array keeps the same elements in the same order.
        expect(nodes.length).toBe(beforeRefs.length);
        for (let i = 0; i < nodes.length; i++) {
          expect(nodes[i] === beforeRefs[i]).toBe(true);
        }

        // Each node object is unchanged (same own-enumerable content).
        for (let i = 0; i < nodes.length; i++) {
          expect(JSON.stringify(nodes[i])).toBe(beforeSnapshots[i]);
        }
      }),
      { numRuns: 200 },
    );
  });
});

describe("home filtering (applyFilter) \u2014 Validates: Requirements 1.2, 1.4, 1.5, 1.6, 1.7", () => {
  // Property 4 — empty shows all; visibility = substring inclusion (R1.2, R1.4,
  // R1.5, R1.7).
  it("Property 4: empty query shows all; otherwise visible IFF normalized query is a substring of the card title or some child title", () => {
    fc.assert(
      fc.property(treeWithQueryArb, ({ tree, query }) => {
        const mount = renderHomeTree(tree);
        const cards = cardsOf(mount);
        const status = statusOf(mount);

        applyFilter(query, cards, status);

        const q = (query ?? "").trim().toLowerCase();

        if (q === "") {
          // Empty/whitespace query: every card visible (R1.2, R1.7).
          for (const card of cards) expect(card.hidden).toBe(false);
          return;
        }

        // Non-empty: a card is visible EXACTLY when the normalized query is a
        // substring of its own normalized title OR of some child's normalized
        // title (R1.4, R1.5). The `data-title` attributes carry the normalized
        // text the renderer wrote, which is the matching basis.
        for (const card of cards) {
          const titleHit = (card.dataset.title ?? "").includes(q);
          const childHit = [...card.querySelectorAll(".home-card__child")].some(
            (c) => (c.dataset.title ?? "").includes(q),
          );
          const expectedVisible = titleHit || childHit;
          expect(card.hidden).toBe(!expectedVisible);
        }
      }),
      { numRuns: 150 },
    );
  });

  // Property 5 — no-match status exact (R1.6).
  //
  // R1.6 is scoped to a NON-EMPTY query ("IF a non-empty Lookup_Query matches no
  // Topic_Card, THEN … display a 'no matching topics' message"). An empty or
  // whitespace-only query is governed by R1.2/R1.7 ("show all", status cleared)
  // and takes precedence — the design's `applyFilter` returns on an empty query
  // before ever touching the no-match status. So the "status shown IFF zero
  // visible" invariant is asserted for non-empty queries, and the empty-query
  // case is asserted separately to always hide the status (even for an empty
  // tree, where "all" is zero cards).
  it("Property 5: for a non-empty query the no-match status is shown IFF zero cards are visible; an empty query always hides it", () => {
    fc.assert(
      fc.property(treeWithQueryArb, ({ tree, query }) => {
        const mount = renderHomeTree(tree);
        const cards = cardsOf(mount);
        const status = statusOf(mount);

        applyFilter(query, cards, status);

        // The status region is present on every home render.
        expect(status).toBeTruthy();

        const q = (query ?? "").trim().toLowerCase();
        if (q === "") {
          // Empty/whitespace query: always hidden and cleared (R1.2, R1.7),
          // regardless of how many cards exist.
          expect(status.hidden).toBe(true);
          expect(status.textContent).toBe("");
          return;
        }

        const anyVisible = cards.some((card) => card.hidden === false);
        // Non-empty query: shown (not hidden) IFF nothing is visible (R1.6).
        expect(status.hidden).toBe(anyVisible);
        if (!anyVisible) {
          expect(status.textContent).toBe("No matching topics.");
        } else {
          expect(status.textContent).toBe("");
        }
      }),
      { numRuns: 150 },
    );
  });
});

describe("home toggle (toggleCard) \u2014 Validates: Requirements 2.3, 2.4, 2.7", () => {
  // Property 6 — toggle isolation + reversibility (R2.3, R2.4, R2.7).
  it("Property 6: toggling one card flips exactly that card and double-toggle is reversible", () => {
    fc.assert(
      fc.property(
        multiParentTreeArb,
        // Pick which card to toggle by index into the parent cards.
        fc.integer({ min: 0, max: 100 }),
        (tree, pick) => {
          const mount = renderHomeTree(tree);
          const cards = cardsOf(mount);

          // Only cards that actually have a toggle (parents) are togglable.
          const togglable = cards.filter(
            (c) => c.querySelector(".home-card__toggle") !== null,
          );
          // multiParentTreeArb guarantees >= 2 parents.
          expect(togglable.length >= 2).toBe(true);

          const target = togglable[pick % togglable.length];

          /** Snapshot every card's (aria-expanded, children.hidden) state. */
          const snapshot = () =>
            cards.map((c) => {
              const toggle = c.querySelector(".home-card__toggle");
              const children = c.querySelector(".home-card__children");
              return {
                card: c,
                expanded: toggle ? toggle.getAttribute("aria-expanded") : null,
                hidden: children ? children.hidden : null,
              };
            });

          const before = snapshot();

          // --- First toggle: exactly the target card changes (R2.3/R2.4/R2.7).
          toggleCard(target);
          const afterOne = snapshot();

          for (let i = 0; i < cards.length; i++) {
            const b = before[i];
            const a = afterOne[i];
            if (a.card === target) {
              // Target flipped both aria-expanded and children hidden.
              expect(a.expanded).toBe(b.expanded === "true" ? "false" : "true");
              expect(a.hidden).toBe(!b.hidden);
            } else {
              // Every other card is untouched (R2.7).
              expect(a.expanded).toBe(b.expanded);
              expect(a.hidden).toBe(b.hidden);
            }
          }

          // --- Second toggle: returns the target to its prior state (reversible).
          toggleCard(target);
          const afterTwo = snapshot();

          for (let i = 0; i < cards.length; i++) {
            expect(afterTwo[i].expanded).toBe(before[i].expanded);
            expect(afterTwo[i].hidden).toBe(before[i].hidden);
          }
        },
      ),
      { numRuns: 150 },
    );
  });
});
