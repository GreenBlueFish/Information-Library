// src/widgets/sims/columns.js
//
// More simulators for the cortical-column pages: the HTM spatial pooler with
// and without boosting, the false-match arithmetic of a dendritic segment,
// Hebb versus Oja, an adaptive threshold holding a firing rate, the canonical
// microcircuit's E/I amplifier, one level of predictive-coding inference, and
// a rate version of the Potjans–Diesmann layer table.

import { num, rng, gauss, series } from "./util.js";

/** k distinct random integers in [0, n). */
function sample(rand, n, k) {
  const picked = new Set();
  while (picked.size < Math.min(k, n)) picked.add(Math.floor(rand() * n));
  return [...picked];
}

/**
 * Spatial pooler (Cui, Ahmad & Hawkins 2017, simplified): 128 minicolumns,
 * each with a potential pool of half of 200 input bits and permanences around
 * the 0.2 connection threshold. Every step one of 30 input patterns (20 active
 * bits) arrives, the `active` columns with the highest boosted overlap win,
 * and winners move permanences toward the input (+0.05 active, −0.02
 * inactive). Boost factor b = exp(−boost·(duty − target)), target = k/128.
 * Plots each column's share of steps won over the last 300 of 900 steps,
 * columns sorted from most to least used, with and without boosting.
 */
export function spatialPooler(config, state) {
  const k = Math.round(num(state, config, "active", 6));
  const boost = num(state, config, "boost", 3);
  const seed = num(state, config, "seed", 4);
  const C = 128, nIn = 200, onBits = 20, steps = 900, window = 300;
  const target = k / C;

  const run = (strength) => {
    const rand = rng(seed);
    const patterns = Array.from({ length: 30 }, () => sample(rand, nIn, onBits));
    const pools = Array.from({ length: C }, () => sample(rand, nIn, nIn / 2));
    const perm = pools.map((pool) => Float64Array.from(pool, () => 0.2 + (rand() - 0.5) * 0.2));
    const duty = new Array(C).fill(target);
    const won = new Array(C).fill(0);
    const input = new Uint8Array(nIn);
    for (let t = 0; t < steps; t++) {
      input.fill(0);
      for (const i of patterns[Math.floor(rand() * patterns.length)]) input[i] = 1;
      const score = pools.map((pool, c) => {
        let overlap = 0;
        for (let j = 0; j < pool.length; j++) if (perm[c][j] >= 0.2 && input[pool[j]]) overlap++;
        return overlap * Math.exp(-strength * (duty[c] - target) * C / k) + c * 1e-9;
      });
      const winners = new Set([...score.keys()].sort((a, b) => score[b] - score[a]).slice(0, k));
      for (let c = 0; c < C; c++) {
        const on = winners.has(c);
        duty[c] += ((on ? 1 : 0) - duty[c]) / 50;
        if (!on) continue;
        if (t >= steps - window) won[c]++;
        const pool = pools[c], p = perm[c];
        for (let j = 0; j < pool.length; j++) p[j] = Math.min(1, Math.max(0, p[j] + (input[pool[j]] ? 0.05 : -0.02)));
      }
    }
    return won.map((w) => (100 * w) / window).sort((a, b) => b - a);
  };
  const xs = Array.from({ length: C }, (_, i) => i + 1);
  return [
    series("no boosting", xs, run(0)),
    series(`boost strength ${boost}`, xs, run(boost)),
    series("target duty cycle", xs, xs.map(() => 100 * target)),
  ];
}

/** ln Γ(x) by the Lanczos approximation (x > 0). */
function lnGamma(x) {
  const g = [676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1 - x);
  x -= 1;
  let a = 0.99999999999980993;
  for (let i = 0; i < 8; i++) a += g[i] / (x + i + 1);
  const t = x + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}
const lnChoose = (n, k) => (k < 0 || k > n ? -Infinity : lnGamma(n + 1) - lnGamma(k + 1) - lnGamma(n - k + 1));

