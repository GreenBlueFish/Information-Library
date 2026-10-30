// tests/src/home-behavior.test.js
//
// Behavior tests for the Home_Page interactivity module `src/home.js` — task
// 5.3 — Requirements 1.2, 1.4, 1.5, 1.6, 1.7 (live Topic_Lookup filter: empty
// shows all, title-substring narrows, no-match status, clearing restores) and
// 2.3, 2.4, 2.7, 2.8 (collapsible subtopics: toggle reveals/collapses one card
// without touching others, and a subtopic-only match expands + flags its card).
//
// Unlike `home-structure.test.js` (task 5.2), which asserts the *shape* of the
// built DOM, this suite drives the *behavior* `installHome` wires: it builds a
// real home DOM via `renderPage(resolution, null, mount)` (which calls
// `installHome` at the end of `renderHome`, so the filter + toggles are already
// wired), then exercises the behavior two ways:
//   - dispatching real DOM events (`input`, `click`) to PROVE `installHome`
//     actually attached listeners; and
//   - calling `applyFilter`/`toggleCard` directly where that keeps a filter
//     assertion crisp.
//
// DOM SETUP (no build step, no install)
// -------------------------------------
// `installHome`/`applyFilter`/`toggleCard` use real DOM APIs the minimal stub
// used by renderer.test.js does not implement (`querySelector`/
// `querySelectorAll`/`addEventListener`/`dataset`/`hidden`/`classList`), so this
// suite uses the shared, spec-shaped DOM from `tests/dom.js` (`ensureDom()`) —
// the same real DOM the boot/integration and home-structure suites use.
//
// Other test files in this shared Node process install their own minimal
// `document` stub at import time, and the runner interleaves every file's cases,
// so this suite RE-PINS the ambient `globalThis.document`/`window` to the real
// linkedom DOM at the start of every test (via `freshHome()`). renderer.js reads
// the `document` global at call time, so the global must point at this real DOM
// for the home build and its wiring to work. See boot-navigation.test.js and
// home-structure.test.js for the same pinning rationale.

import { describe, it, expect } from "../harness.js";
import { ensureDom } from "../dom.js";

// Install the real DOM once and pin it as the ambient globals BEFORE importing
// the modules under test (renderer.js reads `document` when its builders run).
const dom = await ensureDom();
globalThis.document = dom.document;
globalThis.window = dom.window;

// `renderPage` builds + wires the home view; `applyFilter`/`toggleCard` are the
// behavior primitives `installHome` attaches, exercised directly where useful.
const { renderPage } = await import("../../src/renderer.js");
const { applyFilter, toggleCard } = await import("../../src/home.js");

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
 * Render the Home_Page for a given root topic tree and return the built `.home`
 * element. The home resolution carries `node: null` (home route) and the tree
 * on `resolution.tree`; `renderHome` reads the root children and calls
 * `installHome` at the end, so the returned DOM is already wired.
 * @param {object} tree The root TopicNode whose `children` are the root topics.
 * @returns {HTMLElement} The built `.home` element.
 */
function buildHome(tree) {
  const mount = freshHome();
  renderPage({ node: null, path: [], tree }, null, mount);
  return mount.querySelector(".home");
}

/** The `.home-card` elements, in document order. */
function cards(home) {
  return [...home.querySelectorAll(".home-card")];
}

/** The `.home-search__input`. */
function input(home) {
  return home.querySelector(".home-search__input");
}

/** The `.home-search__status` region. */
function status(home) {
  return home.querySelector(".home-search__status");
}

/**
 * Type `value` into the search input and dispatch a real `input` event, so the
 * assertion exercises the listener `installHome` wired (not just `applyFilter`).
 * @param {HTMLElement} home
 * @param {string} value
 */
function type(home, value) {
  const el = input(home);
  el.value = value;
  el.dispatchEvent(new dom.window.Event("input"));
}

/** Click a `.home-card__toggle`, dispatching a real `click` event. */
function clickToggle(card) {
  const toggle = card.querySelector(".home-card__toggle");
  toggle.dispatchEvent(new dom.window.Event("click"));
}

/** Map cards to their normalized `data-title` (handy for match assertions). */
function cardTitle(card) {
  return card.dataset.title;
}

/** Find the card whose link text equals `title`. */
function cardByTitle(home, title) {
  return cards(home).find(
    (c) => c.querySelector(".home-card__link").textContent === title,
  );
}

