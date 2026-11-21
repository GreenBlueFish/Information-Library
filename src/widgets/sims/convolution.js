// src/widgets/sims/convolution.js
//
// The maths behind the `convolution-3d` and `conv-sequence` widgets (Math ›
// Convolution). Pure functions, no DOM.
//
// Continuous signals are causal-ish pieces kept as a smooth part f(t) that is
// zero outside [s0, s1], plus a list of impulses [t₀, w] (w·δ(t − t₀)). The
// convolution
//
//   y(t) = (x * h)(t) = ∫ x(τ) h(t − τ) dτ
//
// is then
//   - smooth * smooth: an integral, done piece by piece between the kinks of
//     both signals (Simpson's rule on each piece, so jumps cost nothing);
//   - smooth * impulse w·δ(t − t₀): w times the smooth part moved to t₀;
//   - impulse * impulse: an impulse at the sum of the times, weights multiplied.
// The tests check the integral against closed forms (pulse * pulse is a
// trapezoid, pulse * exponential is a charging curve, and so on).
//
// Sequences for `conv-sequence` are plain arrays starting at n = 0.

/** The names the widget's `x` and `h` selects may use, in menu order. */
export const SIGNALS = [
  "pulse, 1 s wide",
  "pulse, 2 s wide",
  "triangle, 2 s wide",
  "ramp, 1 s long",
  "decaying exponential e^(−at)u(t)",
  "damped sine e^(−at)sin(2πt)u(t)",
  "unit step u(t)",
  "Gaussian bump",
  "unit impulse δ(t)",
  "echo δ(t) + 0.5·δ(t − 1.5)",
];

/** Width (standard deviation) and centre of the Gaussian bump, in seconds. */
export const G_SIGMA = 0.25, G_MID = 1;

/**
 * One signal.
 * @param {string} name one of SIGNALS
 * @param {number} a decay rate for the exponential and the damped sine (1/s)
 * @returns {{ name, f: (t) => number, imp: Array<[number, number]>, s0: number, s1: number,
 *   breaks: number[], area: number, peak: number, text: string, formula: string }}
 */
export function cSignal(name, a = 1) {
  const box = (lo, hi, g) => (t) => (t >= lo && t < hi ? g(t) : 0);
  switch (name) {
    case "pulse, 1 s wide":
      return { name, f: box(0, 1, () => 1), imp: [], s0: 0, s1: 1, breaks: [0, 1], area: 1, peak: 1,
        text: "1 from t = 0 to t = 1 s, 0 elsewhere", formula: "u(t) − u(t − 1)" };
    case "pulse, 2 s wide":
      return { name, f: box(0, 2, () => 1), imp: [], s0: 0, s1: 2, breaks: [0, 2], area: 2, peak: 1,
        text: "1 from t = 0 to t = 2 s, 0 elsewhere", formula: "u(t) − u(t − 2)" };
    case "triangle, 2 s wide":
      return { name, f: box(0, 2, (t) => 1 - Math.abs(t - 1)), imp: [], s0: 0, s1: 2, breaks: [0, 1, 2], area: 1, peak: 1,
        text: "rising from 0 at t = 0 to 1 at t = 1 s and back to 0 at t = 2 s", formula: "1 − |t − 1| for 0 ≤ t ≤ 2" };
    case "ramp, 1 s long":
      return { name, f: box(0, 1, (t) => t), imp: [], s0: 0, s1: 1, breaks: [0, 1], area: 0.5, peak: 1,
        text: "rising from 0 to 1 over the first second, then dropping to 0", formula: "t for 0 ≤ t < 1" };
    case "decaying exponential e^(−at)u(t)":
      return { name, f: (t) => (t >= 0 ? Math.exp(-a * t) : 0), imp: [], s0: 0, s1: Infinity, breaks: [0],
        area: a > 0 ? 1 / a : Infinity, peak: 1,
        text: `1 at t = 0, falling by a factor e every ${fmtN(1 / a)} s`, formula: `e^(−${coef(a)}t)u(t)` };
    case "damped sine e^(−at)sin(2πt)u(t)": {
      const w = 2 * Math.PI;
      return { name, f: (t) => (t >= 0 ? Math.exp(-a * t) * Math.sin(w * t) : 0), imp: [], s0: 0, s1: Infinity, breaks: [0],
        area: a > 0 ? w / (a * a + w * w) : NaN, peak: 1,
        text: `a 1 Hz sine that starts at t = 0 and dies away at rate a = ${fmtN(a)}/s`, formula: `e^(−${coef(a)}t)sin(2πt)u(t)` };
    }
    case "unit step u(t)":
      return { name, f: (t) => (t >= 0 ? 1 : 0), imp: [], s0: 0, s1: Infinity, breaks: [0], area: Infinity, peak: 1,
        text: "0 before t = 0 and 1 for ever after", formula: "u(t)" };
    case "Gaussian bump": {
      const lo = G_MID - 6 * G_SIGMA, hi = G_MID + 6 * G_SIGMA;
      return { name, f: box(lo, hi, (t) => Math.exp(-((t - G_MID) ** 2) / (2 * G_SIGMA * G_SIGMA))), imp: [], s0: lo, s1: hi,
        breaks: [lo, G_MID, hi], area: G_SIGMA * Math.sqrt(2 * Math.PI), peak: 1,
        text: `a bell curve of height 1 centred on t = ${G_MID} s with standard deviation ${G_SIGMA} s`,
        formula: `e^(−(t − ${G_MID})²/(2·${G_SIGMA}²))` };
    }
    case "unit impulse δ(t)":
      return { name, f: () => 0, imp: [[0, 1]], s0: 0, s1: 0, breaks: [], area: 1, peak: 1,
        text: "a single spike of area 1 at t = 0", formula: "δ(t)" };
    case "echo δ(t) + 0.5·δ(t − 1.5)":
      return { name, f: () => 0, imp: [[0, 1], [1.5, 0.5]], s0: 0, s1: 1.5, breaks: [], area: 1.5, peak: 1,
        text: "a spike of area 1 at t = 0 and an echo of area 0.5 at t = 1.5 s", formula: "δ(t) + 0.5·δ(t − 1.5)" };
    default:
      throw new Error(`unknown signal: ${name}`);
  }
}

