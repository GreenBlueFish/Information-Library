// src/widgets/sims/laplace.js
//
// The maths behind the `s-surface` widget (Math › The Laplace Transform). Pure
// functions, no DOM, so the tests can check every transform against a direct
// numerical integral of x(t) e^(−st) inside its region of convergence.
//
// Each signal gives X(s) as a function (two of them, the delay and the pulse,
// are not ratios of polynomials), plus its poles and zeros for drawing and,
// when X is rational, the factored form
//
//   X(s) = gain · Π (s − zero_k) / Π (s − pole_k)
//
// so |X| can be read with a ruler. The region of convergence (ROC) is a
// vertical strip lo < Re s < hi (lo = −Infinity or hi = Infinity for a
// half-plane, both infinite for the whole plane).
//
// x(t) is split into a smooth part `x(t)` and a list of impulses
// [{ at, weight }] (δ functions), so the integral and the plot can treat the
// impulses exactly.

import { C } from "./ztransform.js";
export { C };

/** e^w for complex w. */
export const cexp = (w) => C.polar(Math.exp(w[0]), w[1]);

/** The names the widget's `signal` select may use, in menu order. */
export const SIGNALS = [
  "unit impulse δ(t)",
  "delayed impulse δ(t−1)",
  "unit step u(t)",
  "decaying exponential e^(−at)u(t)",
  "left-sided exponential −e^(−at)u(−t)",
  "two-sided exponential e^(−a|t|)",
  "ramped exponential t·e^(−at)u(t)",
  "damped cosine e^(−at)cos(ω₀t)u(t)",
  "damped sine e^(−at)sin(ω₀t)u(t)",
  "3-second pulse u(t)−u(t−3)",
  "notch filter (s²+ω₀²)/(s²+(ω₀/2)s+ω₀²)",
];

/** Width of the pulse signal, in seconds. */
export const PULSE = 3;

const f2 = (x) => {
  const v = Math.abs(x) < 5e-3 ? 0 : x;
  return Number(v.toFixed(2)).toString().replace("-", "−");
};
/** "s + a" written without a doubled sign. */
const sPlus = (a) => (Math.abs(a) < 5e-3 ? "s" : a < 0 ? `s − ${f2(-a)}` : `s + ${f2(a)}`);
const tExp = (a) => (Math.abs(a) < 5e-3 ? "" : `e^(${a > 0 ? "−" : ""}${f2(Math.abs(a))}t)`);

/**
 * Everything the widget and the pages need to know about one signal.
 *
 * @param {string} name one of SIGNALS
 * @param {number} a    decay rate a (1/s); negative a means growth
 * @param {number} w0   angular frequency ω₀ (rad/s)
 */
