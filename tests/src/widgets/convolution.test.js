// Math › Convolution: the maths in src/widgets/sims/convolution.js and the
// convolution-3d and conv-sequence widget types. The numerical convolution
// integral is checked against closed forms worked by hand.
import { describe, it, expect } from "../../harness.js";
import { ensureDom } from "../../dom.js";
import { mountWidget } from "../../../src/widgets/registry.js";
import * as cv from "../../../src/widgets/sims/convolution.js";
import { sceneItems, walkSteps, outputCurve, SLICES, DEFAULT_PARAMS as C_PARAMS } from "../../../src/widgets/types/convolution-3d.js";
import { polyText, sumText, DEFAULT_PARAMS as Q_PARAMS } from "../../../src/widgets/types/conv-sequence.js";

const close = (a, b, tol) => { if (!(Math.abs(a - b) <= tol)) throw new Error(`${a} is not within ${tol} of ${b}`); };
const dom = await ensureDom();
const S = (name, a = 1) => cv.cSignal(name, a);

async function withRealDocument(fn) {
  const prev = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { value: dom.document, configurable: true, writable: true });
  try { return await fn(); } finally {
    if (prev) Object.defineProperty(globalThis, "document", prev); else delete globalThis.document;
  }
}

const P1 = "pulse, 1 s wide", P2 = "pulse, 2 s wide", EXP = "decaying exponential e^(−at)u(t)", STEP = "unit step u(t)";
const TS = [-0.5, 0, 0.3, 0.7, 1, 1.4, 2, 2.6, 3.2, 4.5];

