// src/widgets/sims/eigen.js
//
// The maths behind the eigenvalue viewers (`eigen-plane`, `eigen-3d`): preset
// matrices, eigenvalues and eigenvectors of 2×2 and 3×3 real matrices (real
// or complex), the characteristic polynomial, and powers. Pure functions, no
// DOM, so the tests can check every number the viewers print.
//
// Conventions: a matrix is an array of rows, m[i][j]; a vector is an array.
// Eigenvalues are listed largest |λ| first (ties: larger real part first).
// A complex pair is { re, im } with im > 0 standing for re ± j·im.

const EPS = 1e-9;

/** 2×2 presets: name → rows. The names are the select options. */
export const MATRICES2 = [
  { name: "stretch: diag(2, 0.5)", m: [[2, 0], [0, 0.5]] },
  { name: "symmetric [[2, 1], [1, 2]]", m: [[2, 1], [1, 2]] },
  { name: "not symmetric [[4, 1], [2, 3]]", m: [[4, 1], [2, 3]] },
  { name: "a negative eigenvalue [[1, 2], [2, −2]]", m: [[1, 2], [2, -2]] },
  { name: "Fibonacci [[1, 1], [1, 0]]", m: [[1, 1], [1, 0]] },
  { name: "Markov chain [[0.9, 0.2], [0.1, 0.8]]", m: [[0.9, 0.2], [0.1, 0.8]] },
  { name: "reflection across y = x [[0, 1], [1, 0]]", m: [[0, 1], [1, 0]] },
  { name: "projection onto the x-axis [[1, 0], [0, 0]]", m: [[1, 0], [0, 0]] },
  { name: "shear [[1, 1], [0, 1]]", m: [[1, 1], [0, 1]] },
  { name: "scaling 1.5I [[1.5, 0], [0, 1.5]]", m: [[1.5, 0], [0, 1.5]] },
  { name: "rotation by 30°", m: [[Math.cos(Math.PI / 6), -Math.sin(Math.PI / 6)], [Math.sin(Math.PI / 6), Math.cos(Math.PI / 6)]] },
  { name: "rotate and grow [[1, −1], [1, 1]]", m: [[1, -1], [1, 1]] },
  { name: "spiral in [[0.8, −0.3], [0.3, 0.8]]", m: [[0.8, -0.3], [0.3, 0.8]] },
];
export const CUSTOM2 = "your own (use the sliders a, b, c, d)";
export const MATRIX2_OPTIONS = [...MATRICES2.map((p) => p.name), CUSTOM2];

/** 3×3 presets. */
const r3 = Math.sqrt(3);
export const MATRICES3 = [
  { name: "diagonal diag(2, 1, 0.5)", m: [[2, 0, 0], [0, 1, 0], [0, 0, 0.5]] },
  { name: "symmetric [[2, 1, 0], [1, 2, 1], [0, 1, 2]]", m: [[2, 1, 0], [1, 2, 1], [0, 1, 2]] },
  { name: "masses on springs [[2, −1, 0], [−1, 2, −1], [0, −1, 2]]", m: [[2, -1, 0], [-1, 2, -1], [0, -1, 2]] },
  { name: "covariance of a data cloud", m: [[3, 1.5, 0.5], [1.5, 2, 0.3], [0.5, 0.3, 0.6]] },
  { name: "upper triangular [[2, 1, 0], [0, 3, 1], [0, 0, 1]]", m: [[2, 1, 0], [0, 3, 1], [0, 0, 1]] },
  { name: "three-state Markov chain", m: [[0.8, 0.1, 0.1], [0.1, 0.7, 0.3], [0.1, 0.2, 0.6]] },
  { name: "rotation by 60° about the z-axis", m: [[0.5, -r3 / 2, 0], [r3 / 2, 0.5, 0], [0, 0, 1]] },
  { name: "cyclic shift (x, y, z) → (z, x, y)", m: [[0, 0, 1], [1, 0, 0], [0, 1, 0]] },
  { name: "projection onto the plane x + y + z = 0", m: [[2 / 3, -1 / 3, -1 / 3], [-1 / 3, 2 / 3, -1 / 3], [-1 / 3, -1 / 3, 2 / 3]] },
  { name: "shear chain [[1, 1, 0], [0, 1, 1], [0, 0, 1]]", m: [[1, 1, 0], [0, 1, 1], [0, 0, 1]] },
];
export const MATRIX3_OPTIONS = MATRICES3.map((p) => p.name);

