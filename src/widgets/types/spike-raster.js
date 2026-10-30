// src/widgets/types/spike-raster.js
//
// The `spike-raster` widget type: a small layer of excitatory (E) and
// inhibitory (I) leaky integrate-and-fire neurons driven by switching Poisson
// input patterns, shown as a spike raster plus the sparse distributed
// representation (SDR) each input pattern evokes.
//
// Model (all units dimensionless except time; dt = config.dt ms):
//   - Input: `config.inputs` Poisson lines. Each of `config.patterns` patterns
//     (A, B, C, …) activates a fixed random 20% subset of lines at `inputRate`
//     Hz; every other line fires at a 2 Hz background. Patterns switch every
//     `config.patternMs` ms, so the run lasts patterns × patternMs ms.
//   - E neurons: τE dV/dt = −V + Σ input spikes × w (delta synapses), threshold
//     1, reset 0, 2 ms refractory. Each E cell receives a fixed, seeded, sparse
//     random subset of the input lines (connection probability 0.3, weights
//     uniform in [0.5, 1.5] × W_IN), so different cells prefer different
//     patterns.
//   - Inhibition modes:
//       "none"         no competition: every E cell that reaches threshold
//                      fires. Expect dense activity with large overlap
//                      between the codes for different patterns.
//       "E/I feedback" I cells (τI = 10 ms) are driven by random E→I synapses
//                      and each I spike hyperpolarizes every E cell by
//                      inhibitoryGain × W_IE (a classic recurrent E/I loop,
//                      cf. van Vreeswijk & Sompolinsky 1996; Brunel 2000).
//                      Expect sparser, more balanced activity.
//       "k-WTA"        an abstraction of fast perisomatic inhibition: at each
//                      step only the k E cells with the highest membrane
//                      potential above threshold fire. When more than k
//                      cells cross threshold, the implied inhibitory volley
//                      resets every non-winner (a per-step, gamma-cycle-like
//                      race the most strongly driven cells keep winning).
//                      This is the k-winners-take-all operation of Majani,
//                      Erlanson & Abu-Mostafa (1989), as used by HTM's
//                      spatial pooler (Cui, Ahmad & Hawkins 2017; Ahmad &
//                      Hawkins 2016) to enforce a fixed sparsity. Winners
//                      still rotate somewhat across a window (refractoriness),
//                      so a window's winner set is a few times k.
//     In "none" and "k-WTA" the explicit I population is not connected, so the
//     I band of the raster stays empty (and is labelled so).
//   - SDR per pattern (the window's winner set): the E cells whose spike count
//     in that pattern's window is at least half the top cell's count (and at
//     least SDR_MIN_SPIKES), i.e. the cells that fired most. Readout: active fraction per pattern, mean active
//     fraction, mean pairwise overlap |A ∩ B| between patterns' SDRs.
//
// Exports (pure, no DOM): simulateLayer(opts), kWinners(values, k),
// overlap(a, b). Everything is seeded through makeRng, so a given seed always
// produces the same raster.

import { registerWidget } from "../registry.js";
import {
  buildFrame,
  buildControlPanel,
  buildReadout,
  buildStage,
  svgEl,
  makeRng,
} from "../sim-kit.js";

/** Contract defaults (used when a page omits a param or a config key). */
const DEFAULT_PARAMS = [
  { key: "inhibition", label: "Inhibition", control: "select", options: ["none", "E/I feedback", "k-WTA"], default: "k-WTA" },
  { key: "k", label: "k (winners per step, k-WTA)", control: "range", min: 1, max: 30, step: 1, default: 5 },
  { key: "inhibitoryGain", label: "Inhibitory gain (E/I feedback)", control: "range", min: 0, max: 3, step: 0.1, default: 1.2 },
  { key: "inputRate", label: "Input rate (Hz)", control: "range", min: 5, max: 100, step: 1, default: 40 },
  { key: "seed", label: "Random seed", control: "number", min: 1, max: 9999, step: 1, default: 7 },
];
const DEFAULT_CONFIG = { excitatory: 80, inhibitory: 20, inputs: 100, patterns: 4, patternMs: 75, dt: 1 };

