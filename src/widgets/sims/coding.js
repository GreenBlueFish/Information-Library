// src/widgets/sims/coding.js
//
// Spike coding and population simulators: encoders, synaptic filters,
// population activity, a winner-take-all layer, and the event-driven cost
// model used on the neuromorphic page.

import { num, str, rng, gauss, raster, series, curve } from "./util.js";

/**
 * Encode six input intensities x = 1/6 .. 6/6 as spike trains over 100 ms.
 * scheme: rate (Poisson, rate ∝ x) | latency (one spike, earlier for larger
 * x, the LIF time-to-first-spike) | population (Gaussian receptive fields
 * over one value, each row a neuron).
 */
export function encoding(config, state) {
  const scheme = str(state, config, "scheme", "rate");
  const maxRate = num(state, config, "maxRate", 100); // Hz
  const value = num(state, config, "value", 0.5);
  const rand = rng(num(state, config, "seed", 7));
  const T = 100, dt = 1, rows = 6;
  const trains = [];
  for (let i = 0; i < rows; i++) {
    const x = (i + 1) / rows;
    const times = [];
    if (scheme === "latency") {
      // tau ln(x / (x - θ)) with θ = 0.1, tau = 20 ms
      times.push(20 * Math.log(x / (x - 0.1)));
    } else {
      // rate coding uses the row's own intensity; population coding uses one
      // value seen through six Gaussian tuning curves
      const r = scheme === "population"
        ? maxRate * Math.exp(-((value - i / (rows - 1)) ** 2) / (2 * 0.15 ** 2))
        : maxRate * x;
      for (let t = 0; t < T; t += dt) if (rand() < (r * dt) / 1000) times.push(t);
    }
    trains.push(times);
  }
  const label = scheme === "population"
    ? (i) => `pref ${(i / (rows - 1)).toFixed(1)}`
    : (i) => `x = ${((i + 1) / rows).toFixed(2)}`;
  return raster(trains, T, label);
}

/**
 * Synaptic filters: the postsynaptic current a fixed spike train produces
 * through an exponential, alpha or difference-of-exponentials kernel.
 */
export function synapticFilter(config, state) {
  const tau = num(state, config, "tau", 5);
  const kernel = str(state, config, "kernel", "exponential");
  const spikes = [10, 30, 35, 40, 80, 82, 84, 86, 88, 130];
  const T = 160, dt = 0.1;
  const k = {
    exponential: (s) => Math.exp(-s / tau) / tau,
    alpha: (s) => (s / (tau * tau)) * Math.exp(-s / tau),
    "double exponential": (s) => (Math.exp(-s / tau) - Math.exp(-s / (tau / 4))) / (tau - tau / 4),
  }[kernel] ?? ((s) => Math.exp(-s / tau) / tau);
  const ts = [], ys = [];
  for (let t = 0; t <= T; t += dt) {
    let y = 0;
    for (const sp of spikes) if (t >= sp) y += k(t - sp);
    ts.push(t); ys.push(y);
  }
  const ticks = { label: "input spikes", points: [] };
  for (const sp of spikes) ticks.points.push({ x: sp, y: 0 }, { x: sp, y: -0.05 }, { x: sp, y: 0 });
  return [series(`${kernel} filtered (1/ms)`, ts, ys), ticks];
}

/**
 * Population activity A(t) of N noisy LIF neurons sharing a step input:
 * spikes per neuron per second, in 2 ms bins. Noise desynchronises the
 * population so A(t) settles instead of ringing.
 */
export function population(config, state) {
  const N = Math.round(num(state, config, "neurons", 200));
  const I = num(state, config, "current", 1.8);
  const sigma = num(state, config, "noise", 2);
  const rand = rng(num(state, config, "seed", 3));
  const T = 200, dt = 0.1, bin = 2, tau = 10, R = 10, EL = -65, vth = -50, vr = -65;
  const v = Array.from({ length: N }, () => EL + 5 * rand());
  const counts = new Array(Math.ceil(T / bin)).fill(0);
  for (let s = 0; s * dt < T; s++) {
    const t = s * dt;
    const input = t >= 50 ? I : 0;
    for (let i = 0; i < N; i++) {
      v[i] += (dt / tau) * (-(v[i] - EL) + R * input) + sigma * Math.sqrt(dt) * gauss(rand);
      if (v[i] >= vth) { v[i] = vr; counts[Math.floor(t / bin)]++; }
    }
  }
  const ts = counts.map((_, i) => i * bin);
  return [series("A(t) (Hz)", ts, counts.map((c) => (c / N / bin) * 1000))];
}

/**
 * Winner-take-all layer: six LIF neurons receive inputs of slightly different
 * strength plus shared lateral inhibition. Raise inhibition and only the most
 * strongly driven neurons keep firing: a sparse code.
 */
export function winnerTakeAll(config, state) {
  const inh = num(state, config, "inhibition", 3);
  const drive = num(state, config, "drive", 2);
  const T = 200, dt = 0.1, tau = 10, tauI = 5, R = 10, EL = -65, vth = -50, vr = -70, n = 6;
  const gains = [1, 0.97, 0.94, 0.91, 0.88, 0.85];
  const v = new Array(n).fill(EL);
  let g = 0; // shared inhibitory conductance-like trace (mV)
  const trains = Array.from({ length: n }, () => []);
  for (let t = 0; t < T; t += dt) {
    let fired = 0;
    for (let i = 0; i < n; i++) {
      v[i] += (dt / tau) * (-(v[i] - EL) + R * drive * gains[i] - g);
      if (v[i] >= vth) { v[i] = vr; trains[i].push(t); fired++; }
    }
    g += fired * inh * 10 - (dt * g) / tauI;
  }
  return raster(trains, T, (i) => `input ${gains[i].toFixed(2)}`);
}

/**
 * Synaptic operations per time step for a network of N neurons with fan-out
 * F: clock-driven hardware touches every synapse each step; event-driven
 * hardware touches only the synapses of neurons that spiked.
 */
export function eventDriven(config, state) {
  const N = num(state, config, "neurons", 1000);
  const F = num(state, config, "fanout", 100);
  const dtMs = 1;
  const dense = (rate) => (N * F) / 1e3; // thousands of ops per step
  const sparse = (rate) => (N * F * rate * dtMs) / 1000 / 1e3;
  return [
    curve("clock-driven (k ops/step)", dense, 0, 200),
    curve("event-driven (k ops/step)", sparse, 0, 200),
  ];
}