export function preset2(name) {
  const p = MATRICES2.find((q) => q.name === name);
  if (!p) throw new Error(`unknown matrix ${name}`);
  return p.m.map((r) => r.slice());
}
export function preset3(name) {
  const p = MATRICES3.find((q) => q.name === name);
  if (!p) throw new Error(`unknown matrix ${name}`);
  return p.m.map((r) => r.slice());
}

// --- small vector helpers -----------------------------------------------------
export const dot = (u, v) => u.reduce((s, x, i) => s + x * v[i], 0);
export const norm = (u) => Math.sqrt(dot(u, u));
export const unit = (u) => { const n = norm(u); return n > 0 ? u.map((x) => x / n) : u.slice(); };
export const apply = (m, v) => m.map((row) => dot(row, v));
export const matMul = (a, b) => a.map((row) => b[0].map((_, j) => row.reduce((s, x, k) => s + x * b[k][j], 0)));
export const cross = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
const snap = (x) => (Math.abs(x) < 1e-12 ? 0 : x);
const byMagnitude = (p, q) => (Math.abs(q) - Math.abs(p)) || (q - p);

/** Make the first entry of largest size positive, so a vector's sign is stable. */
function fixSign(v) {
  let k = 0;
  for (let i = 1; i < v.length; i++) if (Math.abs(v[i]) > Math.abs(v[k]) + 1e-12) k = i;
  return v[k] < 0 ? v.map((x) => snap(-x)) : v.map(snap);
}

// --- 2×2 ------------------------------------------------------------------------
export const trace2 = (m) => m[0][0] + m[1][1];
export const det2 = (m) => m[0][0] * m[1][1] - m[0][1] * m[1][0];

/** A unit vector in the null space of the 2×2 matrix B (assumed singular, not zero). */
function null2(B) {
  const rows = [B[0], B[1]].sort((p, q) => norm(q) - norm(p));
  const [p, q] = rows[0];
  return fixSign(unit([-q, p]));
}

/**
 * Eigen-decomposition of a real 2×2 matrix.
 * Returns { tr, det, disc, kind, values, vectors, re?, im?, modulus?, angleDeg? } where
 * kind is "real" (two different real λ), "repeated" (one λ, one direction:
 * defective), "scalar" (λI: every vector is an eigenvector) or "complex".
 * values: real λs, largest |λ| first; vectors: matching unit vectors.
 */
export function eig2(m) {
  const tr = trace2(m), det = det2(m);
  const disc = tr * tr - 4 * det;
  const scale = Math.max(1, tr * tr, Math.abs(det));
  if (disc > 1e-10 * scale) {
    const s = Math.sqrt(disc);
    const values = [(tr + s) / 2, (tr - s) / 2].sort(byMagnitude);
    const vectors = values.map((l) => null2([[m[0][0] - l, m[0][1]], [m[1][0], m[1][1] - l]]));
    return { tr, det, disc, kind: "real", values, vectors };
  }
  if (disc >= -1e-10 * scale) {
    const l = tr / 2;
    const B = [[m[0][0] - l, m[0][1]], [m[1][0], m[1][1] - l]];
    if (Math.max(...B.flat().map(Math.abs)) < 1e-9) return { tr, det, disc: 0, kind: "scalar", values: [l, l], vectors: [[1, 0], [0, 1]] };
    return { tr, det, disc: 0, kind: "repeated", values: [l, l], vectors: [null2(B)] };
  }
  const re = tr / 2, im = Math.sqrt(-disc) / 2;
  return { tr, det, disc, kind: "complex", values: [], vectors: [], re, im,
    modulus: Math.hypot(re, im), angleDeg: (Math.atan2(im, re) * 180) / Math.PI };
}