export function sSignal(name, a = 0.5, w0 = 1.5) {
  const base = { name, uses: [], rightSided: true, leftSided: false, finite: false, rational: true, impulses: [] };
  const roc = (lo, hi) => ({ lo, hi, empty: !(lo < hi) });
  const step = (t) => (t >= 0 ? 1 : 0);
  const rat = (gain, zeros, poles) => ({
    gain, zeros, poles,
    X: (s) => {
      let num = [gain, 0];
      for (const q of zeros) num = C.mul(num, C.sub(s, q));
      let den = [1, 0];
      for (const q of poles) den = C.mul(den, C.sub(s, q));
      if (C.abs(den) < 1e-300) return [Infinity, Infinity];
      return C.div(num, den);
    },
  });
  switch (name) {
    case "unit impulse δ(t)":
      return { ...base, finite: true, x: () => 0, impulses: [{ at: 0, weight: 1 }], ...rat(1, [], []),
        roc: roc(-Infinity, Infinity), time: "x(t) = δ(t): a single unit impulse at t = 0",
        formula: "X(s) = 1", rocText: "every s (the whole plane)" };
    case "delayed impulse δ(t−1)":
      return { ...base, finite: true, rational: false, x: () => 0, impulses: [{ at: 1, weight: 1 }],
        zeros: [], poles: [], gain: 1, X: (s) => cexp([-s[0], -s[1]]),
        roc: roc(-Infinity, Infinity), time: "x(t) = δ(t − 1): a unit impulse at t = 1",
        formula: "X(s) = e^(−s)", rocText: "every s (the whole plane)",
        note: "e^(−s) has no poles or zeros: its size e^(−σ) depends only on how far left or right s is." };
    case "unit step u(t)":
      return { ...base, x: step, ...rat(1, [], [[0, 0]]), roc: roc(0, Infinity),
        time: "x(t) = 1 for t ≥ 0", formula: "X(s) = 1/s", rocText: "Re s > 0" };
    case "decaying exponential e^(−at)u(t)":
      return { ...base, uses: ["a"], x: (t) => (t >= 0 ? Math.exp(-a * t) : 0), ...rat(1, [], [[-a, 0]]),
        roc: roc(-a, Infinity), time: `x(t) = ${tExp(a) || "1"} for t ≥ 0`,
        formula: `X(s) = 1/(${sPlus(a)})`, rocText: `Re s > ${f2(-a)}` };
    case "left-sided exponential −e^(−at)u(−t)":
      return { ...base, uses: ["a"], rightSided: false, leftSided: true, x: (t) => (t < 0 ? -Math.exp(-a * t) : 0),
        ...rat(1, [], [[-a, 0]]), roc: roc(-Infinity, -a),
        time: `x(t) = −${tExp(a) || "1"} for t < 0, 0 for t ≥ 0`,
        formula: `X(s) = 1/(${sPlus(a)})`, rocText: `Re s < ${f2(-a)}` };
    case "two-sided exponential e^(−a|t|)":
      return { ...base, uses: ["a"], rightSided: false, x: (t) => Math.exp(-a * Math.abs(t)),
        ...rat(-2 * a, [], [[a, 0], [-a, 0]]), roc: roc(-a, a),
        time: `x(t) = ${a === 0 ? "1" : `e^(−${f2(a)}|t|)`} for every t`,
        formula: `X(s) = ${f2(2 * a)}/(${f2(a * a)} − s²) = ${f2(-2 * a)}/((${sPlus(-a)})(${sPlus(a)}))`,
        rocText: a > 0 ? `${f2(-a)} < Re s < ${f2(a)}` : "no s at all: with a ≤ 0 the signal does not decay in either direction",
        note: a > 0 ? "" : `With a ≤ 0 this transform does not exist; the faded surface is only the formula${Math.abs(a) < 1e-9 ? ", whose constant is 0 at a = 0, so it lies flat on the floor" : ""}.` };
    case "ramped exponential t·e^(−at)u(t)":
      return { ...base, uses: ["a"], x: (t) => (t >= 0 ? t * Math.exp(-a * t) : 0), ...rat(1, [], [[-a, 0], [-a, 0]]),
        roc: roc(-a, Infinity), time: `x(t) = t·${tExp(a) || "1"} for t ≥ 0`.replace("·1 ", " "),
        formula: `X(s) = 1/(${sPlus(a)})²`, rocText: `Re s > ${f2(-a)}` };
    case "damped cosine e^(−at)cos(ω₀t)u(t)":
      return { ...base, uses: ["a", "w0"], x: (t) => (t >= 0 ? Math.exp(-a * t) * Math.cos(w0 * t) : 0),
        ...rat(1, [[-a, 0]], [[-a, w0], [-a, -w0]]), roc: roc(-a, Infinity),
        time: `x(t) = ${tExp(a) ? tExp(a) + "·" : ""}cos(${f2(w0)}t) for t ≥ 0`,
        formula: `X(s) = (${sPlus(a)})/((${sPlus(a)})² + ${f2(w0 * w0)})`, rocText: `Re s > ${f2(-a)}`,
        note: Math.abs(w0) < 1e-9 ? `At ω₀ = 0 the zero at ${f2(-a)} cancels one of the two poles there, and the signal is just ${tExp(a) || "1"}·u(t).` : "" };
    case "damped sine e^(−at)sin(ω₀t)u(t)":
      return { ...base, uses: ["a", "w0"], x: (t) => (t >= 0 ? Math.exp(-a * t) * Math.sin(w0 * t) : 0),
        ...rat(w0, [], [[-a, w0], [-a, -w0]]), roc: roc(-a, Infinity),
        time: `x(t) = ${tExp(a) ? tExp(a) + "·" : ""}sin(${f2(w0)}t) for t ≥ 0`,
        formula: `X(s) = ${f2(w0)}/((${sPlus(a)})² + ${f2(w0 * w0)})`, rocText: `Re s > ${f2(-a)}`,
        note: Math.abs(w0) < 1e-9 ? "At ω₀ = 0 the signal is 0 for every t, so X(s) = 0 everywhere; the poles are drawn where they sit for small ω₀." : "" };
    case "3-second pulse u(t)−u(t−3)": {
      const zeros = [];
      for (let k = -3; k <= 3; k++) if (k !== 0) zeros.push([0, (2 * Math.PI * k) / PULSE]);
      return { ...base, finite: true, rational: false, x: (t) => (t >= 0 && t < PULSE ? 1 : 0), zeros, poles: [], gain: 1,
        X: (s) => {
          if (C.abs(s) < 1e-9) return [PULSE, 0];
          return C.div(C.sub([1, 0], cexp([-PULSE * s[0], -PULSE * s[1]])), s);
        },
        roc: roc(-Infinity, Infinity), time: "x(t) = 1 for 0 ≤ t < 3, 0 everywhere else",
        formula: "X(s) = (1 − e^(−3s))/s", rocText: "every s (the whole plane)",
        note: "Its zeros sit on the jω axis at ω = 2πk/3 (k = ±1, ±2, …; only those in view are drawn); at s = 0 the zero of the top cancels the 1/s, and X(0) = 3, the area of the pulse." };
    }
    case "notch filter (s²+ω₀²)/(s²+(ω₀/2)s+ω₀²)": {
      const b = w0 / 2; // ω₀/Q with Q = 2
      const wd = Math.sqrt(Math.max(0, w0 * w0 - (b * b) / 4));
      const smooth = (t) => {
        if (t < 0 || w0 === 0) return 0;
        return -b * Math.exp(-b * t / 2) * (Math.cos(wd * t) - (b / (2 * wd)) * Math.sin(wd * t));
      };
      return { ...base, uses: ["w0"], x: smooth, impulses: [{ at: 0, weight: 1 }],
        ...rat(1, [[0, w0], [0, -w0]], [[-b / 2, wd], [-b / 2, -wd]]), roc: roc(-b / 2, Infinity),
        time: `x(t) = δ(t) − ${f2(b)}·e^(−${f2(b / 2)}t)[cos(${f2(wd)}t) − ${f2(b / (2 * wd || 1))}·sin(${f2(wd)}t)] for t ≥ 0`,
        formula: `X(s) = (s² + ${f2(w0 * w0)})/(s² + ${f2(b) === "1" ? "" : f2(b)}s + ${f2(w0 * w0)})`, rocText: `Re s > ${f2(-b / 2)}`,
        note: w0 === 0 ? "At ω₀ = 0 the zeros and poles all meet at s = 0 and cancel: X(s) = 1." : "" };
    }
    default:
      throw new Error(`unknown signal "${name}"`);
  }
}