describe("convolution sims — the integral against closed forms", () => {
  const cases = [
    [P1, P1, 1, (t) => (t < 0 ? 0 : t < 1 ? t : t < 2 ? 2 - t : 0)],
    [P1, P2, 1, (t) => (t < 0 ? 0 : t < 1 ? t : t < 2 ? 1 : t < 3 ? 3 - t : 0)],
    [P1, EXP, 0.7, (t) => (t < 0 ? 0 : t <= 1 ? (1 - Math.exp(-0.7 * t)) / 0.7 : ((Math.exp(0.7) - 1) * Math.exp(-0.7 * t)) / 0.7)],
    [EXP, EXP, 1.5, (t) => (t < 0 ? 0 : t * Math.exp(-1.5 * t))],
    [STEP, EXP, 2, (t) => (t < 0 ? 0 : (1 - Math.exp(-2 * t)) / 2)],
    [STEP, STEP, 1, (t) => Math.max(0, t)],
    ["ramp, 1 s long", P1, 1, (t) => (t < 0 ? 0 : t < 1 ? (t * t) / 2 : t < 2 ? (1 - (t - 1) ** 2) / 2 : 0)],
    ["Gaussian bump", "Gaussian bump", 1, (t) => cv.G_SIGMA * Math.sqrt(Math.PI) * Math.exp(-((t - 2) ** 2) / (4 * cv.G_SIGMA ** 2))],
    ["damped sine e^(−at)sin(2πt)u(t)", STEP, 0.5, (t) => {
      const a = 0.5, w = 2 * Math.PI;
      return t < 0 ? 0 : (w - Math.exp(-a * t) * (a * Math.sin(w * t) + w * Math.cos(w * t))) / (a * a + w * w);
    }],
    ["triangle, 2 s wide", "unit impulse δ(t)", 1, (t) => (t >= 0 && t <= 2 ? 1 - Math.abs(t - 1) : 0)],
    ["echo δ(t) + 0.5·δ(t − 1.5)", P1, 1, (t) => (t >= 0 && t < 1 ? 1 : 0) + (t >= 1.5 && t < 2.5 ? 0.5 : 0)],
  ];
  for (const [xn, hn, a, yf] of cases) {
    it(`${xn} * ${hn}`, () => {
      const x = S(xn, a), h = S(hn, a);
      for (const t of TS) {
        if ([0, 1, 2, 1.5, 2.5].includes(t) && (xn.startsWith("echo") || hn.includes("δ"))) continue; // jumps of y itself
        close(cv.convolve(x, h, t), yf(t), 2e-6);
      }
    });
  }

  it("convolution commutes for every pair", () => {
    for (const xn of cv.SIGNALS) for (const hn of cv.SIGNALS) {
      const x = S(xn, 0.8), h = S(hn, 0.8);
      for (const t of [0.35, 1.25, 2.9]) close(cv.convolve(x, h, t), cv.convolve(h, x, t), 1e-6);
    }
  });

  it("the area of y is the product of the areas, and y lives on the summed support", () => {
    for (const [xn, hn] of [[P1, P2], ["triangle, 2 s wide", "ramp, 1 s long"], ["Gaussian bump", P1], [EXP, P1]]) {
      const x = S(xn, 2), h = S(hn, 2);
      let s = 0; const d = 0.002;
      for (let t = -1; t < 14; t += d) s += cv.convolve(x, h, t + d / 2) * d;
      close(s, x.area * h.area, 2e-4);
      const [s0, s1] = cv.outSupport(x, h);
      expect(s0).toBe(x.s0 + h.s0);
      if (Number.isFinite(s1)) expect(Math.abs(cv.convolve(x, h, s1 + 0.01))).toBe(0);
    }
  });

  it("impulse times impulse gives impulses at the summed times", () => {
    const e = S("echo δ(t) + 0.5·δ(t − 1.5)");
    expect(cv.outImpulses(e, e)).toEqual([[0, 1], [1.5, 1], [3, 0.25]]);
    expect(cv.outImpulses(S("unit impulse δ(t)"), S(P1))).toEqual([]);
    expect(cv.convolve(e, e, 1)).toBe(0);
  });

  it("slices: the fixed-t slice integrates to y(t), the fixed-τ slice is a scaled copy of h", () => {
    const x = S("triangle, 2 s wide"), h = S(EXP, 1);
    const taus = Array.from({ length: 4001 }, (_, i) => -2 + i * 0.002);
    const { vals } = cv.sliceAtT(x, h, 1.7, taus);
    let s = 0; for (let i = 1; i < taus.length; i++) s += ((vals[i] + vals[i - 1]) / 2) * 0.002;
    close(s, cv.convolve(x, h, 1.7), 2e-3); // the trapezoid sum straddles the jump of h at τ = t
    const ts = [0.5, 1, 2];
    const sl = cv.sliceAtTau(x, h, 0.5, ts);
    ts.forEach((t, i) => close(sl.vals[i], x.f(0.5) * h.f(t - 0.5), 1e-15));
    expect(cv.overlap(S(P1), S(P1), 1.5)).toEqual([0.5, 1]);
    expect(cv.overlap(S(P1), S(P1), -0.5)).toBe(null);
    const ps = cv.productSupport(S(P1), S("echo δ(t) + 0.5·δ(t − 1.5)"), 2.25);
    expect(ps.range).toBe(null);
    expect(ps.spikes).toEqual([0.75]);
    expect(S(EXP, 1).formula).toBe("e^(−t)u(t)");
    expect(S(EXP, 0.5).formula).toBe("e^(−0.5t)u(t)");
  });
});

describe("convolution sims — sequences", () => {
  it("dconv and the terms of each output", () => {
    expect(cv.dconv([1, 2, 3], [1, 1, 1, 1])).toEqual([1, 3, 6, 6, 5, 3]);
    expect(cv.dconv([1, -1], [1, 2, 1])).toEqual([1, 1, -1, -1]);
    const d = cv.SEQUENCES["a die: 1/6 at n = 1 … 6"];
    const two = cv.dconv(d, d);
    close(two[7], 6 / 36, 1e-15);
    close(two[2], 1 / 36, 1e-15);
    close(two.reduce((p, q) => p + q, 0), 1, 1e-12);
    expect(cv.dterms([1, 2, 3], [1, 1, 1, 1], 2).map((t) => t.p)).toEqual([1, 2, 3]);
    expect(cv.nfmt(1 / 6)).toBe("1/6");
    expect(cv.nfmt(5 / 36)).toBe("5/36");
    expect(cv.nfmt(-0.5)).toBe("−0.5");
    expect(polyText([1, 2, 3])).toBe("1 + 2z⁻¹ + 3z⁻²");
    expect(polyText([1, 0, 0, 0.5])).toBe("1 + 0.5z⁻³");
    expect(polyText([1, -1])).toBe("1 − z⁻¹");
    expect(sumText([1, 2, 3], [1, 1, 1, 1], 2)).toBe("y[2] = x[0]·h[2] + x[1]·h[1] + x[2]·h[0] = 1·1 + 2·1 + 3·1 = 6");
  });
});

