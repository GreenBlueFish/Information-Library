// Math › The Laplace Transform and The Fourier Transform: the maths in
// src/widgets/sims/laplace.js and src/widgets/sims/fourier.js, and the
// s-surface, fourier-3d and fft-butterfly widget types. Every closed form is
// checked against its defining integral or sum computed directly.
import { describe, it, expect } from "../../harness.js";
import { ensureDom } from "../../dom.js";
import { mountWidget } from "../../../src/widgets/registry.js";
import * as lt from "../../../src/widgets/sims/laplace.js";
import * as ft from "../../../src/widgets/sims/fourier.js";
import { surfaceQuads, walkSteps, DEFAULT_PARAMS as S_PARAMS } from "../../../src/widgets/types/s-surface.js";
import { sceneItems, walkSteps as fWalk, DEFAULT_PARAMS as F_PARAMS } from "../../../src/widgets/types/fourier-3d.js";
import { cshort, stageTexts, DEFAULT_PARAMS as B_PARAMS } from "../../../src/widgets/types/fft-butterfly.js";

const close = (a, b, tol) => { if (!(Math.abs(a - b) <= tol)) throw new Error(`${a} is not within ${tol} of ${b}`); };
const dom = await ensureDom();

async function withRealDocument(fn) {
  const prev = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { value: dom.document, configurable: true, writable: true });
  try { return await fn(); } finally {
    if (prev) Object.defineProperty(globalThis, "document", prev); else delete globalThis.document;
  }
}

/** A point inside a strip ROC, off the real axis. */
function insideRoc(sig) {
  const { lo, hi } = sig.roc;
  const sg = Number.isFinite(lo) && Number.isFinite(hi) ? (lo + hi) / 2 : Number.isFinite(lo) ? lo + 0.6 : Number.isFinite(hi) ? hi - 0.6 : 0.3;
  return [sg, 0.8];
}