/* Fixed model constants (chosen so the three modes look clearly different). */
const TAU_E = 20; // ms
const TAU_I = 10; // ms
const THRESHOLD = 1;
const V_RESET = 0;
const V_FLOOR = -1; // inhibition cannot drive V below this
const REFRACTORY = 2; // ms
const P_IN = 0.3; // input → E connection probability
const W_IN = 0.35; // mean input weight
const P_EI = 0.5; // E → I connection probability
const W_EI = 0.12; // E → I weight
const W_IE = 0.06; // I → E weight per unit inhibitoryGain
const PATTERN_FRACTION = 0.2;
const BACKGROUND_HZ = 2;
const SDR_MIN_SPIKES = 2;
const SDR_REL = 0.5; // fraction of the window's top spike count
/* Size caps keep a redraw fast whatever a page puts in config. */
const MAX_NEURONS = 200;
const MAX_INPUTS = 400;
const MAX_STEPS = 2000;

/**
 * Indices of the k largest values (ties broken by lower index), in
 * descending value order. Non-finite values never win.
 *
 * @param {ArrayLike<number>} values
 * @param {number} k
 * @returns {number[]}
 */
export function kWinners(values, k) {
  const idx = [];
  for (let i = 0; i < values.length; i++) if (Number.isFinite(values[i])) idx.push(i);
  idx.sort((a, b) => values[b] - values[a] || a - b);
  return idx.slice(0, Math.max(0, Math.floor(k)));
}

/**
 * Number of shared members of two SDRs (arrays or Sets of indices).
 * @param {Iterable<number>} a
 * @param {Iterable<number>} b
 * @returns {number}
 */
export function overlap(a, b) {
  const setB = b instanceof Set ? b : new Set(b);
  let n = 0;
  for (const x of new Set(a)) if (setB.has(x)) n++;
  return n;
}

/**
 * The winner set of one pattern window from per-cell spike counts: cells with
 * count ≥ max(SDR_MIN_SPIKES, SDR_REL × top count).
 *
 * @param {number[]} counts
 * @returns {number[]} sorted cell indices
 */
export function winnerSet(counts) {
  const top = counts.reduce((m, n) => Math.max(m, n), 0);
  const th = Math.max(SDR_MIN_SPIKES, SDR_REL * top);
  const set = [];
  counts.forEach((n, i) => {
    if (n >= th) set.push(i);
  });
  return set;
}

/**
 * Simulate the E/I layer.
 *
 * @param {Object} [opts]
 * @param {"none"|"E/I feedback"|"k-WTA"} [opts.inhibition]
 * @param {number} [opts.k]
 * @param {number} [opts.inhibitoryGain]
 * @param {number} [opts.inputRate]  Hz
 * @param {number} [opts.seed]
 * @param {number} [opts.excitatory]
 * @param {number} [opts.inhibitory]
 * @param {number} [opts.inputs]
 * @param {number} [opts.patterns]
 * @param {number} [opts.patternMs]
 * @param {number} [opts.dt]  ms
 * @returns {{
 *   spikes: Array<{t: number, i: number, inhibitory: boolean}>,
 *   sdrs: number[][],
 *   counts: number[][],
 *   patternLines: number[][],
 *   stats: { activeFractions: number[], meanActiveFraction: number,
 *            meanOverlap: number, meanOverlapFraction: number,
 *            eRate: number, iRate: number, duration: number,
 *            nE: number, nI: number, patterns: number, patternMs: number },
 * }}
 */
