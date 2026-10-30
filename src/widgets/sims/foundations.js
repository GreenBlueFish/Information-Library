// src/widgets/sims/foundations.js
//
// Simulators for the NEF, semantic pointer and LMU pages: LIF tuning curves
// and least-squares decoding, binding by circular convolution, and the
// Legendre delay network.

import { num, str, rng, gauss, series } from "./util.js";

/** Steady-state LIF rate (Hz) for input current J (threshold 1). */
function lifRate(J, tauRC = 0.02, tauRef = 0.002) {
  return J > 1 ? 1 / (tauRef + tauRC * Math.log1p(1 / (J - 1))) : 0;
}

/** A 1-D NEF ensemble: encoder ±1, gain and bias chosen from random intercepts and max rates. */
function ensemble(n, seed) {
  const rand = rng(seed);
  return Array.from({ length: n }, () => {
    const e = rand() < 0.5 ? -1 : 1;
    const intercept = -0.95 + 1.9 * rand();
    const maxRate = 200 + 200 * rand();
    // solve gain/bias so rate(e·x) is 0 at the intercept and maxRate at x·e = 1
    const jMax = 1 + 1 / Math.expm1((1 / maxRate - 0.002) / 0.02);
    const gain = (jMax - 1) / (1 - intercept);
    const bias = 1 - gain * intercept;
    return { e, gain, bias };
  });
}

const rates = (ens, x) => ens.map((nrn) => lifRate(nrn.gain * nrn.e * x + nrn.bias));

/** Tuning curves of an ensemble across x in [-1, 1] (up to 8 neurons drawn). */
export function nefTuning(config, state) {
  const n = Math.round(num(state, config, "neurons", 8));
  const ens = ensemble(n, num(state, config, "seed", 1));
  const xs = Array.from({ length: 101 }, (_, i) => -1 + i / 50);
  return ens.slice(0, 8).map((nrn, i) =>
    series(`neuron ${i + 1} (${nrn.e > 0 ? "+" : "−"})`, xs, xs.map((x) => lifRate(nrn.gain * nrn.e * x + nrn.bias))));
}

/** Solve (A + λI) x = b by Gaussian elimination with partial pivoting. */
function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x;
}

/**
 * Decode f(x) from an ensemble with regularised least squares, then compare
 * the decoded estimate with the target. More neurons, smaller error.
 */
export function nefDecode(config, state) {
  const n = Math.round(num(state, config, "neurons", 20));
  const fname = str(state, config, "function", "x");
  const f = { x: (x) => x, "x²": (x) => x * x, "sin(πx)": (x) => Math.sin(Math.PI * x) }[fname] ?? ((x) => x);
  const ens = ensemble(n, num(state, config, "seed", 1));
  const xs = Array.from({ length: 101 }, (_, i) => -1 + i / 50);
  const Acts = xs.map((x) => rates(ens, x));
  const noise = 0.1 * 400;
  const G = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => {
    let s = 0;
    for (const a of Acts) s += a[i] * a[j];
    return s + (i === j ? xs.length * noise * noise : 0);
  }));
  const u = Array.from({ length: n }, (_, i) => Acts.reduce((s, a, k) => s + a[i] * f(xs[k]), 0));
  const d = solve(G, u);
  const est = Acts.map((a) => a.reduce((s, r, i) => s + r * d[i], 0));
  return [series(`target ${fname}`, xs, xs.map(f)), series(`decoded from ${n} neurons`, xs, est)];
}

function randomVector(rand, D) {
  const v = Array.from({ length: D }, () => gauss(rand) / Math.sqrt(D));
  return v;
}
function cconv(a, b) {
  const D = a.length, out = new Array(D).fill(0);
  for (let i = 0; i < D; i++) for (let j = 0; j < D; j++) out[(i + j) % D] += a[i] * b[j];
  return out;
}
const involution = (a) => a.map((_, i) => a[(a.length - i) % a.length]);
function cosine(a, b) {
  let ab = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) { ab += a[i] * b[i]; aa += a[i] * a[i]; bb += b[i] * b[i]; }
  return ab / Math.sqrt(aa * bb);
}

/**
 * Bundle `pairs` role⊛filler bindings into one semantic pointer, unbind one
 * role, and measure similarity of the result to the right filler and to the
 * best wrong vocabulary item, across dimensions 16..512.
 */
export function spaBinding(config, state) {
  const pairs = Math.round(num(state, config, "pairs", 4));
  const rand = rng(num(state, config, "seed", 4));
  const dims = [16, 32, 64, 128, 256, 512];
  const right = [], wrong = [];
  for (const D of dims) {
    const roles = Array.from({ length: pairs }, () => randomVector(rand, D));
    const fillers = Array.from({ length: pairs }, () => randomVector(rand, D));
    const vocab = [...fillers, ...Array.from({ length: 10 }, () => randomVector(rand, D))];
    const memory = new Array(D).fill(0);
    for (let p = 0; p < pairs; p++) cconv(roles[p], fillers[p]).forEach((v, i) => (memory[i] += v));
    const guess = cconv(memory, involution(roles[0]));
    right.push(cosine(guess, fillers[0]));
    wrong.push(Math.max(...vocab.slice(1).map((v) => cosine(guess, v))));
  }
  return [series("similarity to correct filler", dims, right), series("best wrong item", dims, wrong)];
}

/**
 * Legendre delay network (Voelker et al. 2019): a d-dimensional linear system
 * whose state m(t) compresses the last θ seconds of its input onto shifted
 * Legendre polynomials; decoding at θ' = θ reads out u(t − θ).
 */
export function ldn(config, state) {
  const d = Math.round(num(state, config, "order", 6));
  const theta = num(state, config, "theta", 0.5);
  const T = 3, dt = 0.001;
  const A = [], B = [];
  for (let i = 0; i < d; i++) {
    A.push([]);
    for (let j = 0; j < d; j++) A[i].push(((2 * i + 1) / theta) * (i < j ? -1 : (-1) ** (i - j + 1)));
    B.push(((2 * i + 1) * (-1) ** i) / theta);
  }
  const u = (t) => Math.sin(2 * Math.PI * 1 * t) * 0.7 + 0.3 * Math.sin(2 * Math.PI * 2.3 * t);
  const deriv = (m, t) => m.map((_, i) => A[i].reduce((s, a, j) => s + a * m[j], 0) + B[i] * u(t));
  let m = new Array(d).fill(0);
  const ts = [], delayed = [], decoded = [], input = [];
  for (let t = 0; t <= T; t += dt) {
    // RK4 step
    const k1 = deriv(m, t);
    const k2 = deriv(m.map((x, i) => x + (dt / 2) * k1[i]), t + dt / 2);
    const k3 = deriv(m.map((x, i) => x + (dt / 2) * k2[i]), t + dt / 2);
    const k4 = deriv(m.map((x, i) => x + dt * k3[i]), t + dt);
    m = m.map((x, i) => x + (dt / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
    // shifted Legendre polynomials at r = 1 are all 1
    ts.push(t + dt);
    input.push(u(t + dt));
    delayed.push(t + dt >= theta ? u(t + dt - theta) : 0);
    decoded.push(m.reduce((s, x) => s + x, 0));
  }
  return [series("input u(t)", ts, input, 600), series("true u(t − θ)", ts, delayed, 600), series(`LDN decode, d = ${d}`, ts, decoded, 600)];
}
