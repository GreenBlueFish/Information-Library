// Quantum Mechanics shelf: the maths in src/widgets/sims/quantum.js and the
// bloch-sphere and qubit-circuit widget types. The reference numbers are the
// numpy runs quoted on the shelf's pages.
import { describe, it, expect } from "../../harness.js";
import { ensureDom } from "../../dom.js";
import { mountWidget } from "../../../src/widgets/registry.js";
import * as q from "../../../src/widgets/sims/quantum.js";
import { rotateState } from "../../../src/widgets/types/bloch-sphere.js";
import { columnsFrom, GATE_OPTIONS } from "../../../src/widgets/types/qubit-circuit.js";

const close = (a, b, tol) => { if (Math.abs(a - b) > tol) throw new Error(`${a} is not within ${tol} of ${b}`); };
const dom = await ensureDom();

async function withRealDocument(fn) {
  const prev = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { value: dom.document, configurable: true, writable: true });
  try { return await fn(); } finally {
    if (prev) Object.defineProperty(globalThis, "document", prev); else delete globalThis.document;
  }
}

describe("quantum sims — single qubits", () => {
  it("the Bloch vector of a state on the sphere has length 1 and the right coordinates", () => {
    const r = q.blochVector(q.blochState(Math.PI / 3, Math.PI / 4));
    close(r[0], 0.612, 5e-4); close(r[1], 0.612, 5e-4); close(r[2], 0.5, 1e-12);
    close(Math.hypot(...r), 1, 1e-12);
  });

  it("R_Y(2 arcsin √s)|0> is the QRC input state √(1−s)|0> + √s|1>", () => {
    for (const s of [0.1, 0.25, 0.7]) {
      const v = q.apply1(q.rotation("Y", 2 * Math.asin(Math.sqrt(s))), [1, 0, 0, 0]);
      close(v[0], Math.sqrt(1 - s), 1e-12); close(v[2], Math.sqrt(s), 1e-12);
      close(v[1], 0, 1e-12); close(v[3], 0, 1e-12);
    }
  });

  it("rotations preserve the norm, and a 2π turn is −I", () => {
    const v = q.apply1(q.rotation("X", 1.234), q.blochState(0.7, 2.1));
    close(v.reduce((s, x) => s + x * x, 0), 1, 1e-12);
    const g = q.rotation("Z", 2 * Math.PI);
    close(g[0], -1, 1e-12); close(g[6], -1, 1e-12);
  });

  it("the bloch-sphere widget's arc ends at the rotated state", () => {
    const { v1, arc } = rotateState(0, 0, "Y", 180);
    close(v1[2] ** 2 + v1[3] ** 2, 1, 1e-12); // |0> rotated by π about Y is |1>
    const end = arc[arc.length - 1];
    close(end[2], -1, 1e-12);
    expect(rotateState(30, 40, "none", 90).arc.length).toBe(0);
  });
});

describe("quantum sims — two qubits", () => {
  it("H then CNOT makes a Bell state with one bit of entanglement", () => {
    const { psi, invalid } = q.runCircuit([["H", "—"], ["●", "⊕"]]);
    expect(invalid.length).toBe(0);
    close(psi[0], Math.SQRT1_2, 1e-12); close(psi[6], Math.SQRT1_2, 1e-12);
    close(q.entanglementEntropy(psi).entropy, 1, 1e-12);
  });

  it("product states have zero entanglement, and a second CNOT undoes the first", () => {
    close(q.entanglementEntropy(q.runCircuit([["H", "H"]]).psi).entropy, 0, 1e-12);
    close(q.entanglementEntropy(q.runCircuit([["H", "—"], ["●", "⊕"], ["●", "⊕"]]).psi).entropy, 0, 1e-12);
  });

  it("a lone control or target is flagged and skipped", () => {
    const { psi, invalid } = q.runCircuit([["●", "—"], ["X", "⊕"], ["⊕", "●"]]);
    expect(invalid).toEqual([0, 1]);
    // only the third column (control on qubit 2) acts... on |00>: nothing flips
    close(psi[0], 1, 1e-12);
  });

  it("columnsFrom reads the q1sK / q2sK controls in order", () => {
    expect(columnsFrom({ q1s1: "H", q2s2: "⊕", q1s2: "●" }).slice(0, 2)).toEqual([["H", "—"], ["●", "⊕"]]);
    expect(GATE_OPTIONS.includes("⊕")).toBe(true);
  });
});

