// src/widgets/sims/statespace.js
//
// The maths behind the state-space viewers (`state-plane`, `state-3d`):
// preset systems x′ = Ax + Bu, y = Cx + Du with two or three states, exact
// simulation through the matrix exponential, sampling (zero-order hold),
// poles, transfer functions, controllability and observability, and pole
// placement by Ackermann's formula. Pure functions, no DOM, so the tests can
// check every number the widgets print.

import { eig2, eig3, cubicRoots, sfmt, fmt } from "./eigen.js";

// --- presets ---------------------------------------------------------------------
// Each: name, A, B (input column), C (output row), D, the names of the states,
// the input and the output, and `place`, the closed-loop polynomial
// s² + p[0]s + p[1] the walk-through's feedback step aims for.
export const SYSTEMS2 = [
  { name: "mass on a spring, light damping", A: [[0, 1], [-4, -1]], B: [0, 1], C: [1, 0], D: 0,
    states: ["position x₁", "velocity x₂"], input: "force u", output: "position y = x₁", place: [4, 8] },
  { name: "mass on a spring, heavy damping", A: [[0, 1], [-2, -3]], B: [0, 1], C: [1, 0], D: 0,
    states: ["position x₁", "velocity x₂"], input: "force u", output: "position y = x₁", place: [4, 8] },
  { name: "RLC circuit", A: [[0, 2], [-1, -2]], B: [0, 1], C: [1, 0], D: 0,
    states: ["capacitor voltage x₁", "inductor current x₂"], input: "source voltage u", output: "capacitor voltage y = x₁", place: [4, 8] },
  { name: "two tanks in a row", A: [[-1, 0], [1, -0.5]], B: [1, 0], C: [0, 1], D: 0,
    states: ["level in tank 1, x₁", "level in tank 2, x₂"], input: "inflow u", output: "level in tank 2, y = x₂", place: [5, 10.25] },
  { name: "DC motor, angle and speed", A: [[0, 1], [0, -2]], B: [0, 2], C: [1, 0], D: 0,
    states: ["angle x₁", "speed x₂"], input: "voltage u", output: "angle y = x₁", place: [4, 8] },
  { name: "pendulum balanced upright", A: [[0, 1], [1, 0]], B: [0, 1], C: [1, 0], D: 0,
    states: ["angle x₁", "angular velocity x₂"], input: "torque u", output: "angle y = x₁", place: [2, 2] },
  { name: "undamped oscillator", A: [[0, 1], [-1, 0]], B: [0, 1], C: [1, 0], D: 0,
    states: ["position x₁", "velocity x₂"], input: "force u", output: "position y = x₁", place: [4, 8] },
  { name: "negative damping, a growing swing", A: [[0, 1], [-1, 0.3]], B: [0, 1], C: [1, 0], D: 0,
    states: ["position x₁", "velocity x₂"], input: "force u", output: "position y = x₁", place: [4, 8] },
  { name: "hidden mode: the input misses one", A: [[-1, 0], [0, -2]], B: [1, 0], C: [1, 1], D: 0,
    states: ["mode 1, x₁", "mode 2, x₂"], input: "input u", output: "y = x₁ + x₂", place: null, stepK: [2, 0] },
  { name: "hidden mode: the output misses one", A: [[-1, 0], [0, -2]], B: [1, 1], C: [1, 0], D: 0,
    states: ["mode 1, x₁", "mode 2, x₂"], input: "input u", output: "y = x₁", place: [4, 8] },
];
export const SYSTEM2_OPTIONS = SYSTEMS2.map((p) => p.name);

export const SYSTEMS3 = [
  { name: "spring with a slow actuator", A: [[0, 1, 0], [-4, -0.4, 1], [0, 0, -5]], B: [0, 0, 5], C: [1, 0, 0], D: 0,
    states: ["position x₁", "velocity x₂", "actuator force x₃"], input: "command u", output: "position y = x₁" },
  { name: "DC motor with its current", A: [[0, 1, 0], [0, -0.5, 1], [0, -2, -4]], B: [0, 0, 2], C: [1, 0, 0], D: 0,
    states: ["angle x₁", "speed x₂", "current x₃"], input: "voltage u", output: "angle y = x₁" },
  { name: "three tanks in a row", A: [[-1, 0, 0], [1, -0.6, 0], [0, 0.6, -0.3]], B: [1, 0, 0], C: [0, 0, 1], D: 0,
    states: ["tank 1, x₁", "tank 2, x₂", "tank 3, x₃"], input: "inflow u", output: "tank 3, y = x₃" },
  { name: "chain of three lags 1/(s + 1)³", A: [[0, 1, 0], [0, 0, 1], [-1, -3, -3]], B: [0, 0, 1], C: [1, 0, 0], D: 0,
    states: ["x₁", "x₂ = x₁′", "x₃ = x₁″"], input: "input u", output: "y = x₁" },
  { name: "a spin about an axis, and a decay", A: [[0, -1, 0], [1, 0, 0], [0, 0, -0.5]], B: [1, 0, 1], C: [1, 0, 1], D: 0,
    states: ["x₁", "x₂", "x₃"], input: "input u", output: "y = x₁ + x₃" },
  { name: "Lorenz system near the origin", A: [[-10, 10, 0], [28, -1, 0], [0, 0, -8 / 3]], B: [1, 0, 0], C: [1, 0, 0], D: 0,
    states: ["x", "y", "z"], input: "push on x", output: "x" },
];
export const SYSTEM3_OPTIONS = SYSTEMS3.map((p) => p.name);