export function simulateLayer(opts = {}) {
  const o = { ...DEFAULT_CONFIG, inhibition: "k-WTA", k: 5, inhibitoryGain: 1.2, inputRate: 40, seed: 7, ...clean(opts) };
  const nE = clampInt(o.excitatory, 1, MAX_NEURONS, DEFAULT_CONFIG.excitatory);
  const nI = clampInt(o.inhibitory, 0, MAX_NEURONS, DEFAULT_CONFIG.inhibitory);
  const nIn = clampInt(o.inputs, 1, MAX_INPUTS, DEFAULT_CONFIG.inputs);
  const nPat = clampInt(o.patterns, 1, 26, DEFAULT_CONFIG.patterns);
  const dt = Number.isFinite(o.dt) && o.dt > 0 ? Math.min(o.dt, 5) : DEFAULT_CONFIG.dt;
  let patternMs = Number.isFinite(o.patternMs) && o.patternMs > 0 ? o.patternMs : DEFAULT_CONFIG.patternMs;
  const stepsPerPattern = Math.max(1, Math.min(Math.round(patternMs / dt), Math.floor(MAX_STEPS / nPat)));
  patternMs = stepsPerPattern * dt;
  const steps = stepsPerPattern * nPat;
  const mode = o.inhibition;
  const k = Math.max(1, Math.floor(Number(o.k) || 1));
  const gain = Number.isFinite(o.inhibitoryGain) ? Math.max(0, o.inhibitoryGain) : 1.2;
  const rate = Number.isFinite(o.inputRate) ? Math.max(0, o.inputRate) : 40;
  const useEI = mode === "E/I feedback";

  const rng = makeRng(o.seed);

  // Input patterns: a fixed random subset of lines per pattern.
  const nActiveLines = Math.max(1, Math.round(PATTERN_FRACTION * nIn));
  const patternLines = [];
  const patternMask = [];
  for (let p = 0; p < nPat; p++) {
    const lines = shuffle(range(nIn), rng).slice(0, nActiveLines).sort((a, b) => a - b);
    patternLines.push(lines);
    const mask = new Uint8Array(nIn);
    for (const l of lines) mask[l] = 1;
    patternMask.push(mask);
  }

  // Sparse input → E weights, stored per input line as (target, weight) lists.
  const inTargets = [];
  for (let l = 0; l < nIn; l++) inTargets.push([]);
  for (let i = 0; i < nE; i++) {
    for (let l = 0; l < nIn; l++) {
      if (rng() < P_IN) inTargets[l].push([i, W_IN * (0.5 + rng())]);
    }
  }
  // E → I connections.
  const eiTargets = [];
  for (let i = 0; i < nE; i++) {
    const t = [];
    for (let j = 0; j < nI; j++) if (rng() < P_EI) t.push(j);
    eiTargets.push(t);
  }

  const vE = new Float64Array(nE);
  const vI = new Float64Array(nI);
  const refE = new Float64Array(nE);
  const refI = new Float64Array(nI);
  const decayE = Math.exp(-dt / TAU_E);
  const decayI = Math.exp(-dt / TAU_I);
  const pActive = Math.min(1, (rate * dt) / 1000);
  const pBg = Math.min(1, (BACKGROUND_HZ * dt) / 1000);

  const spikes = [];
  const counts = [];
  for (let p = 0; p < nPat; p++) counts.push(new Array(nE).fill(0));
  let eSpikes = 0;
  let iSpikes = 0;
  let pendingInhibition = 0; // I spikes from the previous step
  const candidates = new Float64Array(nE);

  for (let s = 0; s < steps; s++) {
    const t = s * dt;
    const p = Math.floor(s / stepsPerPattern);
    const mask = patternMask[p];

    // Leak, then synaptic input.
    for (let i = 0; i < nE; i++) vE[i] *= decayE;
    for (let l = 0; l < nIn; l++) {
      if (rng() < (mask[l] ? pActive : pBg)) {
        for (const [i, w] of inTargets[l]) vE[i] += w;
      }
    }
    if (useEI && pendingInhibition > 0) {
      const drop = pendingInhibition * gain * W_IE;
      for (let i = 0; i < nE; i++) vE[i] = Math.max(V_FLOOR, vE[i] - drop);
    }

    // Threshold crossings (refractory cells are held at reset).
    let nCand = 0;
    for (let i = 0; i < nE; i++) {
      if (refE[i] > 0) {
        refE[i] -= dt;
        vE[i] = V_RESET;
        candidates[i] = -Infinity;
      } else if (vE[i] >= THRESHOLD) {
        candidates[i] = vE[i];
        nCand++;
      } else {
        candidates[i] = -Infinity;
      }
    }
    let firing;
    if (mode === "k-WTA" && nCand > k) {
      firing = kWinners(candidates, k);
      // The constraint binds: the implied fast inhibitory volley resets every
      // non-winning E cell (supra- and sub-threshold), so the next race is won
      // again by the most strongly driven cells.
      for (let i = 0; i < nE; i++) vE[i] = V_RESET;
    } else {
      firing = [];
      for (let i = 0; i < nE; i++) if (candidates[i] !== -Infinity) firing.push(i);
    }
    for (const i of firing) {
      vE[i] = V_RESET;
      refE[i] = REFRACTORY;
      spikes.push({ t, i, inhibitory: false });
      counts[p][i]++;
      eSpikes++;
    }

    // Inhibitory population (only connected in E/I feedback mode).
    pendingInhibition = 0;
    if (useEI && nI > 0) {
      for (let j = 0; j < nI; j++) vI[j] *= decayI;
      for (const i of firing) for (const j of eiTargets[i]) vI[j] += W_EI;
      for (let j = 0; j < nI; j++) {
        if (refI[j] > 0) {
          refI[j] -= dt;
          vI[j] = V_RESET;
        } else if (vI[j] >= THRESHOLD) {
          vI[j] = V_RESET;
          refI[j] = REFRACTORY;
          spikes.push({ t, i: nE + j, inhibitory: true });
          pendingInhibition++;
          iSpikes++;
        }
      }
    }
  }

  const sdrs = counts.map((c) => winnerSet(c));
  const activeFractions = sdrs.map((s) => s.length / nE);
  const meanActiveFraction = mean(activeFractions);
  const pairOverlaps = [];
  const pairFractions = [];
  for (let a = 0; a < nPat; a++) {
    for (let b = a + 1; b < nPat; b++) {
      const ov = overlap(sdrs[a], sdrs[b]);
      pairOverlaps.push(ov);
      const denom = Math.min(sdrs[a].length, sdrs[b].length);
      pairFractions.push(denom > 0 ? ov / denom : 0);
    }
  }
  const durationS = (steps * dt) / 1000;
  return {
    spikes,
    sdrs,
    counts,
    patternLines,
    stats: {
      activeFractions,
      meanActiveFraction,
      meanOverlap: mean(pairOverlaps),
      meanOverlapFraction: mean(pairFractions),
      eRate: eSpikes / nE / durationS,
      iRate: nI > 0 ? iSpikes / nI / durationS : 0,
      duration: steps * dt,
      nE,
      nI,
      patterns: nPat,
      patternMs,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Widget                                                                     */
/* -------------------------------------------------------------------------- */

registerWidget("spike-raster", (ctx) => mountSpikeRaster(ctx));

const W = 640;
const RASTER_H = 290;
const M = { left: 64, right: 12, top: 22, bottom: 30 };
const PATTERN_NAMES = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function mountSpikeRaster(ctx) {
  const spec = ctx.spec ?? {};
  const params = mergeParams(spec.params);
  const config = { ...DEFAULT_CONFIG, ...(spec.config && typeof spec.config === "object" ? spec.config : {}) };
  const { doc, root } = buildFrame(ctx.container, spec);
  const panel = buildControlPanel(doc, root, params, () => redraw());
  const raster = buildStage(doc, root, W, RASTER_H, "Spike raster of the E and I populations over time");
  const sdrStage = buildStage(doc, root, W, 40, "Per-pattern SDRs of the E population");
  const readout = buildReadout(doc, root);
  let destroyed = false;

  function redraw() {
    if (destroyed) return;
    const s = panel.state;
    const result = simulateLayer({
      ...config,
      inhibition: s.inhibition,
      k: s.k,
      inhibitoryGain: s.inhibitoryGain,
      inputRate: s.inputRate,
      seed: s.seed,
    });
    drawRaster(doc, raster, result, s.inhibition);
    drawSdrs(doc, sdrStage, result);
    const st = result.stats;
    readout.textContent =
      `${s.inhibition}: mean active fraction ${pct(st.meanActiveFraction)} of ${st.nE} E cells ` +
      `(SDR = cells with ≥ half the top cell's spike count in a pattern window); ` +
      `mean pairwise overlap ${st.meanOverlap.toFixed(1)} cells (${pct(st.meanOverlapFraction)} of the smaller SDR); ` +
      `E rate ${st.eRate.toFixed(1)} Hz` +
      (s.inhibition === "E/I feedback" ? `, I rate ${st.iRate.toFixed(1)} Hz.` : ".");
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

function drawRaster(doc, stage, result, mode) {
  stage.clear();
  const svg = stage.svg;
  const { nE, nI, duration, patterns, patternMs } = result.stats;
  const gap = nI > 0 ? 8 : 0;
  const plotW = W - M.left - M.right;
  const plotH = RASTER_H - M.top - M.bottom;
  const rowH = (plotH - gap) / Math.max(1, nE + nI);
  const x = (t) => M.left + (t / duration) * plotW;
  const y = (row) => M.top + row * rowH + (row >= nE ? gap : 0);

  // Axes.
  svg.appendChild(svgEl(doc, "line", { class: "plot-axis", x1: M.left, y1: M.top + plotH, x2: M.left + plotW, y2: M.top + plotH }));
  svg.appendChild(svgEl(doc, "line", { class: "plot-axis", x1: M.left, y1: M.top, x2: M.left, y2: M.top + plotH }));
  const xLabel = svgEl(doc, "text", { class: "plot-axis-label", x: M.left + plotW / 2, y: RASTER_H - 4, "text-anchor": "middle" });
  xLabel.textContent = `time (ms), 0–${Math.round(duration)}`;
  svg.appendChild(xLabel);

  // Pattern separators and labels.
  for (let p = 0; p < patterns; p++) {
    const x0 = x(p * patternMs);
    if (p > 0) svg.appendChild(svgEl(doc, "line", { class: "plot-grid", x1: x0, y1: M.top - 4, x2: x0, y2: M.top + plotH }));
    const lab = svgEl(doc, "text", { class: "sim-label", x: x(p * patternMs + patternMs / 2), y: M.top - 7, "text-anchor": "middle" });
    lab.textContent = `pattern ${PATTERN_NAMES[p % 26]}`;
    svg.appendChild(lab);
  }

  // Band labels.
  const eLab = svgEl(doc, "text", { class: "sim-label", x: M.left - 6, y: y(nE / 2), "text-anchor": "end", "dominant-baseline": "middle" });
  eLab.textContent = `E (${nE})`;
  svg.appendChild(eLab);
  if (nI > 0) {
    const iLab = svgEl(doc, "text", { class: "sim-label", x: M.left - 6, y: y(nE + nI / 2), "text-anchor": "end", "dominant-baseline": "middle" });
    iLab.textContent = `I (${nI})`;
    svg.appendChild(iLab);
    if (mode !== "E/I feedback") {
      const off = svgEl(doc, "text", { class: "sim-label", x: M.left + plotW / 2, y: y(nE + nI / 2), "text-anchor": "middle", "dominant-baseline": "middle" });
      off.textContent = mode === "k-WTA" ? "I population not used (k-WTA abstracts fast inhibition)" : "I population disconnected";
      svg.appendChild(off);
    }
  }

  // Spikes: one path of short vertical ticks per neuron row (keeps DOM small).
  const rows = new Map();
  for (const sp of result.spikes) {
    let d = rows.get(sp.i);
    if (!d) {
      d = [];
      rows.set(sp.i, d);
    }
    d.push(`M${round1(x(sp.t))} ${round1(y(sp.i))}v${round1(Math.max(1, rowH * 0.9))}`);
  }
  for (const [i, parts] of rows) {
    const cls = i >= nE ? "sim-spike plot-series--2" : "sim-spike plot-series--1";
    svg.appendChild(svgEl(doc, "path", { class: cls, d: parts.join(""), "data-neuron": i }));
  }
}

function drawSdrs(doc, stage, result) {
  stage.clear();
  const svg = stage.svg;
  const { nE, patterns, activeFractions } = result.stats;
  const left = 64;
  const labelW = 70;
  const cell = Math.max(2, Math.min(8, Math.floor((W - left - labelW) / nE)));
  const rowH = cell + 8;
  const top = 18;
  const height = top + patterns * rowH + 4;
  svg.setAttribute("viewBox", `0 0 ${W} ${height}`);
  const title = svgEl(doc, "text", { class: "sim-label", x: left, y: 12 });
  title.textContent = `SDR per pattern: E cells 0–${nE - 1} (filled = active)`;
  svg.appendChild(title);
  for (let p = 0; p < patterns; p++) {
    const yy = top + p * rowH;
    const lab = svgEl(doc, "text", { class: "sim-label", x: left - 6, y: yy + cell, "text-anchor": "end" });
    lab.textContent = PATTERN_NAMES[p % 26];
    svg.appendChild(lab);
    const active = new Set(result.sdrs[p]);
    for (let i = 0; i < nE; i++) {
      svg.appendChild(
        svgEl(doc, "rect", {
          class: active.has(i) ? "sim-cell sim-cell--active" : "sim-cell",
          x: left + i * cell,
          y: yy,
          width: Math.max(1, cell - 1),
          height: cell,
        }),
      );
    }
    const pl = svgEl(doc, "text", { class: "sim-label", x: left + nE * cell + 6, y: yy + cell });
    pl.textContent = `${pct(activeFractions[p])} active`;
    svg.appendChild(pl);
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

function clean(obj) {
  const out = {};
  if (!obj || typeof obj !== "object") return out;
  for (const [k, v] of Object.entries(obj)) if (v !== undefined && v !== null) out[k] = v;
  return out;
}

function clampInt(v, lo, hi, fallback) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

function range(n) {
  return Array.from({ length: n }, (_, i) => i);
}

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function mean(xs) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function pct(f) {
  return `${(100 * f).toFixed(0)}%`;
}

function round1(v) {
  return Math.round(v * 10) / 10;
}
