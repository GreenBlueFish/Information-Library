// Math › The Z-Transform: the maths in src/widgets/sims/ztransform.js and the
// z-surface widget type. Every closed form is checked against the defining sum
// Σ x[n] z^-n computed directly at a point inside its region of convergence.
import { describe, it, expect } from "../../harness.js";
import { ensureDom } from "../../dom.js";
import { mountWidget } from "../../../src/widgets/registry.js";
import * as zt from "../../../src/widgets/sims/ztransform.js";
import { surfaceQuads, walkSteps, project3, cfmt, DEFAULT_PARAMS } from "../../../src/widgets/types/z-surface.js";

const close = (a, b, tol) => { if (!(Math.abs(a - b) <= tol)) throw new Error(`${a} is not within ${tol} of ${b}`); };
const dom = await ensureDom();

async function withRealDocument(fn) {
  const prev = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { value: dom.document, configurable: true, writable: true });
  try { return await fn(); } finally {
    if (prev) Object.defineProperty(globalThis, "document", prev); else delete globalThis.document;
  }
}

/** A point inside the ROC, off the real axis. */
function insideRoc(sig) {
  const { inner, outer } = sig.roc;
  const rad = Number.isFinite(outer) ? (Math.max(inner, 0) + outer) / 2 : Math.max(inner * 1.4, inner + 0.3, 0.6);
  return zt.C.polar(rad, 0.7);
}

describe("z-transform sims — closed forms against the defining sum", () => {
  for (const name of zt.SIGNALS) {
    it(`${name}: factored X(z) equals Σ x[n] z^-n inside the ROC`, () => {
      for (const [r, th] of [[0.8, 45], [0.5, 120], [0.95, 10], [1.1, 75]]) {
        const sig = zt.zSignal(name, r, th);
        if (sig.roc.empty) continue;
        const z = insideRoc(sig);
        const a = zt.evalX(sig, z), b = zt.directSum(sig, z, -600, 600);
        close(zt.C.abs(zt.C.sub(a, b)) / Math.max(1, zt.C.abs(a)), 0, 1e-9);
        expect(zt.inRoc(sig, z)).toBe(true);
      }
    });
  }

  it("the right- and left-sided exponentials share a formula and differ only in the ROC", () => {
    const right = zt.zSignal("decaying exponential rⁿu[n]", 0.8);
    const left = zt.zSignal("left-sided exponential −rⁿu[−n−1]", 0.8);
    expect(right.formula).toBe(left.formula);
    expect(zt.inRoc(right, [1, 0])).toBe(true);
    expect(zt.inRoc(left, [1, 0])).toBe(false);
    expect(zt.inRoc(left, [0.5, 0])).toBe(true);
  });

  it("the two-sided exponential has no ROC once r ≥ 1", () => {
    expect(zt.zSignal("two-sided exponential r^|n|", 1).roc.empty).toBe(true);
    expect(zt.zSignal("two-sided exponential r^|n|", 0.5).roc.empty).toBe(false);
  });

  it("formulas never show a doubled sign", () => {
    for (const name of zt.SIGNALS) {
      for (const th of [0, 45, 90, 120, 180]) {
        const f = zt.zSignal(name, 0.3, th).formula;
        if (/[−+-]\s*[−-]/.test(f)) throw new Error(`${name} at θ=${th}: ${f}`);
      }
    }
  });
});