/** X(s) for the signal. Returns [re, im]; Infinity components at a pole. */
export function evalX(sig, s) {
  return sig.X(s);
}

/** |X(s)|, with Infinity at a pole. */
export function magX(sig, s) {
  const v = sig.X(s);
  return Number.isFinite(v[0]) ? C.abs(v) : Infinity;
}

/** True when s lies in the region of convergence. */
export function inRoc(sig, s) {
  return !sig.roc.empty && s[0] > sig.roc.lo && s[0] < sig.roc.hi;
}

/**
 * The defining integral ∫ x(t) e^(−st) dt over [tMin, tMax], by the trapezoid
 * rule on a grid that has the signal's jumps (t = 0 and t = 3) as nodes, plus
 * every impulse exactly. Inside the ROC this converges to evalX.
 */
export function directIntegral(sig, s, tMin = -80, tMax = 80, dt = 1e-3) {
  let acc = [0, 0];
  const term = (t) => C.mul([sig.x(t), 0], cexp([-s[0] * t, -s[1] * t]));
  // Integrate piece by piece so a jump at a node is averaged, not smeared.
  const breaks = [tMin, 0, PULSE, tMax].filter((b) => b >= tMin && b <= tMax);
  for (let i = 0; i + 1 < breaks.length; i++) {
    const a = breaks[i], b = breaks[i + 1];
    const n = Math.max(1, Math.round((b - a) / dt)), h = (b - a) / n;
    // The end values are taken just inside the piece.
    const eps = 1e-12;
    let sum = C.add(C.mul(term(a + eps), [0.5, 0]), C.mul(term(b - eps), [0.5, 0]));
    for (let k = 1; k < n; k++) sum = C.add(sum, term(a + k * h));
    acc = C.add(acc, C.mul(sum, [h, 0]));
  }
  for (const imp of sig.impulses) acc = C.add(acc, C.mul([imp.weight, 0], cexp([-s[0] * imp.at, -s[1] * imp.at])));
  return acc;
}

