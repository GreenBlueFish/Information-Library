// tests/src/widgets/temporal-memory.test.js
//
// Unit tests for the `temporal-memory` widget type
// (src/widgets/types/temporal-memory.js).
//
// Science (pure model, no DOM):
//   - high-order sequence memory: after training on A B C D + X B C Y with 4
//     cells per minicolumn, "A B C" predicts D's columns (not Y's) and
//     "X B C" predicts Y's columns (not D's) (Hawkins & Ahmad 2016);
//   - with 1 cell per minicolumn the context is lost: both D and Y predicted;
//   - anomaly is 1 on first presentation and falls to 0 after training;
//   - determinism for a given seed.
// Widget (DOM): defaults on first paint, out-of-range rejection, update()
// redraws, destroy() stops the play ticker.
//
// Mounting follows parameter-plot.test.js: a cache-busted dynamic import
// re-registers the type, and `withRealDocument` pins the global document.

import { describe, it, expect } from "../../harness.js";
import { ensureDom } from "../../dom.js";
import { mountWidget } from "../../../src/widgets/registry.js";
import {
  buildModel,
  trainSequences,
  predictedSymbols,
  TemporalMemory,
} from "../../../src/widgets/types/temporal-memory.js";

const dom = await ensureDom();

async function ensureRegistered() {
  await import(`../../../src/widgets/types/temporal-memory.js?fresh=${Math.random()}`);
}

function makeEvent(el, type) {
  const view = el.ownerDocument.defaultView ?? dom.window ?? globalThis;
  return new view.Event(type, { bubbles: true });
}

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function spec() {
  return {
    type: "temporal-memory",
    title: "Temporal memory: learning A-B-C-D vs X-B-C-Y",
    params: [
      { key: "sequences", label: "Training sequences", control: "select", options: ["ABCD", "ABCD + XBCY", "ABCDE + ABFGE"], default: "ABCD + XBCY" },
      { key: "cellsPerColumn", label: "Cells per minicolumn", control: "range", min: 1, max: 8, step: 1, default: 4 },
      { key: "activationThreshold", label: "Segment activation threshold", control: "range", min: 1, max: 10, step: 1, default: 3 },
      { key: "seed", label: "Random seed", control: "number", min: 1, max: 9999, step: 1, default: 11 },
    ],
    config: { columnsPerSymbol: 4, maxNewSynapses: 6, permanenceIncrement: 0.1, permanenceDecrement: 0.05, connectedPermanence: 0.5, initialPermanence: 0.51 },
  };
}

/** Feed a prefix (no learning) and return the predicted column set. */
function predictAfter(model, prefix) {
  model.tm.reset();
  for (const s of prefix) model.tm.compute(model.columnsOf.get(s), false);
  const cols = model.tm.predictedColumns();
  const syms = predictedSymbols(model.tm, model.columnsOf);
  model.tm.reset();
  return { cols, syms };
}

const allIn = (cols, set) => cols.every((c) => set.has(c));
const noneIn = (cols, set) => cols.every((c) => !set.has(c));

