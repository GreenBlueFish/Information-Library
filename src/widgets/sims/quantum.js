// src/widgets/sims/quantum.js
//
// Small, exact quantum-mechanics helpers for the Quantum Mechanics shelf, plus
// the `parameter-plot` simulators that use them (registered in ./index.js):
//
//   rabi              driven two-level system: P(|1>) against time (Rabi's formula)
//   shot-estimate     running average of ±1 measurement outcomes against shots
//   coherent-photons  photon-number distribution of a coherent state vs thermal
//   trotter-fidelity  gate fidelity of first/second-order Trotter circuits vs steps
//   tfim-sweep        transverse-field Ising chain: <Z1 Zn> and gap against h
//
// Everything here is pure (no DOM). Complex matrices are { re, im } pairs of
// row-major Float64Arrays of size d*d. The two widget types bloch-sphere.js and
// qubit-circuit.js import the state-vector helpers from this module too.

import { jacobiEigen } from "./qrc.js";

const num = (state, config, key, def) => {
  const v = state && state[key] !== undefined ? Number(state[key]) : config && config[key] !== undefined ? Number(config[key]) : def;
  return Number.isFinite(v) ? v : def;
};
const str = (state, config, key, def) =>
  state && state[key] !== undefined ? String(state[key]) : config && config[key] !== undefined ? String(config[key]) : def;

/* -------------------------------------------------------------------------- */
/* Complex matrices                                                           */
/* -------------------------------------------------------------------------- */

export function cmat(d) {
  return { re: new Float64Array(d * d), im: new Float64Array(d * d) };
}

export function identity(d) {
  const m = cmat(d);
  for (let i = 0; i < d; i++) m.re[i * d + i] = 1;
  return m;
}

/** C = A B for d x d complex matrices. */
export function cmul(A, B, d) {
  const C = cmat(d);
  for (let i = 0; i < d; i++)
    for (let k = 0; k < d; k++) {
      const ar = A.re[i * d + k], ai = A.im[i * d + k];
      if (ar === 0 && ai === 0) continue;
      for (let j = 0; j < d; j++) {
        const br = B.re[k * d + j], bi = B.im[k * d + j];
        C.re[i * d + j] += ar * br - ai * bi;
        C.im[i * d + j] += ar * bi + ai * br;
      }
    }
  return C;
}

/** |Tr(A^dagger B) / d|^2, the gate fidelity used on the Gates and Circuits page. */
export function gateFidelity(A, B, d) {
  let re = 0, im = 0;
  for (let k = 0; k < d * d; k++) {
    re += A.re[k] * B.re[k] + A.im[k] * B.im[k];
    im += A.re[k] * B.im[k] - A.im[k] * B.re[k];
  }
  return (re * re + im * im) / (d * d);
}

/** exp(-i H t) for a real symmetric H (row-major, d x d) via its eigenbasis. */
export function expmiRealSym(H, d, t) {
  const { values, vectors: V } = jacobiEigen(Array.from(H), d);
  const U = cmat(d);
  for (let i = 0; i < d; i++)
    for (let j = 0; j < d; j++) {
      let re = 0, im = 0;
      for (let k = 0; k < d; k++) {
        const w = V[i * d + k] * V[j * d + k];
        re += w * Math.cos(values[k] * t);
        im -= w * Math.sin(values[k] * t);
      }
      U.re[i * d + j] = re;
      U.im[i * d + j] = im;
    }
  return U;
}

/* -------------------------------------------------------------------------- */
/* Single-qubit states and gates                                              */
/* -------------------------------------------------------------------------- */

/** cos(θ/2)|0> + e^{iφ} sin(θ/2)|1> as [re0, im0, re1, im1]; angles in radians. */
export function blochState(theta, phi) {
  const c = Math.cos(theta / 2), s = Math.sin(theta / 2);
  return [c, 0, s * Math.cos(phi), s * Math.sin(phi)];
}

/** Bloch vector (<X>, <Y>, <Z>) of a single-qubit state [re0, im0, re1, im1]. */
export function blochVector(v) {
  const [a, b, c, d] = v; // alpha = a + ib, beta = c + id
  return [2 * (a * c + b * d), 2 * (a * d - b * c), a * a + b * b - (c * c + d * d)];
}

/**
 * Single-qubit gates as 2x2 complex matrices [[re00, im00, re01, im01], [re10, im10, re11, im11]]
 * flattened to 8 numbers. R_P(θ) = cos(θ/2) I − i sin(θ/2) P.
 */
export function rotation(axis, theta) {
  const c = Math.cos(theta / 2), s = Math.sin(theta / 2);
  if (axis === "X") return [c, 0, 0, -s, 0, -s, c, 0];
  if (axis === "Y") return [c, 0, -s, 0, s, 0, c, 0];
  if (axis === "Z") return [c, -s, 0, 0, 0, 0, c, s];
  return [1, 0, 0, 0, 0, 0, 1, 0];
}