export function system2(name) {
  const p = SYSTEMS2.find((q) => q.name === name);
  if (!p) throw new Error(`unknown system: ${name}`);
  return p;
}
export function system3(name) {
  const p = SYSTEMS3.find((q) => q.name === name);
  if (!p) throw new Error(`unknown system: ${name}`);
  return p;
}

// --- small matrix helpers -------------------------------------------------------
export const eye = (n) => Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
export const mul = (a, b) => a.map((row) => b[0].map((_, j) => row.reduce((s, x, k) => s + x * b[k][j], 0)));
export const mv = (m, v) => m.map((row) => row.reduce((s, x, i) => s + x * v[i], 0));
export const dotv = (u, v) => u.reduce((s, x, i) => s + x * v[i], 0);
export const addM = (a, b, c = 1) => a.map((row, i) => row.map((x, j) => x + c * b[i][j]));
export const scaleM = (a, c) => a.map((row) => row.map((x) => x * c));
export const outer = (u, v) => u.map((x) => v.map((y) => x * y));
const tr = (m) => m.reduce((s, row, i) => s + row[i], 0);
const normInf = (m) => Math.max(...m.map((row) => row.reduce((s, x) => s + Math.abs(x), 0)));

/** Inverse by Gauss–Jordan with partial pivoting; null if singular. */
export function inv(m) {
  const n = m.length;
  const a = m.map((row, i) => [...row, ...eye(n)[i]]);
  const scale = Math.max(1e-300, normInf(m));
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    if (Math.abs(a[p][c]) < 1e-12 * scale) return null;
    [a[c], a[p]] = [a[p], a[c]];
    const d = a[c][c];
    for (let j = 0; j < 2 * n; j++) a[c][j] /= d;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = a[r][c];
      if (f !== 0) for (let j = 0; j < 2 * n; j++) a[r][j] -= f * a[c][j];
    }
  }
  return a.map((row) => row.slice(n));
}

export function det(m) {
  if (m.length === 1) return m[0][0];
  if (m.length === 2) return m[0][0] * m[1][1] - m[0][1] * m[1][0];
  return m[0].reduce((s, x, j) => s + (j % 2 ? -1 : 1) * x * det(m.slice(1).map((row) => row.filter((_, k) => k !== j))), 0);
}

/** e^M by scaling and squaring with a degree-18 Taylor series (ample for these small matrices). */
export function expm(m) {
  const n = m.length;
  const nm = normInf(m);
  let s = 0;
  while (nm / 2 ** s > 0.5) s++;
  const a = scaleM(m, 1 / 2 ** s);
  let term = eye(n), sum = eye(n);
  for (let k = 1; k <= 18; k++) {
    term = scaleM(mul(term, a), 1 / k);
    sum = addM(sum, term);
  }
  for (let i = 0; i < s; i++) sum = mul(sum, sum);
  return sum;
}

/**
 * Zero-order-hold sampling with period T: x[k+1] = Φ x[k] + Γ u[k] with
 * Φ = e^{AT} and Γ = ∫₀ᵀ e^{Aτ} dτ B, both read off e^{MT} for M = [[A, B], [0, 0]].
 */
export function discretise(A, B, T) {
  const n = A.length;
  const M = [...A.map((row, i) => [...row, B[i]]), Array(n + 1).fill(0)];
  const E = expm(scaleM(M, T));
  return { Phi: E.slice(0, n).map((row) => row.slice(0, n)), Gamma: E.slice(0, n).map((row) => row[n]) };
}

