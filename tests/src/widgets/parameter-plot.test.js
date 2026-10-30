// tests/src/widgets/parameter-plot.test.js
//
// Unit tests for the `parameter-plot` widget type
// (src/widgets/types/parameter-plot.js) — task 6.4.
//
// Covers the parameter-plot half of the task:
//   10.4 on first mount, the widget reflects its declared param defaults on
//        first paint — the control inputs are initialized to the declared
//        defaults AND a plot is drawn synchronously before mount returns.
//   10.6 changing a control to an OUT-OF-RANGE value is rejected: the control
//        is marked invalid (`.widget__control--invalid` + a visible
//        `.widget__control-error`), the input is reset to the last valid value,
//        and the last valid plot is retained (no redraw).
//
// Self-registration + a cleared registry:
//   Importing the module self-registers "parameter-plot" exactly once (ES module
//   side effect, cached). Other test files call `clearWidgetRegistry()`, which
//   would wipe that registration — and the module's mount function is not
//   exported, so we cannot simply re-register it. To stay robust regardless of
//   test ordering, each test below mounts through a fresh, cache-busted dynamic
//   import of the module, which re-runs its `registerWidget` side effect into
//   whatever registry state exists at that moment.
//
// DOM setup: reuse the suite's shared `ensureDom()` (tests/dom.js) — a real DOM
// (linkedom loaded as an ES module from a CDN, no build step / no install) so
// SVG creation, `classList`, live `input` events, and input `value`/`hidden`
// semantics behave as in a browser. See tests/README.md.

import { describe, it, expect } from "../../harness.js";
import { ensureDom } from "../../dom.js";
import { mountWidget } from "../../../src/widgets/registry.js";

// Install the DOM once before any case runs; `ensureDom` is memoized.
const dom = await ensureDom();

/**
 * Freshly (re-)register the parameter-plot type by importing the module with a
 * unique query string, defeating the ES module cache so its self-registration
 * side effect runs again even after a prior `clearWidgetRegistry()`.
 * @returns {Promise<void>}
 */
async function ensureParameterPlotRegistered() {
  await import(`../../../src/widgets/types/parameter-plot.js?fresh=${Math.random()}`);
}

/**
 * Build an `"input"` Event from the SAME DOM realm as `el`, then dispatch-able
 * on it. The event must come from the element's own document/window — in a
 * browser `new Event(...)` suffices, but under the test DOM the ambient
 * `globalThis.Event` is the host runtime's Event, a different realm than the
 * element's, which the DOM's `dispatchEvent` rejects. Using the element's
 * `ownerDocument.defaultView.Event` keeps the test honest about the real
 * `addEventListener`/`dispatchEvent` path the widget relies on (Req 10.5/10.6).
 * @param {HTMLElement} el
 * @returns {Event}
 */
function makeInputEvent(el) {
  const view = el.ownerDocument.defaultView ?? dom.window ?? globalThis;
  return new view.Event("input", { bubbles: true });
}

/**
 * Run `fn` with the bare global `document` pointed at this suite's real DOM,
 * restoring whatever was there afterwards.
 *
 * Why this is needed: the shared plotting primitive (src/widgets/plot.js) reads
 * the ambient global `document` directly (it builds SVG via
 * `document.createElementNS`). An earlier test file in the run can leave a
 * different, minimal `document` stub installed on `globalThis` (the renderer's
 * pure-structure tests do exactly that), and `ensureDom()` reuses whatever
 * global is already present. Pinning the global to `dom.document` for the
 * duration of each widget case makes the bare-global reads in `plot.js` resolve
 * to the SAME real DOM our mount containers belong to, and the restore keeps
 * this test from leaking its choice onto any later test.
 *
 * @template T
 * @param {() => T | Promise<T>} fn
 * @returns {Promise<T>}
 */
async function withRealDocument(fn) {
  const prevDesc = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", {
    value: dom.document,
    configurable: true,
    writable: true,
  });
  try {
    return await fn();
  } finally {
    if (prevDesc) Object.defineProperty(globalThis, "document", prevDesc);
    else delete globalThis.document;
  }
}

