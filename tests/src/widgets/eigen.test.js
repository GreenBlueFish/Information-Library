// Math › Eigenvalues: the maths in src/widgets/sims/eigen.js and the
// eigen-plane and eigen-3d widget types. Every eigenpair is checked against
// Av = λv, and the presets against values worked by hand.
import { describe, it, expect } from "../../harness.js";
import { ensureDom } from "../../dom.js";
import { mountWidget } from "../../../src/widgets/registry.js";
import * as E from "../../../src/widgets/sims/eigen.js";
import { walkSteps as walk2, viewRadius, eigenAngles, DEFAULT_PARAMS as P2 } from "../../../src/widgets/types/eigen-plane.js";
import { walkSteps as walk3, DEFAULT_PARAMS as P3 } from "../../../src/widgets/types/eigen-3d.js";

const close = (a, b, tol = 1e-9) => { if (!(Math.abs(a - b) <= tol)) throw new Error(`${a} is not within ${tol} of ${b}`); };
const dom = await ensureDom();

async function withRealDocument(fn) {
  const prev = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { value: dom.document, configurable: true, writable: true });
  try { return await fn(); } finally {
    if (prev) Object.defineProperty(globalThis, "document", prev); else delete globalThis.document;
  }
}
const residual = (m, l, v) => E.norm(E.apply(m, v).map((x, i) => x - l * v[i]));

describe("eigen sims — 2×2", () => {
  it("every real eigenpair satisfies Av = λv with a unit vector", () => {
    for (const p of E.MATRICES2) {
      const e = E.eig2(p.m);
      e.vectors.forEach((v, i) => {
        close(E.norm(v), 1, 1e-12);
        close(residual(p.m, e.values[i], v), 0, 1e-9);
      });
    }
  });
  it("gives the hand-worked eigenvalues of the presets", () => {
    const want = {
      "symmetric [[2, 1], [1, 2]]": [3, 1], "not symmetric [[4, 1], [2, 3]]": [5, 2],
      "a negative eigenvalue [[1, 2], [2, −2]]": [-3, 2], "Fibonacci [[1, 1], [1, 0]]": [(1 + Math.sqrt(5)) / 2, (1 - Math.sqrt(5)) / 2],
      "Markov chain [[0.9, 0.2], [0.1, 0.8]]": [1, 0.7], "reflection across y = x [[0, 1], [1, 0]]": [1, -1],
      "projection onto the x-axis [[1, 0], [0, 0]]": [1, 0], "stretch: diag(2, 0.5)": [2, 0.5],
    };
    for (const [name, vals] of Object.entries(want)) {
      const e = E.eig2(E.preset2(name));
      expect(e.kind).toBe("real");
      close(e.values[0], vals[0], 1e-12);
      close(e.values[1], vals[1], 1e-12);
    }
  });
  it("tells repeated, scalar and complex cases apart", () => {
    const sh = E.eig2(E.preset2("shear [[1, 1], [0, 1]]"));
    expect(sh.kind).toBe("repeated");
    expect(sh.vectors).toEqual([[1, 0]]);
    expect(E.eig2(E.preset2("scaling 1.5I [[1.5, 0], [0, 1.5]]")).kind).toBe("scalar");
    const r = E.eig2(E.preset2("rotation by 30°"));
    expect(r.kind).toBe("complex");
    close(r.modulus, 1, 1e-12);
    close(r.angleDeg, 30, 1e-9);
    const g = E.eig2(E.preset2("rotate and grow [[1, −1], [1, 1]]"));
    close(g.re, 1); close(g.im, 1); close(g.modulus, Math.SQRT2);
  });
  it("the sideways part v × Av is zero exactly at an eigen-direction, where v·Av = λ", () => {
    const m = E.preset2("not symmetric [[4, 1], [2, 3]]");
    const e = E.eig2(m);
    eigenAngles(e).forEach((a, i) => {
      const p = E.probe2(m, a);
      close(p.side, 0, 1e-9);
      close(p.along, e.values[i], 1e-9);
    });
    close(E.probe2(m, 20).side, E.probe2(m, 200).side, 1e-12); // v and −v give the same parts
  });
  it("trace and determinant are the sum and product of the eigenvalues", () => {
    for (const p of E.MATRICES2) {
      const e = E.eig2(p.m);
      const sum = e.kind === "complex" ? 2 * e.re : e.values[0] + e.values[1];
      const prod = e.kind === "complex" ? e.modulus ** 2 : e.values[0] * e.values[1];
      close(sum, e.tr, 1e-9);
      close(prod, e.det, 1e-9);
    }
  });
  it("powers of the Fibonacci matrix give Fibonacci numbers", () => {
    const pw = E.powers(E.preset2("Fibonacci [[1, 1], [1, 0]]"), [1, 0], 10);
    expect(pw[10]).toEqual([89, 55]);
  });
  it("the plane view fits the image of the circle", () => {
    expect(viewRadius([[1, 0], [0, 1]])).toBe(1.6);
    close(viewRadius(E.preset2("not symmetric [[4, 1], [2, 3]]")), 1.15 * 5.116, 0.02);
  });
});