/** log10 of a sum of probabilities given as natural logs. */
function log10Sum(lns) {
  const finite = lns.filter(Number.isFinite);
  if (!finite.length) return -Infinity;
  const top = Math.max(...finite);
  return (top + Math.log(finite.reduce((s, l) => s + Math.exp(l - top), 0))) / Math.LN10;
}

/**
 * A dendritic segment as a pattern detector (Ahmad & Hawkins 2016): it holds
 * `synapses` synapses onto cells of one remembered pattern and fires when at
 * least θ of them are active. For each θ it plots log10 of two error rates:
 *   false match — a random pattern of `active` cells out of `cells` hits θ or
 *     more of the synapses (hypergeometric tail);
 *   miss — the remembered pattern comes back with `noise`% of its cells
 *     replaced, so each synapse still sees an active cell with probability
 *     1 − noise, and fewer than θ are hit (binomial tail).
 * Low θ misses nothing but matches noise; high θ is specific but brittle.
 */
export function dendriteMatch(config, state) {
  const n = Math.round(num(state, config, "cells", 2048));
  const a = Math.round(num(state, config, "active", 40));
  const s = Math.round(num(state, config, "synapses", 20));
  const noise = num(state, config, "noise", 30) / 100;
  const floor = -30;
  const thetas = [], falseMatch = [], miss = [];
  for (let th = 1; th <= s; th++) {
    const fm = [], ms = [];
    for (let b = 0; b <= s; b++) {
      if (b >= th) fm.push(lnChoose(s, b) + lnChoose(n - s, a - b) - lnChoose(n, a));
      else ms.push(lnChoose(s, b) + b * Math.log(Math.max(1e-300, 1 - noise)) + (s - b) * Math.log(Math.max(1e-300, noise)));
    }
    thetas.push(th);
    falseMatch.push(Math.max(floor, log10Sum(fm)));
    miss.push(Math.max(floor, log10Sum(ms)));
  }
  return [series("false match: log10 P", thetas, falseMatch), series(`miss at ${Math.round(noise * 100)}% noise: log10 P`, thetas, miss)];
}

/**
 * Hebb versus Oja on two correlated inputs: x is drawn with unit variances
 * and correlation `correlation`, and a linear neuron y = w·x learns at rate
 * `rate`. Plain Hebb, Δw = η y x, grows without bound along the first
 * principal component (plotted as log10 |w|); Oja's rule, Δw = η y (x − y w),
 * settles at |w| = 1 pointing along that component (|cos| to it → 1).
 */
export function hebbOja(config, state) {
  const rho = num(state, config, "correlation", 0.6);
  const eta = num(state, config, "rate", 0.01);
  const rand = rng(num(state, config, "seed", 8));
  const steps = 2000;
  let hebb = [0.3, -0.2], oja = [0.3, -0.2];
  const xs = [], hebbNorm = [], ojaNorm = [], ojaAlign = [];
  const pc = rho >= 0 ? [Math.SQRT1_2, Math.SQRT1_2] : [Math.SQRT1_2, -Math.SQRT1_2];
  for (let t = 0; t < steps; t++) {
    const z1 = gauss(rand), z2 = gauss(rand);
    const x = [z1, rho * z1 + Math.sqrt(Math.max(0, 1 - rho * rho)) * z2];
    const yh = hebb[0] * x[0] + hebb[1] * x[1];
    hebb = [hebb[0] + eta * yh * x[0], hebb[1] + eta * yh * x[1]];
    const yo = oja[0] * x[0] + oja[1] * x[1];
    oja = [oja[0] + eta * yo * (x[0] - yo * oja[0]), oja[1] + eta * yo * (x[1] - yo * oja[1])];
    if (t % 10 === 0) {
      const hn = Math.hypot(...hebb), on = Math.hypot(...oja);
      xs.push(t);
      hebbNorm.push(Math.log10(Math.max(1e-12, hn)));
      ojaNorm.push(on);
      ojaAlign.push(Math.abs(oja[0] * pc[0] + oja[1] * pc[1]) / Math.max(1e-12, on));
    }
  }
  return [
    series("plain Hebb: log10 |w|", xs, hebbNorm),
    series("Oja: |w|", xs, ojaNorm),
    series("Oja: |cos| to 1st principal component", xs, ojaAlign),
  ];
}