function coef(a) {
  return Math.abs(a - 1) < 1e-9 ? "" : fmtN(a);
}

function fmtN(x) {
  return String(Number(x.toFixed(2))).replace("-", "−");
}

/** True if the signal has a smooth part (anything besides impulses). */
export const hasSmooth = (s) => s.breaks.length > 0;

/** Simpson's rule on [lo, hi] with n (even) panels. */
function simpson(g, lo, hi, n = 48) {
  if (!(hi > lo)) return 0;
  const d = (hi - lo) / n;
  let s = g(lo) + g(hi);
  for (let i = 1; i < n; i++) s += (i % 2 ? 4 : 2) * g(lo + i * d);
  return (s * d) / 3;
}

/**
 * The smooth part of y(t) = (x * h)(t): everything except impulse × impulse.
 * @param {ReturnType<typeof cSignal>} x
 * @param {ReturnType<typeof cSignal>} h
 * @param {number} t
 */
export function convolve(x, h, t) {
  let y = 0;
  if (hasSmooth(x) && hasSmooth(h)) {
    // x(τ) ≠ 0 needs s0x ≤ τ ≤ s1x; h(t − τ) ≠ 0 needs t − s1h ≤ τ ≤ t − s0h.
    const lo = Math.max(x.s0, t - h.s1), hi = Math.min(x.s1, t - h.s0);
    if (hi > lo) {
      const cuts = [lo, hi];
      for (const b of x.breaks) if (b > lo && b < hi) cuts.push(b);
      for (const b of h.breaks) if (t - b > lo && t - b < hi) cuts.push(t - b);
      cuts.sort((p, q) => p - q);
      // Read each piece just inside its ends, so a jump exactly at a cut uses the value on this side.
      for (let i = 0; i + 1 < cuts.length; i++) {
        const p = cuts[i], q = cuts[i + 1];
        if (q - p < 1e-12) continue;
        const e = (q - p) * 1e-9;
        const panels = 2 * Math.max(24, Math.ceil((q - p) * 40));
        y += simpson((tau) => x.f(Math.min(q - e, Math.max(p + e, tau))) * h.f(t - Math.min(q - e, Math.max(p + e, tau))), p, q, panels);
      }
    }
  }
  for (const [t0, w] of x.imp) y += w * h.f(t - t0);
  for (const [t1, w] of h.imp) y += w * x.f(t - t1);
  return y;
}

/** The impulses in y: one at t₀ + t₁ for each pair, weights multiplied (equal times merged). */
export function outImpulses(x, h) {
  const out = new Map();
  for (const [t0, w0] of x.imp) for (const [t1, w1] of h.imp) {
    const k = Math.round((t0 + t1) * 1e6) / 1e6;
    out.set(k, (out.get(k) ?? 0) + w0 * w1);
  }
  return [...out.entries()].sort((p, q) => p[0] - q[0]);
}

/**
 * The integrand x(τ)·h(t − τ) along τ for a fixed t (the "flip and slide" slice).
 * @returns {{ vals: number[], arrows: Array<[number, number]> }} vals at each τ in taus;
 *   arrows are impulses in τ, as [τ, weight].
 */