describe("laplace sims — closed forms against the defining integral", () => {
  for (const name of lt.SIGNALS) {
    it(`${name}: X(s) equals ∫ x(t) e^(−st) dt inside the ROC`, () => {
      for (const [a, w0] of [[0.5, 1.5], [1.2, 0.7], [-0.5, 2]]) {
        const sig = lt.sSignal(name, a, w0);
        if (sig.roc.empty) continue;
        const s = insideRoc(sig);
        const A = lt.evalX(sig, s), B = lt.directIntegral(sig, s, -80, 80, 4e-3);
        close(lt.C.abs(lt.C.sub(A, B)) / Math.max(1, lt.C.abs(A)), 0, 1e-5);
        expect(lt.inRoc(sig, s)).toBe(true);
      }
    });
  }

  it("the rational signals' factored form matches X(s), and the ruler reading matches |X|", () => {
    for (const name of lt.SIGNALS) {
      const sig = lt.sSignal(name, 0.5, 1.5);
      const g = lt.geometric(sig, [0, 1.1]);
      if (!sig.rational) { expect(g).toBe(null); continue; }
      close(g.value, lt.magX(sig, [0, 1.1]), 1e-12);
    }
  });

  it("right- and left-sided exponentials share a formula and differ only in the ROC", () => {
    const r = lt.sSignal("decaying exponential e^(−at)u(t)", 0.5);
    const l = lt.sSignal("left-sided exponential −e^(−at)u(−t)", 0.5);
    expect(r.formula).toBe(l.formula);
    expect(lt.inRoc(r, [0, 0])).toBe(true);
    expect(lt.inRoc(l, [0, 0])).toBe(false);
    expect(lt.inRoc(l, [-1, 0])).toBe(true);
  });

  it("stability and causality follow the ROC", () => {
    const v = (n, a = 0.5, w = 1.5) => lt.verdict(lt.sSignal(n, a, w));
    expect(v("damped sine e^(−at)sin(ω₀t)u(t)").stable).toBe(true);
    expect(v("damped sine e^(−at)sin(ω₀t)u(t)", -0.5).stable).toBe(false);
    expect(v("unit step u(t)").stable).toBe(false);
    expect(v("unit step u(t)").fourier.startsWith("exists only")).toBe(true);
    expect(v("left-sided exponential −e^(−at)u(−t)", -0.5).stable).toBe(true);
    expect(v("left-sided exponential −e^(−at)u(−t)", -0.5).causal).toBe(false);
    expect(v("two-sided exponential e^(−a|t|)").stable).toBe(true);
    expect(v("two-sided exponential e^(−a|t|)").causal).toBe(false);
    expect(v("delayed impulse δ(t−1)").causal).toBe(true);
    expect(lt.sSignal("two-sided exponential e^(−a|t|)", -0.5).roc.empty).toBe(true);
  });

  it("the notch blocks ω₀, the pulse has area 3, the delay has |X| = e^(−σ)", () => {
    close(lt.magX(lt.sSignal("notch filter (s²+ω₀²)/(s²+(ω₀/2)s+ω₀²)", 0, 1.5), [0, 1.5]), 0, 1e-12);
    close(lt.magX(lt.sSignal("notch filter (s²+ω₀²)/(s²+(ω₀/2)s+ω₀²)", 0, 1.5), [0, 0]), 1, 1e-12);
    close(lt.magX(lt.sSignal("3-second pulse u(t)−u(t−3)"), [0, 0]), 3, 1e-12);
    close(lt.magX(lt.sSignal("3-second pulse u(t)−u(t−3)"), [0, (2 * Math.PI) / 3]), 0, 1e-12);
    close(lt.magX(lt.sSignal("delayed impulse δ(t−1)"), [-1, 2]), Math.E, 1e-12);
  });

  it("formulas never show a doubled sign or a coefficient of 1", () => {
    for (const name of lt.SIGNALS) for (const a of [-1, -0.5, 0, 0.5, 2]) for (const w of [0, 1, 2]) {
      const f = lt.sSignal(name, a, w).formula;
      if (/[−+-]\s*[−-]/.test(f) || /[ (]1s/.test(f)) throw new Error(`${name} a=${a} w0=${w}: ${f}`);
    }
  });
});

describe("s-surface widget", () => {
  it("builds a 40 × 40 surface sorted far to near, faded outside the ROC", () => {
    const q = surfaceQuads(lt.sSignal("decaying exponential e^(−at)u(t)", 0.5), "decibels", -35, 30);
    expect(q.length).toBe(1600);
    for (let i = 1; i < q.length; i++) if (q[i].depth < q[i - 1].depth) throw new Error("not sorted");
    expect(q.some((x) => !x.inside) && q.some((x) => x.inside)).toBe(true);
  });

  it("walks through eight steps, with the ruler reading at the probe", () => {
    const steps = walkSteps(lt.sSignal("damped sine e^(−at)sin(ω₀t)u(t)", 0.5, 1.5), 1);
    expect(steps.length).toBe(8);
    expect(steps[6].text.includes("0.83")).toBe(true);
    expect(walkSteps(lt.sSignal("delayed impulse δ(t−1)"), 1)[6].text.includes("not a ratio")).toBe(true);
  });

  it("paints the surface, panels and readout, and steps", async () => {
    await import(`../../../src/widgets/types/s-surface.js?fresh=${Math.random()}`);
    await withRealDocument(async () => {
      const container = dom.document.createElement("div");
      const inst = mountWidget({ type: "s-surface", title: "t", params: S_PARAMS }, container);
      expect(container.querySelectorAll(".zs-face").length).toBe(1600);
      expect(container.querySelectorAll(".zs-pole").length).toBe(4); // two poles, in 3D and in the plane panel
      expect(container.querySelector(".widget__readout").textContent.includes("ROC: Re s > −0.5")).toBe(true);
      const next = [...container.querySelectorAll("button")].find((b) => b.textContent.includes("Next"));
      next.click();
      expect(container.querySelector(".zs-walk").textContent.startsWith("Step 1 of 8")).toBe(true);
      inst.update({ signal: "notch filter (s²+ω₀²)/(s²+(ω₀/2)s+ω₀²)", w0: 1.5, omega: 1.5 });
      expect(container.querySelector(".widget__readout").textContent.includes("|X| = 0.000")).toBe(true);
      inst.destroy();
    });
  });
});

describe("fourier sims — series coefficients against the defining integral", () => {
  for (const name of ft.SIGNALS) {
    it(`${name}: closed-form A_k, φ_k match (1/T)∫ x e^(−j2πkt/T) dt`, () => {
      for (const [T, d] of [[1, 0], [2, 0.25], [4, 0.1]]) {
        const sig = ft.fSignal(name, T, d);
        for (let k = 0; k <= 12; k++) {
          const n = ft.numericCoeff(sig, k, 20000);
          const { A, phi } = sig.coeff(k);
          const want = k === 0 ? [A, 0] : [(A / 2) * Math.cos(phi), (A / 2) * Math.sin(phi)];
          close(Math.hypot(n[0] - want[0], n[1] - want[1]), 0, 1e-6);
          if (A < -1e-15) throw new Error("negative amplitude");
        }
      }
    });
  }

  it("Gibbs: the square wave's partial sums overshoot to about 1.18 and stay there", () => {
    const sq = ft.fSignal("square wave");
    close(ft.peak(sq, 41, 8000), 1.179, 0.003);
    close(ft.peak(sq, 81, 16000), 1.179, 0.002);
    expect(ft.rmsError(sq, 41) < ft.rmsError(sq, 7)).toBe(true);
  });

  it("Parseval: the power of the square wave is 1 = Σ A_k²/2", () => {
    const sq = ft.fSignal("square wave");
    let p = 0;
    for (let k = 1; k < 20001; k += 2) p += sq.coeff(k).A ** 2 / 2;
    close(p, 1, 1e-4);
  });
});

describe("fourier sims — DFT and FFT", () => {
  it("the FFT's last stage equals the DFT for every input", () => {
    for (const x of Object.values(ft.FFT_INPUTS)) {
      const a = ft.dft(x), b = ft.fftStages(x).stages.at(-1);
      for (let k = 0; k < 8; k++) close(Math.hypot(a[k][0] - b[k][0], a[k][1] - b[k][1]), 0, 1e-12);
    }
  });
  it("bit reversal, butterfly count and work counts", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((i) => ft.bitReverse(i, 3)).join(",")).toBe("0,4,2,6,1,5,3,7");
    const { butterflies } = ft.fftStages(ft.FFT_INPUTS["ramp 0 … 7"]);
    expect(butterflies.length).toBe(12);
    expect(butterflies.filter((b) => b.twiddle === 0).length).toBe(7);
    expect(ft.opCounts(1024).fft).toBe(5120);
    expect(cshort([1, -2.4142])).toBe("1 − 2.41j");
    expect(cshort([0, -1])).toBe("−j");
    expect(stageTexts("ramp 0 … 7").length).toBe(4);
  });
});