// --- poles, polynomials, transfer functions ----------------------------------------
/** Characteristic polynomial det(sI − A) = sⁿ + c[0]sⁿ⁻¹ + … + c[n−1], and the
 *  Faddeev–LeVerrier matrices with adj(sI − A) = Σₖ Mₖ s^{n−k} (k = 1 … n). */
export function leverrier(A) {
  const n = A.length;
  let Mk = eye(n);
  const Ms = [Mk];
  const c = [];
  for (let k = 1; k <= n; k++) {
    const AM = mul(A, Mk);
    const ck = -tr(AM) / k;
    c.push(ck);
    if (k < n) { Mk = addM(AM, eye(n), ck); Ms.push(Mk); }
  }
  return { c, Ms };
}

/** Poles = eigenvalues of A, as [{re, im}], conjugate pairs listed with +im first, sorted by real part (largest first). */
export function poles(A) {
  const out = [];
  if (A.length === 2) {
    const e = eig2(A);
    if (e.kind === "complex") out.push({ re: e.re, im: e.im }, { re: e.re, im: -e.im });
    else out.push(...e.values.map((v) => ({ re: v, im: 0 })));
  } else {
    const e = eig3(A);
    out.push(...e.values.map((v) => ({ re: v, im: 0 })));
    for (const c of e.complex) out.push({ re: c.re, im: c.im }, { re: c.re, im: -c.im });
  }
  return out.sort((p, q) => (q.re - p.re) || (q.im - p.im));
}

/** Roots of a polynomial given highest power first (degree ≤ 3, leading zeros trimmed), as [{re, im}]. */
export function polyRoots(coeffs) {
  const scale = Math.max(1e-300, ...coeffs.map(Math.abs));
  let c = coeffs.slice();
  while (c.length && Math.abs(c[0]) < 1e-9 * scale) c.shift();
  if (c.length <= 1) return [];
  c = c.map((x) => x / c[0]);
  if (c.length === 2) return [{ re: -c[1], im: 0 }];
  if (c.length === 3) {
    const [, p, q] = c, d = p * p - 4 * q;
    if (d >= 0) { const s = Math.sqrt(d); return [{ re: (-p + s) / 2, im: 0 }, { re: (-p - s) / 2, im: 0 }]; }
    return [{ re: -p / 2, im: Math.sqrt(-d) / 2 }, { re: -p / 2, im: -Math.sqrt(-d) / 2 }];
  }
  const r = cubicRoots(c[1], c[2], c[3]);
  return [...r.real.map((x) => ({ re: x, im: 0 })), ...r.complex.flatMap((z) => [{ re: z.re, im: z.im }, { re: z.re, im: -z.im }])];
}

/**
 * Transfer function G(s) = C (sI − A)⁻¹ B + D = num(s) / den(s), both highest power
 * first; den is monic of degree n. Works the same for G(z) with (Φ, Γ).
 */
export function transferFunction(A, B, C, D = 0) {
  const n = A.length;
  const { c, Ms } = leverrier(A);
  const den = [1, ...c];
  const num = [0, ...Ms.map((M) => dotv(C, mv(M, B)))].map((x, i) => x + D * den[i]);
  return { num, den };
}

/** Value of a polynomial (highest power first) at a real x. */
export const polyAt = (p, x) => p.reduce((s, a) => s * x + a, 0);

/** The controllability matrix [B, AB, …] (columns) and the observability matrix [C; CA; …] (rows). */
export function ctrbMatrix(A, B) {
  const cols = [B.slice()];
  for (let k = 1; k < A.length; k++) cols.push(mv(A, cols[k - 1]));
  return A.map((_, i) => cols.map((col) => col[i]));
}
export function obsvMatrix(A, C) {
  const rows = [C.slice()];
  for (let k = 1; k < A.length; k++) rows.push(rows[k - 1].map((_, j) => rows[k - 1].reduce((s, x, i) => s + x * A[i][j], 0)));
  return rows;
}
const fullRank = (M) => {
  const big = Math.max(1, ...M.flat().map(Math.abs));
  return Math.abs(det(M)) > 1e-9 * big ** M.length;
};
export const isControllable = (A, B) => fullRank(ctrbMatrix(A, B));
export const isObservable = (A, C) => fullRank(obsvMatrix(A, C));

/**
 * Ackermann's formula: the gain K with det(sI − (A − BK)) = sⁿ + p[0]sⁿ⁻¹ + … + p[n−1].
 * K = [0 … 0 1] · ctrb⁻¹ · φ(A). Null when (A, B) is not controllable.
 */