/** For a unit vector at angle θ (degrees): Av, and its parts along v (v·Av) and sideways (v × Av). */
export function probe2(m, thetaDeg) {
  const th = (thetaDeg * Math.PI) / 180;
  const v = [Math.cos(th), Math.sin(th)];
  const Av = apply(m, v);
  const along = dot(v, Av), side = v[0] * Av[1] - v[1] * Av[0];
  const turnDeg = (Math.atan2(side, along) * 180) / Math.PI;
  return { v, Av, along, side, stretch: norm(Av), turnDeg };
}

/** Angle in degrees, in [0, 180), of a direction. */
export const angleOf = (v) => { let a = (Math.atan2(v[1], v[0]) * 180) / Math.PI; a = ((a % 180) + 180) % 180; return a > 180 - 1e-9 ? 0 : a; };

/** A^k v for k = 0 … n. */
export function powers(m, v, n) {
  const out = [v.slice()];
  for (let k = 1; k <= n; k++) out.push(apply(m, out[k - 1]));
  return out;
}

// --- 3×3 ------------------------------------------------------------------------
export const trace3 = (m) => m[0][0] + m[1][1] + m[2][2];
export const det3 = (m) => dot(m[0], cross(m[1], m[2]));
/** Sum of the three principal 2×2 minors. */
export const minors3 = (m) =>
  m[0][0] * m[1][1] - m[0][1] * m[1][0] + m[0][0] * m[2][2] - m[0][2] * m[2][0] + m[1][1] * m[2][2] - m[1][2] * m[2][1];

/** det(A − λI) = −(λ³ − c2 λ² + c1 λ − c0); returns [c2, c1, c0] = [trace, minors, det]. */
export const charCoeffs3 = (m) => [trace3(m), minors3(m), det3(m)];
/** p(λ) = λ³ − c2 λ² + c1 λ − c0, so p(λ) = det(λI − A). */
export const charPoly3 = (m, l) => { const [c2, c1, c0] = charCoeffs3(m); return ((l - c2) * l + c1) * l - c0; };
export const charPoly2 = (m, l) => (l - trace2(m)) * l + det2(m);

/** Roots of the monic cubic λ³ + a λ² + b λ + c: { real: [...], complex: [{re, im}] }. */
export function cubicRoots(a, b, c) {
  const f = (x) => ((x + a) * x + b) * x + c;
  const R = 1 + Math.max(Math.abs(a), Math.abs(b), Math.abs(c));
  let lo = -R, hi = R;
  for (let i = 0; i < 200; i++) { const mid = (lo + hi) / 2; if (f(mid) > 0) hi = mid; else lo = mid; }
  let r = (lo + hi) / 2;
  // Two Newton steps polish it.
  for (let i = 0; i < 3; i++) { const d = (3 * r + 2 * a) * r + b; if (Math.abs(d) > 1e-14) r -= f(r) / d; }
  // Deflate: λ² + p λ + q.
  const p = a + r, q = b + p * r;
  const disc = p * p - 4 * q;
  const tol = 1e-9 * Math.max(1, p * p, Math.abs(q));
  if (disc > tol) {
    const s = Math.sqrt(disc);
    return { real: [r, (-p + s) / 2, (-p - s) / 2], complex: [] };
  }
  if (disc >= -tol) return { real: [r, -p / 2, -p / 2], complex: [] };
  return { real: [r], complex: [{ re: -p / 2, im: Math.sqrt(-disc) / 2 }] };
}

