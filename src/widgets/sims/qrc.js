// src/widgets/sims/qrc.js
//
// Simulators for the Quantum Reservoir Computing shelf. Each is a pure function
// (config, state) -> PlotSeries[]; each control's `key` is the parameter it
// drives. The quantum ones run an exact density-matrix simulation of a small
// spin reservoir (2 to 5 qubits), so what the reader sees is the real model.
//
//   esn-memory       a classical echo state network's memory function
//                    r^2(d) against delay d, for a given spectral radius,
//                    input scaling and leak rate; the label gives MC
//   qrc-memory       the same for a quantum spin reservoir (Fujii-Nakajima
//                    model: random XX couplings, a Z field, input written by
//                    resetting qubit 1, <Z_i> read after each of V virtual
//                    nodes), optionally with finite measurement shots
//   qrc-phase        memory capacity against the field h for a disordered
//                    reservoir: the ergodic middle beats both extremes
//   esp-contraction  the distance between two copies of a reservoir started in
//                    different states and fed the same input: it shrinks when
//                    the echo state property holds
//   lindblad-decay   one qubit under amplitude damping (T1) and dephasing (T2):
//                    the populations and the coherence against time
//   concentration    how the spread of a Pauli expectation over random states
//                    shrinks as 1/(2^n + 1), and the shots needed to resolve it
//   qrc-task         target and prediction on the test window for a chosen
//                    task (delay recall, a product, NARMA2) with exact or
//                    finite-shot features; the label gives the NMSE

import { num, str, rng, gauss, curve } from "./util.js";

// ---------- small linear algebra ----------

/** Eigen-decomposition of a real symmetric n x n matrix (row-major array) by cyclic Jacobi. */
export function jacobiEigen(Ain, n) {
  const A = Float64Array.from(Ain);
  const V = new Float64Array(n * n);
  for (let i = 0; i < n; i++) V[i * n + i] = 1;
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += A[p * n + q] ** 2;
    if (off < 1e-22) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = A[p * n + q];
        if (Math.abs(apq) < 1e-300) continue;
        const theta = (A[q * n + q] - A[p * n + p]) / (2 * apq);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = A[k * n + p], akq = A[k * n + q];
          A[k * n + p] = c * akp - s * akq;
          A[k * n + q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = A[p * n + k], aqk = A[q * n + k];
          A[p * n + k] = c * apk - s * aqk;
          A[q * n + k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = V[k * n + p], vkq = V[k * n + q];
          V[k * n + p] = c * vkp - s * vkq;
          V[k * n + q] = s * vkp + c * vkq;
        }
      }
    }
  }
  const values = [];
  for (let i = 0; i < n; i++) values.push(A[i * n + i]);
  return { values, vectors: V };
}

/** Solve (A^T A + lam I) w = A^T y for the rows of A (each an array). */
export function ridge(rows, y, lam = 1e-6) {
  const m = rows[0].length + 1;
  const G = new Float64Array(m * m), b = new Float64Array(m);
  rows.forEach((r, t) => {
    const a = [...r, 1];
    for (let i = 0; i < m; i++) {
      b[i] += a[i] * y[t];
      for (let j = 0; j < m; j++) G[i * m + j] += a[i] * a[j];
    }
  });
  for (let i = 0; i < m; i++) G[i * m + i] += lam;
  // Cholesky
  const L = new Float64Array(m * m);
  for (let i = 0; i < m; i++) {
    for (let j = 0; j <= i; j++) {
      let s = G[i * m + j];
      for (let k = 0; k < j; k++) s -= L[i * m + k] * L[j * m + k];
      L[i * m + j] = i === j ? Math.sqrt(Math.max(s, 1e-300)) : s / L[j * m + j];
    }
  }
  const z = new Float64Array(m), w = new Float64Array(m);
  for (let i = 0; i < m; i++) { let s = b[i]; for (let k = 0; k < i; k++) s -= L[i * m + k] * z[k]; z[i] = s / L[i * m + i]; }
  for (let i = m - 1; i >= 0; i--) { let s = z[i]; for (let k = i + 1; k < m; k++) s -= L[k * m + i] * w[k]; w[i] = s / L[i * m + i]; }
  return Array.from(w);
}

const predict = (w, r) => r.reduce((a, v, i) => a + w[i] * v, w[w.length - 1]);