// A small, deterministic tree reused across the filter tests: three root topics
// with distinct titles, one of them (Game Theory) carrying subtopics so the
// subtopic-match cases have something to match.
function sampleTree() {
  return {
    slug: "root",
    title: "Root",
    children: [
      { slug: "calculus", title: "Calculus" },
      {
        slug: "game-theory",
        title: "Game Theory",
        children: [
          { slug: "nash", title: "Nash Equilibrium" },
          { slug: "pd", title: "Prisoners Dilemma" },
        ],
      },
      { slug: "snn", title: "Spiking Neural Networks" },
    ],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("home behavior (installHome / applyFilter / toggleCard)", () => {
  // =========================================================================
  // R1.2 — an empty Lookup_Query leaves every card visible and the status
  // region hidden. Driven through a real dispatched `input` event so the test
  // also proves `installHome` wired the input listener.
  // =========================================================================
  describe("empty query shows all, status hidden (R1.2)", () => {
    it("every card is visible and the status is hidden when the query is empty", () => {
      const home = buildHome(sampleTree());

      // Dispatch an input event with an empty value — proves the wiring runs.
      type(home, "");

      for (const card of cards(home)) {
        expect(card.hidden).toBe(false);
      }
      expect(status(home).hidden).toBe(true);
      expect(status(home).textContent).toBe("");
    });
  });

  // =========================================================================
  // R1.4, R1.5 — a title-substring query keeps matching cards visible and hides
  // the rest; the status stays hidden while something matches. Driven via a real
  // dispatched event (the primary proof that `installHome` wired `input`).
  // =========================================================================
  describe("title-substring query narrows the set (R1.4, R1.5)", () => {
    it("hides non-matching cards, keeps the matching one, status hidden", () => {
      const home = buildHome(sampleTree());

      // "calc" is a substring of "Calculus" only.
      type(home, "calc");

      const calculus = cardByTitle(home, "Calculus");
      const gameTheory = cardByTitle(home, "Game Theory");
      const snn = cardByTitle(home, "Spiking Neural Networks");

      expect(calculus.hidden).toBe(false);
      expect(gameTheory.hidden).toBe(true);
      expect(snn.hidden).toBe(true);

      // Something matched, so no "no matching topics" status.
      expect(status(home).hidden).toBe(true);
      expect(status(home).textContent).toBe("");
    });
  });

  // =========================================================================
  // R1.7 — clearing the query back to empty restores every card to visible.
  // =========================================================================
  describe("clearing the query restores all cards (R1.7)", () => {
    it("after a narrowing query, an empty query shows all cards again", () => {
      const home = buildHome(sampleTree());

      // First narrow to a single card…
      type(home, "calc");
      expect(cardByTitle(home, "Game Theory").hidden).toBe(true);
      expect(cardByTitle(home, "Spiking Neural Networks").hidden).toBe(true);

      // …then clear it and confirm everything is visible again.
      type(home, "");
      for (const card of cards(home)) {
        expect(card.hidden).toBe(false);
      }
      expect(status(home).hidden).toBe(true);
    });
  });

  // =========================================================================
  // R1.4, R2.8 — a query that matches ONLY a subtopic (not the parent title)
  // keeps the parent card visible, auto-expands it (toggle aria-expanded="true",
  // children not hidden), flags the matching `.home-card__child` with
  // `.home-card__child--match`, and leaves non-matching children unflagged.
  // =========================================================================
  describe("subtopic-only match expands + flags the card (R1.4, R2.8)", () => {
    it("keeps the card visible, expands it, and marks only the matching subtopic", () => {
      const home = buildHome(sampleTree());

      // "nash" matches the Nash Equilibrium subtopic, but NOT "Game Theory".
      type(home, "nash");

      const gameTheory = cardByTitle(home, "Game Theory");

      // The parent card stays visible even though its own title did not match.
      expect(gameTheory.hidden).toBe(false);
      // The other cards (no title or subtopic match) are hidden.
      expect(cardByTitle(home, "Calculus").hidden).toBe(true);
      expect(cardByTitle(home, "Spiking Neural Networks").hidden).toBe(true);

      // The card is auto-expanded so the learner can see why it matched (R2.8).
      const toggle = gameTheory.querySelector(".home-card__toggle");
      expect(toggle.getAttribute("aria-expanded")).toBe("true");
      const children = gameTheory.querySelector(".home-card__children");
      expect(children.hidden).toBe(false);

      // Exactly the matching subtopic is flagged; the non-matching one is not.
      const kids = [...gameTheory.querySelectorAll(".home-card__child")];
      const nash = kids.find((li) => li.textContent === "Nash Equilibrium");
      const pd = kids.find((li) => li.textContent === "Prisoners Dilemma");
      expect(nash.classList.contains("home-card__child--match")).toBe(true);
      expect(pd.classList.contains("home-card__child--match")).toBe(false);

      // The status stays hidden because a card matched.
      expect(status(home).hidden).toBe(true);
    });
  });

  // =========================================================================
  // R1.6 — a query matching nothing hides every card and shows the
  // "No matching topics." status.
  // =========================================================================
  describe("no-match query shows the status (R1.6)", () => {
    it("hides all cards and reveals the 'No matching topics.' status", () => {
      const home = buildHome(sampleTree());

      type(home, "zzzznomatch");

      for (const card of cards(home)) {
        expect(card.hidden).toBe(true);
      }
      const st = status(home);
      expect(st.hidden).toBe(false);
      expect(st.textContent).toBe("No matching topics.");
    });
  });

  // =========================================================================
  // R2.3, R2.4, R2.7 — clicking a card's toggle expands it (aria-expanded true,
  // children shown); clicking again collapses it (aria-expanded false, children
  // hidden); a SECOND card's state is unchanged throughout. The click is a real
  // dispatched event, proving `installHome` wired the toggle.
  // =========================================================================
  describe("toggle expand/collapse is isolated + reversible (R2.3, R2.4, R2.7)", () => {
    it("a click expands then a second click collapses one card; another card is unaffected", () => {
      // A tree with TWO parent cards so we can prove isolation (R2.7).
      const home = buildHome({
        slug: "root",
        title: "Root",
        children: [
          {
            slug: "alpha",
            title: "Alpha",
            children: [{ slug: "a1", title: "Alpha One" }],
          },
          {
            slug: "beta",
            title: "Beta",
            children: [{ slug: "b1", title: "Beta One" }],
          },
        ],
      });

      const alpha = cardByTitle(home, "Alpha");
      const beta = cardByTitle(home, "Beta");

      const alphaToggle = alpha.querySelector(".home-card__toggle");
      const alphaChildren = alpha.querySelector(".home-card__children");
      const betaToggle = beta.querySelector(".home-card__toggle");
      const betaChildren = beta.querySelector(".home-card__children");

      // Both start collapsed (R2.1 baseline).
      expect(alphaToggle.getAttribute("aria-expanded")).toBe("false");
      expect(alphaChildren.hidden).toBe(true);
      expect(betaToggle.getAttribute("aria-expanded")).toBe("false");
      expect(betaChildren.hidden).toBe(true);

      // First click on Alpha expands it (R2.3)…
      clickToggle(alpha);
      expect(alphaToggle.getAttribute("aria-expanded")).toBe("true");
      expect(alphaChildren.hidden).toBe(false);
      // …and Beta is untouched (R2.7).
      expect(betaToggle.getAttribute("aria-expanded")).toBe("false");
      expect(betaChildren.hidden).toBe(true);

      // Second click on Alpha collapses it back — reversibility (R2.4)…
      clickToggle(alpha);
      expect(alphaToggle.getAttribute("aria-expanded")).toBe("false");
      expect(alphaChildren.hidden).toBe(true);
      // …and Beta is STILL untouched (R2.7).
      expect(betaToggle.getAttribute("aria-expanded")).toBe("false");
      expect(betaChildren.hidden).toBe(true);
    });
  });

  // =========================================================================
  // R1.5 — matching is case-insensitive under Normalized comparison: an
  // uppercase query matches a lowercase title/subtopic and vice versa. Driven
  // partly through `applyFilter` directly (crisp) and partly via a dispatched
  // event, so both the primitive and the wiring are covered.
  // =========================================================================
  describe("matching is case-insensitive (R1.5)", () => {
    it("an UPPERCASE query matches a mixed/lowercase title", () => {
      const home = buildHome(sampleTree());

      // "CALC" (uppercase) must match "Calculus".
      applyFilter("CALC", cards(home), status(home));

      expect(cardByTitle(home, "Calculus").hidden).toBe(false);
      expect(cardByTitle(home, "Game Theory").hidden).toBe(true);
      expect(status(home).hidden).toBe(true);
    });

    it("a lowercase query matches an uppercase subtopic and expands its card", () => {
      const home = buildHome(sampleTree());

      // "NASH" (uppercase) dispatched through the real input listener must match
      // the "Nash Equilibrium" subtopic case-insensitively.
      type(home, "NASH");

      const gameTheory = cardByTitle(home, "Game Theory");
      expect(gameTheory.hidden).toBe(false);
      expect(
        gameTheory.querySelector(".home-card__toggle").getAttribute("aria-expanded"),
      ).toBe("true");

      const nash = [...gameTheory.querySelectorAll(".home-card__child")].find(
        (li) => li.textContent === "Nash Equilibrium",
      );
      expect(nash.classList.contains("home-card__child--match")).toBe(true);
    });
  });
});
