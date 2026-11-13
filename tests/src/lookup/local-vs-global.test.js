// tests/src/lookup/local-vs-global.test.js
//
// Task 10.5 — DOM example: the lookup panel partitions results by scope.
// Local_Results come ONLY from the current Scope_Chain's glossaries; the
// Search_All results come ONLY from glossaries OUTSIDE that chain (requirements
// 6.1 / 8.1, verified per R14.2; design.md — Testing Strategy table row
// "tests/src/lookup/local-vs-global.test.js").
//
// This is the DOM-level companion to the pure Property 5 test
// (also-defined-in.property.test.js), which pins the data-model partition. Here
// we drive the REAL panel: `installLookup(root, { localIndex, loadGlobalIndex,
// scopeTitle })` with a `localIndex` built over chain-scope TermEntries and a
// `loadGlobalIndex` that returns matches whose definitions carry non-chain
// source routes. We then assert:
//
//   - the local match the panel shows carries ONLY chain-scope source routes
//     (R6.1); and
//   - once Search_All runs, every appended global-result row carries ONLY
//     non-chain source routes (R8.1).
//
// DOM: the shared linkedom DOM from tests/dom.js, pinned on the globals the way
// search-all-row.test.js / partial-failure.test.js do. linkedom ships no
// Selection API, so each case installs a fake `getSelection` (selected text + a
// stub range rect) and dispatches a real `mouseup` to drive `handleSelection`.
// `loadGlobalIndex` resolves on a microtask, so we flush pending promises
// before asserting the results-state DOM.

import { describe, it, expect } from "../../harness.js";
import { ensureDom } from "../../dom.js";

const dom = await ensureDom();
globalThis.document = dom.document;
globalThis.window = dom.window;

const { buildIndex } = await import("../../../src/lookup/search-index.js");
const { installLookup } = await import("../../../src/lookup/lookup-ui.js");

/** The routes that make up the current Scope_Chain (local). */
const CHAIN_ROUTES = new Set(["/snn", "/snn/spiking"]);

/** A fresh selection rect the panel anchors to. */
const RECT = { left: 10, top: 20, bottom: 40, right: 60, width: 50, height: 20 };

/**
 * The local glossary: TermEntries whose `source` route is INSIDE the chain, so
 * the merged `localIndex` resolves a selection to chain-scope matches (R6.1).
 * Two distinct chain glossaries contribute so the partition is not trivially a
 * single route.
 */
const LOCAL_TERMS = [
  {
    term: "Spike",
    definition: "A brief all-or-nothing voltage pulse fired by a neuron.",
    pageRef: "/snn",
    source: { route: "/snn", title: "Spiking Neural Networks" },
  },
  {
    term: "Spike train",
    definition: "A time-ordered sequence of spikes from one neuron.",
    pageRef: "/snn/spiking",
    source: { route: "/snn/spiking", title: "Spiking Dynamics" },
  },
];

/**
 * A shaped global `Match` (as `loadGlobalIndex` returns in `{ matches }`): a
 * term whose definitions carry a NON-chain source route, so the panel labels it
 * "from <Topic>" / "Also defined in <Topic>" and — crucially — its source lies
 * outside the chain (R8.1). Each match is a NEW term (not shown locally) so it
 * survives `withoutShownDefinitions` and appears as a Search_All result row.
 *
 * @param {string} term
 * @param {string} definition
 * @param {{route: string, title: string}} source A NON-chain source.
 */
function globalMatch(term, definition, source) {
  return {
    term,
    matchKind: "contains",
    definitions: [{ term, definition, pageRef: source.route, acronym: null, source }],
  };
}

/** Install a fake `getSelection` returning `text` + a stub range rect. */
function fakeSelection(view, text) {
  const real = view.getSelection;
  view.getSelection = () => ({
    toString() {
      return text;
    },
    rangeCount: 1,
    getRangeAt() {
      return { getBoundingClientRect: () => RECT };
    },
  });
  return () => {
    view.getSelection = real;
  };
}