export function r2(a, b) {
  const n = a.length;
  const ma = a.reduce((s, v) => s + v, 0) / n, mb = b.reduce((s, v) => s + v, 0) / n;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2; }
  return saa > 0 && sbb > 0 ? (sab * sab) / (saa * sbb) : 0;
}

/** Memory function r^2(d) for d = 0..dmax from features F[t] and inputs s[t]. */
export function memoryFunction(F, s, washout, train, dmax) {
  const out = [];
  const T = s.length;
  for (let d = 0; d <= dmax; d++) {
    const w = ridge(F.slice(washout, washout + train), s.slice(washout - d, washout + train - d));
    const pred = F.slice(washout + train).map((r) => predict(w, r));
    out.push(r2(pred, s.slice(washout + train - d, T - d)));
  }
  return out;
}

// ---------- the quantum spin reservoir ----------

/** H = sum_{i<j} J_ij X_i X_j + sum_i (h + W_i) Z_i, J_ij ~ U[-J/2, J/2], W_i ~ U[-W/2, W/2]. Qubit 0 is the most significant bit. */
export function spinHamiltonian(n, { J = 1, h = 1, W = 0, seed = 1 } = {}) {
  const D = 1 << n, H = new Float64Array(D * D), r = rng(seed);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const Jij = (r() - 0.5) * J;
      const mi = 1 << (n - 1 - i), mj = 1 << (n - 1 - j);
      for (let a = 0; a < D; a++) H[a * D + (a ^ mi ^ mj)] += Jij;
    }
  }
  for (let i = 0; i < n; i++) {
    const hi = h + (r() - 0.5) * W, mi = 1 << (n - 1 - i);
    for (let a = 0; a < D; a++) H[a * D + a] += (a & mi) ? -hi : hi;
  }
  return H;
}

/** U = exp(-i H t) as {re, im} from a real symmetric H. */
export function propagator(H, D, t) {
  const { values, vectors: V } = jacobiEigen(H, D);
  const re = new Float64Array(D * D), im = new Float64Array(D * D);
  for (let a = 0; a < D; a++) for (let b = 0; b < D; b++) {
    let sr = 0, si = 0;
    for (let k = 0; k < D; k++) {
      const v = V[a * D + k] * V[b * D + k];
      sr += v * Math.cos(values[k] * t); si -= v * Math.sin(values[k] * t);
    }
    re[a * D + b] = sr; im[a * D + b] = si;
  }
  return { re, im };
}

function mulC(A, B, D, conjB = false) {
  // C = A B (or A B^dagger when conjB)
  const re = new Float64Array(D * D), im = new Float64Array(D * D);
  for (let i = 0; i < D; i++) for (let k = 0; k < D; k++) {
    const ar = A.re[i * D + k], ai = A.im[i * D + k];
    if (ar === 0 && ai === 0) continue;
    for (let j = 0; j < D; j++) {
      let br, bi;
      if (conjB) { br = B.re[j * D + k]; bi = -B.im[j * D + k]; } else { br = B.re[k * D + j]; bi = B.im[k * D + j]; }
      re[i * D + j] += ar * br - ai * bi;
      im[i * D + j] += ar * bi + ai * br;
    }
  }
  return { re, im };
}

/** rho -> |psi(s)><psi(s)| (x) Tr_1 rho, with |psi(s)> = sqrt(1-s)|0> + sqrt(s)|1>. */
export function inject(rho, D, s) {
  const h = D / 2, re = new Float64Array(D * D), im = new Float64Array(D * D);
  const p = [Math.sqrt(1 - s), Math.sqrt(s)];
  for (let b = 0; b < h; b++) for (let c = 0; c < h; c++) {
    const rr = rho.re[b * D + c] + rho.re[(h + b) * D + h + c];
    const ri = rho.im[b * D + c] + rho.im[(h + b) * D + h + c];
    for (let x = 0; x < 2; x++) for (let y = 0; y < 2; y++) {
      re[(x * h + b) * D + y * h + c] = p[x] * p[y] * rr;
      im[(x * h + b) * D + y * h + c] = p[x] * p[y] * ri;
    }
  }
  return { re, im };
}

export function zExpectations(rho, n) {
  const D = 1 << n, out = [];
  for (let i = 0; i < n; i++) {
    const mi = 1 << (n - 1 - i);
    let z = 0;
    for (let a = 0; a < D; a++) z += ((a & mi) ? -1 : 1) * rho.re[a * D + a];
    out.push(z);
  }
  return out;
}