/**
 * Adaptive threshold (Diehl & Cook 2015 style) on a noisy LIF neuron
 * (τm = 20 ms, threshold 1, reset 0). Its input drive steps from 1.1 to
 * `drive` at t = 10 s. With the adaptation on, every spike raises θ by `jump`
 * and θ decays with τθ = `tau` s; the spike condition is v > 1 + θ. Plots the
 * firing rate (spikes in 1 s bins) with and without adaptation.
 */
export function adaptiveThreshold(config, state) {
  const drive2 = num(state, config, "drive", 2);
  const jump = num(state, config, "jump", 0.05);
  const tauTheta = num(state, config, "tau", 2) * 1000;
  const seed = num(state, config, "seed", 6);
  const dt = 1, tauM = 20, T = 20000, bin = 1000;
  const run = (adapt) => {
    const rand = rng(seed);
    let v = 0, theta = 0, count = 0;
    const rates = [];
    for (let t = 0; t < T; t += dt) {
      const I = (t < T / 2 ? 1.1 : drive2) + 0.5 * gauss(rand);
      v += (dt / tauM) * (-v + I);
      if (adapt) theta -= (dt / tauTheta) * theta;
      if (v > 1 + theta) {
        v = 0;
        count++;
        if (adapt) theta += jump;
      }
      if ((t + dt) % bin === 0) { rates.push((count * 1000) / bin); count = 0; }
    }
    return rates;
  };
  const xs = Array.from({ length: T / bin }, (_, i) => i + 0.5);
  return [series("fixed threshold", xs, run(false)), series("adaptive threshold", xs, run(true))];
}

/**
 * The canonical microcircuit as an amplifier (Douglas, Martin & Whitteridge
 * 1989): an excitatory pool E with recurrent gain wEE and an inhibitory pool
 * I it drives, τE dE/dt = −E + [wEE·E − wEI·I + h]₊, τI dI/dt = −I + [wIE·E]₊
 * (τE = 10 ms, τI = 5 ms). A thalamic step h = 1 arrives at 20 ms. Plots E
 * and I against the bare feedforward relay (no recurrence), whose output is h.
 * Steady state: E* = h / (1 − wEE + wEI·wIE) while that denominator is > 0.
 */
export function eiAmplifier(config, state) {
  const wEE = num(state, config, "wEE", 1.5);
  const wEI = num(state, config, "wEI", 1);
  const wIE = num(state, config, "wIE", 1);
  const tauE = 10, tauI = 5, dt = 0.1, T = 200;
  const relu = (x) => Math.max(0, x);
  let E = 0, I = 0, R = 0;
  const xs = [], es = [], is = [], rs = [];
  for (let t = 0; t <= T; t += dt) {
    const h = t >= 20 ? 1 : 0;
    const dE = (-E + relu(wEE * E - wEI * I + h)) / tauE;
    const dI = (-I + relu(wIE * E)) / tauI;
    E = Math.min(1e3, E + dt * dE);
    I = Math.min(1e3, I + dt * dI);
    R += (dt * (-R + h)) / tauE;
    xs.push(t); es.push(E); is.push(I); rs.push(R);
  }
  return [series("E (recurrent column)", xs, es), series("I", xs, is), series("feedforward relay", xs, rs)];
}