/** Clean near-equal roots (from rounding) so repeated eigenvalues read as equal. */
function tidy(xs) {
  // A triple root comes out of floating point spread by about 1e-5, so roots
  // closer than 1e-4 are one root (replaced by their mean).
  const out = xs.slice();
  for (let i = 0; i < out.length; i++) {
    const near = out.map((x, j) => j).filter((j) => Math.abs(out[j] - out[i]) < 1e-4 * Math.max(1, Math.abs(out[i])));
    const mean = near.reduce((s, j) => s + out[j], 0) / near.length;
    for (const j of near) out[j] = mean;
  }
  return out.map((x) => (Math.abs(x - Math.round(x * 1e9) / 1e9) < 1e-10 ? Math.round(x * 1e9) / 1e9 : x));
}

/**
 * The eigenspace of λ for a 3×3 matrix: an array of 0–3 orthonormal vectors.
 * The rank of A − λI decides it: rank 2 gives a line, rank 1 a plane, rank 0 everything.
 */
export function eigenspace3(m, l) {
  const B = m.map((row, i) => row.map((x, j) => x - (i === j ? l : 0)));
  const big = Math.max(1, ...m.flat().map(Math.abs));
  const pairs = [[0, 1], [0, 2], [1, 2]].map(([i, j]) => cross(B[i], B[j]));
  pairs.sort((p, q) => norm(q) - norm(p));
  if (norm(pairs[0]) > 1e-6 * big * big) return [fixSign(unit(pairs[0]))];
  const rows = B.slice().sort((p, q) => norm(q) - norm(p));
  if (norm(rows[0]) < 1e-7 * big) return [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const n = unit(rows[0]);
  // Two orthonormal vectors perpendicular to n.
  const helper = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const e1 = unit(cross(n, helper));
  const e2 = unit(cross(n, e1));
  return [fixSign(e1), fixSign(e2)];
}

/** For a complex pair re ± j·im: the real plane A turns, as two vectors u, w with A(u + jw) = λ(u + jw). */
function complexPlane3(m, re, im) {
  // Rows of B = A − λI as complex numbers [re, im].
  const B = m.map((row, i) => row.map((x, j) => [x - (i === j ? re : 0), i === j ? -im : 0]));
  const mul = (p, q) => [p[0] * q[0] - p[1] * q[1], p[0] * q[1] + p[1] * q[0]];
  const sub = (p, q) => [p[0] - q[0], p[1] - q[1]];
  const ccross = (u, v) => [sub(mul(u[1], v[2]), mul(u[2], v[1])), sub(mul(u[2], v[0]), mul(u[0], v[2])), sub(mul(u[0], v[1]), mul(u[1], v[0]))];
  const cands = [[0, 1], [0, 2], [1, 2]].map(([i, j]) => ccross(B[i], B[j]));
  const size = (z) => Math.sqrt(z.reduce((s, [a, b]) => s + a * a + b * b, 0));
  cands.sort((p, q) => size(q) - size(p));
  const z = cands[0];
  const u = z.map((c) => c[0]), w = z.map((c) => c[1]);
  return { u: unit(u), w: unit(w), uRaw: u, wRaw: w };
}

/**
 * Eigen-decomposition of a real 3×3 matrix.
 * Returns { coeffs: [trace, minors, det], values: real λs (largest |λ| first, with repeats),
 * distinct: [{ value, alg, vectors }], complex: [{ re, im, modulus, angleDeg, u, w }],
 * symmetric, defective }.
 */
export function eig3(m) {
  const [c2, c1, c0] = charCoeffs3(m);
  const roots = cubicRoots(-c2, c1, -c0);
  const values = tidy(roots.real).sort(byMagnitude);
  const distinct = [];
  for (const v of values) {
    const d = distinct.find((q) => q.value === v);
    if (d) d.alg++; else distinct.push({ value: v, alg: 1 });
  }
  for (const d of distinct) d.vectors = eigenspace3(m, d.value).slice(0, d.alg);
  const complex = roots.complex.map(({ re, im }) => ({ re, im, modulus: Math.hypot(re, im),
    angleDeg: (Math.atan2(im, re) * 180) / Math.PI, ...complexPlane3(m, re, im) }));
  const symmetric = Math.abs(m[0][1] - m[1][0]) + Math.abs(m[0][2] - m[2][0]) + Math.abs(m[1][2] - m[2][1]) < 1e-12;
  const defective = distinct.some((d) => d.vectors.length < d.alg);
  return { coeffs: [c2, c1, c0], values, distinct, complex, symmetric, defective };
}

/** Points of a unit circle (n of them) in the plane spanned by orthonormal e1, e2. */
export function circle3(e1, e2, n = 48) {
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = (2 * Math.PI * i) / n;
    return [0, 1, 2].map((k) => Math.cos(t) * e1[k] + Math.sin(t) * e2[k]);
  });
}