/** Run the reservoir on inputs s; returns features (n*V per step). Options: n, J, h, W, dt, V, seed. */
export function runQuantumReservoir(s, o = {}) {
  const n = o.n ?? 4, V = o.V ?? 1, D = 1 << n;
  const U = propagator(spinHamiltonian(n, o), D, (o.dt ?? 10) / V);
  let rho = { re: new Float64Array(D * D), im: new Float64Array(D * D) };
  for (let a = 0; a < D; a++) rho.re[a * D + a] = 1 / D;
  const F = [];
  for (const x of s) {
    rho = inject(rho, D, x);
    const f = [];
    for (let v = 0; v < V; v++) {
      rho = mulC(mulC(U, rho, D), U, D, true);
      f.push(...zExpectations(rho, n));
    }
    F.push(f);
  }
  return F;
}

/** Add the noise of estimating each <Z> from `shots` single-shot measurements. */
export function addShotNoise(F, shots, seed) {
  if (!shots) return F;
  const r = rng(seed);
  return F.map((row) => row.map((z) => {
    const p = (1 + z) / 2;
    return z + 2 * gauss(r) * Math.sqrt(Math.max(p * (1 - p), 0) / shots);
  }));
}

function inputs(seed, T) {
  const r = rng(seed + 100);
  return Array.from({ length: T }, () => r());
}

const stems = (label, xs, ys) => ({
  label,
  points: xs.flatMap((x, i) => [{ x, y: 0, move: true }, { x, y: ys[i] }]),
});

const WASH = 200, TRAIN = 800, TEST = 400;

// ---------- classical echo state network ----------

/** Run a leaky tanh ESN of N units on inputs s; returns states. */
export function runEsn(s, { N = 50, radius = 0.9, inScale = 0.5, leak = 1, seed = 1 } = {}) {
  const r = rng(seed);
  const W = new Float64Array(N * N);
  for (let i = 0; i < N * N; i++) W[i] = gauss(r);
  // spectral radius by Gelfand's formula: ||W^k||^(1/k) for growing k
  let v = Array.from({ length: N }, () => gauss(r));
  let logGrowth = 0;
  const K = 200;
  for (let k = 0; k < K; k++) {
    const u = new Array(N).fill(0);
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) u[i] += W[i * N + j] * v[j];
    const nrm = Math.hypot(...u);
    if (k >= K / 2) logGrowth += Math.log(nrm);
    v = u.map((x) => x / nrm);
  }
  const rho0 = Math.exp(logGrowth / (K / 2));
  for (let i = 0; i < N * N; i++) W[i] *= radius / rho0;
  const win = Array.from({ length: N }, () => (r() * 2 - 1) * inScale);
  let x = new Array(N).fill(0);
  const F = [];
  for (const u of s) {
    const nx = new Array(N);
    for (let i = 0; i < N; i++) {
      let a = win[i] * (2 * u - 1);
      for (let j = 0; j < N; j++) a += W[i * N + j] * x[j];
      nx[i] = (1 - leak) * x[i] + leak * Math.tanh(a);
    }
    x = nx;
    F.push(x.slice());
  }
  return F;
}

export function esnMemory(config, state) {
  const o = {
    N: Math.round(num(state, config, "N", 30)),
    radius: num(state, config, "radius", 0.9),
    inScale: num(state, config, "inScale", 0.5),
    leak: num(state, config, "leak", 1),
    seed: 3,
  };
  const dmax = Math.round(num(state, config, "dmax", 40));
  const s = inputs(7, WASH + TRAIN + TEST);
  const m = memoryFunction(runEsn(s, o), s, WASH, TRAIN, dmax);
  const mc = m.slice(1).reduce((a, b) => a + b, 0);
  const ds = m.map((_, d) => d);
  return [stems(`r² of recalling the input d steps back (MC = ${mc.toFixed(1)} of N = ${o.N})`, ds, m)];
}

function quantumOpts(config, state) {
  return {
    n: Math.max(2, Math.min(5, Math.round(num(state, config, "qubits", 4)))),
    h: num(state, config, "h", 1),
    W: num(state, config, "W", 0),
    dt: num(state, config, "dt", 10),
    V: Math.max(1, Math.min(10, Math.round(num(state, config, "V", 1)))),
    seed: Math.round(num(state, config, "seed", 1)),
  };
}

