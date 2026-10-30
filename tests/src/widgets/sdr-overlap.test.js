// tests/src/widgets/sdr-overlap.test.js
//
// Unit tests for the `sdr-overlap` widget type
// (src/widgets/types/sdr-overlap.js).
//
// Science: the log-space combinatorics (Ahmad & Hawkins 2015/2016) are checked
// against an independent EXACT BigInt computation of C(n,k), |Ω(x,b)| and
// P(false match); P must be non-increasing in θ, equal 1 at θ = 0 and 0 for
// θ > w; the noisy copy keeps w bits and overlaps in w − round(noise·w).
// Widget: defaults on first paint, out-of-range rejection, update() redraws,
// destroy() leaves no errors. Mounts go through a cache-busted dynamic import
// (see parameter-plot.test.js for why) and a pinned global `document`.

import { describe, it, expect } from "../../harness.js";
import { ensureDom } from "../../dom.js";
import { mountWidget } from "../../../src/widgets/registry.js";
import {
  logBinomial,
  log10Capacity,
  log10OverlapSetSize,
  log10FalseMatchProbability,
  falseMatchProbability,
  randomSdr,
  noisyCopy,
  overlapCount,
  formatPow10,
} from "../../../src/widgets/types/sdr-overlap.js";
import { makeRng } from "../../../src/widgets/sim-kit.js";

const dom = await ensureDom();

