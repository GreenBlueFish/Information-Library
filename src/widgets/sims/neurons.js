// src/widgets/sims/neurons.js
//
// Single-neuron simulators: each takes the widget's (config, state) and
// returns PlotSeries[] of membrane potential (mV) against time (ms). All use
// forward Euler with a step small enough for the model; inputs are a current
// step switched on at `on` and off at `off`, so the onset and the return to
// rest are both visible.

import { num, str, rng, gauss, series, curve, step } from "./util.js";

const ON = 20;

/** Leaky integrate-and-fire: tau dV/dt = -(V - EL) + R I. */
export function lif(config, state) {
  const T = num(state, config, "duration", 200);
  const I = num(state, config, "current", 2); // nA
  const tau = num(state, config, "tau", 10); // ms
  const vth = num(state, config, "threshold", -50); // mV
  const tref = num(state, config, "refractory", 2); // ms
  const R = 10, EL = -65, vreset = -70, dt = 0.05;
  const ts = [], vs = [];
  let v = EL, last = -Infinity;
  for (let t = 0; t <= T; t += dt) {
    const input = step(t, I, ON, T - ON);
    if (t - last >= tref) v += (dt / tau) * (-(v - EL) + R * input);
    if (v >= vth) {
      ts.push(t); vs.push(20); // draw the spike
      v = vreset; last = t;
    }
    ts.push(t); vs.push(v);
  }
  return [series("V (mV)", ts, vs)];
}

/** Izhikevich (2003) firing-pattern presets: a, b, c, d. */
export const IZH_PRESETS = {
  "Regular spiking": [0.02, 0.2, -65, 8],
  "Intrinsically bursting": [0.02, 0.2, -55, 4],
  "Chattering": [0.02, 0.2, -50, 2],
  "Fast spiking": [0.1, 0.2, -65, 2],
  "Low-threshold spiking": [0.02, 0.25, -65, 2],
  "Thalamo-cortical": [0.02, 0.25, -65, 0.05],
  "Resonator": [0.1, 0.26, -65, 2],
};

/** Izhikevich: v' = 0.04v^2 + 5v + 140 - u + I, u' = a(bv - u). */
export function izhikevich(config, state) {
  const T = num(state, config, "duration", 300);
  const I = num(state, config, "current", 10);
  const [a, b, c, d] = IZH_PRESETS[str(state, config, "preset", "Regular spiking")] ??
    IZH_PRESETS["Regular spiking"];
  const dt = 0.1;
  const ts = [], vs = [], us = [];
  let v = -65, u = b * v;
  for (let t = 0; t <= T; t += dt) {
    const input = step(t, I, ON, T);
    v += dt * (0.04 * v * v + 5 * v + 140 - u + input);
    u += dt * a * (b * v - u);
    if (v >= 30) {
      ts.push(t); vs.push(30); us.push(u);
      v = c; u += d;
    }
    ts.push(t); vs.push(v); us.push(u);
  }
  return [series("v (mV)", ts, vs), series("u (recovery)", ts, us)];
}

/**
 * Adaptive exponential integrate-and-fire (Brette & Gerstner 2005). With
 * `adapt` false (or a = b = 0) it is the plain exponential IF.
 */
function adexRun(config, state, adapt) {
  const T = num(state, config, "duration", 400);
  const I = num(state, config, "current", 800); // pA
  const dT = num(state, config, "deltaT", 2); // mV
  const a = adapt ? num(state, config, "a", 4) : 0; // nS
  const b = adapt ? num(state, config, "b", 80.5) : 0; // pA
  const tw = num(state, config, "tauW", 144); // ms
  const C = 281, gL = 30, EL = -70.6, VT = -50.4, Vr = num(state, config, "reset", -70.6);
  const peak = 20, dt = 0.05;
  const ts = [], vs = [], ws = [];
  let v = EL, w = 0;
  for (let t = 0; t <= T; t += dt) {
    const input = step(t, I, ON, T - ON);
    const exp = dT > 0 ? gL * dT * Math.exp(Math.min((v - VT) / dT, 30)) : 0;
    const dv = (-gL * (v - EL) + exp - w + input) / C;
    const dw = (a * (v - EL) - w) / tw;
    v += dt * dv;
    w += dt * dw;
    if (v >= peak || (dT === 0 && v >= VT)) {
      ts.push(t); vs.push(peak); ws.push(w);
      v = Vr; w += b;
    }
    ts.push(t); vs.push(v); ws.push(w);
  }
  return { ts, vs, ws };
}

export function adex(config, state) {
  const { ts, vs, ws } = adexRun(config, state, true);
  return [series("V (mV)", ts, vs), series("w / 10 (pA)", ts, ws.map((w) => w / 10))];
}

export function eif(config, state) {
  const { ts, vs } = adexRun(config, state, false);
  return [series("V (mV)", ts, vs)];
}