export function qrcMemory(config, state) {
  const o = quantumOpts(config, state);
  const shots = Math.round(num(state, config, "shots", 0));
  const dmax = Math.round(num(state, config, "dmax", 12));
  const s = inputs(o.seed, WASH + TRAIN + TEST);
  const F = addShotNoise(runQuantumReservoir(s, o), shots, o.seed + 7);
  const m = memoryFunction(F, s, WASH, TRAIN, dmax);
  const mc = m.slice(1).reduce((a, b) => a + b, 0);
  const lbl = `${o.n} qubits, ${o.n * o.V} features, ${shots ? shots + " shots" : "exact"}: MC = ${mc.toFixed(2)}`;
  return [stems(lbl, m.map((_, d) => d), m)];
}

export function qrcPhase(config, state) {
  const n = Math.max(2, Math.min(5, Math.round(num(state, config, "qubits", 4))));
  const W = num(state, config, "W", 1);
  const dt = num(state, config, "dt", 10);
  const V = Math.max(1, Math.min(5, Math.round(num(state, config, "V", 3))));
  const reals = Math.max(1, Math.min(4, Math.round(num(state, config, "realizations", 2))));
  const T = 100 + 400 + 200;
  const xs = [], ys = [];
  for (let e = -2; e <= 2.001; e += 0.25) {
    const h = 10 ** e;
    let tot = 0;
    for (let k = 0; k < reals; k++) {
      const s = inputs(k + 1, T);
      const F = runQuantumReservoir(s, { n, h, W, dt, V, seed: k + 1 });
      tot += memoryFunction(F, s, 100, 400, 8).slice(1).reduce((a, b) => a + b, 0);
    }
    xs.push(e); ys.push(tot / reals);
  }
  return [{ label: `memory capacity (delays 1 to 8), disorder W = ${W}`, points: xs.map((x, i) => ({ x, y: ys[i] })) }];
}

/** Trace distance between two Hermitian matrices given as {re, im}, via the real 2D x 2D embedding. */
export function traceDistance(A, B, D) {
  const M = new Float64Array(4 * D * D), m = 2 * D;
  for (let i = 0; i < D; i++) for (let j = 0; j < D; j++) {
    const re = A.re[i * D + j] - B.re[i * D + j], im = A.im[i * D + j] - B.im[i * D + j];
    M[i * m + j] = re; M[(i + D) * m + j + D] = re;
    M[i * m + j + D] = -im; M[(i + D) * m + j] = im;
  }
  // each eigenvalue appears twice in the embedding
  return jacobiEigen(M, m).values.reduce((a, v) => a + Math.abs(v), 0) / 4;
}

export function espContraction(config, state) {
  const model = str(state, config, "model", "quantum reservoir");
  const steps = Math.round(num(state, config, "steps", 40));
  const s = inputs(5, steps);
  if (model.startsWith("classical")) {
    const radius = num(state, config, "radius", 0.9);
    const out = [];
    for (const seedState of [11, 12]) {
      const r = rng(seedState);
      out.push(Array.from({ length: 30 }, () => gauss(r)));
    }
    // two copies of the same ESN from different states
    const N = 30, rr = rng(3), Wm = new Float64Array(N * N);
    for (let i = 0; i < N * N; i++) Wm[i] = gauss(rr) / Math.sqrt(N);
    // circular law: radius of a Gaussian matrix with variance 1/N is about 1
    for (let i = 0; i < N * N; i++) Wm[i] *= radius;
    const win = Array.from({ length: N }, () => rr() * 2 - 1);
    let [x, y] = out;
    const pts = [];
    for (let t = 0; t < steps; t++) {
      const step = (z) => z.map((_, i) => Math.tanh(win[i] * (2 * s[t] - 1) + z.reduce((a, zj, j) => a + Wm[i * N + j] * zj, 0)));
      x = step(x); y = step(y);
      pts.push({ x: t + 1, y: Math.log10(Math.max(Math.hypot(...x.map((v, i) => v - y[i])), 1e-16)) });
    }
    return [{ label: `classical ESN, weights scaled by ${radius}: log10 of the distance between the two states`, points: pts }];
  }
  const n = Math.max(2, Math.min(4, Math.round(num(state, config, "qubits", 3))));
  const h = num(state, config, "h", 1), dt = num(state, config, "dt", 10), D = 1 << n;
  const U = propagator(spinHamiltonian(n, { h, seed: 1 }), D, dt);
  // copy A starts in |0...0>, copy B in |1...1>
  let A = { re: new Float64Array(D * D), im: new Float64Array(D * D) };
  let B = { re: new Float64Array(D * D), im: new Float64Array(D * D) };
  A.re[0] = 1; B.re[D * D - 1] = 1;
  const pts = [];
  for (let t = 0; t < steps; t++) {
    A = mulC(mulC(U, inject(A, D, s[t]), D), U, D, true);
    B = mulC(mulC(U, inject(B, D, s[t]), D), U, D, true);
    pts.push({ x: t + 1, y: Math.log10(Math.max(traceDistance(A, B, D), 1e-16)) });
  }
  return [{ label: `${n}-qubit reservoir, h = ${h}: log10 of the trace distance between the two copies`, points: pts }];
}