/** A representative spec: numeric range params with declared defaults. */
function sampleSpec() {
  return {
    type: "parameter-plot",
    title: "Sine Explorer",
    params: [
      { key: "amplitude", label: "Amplitude", control: "range", min: 0, max: 5, step: 0.1, default: 2 },
      { key: "frequency", label: "Frequency", control: "number", min: 1, max: 10, step: 1, default: 3 },
    ],
    config: { series: ["f(x)"] },
  };
}

describe("widgets/parameter-plot", () => {
  it("reflects declared param defaults on first paint (10.4)", async () => {
    await ensureParameterPlotRegistered();

    await withRealDocument(() => {
      const container = dom.freshMount();
      const spec = sampleSpec();
      const instance = mountWidget(spec, container);

      // A real instance mounted (the type was registered).
      expect(instance === null).toBe(false);

      // Controls were built and initialized to the declared DEFAULTS.
      const inputs = container.querySelectorAll(".widget__control input");
      expect(inputs.length).toBe(2);
      // Inputs carry their value as strings; defaults 2 and 3.
      const values = Array.from(inputs).map((i) => i.value);
      expect(values).toEqual(["2", "3"]);

      // A plot was drawn synchronously on first paint (SVG present inside the
      // plot host) — defaults are reflected visually, not just stored.
      const plotHost = container.querySelector(".widget__plot");
      expect(plotHost === null).toBe(false);
      expect(plotHost.querySelector("svg") === null).toBe(false);

      instance.destroy();
    });
  });

  it("rejects an out-of-range control change: marks the control invalid and retains the last valid state (10.6)", async () => {
    await ensureParameterPlotRegistered();

    await withRealDocument(() => {
      const container = dom.freshMount();
      const spec = sampleSpec();
      const instance = mountWidget(spec, container);

      // Target the amplitude control (declared range 0..5, default 2).
      const field = container.querySelectorAll(".widget__control")[0];
      const input = field.querySelector("input");
      expect(input.value).toBe("2");

      // Capture the plot's current drawing so we can assert it is RETAINED
      // (not redrawn) when the change is rejected.
      const svgBefore = container.querySelector(".widget__plot svg");
      expect(svgBefore === null).toBe(false);

      // Drive an out-of-range value (max is 5) through the real input event the
      // widget listens for.
      input.value = "99";
      input.dispatchEvent(makeInputEvent(input));

      // The control is marked invalid with a visible error naming the param.
      expect(field.classList.contains("widget__control--invalid")).toBe(true);
      const error = field.querySelector(".widget__control-error");
      expect(error === null).toBe(false);
      expect(error.hidden).toBe(false);
      expect(error.textContent.length > 0).toBe(true);
      expect(error.textContent.includes("Amplitude")).toBe(true);

      // The last valid value is retained: the input is reset back to 2.
      expect(input.value).toBe("2");

      // The last valid visualization is retained: the SVG was not redrawn
      // (same node instance still in place).
      const svgAfter = container.querySelector(".widget__plot svg");
      expect(svgAfter).toBe(svgBefore);

      instance.destroy();
    });
  });

  it("clears the invalid indication after a subsequent in-range change (10.6)", async () => {
    await ensureParameterPlotRegistered();

    await withRealDocument(() => {
      const container = dom.freshMount();
      const instance = mountWidget(sampleSpec(), container);

      const field = container.querySelectorAll(".widget__control")[0];
      const input = field.querySelector("input");

      // First, reject an out-of-range value.
      input.value = "99";
      input.dispatchEvent(makeInputEvent(input));
      expect(field.classList.contains("widget__control--invalid")).toBe(true);

      // Then a valid in-range change clears the error and applies the value.
      input.value = "4";
      input.dispatchEvent(makeInputEvent(input));

      expect(field.classList.contains("widget__control--invalid")).toBe(false);
      const error = field.querySelector(".widget__control-error");
      expect(error.hidden).toBe(true);
      expect(input.value).toBe("4");

      instance.destroy();
    });
  });
});