async function ensureRegistered() {
  await import(`../../../src/widgets/types/sdr-overlap.js?fresh=${Math.random()}`);
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

/* Independent exact reference: BigInt binomials. */
function bigBinom(n, k) {
  if (k < 0 || k > n) return 0n;
  let kk = Math.min(k, n - k);
  let r = 1n;
  for (let i = 1; i <= kk; i++) r = (r * BigInt(n - kk + i)) / BigInt(i);
  return r;
}
/** log10 of a positive BigInt (≈15 significant digits). */
function bigLog10(x) {
  const s = x.toString();
  const head = Number(s.slice(0, 16));
  return Math.log10(head) + (s.length - Math.min(16, s.length));
}
function exactLog10P(n, w, theta) {
  let num = 0n;
  for (let b = theta; b <= w; b++) num += bigBinom(w, b) * bigBinom(n - w, w - b);
  if (num === 0n) return -Infinity;
  return bigLog10(num) - bigLog10(bigBinom(n, w));
}
const close = (a, b, tol) => Math.abs(a - b) <= tol;

function spec(overrides = {}) {
  return {
    type: "sdr-overlap",
    title: "SDR overlap and false matches",
    params: [
      { key: "n", label: "Size n (bits)", control: "range", min: 64, max: 4096, step: 64, default: 2048 },
      { key: "w", label: "Active bits w", control: "range", min: 2, max: 200, step: 1, default: 40 },
      { key: "theta", label: "Match threshold θ", control: "range", min: 1, max: 200, step: 1, default: 20 },
      { key: "noise", label: "Noise (% of active bits moved)", control: "range", min: 0, max: 100, step: 1, default: 30 },
      { key: "seed", label: "Random seed", control: "number", min: 1, max: 9999, step: 1, default: 3 },
    ],
    config: {},
    ...overrides,
  };
}

describe("widgets/sdr-overlap › science", () => {
  it("logBinomial matches exact BigInt binomials (small and large n)", () => {
    for (const [n, k] of [[10, 3], [64, 8], [64, 32], [2048, 40], [4096, 200]]) {
      const exact = bigLog10(bigBinom(n, k));
      expect(close(logBinomial(n, k) / Math.LN10, exact, 1e-9 * Math.max(1, exact))).toBe(true);
    }
    expect(Math.round(Math.exp(logBinomial(10, 3)))).toBe(120);
    expect(logBinomial(5, 6)).toBe(-Infinity);
    expect(logBinomial(5, -1)).toBe(-Infinity);
    expect(logBinomial(7, 0)).toBe(0);
  });

  it("capacity of n=2048, w=40 is ≈ 2.37 × 10^84 (Ahmad & Hawkins 2015)", () => {
    expect(close(log10Capacity(2048, 40), bigLog10(bigBinom(2048, 40)), 1e-9)).toBe(true);
    expect(formatPow10(log10Capacity(2048, 40))).toBe("2.37 × 10^84");
  });

  it("|Ω(x,b)| summed over b equals C(n,w) (overlap sets partition the space)", () => {
    const n = 64;
    const w = 8;
    let total = 0;
    for (let b = 0; b <= w; b++) total += Math.pow(10, log10OverlapSetSize(n, w, b));
    expect(close(total / Math.pow(10, log10Capacity(n, w)), 1, 1e-9)).toBe(true);
  });

  it("P(false match) matches an exact BigInt computation (n=64,w=8 every θ; n=2048,w=40)", () => {
    for (let theta = 1; theta <= 8; theta++) {
      expect(close(log10FalseMatchProbability(64, 8, theta), exactLog10P(64, 8, theta), 1e-9)).toBe(true);
    }
    for (const theta of [1, 5, 10, 20, 30, 40]) {
      expect(close(log10FalseMatchProbability(2048, 40, theta), exactLog10P(2048, 40, theta), 1e-8)).toBe(true);
    }
    // Exact small case as a ratio: n=64,w=8,θ=8 → 1 / C(64,8).
    expect(close(falseMatchProbability(64, 8, 8) * Number(bigBinom(64, 8)), 1, 1e-9)).toBe(true);
  });

  it("P is 1 at θ=0, strictly decreasing in θ up to w, and 0 for θ > w", () => {
    expect(close(falseMatchProbability(2048, 40, 0), 1, 1e-12)).toBe(true);
    let prev = 1;
    for (let t = 1; t <= 40; t++) {
      const l = log10FalseMatchProbability(2048, 40, t);
      expect(l < prev).toBe(true);
      prev = l;
    }
    expect(falseMatchProbability(2048, 40, 41)).toBe(0);
    expect(log10FalseMatchProbability(2048, 40, 41)).toBe(-Infinity);
    expect(formatPow10(-Infinity)).toBe("0");
  });

  it("no overflow at the largest sizes (n=4096, w=200, θ=200)", () => {
    const l = log10FalseMatchProbability(4096, 200, 200);
    expect(Number.isFinite(l)).toBe(true);
    expect(close(l, -log10Capacity(4096, 200), 1e-9)).toBe(true);
    expect(close(l, exactLog10P(4096, 200, 200), 1e-8)).toBe(true);
  });

  it("noisyCopy keeps w bits, moves exactly round(noise·w) of them, and is seeded", () => {
    const n = 2048;
    const x = randomSdr(n, 40, makeRng(3));
    expect(x.length).toBe(40);
    expect(new Set(x).size).toBe(40);
    for (const noise of [0, 30, 50, 100]) {
      const y = noisyCopy(x, n, noise, makeRng(9));
      expect(y.length).toBe(40);
      expect(new Set(y).size).toBe(40);
      expect(overlapCount(x, y)).toBe(40 - Math.round((noise / 100) * 40));
      expect(y.every((i) => i >= 0 && i < n)).toBe(true);
    }
    expect(noisyCopy(x, n, 30, makeRng(5))).toEqual(noisyCopy(x, n, 30, makeRng(5)));
    expect(overlapCount([1, 2, 3], new Set([3, 4]))).toBe(1);
  });
});

describe("widgets/sdr-overlap › widget", () => {
  it("reflects defaults on first paint and draws SVG", async () => {
    await ensureRegistered();
    await withRealDocument(() => {
      const container = dom.freshMount();
      const instance = mountWidget(spec(), container);
      expect(instance === null).toBe(false);
      const inputs = Array.from(container.querySelectorAll(".widget__control input"));
      expect(inputs.map((i) => i.value)).toEqual(["2048", "40", "20", "30", "3"]);
      const svgs = container.querySelectorAll(".widget__plot svg");
      expect(svgs.length).toBe(2);
      const overlapCells = Array.from(svgs[0].querySelectorAll("rect")).filter((r) =>
        (r.getAttribute("class") || "").includes("sim-cell--overlap"),
      );
      // 28 shared bits drawn in each of the two grids, plus one legend swatch.
      expect(overlapCells.length).toBe(2 * 28 + 1);
      const readout = container.querySelector(".widget__readout").textContent;
      expect(readout.includes("overlap |x·y| = 28")).toBe(true);
      expect(readout.includes("matches at θ = 20")).toBe(true);
      expect(readout.includes("2.49 × 10^-26")).toBe(true);
      expect(readout.includes("10^84.4")).toBe(true);
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
      input.value = "500";
      input.dispatchEvent(makeInputEvent(input));
      expect(field.classList.contains("widget__control--invalid")).toBe(true);
      expect(field.querySelector(".widget__control-error").hidden).toBe(false);
      expect(input.value).toBe("40");
      expect(container.querySelector(".widget__readout").textContent).toBe(before);
      instance.destroy();
    });
  });

  it("flags θ > w in the readout instead of rejecting it; update() redraws; destroy() is clean", async () => {
    await ensureRegistered();
    await withRealDocument(() => {
      const container = dom.freshMount();
      const instance = mountWidget(spec(), container);
      instance.update({ theta: 50 });
      const field = container.querySelectorAll(".widget__control")[2];
      expect(field.classList.contains("widget__control--invalid")).toBe(false);
      const readout = container.querySelector(".widget__readout").textContent;
      expect(readout.includes("no match possible")).toBe(true);
      expect(readout.includes("P(false match) = 0")).toBe(true);

      instance.update({ n: 64, w: 8, theta: 4, noise: 0 });
      const r2 = container.querySelector(".widget__readout").textContent;
      expect(r2.includes("overlap |x·y| = 8 of w = 8")).toBe(true);
      // Small n draws every cell: 64 lattice cells per grid (+ legend swatches).
      const svg = container.querySelector(".widget__plot svg");
      expect(svg.querySelectorAll("rect").length).toBe(2 * 64 + 3);

      instance.destroy();
      const input = container.querySelector(".widget__control input");
      input.value = "128";
      input.dispatchEvent(makeInputEvent(input));
      instance.update({ n: 128 });
      expect(container.querySelector(".widget__readout").textContent).toBe(r2);
    });
  });
});