describe("widgets/temporal-memory — model", () => {
  it("learns high-order context with 4 cells/column: ABC→D only, XBC→Y only", () => {
    const model = buildModel({ sequences: "ABCD + XBCY", cellsPerColumn: 4, activationThreshold: 3, seed: 11 }, {});
    trainSequences(model.tm, model.sequences, 30, model.columnsOf);
    const D = model.columnsOf.get("D");
    const Y = model.columnsOf.get("Y");
    const abc = predictAfter(model, "ABC");
    expect(allIn(D, abc.cols)).toBe(true);
    expect(noneIn(Y, abc.cols)).toBe(true);
    expect(abc.syms).toEqual(["D"]);
    const xbc = predictAfter(model, "XBC");
    expect(allIn(Y, xbc.cols)).toBe(true);
    expect(noneIn(D, xbc.cols)).toBe(true);
    expect(xbc.syms).toEqual(["Y"]);
  });

  it("also works for other seeds and after only 10 passes", () => {
    for (const seed of [1, 2, 3, 99]) {
      const model = buildModel({ sequences: "ABCD + XBCY", cellsPerColumn: 4, activationThreshold: 3, seed }, {});
      trainSequences(model.tm, model.sequences, 10, model.columnsOf);
      expect(predictAfter(model, "ABC").syms).toEqual(["D"]);
      expect(predictAfter(model, "XBC").syms).toEqual(["Y"]);
    }
  });

  it("with 1 cell/column both D and Y are predicted after A B C", () => {
    const model = buildModel({ sequences: "ABCD + XBCY", cellsPerColumn: 1, activationThreshold: 3, seed: 11 }, {});
    trainSequences(model.tm, model.sequences, 30, model.columnsOf);
    const abc = predictAfter(model, "ABC");
    expect(allIn(model.columnsOf.get("D"), abc.cols)).toBe(true);
    expect(allIn(model.columnsOf.get("Y"), abc.cols)).toBe(true);
    const xbc = predictAfter(model, "XBC");
    expect(allIn(model.columnsOf.get("D"), xbc.cols)).toBe(true);
    expect(allIn(model.columnsOf.get("Y"), xbc.cols)).toBe(true);
  });

  it("anomaly is 1 on first presentation and falls to 0 after training", () => {
    const model = buildModel({ sequences: "ABCD", cellsPerColumn: 4, activationThreshold: 3, seed: 11 }, {});
    const first = [...model.sequences[0]].map((s) => model.tm.compute(model.columnsOf.get(s), true).anomaly);
    expect(first).toEqual([1, 1, 1, 1]);
    model.tm.reset();
    trainSequences(model.tm, model.sequences, 5, model.columnsOf);
    const later = [...model.sequences[0]].map((s) => model.tm.compute(model.columnsOf.get(s), true).anomaly);
    // The first symbol after a reset has no context, so it stays unpredicted.
    expect(later).toEqual([1, 0, 0, 0]);
  });

  it("a threshold above the winners per symbol makes prediction impossible", () => {
    const model = buildModel({ sequences: "ABCD", cellsPerColumn: 4, activationThreshold: 5, seed: 11 }, {});
    trainSequences(model.tm, model.sequences, 10, model.columnsOf);
    expect(predictAfter(model, "ABC").syms).toEqual([]);
  });

  it("is deterministic for the same seed", () => {
    const run = (seed) => {
      const model = buildModel({ sequences: "ABCDE + ABFGE", cellsPerColumn: 4, activationThreshold: 3, seed }, {});
      trainSequences(model.tm, model.sequences, 6, model.columnsOf);
      return JSON.stringify(model.tm.cellSegments.map((segs) => segs.map((s) => s.synapses)));
    };
    expect(run(7)).toBe(run(7));
    expect(run(7) === run(8)).toBe(false);
  });

  it("exposes the TemporalMemory class", () => {
    const tm = new TemporalMemory({ numColumns: 2, cellsPerColumn: 2, activationThreshold: 1, maxNewSynapses: 2, permanenceIncrement: 0.1, permanenceDecrement: 0.05, connectedPermanence: 0.5, initialPermanence: 0.51, seed: 1 });
    const r = tm.compute([0], true);
    expect(r.anomaly).toBe(1);
    expect(tm.activeCells.size).toBe(2);
  });
});

