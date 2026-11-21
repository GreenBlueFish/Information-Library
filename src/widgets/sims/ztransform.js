// src/widgets/sims/ztransform.js
//
// The maths behind the `z-surface` widget (Math › The Z-Transform). Pure
// functions, no DOM, so the tests can check every transform against a direct
// numerical sum of x[n] z^-n inside its region of convergence.
//
// Every signal here has a rational transform, kept in factored form:
//
//   X(z) = gain · Π (z − zero_k) / Π (z − pole_k)
//
// with the region of convergence (ROC) an annulus inner < |z| < outer
// (outer = Infinity for "everything outside a circle"; inner = 0 with
// `includesZero` false means "every z except 0").

/** A complex number as [re, im]. */
export const C = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1]],
  mul: (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]],
  div: (a, b) => {
    const d = b[0] * b[0] + b[1] * b[1];
    return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d];
  },
  abs: (a) => Math.hypot(a[0], a[1]),
  arg: (a) => Math.atan2(a[1], a[0]),
  polar: (r, t) => [r * Math.cos(t), r * Math.sin(t)],
  pow: (a, n) => {
    // Integer powers (negative allowed), by repeated multiplication/division.
    let out = [1, 0];
    const k = Math.abs(n);
    for (let i = 0; i < k; i++) out = C.mul(out, a);
    return n < 0 ? C.div([1, 0], out) : out;
  },
};

/** The names the widget's `signal` select may use, in menu order. */
export const SIGNALS = [
  "unit impulse δ[n]",
  "delayed impulse δ[n−2]",
  "unit step u[n]",
  "decaying exponential rⁿu[n]",
  "left-sided exponential −rⁿu[−n−1]",
  "two-sided exponential r^|n|",
  "ramped exponential n·rⁿu[n]",
  "damped cosine rⁿcos(θn)u[n]",
  "damped sine rⁿsin(θn)u[n]",
  "8-sample pulse u[n]−u[n−8]",
  "notch filter δ[n]−2cosθ·δ[n−1]+δ[n−2]",
];

const f2 = (x) => {
  const v = Math.abs(x) < 5e-3 ? 0 : x;
  return Number(v.toFixed(2)).toString().replace("-", "−");
};
/** "− a" or "+ |a|", so a formula never reads "z − −0.15". */
const minus = (a) => (a < -5e-3 ? `+ ${f2(-a)}` : `− ${f2(a)}`);
const plus = (a) => (a < -5e-3 ? `− ${f2(-a)}` : `+ ${f2(a)}`);

/**
 * Everything the widget and the page need to know about one signal.
 *
 * @param {string} name one of SIGNALS
 * @param {number} r    radius parameter (used by the exponentials and the damped sinusoids)
 * @param {number} thetaDeg angle parameter in degrees (the damped sinusoids and the notch)
 * @returns {{
 *   name: string, uses: string[], x: (n: number) => number,
 *   zeros: number[][], poles: number[][], gain: number,
 *   roc: { inner: number, outer: number, includesZero: boolean, empty: boolean },
 *   sequence: string, formula: string, rocText: string,
 *   rightSided: boolean, leftSided: boolean, finite: boolean,
 * }}
 */
export function zSignal(name, r = 0.8, thetaDeg = 45) {
  const sig = buildSignal(name, r, thetaDeg);
  // A coefficient of exactly 1 is left out: "1 − z⁻¹", not "1 − 1z⁻¹".
  sig.formula = sig.formula.replace(/([−+] )1(z)/g, "$1$2").replace("z(z − 0)", "z²").replace(/ [−+] 0z/g, "");
  return sig;
}

