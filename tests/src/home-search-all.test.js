// tests/src/home-search-all.test.js
//
// Task 11.2 — the Home_Page search behaviour (Requirements 14.6, 10.1, 10.2;
// design.md — Components §7 "home.js" and "The four runtime flows").
//
// Two guarantees are pinned here:
//
//   - R14.6 / R10.1: the home page renders NO Search_All control. The
//     `.lookup-panel__search-all` button is a Lookup_Panel row; on the home
//     page the panel searches every Glossary_File directly, so that control
//     never appears. The home term search is a different mechanism (the
//     `.home-terms` list under the search box) and must not render it either.
//
//   - R10.2: the home term search covers EVERY Glossary_File. `installHome`
//     (task 11.1) now takes a lazy `loadAllTerms: () => Promise<TermEntry[]>`
//     as its third argument; on the first `input` event it awaits that accessor
//     ONCE and runs `findTerms(allTerms, query)`. This suite feeds it a
//     `loadAllTerms` that yields terms drawn from several glossaries (distinct
//     `source` routes and `pageRef`s), types a query that matches a term in
//     each glossary, and asserts the `.home-terms` list shows matching terms
//     from more than one glossary.
//
// DOM SETUP (no build step, no install)
// -------------------------------------
// The home build (`renderPage` → `renderHome` → `installHome`) uses real DOM
// APIs (`querySelector`/`dataset`/`hidden`/`addEventListener`), so this suite
// uses the shared, spec-shaped linkedom DOM from `tests/dom.js` and RE-PINS the
// ambient `globalThis.document`/`window` at the top of every case — other test
// files install their own `document` stub at import time and the runner
// interleaves cases, so whichever ran last would otherwise win (see
// home-behavior.test.js / home-structure.test.js for the same rationale).
//
// ASYNC TERM SEARCH
// -----------------
// The term search is async now: the first keystroke awaits `loadAllTerms()`
// before populating `.home-terms`. So each case dispatches `input`, then flushes
// pending promises/macrotasks before asserting the list — the flush pattern
// from search-all-row.test.js (a couple of `setTimeout(0)` turns drain the
// `Promise.resolve().then(...)` chain the module awaits).

import { describe, it, expect } from "../harness.js";
import { ensureDom } from "../dom.js";

// Install the real DOM once and pin it as the ambient globals BEFORE importing
// the renderer (renderer.js reads the `document` global when its builders run).
const dom = await ensureDom();
globalThis.document = dom.document;
globalThis.window = dom.window;

const { renderPage } = await import("../../src/renderer.js");

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// A tiny root tree: three top-level topics, enough for a real home build. The
// term search does not depend on the tree, so the cards here just give the
// home grid something to render.
const TREE = {
  slug: "root",
  title: "Root",
  children: [
    { slug: "snn", title: "Spiking Neural Networks" },
    { slug: "analog-design", title: "Analog Design" },
    { slug: "communication-protocols", title: "Communication Protocols" },
  ],
};

// Terms drawn from THREE different glossaries, each identified by a distinct
// `source.route` and `pageRef`. Every term contains the token "signal" so a
// single query matches across all three glossaries — the concatenated set the
// home search is meant to cover.
const SNN_TERMS = [
  {
    term: "Spike signal",
    definition: "A brief voltage pulse carrying information in a spiking network.",
    pageRef: "/snn",
    acronym: null,
    source: { route: "/snn", title: "Spiking Neural Networks" },
  },
];
const ANALOG_TERMS = [
  {
    term: "Signal integrity",
    definition: "The quality of an electrical signal as it travels a path.",
    pageRef: "/analog-design",
    acronym: null,
    source: { route: "/analog-design", title: "Analog Design" },
  },
];
const PROTOCOL_TERMS = [
  {
    term: "Signal ground",
    definition: "The common return path for a protocol's signals.",
    pageRef: "/communication-protocols",
    acronym: null,
    source: { route: "/communication-protocols", title: "Communication Protocols" },
  },
];

/** The full concatenated glossary set the home search must cover. */
const ALL_TERMS = [...SNN_TERMS, ...ANALOG_TERMS, ...PROTOCOL_TERMS];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Re-pin the ambient DOM to this suite's real linkedom document and return a
 * fresh, detached mount element.
 * @returns {HTMLElement}
 */
function freshMount() {
  globalThis.document = dom.document;
  globalThis.window = dom.window;
  return dom.document.createElement("div");
}

/**
 * Build the Home_Page for `TREE`, wiring a lazy `loadAllTerms` accessor onto
 * the resolution so `renderHome` passes it into `installHome`. Returns the
 * built `.home` element plus a spy count of how many times the accessor ran.
 *
 * @param {() => Promise<object[]>} loadAllTerms Lazy full-term accessor.
 * @returns {{home: HTMLElement, calls: () => number}}
 */