/**
 * One level of predictive-coding inference (Bogacz 2017 tutorial): a hidden
 * cause φ predicts the input through g(φ) = φ²; the prior expects `prior`.
 *   ε_u = (u − φ²) / σu²,  ε_p = (φ − prior) / σp²  (σp² = 1)
 *   dφ/dt = 2φ·ε_u − ε_p
 * φ climbs from the prior to the value that balances the two errors (the most
 * probable cause), and both error units fall toward that balance.
 */
export function predictiveCoding(config, state) {
  const u = num(state, config, "observation", 2);
  const varU = num(state, config, "sensoryVariance", 1);
  const prior = num(state, config, "prior", 3);
  const dt = 0.001, T = 5;
  let phi = prior;
  const xs = [], phis = [], eu = [], ep = [];
  for (let t = 0; t <= T + 1e-9; t += dt) {
    const epsU = (u - phi * phi) / varU;
    const epsP = phi - prior;
    xs.push(t); phis.push(phi); eu.push(epsU); ep.push(epsP);
    phi += dt * (2 * phi * epsU - epsP);
    phi = Math.max(-10, Math.min(10, phi));
  }
  return [series("estimate φ", xs, phis), series("sensory error ε_u", xs, eu), series("prior error ε_p", xs, ep)];
}

const PD_POPS = ["L2/3e", "L2/3i", "L4e", "L4i", "L5e", "L5i", "L6e", "L6i"];
const PD_N = [20683, 5834, 21915, 5479, 4850, 1065, 14395, 2948];
const PD_C = [
  [0.1009, 0.1689, 0.0437, 0.0818, 0.0323, 0.0, 0.0076, 0.0],
  [0.1346, 0.1371, 0.0316, 0.0515, 0.0755, 0.0, 0.0042, 0.0],
  [0.0077, 0.0059, 0.0497, 0.135, 0.0067, 0.0003, 0.0453, 0.0],
  [0.0691, 0.0029, 0.0794, 0.1597, 0.0033, 0.0, 0.1057, 0.0],
  [0.1004, 0.0622, 0.0505, 0.0057, 0.0831, 0.3726, 0.0204, 0.0],
  [0.0548, 0.0269, 0.0257, 0.0022, 0.06, 0.3158, 0.0086, 0.0],
  [0.0156, 0.0066, 0.0211, 0.0166, 0.0572, 0.0197, 0.0396, 0.2252],
  [0.0364, 0.001, 0.0034, 0.0005, 0.0277, 0.008, 0.0658, 0.1443],
];
const PD_TH = [0, 0, 0.0983, 0.0619, 0, 0, 0.0512, 0.0196]; // thalamus (902 cells) → each population

/**
 * The Potjans–Diesmann table as a rate model: each population's in-degree
 * from a source is C·N_source; every 100 excitatory inputs weigh `gain` (twice
 * that for L4e → L2/3e, as in the model) and inhibitory ones −g times as much. Rates follow
 * τ dr/dt = −r + [gain·Σ K·w·r + background + thalamus]₊ with τ = 10 ms and
 * a common background of 1. A thalamic pulse (100–110 ms, strength
 * `thalamus`) enters through the thalamic in-degrees. Plots the excitatory
 * populations' rates minus their resting level: the pulse lands in L4 and L6
 * and spreads to L2/3 and L5 a few milliseconds later.
 */