/** Height of the surface: decibels (20·log10|X|) or plain magnitude, clipped to the view. */
export const HEIGHT = {
  decibels: { lo: -30, hi: 30, unit: "dB", of: (m) => (m === 0 ? -Infinity : 20 * Math.log10(m)) },
  magnitude: { lo: 0, hi: 5, unit: "", of: (m) => m },
};

export function heightAt(sig, s, mode = "decibels") {
  const h = HEIGHT[mode] ?? HEIGHT.decibels;
  const v = h.of(magX(sig, s));
  if (v === Infinity || v > h.hi) return h.hi;
  if (!(v > h.lo)) return h.lo;
  return v;
}

/**
 * The geometric reading of |X| at s for a rational X: |gain| times the
 * distances from each zero to s over the distances from each pole to s.
 * Returns null for the two signals that are not rational.
 */
export function geometric(sig, s) {
  if (!sig.rational) return null;
  const zd = sig.zeros.map((q) => C.abs(C.sub(s, q)));
  const pd = sig.poles.map((q) => C.abs(C.sub(s, q)));
  const num = zd.reduce((p, q) => p * q, Math.abs(sig.gain));
  const den = pd.reduce((p, q) => p * q, 1);
  return { zeroDistances: zd, poleDistances: pd, value: den === 0 ? Infinity : num / den };
}

/**
 * Is the Fourier transform defined (jω axis inside the ROC)? Is the signal
 * stable as an impulse response? Is it causal?
 */
export function verdict(sig) {
  const onAxis = !sig.roc.empty && sig.roc.lo < 0 && sig.roc.hi > 0;
  const edge = !sig.roc.empty && (sig.roc.lo === 0 || sig.roc.hi === 0);
  const causal = sig.rightSided && [-0.5, -1, -2, -5].every((t) => sig.x(t) === 0) && sig.impulses.every((i) => i.at >= 0);
  return {
    stable: onAxis,
    causal,
    fourier: onAxis ? "exists" : edge ? "exists only in a limiting sense (the jω axis is the edge of the ROC)" : "does not exist",
    maxRe: sig.poles.reduce((m, q) => Math.max(m, q[0]), -Infinity),
  };
}

export { withMultiplicity } from "./ztransform.js";
