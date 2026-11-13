// tests/src/lookup/partial-failure.test.js
//
// Requirement 8.9 (verified per R14.7): a Search_All run where SOME glossaries
// loaded (producing results) but AT LEAST ONE failed is a PARTIAL failure. The
// Lookup_Panel must still show the results from the glossaries that loaded AND
// add the note "Some topics couldn't be searched", without propagating an
// unhandled error to the page.
//
// This is the DOM-level companion to the pure matches tests: it drives the real
// `installLookup(rootEl, { localIndex, loadGlobalIndex, scopeTitle })` with a
// stubbed selection, clicks the "Search all" control, flushes the microtasks
// that `runSearchAll` schedules (`loadGlobalIndex` is awaited through a couple
// of `Promise.resolve().then(...)` hops), and inspects the panel.
//
// DOM: the shared linkedom DOM from tests/dom.js, pinned on the globals the way
// matches.test.js / definition-card.source.test.js do. linkedom ships no
// Selection API or range geometry, so — exactly like error-handling.test.js and
// matches.test.js — we install a fake `getSelection()` that returns the
// selected text plus a stub range with a bounding rect, then dispatch a real
// `mouseup` on the root to drive the module's own `handleSelection`.

import { describe, it, expect } from "../../harness.js";
import { ensureDom } from "../../dom.js";

const dom = await ensureDom();
globalThis.document = dom.document;
globalThis.window = dom.window;

const { buildIndex } = await import("../../../src/lookup/search-index.js");
const { installLookup } = await import("../../../src/lookup/lookup-ui.js");

/**
 * Local Scope_Chain glossary: a single "Spike" entry carrying its source, so
 * the panel resolves a local match for the selection "spike" and the
 * Search_All row appears as the last row.
 */
const LOCAL_TERMS = [
  {
    term: "Spike",
    definition: "A brief all-or-nothing voltage pulse fired by a neuron.",
    pageRef: "/snn",
    source: { route: "/snn", title: "Spiking Neural Networks" },
  },
];

/**
 * A shaped global `Match` (as `loadGlobalIndex` returns in `{ matches }`): a
 * term NOT shown locally so it survives `withoutShownDefinitions`, carrying its
 * own `source` so the panel can label it "from <Topic>". `matchKind` "contains"
 * mirrors a related-term global hit.
 *
 * @param {string} term
 * @param {string} definition
 * @param {{route: string, title: string}} source
 * @returns {import("../../../src/lookup/matches.js").Match}
 */
function globalMatch(term, definition, source) {
  return {
    term,
    matchKind: "contains",
    definitions: [{ term, definition, pageRef: source.route, acronym: null, source }],
  };
}

/**
 * Install the panel against a stubbed selection of `text`, returning handles to
 * run Search_All and inspect/tear down the panel.
 *
 * @param {string} text The selected text to resolve.
 * @param {(selectionText: string) => Promise<{matches: any[], failures: boolean}>} loadGlobalIndex
 */
function setup(text, loadGlobalIndex) {
  const view = dom.window;
  const root = dom.document.createElement("div");
  root.textContent = text;
  dom.document.body.appendChild(root);

  const realGetSelection = view.getSelection;
  view.getSelection = () => ({
    toString: () => text,
    rangeCount: 1,
    getRangeAt: () => ({
      getBoundingClientRect: () => ({ left: 0, top: 0, bottom: 10, right: 10 }),
    }),
  });

  installLookup(root, {
    localIndex: buildIndex(LOCAL_TERMS),
    loadGlobalIndex,
    scopeTitle: "Spiking Neural Networks",
  });
  root.dispatchEvent(new view.Event("mouseup"));

  return {
    panel: () => dom.document.body.querySelector(".lookup-panel"),
    searchAllButton: () => dom.document.body.querySelector(".lookup-panel__search-all"),
    noteText: () => {
      const note = dom.document.body.querySelector(".lookup-panel__note");
      return note ? note.textContent : null;
    },
    globalRows: () => [...dom.document.body.querySelectorAll(".lookup-panel__global-result")],
    done: () => {
      view.getSelection = realGetSelection;
      root.remove();
      dom.document.body.querySelector(".lookup-panel")?.remove();
    },
  };
}

/**
 * Let the microtasks `runSearchAll` schedules settle. The loader is awaited
 * through `Promise.resolve().then(() => loadGlobalIndex(text)).then(...)`, so a
 * couple of awaited `Promise.resolve()` turns drain every hop (including the
 * loader's own resolution) before we read the DOM.
 */
async function flush() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe("lookup panel: partial Search_All failure (Req 8.9 / R14.7)", () => {
  it("shows the loaded results AND the 'Some topics couldn't be searched' note", async () => {
    // One glossary loaded (two results), at least one failed → failures: true.
    const loadGlobalIndex = async () => ({
      matches: [
        globalMatch("Action Potential", "The spike's propagating signal along an axon.", {
          route: "/neuroscience",
          title: "Neuroscience",
        }),
        globalMatch("Spike Train", "A time-ordered sequence of spikes.", {
          route: "/analog-design",
          title: "Analog Design",
        }),
      ],
      failures: true,
    });

    const t = setup("spike", loadGlobalIndex);
    try {
      const button = t.searchAllButton();
      // The Search_All control is present as the last row of a resolved local
      // panel (R7.1) before it runs.
      expect(Boolean(button)).toBe(true);

      button.dispatchEvent(new dom.window.Event("click"));
      await flush();

      // The loaded glossaries' results are shown ...
      const rows = t.globalRows();
      expect(rows.length).toBe(2);
      const rowText = rows.map((r) => r.textContent).join(" ");
      expect(rowText.includes("Action Potential")).toBe(true);
      expect(rowText.includes("Spike Train")).toBe(true);

      // ... together with the partial-failure note (R8.9).
      expect(t.noteText()).toBe("Some topics couldn't be searched");

      // The idle Search_All button has been replaced by the results.
      expect(t.searchAllButton()).toBe(null);
    } finally {
      t.done();
    }
  });

  it("does not propagate an unhandled error when some glossaries fail (R8.9)", async () => {
    // A loader that resolves with a partial failure must never throw into the
    // page; the panel simply renders results + note.
    const loadGlobalIndex = async () => ({
      matches: [
        globalMatch("Refractory Period", "The brief window after a spike when none can fire.", {
          route: "/neuroscience",
          title: "Neuroscience",
        }),
      ],
      failures: true,
    });

    const t = setup("spike", loadGlobalIndex);
    try {
      t.searchAllButton().dispatchEvent(new dom.window.Event("click"));
      await flush();

      expect(t.globalRows().length).toBe(1);
      expect(t.noteText()).toBe("Some topics couldn't be searched");
      // The panel stayed open (no crash tore it down).
      expect(Boolean(t.panel())).toBe(true);
    } finally {
      t.done();
    }
  });

  it("shows the note with no result rows when every glossary fails (R8.10)", async () => {
    // The all-failed edge: empty matches + failures → the note replaces the
    // control and no result rows are shown. (The task's focus is the partial
    // case above; this guards the boundary.)
    const loadGlobalIndex = async () => ({ matches: [], failures: true });

    const t = setup("spike", loadGlobalIndex);
    try {
      t.searchAllButton().dispatchEvent(new dom.window.Event("click"));
      await flush();

      expect(t.globalRows().length).toBe(0);
      expect(t.noteText()).toBe("Some topics couldn't be searched");
    } finally {
      t.done();
    }
  });
});