describe("widgets/temporal-memory — widget", () => {
  it("reflects defaults on first paint and draws an SVG grid", async () => {
    await ensureRegistered();
    await withRealDocument(() => {
      const container = dom.freshMount();
      const instance = mountWidget(spec(), container);
      expect(instance === null).toBe(false);
      // (linkedom does not implement select.value, so only <input>s are compared.)
      const inputs = Array.from(container.querySelectorAll(".widget__control input"));
      expect(inputs.map((i) => i.value)).toEqual(["4", "3", "11"]);
      expect(container.querySelectorAll(".widget__control select").length).toBe(1);
      const svg = container.querySelector(".widget__plot svg");
      expect(svg === null).toBe(false);
      // 6 symbols × 4 columns × 4 cells.
      const cells = Array.from(svg.querySelectorAll("rect")).filter((r) => (r.getAttribute("class") || "").includes("sim-cell"));
      expect(cells.length).toBe(96);
      expect(container.querySelector(".widget__readout").textContent.length > 0).toBe(true);
      instance.destroy();
    });
  });

  it("Step marks bursting cells; Train ×10 then stepping shows correct predictions", async () => {
    await ensureRegistered();
    await withRealDocument(() => {
      const container = dom.freshMount();
      const instance = mountWidget(spec(), container);
      const buttons = Array.from(container.querySelectorAll(".widget__button"));
      const [stepBtn, , trainBtn] = buttons;
      stepBtn.dispatchEvent(makeEvent(stepBtn, "click"));
      const classes = () => Array.from(container.querySelectorAll(".widget__plot rect")).map((r) => r.getAttribute("class") || "");
      expect(classes().filter((c) => c.includes("sim-cell--burst")).length).toBe(16);
      trainBtn.dispatchEvent(makeEvent(trainBtn, "click"));
      for (let i = 0; i < 3; i++) stepBtn.dispatchEvent(makeEvent(stepBtn, "click"));
      const readout = Array.from(container.querySelectorAll(".widget__readout")).pop().textContent;
      expect(readout.includes("Input: C")).toBe(true);
      expect(readout.includes("Predicted next: D")).toBe(true);
      expect(readout.includes("Passes trained: 10")).toBe(true);
      expect(classes().filter((c) => c.includes("sim-cell--active")).length > 0).toBe(true);
      expect(classes().filter((c) => c.includes("sim-cell--predicted")).length > 0).toBe(true);
      instance.destroy();
    });
  });

  it("rejects an out-of-range control change", async () => {
    await ensureRegistered();
    await withRealDocument(() => {
      const container = dom.freshMount();
      const instance = mountWidget(spec(), container);
      const field = container.querySelectorAll(".widget__control")[1];
      const input = field.querySelector("input");
      input.value = "20";
      input.dispatchEvent(makeEvent(input, "input"));
      expect(field.classList.contains("widget__control--invalid")).toBe(true);
      expect(input.value).toBe("4");
      instance.destroy();
    });
  });

  it("update() with a valid value redraws and says learning was reset", async () => {
    await ensureRegistered();
    await withRealDocument(() => {
      const container = dom.freshMount();
      const instance = mountWidget(spec(), container);
      instance.update({ cellsPerColumn: 2 });
      const cells = Array.from(container.querySelectorAll(".widget__plot rect")).filter((r) => (r.getAttribute("class") || "").includes("sim-cell"));
      expect(cells.length).toBe(48);
      const readout = Array.from(container.querySelectorAll(".widget__readout")).pop().textContent;
      expect(readout.includes("learning reset")).toBe(true);
      instance.destroy();
    });
  });

  it("tolerates a missing config", async () => {
    await ensureRegistered();
    await withRealDocument(() => {
      const container = dom.freshMount();
      const s = spec();
      delete s.config;
      const instance = mountWidget(s, container);
      expect(container.querySelector(".widget__plot svg") === null).toBe(false);
      instance.destroy();
    });
  });

  it("destroy() stops a running play ticker", async () => {
    await ensureRegistered();
    await withRealDocument(async () => {
      const container = dom.freshMount();
      const instance = mountWidget(spec(), container);
      const play = container.querySelectorAll(".widget__button")[1];
      play.dispatchEvent(makeEvent(play, "click"));
      expect(play.getAttribute("aria-pressed")).toBe("true");
      instance.destroy();
      const readout = Array.from(container.querySelectorAll(".widget__readout")).pop();
      const before = readout.textContent;
      await sleep(900);
      expect(readout.textContent).toBe(before);
    });
  });
});