function buildSignal(name, r, thetaDeg) {
  const th = (thetaDeg * Math.PI) / 180;
  const ct = Math.cos(th), st = Math.sin(th);
  const p = C.polar(r, th), pc = C.polar(r, -th);
  const step = (n) => (n >= 0 ? 1 : 0);
  const base = { name, uses: [], rightSided: true, leftSided: false, finite: false };
  const roc = (inner, outer, includesZero = false) => ({ inner, outer, includesZero, empty: !(inner < outer) });
  switch (name) {
    case "unit impulse δ[n]":
      return { ...base, finite: true, x: (n) => (n === 0 ? 1 : 0), zeros: [], poles: [], gain: 1,
        roc: roc(0, Infinity, true), sequence: "x[n] = 1 at n = 0, 0 everywhere else",
        formula: "X(z) = 1", rocText: "every z (the whole plane, including 0 and ∞)" };
    case "delayed impulse δ[n−2]":
      return { ...base, finite: true, x: (n) => (n === 2 ? 1 : 0), zeros: [], poles: [[0, 0], [0, 0]], gain: 1,
        roc: roc(0, Infinity), sequence: "x[n] = 1 at n = 2, 0 everywhere else",
        formula: "X(z) = z⁻² = 1/z²", rocText: "every z except z = 0" };
    case "unit step u[n]":
      return { ...base, x: step, zeros: [[0, 0]], poles: [[1, 0]], gain: 1,
        roc: roc(1, Infinity), sequence: "x[n] = 1 for n ≥ 0",
        formula: "X(z) = 1/(1 − z⁻¹) = z/(z − 1)", rocText: "|z| > 1" };
    case "decaying exponential rⁿu[n]":
      return { ...base, uses: ["r"], x: (n) => (n >= 0 ? r ** n : 0), zeros: [[0, 0]], poles: [[r, 0]], gain: 1,
        roc: roc(r, Infinity), sequence: `x[n] = ${f2(r)}ⁿ for n ≥ 0`,
        formula: `X(z) = 1/(1 − ${f2(r)}z⁻¹) = z/(z − ${f2(r)})`, rocText: `|z| > ${f2(r)}` };
    case "left-sided exponential −rⁿu[−n−1]":
      return { ...base, uses: ["r"], rightSided: false, leftSided: true, x: (n) => (n <= -1 ? -(r ** n) : 0),
        zeros: [[0, 0]], poles: [[r, 0]], gain: 1, roc: roc(0, r, true),
        sequence: `x[n] = −${f2(r)}ⁿ for n ≤ −1, 0 for n ≥ 0`,
        formula: `X(z) = 1/(1 − ${f2(r)}z⁻¹) = z/(z − ${f2(r)})`, rocText: `|z| < ${f2(r)}` };
    case "two-sided exponential r^|n|":
      return { ...base, uses: ["r"], rightSided: false, x: (n) => r ** Math.abs(n),
        zeros: [[0, 0]], poles: [[r, 0], [1 / r, 0]], gain: -(1 - r * r) / r, roc: roc(r, 1 / r),
        sequence: `x[n] = ${f2(r)}^|n| for every n`,
        formula: `X(z) = (1 − ${f2(r * r)})z / ((z − ${f2(r)})(1 − ${f2(r)}z)) = ${f2(-(1 - r * r) / r)}·z / ((z − ${f2(r)})(z − ${f2(1 / r)}))`,
        rocText: r < 1 ? `${f2(r)} < |z| < ${f2(1 / r)}` : "no z at all: with r ≥ 1 the samples do not decay in either direction",
        note: r >= 1 ? `With r ≥ 1 this transform does not exist; the faded surface is only the formula${Math.abs(r - 1) < 1e-9 ? ", whose constant is 0 at r = 1, so it lies flat on the floor" : ""}.` : "" };
    case "ramped exponential n·rⁿu[n]":
      return { ...base, uses: ["r"], x: (n) => (n >= 0 ? n * r ** n : 0), zeros: [[0, 0]], poles: [[r, 0], [r, 0]], gain: r,
        roc: roc(r, Infinity), sequence: `x[n] = n·${f2(r)}ⁿ for n ≥ 0`,
        formula: `X(z) = ${f2(r)}z⁻¹/(1 − ${f2(r)}z⁻¹)² = ${f2(r)}z/(z − ${f2(r)})²`, rocText: `|z| > ${f2(r)}` };
    case "damped cosine rⁿcos(θn)u[n]":
      return { ...base, uses: ["r", "theta"], x: (n) => (n >= 0 ? r ** n * Math.cos(th * n) : 0),
        zeros: [[0, 0], [r * ct, 0]], poles: [p, pc], gain: 1, roc: roc(r, Infinity),
        note: Math.abs(st) < 1e-9 ? `At θ = ${thetaDeg}° the zero at ${f2(r * ct)} cancels one of the two poles there, and the signal is just (${f2(r * ct)})ⁿu[n].` : "",
        sequence: `x[n] = ${f2(r)}ⁿ·cos(${thetaDeg}°·n) for n ≥ 0`,
        formula: `X(z) = z(z ${minus(r * ct)}) / (z² ${minus(2 * r * ct)}z ${plus(r * r)})`, rocText: `|z| > ${f2(r)}` };
    case "damped sine rⁿsin(θn)u[n]":
      return { ...base, uses: ["r", "theta"], x: (n) => (n >= 0 ? r ** n * Math.sin(th * n) : 0),
        zeros: [[0, 0]], poles: [p, pc], gain: Math.abs(st) < 1e-9 ? 0 : r * st, roc: roc(r, Infinity),
        note: Math.abs(st) < 1e-9 ? "At θ = 0° or 180° every sample is 0, so X(z) = 0 everywhere; the poles are drawn where they sit for nearby θ." : "",
        sequence: `x[n] = ${f2(r)}ⁿ·sin(${thetaDeg}°·n) for n ≥ 0`,
        formula: `X(z) = ${f2(r * st)}z / (z² ${minus(2 * r * ct)}z ${plus(r * r)})`, rocText: `|z| > ${f2(r)}` };
    case "8-sample pulse u[n]−u[n−8]": {
      const zeros = [];
      for (let k = 1; k < 8; k++) zeros.push(C.polar(1, (2 * Math.PI * k) / 8));
      return { ...base, finite: true, x: (n) => (n >= 0 && n < 8 ? 1 : 0), zeros,
        poles: Array.from({ length: 7 }, () => [0, 0]), gain: 1, roc: roc(0, Infinity),
        sequence: "x[n] = 1 for n = 0, 1, …, 7, 0 everywhere else",
        formula: "X(z) = 1 + z⁻¹ + … + z⁻⁷ = (1 − z⁻⁸)/(1 − z⁻¹)", rocText: "every z except z = 0" };
    }
    case "notch filter δ[n]−2cosθ·δ[n−1]+δ[n−2]":
      return { ...base, uses: ["theta"], finite: true,
        x: (n) => (n === 0 || n === 2 ? 1 : n === 1 ? -2 * ct : 0),
        zeros: [C.polar(1, th), C.polar(1, -th)], poles: [[0, 0], [0, 0]], gain: 1, roc: roc(0, Infinity),
        sequence: `x[0] = 1, x[1] = ${f2(-2 * ct)}, x[2] = 1, 0 everywhere else`,
        formula: `X(z) = 1 ${minus(2 * ct)}z⁻¹ + z⁻² = (z² ${minus(2 * ct)}z + 1)/z²`, rocText: "every z except z = 0" };
    default:
      throw new Error(`unknown signal "${name}"`);
  }
}