describe("eigen sims — 3×3", () => {
  it("every eigenpair of every preset satisfies Av = λv", () => {
    for (const p of E.MATRICES3) {
      const e = E.eig3(p.m);
      for (const d of e.distinct) for (const v of d.vectors) close(residual(p.m, d.value, v), 0, 1e-8);
      // A complex pair's plane is invariant: A u and A w stay in span(u, w).
      for (const c of e.complex) {
        const n = E.cross(c.u, c.w);
        close(E.dot(E.apply(p.m, c.u), n) / E.norm(n), 0, 1e-8);
        close(E.dot(E.apply(p.m, c.w), n) / E.norm(n), 0, 1e-8);
      }
    }
  });
  it("gives the hand-worked eigenvalues", () => {
    const s2 = Math.SQRT2;
    const v = (name) => E.eig3(E.preset3(name)).values;
    const sorted = (xs) => xs.slice().sort((a, b) => b - a);
    for (const [got, want] of [
      [v("symmetric [[2, 1, 0], [1, 2, 1], [0, 1, 2]]"), [2 + s2, 2, 2 - s2]],
      [v("masses on springs [[2, −1, 0], [−1, 2, −1], [0, −1, 2]]"), [2 + s2, 2, 2 - s2]],
      [v("upper triangular [[2, 1, 0], [0, 3, 1], [0, 0, 1]]"), [3, 2, 1]],
      [v("three-state Markov chain"), [1, 0.7, 0.4]],
      [v("diagonal diag(2, 1, 0.5)"), [2, 1, 0.5]],
    ]) sorted(got).forEach((x, i) => close(x, want[i], 1e-9));
  });
  it("finds a plane of eigenvectors, a defective triple root, and complex pairs", () => {
    const pr = E.eig3(E.preset3("projection onto the plane x + y + z = 0"));
    expect(pr.distinct.map((d) => [d.value, d.alg, d.vectors.length])).toEqual([[1, 2, 2], [0, 1, 1]]);
    const sh = E.eig3(E.preset3("shear chain [[1, 1, 0], [0, 1, 1], [0, 0, 1]]"));
    expect(sh.distinct.length).toBe(1);
    expect(sh.distinct[0].alg).toBe(3);
    expect(sh.distinct[0].vectors.length).toBe(1);
    expect(sh.defective).toBe(true);
    const rot = E.eig3(E.preset3("rotation by 60° about the z-axis"));
    expect(rot.values).toEqual([1]);
    close(rot.complex[0].angleDeg, 60, 1e-9);
    const cyc = E.eig3(E.preset3("cyclic shift (x, y, z) → (z, x, y)"));
    close(cyc.complex[0].angleDeg, 120, 1e-9);
    close(cyc.complex[0].modulus, 1, 1e-9);
  });
  it("the characteristic polynomial vanishes at each eigenvalue", () => {
    for (const p of E.MATRICES3) for (const l of E.eig3(p.m).values) close(E.charPoly3(p.m, l), 0, 1e-8);
  });
  it("symmetric presets have perpendicular eigenvectors", () => {
    for (const p of E.MATRICES3) {
      const e = E.eig3(p.m);
      if (!e.symmetric || e.distinct.length < 3) continue;
      const vs = e.distinct.map((d) => d.vectors[0]);
      close(E.dot(vs[0], vs[1]), 0, 1e-9); close(E.dot(vs[0], vs[2]), 0, 1e-9); close(E.dot(vs[1], vs[2]), 0, 1e-9);
    }
  });
  it("formats very large numbers with a power of ten", () => {
    expect(E.fmt(5e9)).toBe("5.00×10⁹");
    expect(E.sfmt(-123456)).toBe("−1.23×10⁵");
    expect(E.fmt(-0.0001)).toBe("0.00");
  });
});