export function ackermann(A, B, p) {
  const n = A.length;
  const Ci = inv(ctrbMatrix(A, B));
  if (!Ci || !isControllable(A, B)) return null;
  let phi = eye(n).map((row) => row.map((x) => 0));
  let Ak = eye(n);
  const coeffs = [...p].reverse(); // p[n−1] for A⁰ up to p[0] for A^{n−1}
  for (let k = 0; k < n; k++) { phi = addM(phi, Ak, coeffs[k]); Ak = mul(Ak, A); }
  phi = addM(phi, Ak); // + Aⁿ
  const last = Ci[n - 1];
  return phi[0].map((_, j) => last.reduce((s, x, i) => s + x * phi[i][j], 0));
}

/** Closed loop with u = −Kx + r: A − BK, and C − DK. */
export function closedLoop(A, B, C, D, K) {
  return { A: addM(A, outer(B, K), -1), B: B.slice(), C: C.map((x, i) => x - D * K[i]), D };
}

/** The monic polynomial with the given roots (pairs of complex roots as [{re, im}, {re, −im}]), highest power first. */
export function polyFromRoots(rs) {
  let p = [{ re: 1, im: 0 }];
  for (const r of rs) {
    const q = Array.from({ length: p.length + 1 }, () => ({ re: 0, im: 0 }));
    p.forEach((a, i) => {
      q[i].re += a.re; q[i].im += a.im;
      q[i + 1].re -= a.re * r.re - a.im * r.im; q[i + 1].im -= a.re * r.im + a.im * r.re;
    });
    p = q;
  }
  return p.slice(1).map((z) => z.re);
}

/** e^{sT} for a pole s = re + j·im. */
export const sToZ = (s, T) => ({ re: Math.exp(s.re * T) * Math.cos(s.im * T), im: Math.exp(s.re * T) * Math.sin(s.im * T) });

// --- time responses ------------------------------------------------------------
export const INPUTS = ["none: free response from x(0)", "unit step", "unit impulse"];

/**
 * How long to show: long enough for the slowest stable mode to fade (5 time
 * constants) or for an unstable one to grow 30-fold, with at least three
 * periods of an undamped oscillation; between 2 and 30 seconds.
 */
export function timeSpan(ps) {
  const maxRe = Math.max(...ps.map((p) => p.re));
  if (maxRe > 1e-6) return Math.min(20, Math.max(0.25, Math.log(30) / maxRe));
  let t = 2;
  const decays = ps.filter((p) => p.re < -1e-6).map((p) => -p.re);
  if (decays.length) {
    // A repeated slowest pole decays like t^(m−1)e^(−at), more slowly: allow for it.
    const slow = Math.min(...decays);
    const mult = ps.filter((p) => Math.abs(-p.re - slow) < 1e-4 * Math.max(1, slow) && Math.abs(p.im) < 1e-9).length;
    t = Math.max(t, (5 / slow) * (1 + 0.6 * Math.max(0, mult - 1)));
  }
  for (const p of ps) {
    if (Math.abs(p.re) <= 1e-6) t = Math.max(t, p.im > 1e-6 ? (3 * 2 * Math.PI) / p.im : 8);
  }
  return Math.min(30, t);
}

/** Equivalent s-plane poles of z-plane poles: s = ln(z)/T (for the time span). */
export const zToS = (z, T) => {
  const r = Math.hypot(z.re, z.im);
  return { re: r > 1e-12 ? Math.log(r) / T : -50 / T, im: Math.atan2(z.im, z.re) / T };
};

/**
 * Simulate the closed loop x′ = (A − BK)x + Br (continuous) or
 * x[k+1] = (Φ − ΓK)x[k] + Γr[k] (sampled with period T).
 * input: one of INPUTS. Continuous: `n` samples on [0, tEnd], exact (the input is
 * constant between samples); the impulse adds B to x at t = 0⁺. Discrete: the
 * impulse is a unit pulse r[0] = 1. Returns { t, x, y, u }.
 */