export function sliceAtT(x, h, t, taus) {
  const vals = taus.map((tau) => x.f(tau) * h.f(t - tau));
  const arrows = [];
  for (const [t0, w] of x.imp) { const v = w * h.f(t - t0); if (Math.abs(v) > 1e-12) arrows.push([t0, v]); }
  for (const [t1, w] of h.imp) { const v = w * x.f(t - t1); if (Math.abs(v) > 1e-12) arrows.push([t - t1, v]); }
  return { vals, arrows };
}

/**
 * The same surface read the other way: x(τ)·h(t − τ) along t for a fixed τ, a
 * copy of h started at τ and scaled by x(τ) (the "echoes" slice).
 * @returns {{ vals: number[], arrows: Array<[number, number]> }} arrows are impulses in t.
 */
export function sliceAtTau(x, h, tau, ts) {
  const xv = x.f(tau);
  const vals = ts.map((t) => xv * h.f(t - tau));
  const arrows = [];
  for (const [t1, w] of h.imp) if (Math.abs(xv * w) > 1e-12) arrows.push([tau + t1, xv * w]);
  return { vals, arrows };
}

/** Where y can be non-zero: [s0x + s0h, s1x + s1h]. */
export function outSupport(x, h) {
  return [x.s0 + h.s0, x.s1 + h.s1];
}

/**
 * Where the product x(τ)·h(t − τ) lives at time t: a stretch of τ where both
 * smooth parts can be non-zero (or null), and the τ of each spike (an impulse
 * of one signal meeting a non-zero value of the other).
 */
export function productSupport(x, h, t) {
  let range = null;
  if (hasSmooth(x) && hasSmooth(h)) {
    const lo = Math.max(x.s0, t - h.s1), hi = Math.min(x.s1, t - h.s0);
    if (hi > lo) range = [lo, hi];
  }
  const spikes = sliceAtT(x, h, t, []).arrows.map(([tau]) => tau).sort((p, q) => p - q);
  return { range, spikes };
}

/** The overlap of x(τ) and h(t − τ) on the τ axis at time t, or null. */
export function overlap(x, h, t) {
  const lo = Math.max(x.s0, t - h.s1), hi = Math.min(x.s1, t - h.s0);
  return hi >= lo ? [lo, hi] : null;
}

// --- sequences (conv-sequence) -----------------------------------------------

/** Preset sequences for the `conv-sequence` selects: label → samples from n = 0. */
export const SEQUENCES = {
  "1, 2, 3": [1, 2, 3],
  "1, 1, 1, 1": [1, 1, 1, 1],
  "1, 2, 1": [1, 2, 1],
  "impulse: 1": [1],
  "delay by one: 0, 1": [0, 1],
  "two-point average: 0.5, 0.5": [0.5, 0.5],
  "difference: 1, −1": [1, -1],
  "echo: 1, 0, 0, 0.5": [1, 0, 0, 0.5],
  "a die: 1/6 at n = 1 … 6": [0, 1 / 6, 1 / 6, 1 / 6, 1 / 6, 1 / 6, 1 / 6],
  "3, 1, 4, 1, 5": [3, 1, 4, 1, 5],
};
export const SEQUENCE_NAMES = Object.keys(SEQUENCES);

/** Discrete convolution y[n] = Σ_k x[k] h[n − k], n = 0 … len(x) + len(h) − 2. */
export function dconv(x, h) {
  if (!x.length || !h.length) return [];
  const y = new Array(x.length + h.length - 1).fill(0);
  for (let k = 0; k < x.length; k++) for (let m = 0; m < h.length; m++) y[k + m] += x[k] * h[m];
  return y;
}

/** The terms x[k]·h[n − k] that make up y[n], as { k, xk, hk, p }. */
export function dterms(x, h, n) {
  const out = [];
  for (let k = 0; k < x.length; k++) {
    const m = n - k;
    if (m >= 0 && m < h.length) out.push({ k, xk: x[k], hk: h[m], p: x[k] * h[m] });
  }
  return out;
}

/** A number for display: up to 3 decimals, fractions of 6 and 36 kept short, real minus sign. */
export function nfmt(v) {
  if (Math.abs(v) < 1e-12) return "0";
  if (Math.abs(Number(v.toFixed(3)) - v) < 1e-12) return String(Number(v.toFixed(3))).replace("-", "−");
  for (const d of [6, 36]) {
    const k = Math.round(v * d);
    if (Math.abs(v * d - k) < 1e-9 && Math.abs(v - Math.round(v)) > 1e-9) {
      const g = gcd(Math.abs(k), d);
      return `${k < 0 ? "−" : ""}${Math.abs(k) / g}/${d / g}`;
    }
  }
  return String(Number(v.toFixed(3))).replace("-", "−");
}
function gcd(p, q) { return q ? gcd(q, p % q) : p; }