describe("quantum sims — plots", () => {
  it("Trotter fidelities match the numpy run (J = 0.5, h = 1, t = 2)", () => {
    const exact = q.expmiRealSym(q.twoQubitXXZ(0.5, 1), 4, 2);
    close(q.gateFidelity(exact, q.trotterCircuit(0.5, 1, 2, 1, 1), 4), 0.6699, 1e-4);
    close(q.gateFidelity(exact, q.trotterCircuit(0.5, 1, 2, 4, 1), 4), 0.9767, 1e-4);
    expect(q.gateFidelity(exact, q.trotterCircuit(0.5, 1, 2, 4, 2), 4) > 0.9767).toBe(true);
  });

  it("the transverse-field Ising chain is ordered at small h and gapped at large h (n = 6)", () => {
    const p = q.tfimPoint(6, 1, 0.5);
    expect(p.corr > 0.7 && p.gap < 0.05).toBe(true);
    const far = q.tfimPoint(6, 1, 5);
    expect(Math.abs(far.corr) < 0.01 && far.gap > 5).toBe(true);
  });

  it("Rabi's formula and the coherent-state distribution are normalised and right", () => {
    const at2 = q.rabi({}, { Omega: 1, delta: 0.5, tmax: 20 })[0].points.find((pt) => Math.abs(pt.x - 2) < 1e-9);
    close(at2.y, 0.6469, 1e-4);
    const coh = q.coherentPhotons({}, { alpha: 1.5, nmax: 40 })[0].points.filter((pt) => !pt.move);
    close(coh.reduce((s, pt) => s + pt.y, 0), 1, 1e-9);
  });

  it("the running shot estimate converges on the exact expectation", () => {
    const [run, exact] = q.shotEstimate({}, { theta: 60, basis: "Z", shots: 5000, seed: 3 });
    close(run.points[run.points.length - 1].y, exact.points[0].y, 0.05);
    close(exact.points[0].y, 0.5, 1e-12);
  });
});

describe("quantum widgets — mounting", () => {
  it("bloch-sphere paints the sphere, a vector and the readout", async () => {
    await import(`../../../src/widgets/types/bloch-sphere.js?fresh=${Math.random()}`);
    await withRealDocument(() => {
      const container = dom.freshMount();
      const inst = mountWidget({ type: "bloch-sphere", title: "t", params: [] }, container);
      expect(inst === null).toBe(false);
      expect(container.querySelector(".qm-sphere") === null).toBe(false);
      expect(container.querySelectorAll(".qm-vector").length > 0).toBe(true);
      expect(container.querySelector(".widget__readout").textContent.includes("P(0) = 0.750")).toBe(true);
      inst.update({ axis: "Y", angle: 180 });
      expect(container.querySelector(".widget__readout").textContent.includes("After RY(180°)")).toBe(true);
      inst.destroy();
    });
  });

  it("qubit-circuit draws the default Bell circuit and reports entanglement", async () => {
    await import(`../../../src/widgets/types/qubit-circuit.js?fresh=${Math.random()}`);
    await withRealDocument(() => {
      const container = dom.freshMount();
      const inst = mountWidget({ type: "qubit-circuit", title: "t", params: [] }, container);
      expect(container.querySelectorAll(".qm-gate").length).toBe(1);
      expect(container.querySelector(".qm-target") === null).toBe(false);
      expect(container.querySelector(".widget__readout").textContent.includes("maximally entangled")).toBe(true);
      inst.update({ q2s2: "—" });
      expect(container.querySelector(".widget__readout").textContent.includes("skipped")).toBe(true);
      inst.destroy();
    });
  });
});