export function simulate(sys, opts) {
  const { x0, K = sys.A.map(() => 0), input = INPUTS[0], discrete = false, T = 0.2, tEnd, n = 400 } = opts;
  const N = sys.A.length;
  const step = input === INPUTS[1], imp = input === INPUTS[2];
  let Phi, Gamma, dt, count;
  if (discrete) {
    ({ Phi, Gamma } = discretise(sys.A, sys.B, T));
    Phi = addM(Phi, outer(Gamma, K), -1);
    dt = T; count = Math.max(1, Math.min(400, Math.ceil(tEnd / T)));
  } else {
    const cl = closedLoop(sys.A, sys.B, sys.C, sys.D, K);
    dt = tEnd / n; count = n;
    ({ Phi, Gamma } = discretise(cl.A, cl.B, dt));
  }
  const Ccl = sys.C.map((c, i) => c - sys.D * K[i]);
  let x = x0.slice();
  if (imp && !discrete) x = x.map((v, i) => v + sys.B[i]);
  const out = { t: [], x: [], y: [], u: [] };
  for (let k = 0; k <= count; k++) {
    const r = step ? 1 : imp && discrete && k === 0 ? 1 : 0;
    const u = r - dotv(K, x);
    out.t.push(k * dt); out.x.push(x.slice()); out.u.push(u);
    out.y.push(dotv(Ccl, x) + sys.D * r);
    if (k < count) { const nx = mv(Phi, x).map((v, i) => v + Gamma[i] * r); x = nx; }
  }
  if (!discrete) out.y0 = imp ? dotv(Ccl, x0) : out.y[0];
  return out;
}

/** The resting state for a constant input r = 1 (or 0): −(A − BK)⁻¹B, or (I − Φcl)⁻¹Γ when sampled. Null if none. */
export function equilibrium(sys, K, r, discrete = false, T = 0.2) {
  const N = sys.A.length;
  if (!r) return Array(N).fill(0);
  if (discrete) {
    const { Phi, Gamma } = discretise(sys.A, sys.B, T);
    const M = addM(eye(N), addM(Phi, outer(Gamma, K), -1), -1);
    const Mi = inv(M);
    return Mi ? mv(Mi, Gamma) : null;
  }
  const Acl = addM(sys.A, outer(sys.B, K), -1);
  const Ai = inv(Acl);
  return Ai ? mv(Ai, sys.B).map((v) => -v * r) : null;
}

// --- text helpers --------------------------------------------------------------
/** A complex number as "−0.5 ± 1.936j" (for a pair) or "−2". */
export function poleText(p, d = 3) {
  if (Math.abs(p.im) < 1e-9) return sfmt(p.re, d);
  const im = sfmt(Math.abs(p.im), d);
  return Math.abs(p.re) < 0.5 * 10 ** -d ? `±${im}j` : `${sfmt(p.re, d)} ± ${im}j`;
}
/** All poles as text, each conjugate pair once: "−0.5 ± 1.936j", "−1 and −2". */
export function polesText(ps, d = 3) {
  const parts = [];
  for (const p of ps) if (p.im >= -1e-12) parts.push(poleText(p, d));
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}
/** A polynomial in `v` (highest power first, not necessarily monic) as text: "2s + 1", "s² + 3s + 2". */
export function polyVar(coeffs, v = "s", d = 3) {
  const scale = Math.max(1e-300, ...coeffs.map(Math.abs));
  let c = coeffs.slice();
  while (c.length > 1 && Math.abs(c[0]) < 1e-9 * scale) c.shift();
  const n = c.length - 1;
  const pow = (k) => (k === 0 ? "" : k === 1 ? v : `${v}${"⁰¹²³⁴⁵⁶⁷⁸⁹"[k]}`);
  let out = "";
  c.forEach((a, i) => {
    const k = n - i;
    const r = Number(a.toFixed(d));
    if (Math.abs(r) < 0.5 * 10 ** -d && !(n === 0)) return;
    const mag = Math.abs(r);
    const body = k > 0 && Math.abs(mag - 1) < 0.5 * 10 ** -d ? pow(k) : `${sfmt(mag, d)}${pow(k)}`;
    out += out ? `${r < 0 ? " − " : " + "}${body}` : `${r < 0 ? "−" : ""}${body}`;
  });
  return out || "0";
}
/** The exponent of e^(λt) as text: "−t" for λ = −1, "t" for 1, else "−0.5t". */
export const expT = (l) => { const v = sfmt(l); return v === "1" ? "t" : v === "−1" ? "−t" : `${v}t`; };
export const vecText = (v, d = 2) => `(${v.map((x) => fmt(x, d)).join(", ")})`;
export const matText = (m) => `[${m.map((row) => `[${row.map((x) => sfmt(x)).join(", ")}]`).join(", ")}]`;

/** Stable, unstable or on the edge, from the poles (continuous: real parts; sampled: sizes). */
export function stability(ps, discrete = false) {
  const tol = 1e-6;
  const m = discrete ? Math.max(...ps.map((p) => Math.hypot(p.re, p.im))) - 1 : Math.max(...ps.map((p) => p.re));
  if (m < -tol) return "stable";
  if (m > tol) return "unstable";
  return "on the edge";
}
