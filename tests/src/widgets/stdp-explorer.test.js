// tests/src/widgets/stdp-explorer.test.js
//
// Unit tests for the `stdp-explorer` widget type
// (src/widgets/types/stdp-explorer.js).
//
//   (a) science: the exported pure functions — sign and size of Δw at ±Δt,
//       additive vs multiplicative (soft-bounded) weight dependence, clipping,
//       the window integral A+τ+ − A−τ−.
//   (b) mount: declared defaults reflected on first paint (inputs + SVG).
//   (c) an out-of-range control change is rejected (invalid mark, value kept).
//   (d) update() with a valid value redraws; destroy() leaves the widget inert.
//
// Mounting goes through a fresh, cache-busted dynamic import so the module's
// registerWidget side effect re-runs even after another test file cleared the
// registry (same pattern as parameter-plot.test.js).

import { describe, it, expect } from "../../harness.js";
import { ensureDom } from "../../dom.js";
import { mountWidget } from "../../../src/widgets/registry.js";
import {
  stdpWindow,
  applyPairing,
  weightTrajectory,
  windowIntegral,
  normalizeStdpConfig,
} from "../../../src/widgets/types/stdp-explorer.js";

const dom = await ensureDom();

async function ensureRegistered() {
  await import(`../../../src/widgets/types/stdp-explorer.js?fresh=${Math.random()}`);
}

function makeInputEvent(el) {
  const view = el.ownerDocument.defaultView ?? dom.window ?? globalThis;
  return new view.Event("input", { bubbles: true });
}

async function withRealDocument(fn) {
  const prevDesc = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { value: dom.document, configurable: true, writable: true });
  try {
    return await fn();
  } finally {
    if (prevDesc) Object.defineProperty(globalThis, "document", prevDesc);
    else delete globalThis.document;
  }
}

/** The exact Widget_Spec from the contract. */
function sampleSpec() {
  return {
    type: "stdp-explorer",
    title: "STDP learning window",
    params: [
      { key: "aPlus", label: "A+ (potentiation amplitude)", control: "range", min: 0, max: 0.02, step: 0.0005, default: 0.01 },
      { key: "aMinus", label: "A− (depression amplitude)", control: "range", min: 0, max: 0.02, step: 0.0005, default: 0.0105 },
      { key: "tauPlus", label: "τ+ (ms)", control: "range", min: 5, max: 50, step: 1, default: 20 },
      { key: "tauMinus", label: "τ− (ms)", control: "range", min: 5, max: 50, step: 1, default: 20 },
      { key: "deltaT", label: "Δt = t_post − t_pre (ms)", control: "range", min: -100, max: 100, step: 1, default: 10 },
      { key: "rule", label: "Weight dependence", control: "select", options: ["additive", "multiplicative"], default: "additive" },
    ],
    config: { pairings: 60, w0: 0.5, wMax: 1 },
  };
}

const P = { aPlus: 0.01, aMinus: 0.0105, tauPlus: 20, tauMinus: 20, wMax: 1 };
const close = (a, b, eps = 1e-12) => Math.abs(a - b) <= eps;

describe("widgets/stdp-explorer › model", () => {
  it("pre-before-post (Δt > 0) potentiates, post-before-pre (Δt < 0) depresses", () => {
    expect(close(stdpWindow(10, P), 0.01 * Math.exp(-0.5))).toBe(true);
    expect(close(stdpWindow(-10, P), -0.0105 * Math.exp(-0.5))).toBe(true);
    expect(close(stdpWindow(20, P), 0.01 / Math.E)).toBe(true); // one time constant
    expect(stdpWindow(0, P)).toBe(0);
    expect(stdpWindow(1, P) > stdpWindow(50, P)).toBe(true);
    expect(stdpWindow(-1, P) < stdpWindow(-50, P)).toBe(true);
  });

  it("additive rule adds Δw and clips to [0, wMax]", () => {
    expect(close(applyPairing(0.5, 10, P, "additive"), 0.5 + 0.01 * Math.exp(-0.5))).toBe(true);
    expect(applyPairing(0.999, 1, P, "additive")).toBe(1);
    expect(applyPairing(0.001, -1, P, "additive")).toBe(0);
    const traj = weightTrajectory(0.5, 1, 200, P, "additive");
    expect(traj.length).toBe(201);
    expect(traj[200]).toBe(1); // marches into the hard bound
  });

  it("multiplicative rule is soft-bounded: scaled by (wMax − w) or w, converging without overshoot", () => {
    expect(close(applyPairing(0.5, 10, P, "multiplicative"), 0.5 + 0.01 * Math.exp(-0.5) * 0.5)).toBe(true);
    expect(close(applyPairing(0.5, -10, P, "multiplicative"), 0.5 - 0.0105 * Math.exp(-0.5) * 0.5)).toBe(true);
    const up = weightTrajectory(0.5, 1, 300, P, "multiplicative");
    const step = 0.01 * Math.exp(-1 / 20);
    // Closed form: wMax − (wMax − w0)(1 − a)^n.
    expect(close(up[300], 1 - 0.5 * Math.pow(1 - step, 300), 1e-9)).toBe(true);
    expect(up[300] < 1).toBe(true);
    for (let i = 1; i < up.length; i++) expect(up[i] - up[i - 1] <= up[1] - up[0] + 1e-15).toBe(true);
    const down = weightTrajectory(0.5, -1, 300, P, "multiplicative");
    expect(down[300] > 0).toBe(true);
    expect(down[300] < 0.5).toBe(true);
  });

  it("window integral A+τ+ − A−τ− has the expected sign", () => {
    expect(close(windowIntegral(P), 0.01 * 20 - 0.0105 * 20)).toBe(true);
    expect(windowIntegral(P) < 0).toBe(true);
    expect(windowIntegral({ ...P, aPlus: 0.02 }) > 0).toBe(true);
    // Numerical check of the integral of the window itself.
    let sum = 0;
    const h = 0.01;
    for (let i = -40000; i < 40000; i++) sum += stdpWindow((i + 0.5) * h, P) * h; // midpoint rule
    expect(Math.abs(sum - windowIntegral(P)) < 1e-5).toBe(true);
  });

  it("falls back to the contract config for a missing or malformed config", () => {
    expect(normalizeStdpConfig(undefined)).toEqual({ pairings: 60, w0: 0.5, wMax: 1 });
    expect(normalizeStdpConfig({ pairings: -3, w0: 5, wMax: 2 })).toEqual({ pairings: 60, w0: 2, wMax: 2 });
  });
});