/** Let the microtask-scheduled `loadGlobalIndex` resolve. */
async function flush() {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

/** Dispatch a real DOM event of `type` on `el`. */
function fire(el, type) {
  el.dispatchEvent(new dom.window.Event(type));
}

/**
 * Install the panel against a stubbed selection of `text`, and return handles
 * to step through the local matches, run Search_All, read the global result
 * rows, and tear everything down.
 *
 * @param {string} text The selected text to resolve.
 * @param {(selectionText: string) => Promise<{matches: any[], failures: boolean}>} loadGlobalIndex
 */
function openPanel(text, loadGlobalIndex) {
  const view = dom.window;
  const root = dom.document.createElement("div");
  root.textContent = `a ${text} here`;
  dom.document.body.appendChild(root);

  const restore = fakeSelection(view, text);
  installLookup(root, {
    localIndex: buildIndex(LOCAL_TERMS),
    loadGlobalIndex,
    scopeTitle: "Spiking Neural Networks",
  });
  fire(root, "mouseup");

  const panel = () => dom.document.body.querySelector(".lookup-panel");
  return {
    panel,
    searchAllButton: () => panel()?.querySelector(".lookup-panel__search-all"),
    globalRows: () => [...(panel()?.querySelectorAll(".lookup-panel__global-result") ?? [])],
    /** The ▼ "next match" control, to step through local matches. */
    next: () =>
      [...panel().querySelectorAll(".lookup-panel__match-button")].find((b) => b.textContent === "▼"),
    teardown() {
      restore();
      panel()?.remove();
      root.remove();
    },
  };
}

describe("lookup panel: local vs global partition (R14.2 / R6.1 / R8.1)", () => {
  it("shows local results only from chain glossaries and Search_All results only from non-chain glossaries", async () => {
    // Search_All returns ONLY non-chain matches (routes outside CHAIN_ROUTES).
    const loadGlobalIndex = async () => ({
      matches: [
        globalMatch("Transient", "A sharp short-lived excursion on a signal line.", {
          route: "/analog-design",
          title: "Analog Design",
        }),
        globalMatch("Impulse", "An idealized instantaneous input used in system analysis.", {
          route: "/signals",
          title: "Signals and Systems",
        }),
      ],
      failures: false,
    });

    const t = openPanel("spike", loadGlobalIndex);
    try {
      // ---- Local side (R6.1): every local match's source route is in the chain.
      const localRoutes = [];
      // The panel shows one local match at a time; step through them all via ▼.
      for (let i = 0; i < LOCAL_TERMS.length; i++) {
        const link = t.panel().querySelector(".lookup-panel__link");
        // The link's href encodes the pageRef (the chain route this def lives on).
        expect(link).toBeTruthy();
        localRoutes.push(link.getAttribute("href"));
        const down = t.next();
        // On the last local match ▼ moves focus to Search_All rather than cycling.
        if (i < LOCAL_TERMS.length - 1) fire(down, "click");
      }
      for (const href of localRoutes) {
        // href is a hash route like "#/snn"; strip the leading '#'.
        const route = href.replace(/^#/, "");
        expect(CHAIN_ROUTES.has(route)).toBe(true);
      }

      // ---- Global side (R8.1): run Search_All and inspect the appended rows.
      t.searchAllButton().dispatchEvent(new dom.window.Event("click"));
      await flush();

      const rows = t.globalRows();
      expect(rows.length).toBe(2);
      for (const row of rows) {
        const link = row.querySelector(".lookup-panel__link");
        expect(link).toBeTruthy();
        const route = link.getAttribute("href").replace(/^#/, "");
        // Every Search_All result's source route is OUTSIDE the chain (R8.1).
        expect(CHAIN_ROUTES.has(route)).toBe(false);
      }

      // And the Search_All rows name their non-chain topics via the row label.
      const labels = rows.map((r) => r.querySelector(".lookup-panel__source").textContent);
      expect(labels.includes("from Analog Design")).toBe(true);
      expect(labels.includes("from Signals and Systems")).toBe(true);
    } finally {
      t.teardown();
    }
  });
});
