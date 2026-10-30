// tests/src/widgets/lif-neuron.test.js
//
// Unit tests for the `lif-neuron` widget type (src/widgets/types/lif-neuron.js).
//
//   (a) science: the exported pure functions — rheobase, no spikes below it,
//       simulated rate within ~5% of the analytic rate, refractory ceiling,
//       noise σ = std of the free membrane, input shapes, determinism.
//   (b) mount: declared defaults reflected on first paint (inputs + SVG).
//   (c) an out-of-range control change is rejected (invalid mark, value kept).
//   (d) update() with a valid value redraws; destroy() leaves nothing running.
//
// Mounting goes through a fresh, cache-busted dynamic import so the module's
// registerWidget side effect re-runs even after another test file cleared the
// registry (same pattern as parameter-plot.test.js).

import { describe, it, expect } from "../../harness.js";
import { ensureDom } from "../../dom.js";
import { mountWidget } from "../../../src/widgets/registry.js";
import {
  simulateLif,
  lifRate,
  rheobase,
  inputCurrentAt,
  normalizeLifConfig,
} from "../../../src/widgets/types/lif-neuron.js";

const dom = await ensureDom();


async function ensureRegistered() {
  await import(`../../../src/widgets/types/lif-neuron.js?fresh=${Math.random()}`);
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
    type: "lif-neuron",
    title: "Leaky integrate-and-fire neuron",
    params: [
      { key: "current", label: "Input current I (nA)", control: "range", min: 0, max: 4, step: 0.05, default: 2 },
      { key: "tau", label: "Membrane time constant τm (ms)", control: "range", min: 2, max: 50, step: 1, default: 20 },
      { key: "threshold", label: "Threshold (mV)", control: "range", min: -60, max: -40, step: 0.5, default: -50 },
      { key: "refractory", label: "Refractory period (ms)", control: "range", min: 0, max: 10, step: 0.5, default: 2 },
      { key: "noise", label: "Input noise σ (mV)", control: "range", min: 0, max: 5, step: 0.1, default: 0 },
      { key: "input", label: "Input shape", control: "select", options: ["constant", "step", "ramp", "sine"], default: "step" },
    ],
    config: { duration: 200, dt: 0.1, vRest: -65, vReset: -65, resistance: 10, showFI: true },
  };
}

const near = (a, b, rel) => Math.abs(a - b) <= rel * Math.abs(b);

describe("widgets/lif-neuron › model", () => {
  it("rheobase is (θ − V_rest)/R", () => {
    expect(rheobase({ threshold: -50, vRest: -65, resistance: 10 })).toBe(1.5);
    expect(near(rheobase({ threshold: -40, vRest: -65, resistance: 5 }), 5, 1e-12)).toBe(true);
  });

  it("does not spike below rheobase (noise-free), and the analytic rate is 0 there", () => {
    const sim = simulateLif({ current: 1.45, input: "constant", duration: 1000 });
    expect(sim.spikes.length).toBe(0);
    expect(lifRate(1.45, {})).toBe(0);
    expect(lifRate(1.5, {})).toBe(0);
    // The membrane settles just below threshold at V_rest + R·I.
    expect(Math.abs(sim.v[sim.v.length - 1] - (-65 + 14.5)) < 0.01).toBe(true);
  });

  it("matches the analytic f = 1/(t_ref + τ ln(RI/(RI − (θ − V_rest)))) at default parameters", () => {
    // I = 2 nA, R = 10 MΩ, τ = 20 ms, θ − V_rest = 15 mV, t_ref = 2 ms.
    const expected = 1000 / (2 + 20 * Math.log(20 / 5));
    expect(near(lifRate(2, {}), expected, 1e-12)).toBe(true);
  });

  it("simulated rate is within 5% of the analytic rate across currents and parameters", () => {
    const cases = [
      { current: 1.7 },
      { current: 2 },
      { current: 3, tau: 10 },
      { current: 4, refractory: 5 },
      { current: 2.5, threshold: -55, tau: 35 },
    ];
    for (const c of cases) {
      const sim = simulateLif({ ...c, input: "constant", duration: 3000 });
      const simRate = (sim.spikes.length / 3000) * 1000;
      const isiRate = 1000 / ((sim.spikes.at(-1) - sim.spikes[0]) / (sim.spikes.length - 1));
      const analytic = lifRate(c.current, c);
      expect(analytic > 0).toBe(true);
      expect(near(simRate, analytic, 0.05)).toBe(true);
      expect(near(isiRate, analytic, 0.05)).toBe(true);
    }
  });

  it("rate grows with current and is capped by the refractory period", () => {
    expect(lifRate(3, {}) > lifRate(2, {})).toBe(true);
    expect(lifRate(1e6, { refractory: 5 }) < 200).toBe(true);
  });

  it("reset and refractory clamp hold V at V_reset after a spike", () => {
    const sim = simulateLif({ current: 3, input: "constant", refractory: 5, duration: 100 });
    expect(sim.spikes.length > 0).toBe(true);
    const k = Math.round(sim.spikes[0] / 0.1);
    for (let j = k; j < k + 50; j++) expect(sim.v[j]).toBe(-65);
    expect(sim.v[k + 51] > -65).toBe(true);
  });

  it("input shapes follow their definitions", () => {
    expect(inputCurrentAt("constant", 123, 2, 200)).toBe(2);
    expect(inputCurrentAt("step", 39.9, 2, 200)).toBe(0);
    expect(inputCurrentAt("step", 40, 2, 200)).toBe(2);
    expect(inputCurrentAt("ramp", 100, 2, 200)).toBe(1);
    expect(near(inputCurrentAt("sine", 12.5, 2, 200), 2, 1e-12)).toBe(true);
    expect(near(inputCurrentAt("sine", 0, 2, 200), 1, 1e-12)).toBe(true);
    const sim = simulateLif({ input: "step", current: 2 });
    expect(sim.spikes.every((t) => t > 40)).toBe(true);
  });

  it("noise σ is the std of the free membrane, and runs are deterministic", () => {
    const sim = simulateLif({ current: 0, noise: 3, input: "constant", duration: 20000 });
    const vs = sim.v.slice(1000);
    const mean = vs.reduce((a, b) => a + b, 0) / vs.length;
    const sd = Math.sqrt(vs.reduce((a, b) => a + (b - mean) ** 2, 0) / vs.length);
    expect(near(sd, 3, 0.1)).toBe(true);
    expect(Math.abs(mean + 65) < 0.5).toBe(true);
    const a = simulateLif({ noise: 2 });
    const b = simulateLif({ noise: 2 });
    expect(a.v).toEqual(b.v);
    expect(a.t.length).toBe(2001);
  });

  it("falls back to the contract config for a missing or malformed config", () => {
    expect(normalizeLifConfig(undefined)).toEqual({ duration: 200, dt: 0.1, vRest: -65, vReset: -65, resistance: 10, showFI: true });
    expect(normalizeLifConfig({ dt: -1, duration: "x", showFI: false }).dt).toBe(0.1);
    expect(normalizeLifConfig({ showFI: false }).showFI).toBe(false);
  });
});

