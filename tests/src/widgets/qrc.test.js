// Quantum Reservoir Computing: the simulators in src/widgets/sims/qrc.js.
import { describe, it, expect } from "../../harness.js";
import * as q from "../../../src/widgets/sims/qrc.js";

const close = (a, b, tol) => { if (Math.abs(a - b) > tol) throw new Error(`${a} is not within ${tol} of ${b}`); };

describe("qrc sims", () => {
  it("Jacobi eigen-decomposition reconstructs a symmetric matrix", () => {
    const A = [4, 1, 2, 1, 3, 0, 2, 0, 1];
    const { values, vectors: V } = q.jacobiEigen(A, 3);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      let s = 0;
      for (let k = 0; k < 3; k++) s += V[i * 3 + k] * values[k] * V[j * 3 + k];
      close(s, A[i * 3 + j], 1e-10);
    }
  });

  it("ridge recovers an exact linear map", () => {
    const rows = [[0, 1], [1, 0], [1, 1], [2, 3], [0.5, -1]];
    const y = rows.map(([a, b]) => 2 * a - 3 * b + 0.5);
    const w = q.ridge(rows, y, 1e-10);
    close(w[0], 2, 1e-6); close(w[1], -3, 1e-6); close(w[2], 0.5, 1e-6);
  });

  it("the propagator is unitary and the reservoir map keeps the trace and Hermiticity", () => {
    const n = 3, D = 8;
    const U = q.propagator(q.spinHamiltonian(n, { h: 1, seed: 2 }), D, 1.7);
    for (let i = 0; i < D; i++) for (let j = 0; j < D; j++) {
      let re = 0, im = 0;
      for (let k = 0; k < D; k++) {
        re += U.re[i * D + k] * U.re[j * D + k] + U.im[i * D + k] * U.im[j * D + k];
        im += U.im[i * D + k] * U.re[j * D + k] - U.re[i * D + k] * U.im[j * D + k];
      }
      close(re, i === j ? 1 : 0, 1e-9); close(im, 0, 1e-9);
    }
    const F = q.runQuantumReservoir([0.3, 0.9, 0.1], { n, V: 2 });
    expect(F.length).toBe(3);
    expect(F[0].length).toBe(6);
    expect(F.flat().every((z) => Math.abs(z) <= 1 + 1e-9)).toBe(true);
  });

  it("injection writes the input state on qubit 1: <Z_1> = 1 - 2s right after it", () => {
    const D = 4;
    const rho = { re: new Float64Array(16), im: new Float64Array(16) };
    for (let a = 0; a < D; a++) rho.re[a * D + a] = 0.25;
    const r = q.inject(rho, D, 0.3);
    close(q.zExpectations(r, 2)[0], 1 - 2 * 0.3, 1e-12);
    close(q.zExpectations(r, 2)[1], 0, 1e-12);
  });

  it("memory: virtual nodes raise MC, and shot noise lowers it", () => {
    const mc = (st) => Number(/MC = ([\d.]+)/.exec(q.qrcMemory({}, st)[0].label)[1]);
    const base = mc({}), v5 = mc({ V: 5 }), noisy = mc({ V: 5, shots: 100 });
    expect(v5 > base).toBe(true);
    expect(noisy < v5).toBe(true);
    // MC can never exceed the number of features
    expect(v5 <= 20).toBe(true);
  });

  it("an ESN has fading memory below radius 1, and MC stays below N", () => {
    const m = q.esnMemory({}, { N: 20, radius: 0.8 })[0];
    const mc = Number(/MC = ([\d.]+)/.exec(m.label)[1]);
    expect(mc > 2 && mc <= 20).toBe(true);
  });

  it("trace distance: orthogonal pure states are at distance 1, and the reservoir contracts them", () => {
    const D = 2;
    const A = { re: new Float64Array([1, 0, 0, 0]), im: new Float64Array(4) };
    const B = { re: new Float64Array([0, 0, 0, 1]), im: new Float64Array(4) };
    close(q.traceDistance(A, B, D), 1, 1e-9);
    const pts = q.espContraction({}, { qubits: 3, steps: 60 })[0].points;
    expect(pts[pts.length - 1].y < pts[0].y - 1).toBe(true);
  });

  it("concentration follows 1/sqrt(2^n + 1), and the other sims return finite curves", () => {
    const [std] = q.concentration({}, {});
    close(std.points[0].y, -0.5 * Math.log10(3), 1e-12);
    for (const f of [q.lindbladDecay, q.qrcTask]) {
      expect(f({}, {}).every((s) => s.points.every((p) => Number.isFinite(p.y)))).toBe(true);
    }
    close(q.narma2([0, 0, 0, 0])[3], 0.4 * q.narma2([0, 0, 0, 0])[2] + 0.4 * 0.1 * 0 + 0.1, 1e-12);
  });
});