export function laminarFlow(config, state) {
  const g = num(state, config, "g", 4);
  const gain = num(state, config, "gain", 0.02);
  const th = num(state, config, "thalamus", 30);
  const tau = 10, dt = 0.1, T = 200, P = 8;
  const W = PD_C.map((row, i) => row.map((c, j) => {
    const w = j % 2 === 0 ? (i === 0 && j === 2 ? 2 : 1) : -g;
    return gain * c * PD_N[j] * w * 0.01;
  }));
  const thK = PD_TH.map((c) => c * 902 * 0.01);
  let r = new Array(P).fill(0);
  const step = (ext) => {
    r = r.map((ri, i) => {
      let inp = 1 + ext * thK[i];
      for (let j = 0; j < P; j++) inp += W[i][j] * r[j];
      return Math.min(1e3, ri + (dt / tau) * (-ri + Math.max(0, inp)));
    });
  };
  for (let t = 0; t < 500; t += dt) step(0); // settle to rest
  const rest = r.slice();
  const xs = [], traces = [[], [], [], []];
  for (let t = 0; t <= T; t += dt) {
    step(t >= 100 && t < 110 ? th : 0);
    xs.push(t);
    for (let L = 0; L < 4; L++) traces[L].push(r[2 * L] - rest[2 * L]);
  }
  return traces.map((ys, L) => series(PD_POPS[2 * L], xs, ys));
}

/**
 * Current-based versus conductance-based synapses (CUBA vs COBA) on a passive
 * membrane (C = 200 pF, gL = 10 nS, EL = −65 mV, no spiking). `inputs`
 * excitatory synapses fire as Poisson trains at 10 Hz each from 50 ms to
 * 250 ms, each spike adding `weight` nS of conductance that decays with
 * τ = 5 ms. CUBA injects w·s(t)·(Ee − EL), the current that conductance would
 * carry at rest; COBA injects g(t)·(Ee − V), which shrinks as V nears
 * Ee = 0 mV. Small inputs look the same; large ones saturate under COBA.
 */
export function cubaCoba(config, state) {
  const n = Math.round(num(state, config, "inputs", 200));
  const w = num(state, config, "weight", 1);
  const rand = rng(num(state, config, "seed", 12));
  const C = 200, gL = 10, EL = -65, Ee = 0, tau = 5, dt = 0.1, T = 300;
  const p = n * 10 * dt / 1000; // expected input spikes per step
  let g = 0, vC = EL, vG = EL;
  const xs = [], cs = [], gs = [];
  for (let t = 0; t <= T; t += dt) {
    if (t >= 50 && t < 250) {
      // Poisson count by inversion; p stays small enough for a short loop
      let k = 0, prob = Math.exp(-p), cum = prob;
      const u = rand();
      while (u > cum && k < 1000) { k++; prob *= p / k; cum += prob; }
      g += k * w;
    }
    g -= (dt / tau) * g;
    vC += (dt / C) * (-gL * (vC - EL) + g * (Ee - EL));
    vG += (dt / C) * (-gL * (vG - EL) + g * (Ee - vG));
    xs.push(t); cs.push(Math.min(200, vC)); gs.push(vG);
  }
  return [series("current-based (CUBA)", xs, cs), series("conductance-based (COBA)", xs, gs)];
}

/**
 * NMDA spikes in a thin dendrite: one compartment (τ = 10 ms at rest, EL =
 * −70 mV) receives n synchronous synapses at t = 0, each with an AMPA
 * conductance (τ = 2 ms) and, optionally, an NMDA conductance (rise 2 ms,
 * decay `nmdaDecay` ms) gated by the magnesium block
 * B(V) = 1 / (1 + [Mg]/3.57 · exp(−0.062 V)), [Mg] = 1 mM. Plots the
 * depolarisation 30 ms after the input against n: AMPA alone grows smoothly
 * and has decayed by then; with NMDA the response jumps to a plateau once
 * enough synapses are coactive — the threshold an HTM segment abstracts.
 */
export function nmdaDendrite(config, state) {
  const gA = num(state, config, "ampa", 0.05);
  const gN = num(state, config, "nmda", 0.04);
  const tauN = num(state, config, "nmdaDecay", 80);
  const maxN = 40, dt = 0.05, EL = -70, tau = 10;
  const B = (v) => 1 / (1 + (1 / 3.57) * Math.exp(-0.062 * v));
  const plateau = (n, withNmda) => {
    let v = EL, a = n * gA, x = n * gN, s = 0;
    for (let t = 0; t < 30; t += dt) {
      const iSyn = a * (0 - v) + (withNmda ? s * B(v) * (0 - v) : 0);
      v += (dt / tau) * (EL - v + iSyn * 10);
      a -= (dt / 2) * a;
      s += dt * (x / 2 - s / tauN);
      x -= (dt / 2) * x;
    }
    return v - EL;
  };
  const ns = Array.from({ length: maxN }, (_, i) => i + 1);
  return [series("AMPA + NMDA", ns, ns.map((n) => plateau(n, true))), series("AMPA only", ns, ns.map((n) => plateau(n, false)))];
}

