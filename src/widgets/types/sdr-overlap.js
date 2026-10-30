// src/widgets/types/sdr-overlap.js
//
// The `sdr-overlap` widget type: how robust and how unambiguous sparse
// distributed representations (SDRs) are, following Ahmad & Hawkins (2015),
// "Properties of Sparse Distributed Representations and their Application to
// Hierarchical Temporal Memory" (arXiv:1503.07469) and Ahmad & Hawkins (2016),
// "How do neurons operate on sparse distributed representations? A
// mathematical theory of sparsity, neurons and active dendrites"
// (arXiv:1601.00720).
//
// Model:
//   An SDR is a binary vector of n bits with exactly w active bits.
//   - Capacity: the number of distinct SDRs is C(n, w).
//   - Overlap set: the number of SDRs y (same n, w) that share exactly b active
//     bits with a fixed SDR x is |Ω(x, b)| = C(w, b) · C(n − w, w − b).
//   - Matching: y matches x when overlap(x, y) ≥ θ. The probability that a
//     random SDR falsely matches x is
//         P(false match) = Σ_{b=θ}^{w} |Ω(x, b)| / C(n, w).
//     For θ > w nothing (not even x itself) can match, so P = 0; the widget
//     flags that state in the readout rather than rejecting the control.
//   All binomials are computed as logarithms (a sum of logs, then a
//   log-sum-exp for the tail), so n = 4096, w = 200 never overflows.
//
// Visual: the stored SDR x and a noisy copy y (noise% of x's active bits moved
// to random inactive positions, seeded), drawn on a √n × √n lattice with
// shared bits marked as overlap; and a chart of log10 P(false match) against θ
// for the current n and w, with a marker at the chosen θ.
//
// Exports (pure, no DOM): logBinomial, log10Binomial, log10Capacity,
// log10OverlapSetSize, log10FalseMatchProbability, falseMatchProbability,
// randomSdr, noisyCopy, overlapCount, formatPow10.

import { registerWidget } from "../registry.js";
import {
  buildFrame,
  buildControlPanel,
  buildReadout,
  buildStage,
  svgEl,
  makeRng,
} from "../sim-kit.js";

/** Contract defaults (used when a page omits a param). */
const DEFAULT_PARAMS = [
  { key: "n", label: "Size n (bits)", control: "range", min: 64, max: 4096, step: 64, default: 2048 },
  { key: "w", label: "Active bits w", control: "range", min: 2, max: 200, step: 1, default: 40 },
  { key: "theta", label: "Match threshold θ", control: "range", min: 1, max: 200, step: 1, default: 20 },
  { key: "noise", label: "Noise (% of active bits moved)", control: "range", min: 0, max: 100, step: 1, default: 30 },
  { key: "seed", label: "Random seed", control: "number", min: 1, max: 9999, step: 1, default: 3 },
];

const LN10 = Math.log(10);

/* -------------------------------------------------------------------------- */
/* Combinatorics in log space                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Natural log of the binomial coefficient C(n, k), computed as
 * Σ_{i=1}^{k'} ln((n − k' + i) / i) with k' = min(k, n − k) — exact to double
 * rounding for the sizes used here and free of overflow. Returns −Infinity
 * when C(n, k) = 0 (k < 0 or k > n).
 *
 * @param {number} n non-negative integer
 * @param {number} k integer
 * @returns {number}
 */
export function logBinomial(n, k) {
  if (!Number.isFinite(n) || !Number.isFinite(k) || k < 0 || n < 0 || k > n) return -Infinity;
  const kk = Math.min(k, n - k);
  let s = 0;
  for (let i = 1; i <= kk; i++) s += Math.log((n - kk + i) / i);
  return s;
}

/** log10 C(n, k). */
export function log10Binomial(n, k) {
  return logBinomial(n, k) / LN10;
}

/**
 * log10 of the number of distinct SDRs with n bits and w active: C(n, w).
 * @param {number} n
 * @param {number} w
 * @returns {number}
 */
export function log10Capacity(n, w) {
  return log10Binomial(n, w);
}

/**
 * log10 |Ω(x, b)| = log10 [C(w, b) · C(n − w, w − b)], the number of SDRs
 * sharing exactly b active bits with a given SDR x.
 * @param {number} n
 * @param {number} w
 * @param {number} b
 * @returns {number} −Infinity when no such SDR exists
 */
export function log10OverlapSetSize(n, w, b) {
  return (logBinomial(w, b) + logBinomial(n - w, w - b)) / LN10;
}

/**
 * log10 P(false match) = log10 [Σ_{b=θ}^{w} |Ω(x, b)| / C(n, w)], computed
 * with a log-sum-exp so it is finite even when P underflows a double.
 * θ ≤ 0 is treated as θ = 0 (everything matches, P = 1); θ > w gives
 * −Infinity (P = 0: no SDR, not even x, can match).
 *
 * @param {number} n
 * @param {number} w
 * @param {number} theta
 * @returns {number}
 */