export function lindbladDecay(config, state) {
  const T1 = num(state, config, "T1", 50), T2in = num(state, config, "T2", 40);
  const T2 = Math.min(T2in, 2 * T1);
  const theta = (num(state, config, "theta", 90) * Math.PI) / 180;
  const tmax = num(state, config, "tmax", 200);
  const p1 = Math.sin(theta / 2) ** 2, c0 = Math.sin(theta) / 2;
  return [
    curve("excited population ρ₁₁", (t) => p1 * Math.exp(-t / T1), 0, tmax, 300),
    curve(`coherence |ρ₀₁| (T2 = ${T2.toFixed(0)}${T2 < T2in ? ", capped at 2·T1" : ""})`, (t) => c0 * Math.exp(-t / T2), 0, tmax, 300),
    curve("<Z> = 1 − 2ρ₁₁", (t) => 1 - 2 * p1 * Math.exp(-t / T1), 0, tmax, 300),
  ];
}

export function concentration(config, state) {
  const eps = num(state, config, "eps", 0.1);
  const nmax = Math.round(num(state, config, "nmax", 30));
  const ns = [];
  for (let k = 1; k <= nmax; k++) ns.push(k);
  return [
    { label: "log10 of the spread (std) of <P> over random states, 1/√(2ⁿ+1)", points: ns.map((k) => ({ x: k, y: -0.5 * Math.log10(2 ** k + 1) })) },
    { label: `log10 of the shots to resolve a change of ε = ${eps} of that spread`, points: ns.map((k) => ({ x: k, y: Math.log10(1 / ((eps ** 2) / (2 ** k + 1))) })) },
  ];
}

/** The NARMA2 target series (Atiya and Parlos 2000 form) driven by u in [0, 0.5]. */
export function narma2(u) {
  const y = new Array(u.length).fill(0);
  for (let t = 2; t < u.length; t++) y[t] = 0.4 * y[t - 1] + 0.4 * y[t - 1] * y[t - 2] + 0.6 * u[t - 1] ** 3 + 0.1;
  return y;
}

export function qrcTask(config, state) {
  const o = quantumOpts(config, state);
  const task = str(state, config, "task", "recall s(k−3)");
  const shots = Math.round(num(state, config, "shots", 0));
  const s = inputs(o.seed, WASH + TRAIN + TEST);
  let target;
  if (task.startsWith("product")) target = s.map((v, k) => (k >= 1 ? v * s[k - 1] : 0));
  else if (task.startsWith("NARMA2")) target = narma2(s.map((v) => v / 2));
  else target = s.map((_, k) => (k >= 3 ? s[k - 3] : 0));
  const F = addShotNoise(runQuantumReservoir(s, o), shots, o.seed + 7);
  const w = ridge(F.slice(WASH, WASH + TRAIN), target.slice(WASH, WASH + TRAIN));
  const pred = F.slice(WASH + TRAIN).map((r) => predict(w, r));
  const tt = target.slice(WASH + TRAIN);
  const mean = tt.reduce((a, b) => a + b, 0) / tt.length;
  const nmse = pred.reduce((a, p, i) => a + (p - tt[i]) ** 2, 0) / tt.reduce((a, v) => a + (v - mean) ** 2, 0);
  const show = 80;
  return [
    { label: "target", points: tt.slice(0, show).map((y, i) => ({ x: i, y })) },
    { label: `prediction (NMSE = ${nmse.toFixed(3)})`, points: pred.slice(0, show).map((y, i) => ({ x: i, y })) },
  ];
}