/** X(z) from the factored form. Returns [re, im]; Infinity components at a pole. */
export function evalX(sig, z) {
  let num = [sig.gain, 0];
  for (const q of sig.zeros) num = C.mul(num, C.sub(z, q));
  let den = [1, 0];
  for (const q of sig.poles) den = C.mul(den, C.sub(z, q));
  if (C.abs(den) < 1e-300) return [Infinity, Infinity];
  return C.div(num, den);
}

/** |X(z)|, with Infinity at a pole. */
export function magX(sig, z) {
  const v = evalX(sig, z);
  return Number.isFinite(v[0]) ? C.abs(v) : Infinity;
}

/** True when z lies in the region of convergence. */
export function inRoc(sig, z) {
  const m = C.abs(z);
  if (sig.roc.empty) return false;
  if (m === 0) return sig.roc.includesZero;
  return m > sig.roc.inner && m < sig.roc.outer;
}

/**
 * The defining sum Σ x[n] z^-n over n in [nMin, nMax], computed directly.
 * Inside the ROC this converges to evalX as the range grows.
 */
export function directSum(sig, z, nMin = -400, nMax = 400) {
  let s = [0, 0];
  for (let n = nMin; n <= nMax; n++) {
    const x = sig.x(n);
    if (x === 0) continue;
    s = C.add(s, C.polar(x * C.abs(z) ** -n, -n * C.arg(z)));
  }
  return s;
}

/** Height of the surface at z: decibels (20·log10|X|) or plain magnitude, clipped to the view. */
export const HEIGHT = {
  decibels: { lo: -30, hi: 30, unit: "dB", of: (m) => (m === 0 ? -Infinity : 20 * Math.log10(m)) },
  magnitude: { lo: 0, hi: 10, unit: "", of: (m) => m },
};

export function heightAt(sig, z, mode = "decibels") {
  const h = HEIGHT[mode] ?? HEIGHT.decibels;
  const v = h.of(magX(sig, z));
  if (v === Infinity || v > h.hi) return h.hi;
  if (!(v > h.lo)) return h.lo;
  return v;
}

/**
 * The geometric evaluation of |X| at z: |gain| times the product of the
 * distances from each zero to z, divided by the product of the distances from
 * each pole to z. Returns the distances too, so the widget can draw them.
 */
export function geometric(sig, z) {
  const zd = sig.zeros.map((q) => C.abs(C.sub(z, q)));
  const pd = sig.poles.map((q) => C.abs(C.sub(z, q)));
  const num = zd.reduce((a, b) => a * b, Math.abs(sig.gain));
  const den = pd.reduce((a, b) => a * b, 1);
  return { zeroDistances: zd, poleDistances: pd, value: den === 0 ? Infinity : num / den };
}

/**
 * Classify the signal: is its DTFT defined (unit circle inside the ROC), is it
 * stable as an impulse response, is it causal?
 */
export function verdict(sig) {
  const onCircle = !sig.roc.empty && sig.roc.inner < 1 && sig.roc.outer > 1;
  const edge = !sig.roc.empty && (sig.roc.inner === 1 || sig.roc.outer === 1);
  return {
    stable: onCircle,
    causal: sig.rightSided && sig.x(-1) === 0 && sig.x(-2) === 0,
    dtft: onCircle ? "exists" : edge ? "only in a limiting sense (the unit circle is the edge of the ROC)" : "does not exist",
    maxPole: sig.poles.reduce((m, q) => Math.max(m, C.abs(q)), 0),
  };
}

/** Distinct points in a list, with multiplicities (for drawing "×2" labels). */
export function withMultiplicity(points, tol = 1e-9) {
  const out = [];
  for (const q of points) {
    const hit = out.find((o) => Math.abs(o.at[0] - q[0]) < tol && Math.abs(o.at[1] - q[1]) < tol);
    if (hit) hit.count += 1;
    else out.push({ at: q, count: 1 });
  }
  return out;
}