export function log10FalseMatchProbability(n, w, theta) {
  const t = Math.max(0, Math.ceil(theta));
  if (t > w || w > n) return -Infinity;
  const terms = [];
  for (let b = t; b <= w; b++) {
    const lt = logBinomial(w, b) + logBinomial(n - w, w - b);
    if (lt !== -Infinity) terms.push(lt);
  }
  if (terms.length === 0) return -Infinity;
  const mx = Math.max(...terms);
  let s = 0;
  for (const lt of terms) s += Math.exp(lt - mx);
  const lp = (mx + Math.log(s) - logBinomial(n, w)) / LN10;
  return Math.min(0, lp);
}

/**
 * P(false match) as a plain number (may underflow to 0 for extreme sizes; use
 * log10FalseMatchProbability for display).
 * @param {number} n
 * @param {number} w
 * @param {number} theta
 * @returns {number}
 */
export function falseMatchProbability(n, w, theta) {
  const l = log10FalseMatchProbability(n, w, theta);
  return l === -Infinity ? 0 : Math.pow(10, l);
}

/**
 * Format 10^l as "m.mm × 10^e" (or "0" for −Infinity).
 * @param {number} l log10 of the value
 * @param {number} [digits]
 * @returns {string}
 */
export function formatPow10(l, digits = 2) {
  if (l === -Infinity) return "0";
  if (!Number.isFinite(l)) return String(l);
  let e = Math.floor(l);
  let m = Math.pow(10, l - e);
  if (Number(m.toFixed(digits)) >= 10) {
    m /= 10;
    e += 1;
  }
  return `${m.toFixed(digits)} × 10^${e}`;
}

/* -------------------------------------------------------------------------- */
/* SDR helpers                                                                */
/* -------------------------------------------------------------------------- */

/**
 * A random SDR: w distinct active indices out of n, sorted ascending.
 * @param {number} n
 * @param {number} w
 * @param {() => number} rng
 * @returns {number[]}
 */
export function randomSdr(n, w, rng) {
  const ww = Math.max(0, Math.min(n, Math.floor(w)));
  const chosen = new Set();
  // Floyd's algorithm: exactly ww distinct samples in ww iterations.
  for (let j = n - ww; j < n; j++) {
    const t = Math.floor(rng() * (j + 1));
    chosen.add(chosen.has(t) ? j : t);
  }
  return [...chosen].sort((a, b) => a - b);
}

/**
 * A noisy copy of `sdr`: round(noisePct% × w) of its active bits are moved to
 * random positions that are inactive in `sdr`. The copy keeps exactly w
 * active bits and overlaps `sdr` in w − moved bits.
 *
 * @param {number[]} sdr active indices
 * @param {number} n
 * @param {number} noisePct 0..100
 * @param {() => number} rng
 * @returns {number[]} sorted active indices
 */
export function noisyCopy(sdr, n, noisePct, rng) {
  const active = [...new Set(sdr)];
  const w = active.length;
  const inactiveCount = n - w;
  const moved = Math.min(
    inactiveCount,
    Math.round((Math.max(0, Math.min(100, noisePct)) / 100) * w),
  );
  // Choose which active bits to drop (partial Fisher–Yates).
  const keep = active.slice();
  for (let i = 0; i < moved; i++) {
    const j = i + Math.floor(rng() * (keep.length - i));
    [keep[i], keep[j]] = [keep[j], keep[i]];
  }
  const kept = keep.slice(moved);
  // Choose `moved` new positions among the bits inactive in the original.
  const isActive = new Set(active);
  const added = new Set();
  while (added.size < moved) {
    const p = Math.floor(rng() * n);
    if (!isActive.has(p)) added.add(p);
  }
  return [...kept, ...added].sort((a, b) => a - b);
}

/**
 * |x · y|: the number of active bits two SDRs share.
 * @param {Iterable<number>} a
 * @param {Iterable<number>} b
 * @returns {number}
 */
export function overlapCount(a, b) {
  const setB = b instanceof Set ? b : new Set(b);
  let c = 0;
  for (const x of new Set(a)) if (setB.has(x)) c++;
  return c;
}

/* -------------------------------------------------------------------------- */
/* Widget                                                                     */
/* -------------------------------------------------------------------------- */

registerWidget("sdr-overlap", (ctx) => mountSdrOverlap(ctx));

const GRID_W = 640;
const GRID = 280; // lattice side, design units
const GRID_TOP = 34;
const GRID_H = GRID_TOP + GRID + 24;
const FULL_GRID_MAX = 256; // draw every cell up to this n; above, only active bits
const CH_W = 640;
const CH_H = 240;
const CM = { left: 64, right: 16, top: 16, bottom: 40 };

