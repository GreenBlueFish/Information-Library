// src/widgets/sims/plasticity.js
//
// Learning-rule simulators: STDP windows and their variants, the triplet rule's
// frequency dependence, weight-dependent STDP, the voltage rule, reward-
// modulated STDP, BCM and surrogate gradients. Times are in ms.

import { num, str, curve, series } from "./util.js";

/**
 * Pair-based STDP window: weight change against dt = t_post - t_pre.
 * `variant` (state or config): classical | anti | symmetric.
 */
export function stdpWindow(config, state) {
  const Ap = num(state, config, "aPlus", 1);
  const Am = num(state, config, "aMinus", 1.05);
  const tp = num(state, config, "tauPlus", 20);
  const tm = num(state, config, "tauMinus", 20);
  const variant = str(state, config, "variant", "classical");
  const classical = (dt) => (dt > 0 ? Ap * Math.exp(-dt / tp) : dt < 0 ? -Am * Math.exp(dt / tm) : 0);
  const rules = {
    classical,
    anti: (dt) => -classical(dt),
    // Proximity in either order potentiates; wide surround depresses.
    symmetric: (dt) => Ap * Math.exp(-Math.abs(dt) / tp) - Am * 0.5 * Math.exp(-Math.abs(dt) / (3 * tm)),
  };
  const f = rules[variant] ?? classical;
  const out = [curve(`${variant} Δw`, f, -100, 100, 401)];
  if (variant !== "classical") out.push(curve("classical (reference)", classical, -100, 100, 401));
  return out;
}

/**
 * Triplet STDP (Pfister & Gerstner 2006, minimal all-to-all model, visual
 * cortex fit): total weight change after 60 pre-post pairings, against pairing
 * frequency, for dt = +10 ms and -10 ms. Pair-only STDP gives a flat line;
 * the triplet term adds LTP that grows with frequency.
 */
export function stdpTriplet(config, state) {
  const A3p = num(state, config, "a3Plus", 6.2e-3);
  const A2m = num(state, config, "a2Minus", 7e-3);
  const A2p = num(state, config, "a2Plus", 5e-10);
  const tauP = 16.8, tauM = 33.7, tauY = num(state, config, "tauY", 125);
  const pairs = 60;
  const run = (freq, delta) => {
    const period = 1000 / freq;
    const events = [];
    for (let k = 0; k < pairs; k++) {
      const tPre = k * period;
      events.push({ t: tPre, pre: true }, { t: tPre + delta, pre: false });
    }
    events.sort((a, b) => a.t - b.t || (a.pre ? -1 : 1));
    let r1 = 0, o1 = 0, o2 = 0, last = events[0].t, dw = 0;
    for (const e of events) {
      const gap = e.t - last;
      r1 *= Math.exp(-gap / tauP); o1 *= Math.exp(-gap / tauM); o2 *= Math.exp(-gap / tauY);
      last = e.t;
      if (e.pre) { dw -= o1 * A2m; r1 += 1; }
      else { dw += r1 * (A2p + A3p * o2); o1 += 1; o2 += 1; }
    }
    return dw * 100; // percent of a unit weight
  };
  const freqs = [];
  for (let f = 1; f <= 50; f += 1) freqs.push(f);
  return [
    series("pre→post +10 ms (Δw %)", freqs, freqs.map((f) => run(f, 10))),
    series("post→pre −10 ms (Δw %)", freqs, freqs.map((f) => run(f, -10))),
  ];
}

/**
 * Weight-dependent STDP (Gütig et al. 2003): Δw+ = λ (1 - w)^μ K(dt),
 * Δw- = -λ α w^μ K(dt). μ = 0 is additive, μ = 1 multiplicative. Plots the
 * change for one +10 ms and one -10 ms pairing across w in [0, 1], and their
 * sum, whose zero crossing is the stable weight.
 */
export function stdpMultiplicative(config, state) {
  const mu = num(state, config, "mu", 1);
  const alpha = num(state, config, "alpha", 1.1);
  const K = Math.exp(-10 / 20);
  const ltp = (w) => Math.pow(1 - w, mu) * K;
  const ltd = (w) => -alpha * Math.pow(w, mu) * K;
  return [
    curve("LTP (pre→post)", ltp, 0, 1),
    curve("LTD (post→pre)", ltd, 0, 1),
    curve("net drift", (w) => ltp(w) + ltd(w), 0, 1),
  ];
}

/**
 * Voltage-based rule (Clopath et al. 2010) at a held postsynaptic voltage u:
 * no change below θ−, depression between θ− and θ+, potentiation above θ+.
 */
export function stdpVoltage(config, state) {
  const thMinus = num(state, config, "thetaMinus", -70.6);
  const thPlus = num(state, config, "thetaPlus", -45.3);
  const Altd = num(state, config, "aLTD", 1.4);
  const Altp = num(state, config, "aLTP", 0.8);
  const pos = (x) => Math.max(0, x);
  const f = (u) => -Altd * pos(u - thMinus) + (Altp * pos(u - thPlus) * pos(u - thMinus)) / 10;
  return [curve("Δw rate (a.u.)", f, -80, -20, 300)];
}

/**
 * Reward-modulated STDP (Izhikevich 2007): one pre→post pairing at t = 100 ms
 * tags the synapse with an eligibility trace c; dopamine d arrives at
 * `delay`; the weight moves by the overlap of c and d.
 */
export function stdpReward(config, state) {
  const delay = num(state, config, "delay", 1000);
  const tauC = num(state, config, "tauC", 1000);
  const tauD = 200, T = 4000, dt = 1;
  let c = 0, d = 0, w = 0;
  const ts = [], C = [], D = [], W = [];
  for (let t = 0; t <= T; t += dt) {
    if (t === 100) c += 1;
    if (t === 100 + Math.round(delay)) d += 1;
    w += dt * c * d * 0.01;
    c -= (dt * c) / tauC; d -= (dt * d) / tauD;
    ts.push(t / 1000); C.push(c); D.push(d); W.push(w);
  }
  return [series("eligibility c", ts, C), series("dopamine d", ts, D), series("weight change", ts, W)];
}

/**
 * BCM: dw/dt ∝ x φ(y, θ) with φ = y (y − θ) and θ = <y>² / y0. Curves for a
 * history of low, chosen and high average activity show the threshold slide.
 */
export function bcm(config, state) {
  const avg = num(state, config, "avgActivity", 10);
  const y0 = 10;
  const phi = (th) => (y) => (y * (y - th)) / 100;
  return [
    curve(`<y> = ${avg / 2}`, phi((avg / 2) ** 2 / y0), 0, 40),
    curve(`<y> = ${avg}`, phi(avg ** 2 / y0), 0, 40),
    curve(`<y> = ${avg * 1.5}`, phi((avg * 1.5) ** 2 / y0), 0, 40),
  ];
}

/** Surrogate derivatives of the spike (Heaviside) nonlinearity, u − θ on x. */
export function surrogate(config, state) {
  const beta = num(state, config, "beta", 5);
  const sig = (x) => 1 / (1 + Math.exp(-beta * x));
  return [
    curve("spike (Heaviside)", (x) => (x >= 0 ? 1 : 0), -2, 2, 401),
    curve("fast sigmoid′", (x) => 1 / (1 + beta * Math.abs(x)) ** 2, -2, 2, 401),
    curve("sigmoid′ (scaled)", (x) => 4 * sig(x) * (1 - sig(x)), -2, 2, 401),
    curve("triangle", (x) => Math.max(0, 1 - Math.abs(x) * beta / 2), -2, 2, 401),
  ];
}
