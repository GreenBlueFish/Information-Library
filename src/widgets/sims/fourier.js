// src/widgets/sims/fourier.js
//
// The maths behind the `fourier-3d` and `fft-butterfly` widgets (Math › The
// Fourier Transform). Pure functions, no DOM.
//
// Periodic signals are kept as their Fourier series in amplitude-phase form,
//
//   x(t) = A₀ + Σ_{k≥1} A_k cos(2π k t / T + φ_k),
//
// with closed-form coefficients that the tests check against a numerical
// integral c_k = (1/T) ∫ x(t) e^(−j2πkt/T) dt over one period. A delay of
// `delay` periods shifts every phase by −2πk·delay and leaves A_k alone.

/** The names the widget's `signal` select may use, in menu order. */
export const SIGNALS = [
  "square wave",
  "sawtooth wave",
  "triangle wave",
  "pulse train (pulse 0.5 s wide)",
  "half-wave rectified sine",
  "full-wave rectified sine",
  "two tones",
];

/** Width of each pulse in the pulse train, in seconds. */
export const TAU = 0.5;

const frac = (u) => u - Math.floor(u);
const sinc = (u) => (Math.abs(u) < 1e-12 ? 1 : Math.sin(Math.PI * u) / (Math.PI * u));

/**
 * One periodic signal.
 *
 * @param {string} name one of SIGNALS
 * @param {number} T period in seconds
 * @param {number} delay shift to the right, as a fraction of a period
 * @returns {{ name, T, delay, x: (t) => number, coeff: (k) => { A: number, phi: number },
 *   jumps: boolean, text: string, formula: string }}
 */
