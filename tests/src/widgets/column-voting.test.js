// tests/src/widgets/column-voting.test.js
//
// Unit tests for the `column-voting` widget type
// (src/widgets/types/column-voting.js).
//
// Science (pure functions, no DOM), after Hawkins, Ahmad & Cui (2017):
//   - voting reduces mean sensations to recognition vs no voting (≥ 3 columns);
//   - with voting, more columns → non-increasing mean steps (noise-free);
//   - with 1 column voting on/off are identical;
//   - objects are ambiguous (a feature-at-location fits several objects) yet
//     pairwise distinguishable; evidence/candidates behave as documented;
//   - determinism for a given seed.
// Widget (DOM): defaults on first paint, out-of-range rejection, update()
// redraws, destroy() disposes cleanly.
//
// Mounting follows parameter-plot.test.js (cache-busted re-registration and
// `withRealDocument`, needed because plot.js uses the global document).

import { describe, it, expect } from "../../harness.js";
import { ensureDom } from "../../dom.js";
import { mountWidget } from "../../../src/widgets/registry.js";
import { makeRng } from "../../../src/widgets/sim-kit.js";
import {
  makeObjects,
  meanAmbiguity,
  sense,
  newEvidence,
  updateEvidence,
  candidates,
  runTrial,
  meanStepsCurve,
} from "../../../src/widgets/types/column-voting.js";

const dom = await ensureDom();