function mountSdrOverlap(ctx) {
  const spec = ctx.spec ?? {};
  const params = mergeParams(spec.params);
  const { doc, root } = buildFrame(ctx.container, spec);
  const panel = buildControlPanel(doc, root, params, () => redraw());
  const grids = buildStage(doc, root, GRID_W, GRID_H, "Stored SDR x and noisy copy y, shared bits marked");
  const chart = buildStage(doc, root, CH_W, CH_H, "log10 probability of a false match against threshold θ");
  const readout = buildReadout(doc, root);
  let destroyed = false;

  function redraw() {
    if (destroyed) return;
    const s = panel.state;
    const n = Math.round(Number(s.n));
    const wReq = Math.round(Number(s.w));
    const w = Math.min(wReq, n);
    const theta = Math.round(Number(s.theta));
    const rng = makeRng(s.seed);
    const x = randomSdr(n, w, rng);
    const y = noisyCopy(x, n, Number(s.noise), rng);
    const ov = overlapCount(x, y);
    const lCap = log10Capacity(n, w);
    const lP = log10FalseMatchProbability(n, w, theta);

    drawGrids(doc, grids, n, x, y);
    drawChart(doc, chart, n, w, theta);

    const parts = [];
    if (wReq > n) parts.push(`w capped at n = ${n}.`);
    parts.push(`overlap |x·y| = ${ov} of w = ${w}`);
    if (theta > w) {
      parts.push(
        `θ = ${theta} > w = ${w}: no match possible (even x itself has only ${w} bits), so P(false match) = 0`,
      );
    } else {
      parts.push(ov >= theta ? `matches at θ = ${theta} (${ov} ≥ ${theta})` : `NO match at θ = ${theta} (${ov} < ${theta})`);
      parts.push(`P(false match) = ${formatPow10(lP)}`);
    }
    parts.push(`capacity C(n,w) ≈ 10^${lCap.toFixed(1)}`);
    parts.push(`sparsity w/n = ${((100 * w) / n).toFixed(2)}%`);
    readout.textContent = parts.join("; ") + ".";
  }

  redraw();

  return {
    update(partial) {
      if (panel.update(partial)) redraw();
    },
    destroy() {
      destroyed = true;
      panel.destroy();
    },
  };
}

function drawGrids(doc, stage, n, x, y) {
  stage.clear();
  const svg = stage.svg;
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const cell = GRID / cols;
  const full = n <= FULL_GRID_MAX;
  const ySet = new Set(y);
  const xSet = new Set(x);
  const lefts = [24, GRID_W / 2 + 16];
  const sdrs = [
    { name: "x (stored)", bits: x, other: ySet },
    { name: "y (noisy copy)", bits: y, other: xSet },
  ];
  sdrs.forEach((sd, g) => {
    const left = lefts[g];
    const title = svgEl(doc, "text", { class: "sim-label", x: left, y: 14 });
    title.textContent = `${sd.name}: ${sd.bits.length} of ${n} bits, ${cols}×${rows} lattice`;
    svg.appendChild(title);
    if (full) {
      const on = new Set(sd.bits);
      for (let i = 0; i < n; i++) {
        if (on.has(i)) continue;
        svg.appendChild(cellRect(doc, "sim-cell", left, i, cols, cell));
      }
    } else {
      svg.appendChild(
        svgEl(doc, "rect", { class: "sim-cell", x: left, y: GRID_TOP, width: cols * cell, height: rows * cell }),
      );
    }
    for (const i of sd.bits) {
      const shared = sd.other.has(i);
      svg.appendChild(
        cellRect(doc, shared ? "sim-cell sim-cell--overlap" : "sim-cell sim-cell--active", left, i, cols, cell),
      );
    }
  });
  // Legend: swatches plus words, so color is never the only signal.
  const ly = GRID_TOP + rows * cell + 8;
  const items = [
    ["sim-cell sim-cell--overlap", `shared by x and y (${overlapCount(x, y)})`],
    ["sim-cell sim-cell--active", "active in one SDR only"],
    ["sim-cell", full ? "inactive" : "inactive (background)"],
  ];
  let lx = 24;
  for (const [cls, text] of items) {
    svg.appendChild(svgEl(doc, "rect", { class: cls, x: lx, y: ly, width: 10, height: 10 }));
    const t = svgEl(doc, "text", { class: "sim-label", x: lx + 14, y: ly + 9 });
    t.textContent = text;
    svg.appendChild(t);
    lx += 200;
  }
}

function cellRect(doc, cls, left, i, cols, cell) {
  const r = Math.floor(i / cols);
  const c = i % cols;
  const pad = cell > 4 ? 0.5 : 0;
  return svgEl(doc, "rect", {
    class: cls,
    x: left + c * cell + pad,
    y: GRID_TOP + r * cell + pad,
    width: Math.max(0.6, cell - 2 * pad),
    height: Math.max(0.6, cell - 2 * pad),
    "data-bit": i,
  });
}