export function fSignal(name, T = 1, delay = 0) {
  const sh = (t) => t - delay * T; // the undelayed signal is read at t − delay·T
  const u = (t) => frac(sh(t) / T); // position in the period, 0 ≤ u < 1
  const c = (k, A, phi) => ({ A, phi: phi - 2 * Math.PI * k * delay });
  // Every A_k is kept ≥ 0: a negative coefficient becomes a phase of π.
  const signed = (k, a, phi = 0) => (a < 0 ? c(k, -a, phi + Math.PI) : c(k, a, phi));
  switch (name) {
    case "square wave":
      return { name, T, delay, jumps: true,
        x: (t) => (u(t) < 0.5 ? 1 : -1),
        coeff: (k) => (k === 0 || k % 2 === 0 ? c(k, 0, 0) : c(k, 4 / (Math.PI * k), -Math.PI / 2)),
        text: "+1 for the first half of each period, −1 for the second",
        formula: "x(t) = (4/π)[sin(ω₀t) + sin(3ω₀t)/3 + sin(5ω₀t)/5 + …]",
        rule: "odd harmonics only, falling as 1/k" };
    case "sawtooth wave":
      return { name, T, delay, jumps: true,
        x: (t) => { const v = frac(sh(t) / T + 0.5) - 0.5; return 2 * v; },
        coeff: (k) => (k === 0 ? c(k, 0, 0) : signed(k, (2 / (Math.PI * k)) * (k % 2 ? 1 : -1), -Math.PI / 2)),
        text: "a ramp from −1 up to +1 across each period, then a drop back",
        formula: "x(t) = (2/π)[sin(ω₀t) − sin(2ω₀t)/2 + sin(3ω₀t)/3 − …]",
        rule: "every harmonic, falling as 1/k" };
    case "triangle wave":
      return { name, T, delay, jumps: false,
        x: (t) => { const v = frac(sh(t) / T + 0.5) - 0.5; return 1 - 4 * Math.abs(v); },
        coeff: (k) => (k === 0 || k % 2 === 0 ? c(k, 0, 0) : c(k, 8 / (Math.PI * Math.PI * k * k), 0)),
        text: "straight lines from +1 down to −1 and back, once each period",
        formula: "x(t) = (8/π²)[cos(ω₀t) + cos(3ω₀t)/9 + cos(5ω₀t)/25 + …]",
        rule: "odd harmonics only, falling as 1/k²" };
    case "pulse train (pulse 0.5 s wide)": {
      const d = Math.min(1, TAU / T); // duty cycle
      return { name, T, delay, jumps: d < 1,
        x: (t) => { const v = frac(sh(t) / T + 0.5) - 0.5; return Math.abs(v) * T < TAU / 2 ? 1 : 0; },
        coeff: (k) => (k === 0 ? c(0, d, 0) : signed(k, 2 * d * sinc(k * d))),
        text: `1 for 0.5 s in the middle of each ${Number(T.toFixed(2))} s period, 0 the rest of the time (duty cycle ${Number((100 * d).toFixed(1))}%)`,
        formula: `x(t) = ${Number(d.toFixed(3))} + Σ 2·${Number(d.toFixed(3))}·sinc(${Number(d.toFixed(3))}k)·cos(kω₀t)`,
        rule: "every harmonic, with a sinc envelope whose zeros fall at multiples of 1/0.5 s = 2 Hz" };
    }
    case "half-wave rectified sine":
      return { name, T, delay, jumps: false,
        x: (t) => Math.max(0, Math.sin(2 * Math.PI * u(t))),
        coeff: (k) => (k === 0 ? c(0, 1 / Math.PI, 0)
          : k === 1 ? c(1, 0.5, -Math.PI / 2)
            : k % 2 === 1 ? c(k, 0, 0) : c(k, 2 / (Math.PI * (k * k - 1)), Math.PI)),
        text: "the top halves of a sine wave, with the bottom halves cut off to 0",
        formula: "x(t) = 1/π + sin(ω₀t)/2 − (2/π)[cos(2ω₀t)/3 + cos(4ω₀t)/15 + …]",
        rule: "the fundamental, then even harmonics falling as 1/k²" };
    case "full-wave rectified sine":
      // |sin(πt/T)|: period T, one hump per period, so its harmonics sit at k/T.
      return { name, T, delay, jumps: false,
        x: (t) => Math.abs(Math.sin(Math.PI * u(t))),
        coeff: (k) => (k === 0 ? c(0, 2 / Math.PI, 0) : c(k, 4 / (Math.PI * (4 * k * k - 1)), Math.PI)),
        text: "a sine wave with its bottom halves flipped up, one hump per period",
        formula: "x(t) = 2/π − (4/π)[cos(ω₀t)/3 + cos(2ω₀t)/15 + cos(3ω₀t)/35 + …]",
        rule: "every harmonic, falling as 1/k²" };
    case "two tones":
      return { name, T, delay, jumps: false,
        x: (t) => Math.cos(2 * Math.PI * u(t)) + 0.5 * Math.cos(6 * Math.PI * u(t) + Math.PI / 3),
        coeff: (k) => (k === 1 ? c(1, 1, 0) : k === 3 ? c(3, 0.5, Math.PI / 3) : c(k, 0, 0)),
        text: "cos(ω₀t) plus half as much of the third harmonic, started 60° ahead",
        formula: "x(t) = cos(ω₀t) + 0.5·cos(3ω₀t + 60°)",
        rule: "just two lines: k = 1 and k = 3" };
    default:
      throw new Error(`unknown signal "${name}"`);
  }
}

/** The k-th harmonic's value at t (k = 0 is the constant A₀). */
export function harmonic(sig, k, t) {
  const { A, phi } = sig.coeff(k);
  return k === 0 ? A : A * Math.cos((2 * Math.PI * k * t) / sig.T + phi);
}

/** The partial sum of harmonics 0…N at t. */
export function partialSum(sig, N, t) {
  let s = 0;
  for (let k = 0; k <= N; k++) s += harmonic(sig, k, t);
  return s;
}

/**
 * The complex coefficient c_k = (1/T)∫ x(t) e^(−j2πkt/T) dt over one period,
 * by the midpoint rule (for the tests). For k ≥ 1, A_k = 2|c_k|, φ_k = arg c_k.
 */
export function numericCoeff(sig, k, n = 20000) {
  let re = 0, im = 0;
  for (let i = 0; i < n; i++) {
    const t = ((i + 0.5) / n) * sig.T;
    const x = sig.x(t), a = (-2 * Math.PI * k * t) / sig.T;
    re += x * Math.cos(a); im += x * Math.sin(a);
  }
  return [re / n, im / n];
}

/** Root-mean-square error of the N-term partial sum over one period. */
export function rmsError(sig, N, n = 4000) {
  let e = 0;
  for (let i = 0; i < n; i++) {
    const t = ((i + 0.5) / n) * sig.T;
    const d = sig.x(t) - partialSum(sig, N, t);
    e += d * d;
  }
  return Math.sqrt(e / n);
}