/** Direction (unit vector) from two angles in degrees: around the z-axis, and up from the xy-plane. */
export function dir3(aroundDeg, upDeg) {
  const a = (aroundDeg * Math.PI) / 180, u = (upDeg * Math.PI) / 180;
  return [Math.cos(u) * Math.cos(a), Math.cos(u) * Math.sin(a), Math.sin(u)];
}

/** The angle in degrees between the lines through u and v (0–90). */
export function lineAngle(u, v) {
  const c = Math.abs(dot(u, v)) / (norm(u) * norm(v) || 1);
  return (Math.acos(Math.min(1, c)) * 180) / Math.PI;
}

/** Number formatting shared by both viewers: d decimals, minus sign, no "−0". */
const SUP = { "-": "⁻", 0: "⁰", 1: "¹", 2: "²", 3: "³", 4: "⁴", 5: "⁵", 6: "⁶", 7: "⁷", 8: "⁸", 9: "⁹" };
/** Very large numbers as 1.23×10⁹. */
function big(x) {
  const [m, e] = x.toExponential(2).split("e");
  return `${m.replace("-", "−")}×10${String(Number(e)).split("").map((c) => SUP[c]).join("")}`;
}
export function fmt(x, d = 2) {
  if (!Number.isFinite(x)) return x > 0 ? "∞" : "−∞";
  if (Math.abs(x) >= 1e5) return big(x);
  const v = Math.abs(x) < 0.5 * 10 ** -d ? 0 : x;
  return v.toFixed(d).replace("-", "−");
}
/** Short form: up to d decimals, trailing zeros dropped. */
export function sfmt(x, d = 3) {
  if (Number.isFinite(x) && Math.abs(x) >= 1e5) return big(x);
  const v = Math.abs(x) < 0.5 * 10 ** -d ? 0 : x;
  return String(Number(v.toFixed(d))).replace("-", "−");
}

/**
 * A monic polynomial as text, highest power first: coeffs [c_{n−1}, …, c_0] of
 * λⁿ + c_{n−1}λⁿ⁻¹ + … + c_0. Zero terms are dropped, unit coefficients
 * written as λ, signs folded: polyText([-6, 10, -4]) = "λ³ − 6λ² + 10λ − 4".
 */
export function polyText(coeffs) {
  const n = coeffs.length;
  const pow = (k) => (k === 0 ? "" : k === 1 ? "λ" : `λ${"⁰¹²³⁴⁵⁶⁷⁸⁹"[k]}`);
  let out = pow(n);
  coeffs.forEach((c, i) => {
    const k = n - 1 - i;
    const r = Number(c.toFixed(3));
    if (Math.abs(r) < 5e-4) return;
    const mag = Math.abs(r);
    const body = k > 0 && Math.abs(mag - 1) < 5e-4 ? pow(k) : `${sfmt(mag)}${pow(k)}`;
    out += `${r < 0 ? " − " : " + "}${body}`;
  });
  return out;
}