function buildHome(loadAllTerms) {
  const mount = freshMount();
  let calls = 0;
  const spiedLoad = () => {
    calls += 1;
    return loadAllTerms();
  };
  renderPage({ node: null, path: [], tree: TREE, loadAllTerms: spiedLoad }, null, mount);
  return { home: mount.querySelector(".home"), calls: () => calls };
}

/** Type `value` into the home search input and dispatch a real `input` event. */
function type(home, value) {
  const input = home.querySelector(".home-search__input");
  input.value = value;
  input.dispatchEvent(new dom.window.Event("input"));
}

/**
 * Drain the microtask/macrotask chain the term search awaits on its first
 * keystroke (the module does `await Promise.resolve(loadAllTerms())`). A couple
 * of `setTimeout(0)` turns are enough, as in search-all-row.test.js.
 */
async function flush() {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

/** The term heading texts shown in the `.home-terms` list, in order. */
function termTexts(home) {
  return [...home.querySelectorAll(".home-terms .home-term__term")].map((el) => el.textContent);
}

/** The page-link hrefs shown in the `.home-terms` list, in order. */
function termHrefs(home) {
  return [...home.querySelectorAll(".home-terms .home-term__link")].map((a) =>
    a.getAttribute("href"),
  );
}

// ---------------------------------------------------------------------------
// R14.6 / R10.1 — the home page renders no Search_All control
// ---------------------------------------------------------------------------

describe("home shows no Search_All control (R14.6, R10.1)", () => {
  it("renders no .lookup-panel__search-all anywhere in the home view", () => {
    const { home } = buildHome(async () => ALL_TERMS);
    expect(home).toBeTruthy();
    // The Search_All row is a Lookup_Panel control; the home page never renders
    // it (the home lookup searches every glossary directly).
    expect(home.querySelector(".lookup-panel__search-all")).toBe(null);
  });

  it("still renders no Search_All control after a term search populates results", async () => {
    const { home } = buildHome(async () => ALL_TERMS);
    type(home, "signal");
    await flush();
    // Results are present, but the term search is not the Lookup_Panel and must
    // not surface a Search_All control.
    expect(home.querySelector(".home-terms .home-term")).toBeTruthy();
    expect(home.querySelector(".lookup-panel__search-all")).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// R10.2 — the home term search covers every Glossary_File
// ---------------------------------------------------------------------------

describe("home term search covers every Glossary_File (R10.2)", () => {
  it("lists matching terms drawn from more than one glossary", async () => {
    const { home } = buildHome(async () => ALL_TERMS);
    const section = home.querySelector(".home-terms");
    expect(section.hidden).toBe(true);

    // "signal" matches exactly one term in EACH of the three glossaries.
    type(home, "signal");
    await flush();

    expect(section.hidden).toBe(false);

    // Every glossary's matching term is listed — the set is drawn from more
    // than one glossary, proving the search covered the whole concatenated set.
    const texts = termTexts(home);
    expect(texts.includes("Spike signal")).toBe(true);
    expect(texts.includes("Signal integrity")).toBe(true);
    expect(texts.includes("Signal ground")).toBe(true);

    // The results carry each glossary's own page route, so they demonstrably
    // come from distinct Glossary_Files (not one merged/aliased source).
    const hrefs = termHrefs(home);
    const distinctRoutes = new Set(hrefs);
    expect(distinctRoutes.has("#/snn")).toBe(true);
    expect(distinctRoutes.has("#/analog-design")).toBe(true);
    expect(distinctRoutes.has("#/communication-protocols")).toBe(true);
    // More than one glossary is represented.
    expect(distinctRoutes.size > 1).toBe(true);
  });

  it("awaits loadAllTerms exactly once and reuses it across keystrokes", async () => {
    const { home, calls } = buildHome(async () => ALL_TERMS);

    type(home, "signal");
    await flush();
    expect(calls()).toBe(1);

    // A second keystroke reuses the memoized set — no further load.
    type(home, "signal ground");
    await flush();
    expect(calls()).toBe(1);
    // The narrower query still resolves against the full concatenated set.
    expect(termTexts(home)).toEqual(["Signal ground"]);
  });

  it("does not load the glossary set until the first keystroke (lazy)", () => {
    const { calls } = buildHome(async () => ALL_TERMS);
    // Building the home view must not trigger the accessor; it is awaited only
    // on the first `input` event (R10.3 laziness, exercised at the seam here).
    expect(calls()).toBe(0);
  });
});