/** Largest value of the partial sum over a period (to see the Gibbs overshoot). */
export function peak(sig, N, n = 4000) {
  let m = -Infinity;
  for (let i = 0; i < n; i++) m = Math.max(m, partialSum(sig, N, (i / n) * sig.T));
  return m;
}

/** Wrap an angle to (−π, π]. */
export const wrap = (a) => {
  let v = ((a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
  if (v <= -Math.PI + 1e-12) v = Math.PI;
  return v;
};

// --- the DFT and the radix-2 FFT ------------------------------------------

const cmul = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];

/** The DFT by its definition, X[k] = Σ x[n] e^(−j2πkn/N): N² multiplications. */
export function dft(x) {
  const N = x.length;
  const out = [];
  for (let k = 0; k < N; k++) {
    let re = 0, im = 0;
    for (let n = 0; n < N; n++) {
      const v = Array.isArray(x[n]) ? x[n] : [x[n], 0];
      const a = (-2 * Math.PI * k * n) / N;
      re += v[0] * Math.cos(a) - v[1] * Math.sin(a);
      im += v[0] * Math.sin(a) + v[1] * Math.cos(a);
    }
    out.push([re, im]);
  }
  return out;
}

/** Reverse the lowest `bits` bits of i. */
export function bitReverse(i, bits) {
  let r = 0;
  for (let b = 0; b < bits; b++) r = (r << 1) | ((i >> b) & 1);
  return r;
}

/**
 * The iterative radix-2 decimation-in-time FFT, keeping every stage so the
 * widget can draw them. stages[0] is the input in bit-reversed order;
 * stages[s] is the array after butterfly stage s (s = 1…log₂N); the last is
 * X[k] in natural order. Each butterfly is { stage, top, bottom, twiddle } with
 * twiddle the exponent p of W_N^p = e^(−j2πp/N).
 */
export function fftStages(x) {
  const N = x.length;
  const bits = Math.round(Math.log2(N));
  if (2 ** bits !== N) throw new Error("length must be a power of 2");
  let cur = [];
  for (let i = 0; i < N; i++) { const v = x[bitReverse(i, bits)]; cur.push(Array.isArray(v) ? v.slice() : [v, 0]); }
  const stages = [cur.map((v) => v.slice())];
  const butterflies = [];
  for (let s = 1; s <= bits; s++) {
    const m = 2 ** s, half = m / 2;
    const next = cur.map((v) => v.slice());
    for (let start = 0; start < N; start += m) {
      for (let j = 0; j < half; j++) {
        const p = j * (N / m);
        const w = [Math.cos((-2 * Math.PI * p) / N), Math.sin((-2 * Math.PI * p) / N)];
        const top = start + j, bottom = start + j + half;
        const t = cmul(w, cur[bottom]);
        next[top] = [cur[top][0] + t[0], cur[top][1] + t[1]];
        next[bottom] = [cur[top][0] - t[0], cur[top][1] - t[1]];
        butterflies.push({ stage: s, top, bottom, twiddle: p });
      }
    }
    cur = next;
    stages.push(cur.map((v) => v.slice()));
  }
  return { stages, butterflies, bits };
}

/** Complex multiplications: the definition against the radix-2 FFT. */
export function opCounts(N) {
  return { direct: N * N, fft: (N / 2) * Math.log2(N) };
}

/** The inputs the FFT widget offers, eight samples each. */
export const FFT_INPUTS = {
  "impulse at n = 0": [1, 0, 0, 0, 0, 0, 0, 0],
  "impulse at n = 1": [0, 1, 0, 0, 0, 0, 0, 0],
  "constant 1": [1, 1, 1, 1, 1, 1, 1, 1],
  "cosine, 1 cycle": Array.from({ length: 8 }, (_, n) => Math.cos((2 * Math.PI * n) / 8)),
  "cosine, 2 cycles": Array.from({ length: 8 }, (_, n) => Math.cos((4 * Math.PI * n) / 8)),
  "alternating +1, −1": [1, -1, 1, -1, 1, -1, 1, -1],
  "square: four 1s, four 0s": [1, 1, 1, 1, 0, 0, 0, 0],
  "ramp 0 … 7": [0, 1, 2, 3, 4, 5, 6, 7],
};