function drawChart(doc, stage, n, w, theta) {
  stage.clear();
  const svg = stage.svg;
  const pw = CH_W - CM.left - CM.right;
  const ph = CH_H - CM.top - CM.bottom;
  const pts = [];
  for (let t = 1; t <= w; t++) pts.push({ t, l: log10FalseMatchProbability(n, w, t) });
  const finite = pts.filter((p) => Number.isFinite(p.l));
  const yMin = Math.min(-1, Math.floor(Math.min(...finite.map((p) => p.l), 0)));
  const yMax = 0;
  const xMax = Math.max(2, w);
  const px = (t) => CM.left + ((t - 1) / (xMax - 1)) * pw;
  const py = (l) => CM.top + ((yMax - l) / (yMax - yMin)) * ph;

  // Grid + y ticks.
  const step = niceStep(yMax - yMin);
  for (let v = 0; v >= yMin; v -= step) {
    svg.appendChild(svgEl(doc, "line", { class: "plot-grid", x1: CM.left, y1: py(v), x2: CM.left + pw, y2: py(v) }));
    const lab = svgEl(doc, "text", { class: "plot-axis-label", x: CM.left - 6, y: py(v) + 4, "text-anchor": "end" });
    lab.textContent = String(v);
    svg.appendChild(lab);
  }
  const xStep = niceStep(xMax - 1);
  for (let t = 1; t <= xMax; t += xStep) {
    const lab = svgEl(doc, "text", { class: "plot-axis-label", x: px(t), y: CM.top + ph + 16, "text-anchor": "middle" });
    lab.textContent = String(t);
    svg.appendChild(lab);
  }
  svg.appendChild(svgEl(doc, "line", { class: "plot-axis", x1: CM.left, y1: CM.top + ph, x2: CM.left + pw, y2: CM.top + ph }));
  svg.appendChild(svgEl(doc, "line", { class: "plot-axis", x1: CM.left, y1: CM.top, x2: CM.left, y2: CM.top + ph }));
  const xl = svgEl(doc, "text", { class: "plot-axis-label", x: CM.left + pw / 2, y: CH_H - 6, "text-anchor": "middle" });
  xl.textContent = `match threshold θ (n = ${n}, w = ${w})`;
  svg.appendChild(xl);
  const yl = svgEl(doc, "text", {
    class: "plot-axis-label",
    x: 14,
    y: CM.top + ph / 2,
    "text-anchor": "middle",
    transform: `rotate(-90 14 ${CM.top + ph / 2})`,
  });
  yl.textContent = "log10 P(false match)";
  svg.appendChild(yl);

  // Curve.
  if (finite.length > 0) {
    const d = finite.map((p, i) => `${i === 0 ? "M" : "L"}${round1(px(p.t))} ${round1(py(p.l))}`).join("");
    svg.appendChild(svgEl(doc, "path", { class: "sim-trace plot-series--1", d, fill: "none" }));
  }

  // Marker at θ.
  if (theta <= w) {
    const l = log10FalseMatchProbability(n, w, theta);
    svg.appendChild(svgEl(doc, "line", { class: "sim-threshold", x1: px(theta), y1: CM.top, x2: px(theta), y2: CM.top + ph }));
    svg.appendChild(svgEl(doc, "circle", { class: "plot-series--2", cx: px(theta), cy: py(l), r: 5 }));
    const lab = svgEl(doc, "text", {
      class: "sim-label",
      x: px(theta) + (theta > w / 2 ? -8 : 8),
      y: Math.max(CM.top + 12, py(l) - 8),
      "text-anchor": theta > w / 2 ? "end" : "start",
    });
    lab.textContent = `θ = ${theta}: P = ${formatPow10(l)}`;
    svg.appendChild(lab);
  } else {
    const lab = svgEl(doc, "text", { class: "sim-label", x: CM.left + pw - 4, y: CM.top + 14, "text-anchor": "end" });
    lab.textContent = `θ = ${theta} > w = ${w}: no match possible, P = 0`;
    svg.appendChild(lab);
  }
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function mergeParams(params) {
  const given = Array.isArray(params) ? params.filter((p) => p && typeof p.key === "string") : [];
  const keys = new Set(given.map((p) => p.key));
  return [...given, ...DEFAULT_PARAMS.filter((p) => !keys.has(p.key))];
}

function niceStep(span) {
  const raw = Math.max(1, span / 5);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const m of [1, 2, 5, 10]) if (m * mag >= raw) return m * mag;
  return 10 * mag;
}

function round1(v) {
  return Math.round(v * 10) / 10;
}