describe("widgets/lif-neuron › widget", () => {
  it("reflects declared defaults on first paint and draws SVG", async () => {
    await ensureRegistered();
    await withRealDocument(() => {
      const container = dom.freshMount();
      const instance = mountWidget(sampleSpec(), container);
      expect(instance === null).toBe(false);
      const inputs = container.querySelectorAll(".widget__control input");
      expect(Array.from(inputs).map((i) => i.value)).toEqual(["2", "20", "-50", "2", "0"]);
      // The select's default ("step") is checked through what was drawn, not
      // select.value: under linkedom, sim-kit's setInputValue assigning
      // option.selected = false to a later option clears the selected one.
      expect(container.querySelector(".widget__control select") === null).toBe(false);
      const texts = Array.from(container.querySelectorAll("text")).map((n) => n.textContent);
      expect(texts.includes("input current I(t), step")).toBe(true);
      const svgs = container.querySelectorAll(".widget__plot svg");
      expect(svgs.length).toBe(2); // trace + f–I
      const classes = Array.from(svgs[0].querySelectorAll("*")).map((n) => n.getAttribute("class") || "");
      expect(classes.some((c) => c.includes("sim-trace"))).toBe(true);
      expect(classes.some((c) => c.includes("sim-threshold"))).toBe(true);
      expect(classes.some((c) => c.includes("sim-spike"))).toBe(true);
      const readout = container.querySelector(".widget__readout");
      expect(readout.textContent.includes("rheobase 1.50 nA")).toBe(true);
      instance.destroy();
    });
  });

  it("omits the f–I chart when showFI is false and tolerates a missing config", async () => {
    await ensureRegistered();
    await withRealDocument(() => {
      const container = dom.freshMount();
      const spec = { ...sampleSpec(), config: { showFI: false } };
      const instance = mountWidget(spec, container);
      expect(container.querySelectorAll(".widget__plot svg").length).toBe(1);
      instance.destroy();
      const c2 = dom.freshMount();
      const i2 = mountWidget({ type: "lif-neuron" }, c2);
      expect(c2.querySelectorAll(".widget__plot svg").length).toBe(2);
      i2.destroy();
    });
  });

  it("rejects an out-of-range control change and keeps the last valid value", async () => {
    await ensureRegistered();
    await withRealDocument(() => {
      const container = dom.freshMount();
      const instance = mountWidget(sampleSpec(), container);
      const field = container.querySelectorAll(".widget__control")[0];
      const input = field.querySelector("input");
      const before = container.querySelector(".widget__readout").textContent;
      input.value = "9";
      input.dispatchEvent(makeInputEvent(input));
      expect(field.classList.contains("widget__control--invalid")).toBe(true);
      expect(field.querySelector(".widget__control-error").hidden).toBe(false);
      expect(input.value).toBe("2");
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
      const svgBefore = container.querySelector(".widget__plot svg").innerHTML;
      instance.update({ current: 1, input: "constant" });
      expect(readout.textContent.startsWith("Spikes: 0")).toBe(true);
      expect(container.querySelector(".widget__control input").value).toBe("1");
      expect(container.querySelector(".widget__plot svg").innerHTML === svgBefore).toBe(false);

      instance.destroy();
      const after = readout.textContent;
      const input = container.querySelector(".widget__control input");
      input.value = "3";
      input.dispatchEvent(makeInputEvent(input)); // listener removed → no redraw
      instance.update({ current: 3 });
      expect(readout.textContent).toBe(after);
    });
  });
});