describe("convolution-3d and conv-sequence widgets", () => {
  it("scene: 25 fixed-t ribbons, or one ribbon per live τ, sorted far to near", () => {
    const x = S(P1), h = S(EXP);
    const a = sceneItems(x, h, SLICES[0], -50, 30, 1);
    expect(a.filter((i) => i.kind === "ribbon").length).toBe(25);
    for (let i = 1; i < a.length; i++) if (a[i].depth < a[i - 1].depth) throw new Error("not sorted");
    const b = sceneItems(x, h, SLICES[1], -50, 30, 1);
    expect(b.filter((i) => i.kind === "ribbon").length).toBe(8); // τ = 0, 0.125, …, 0.875
    const e = sceneItems(S("echo δ(t) + 0.5·δ(t − 1.5)"), h, SLICES[1], -50, 30, 1);
    expect(e.filter((i) => i.kind === "ribbon" && i.impulse).length).toBe(2);
    expect(walkSteps(x, h, 1).length).toBe(8);
    expect(walkSteps(x, h, 1)[7].text.includes("1 × 1 = 1")).toBe(true);
    close(outputCurve(x, h).top, 1 - Math.exp(-1), 0.01); // sampled every 0.03 s
  });

  it("convolution-3d paints, walks, switches slices on step 7, and reads y(t)", async () => {
    await import(`../../../src/widgets/types/convolution-3d.js?fresh=${Math.random()}`);
    await withRealDocument(async () => {
      const container = dom.document.createElement("div");
      const inst = mountWidget({ type: "convolution-3d", title: "t", params: C_PARAMS }, container);
      expect(container.querySelectorAll(".fx-ribbon").length).toBe(25);
      expect(container.querySelector(".widget__readout").textContent.includes("y(t) = 0.632")).toBe(true);
      const next = [...container.querySelectorAll("button")].find((b) => b.textContent.includes("Next"));
      for (let i = 0; i < 7; i++) next.click();
      expect(container.querySelector(".zs-walk").textContent.startsWith("Step 7 of 8")).toBe(true);
      expect(container.querySelector("select:nth-of-type(1)") !== null).toBe(true);
      expect(container.querySelectorAll(".fx-ribbon").length).toBe(8);
      inst.update({ x: "unit impulse δ(t)", t: 2 });
      expect(container.querySelector(".widget__readout").textContent.includes(`y(t) = ${Math.exp(-2).toFixed(3)}`)).toBe(true);
      inst.destroy();
    });
  });

  it("conv-sequence shows the sum for n and the polynomial product", async () => {
    await import(`../../../src/widgets/types/conv-sequence.js?fresh=${Math.random()}`);
    await withRealDocument(async () => {
      const container = dom.document.createElement("div");
      const inst = mountWidget({ type: "conv-sequence", title: "t", params: Q_PARAMS }, container);
      const r = () => container.querySelector(".widget__readout").textContent;
      expect(r().startsWith("y[2] = x[0]·h[2] + x[1]·h[1] + x[2]·h[0]")).toBe(true);
      expect(container.querySelectorAll(".cv-cell--on").length).toBe(3);
      const next = [...container.querySelectorAll("button")].find((b) => b.textContent === "n ▶");
      next.click();
      expect(r().includes("= 6")).toBe(true);
      expect(r().includes("1 + 3z⁻¹ + 6z⁻² + 6z⁻³ + 5z⁻⁴ + 3z⁻⁵")).toBe(true);
      inst.update({ x: "a die: 1/6 at n = 1 … 6", h: "a die: 1/6 at n = 1 … 6", n: 7 });
      expect(r().includes("= 1/6")).toBe(true);
      inst.destroy();
    });
  });
});
