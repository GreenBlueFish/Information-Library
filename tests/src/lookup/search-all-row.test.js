// tests/src/lookup/search-all-row.test.js
//
// Task 8.5 — DOM behaviour of the Search_All row in the lookup panel
// (Requirements 7.1–7.5, R8.7; design.md — Components §4 "lookup-ui.js" and
// "The four runtime flows" Flow 4).
//
// `installLookup(rootEl, { localIndex, loadGlobalIndex, scopeTitle })` installs
// the panel once and returns an `{ update }` handle. When `loadGlobalIndex` is
// a non-null async `(text) => { matches, failures }`, the panel appends a real
// `<button class="lookup-panel__search-all">` as its LAST row. These cases pin:
//
//   - the Search_All button is the last row of the panel (R7.1);
//   - it is reachable from the last local match by ArrowDown and by the ▼
//     control (R7.3);
//   - activating it (click / Enter) replaces the button with appended result
//     rows (R7.2, R7.4);
//   - focus moves to the first new result row once results arrive (R8.7);
//   - "Match n of N" counts the Search_All row too (R7.5).
//
// DOM: the shared linkedom DOM from tests/dom.js, pinned on the globals the way
// definition-card.source.test.js / term-definitions.test.js do. linkedom ships
// no Selection API, so each case installs a minimal fake `getSelection`
// (unmatched/matched text + a stub range rect) and dispatches a real `mouseup`
// to drive the module's own `handleSelection`, exactly as error-handling.test.js
// does. `loadGlobalIndex` resolves on a microtask, so each case flushes pending
// promises before asserting the results-state DOM.

import { describe, it, expect } from "../../harness.js";
import { ensureDom } from "../../dom.js";

const dom = await ensureDom();
globalThis.document = dom.document;
globalThis.window = dom.window;

const { buildIndex } = await import("../../../src/lookup/search-index.js");
const { installLookup } = await import("../../../src/lookup/lookup-ui.js");

/** Pin the ambient globals to the shared linkedom DOM for a case. */
function useRealDom() {
  globalThis.document = dom.document;
  globalThis.window = dom.window;
}

/** A fresh selection rect the panel anchors to. */
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
  // A couple of macrotask turns drain the Promise.resolve().then(...) chain
  // the module uses to await `loadGlobalIndex`.
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

/** Dispatch a real DOM event of `type` on `el`. */
function fire(el, type) {
  el.dispatchEvent(new dom.window.Event(type));
}

/** Dispatch a keydown with `key` on `document`. */
function keydown(key, target) {
  const ev = new dom.window.Event("keydown");
  // linkedom's Event has no `key`/`preventDefault` by default; add them so the
  // module's keydown handler (which reads event.key and calls preventDefault)
  // behaves as in a browser.
  ev.key = key;
  ev.preventDefault = () => {};
  if (target) Object.defineProperty(ev, "target", { value: target, configurable: true });
  dom.document.dispatchEvent(ev);
}

/**
 * A local glossary with two matches for "spike" so the panel renders a local
 * match whose last row is followed by the Search_All button. Each entry carries
 * a runtime `source` so results read "from <Topic>".
 */
const LOCAL = [
  {
    term: "Spike",
    definition: "A brief voltage pulse from a neuron.",
    pageRef: "/snn",
    source: { route: "/snn", title: "Spiking Neural Networks" },
  },
  {
    term: "Spike train",
    definition: "A sequence of spikes over time.",
    pageRef: "/snn",
    source: { route: "/snn", title: "Spiking Neural Networks" },
  },
];

/** A single global (non-chain) result Search_All surfaces for "spike". */
function globalMatchesFor() {
  return {
    matches: [
      {
        term: "Spike",
        matchKind: "exact",
        definitions: [
          {
            term: "Spike",
            definition: "A sharp transient on a signal line.",
            pageRef: "/analog-design",
            acronym: null,
            source: { route: "/analog-design", title: "Analog Design" },
          },
        ],
      },
    ],
    failures: false,
  };
}

/**
 * Install the panel, drive a selection of `text`, and return the live panel
 * plus a teardown that restores the selection stub and clears DOM.
 */
function openPanel(text, loadGlobalIndex) {
  useRealDom();
  const view = dom.window;
  const root = dom.document.createElement("div");
  root.textContent = `a ${text} here`;
  dom.document.body.appendChild(root);

  const restore = fakeSelection(view, text);
  const handle = installLookup(root, {
    localIndex: buildIndex(LOCAL),
    loadGlobalIndex,
    scopeTitle: "Spiking Neural Networks",
  });
  fire(root, "mouseup");

  const panel = () => dom.document.body.querySelector(".lookup-panel");
  function teardown() {
    restore();
    panel()?.remove();
    root.remove();
  }
  return { panel, root, handle, teardown };
}

