// tests/src/lookup/empty-states.test.js
//
// Task 8.5 — the lookup panel's empty states (Requirements 7, 9; design.md —
// Components §4 "lookup-ui.js", `renderEmpty` / `renderEmptyLocalWithSearchAll`
// / the `searchAllDone` state).
//
// Three distinct zero-result situations, each with its own behaviour:
//
//   1. Zero Search_All results → the panel shows the "No other definitions
//      found" done row once Search_All loads nothing new (R8.8).
//   2. Zero LOCAL results with a non-null `loadGlobalIndex` → the panel stays
//      open showing "No definition in <scopeTitle>" with the Search_All button,
//      and does NOT auto-dismiss (R9.1, R9.4).
//   3. Zero local results with `loadGlobalIndex === null` (home, or a chain
//      that covers every glossary) → the auto-dismissing "No definition found"
//      empty message, gone after the dismiss timer (R9.2, R9.3).
//
// DOM: the shared linkedom DOM from tests/dom.js, pinned on the globals the way
// the other lookup DOM tests do. linkedom has no Selection API, so each case
// installs a minimal fake `getSelection`. For the auto-dismiss case the window
// `setTimeout` is captured so the scheduled callback can be fired
// deterministically (as error-handling.test.js does). `loadGlobalIndex`
// resolves on a microtask, so the Search_All-empty case flushes promises before
// asserting.

import { describe, it, expect } from "../../harness.js";
import { ensureDom } from "../../dom.js";

const dom = await ensureDom();
globalThis.document = dom.document;
globalThis.window = dom.window;

const { buildIndex } = await import("../../../src/lookup/search-index.js");
const { installLookup } = await import("../../../src/lookup/lookup-ui.js");

function useRealDom() {
  globalThis.document = dom.document;
  globalThis.window = dom.window;
}

const RECT = { left: 10, top: 20, bottom: 40, right: 60, width: 50, height: 20 };

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

function fire(el, type) {
  el.dispatchEvent(new dom.window.Event(type));
}

/** A local glossary that defines "Spike" so a matching selection resolves. */
const LOCAL = [
  {
    term: "Spike",
    definition: "A brief voltage pulse from a neuron.",
    pageRef: "/snn",
    source: { route: "/snn", title: "Spiking Neural Networks" },
  },
];

describe("empty states: Search_All found nothing new (R8.8)", () => {
  it("shows 'No other definitions found' when Search_All loads nothing new", async () => {
    useRealDom();
    const view = dom.window;
    const root = dom.document.createElement("div");
    root.textContent = "a spike here";
    dom.document.body.appendChild(root);
    const restore = fakeSelection(view, "spike");

    // A loader that returns no new matches (clean load, zero results).
    const loadGlobalIndex = async () => ({ matches: [], failures: false });

    try {
      installLookup(root, {
        localIndex: buildIndex(LOCAL),
        loadGlobalIndex,
        scopeTitle: "Spiking Neural Networks",
      });
      fire(root, "mouseup");

      const panel = dom.document.body.querySelector(".lookup-panel");
      expect(panel).toBeTruthy();
      // Activate Search_All, then let the loader resolve.
      fire(panel.querySelector(".lookup-panel__search-all"), "click");
      await flush();

      // The done row names "No other definitions found" and the idle button is
      // gone.
      const done = panel.querySelector(".lookup-panel__search-all--done");
      expect(done).toBeTruthy();
      expect(done.textContent).toBe("No other definitions found");
      expect(panel.querySelector(".lookup-panel__search-all")).toBe(null);
    } finally {
      restore();
      dom.document.body.querySelector(".lookup-panel")?.remove();
      root.remove();
    }
  });
});

describe("empty states: zero local results, Search_All available (R9.1, R9.4)", () => {
  it("keeps the panel open with the button and 'No definition in <scopeTitle>', no auto-dismiss", () => {
    useRealDom();
    const view = dom.window;
    const root = dom.document.createElement("div");
    root.textContent = "a zzzznotaterm here";
    dom.document.body.appendChild(root);
    const restore = fakeSelection(view, "zzzznotaterm");

    // Capture any scheduled timer so we can assert NONE was armed.
    let captured = null;
    const realSetTimeout = view.setTimeout;
    const realClearTimeout = view.clearTimeout;
    view.setTimeout = (fn, ms) => {
      captured = { fn, ms };
      return 1;
    };
    view.clearTimeout = () => {};

    const loadGlobalIndex = async () => ({ matches: [], failures: false });

    try {
      installLookup(root, {
        localIndex: buildIndex(LOCAL),
        loadGlobalIndex,
        scopeTitle: "Spiking Neural Networks",
      });
      fire(root, "mouseup");

      const panel = dom.document.body.querySelector(".lookup-panel");
      expect(panel).toBeTruthy();
      // The empty-local message names the scope and the Search_All button is
      // present so the reader can look beyond the chain.
      expect(panel.textContent.includes("No definition in Spiking Neural Networks")).toBe(true);
      expect(panel.querySelector(".lookup-panel__search-all")).toBeTruthy();
      // The panel stays open: no auto-dismiss timer was armed (R9.4).
      expect(captured).toBe(null);
      expect(panel.isConnected).toBe(true);
    } finally {
      view.setTimeout = realSetTimeout;
      view.clearTimeout = realClearTimeout;
      restore();
      dom.document.body.querySelector(".lookup-panel")?.remove();
      root.remove();
    }
  });
});

describe("empty states: zero local results, no Search_All → auto-dismiss (R9.2, R9.3)", () => {
  it("shows the auto-dismissing 'No definition found' empty message when loadGlobalIndex is null", () => {
    useRealDom();
    const view = dom.window;
    const root = dom.document.createElement("div");
    root.textContent = "a zzzznotaterm here";
    dom.document.body.appendChild(root);
    const restore = fakeSelection(view, "zzzznotaterm");

    // Capture the dismiss timer so it can be fired deterministically.
    let captured = null;
    const realSetTimeout = view.setTimeout;
    const realClearTimeout = view.clearTimeout;
    view.setTimeout = (fn, ms) => {
      captured = { fn, ms };
      return 1;
    };
    view.clearTimeout = () => {};

    try {
      // Home / chain-covers-all: no Search_All loader.
      installLookup(root, {
        localIndex: buildIndex(LOCAL),
        loadGlobalIndex: null,
        scopeTitle: "",
      });
      fire(root, "mouseup");

      const panel = dom.document.body.querySelector(".lookup-panel");
      expect(panel).toBeTruthy();
      // Flagged empty, carries the generic message, and has NO Search_All row.
      expect(panel.className.includes("lookup-panel--empty")).toBe(true);
      expect(panel.textContent.includes("No definition found")).toBe(true);
      expect(panel.querySelector(".lookup-panel__search-all")).toBe(null);

      // An auto-dismiss was scheduled, and firing it removes the panel.
      expect(captured).toBeTruthy();
      expect(captured.ms > 0).toBe(true);
      captured.fn();
      expect(dom.document.body.querySelector(".lookup-panel")).toBe(null);
    } finally {
      view.setTimeout = realSetTimeout;
      view.clearTimeout = realClearTimeout;
      restore();
      dom.document.body.querySelector(".lookup-panel")?.remove();
      root.remove();
    }
  });
});