const R2 = Math.SQRT1_2;
export const GATES = {
  H: [R2, 0, R2, 0, R2, 0, -R2, 0],
  X: [0, 0, 1, 0, 1, 0, 0, 0],
  Y: [0, 0, 0, -1, 0, 1, 0, 0],
  Z: [1, 0, 0, 0, 0, 0, -1, 0],
  S: [1, 0, 0, 0, 0, 0, 0, 1],
  T: [1, 0, 0, 0, 0, 0, R2, R2],
  "Rx(π/2)": rotation("X", Math.PI / 2),
  "Ry(π/2)": rotation("Y", Math.PI / 2),
};

/** Apply a 2x2 gate g to the single-qubit state v. */
export function apply1(g, v) {
  const [a, b, c, d] = v;
  return [
    g[0] * a - g[1] * b + g[2] * c - g[3] * d,
    g[0] * b + g[1] * a + g[2] * d + g[3] * c,
    g[4] * a - g[5] * b + g[6] * c - g[7] * d,
    g[4] * b + g[5] * a + g[6] * d + g[7] * c,
  ];
}

/* -------------------------------------------------------------------------- */
/* Two-qubit state vectors (qubit 1 = most significant bit)                   */
/* -------------------------------------------------------------------------- */

/** Apply gate g to qubit q (0 or 1) of a 2-qubit state psi = [re, im] x 4. */
export function apply2(g, q, psi) {
  const out = psi.slice();
  const pairs = q === 0 ? [[0, 2], [1, 3]] : [[0, 1], [2, 3]];
  for (const [i0, i1] of pairs) {
    const r = apply1(g, [psi[2 * i0], psi[2 * i0 + 1], psi[2 * i1], psi[2 * i1 + 1]]);
    out[2 * i0] = r[0]; out[2 * i0 + 1] = r[1]; out[2 * i1] = r[2]; out[2 * i1 + 1] = r[3];
  }
  return out;
}

/** CNOT with the given control and target (0 or 1). */
export function cnot(control, target, psi) {
  const out = psi.slice();
  for (let idx = 0; idx < 4; idx++) {
    const bits = [(idx >> 1) & 1, idx & 1];
    if (bits[control] === 1) {
      const flipped = bits.slice(); flipped[target] ^= 1;
      const j = flipped[0] * 2 + flipped[1];
      out[2 * j] = psi[2 * idx]; out[2 * j + 1] = psi[2 * idx + 1];
    }
  }
  return out;
}

/**
 * Run a 2-qubit circuit given as columns of [gate on qubit 1, gate on qubit 2],
 * each a GATES key, "—" (nothing), "●" (control) or "⊕" (target). A column with
 * exactly one ● and one ⊕ is a CNOT; any other use of ● or ⊕ is invalid and the
 * column is skipped. Returns the final state and the indices of invalid columns.
 */
export function runCircuit(columns) {
  let psi = [1, 0, 0, 0, 0, 0, 0, 0];
  const invalid = [];
  columns.forEach(([g1, g2], k) => {
    const ctrl = [g1, g2].indexOf("●"), targ = [g1, g2].indexOf("⊕");
    const special = [g1, g2].filter((g) => g === "●" || g === "⊕").length;
    if (special > 0) {
      if (special === 2 && ctrl >= 0 && targ >= 0) psi = cnot(ctrl, targ, psi);
      else invalid.push(k);
      return;
    }
    if (GATES[g1]) psi = apply2(GATES[g1], 0, psi);
    if (GATES[g2]) psi = apply2(GATES[g2], 1, psi);
  });
  return { psi, invalid };
}

/** Reduced state of qubit 1 and its von Neumann entropy (bits) for a 2-qubit pure state. */
export function entanglementEntropy(psi) {
  // rho_A = M M^dagger with M_{ab} = amplitude of |ab>
  const amp = (i) => [psi[2 * i], psi[2 * i + 1]];
  const [a00, a01, a10, a11] = [0, 1, 2, 3].map(amp);
  const p0 = a00[0] ** 2 + a00[1] ** 2 + a01[0] ** 2 + a01[1] ** 2;
  // off-diagonal (rho_A)_{01} = a00 conj(a10) + a01 conj(a11)
  const offRe = a00[0] * a10[0] + a00[1] * a10[1] + a01[0] * a11[0] + a01[1] * a11[1];
  const offIm = a00[1] * a10[0] - a00[0] * a10[1] + a01[1] * a11[0] - a01[0] * a11[1];
  const p1 = 1 - p0;
  const disc = Math.sqrt(Math.max(0, ((p0 - p1) / 2) ** 2 + offRe ** 2 + offIm ** 2));
  const ev = [0.5 + disc, 0.5 - disc];
  const S = -ev.filter((x) => x > 1e-12).reduce((s, x) => s + x * Math.log2(x), 0);
  return { entropy: Math.max(0, S), purity: ev[0] ** 2 + ev[1] ** 2 };
}