async function ensureRegistered() {
  await import(`../../../src/widgets/types/column-voting.js?fresh=${Math.random()}`);
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

function spec() {
  return {
    type: "column-voting",
    title: "Thousand-brains voting between columns",
    params: [
      { key: "columns", label: "Number of columns", control: "range", min: 1, max: 9, step: 1, default: 3 },
      { key: "voting", label: "Lateral voting", control: "select", options: ["on", "off"], default: "on" },
      { key: "object", label: "Object presented", control: "select", options: ["mug", "bowl", "can", "pen", "ball", "box"], default: "mug" },
      { key: "noise", label: "Sensing noise (prob.)", control: "range", min: 0, max: 0.5, step: 0.05, default: 0 },
      { key: "seed", label: "Random seed", control: "number", min: 1, max: 9999, step: 1, default: 5 },
    ],
    config: { objects: 6, locations: 9, features: 5 },
  };
}

const cfg = { objects: 6, locations: 9, features: 5 };

describe("widgets/column-voting — model", () => {
  it("objects are ambiguous per sensation but pairwise distinguishable", () => {
    const objects = makeObjects(cfg, makeRng(5));
    expect(objects.map((o) => o.name)).toEqual(["mug", "bowl", "can", "pen", "ball", "box"]);
    expect(meanAmbiguity(objects) > 2).toBe(true);
    for (let i = 0; i < objects.length; i++) {
      for (let j = i + 1; j < objects.length; j++) {
        const d = objects[i].features.filter((f, l) => f !== objects[j].features[l]).length;
        expect(d >= 2).toBe(true);
      }
    }
  });

  it("noise-free sensing returns the true feature; evidence narrows candidates", () => {
    const objects = makeObjects(cfg, makeRng(5));
    const rng = makeRng(1);
    const ev = newEvidence(objects.length);
    for (let loc = 0; loc < 9; loc++) {
      const f = sense(objects[2], loc, 0, rng, 5);
      expect(f).toBe(objects[2].features[loc]);
      updateEvidence(ev, objects, loc, f);
    }
    expect(candidates(ev, 0)).toEqual([2]);
  });

  it("voting reduces mean steps vs no voting for 3+ columns", () => {
    for (const noise of [0, 0.2]) {
      const objects = makeObjects(cfg, makeRng(5));
      const curve = meanStepsCurve({ objects, noise, seed: 5 });
      for (let c = 3; c <= 9; c++) {
        expect(curve.on[c - 1].y < curve.off[c - 1].y).toBe(true);
      }
    }
  });

  it("with voting, more columns never need more sensations (noise-free)", () => {
    for (const seed of [5, 42]) {
      const objects = makeObjects(cfg, makeRng(seed));
      const on = meanStepsCurve({ objects, noise: 0, seed }).on;
      for (const [a, b] of [[1, 2], [2, 3], [3, 5], [5, 9]]) {
        expect(on[b - 1].y <= on[a - 1].y).toBe(true);
      }
      // Enough columns cover the whole object in one sensation.
      expect(on[8].y).toBe(1);
    }
  });

  it("with 1 column, voting on and off are identical", () => {
    const objects = makeObjects(cfg, makeRng(9));
    for (let i = 0; i < 12; i++) {
      for (const noise of [0, 0.3]) {
        const base = { objects, columns: 1, objectIndex: i % 6, noise, seed: 100 + i, features: 5 };
        expect(runTrial({ ...base, voting: true })).toBe(runTrial({ ...base, voting: false }));
      }
    }
  });

  it("is deterministic for the same seed", () => {
    expect(JSON.stringify(makeObjects(cfg, makeRng(3)))).toBe(JSON.stringify(makeObjects(cfg, makeRng(3))));
    const objects = makeObjects(cfg, makeRng(3));
    const a = meanStepsCurve({ objects, noise: 0.25, seed: 3, trials: 10 });
    const b = meanStepsCurve({ objects, noise: 0.25, seed: 3, trials: 10 });
    expect(a).toEqual(b);
  });
});

describe("widgets/column-voting — widget", () => {
  it("reflects defaults on first paint and draws panels and the curve", async () => {
    await ensureRegistered();
    await withRealDocument(() => {
      const container = dom.freshMount();
      const instance = mountWidget(spec(), container);
      expect(instance === null).toBe(false);
      // (linkedom does not implement select.value, so only <input>s are compared.)
      const inputs = Array.from(container.querySelectorAll(".widget__control input"));
      expect(inputs.map((i) => i.value)).toEqual(["3", "0", "5"]);
      const plots = container.querySelectorAll(".widget__plot");
      expect(plots.length).toBe(2);
      expect(plots[0].querySelector("svg") === null).toBe(false);
      expect(plots[1].querySelector("svg") === null).toBe(false);
      // 3 columns + consensus, 6 bars each.
      const bars = Array.from(plots[0].querySelectorAll("rect")).filter((r) => (r.getAttribute("class") || "").includes("sim-bar"));
      expect(bars.length).toBe(24);
      instance.destroy();
    });
  });

  it("Run to recognition reaches the presented object", async () => {
    await ensureRegistered();
    await withRealDocument(() => {
      const container = dom.freshMount();
      const instance = mountWidget(spec(), container);
      const run = container.querySelectorAll(".widget__button")[1];
      run.dispatchEvent(makeEvent(run, "click"));
      const readout = container.querySelector(".widget__readout").textContent;
      expect(readout.includes("Columns agree on: mug ✓")).toBe(true);
      expect(/Steps to recognition: \d+/.test(readout)).toBe(true);
      const winners = Array.from(container.querySelectorAll(".widget__plot rect")).filter((r) => (r.getAttribute("class") || "").includes("sim-bar--winner"));
      expect(winners.length).toBe(4);
      instance.destroy();
    });
  });

  it("rejects an out-of-range control change", async () => {
    await ensureRegistered();
    await withRealDocument(() => {
      const container = dom.freshMount();
      const instance = mountWidget(spec(), container);
      const field = container.querySelectorAll(".widget__control")[0];
      const input = field.querySelector("input");
      input.value = "12";
      input.dispatchEvent(makeEvent(input, "input"));
      expect(field.classList.contains("widget__control--invalid")).toBe(true);
      expect(input.value).toBe("3");
      instance.destroy();
    });
  });

  it("update() with a valid value redraws; destroy() disposes the chart", async () => {
    await ensureRegistered();
    await withRealDocument(() => {
      const container = dom.freshMount();
      const instance = mountWidget(spec(), container);
      instance.update({ columns: 5 });
      const plots = container.querySelectorAll(".widget__plot");
      const bars = Array.from(plots[0].querySelectorAll("rect")).filter((r) => (r.getAttribute("class") || "").includes("sim-bar"));
      expect(bars.length).toBe(36);
      instance.destroy();
      expect(plots[1].querySelector("svg")).toBe(null);
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
});