describe("eigen widgets", () => {
  it("walk-throughs have eight steps for every preset", () => {
    for (const p of E.MATRICES2) expect(walk2(p.m, 20, 8).length).toBe(8);
    for (const p of E.MATRICES3) expect(walk3(p.m, 30, 25, 8).length).toBe(8);
    expect(walk2(E.preset2("symmetric [[2, 1], [1, 2]]"), 20, 0)[5].text.includes("product 3 × 1 = 3 = det")).toBe(true);
  });

  it("eigen-plane paints, syncs sliders with the preset, and switches to custom on a slider", async () => {
    await import(`../../../src/widgets/types/eigen-plane.js?fresh=${Math.random()}`);
    await withRealDocument(async () => {
      const container = dom.document.createElement("div");
      const inst = mountWidget({ type: "eigen-plane", title: "t", params: P2 }, container);
      const r = () => container.querySelector(".widget__readout").textContent;
      expect(r().includes("λ₁ = 3 along (0.71, 0.71)")).toBe(true);
      expect(container.querySelectorAll(".eg-eigline").length).toBe(4); // two in the plane, two in the sweep
      inst.update({ matrix: "not symmetric [[4, 1], [2, 3]]" });
      expect(r().startsWith("A = [[4, 1], [2, 3]]")).toBe(true);
      const sliders = [...container.querySelectorAll("input[type=range]")];
      expect(sliders[0].value).toBe("4");
      sliders[1].value = "0";
      sliders[1].dispatchEvent(new dom.window.Event("input"));
      expect(container.querySelector("select").value).toBe(E.CUSTOM2);
      expect(r().startsWith("A = [[4, 0], [2, 3]]")).toBe(true);
      const next = [...container.querySelectorAll("button")].find((b) => b.textContent.includes("Next"));
      for (let i = 0; i < 8; i++) next.click();
      expect(container.querySelector(".zs-walk").textContent.startsWith("Step 8 of 8")).toBe(true);
      inst.update({ matrix: "rotation by 30°" });
      expect(r().includes("0.866 ± 0.5j")).toBe(true);
      inst.destroy();
    });
  });

  it("eigen-3d paints the sphere, its image and the eigen-directions", async () => {
    await import(`../../../src/widgets/types/eigen-3d.js?fresh=${Math.random()}`);
    await withRealDocument(async () => {
      const container = dom.document.createElement("div");
      const inst = mountWidget({ type: "eigen-3d", title: "t", params: P3 }, container);
      const r = () => container.querySelector(".widget__readout").textContent;
      expect(r().startsWith("λ = 3.414, along (0.50, 0.71, 0.50)")).toBe(true);
      expect(container.querySelectorAll(".eg-eigline").length).toBe(3);
      expect(container.querySelectorAll(".eg-plane").length).toBe(0);
      inst.update({ matrix: "rotation by 60° about the z-axis" });
      expect(container.querySelectorAll(".eg-eigline").length).toBe(1);
      expect(container.querySelectorAll(".eg-plane").length).toBe(1);
      inst.update({ matrix: "projection onto the plane x + y + z = 0" });
      expect(container.querySelectorAll(".eg-plane--eigen").length).toBe(1);
      const next = [...container.querySelectorAll("button")].find((b) => b.textContent.includes("Next"));
      for (let i = 0; i < 7; i++) next.click();
      expect(container.querySelectorAll(".eg-pow").length).toBe(9);
      inst.destroy();
    });
  });
});