describe("widgets/stdp-explorer › widget", () => {
  it("reflects declared defaults on first paint and draws both charts", async () => {
    await ensureRegistered();
    await withRealDocument(() => {
      const container = dom.freshMount();
      const instance = mountWidget(sampleSpec(), container);
      expect(instance === null).toBe(false);
      const inputs = container.querySelectorAll(".widget__control input");
      expect(Array.from(inputs).map((i) => i.value)).toEqual(["0.01", "0.0105", "20", "20", "10"]);
      // The select default is checked through what was drawn, not select.value
      // (under linkedom, sim-kit's setInputValue clears the selected option).
      expect(container.querySelector(".widget__control select") === null).toBe(false);
      const svgs = container.querySelectorAll(".widget__plot svg");
      expect(svgs.length).toBe(2);
      const texts = Array.from(container.querySelectorAll("text")).map((n) => n.textContent);
      expect(texts.includes("additive (selected) at Δt = 10 ms")).toBe(true);
      expect(texts.some((t) => t.startsWith("potentiation"))).toBe(true);
      expect(texts.some((t) => t.startsWith("depression"))).toBe(true);
      const readout = container.querySelector(".widget__readout").textContent;
      expect(readout.includes("Δw(Δt = 10 ms) = +0.00607")).toBe(true);
      expect(readout.includes("net depression bias")).toBe(true);
      instance.destroy();
    });
  });

  it("tolerates a spec with no params or config", async () => {
    await ensureRegistered();
    await withRealDocument(() => {
      const container = dom.freshMount();
      const instance = mountWidget({ type: "stdp-explorer" }, container);
      expect(container.querySelectorAll(".widget__plot svg").length).toBe(2);
      expect(container.querySelectorAll(".widget__control").length).toBe(6);
      instance.destroy();
    });
  });

  it("rejects an out-of-range control change and keeps the last valid value", async () => {
    await ensureRegistered();
    await withRealDocument(() => {
      const container = dom.freshMount();
      const instance = mountWidget(sampleSpec(), container);
      const field = container.querySelectorAll(".widget__control")[4]; // deltaT
      const input = field.querySelector("input");
      const before = container.querySelector(".widget__readout").textContent;
      input.value = "250";
      input.dispatchEvent(makeInputEvent(input));
      expect(field.classList.contains("widget__control--invalid")).toBe(true);
      expect(field.querySelector(".widget__control-error").hidden).toBe(false);
      expect(input.value).toBe("10");
      expect(container.querySelector(".widget__readout").textContent).toBe(before);
      instance.destroy();
    });
  });

  it("update() with a valid value redraws; destroy() leaves the widget inert", async () => {
    await ensureRegistered();
    await withRealDocument(() => {
      const container = dom.freshMount();
      const instance = mountWidget(sampleSpec(), container);
      const readout = container.querySelector(".widget__readout");
      const svgBefore = container.querySelectorAll(".widget__plot svg")[1].innerHTML;
      instance.update({ deltaT: -10, rule: "multiplicative" });
      expect(readout.textContent.includes("Δw(Δt = −10 ms)") || readout.textContent.includes("Δw(Δt = -10 ms)")).toBe(true);
      expect(readout.textContent.includes("(multiplicative)")).toBe(true);
      expect(container.querySelectorAll(".widget__plot svg")[1].innerHTML === svgBefore).toBe(false);

      instance.destroy();
      const after = readout.textContent;
      const input = container.querySelectorAll(".widget__control input")[4];
      input.value = "30";
      input.dispatchEvent(makeInputEvent(input)); // listener removed → no redraw
      instance.update({ deltaT: 30 });
      expect(readout.textContent).toBe(after);
    });
  });
});