/**
 * Izhikevich's (2003) 1000-neuron network, as in his MATLAB listing: 800
 * excitatory regular-spiking-to-chattering cells and 200 inhibitory
 * fast-spiking-to-LTS cells, all-to-all with random weights (excitatory
 * 0.5·rand·`excitation`, inhibitory −rand), thalamic noise 5·N(0,1) to
 * excitatory and 2·N(0,1) to inhibitory cells. Plots spikes per ms for each
 * population over 1 s: alpha- and gamma-band rhythms emerge without being
 * built in.
 */
export function izhikevichNetwork(config, state) {
  const exc = num(state, config, "excitation", 1);
  const noise = num(state, config, "noise", 1);
  const rand = rng(num(state, config, "seed", 3));
  const Ne = 800, Ni = 200, N = Ne + Ni, T = 1000;
  const a = new Float64Array(N), b = new Float64Array(N), c = new Float64Array(N), d = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const r = rand();
    if (i < Ne) { a[i] = 0.02; b[i] = 0.2; c[i] = -65 + 15 * r * r; d[i] = 8 - 6 * r * r; }
    else { a[i] = 0.02 + 0.08 * r; b[i] = 0.25 - 0.05 * r; c[i] = -65; d[i] = 2; }
  }
  const S = Array.from({ length: N }, (_, j) => Float64Array.from({ length: N }, () => (j < Ne ? 0.5 * exc * rand() : -rand())));
  const v = new Float64Array(N).fill(-65), u = Float64Array.from(b, (bi) => bi * -65);
  const I = new Float64Array(N);
  const xs = [], eRate = [], iRate = [];
  for (let t = 0; t < T; t++) {
    for (let i = 0; i < N; i++) I[i] = noise * (i < Ne ? 5 : 2) * gauss(rand);
    let ne = 0, ni = 0;
    for (let j = 0; j < N; j++) {
      if (v[j] < 30) continue;
      if (j < Ne) ne++; else ni++;
      v[j] = c[j]; u[j] += d[j];
      const row = S[j];
      for (let i = 0; i < N; i++) I[i] += row[i];
    }
    for (let i = 0; i < N; i++) {
      for (let h = 0; h < 2; h++) v[i] = Math.min(30, v[i] + 0.5 * (0.04 * v[i] * v[i] + 5 * v[i] + 140 - u[i] + I[i]));
      u[i] += a[i] * (b[i] * v[i] - u[i]);
    }
    xs.push(t); eRate.push(ne); iRate.push(ni);
  }
  return [series("excitatory spikes / ms", xs, eRate), series("inhibitory spikes / ms", xs, iRate)];
}

/**
 * Path integration with grid-cell phases: an animal walks a 1-D track at a
 * varying speed and updates its position estimate by integrating velocity,
 * with independent noise added each 50 ms step so the error performs a
 * random walk: its spread grows like `noise`·√t (noise in cm/√s). Every `landmark` s a sensed landmark resets the
 * estimate (0 = never). Plots the absolute position error in cm, alongside
 * the smallest grid spacing (30 cm): past it the module phases name the wrong
 * place.
 */