describe("z-transform sims — geometry and verdicts", () => {
  it("the geometric reading equals |X| (numbers quoted on the Unit Circle page)", () => {
    const res = zt.zSignal("damped sine rⁿsin(θn)u[n]", 0.95, 45);
    for (const [deg, want] of [[0, 1.2017], [45, 9.7404], [90, 0.4987], [180, 0.2069]]) {
      const z = zt.C.polar(1, (deg * Math.PI) / 180);
      close(zt.geometric(res, z).value, want, 5e-4);
      close(zt.magX(res, z), want, 5e-4);
    }
    const notch = zt.zSignal("notch filter δ[n]−2cosθ·δ[n−1]+δ[n−2]", 0.8, 60);
    close(zt.magX(notch, [1, 0]), 1, 1e-12);
    close(zt.magX(notch, [-1, 0]), 3, 1e-12);
    close(zt.magX(notch, zt.C.polar(1, Math.PI / 3)), 0, 1e-12);
  });

  it("the 8-sample pulse is 8 at ω = 0 and 0 at multiples of 45°", () => {
    const p = zt.zSignal("8-sample pulse u[n]−u[n−8]");
    close(zt.magX(p, [1, 0]), 8, 1e-9);
    for (const k of [1, 2, 3, 4]) close(zt.magX(p, zt.C.polar(1, (k * Math.PI) / 4)), 0, 1e-9);
  });

  it("stability and causality follow the ROC", () => {
    const v = (n, r = 0.8, t = 45) => zt.verdict(zt.zSignal(n, r, t));
    expect(v("decaying exponential rⁿu[n]").stable).toBe(true);
    expect(v("decaying exponential rⁿu[n]", 1.1).stable).toBe(false);
    expect(v("unit step u[n]").stable).toBe(false);
    expect(v("left-sided exponential −rⁿu[−n−1]").stable).toBe(false);
    expect(v("left-sided exponential −rⁿu[−n−1]", 1.2).stable).toBe(true);
    expect(v("left-sided exponential −rⁿu[−n−1]", 1.2).causal).toBe(false);
    expect(v("two-sided exponential r^|n|", 0.5).stable).toBe(true);
    expect(v("8-sample pulse u[n]−u[n−8]").causal).toBe(true);
  });

  it("heights are clipped to the view in both modes", () => {
    const u = zt.zSignal("unit step u[n]");
    expect(zt.heightAt(u, [1, 0], "decibels")).toBe(30);
    expect(zt.heightAt(u, [0, 0], "decibels")).toBe(-30);
    expect(zt.heightAt(u, [1, 0], "magnitude")).toBe(10);
  });
});

describe("z-surface widget", () => {
  it("builds a 40 × 40 surface sorted far to near, with faded quads outside the ROC", () => {
    const sig = zt.zSignal("decaying exponential rⁿu[n]", 0.8);
    const q = surfaceQuads(sig, "decibels", -35, 30);
    expect(q.length).toBe(1600);
    for (let i = 1; i < q.length; i++) if (q[i].depth < q[i - 1].depth) throw new Error("not sorted");
    expect(q.some((x) => !x.inside)).toBe(true);
    expect(q.some((x) => x.inside)).toBe(true);
    for (const x of q) if (x.band < 0 || x.band > 9) throw new Error(`band ${x.band}`);
  });

  it("looking straight down maps the plane without distortion", () => {
    const p = project3(0.3, 0.4, 1, 0, Math.PI / 2);
    close(p.u, 0.3, 1e-12); close(p.v, 0.4, 1e-12);
  });

  it("walks through eight steps with the probe's geometric reading", () => {
    const steps = walkSteps(zt.zSignal("decaying exponential rⁿu[n]", 0.8), 45);
    expect(steps.length).toBe(8);
    expect(steps[6].text.includes("1.40")).toBe(true);
    expect(cfmt([0.5, -1.2071])).toBe("0.50 − 1.21j");
  });

  it("paints the surface, panels, walk line and readout, and steps through the walk", async () => {
    await import(`../../../src/widgets/types/z-surface.js?fresh=${Math.random()}`);
    await withRealDocument(async () => {
      const container = dom.document.createElement("div");
      const inst = mountWidget({ type: "z-surface", title: "t", params: DEFAULT_PARAMS }, container);
      expect(container.querySelectorAll(".zs-face").length).toBe(1600);
      expect(container.querySelectorAll(".zs-pole").length).toBe(2); // 3D floor + z-plane panel
      expect(container.querySelector(".widget__readout").textContent.includes("ROC: |z| > 0.8")).toBe(true);
      const next = [...container.querySelectorAll("button")].find((b) => b.textContent.includes("Next"));
      next.click();
      expect(container.querySelector(".zs-walk").textContent.startsWith("Step 1 of 8")).toBe(true);
      inst.update({ signal: "notch filter δ[n]−2cosθ·δ[n−1]+δ[n−2]", theta: 60, omega: 60 });
      expect(container.querySelector(".widget__readout").textContent.includes("|X| = 0.000")).toBe(true);
      inst.update({ signal: "not a signal" }); // rejected: keeps the notch
      expect(container.querySelector(".widget__readout").textContent.includes("z⁻²")).toBe(true);
      inst.destroy();
    });
  });
});