/* -------------------------------------------------------------------------- */
/* parameter-plot simulators                                                  */
/* -------------------------------------------------------------------------- */

function curve(label, f, a, b, n) {
  const points = [];
  for (let k = 0; k <= n; k++) {
    const x = a + ((b - a) * k) / n;
    points.push({ x, y: f(x) });
  }
  return { label, points };
}

/** Driven two-level system H = (δ/2)Z + (Ω/2)X from |0>: P(|1>) and its ceiling. */
export function rabi(config, state) {
  const Omega = num(state, config, "Omega", 1);
  const delta = num(state, config, "delta", 0);
  const tmax = num(state, config, "tmax", 20);
  const W = Math.sqrt(Omega * Omega + delta * delta);
  const ceiling = W > 0 ? (Omega * Omega) / (W * W) : 0;
  return [
    curve(`P(|1⟩): oscillates at √(Ω² + δ²) = ${W.toFixed(2)}`, (t) => (W > 0 ? ceiling * Math.sin((W * t) / 2) ** 2 : 0), 0, tmax, 400),
    curve(`ceiling Ω²/(Ω² + δ²) = ${ceiling.toFixed(3)}`, () => ceiling, 0, tmax, 1),
  ];
}

/** A small seeded PRNG (mulberry32), so a given seed always redraws the same shots. */
export function rng32(seed) {
  let a = (Math.round(seed) >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Measure cos(θ/2)|0> + e^{iφ} sin(θ/2)|1> in the Z, X or Y basis S times and plot
 * the running average of the ±1 outcomes, the exact expectation and ±1 standard
 * error around it.
 */
export function shotEstimate(config, state) {
  const theta = (num(state, config, "theta", 60) * Math.PI) / 180;
  const phi = (num(state, config, "phi", 0) * Math.PI) / 180;
  const basis = str(state, config, "basis", "Z");
  const S = Math.max(10, Math.round(num(state, config, "shots", 500)));
  const seed = num(state, config, "seed", 1);
  const r = blochVector(blochState(theta, phi));
  const exact = basis === "X" ? r[0] : basis === "Y" ? r[1] : r[2];
  const pPlus = (1 + exact) / 2;
  const rand = rng32(seed);
  const run = [];
  let sum = 0;
  for (let k = 1; k <= S; k++) {
    sum += rand() < pPlus ? 1 : -1;
    run.push({ x: k, y: sum / k });
  }
  const se = (k) => Math.sqrt(Math.max(0, 1 - exact * exact) / k);
  const band = (sign) => {
    const pts = [];
    for (let k = 1; k <= S; k += Math.max(1, Math.floor(S / 200))) pts.push({ x: k, y: exact + sign * se(k) });
    return pts;
  };
  return [
    { label: `running estimate of ⟨${basis}⟩ (final ${(sum / S).toFixed(3)} after ${S} shots)`, points: run },
    { label: `exact ⟨${basis}⟩ = ${exact.toFixed(3)}`, points: [{ x: 1, y: exact }, { x: S, y: exact }] },
    { label: "exact ± one standard error √((1 − ⟨P⟩²)/S)", points: [...band(1), { x: 1, y: exact - se(1), move: true }, ...band(-1)] },
  ];
}

/** Photon-number distributions with mean |α|²: coherent (Poisson) and thermal (geometric). */
export function coherentPhotons(config, state) {
  const alpha = num(state, config, "alpha", 2);
  const nmax = Math.round(num(state, config, "nmax", 20));
  const m = alpha * alpha;
  const stems = (label, p, dx) => {
    const pts = [];
    for (let n = 0; n <= nmax; n++) pts.push({ x: n + dx, y: 0, move: true }, { x: n + dx, y: p(n) });
    return { label, points: pts };
  };
  let logFact = 0;
  const pois = [];
  for (let n = 0; n <= nmax; n++) {
    if (n > 0) logFact += Math.log(n);
    pois.push(Math.exp(-m + (n > 0 ? n * Math.log(m) : 0) - logFact));
  }
  return [
    stems(`coherent state |α|² = ${m.toFixed(2)}: Poisson, variance = mean`, (n) => pois[n], -0.12),
    stems("thermal state with the same mean: variance = mean + mean²", (n) => (1 / (1 + m)) * (m / (1 + m)) ** n, 0.12),
  ];
}

/** Two-qubit H = J X⊗X + h(Z⊗I + I⊗Z) as a real symmetric 4x4 matrix. */
export function twoQubitXXZ(J, h) {
  const H = new Float64Array(16);
  const z = [2, 0, 0, -2]; // Z1 + Z2 on |00>, |01>, |10>, |11>
  for (let i = 0; i < 4; i++) {
    H[i * 4 + i] = h * z[i];
    H[i * 4 + (3 - i)] += J; // X⊗X flips both bits
  }
  return H;
}

/** First- and second-order Trotter circuits for twoQubitXXZ, compared with exp(-iHt). */
export function trotterCircuit(J, h, t, steps, order) {
  const dt = t / steps;
  const z = [2, 0, 0, -2];
  const zstep = (tau) => {
    const U = cmat(4);
    for (let i = 0; i < 4; i++) { U.re[i * 4 + i] = Math.cos(h * z[i] * tau); U.im[i * 4 + i] = -Math.sin(h * z[i] * tau); }
    return U;
  };
  const xx = cmat(4);
  for (let i = 0; i < 4; i++) { xx.re[i * 4 + i] = Math.cos(J * dt); xx.im[i * 4 + (3 - i)] = -Math.sin(J * dt); }
  const step = order === 2 ? cmul(cmul(zstep(dt / 2), xx, 4), zstep(dt / 2), 4) : cmul(zstep(dt), xx, 4);
  let U = identity(4);
  for (let k = 0; k < steps; k++) U = cmul(step, U, 4);
  return U;
}

export function trotterFidelity(config, state) {
  const J = num(state, config, "J", 0.5), h = num(state, config, "h", 1), t = num(state, config, "t", 2);
  const rmax = Math.round(num(state, config, "rmax", 30));
  const exact = expmiRealSym(twoQubitXXZ(J, h), 4, t);
  const series = (order) => {
    const pts = [];
    for (let r = 1; r <= rmax; r++) pts.push({ x: r, y: gateFidelity(exact, trotterCircuit(J, h, t, r, order), 4) });
    return pts;
  };
  const one = series(1), two = series(2);
  return [
    { label: `first order (${one[0].y.toFixed(3)} at 1 step, ${one[one.length - 1].y.toFixed(4)} at ${rmax})`, points: one },
    { label: `second order (${two[0].y.toFixed(3)} at 1 step, ${two[two.length - 1].y.toFixed(4)} at ${rmax})`, points: two },
  ];
}

/** Open transverse-field Ising chain −J Σ Z_i Z_{i+1} − h Σ X_i on n spins (real symmetric). */
export function tfimHamiltonian(n, J, h) {
  const D = 1 << n;
  const H = new Float64Array(D * D);
  for (let s = 0; s < D; s++) {
    let zz = 0;
    for (let i = 0; i < n - 1; i++) {
      const a = (s >> (n - 1 - i)) & 1, b = (s >> (n - 2 - i)) & 1;
      zz += a === b ? 1 : -1;
    }
    H[s * D + s] = -J * zz;
    for (let i = 0; i < n; i++) H[s * D + (s ^ (1 << (n - 1 - i)))] += -h;
  }
  return H;
}

/** Ground-state end-to-end correlation <Z_1 Z_n> and the gap E1 − E0. */
export function tfimPoint(n, J, h) {
  const D = 1 << n;
  const { values, vectors: V } = jacobiEigen(Array.from(tfimHamiltonian(n, J, h)), D);
  const order = values.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const g = order[0][1];
  let corr = 0;
  for (let s = 0; s < D; s++) {
    const first = (s >> (n - 1)) & 1, last = s & 1;
    corr += V[s * D + g] ** 2 * (first === last ? 1 : -1);
  }
  return { corr, gap: order[1][0] - order[0][0] };
}

export function tfimSweep(config, state) {
  const n = Math.round(num(state, config, "n", 6));
  const hmax = num(state, config, "hmax", 3);
  const pts = Math.round(num(state, config, "points", 25));
  const corr = [], gap = [];
  for (let k = 0; k <= pts; k++) {
    const h = 0.02 + ((hmax - 0.02) * k) / pts;
    const r = tfimPoint(n, 1, h);
    corr.push({ x: h, y: r.corr });
    gap.push({ x: h, y: r.gap });
  }
  return [
    { label: `ground-state ⟨Z₁Z${String(n).replace(/\d/g, (d) => "₀₁₂₃₄₅₆₇₈₉"[d])}⟩ (order across the chain)`, points: corr },
    { label: "gap E₁ − E₀", points: gap },
    { label: "h = J (the transition in an infinite chain)", points: [{ x: 1, y: 0 }, { x: 1, y: 1 }] },
  ];
}
