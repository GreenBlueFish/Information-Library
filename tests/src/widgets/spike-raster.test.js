// tests/src/widgets/spike-raster.test.js
//
// Unit tests for the `spike-raster` widget type
// (src/widgets/types/spike-raster.js).
//
// Science: kWinners/overlap helpers; the k-WTA constraint (never more than k
// E spikes per step); determinism per seed; the qualitative ordering the
// widget is meant to show at defaults (no inhibition → dense, overlapping
// codes; E/I feedback and k-WTA → sparser, less overlapping codes); E/I with
// gain 0 is identical to "none" and higher gain lowers the E rate.
// Widget: defaults on first paint, out-of-range rejection, update() redraws,
// destroy() leaves no errors. Mounts go through a cache-busted dynamic import
// (see parameter-plot.test.js for why) and a pinned global `document`.

import { describe, it, expect } from "../../harness.js";
import { ensureDom } from "../../dom.js";
import { mountWidget } from "../../../src/widgets/registry.js";
import { simulateLayer, kWinners, overlap, winnerSet } from "../../../src/widgets/types/spike-raster.js";

const dom = await ensureDom();

async function ensureRegistered() {
  await import(`../../../src/widgets/types/spike-raster.js?fresh=${Math.random()}`);
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

function spec(overrides = {}) {
  return {
    type: "spike-raster",
    title: "Minicolumn layer with inhibition",
    params: [
      { key: "inhibition", label: "Inhibition", control: "select", options: ["none", "E/I feedback", "k-WTA"], default: "k-WTA" },
      { key: "k", label: "k (winners per step, k-WTA)", control: "range", min: 1, max: 30, step: 1, default: 5 },
      { key: "inhibitoryGain", label: "Inhibitory gain (E/I feedback)", control: "range", min: 0, max: 3, step: 0.1, default: 1.2 },
      { key: "inputRate", label: "Input rate (Hz)", control: "range", min: 5, max: 100, step: 1, default: 40 },
      { key: "seed", label: "Random seed", control: "number", min: 1, max: 9999, step: 1, default: 7 },
    ],
    config: { excitatory: 80, inhibitory: 20, inputs: 100, patterns: 4, patternMs: 75, dt: 1 },
    ...overrides,
  };
}

const cls = (el) => el.getAttribute("class") || "";

describe("widgets/spike-raster › science", () => {
  it("kWinners returns the k largest finite values (ties → lower index)", () => {
    expect(kWinners([0.2, 5, -Infinity, 3, 5, 1], 3)).toEqual([1, 4, 3]);
    expect(kWinners([1, 2], 5)).toEqual([1, 0]);
    expect(kWinners([1, 2, 3], 0)).toEqual([]);
    expect(kWinners([NaN, -Infinity, 2], 2)).toEqual([2]);
  });

  it("overlap counts shared members of arrays/Sets; winnerSet keeps the most active cells", () => {
    expect(overlap([1, 2, 3, 4], new Set([3, 4, 5]))).toBe(2);
    expect(overlap([], [1])).toBe(0);
    expect(overlap([2, 2, 3], [2])).toBe(1);
    // top count 8 → threshold max(2, 4) = 4
    expect(winnerSet([0, 8, 4, 3, 1, 5])).toEqual([1, 2, 5]);
    expect(winnerSet([1, 1, 0])).toEqual([]);
  });

  it("is deterministic per seed and covers patterns × patternMs", () => {
    const a = simulateLayer({ inhibition: "E/I feedback", seed: 11 });
    const b = simulateLayer({ inhibition: "E/I feedback", seed: 11 });
    const c = simulateLayer({ inhibition: "E/I feedback", seed: 12 });
    expect(a.spikes).toEqual(b.spikes);
    expect(JSON.stringify(a.spikes) === JSON.stringify(c.spikes)).toBe(false);
    expect(a.stats.duration).toBe(300);
    expect(a.sdrs.length).toBe(4);
    expect(a.spikes.every((s) => s.t >= 0 && s.t < 300)).toBe(true);
    expect(a.patternLines.every((l) => l.length === 20)).toBe(true);
  });

  it("k-WTA never lets more than k E cells fire in one step", () => {
    for (const k of [1, 3, 5]) {
      const r = simulateLayer({ inhibition: "k-WTA", k, seed: 7, inputRate: 100 });
      const perStep = new Map();
      for (const s of r.spikes) if (!s.inhibitory) perStep.set(s.t, (perStep.get(s.t) || 0) + 1);
      expect(Math.max(...perStep.values()) <= k).toBe(true);
      expect(r.spikes.some((s) => s.inhibitory)).toBe(false);
    }
    // Without inhibition the same drive produces steps with many more spikes.
    const none = simulateLayer({ inhibition: "none", seed: 7, inputRate: 100 });
    const perStep = new Map();
    for (const s of none.spikes) perStep.set(s.t, (perStep.get(s.t) || 0) + 1);
    expect(Math.max(...perStep.values()) > 5).toBe(true);
  });

  it("at defaults: none is dense and overlapping; E/I and k-WTA are clearly sparser", () => {
    for (const seed of [7, 42, 3]) {
      const none = simulateLayer({ inhibition: "none", seed }).stats;
      const ei = simulateLayer({ inhibition: "E/I feedback", seed }).stats;
      const kw = simulateLayer({ inhibition: "k-WTA", seed }).stats;
      expect(none.meanActiveFraction > 0.5).toBe(true);
      expect(ei.meanActiveFraction < 0.6 * none.meanActiveFraction).toBe(true);
      expect(kw.meanActiveFraction < 0.4 * none.meanActiveFraction).toBe(true);
      expect(kw.meanActiveFraction > 0).toBe(true);
      expect(none.meanOverlapFraction > ei.meanOverlapFraction).toBe(true);
      expect(none.meanOverlapFraction > kw.meanOverlapFraction).toBe(true);
    }
  });

  it("k-WTA sparsity grows with k", () => {
    const f = (k) => simulateLayer({ inhibition: "k-WTA", k, seed: 7 }).stats.meanActiveFraction;
    expect(f(1) < f(5)).toBe(true);
    expect(f(5) < f(15)).toBe(true);
  });

  it("E/I feedback: gain 0 equals no inhibition; higher gain lowers the E rate; I cells fire", () => {
    const none = simulateLayer({ inhibition: "none", seed: 7 });
    const g0 = simulateLayer({ inhibition: "E/I feedback", inhibitoryGain: 0, seed: 7 });
    expect(g0.spikes.filter((s) => !s.inhibitory)).toEqual(none.spikes);
    const g1 = simulateLayer({ inhibition: "E/I feedback", inhibitoryGain: 1.2, seed: 7 });
    const g3 = simulateLayer({ inhibition: "E/I feedback", inhibitoryGain: 3, seed: 7 });
    expect(g1.stats.eRate < g0.stats.eRate).toBe(true);
    expect(g3.stats.eRate < g1.stats.eRate).toBe(true);
    expect(g1.spikes.some((s) => s.inhibitory && s.i >= 80)).toBe(true);
  });

  it("tolerates a missing or partial config", () => {
    const r = simulateLayer({ excitatory: undefined, patterns: 2 });
    expect(r.stats.nE).toBe(80);
    expect(r.stats.patterns).toBe(2);
    expect(r.stats.duration).toBe(150);
  });
});

describe("widgets/spike-raster › widget", () => {
  it("reflects defaults on first paint: raster, pattern labels, SDR strips", async () => {
    await ensureRegistered();
    await withRealDocument(() => {
      const container = dom.freshMount();
      const instance = mountWidget(spec(), container);
      expect(instance === null).toBe(false);
      const inputs = Array.from(container.querySelectorAll(".widget__control input"));
      expect(inputs.map((i) => i.value)).toEqual(["5", "1.2", "40", "7"]);
      expect(container.querySelector(".widget__control select").value).toBe("k-WTA");

      const svgs = container.querySelectorAll(".widget__plot svg");
      expect(svgs.length).toBe(2);
      const paths = Array.from(svgs[0].querySelectorAll("path"));
      expect(paths.length > 0).toBe(true);
      expect(paths.every((p) => cls(p).includes("sim-spike plot-series--1"))).toBe(true);
      const texts = Array.from(svgs[0].querySelectorAll("text")).map((t) => t.textContent);
      for (const name of ["pattern A", "pattern B", "pattern C", "pattern D", "E (80)", "I (20)"]) {
        expect(texts.includes(name)).toBe(true);
      }
      const cells = Array.from(svgs[1].querySelectorAll("rect"));
      expect(cells.length).toBe(4 * 80);
      expect(cells.some((c) => cls(c).includes("sim-cell--active"))).toBe(true);
      expect(container.querySelector(".widget__readout").textContent.includes("mean active fraction")).toBe(true);
      instance.destroy();
    });
  });

  it("rejects an out-of-range control change and keeps the last valid drawing", async () => {
    await ensureRegistered();
    await withRealDocument(() => {
      const container = dom.freshMount();
      const instance = mountWidget(spec(), container);
      const field = container.querySelectorAll(".widget__control")[1];
      const input = field.querySelector("input");
      const before = container.querySelector(".widget__readout").textContent;
      const firstPath = container.querySelector(".widget__plot svg path");
      input.value = "99";
      input.dispatchEvent(makeInputEvent(input));
      expect(field.classList.contains("widget__control--invalid")).toBe(true);
      expect(field.querySelector(".widget__control-error").hidden).toBe(false);
      expect(input.value).toBe("5");
      expect(container.querySelector(".widget__readout").textContent).toBe(before);
      expect(container.querySelector(".widget__plot svg path")).toBe(firstPath);
      instance.destroy();
    });
  });

  it("update() redraws (E/I mode draws I spikes in series 2); destroy() is clean", async () => {
    await ensureRegistered();
    await withRealDocument(() => {
      const container = dom.freshMount();
      const instance = mountWidget(spec(), container);
      instance.update({ inhibition: "E/I feedback" });
      const readout = container.querySelector(".widget__readout").textContent;
      expect(readout.startsWith("E/I feedback")).toBe(true);
      const paths = Array.from(container.querySelectorAll(".widget__plot svg path"));
      expect(paths.some((p) => cls(p).includes("plot-series--2"))).toBe(true);

      instance.update({ inhibition: "none" });
      expect(container.querySelector(".widget__readout").textContent.startsWith("none")).toBe(true);
      const after = container.querySelector(".widget__readout").textContent;

      instance.destroy();
      const input = container.querySelector(".widget__control input");
      input.value = "9";
      input.dispatchEvent(makeInputEvent(input));
      instance.update({ k: 9 });
      expect(container.querySelector(".widget__readout").textContent).toBe(after);
    });
  });

  it("redraws fast at default parameters", async () => {
    await ensureRegistered();
    await withRealDocument(() => {
      const container = dom.freshMount();
      const instance = mountWidget(spec(), container);
      const t0 = performance.now();
      for (const mode of ["none", "E/I feedback", "k-WTA"]) instance.update({ inhibition: mode });
      const per = (performance.now() - t0) / 3;
      expect(per < 150).toBe(true); // generous bound for slow CI / a test DOM
      instance.destroy();
    });
  });
});
