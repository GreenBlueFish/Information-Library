// tests/src/lookup/also-defined-in.test.js
//
// Task 10.5 — DOM example: the Search_All "Also defined in <Topic>" row carries
// ONLY the not-yet-shown definitions of a term already visible in
// Local_Results (requirement 8.4, verified per R14.3; design.md — Testing
// Strategy table row "tests/src/lookup/also-defined-in.test.js").
//
// This is the DOM-level companion to Property 4 (also-defined-in.property.test.js),
// which pins `withoutShownDefinitions` in isolation. Here we drive the REAL
// panel so the end-to-end behaviour is exercised: a term is shown locally (with
// one definition), then `loadGlobalIndex` returns that SAME term carrying a mix
// of an already-shown definition and some genuinely new ones. We assert the
// Search_All row for that term:
//
//   - reads "Also defined in <Topic>" (not "from <Topic>"), because the term is
//     already shown locally (R8.4); and
//   - carries ONLY the not-yet-shown definitions — the already-shown one has
//     been dropped (R8.4 via `withoutShownDefinitions`).
//
// It builds on the search-all-row.test.js pattern (same linkedom harness, fake
// `getSelection`, promise flush), which already pins the "Also defined in"
// label for a shared term; this case additionally pins the DEFINITION-level
// filter behind that label.
//
// DOM: the shared linkedom DOM from tests/dom.js, pinned on the globals.
// linkedom ships no Selection API, so each case installs a fake `getSelection`
// (selected text + a stub range rect) and dispatches a real `mouseup`.
// `loadGlobalIndex` resolves on a microtask, so we flush before asserting.

import { describe, it, expect } from "../../harness.js";
import { ensureDom } from "../../dom.js";

const dom = await ensureDom();
globalThis.document = dom.document;
globalThis.window = dom.window;

const { buildIndex } = await import("../../../src/lookup/search-index.js");
const { installLookup } = await import("../../../src/lookup/lookup-ui.js");

/** A fresh selection rect the panel anchors to. */
const RECT = { left: 10, top: 20, bottom: 40, right: 60, width: 50, height: 20 };

/** The exact local definition of "Spike" shown in Local_Results. */
const LOCAL_SPIKE_DEF = "A brief all-or-nothing voltage pulse fired by a neuron.";

/**
 * The local (chain) glossary: a single "Spike" entry so a selection of "spike"
 * resolves to exactly one local match carrying LOCAL_SPIKE_DEF.
 */
const LOCAL_TERMS = [
  {
    term: "Spike",
    definition: LOCAL_SPIKE_DEF,
    pageRef: "/snn",
    source: { route: "/snn", title: "Spiking Neural Networks" },
  },
];

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

/** Build a global definition object (as a shaped Match definition carries). */
function def(term, definition, source) {
  return { term, definition, pageRef: source.route, acronym: null, source };
}

/**
 * Install the panel against a stubbed selection of `text`, returning handles to
 * run Search_All, read its rows, and tear down.
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
    teardown() {
      restore();
      panel()?.remove();
      root.remove();
    },
  };
}

describe("lookup panel: 'Also defined in' carries only not-yet-shown definitions (R14.3 / R8.4)", () => {
  it("drops the already-shown definition and keeps the new ones under an 'Also defined in' label", async () => {
    // The ANALOG topic re-defines "Spike" with:
    //   - the SAME definition already shown locally (re-decorated by case /
    //     surrounding whitespace, which the already-shown filter folds away), and
    //   - two genuinely new definitions.
    // Only the two new definitions must survive, under "Also defined in Analog
    // Design".
    const ANALOG = { route: "/analog-design", title: "Analog Design" };
    const NEW_DEF_1 = "A sharp transient excursion on a signal line.";
    const NEW_DEF_2 = "An abrupt overshoot following a switching event.";

    const loadGlobalIndex = async () => ({
      matches: [
        {
          term: "Spike",
          matchKind: "exact",
          definitions: [
            // Already shown locally (case + whitespace re-decorated): must be dropped.
            def("Spike", `  ${LOCAL_SPIKE_DEF.toUpperCase()}  `, ANALOG),
            def("Spike", NEW_DEF_1, ANALOG),
            def("Spike", NEW_DEF_2, ANALOG),
          ],
        },
      ],
      failures: false,
    });

    const t = openPanel("spike", loadGlobalIndex);
    try {
      // The local match is shown; run Search_All.
      expect(t.panel()).toBeTruthy();
      t.searchAllButton().dispatchEvent(new dom.window.Event("click"));
      await flush();

      const rows = t.globalRows();
      // One term ("Spike") from one topic → exactly one Search_All row.
      expect(rows.length).toBe(1);
      const row = rows[0];

      // The row reads "Also defined in <Topic>" because "Spike" is already shown
      // locally (R8.4) — not "from <Topic>".
      const label = row.querySelector(".lookup-panel__source").textContent;
      expect(label).toBe("Also defined in Analog Design");

      // It carries ONLY the two not-yet-shown definitions: a Prev/Next cycle of
      // "1 of 2" (not 3), and the already-shown definition's text is absent.
      const count = row.querySelector(".lookup-panel__cycle-count");
      expect(count).toBeTruthy();
      expect(count.textContent).toBe("1 of 2");

      // Walk both definitions via the Next control and collect their text.
      const next = [...row.querySelectorAll(".lookup-panel__cycle-button")].find(
        (b) => b.textContent === "Next ›",
      );
      const defEl = row.querySelector(".lookup-panel__definition");
      const shownDefs = [defEl.textContent];
      fire(next, "click");
      shownDefs.push(defEl.textContent);

      // The two new definitions are present ...
      expect(shownDefs.includes(NEW_DEF_1)).toBe(true);
      expect(shownDefs.includes(NEW_DEF_2)).toBe(true);
      // ... and the already-shown definition is NOT (case-folded comparison, to
      // be robust to how the card renders the text).
      const joined = shownDefs.join(" \u0000 ").toLowerCase();
      expect(joined.includes(LOCAL_SPIKE_DEF.toLowerCase())).toBe(false);
    } finally {
      t.teardown();
    }
  });

  it("labels a genuinely new term 'from <Topic>' rather than 'Also defined in'", async () => {
    // A control case: a term NOT shown locally reads "from <Topic>", confirming
    // the "Also defined in" wording is reserved for already-shown terms (R8.4).
    const NEURO = { route: "/neuroscience", title: "Neuroscience" };
    const loadGlobalIndex = async () => ({
      matches: [
        {
          term: "Refractory period",
          matchKind: "contains",
          definitions: [def("Refractory period", "The brief recovery window after a spike.", NEURO)],
        },
      ],
      failures: false,
    });

    const t = openPanel("spike", loadGlobalIndex);
    try {
      t.searchAllButton().dispatchEvent(new dom.window.Event("click"));
      await flush();

      const rows = t.globalRows();
      expect(rows.length).toBe(1);
      expect(rows[0].querySelector(".lookup-panel__source").textContent).toBe("from Neuroscience");
    } finally {
      t.teardown();
    }
  });
});