describe("fourier-3d and fft-butterfly widgets", () => {
  it("one ribbon and one bar per harmonic, plus the sum and the signal, sorted far to near", () => {
    const items = sceneItems(ft.fSignal("square wave"), 7, -50, 25);
    expect(items.filter((i) => i.kind === "ribbon").length).toBe(8);
    expect(items.filter((i) => i.kind === "bar").length).toBe(8);
    for (let i = 1; i < items.length; i++) if (items[i].depth < items[i - 1].depth) throw new Error("not sorted");
    expect(fWalk(ft.fSignal("square wave"), 7).length).toBe(8);
  });

  it("fourier-3d paints, walks and turns the view on steps 4 and 5", async () => {
    await import(`../../../src/widgets/types/fourier-3d.js?fresh=${Math.random()}`);
    await withRealDocument(async () => {
      const container = dom.document.createElement("div");
      const inst = mountWidget({ type: "fourier-3d", title: "t", params: F_PARAMS }, container);
      expect(container.querySelectorAll(".fx-ribbon").length).toBe(4); // k = 1, 3, 5, 7
      const next = [...container.querySelectorAll("button")].find((b) => b.textContent.includes("Next"));
      for (let i = 0; i < 4; i++) next.click();
      expect(container.querySelector(".zs-walk").textContent.startsWith("Step 4 of 8")).toBe(true);
      const az = [...container.querySelectorAll("input[type=range]")][3];
      expect(Number(az.value)).toBe(0);
      inst.update({ signal: "two tones" });
      expect(container.querySelector(".widget__readout").textContent.includes("φ = 60°")).toBe(true);
      inst.destroy();
    });
  });

  it("fft-butterfly fills in one stage at a time", async () => {
    await import(`../../../src/widgets/types/fft-butterfly.js?fresh=${Math.random()}`);
    await withRealDocument(async () => {
      const container = dom.document.createElement("div");
      const inst = mountWidget({ type: "fft-butterfly", title: "t", params: B_PARAMS }, container);
      expect(container.querySelectorAll(".fx-node--off").length).toBe(24);
      const next = [...container.querySelectorAll("button")].find((b) => b.textContent.includes("Next"));
      next.click(); next.click();
      expect(container.querySelectorAll(".fx-node--off").length).toBe(16);
      expect(container.querySelector(".zs-walk").textContent.startsWith("Step 2 of 4")).toBe(true);
      expect(container.querySelector(".widget__readout").textContent.includes("5,120")).toBe(true);
      inst.destroy();
    });
  });
});