/** The exponential-IF current-voltage curve: the drive the membrane feels at V. */
export function eifIV(config, state) {
  const dT = num(state, config, "deltaT", 2);
  const gL = 30, EL = -70.6, VT = -50.4;
  const f = (v) => (-gL * (v - EL) + gL * dT * Math.exp(Math.min((v - VT) / Math.max(dT, 1e-3), 30))) / 1000;
  return [
    curve("exponential IF (nA)", f, -80, -40),
    curve("leak only (nA)", (v) => (-gL * (v - EL)) / 1000, -80, -40),
  ];
}

/** Hodgkin-Huxley (1952), squid axon, rest near -65 mV, I in uA/cm^2. */
export function hh(config, state) {
  const T = num(state, config, "duration", 100);
  const I = num(state, config, "current", 10);
  const gNa = num(state, config, "gNa", 120), gK = num(state, config, "gK", 36), gL = 0.3;
  const ENa = 50, EK = -77, EL = -54.387, dt = 0.01;
  const lin = (x, k) => (Math.abs(x) < 1e-7 ? k : x / (1 - Math.exp(-x / k)));
  const an = (v) => 0.01 * lin(v + 55, 10), bn = (v) => 0.125 * Math.exp(-(v + 65) / 80);
  const am = (v) => 0.1 * lin(v + 40, 10), bm = (v) => 4 * Math.exp(-(v + 65) / 18);
  const ah = (v) => 0.07 * Math.exp(-(v + 65) / 20), bh = (v) => 1 / (1 + Math.exp(-(v + 35) / 10));
  let v = -65;
  let n = an(v) / (an(v) + bn(v)), m = am(v) / (am(v) + bm(v)), h = ah(v) / (ah(v) + bh(v));
  const ts = [], vs = [], ms = [], hs = [], ns = [];
  for (let t = 0; t <= T; t += dt) {
    const input = step(t, I, 10, T - 10);
    const iNa = gNa * m ** 3 * h * (v - ENa), iK = gK * n ** 4 * (v - EK), iL = gL * (v - EL);
    v += dt * (input - iNa - iK - iL);
    n += dt * (an(v) * (1 - n) - bn(v) * n);
    m += dt * (am(v) * (1 - m) - bm(v) * m);
    h += dt * (ah(v) * (1 - h) - bh(v) * h);
    ts.push(t); vs.push(v); ms.push(m * 100); hs.push(h * 100); ns.push(n * 100);
  }
  if (str(state, config, "view", "voltage") === "gates") {
    return [series("m x100", ts, ms), series("h x100", ts, hs), series("n x100", ts, ns)];
  }
  return [series("V (mV)", ts, vs)];
}

/** FitzHugh-Nagumo: v' = v - v^3/3 - w + I, w' = eps (v + a - b w). */
export function fhn(config, state) {
  const T = num(state, config, "duration", 200);
  const I = num(state, config, "current", 0.5);
  const eps = num(state, config, "epsilon", 0.08);
  const a = 0.7, b = 0.8, dt = 0.05;
  let v = -1.2, w = -0.6;
  const ts = [], vs = [], ws = [];
  for (let t = 0; t <= T; t += dt) {
    const dv = v - v ** 3 / 3 - w + I;
    const dw = eps * (v + a - b * w);
    v += dt * dv; w += dt * dw;
    ts.push(t); vs.push(v); ws.push(w);
  }
  if (str(state, config, "view", "time") === "phase plane") {
    return [
      { label: "trajectory", points: vs.map((x, i) => ({ x, y: ws[i] })).filter((_, i) => i % 4 === 0) },
      curve("v-nullcline", (x) => x - x ** 3 / 3 + I, -2.5, 2.5),
      curve("w-nullcline", (x) => (x + a) / b, -2.5, 2.5),
    ];
  }
  return [series("v", ts, vs), series("w", ts, ws)];
}

/** Morris-Lecar (1981), Rinzel-Ermentrout Hopf parameter set. */
export function morrisLecar(config, state) {
  const T = num(state, config, "duration", 500);
  const I = num(state, config, "current", 100);
  const phi = num(state, config, "phi", 0.04);
  const C = 20, VL = -60, VCa = 120, VK = -84, gL = 2, gCa = 4.4, gK = 8;
  const V1 = -1.2, V2 = 18, V3 = 2, V4 = 30, dt = 0.05;
  const minf = (v) => 0.5 * (1 + Math.tanh((v - V1) / V2));
  const winf = (v) => 0.5 * (1 + Math.tanh((v - V3) / V4));
  const tauw = (v) => 1 / Math.cosh((v - V3) / (2 * V4));
  let v = -60, w = winf(-60);
  const ts = [], vs = [], ws = [];
  for (let t = 0; t <= T; t += dt) {
    const input = step(t, I, ON, T);
    const dv = (input - gL * (v - VL) - gCa * minf(v) * (v - VCa) - gK * w * (v - VK)) / C;
    const dw = (phi * (winf(v) - w)) / tauw(v);
    v += dt * dv; w += dt * dw;
    ts.push(t); vs.push(v); ws.push(w);
  }
  if (str(state, config, "view", "time") === "phase plane") {
    return [
      { label: "trajectory", points: vs.map((x, i) => ({ x, y: ws[i] * 100 })).filter((_, i) => i % 4 === 0) },
      curve("w-nullcline x100", (x) => winf(x) * 100, -70, 40),
      curve("V-nullcline x100", (x) => 100 * (I - gL * (x - VL) - gCa * minf(x) * (x - VCa)) / (gK * (x - VK)), -70, 40),
    ];
  }
  return [series("V (mV)", ts, vs), series("w x100", ts, ws.map((x) => x * 100))];
}