describe("Search_All row: last row, reachable, replaced by results (R7, R8.7)", () => {
  it("renders the Search_All button as the panel's last row", () => {
    const { panel, teardown } = openPanel("spike", async () => globalMatchesFor());
    try {
      const p = panel();
      expect(p).toBeTruthy();
      const button = p.querySelector(".lookup-panel__search-all");
      expect(button).toBeTruthy();
      expect(button.tagName).toBe("BUTTON");
      expect(button.textContent).toBe("Search all");

      // It is the last interactive/content row: the only element after it is
      // the visually-hidden aria-live region the panel keeps as its tail.
      const children = [...p.children];
      const buttonIdx = children.indexOf(button);
      const after = children.slice(buttonIdx + 1);
      expect(after.every((el) => el.className.includes("lookup-panel__announce"))).toBe(true);
    } finally {
      teardown();
    }
  });

  it("counts the Search_All row in 'Match n of N'", () => {
    const { panel, teardown } = openPanel("spike", async () => globalMatchesFor());
    try {
      // Two local matches + the Search_All row = 3.
      const count = panel().querySelector(".lookup-panel__match-count");
      expect(count).toBeTruthy();
      expect(count.textContent).toBe("Match 1 of 3");
    } finally {
      teardown();
    }
  });

  it("moves focus to the Search_All button on ArrowDown from the last local match", () => {
    const { panel, teardown } = openPanel("spike", async () => globalMatchesFor());
    try {
      const p = panel();
      const down = [...p.querySelectorAll(".lookup-panel__match-button")].find(
        (b) => b.textContent === "▼",
      );
      // Step to the last local match (index 1 of the 2 local matches).
      fire(down, "click");
      // ArrowDown from the last local match focuses the Search_All button.
      const button = p.querySelector(".lookup-panel__search-all");
      let focused = null;
      button.focus = () => {
        focused = button;
      };
      keydown("ArrowDown");
      expect(focused).toBe(button);
    } finally {
      teardown();
    }
  });

  it("moves focus to the Search_All button via the ▼ control on the last local match", () => {
    const { panel, teardown } = openPanel("spike", async () => globalMatchesFor());
    try {
      const p = panel();
      const down = () =>
        [...p.querySelectorAll(".lookup-panel__match-button")].find((b) => b.textContent === "▼");
      // Step to the last local match.
      fire(down(), "click");
      // The ▼ control on the last local match moves focus onto the button
      // rather than cycling.
      const button = p.querySelector(".lookup-panel__search-all");
      let focused = null;
      button.focus = () => {
        focused = button;
      };
      fire(down(), "click");
      expect(focused).toBe(button);
    } finally {
      teardown();
    }
  });

  it("replaces the button with appended result rows when activated (click)", async () => {
    const { panel, teardown } = openPanel("spike", async () => globalMatchesFor());
    try {
      const p = panel();
      fire(p.querySelector(".lookup-panel__search-all"), "click");
      await flush();

      // The idle button is gone, replaced by appended global-result rows.
      expect(p.querySelector(".lookup-panel__search-all")).toBe(null);
      const results = p.querySelectorAll(".lookup-panel__global-result");
      expect(results.length).toBe(1);
      // "Spike" is already shown in Local_Results, so this new definition of it
      // reads "Also defined in <Topic>" rather than "from <Topic>" (R8.2, R8.4).
      expect(results[0].querySelector(".lookup-panel__source").textContent).toBe(
        "Also defined in Analog Design",
      );
      expect(p.textContent.includes("A sharp transient on a signal line.")).toBe(true);
    } finally {
      teardown();
    }
  });

  it("moves focus to the first new result row once results arrive (R8.7)", async () => {
    const { panel, teardown } = openPanel("spike", async () => globalMatchesFor());
    try {
      const p = panel();
      // Intercept focus on any created global-result row by spying after the
      // button click but before the microtask resolves is not possible (the
      // row is created inside the async handler). Instead, assert the first
      // result row became the document's active-equivalent by stubbing focus
      // through a MutationObserver-free approach: capture the focus call via a
      // prototype hook on HTMLElement for the duration of this case.
      let focusedEl = null;
      const proto = dom.window.HTMLElement.prototype;
      const realFocus = proto.focus;
      proto.focus = function focusSpy() {
        focusedEl = this;
        if (typeof realFocus === "function") return realFocus.call(this);
      };
      try {
        fire(p.querySelector(".lookup-panel__search-all"), "click");
        await flush();
        const firstResult = p.querySelector(".lookup-panel__global-result");
        expect(firstResult).toBeTruthy();
        expect(focusedEl).toBe(firstResult);
      } finally {
        proto.focus = realFocus;
      }
    } finally {
      teardown();
    }
  });

  it("counts the appended result rows in 'Match n of N' after results arrive", async () => {
    const { panel, teardown } = openPanel("spike", async () => globalMatchesFor());
    try {
      const p = panel();
      fire(p.querySelector(".lookup-panel__search-all"), "click");
      await flush();
      // Two local matches + one global result row = 3.
      const count = p.querySelector(".lookup-panel__match-count");
      expect(count.textContent).toBe("Match 1 of 3");
    } finally {
      teardown();
    }
  });
});