export function pathIntegration(config, state) {
  const noise = num(state, config, "noise", 3);
  const landmark = num(state, config, "landmark", 0);
  const rand = rng(num(state, config, "seed", 9));
  const dt = 0.05, T = 120, trials = 20;
  const every = landmark > 0 ? Math.round(landmark / dt) : 0;
  const xs = [], err = [];
  const sum = new Array(Math.round(T / dt)).fill(0);
  for (let k = 0; k < trials; k++) {
    let x = 0, est = 0;
    for (let i = 0; i < sum.length; i++) {
      const t = i * dt;
      const vel = 20 + 10 * Math.sin(t / 3 + k); // cm/s
      x += vel * dt;
      est += vel * dt + noise * Math.sqrt(dt) * gauss(rand);
      if (every > 0 && i % every === 0) est = x;
      sum[i] += Math.abs(est - x);
    }
  }
  for (let i = 0; i < sum.length; i++) { xs.push(i * dt); err.push(sum[i] / trials); }
  return [series("mean position error (cm)", xs, err), series("smallest grid spacing", [0, T], [30, 30])];
}

/**
 * HTM scalar encoder (as in the page's code): values in [0, 100] map to `n`
 * bits with a run of `w` consecutive active bits whose start moves with the
 * value. Plots the overlap (shared active bits) between the code for 50 and
 * the code for every other value: a triangle whose width is set by w / n, so
 * nearby values share bits and distant ones share none.
 */
export function scalarEncoder(config, state) {
  const n = Math.round(num(state, config, "bits", 400));
  const w = Math.round(num(state, config, "width", 21));
  const ref = num(state, config, "reference", 50);
  const start = (v) => Math.round(((Math.min(100, Math.max(0, v))) / 100) * (n - w));
  const s0 = start(ref);
  const xs = [], ys = [];
  for (let v = 0; v <= 100; v += 0.25) {
    xs.push(v);
    ys.push(Math.max(0, w - Math.abs(start(v) - s0)));
  }
  return [series(`overlap with the code for ${ref}`, xs, ys)];
}

/**
 * Evidence versus elimination when sensing is noisy (after Monty's evidence-
 * based learning module, simplified to known locations): `objects` objects
 * each store one of 8 features at each of 20 locations. A sensor visits a
 * random location of the true object each step and reports its feature,
 * replaced by a random one with probability `noise`%. Elimination drops any
 * object that ever mismatched; evidence adds +1 for a match and −1 for a
 * mismatch. Plots, over 200 trials, the share in which the true object is
 * the single best hypothesis after each step.
 */
export function evidenceInference(config, state) {
  const nObj = Math.round(num(state, config, "objects", 30));
  const noise = num(state, config, "noise", 10) / 100;
  const rand = rng(num(state, config, "seed", 21));
  const L = 20, F = 8, steps = 15, trials = 200;
  const models = Array.from({ length: nObj }, () => Array.from({ length: L }, () => Math.floor(rand() * F)));
  const evid = new Array(steps).fill(0), elim = new Array(steps).fill(0);
  for (let trial = 0; trial < trials; trial++) {
    const truth = Math.floor(rand() * nObj);
    const score = new Array(nObj).fill(0);
    const alive = new Array(nObj).fill(true);
    for (let s = 0; s < steps; s++) {
      const loc = Math.floor(rand() * L);
      const seen = rand() < noise ? Math.floor(rand() * F) : models[truth][loc];
      for (let o = 0; o < nObj; o++) {
        const match = models[o][loc] === seen;
        score[o] += match ? 1 : -1;
        if (!match) alive[o] = false;
      }
      const best = Math.max(...score);
      if (score[truth] === best && score.filter((x) => x === best).length === 1) evid[s]++;
      if (alive[truth] && alive.filter(Boolean).length === 1) elim[s]++;
    }
  }
  const xs = Array.from({ length: steps }, (_, i) => i + 1);
  return [
    series("evidence (+1 / −1)", xs, evid.map((c) => (100 * c) / trials)),
    series("strict elimination", xs, elim.map((c) => (100 * c) / trials)),
  ];
}