/**
 * Spike response model (SRM0): u(t) = EL + (kappa * I)(t) + sum eta(t - tf).
 * kappa is a membrane filter of the input; eta is a negative after-spike
 * kernel, so refractoriness comes from a kernel rather than a reset.
 */
export function srm(config, state) {
  const T = num(state, config, "duration", 200);
  const I = num(state, config, "current", 2.5);
  const eta0 = num(state, config, "eta0", 20); // mV
  const tauEta = num(state, config, "tauEta", 15); // ms
  const tau = 10, R = 10, EL = -65, theta = -50, dt = 0.05;
  let h = 0; // filtered input
  const spikes = [];
  const ts = [], us = [];
  for (let t = 0; t <= T; t += dt) {
    h += (dt / tau) * (-h + R * step(t, I, ON, T - ON));
    let u = EL + h;
    for (const tf of spikes) u -= eta0 * Math.exp(-(t - tf) / tauEta);
    if (u >= theta && (spikes.length === 0 || t - spikes.at(-1) > 1)) {
      spikes.push(t);
      ts.push(t); us.push(20);
    }
    ts.push(t); us.push(u);
  }
  return [series("u (mV)", ts, us), series("threshold", [0, T], [theta, theta])];
}

/** LIF driven by a step plus white noise; three trials with the same input. */
export function stochasticLif(config, state) {
  const T = num(state, config, "duration", 200);
  const I = num(state, config, "current", 1.6);
  const sigma = num(state, config, "noise", 3); // mV / sqrt(ms)
  const seed = num(state, config, "seed", 1);
  const tau = 10, R = 10, EL = -65, vth = -50, vreset = -70, dt = 0.05;
  const out = [];
  for (let trial = 0; trial < 3; trial++) {
    const rand = rng(seed * 101 + trial);
    const ts = [], vs = [];
    let v = EL;
    for (let t = 0; t <= T; t += dt) {
      v += (dt / tau) * (-(v - EL) + R * step(t, I, ON, T - ON)) + sigma * Math.sqrt(dt) * gauss(rand);
      if (v >= vth) { ts.push(t); vs.push(20); v = vreset; }
      ts.push(t); vs.push(v);
    }
    out.push(series(`trial ${trial + 1} (mV)`, ts, vs, 1000));
  }
  return out;
}

/**
 * Two-compartment neuron: a passive dendrite coupled to a spiking (LIF) soma.
 * Current is injected into the dendrite; the soma only sees what the coupling
 * conductance lets through.
 */
export function twoCompartment(config, state) {
  const T = num(state, config, "duration", 200);
  const I = num(state, config, "current", 8); // nA into the dendrite
  const gc = num(state, config, "coupling", 0.5); // relative coupling
  const tauS = 10, tauD = 20, R = 10, EL = -65, vth = -50, vreset = -65, dt = 0.05;
  let vs = EL, vd = EL;
  const ts = [], S = [], D = [];
  for (let t = 0; t <= T; t += dt) {
    const input = step(t, I, ON, T - ON);
    const dvs = (-(vs - EL) + gc * (vd - vs)) / tauS;
    const dvd = (-(vd - EL) + gc * (vs - vd) + R * input) / tauD;
    vs += dt * dvs; vd += dt * dvd;
    if (vs >= vth) { ts.push(t); S.push(20); D.push(vd); vs = vreset; }
    ts.push(t); S.push(vs); D.push(vd);
  }
  return [series("soma (mV)", ts, S), series("dendrite (mV)", ts, D)];
}

/** f-I curves: firing rate (Hz) against input current for LIF and EIF. */
export function fiCurve(config, state) {
  const tau = num(state, config, "tau", 10);
  const R = 10, EL = -65, vth = -50, vreset = -70, tref = num(state, config, "refractory", 2);
  const rate = (I) => {
    const vinf = EL + R * I;
    if (vinf <= vth) return 0;
    const tisi = tref + tau * Math.log((vinf - vreset) / (vinf - vth));
    return 1000 / tisi;
  };
  return [curve("LIF rate (Hz)", rate, 0, 5)];
}
