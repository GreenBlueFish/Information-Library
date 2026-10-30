// src/widgets/types/stdp-explorer.js
//
// The `stdp-explorer` widget type: the spike-timing-dependent plasticity
// (STDP) learning window and what repeated pairings do to one synapse, for the
// "STDP" lesson of the computational cortical columns topic.
//
// Pair-based STDP window (Bi & Poo 1998 measured it; the exponential form is
// the one used by Song, Miller & Abbott 2000), with Δt = t_post − t_pre:
//
//   Δw(Δt) = +A+ · exp(−Δt/τ+)    for Δt > 0   (pre before post → potentiation)
//   Δw(Δt) = −A− · exp(+Δt/τ−)    for Δt < 0   (post before pre → depression)
//   Δw(0)  = 0                                  (convention used here)
//
// Weight dependence (the `rule` control):
//   additive        w ← clip(w + Δw, 0, wMax)                 (hard bounds;
//                   Song, Miller & Abbott 2000) — repeated pairings march the
//                   weight linearly until it hits a bound, which makes the
//                   weight distribution bimodal.
//   multiplicative  potentiation scaled by (wMax − w), depression scaled by w
//                   (soft bounds, in the spirit of van Rossum, Bi & Turrigiano
//                   2000 and Rubin, Lee & Sompolinsky 2001):
//                     Δt > 0: w ← w + A+·e^(−Δt/τ+)·(wMax − w)
//                     Δt < 0: w ← w − A−·e^(Δt/τ−)·w
//                   so the weight approaches wMax (or 0) geometrically and
//                   never overshoots — soft-bounded convergence. The result is
//                   still clipped to [0, wMax] as a safety net.
//
// Integral of the window:  ∫Δw dΔt = A+·τ+ − A−·τ−.  When it is negative the
// rule is biased toward depression: uncorrelated (random-timing) pre/post
// firing then weakens synapses on average, and only causally correlated inputs
// grow. Song, Miller & Abbott (2000) used this slight depression bias to get
// stable, competitive learning (A−τ− a little larger than A+τ+, as in the
// defaults 0.0105·20 > 0.01·20).
//
// Online traces (how simulators implement the same rule without storing spike
// times; e.g. Morrison, Diesmann & Gerstner 2008): each synapse keeps a
// presynaptic trace x_pre and the postsynaptic neuron a trace x_post, both
// decaying exponentially (τ+ for x_pre, τ− for x_post) and incremented by 1 at
// each of their own spikes. At a postsynaptic spike, w += A+·x_pre (reads how
// recently the pre neuron fired → the e^(−Δt/τ+) branch); at a presynaptic
// spike, w −= A−·x_post (the e^(Δt/τ−) branch). For an isolated pre/post pair
// this reproduces the window above exactly ("all-to-all" pairing if traces add
// up, "nearest-spike" if they are reset to 1 instead).
//
// This widget pairs one pre and one post spike at the selected Δt, `pairings`
// times, starting from w0, and plots the weight after each pairing.
//
// Exports pure, DOM-free functions for tests: stdpWindow, applyPairing,
// weightTrajectory, windowIntegral, normalizeStdpConfig.

import { registerWidget } from "../registry.js";
import { buildFrame, buildControlPanel, buildReadout, buildStage, svgEl } from "../sim-kit.js";

/** Contract defaults for `params` (used when a spec omits them). */
export const STDP_PARAMS = [
  { key: "aPlus", label: "A+ (potentiation amplitude)", control: "range", min: 0, max: 0.02, step: 0.0005, default: 0.01 },
  { key: "aMinus", label: "A− (depression amplitude)", control: "range", min: 0, max: 0.02, step: 0.0005, default: 0.0105 },
  { key: "tauPlus", label: "τ+ (ms)", control: "range", min: 5, max: 50, step: 1, default: 20 },
  { key: "tauMinus", label: "τ− (ms)", control: "range", min: 5, max: 50, step: 1, default: 20 },
  { key: "deltaT", label: "Δt = t_post − t_pre (ms)", control: "range", min: -100, max: 100, step: 1, default: 10 },
  { key: "rule", label: "Weight dependence", control: "select", options: ["additive", "multiplicative"], default: "additive" },
];

/** Contract defaults for `config`. */
export const STDP_CONFIG = { pairings: 60, w0: 0.5, wMax: 1 };

/** Cap on pairings drawn (keeps redraws fast for any config). */
const MAX_PAIRINGS = 2000;
/** Window plot range (ms). */
const DT_RANGE = 100;

/**
 * Merge a (possibly partial or malformed) config with the contract defaults.
 * pairings is a positive integer ≤ MAX_PAIRINGS; wMax > 0; w0 is clipped to
 * [0, wMax].
 * @param {Object} [config]
 * @returns {typeof STDP_CONFIG}
 */
export function normalizeStdpConfig(config) {
  const c = config && typeof config === "object" ? config : {};
  const finite = (v) => typeof v === "number" && Number.isFinite(v);
  const pairings = finite(c.pairings) && c.pairings >= 1
    ? Math.min(MAX_PAIRINGS, Math.round(c.pairings))
    : STDP_CONFIG.pairings;
  const wMax = finite(c.wMax) && c.wMax > 0 ? c.wMax : STDP_CONFIG.wMax;
  const w0Raw = finite(c.w0) ? c.w0 : STDP_CONFIG.w0;
  return { pairings, w0: Math.min(wMax, Math.max(0, w0Raw)), wMax };
}

/**
 * The STDP window: weight change for one pre/post pair at Δt = t_post − t_pre.
 * @param {number} dt  Δt (ms)
 * @param {{ aPlus?: number, aMinus?: number, tauPlus?: number, tauMinus?: number }} [p]
 * @returns {number}
 */
export function stdpWindow(dt, p = {}) {
  const q = withParamDefaults(p);
  if (dt > 0) return q.aPlus * Math.exp(-dt / q.tauPlus);
  if (dt < 0) return -q.aMinus * Math.exp(dt / q.tauMinus);
  return 0;
}

/**
 * Apply one pairing at Δt to weight w under the given rule, clipped to [0, wMax].
 * @param {number} w
 * @param {number} dt
 * @param {{ aPlus?: number, aMinus?: number, tauPlus?: number, tauMinus?: number, wMax?: number }} [p]
 * @param {"additive"|"multiplicative"} [rule]
 * @returns {number}
 */
export function applyPairing(w, dt, p = {}, rule = "additive") {
  const wMax = typeof p.wMax === "number" && p.wMax > 0 ? p.wMax : STDP_CONFIG.wMax;
  const raw = stdpWindow(dt, p);
  let next;
  if (rule === "multiplicative") {
    next = raw >= 0 ? w + raw * (wMax - w) : w + raw * w;
  } else {
    next = w + raw;
  }
  return Math.min(wMax, Math.max(0, next));
}

/**
 * Weight after each of `pairings` repeated pairings at Δt, starting at w0.
 * @param {number} w0
 * @param {number} dt
 * @param {number} pairings
 * @param {{ aPlus?: number, aMinus?: number, tauPlus?: number, tauMinus?: number, wMax?: number }} [p]
 * @param {"additive"|"multiplicative"} [rule]
 * @returns {number[]} length pairings + 1; element 0 is w0
 */
export function weightTrajectory(w0, dt, pairings, p = {}, rule = "additive") {
  const n = Math.max(0, Math.min(MAX_PAIRINGS, Math.round(pairings) || 0));
  const out = [w0];
  let w = w0;
  for (let i = 0; i < n; i++) {
    w = applyPairing(w, dt, p, rule);
    out.push(w);
  }
  return out;
}

/**
 * Integral of the window over all Δt: A+·τ+ − A−·τ− (weight units × ms).
 * Negative → net depression bias for uncorrelated spiking.
 * @param {{ aPlus?: number, aMinus?: number, tauPlus?: number, tauMinus?: number }} [p]
 * @returns {number}
 */
export function windowIntegral(p = {}) {
  const q = withParamDefaults(p);
  return q.aPlus * q.tauPlus - q.aMinus * q.tauMinus;
}

/* -------------------------------------------------------------------------- */
/* Widget                                                                     */
/* -------------------------------------------------------------------------- */

registerWidget("stdp-explorer", (ctx) => mountStdp(ctx));

/**
 * @param {import("../registry.js").WidgetContext} ctx
 * @returns {import("../registry.js").WidgetInstance}
 */
function mountStdp(ctx) {
  const spec = ctx.spec ?? {};
  const params = Array.isArray(spec.params) && spec.params.length > 0 ? spec.params : STDP_PARAMS;
  const config = normalizeStdpConfig(spec.config);

  const { doc, root } = buildFrame(ctx.container, spec);
  const panel = buildControlPanel(doc, root, params, () => redraw());
  const windowStage = buildStage(doc, root, 640, 270, "STDP learning window: weight change versus spike timing");
  const trajStage = buildStage(doc, root, 640, 230, "Synaptic weight over repeated pairings");
  const readout = buildReadout(doc, root);
  let destroyed = false;

  function currentParams() {
    const s = panel.state;
    const q = withParamDefaults(s);
    const fallbackDt = STDP_PARAMS[4].default;
    const deltaT = typeof s.deltaT === "number" && Number.isFinite(s.deltaT) ? s.deltaT : fallbackDt;
    const rule = s.rule === "multiplicative" || s.rule === "additive" ? s.rule : "additive";
    return { ...q, wMax: config.wMax, deltaT, rule };
  }

  function redraw() {
    if (destroyed) return;
    const p = currentParams();
    const traj = weightTrajectory(config.w0, p.deltaT, config.pairings, p, p.rule);
    const other = p.rule === "additive" ? "multiplicative" : "additive";
    const trajOther = weightTrajectory(config.w0, p.deltaT, config.pairings, p, other);
    const raw = stdpWindow(p.deltaT, p);
    const first = applyPairing(config.w0, p.deltaT, p, p.rule) - config.w0;
    const integral = windowIntegral(p);

    windowStage.clear();
    drawWindow(doc, windowStage.svg, p, raw);
    trajStage.clear();
    drawTrajectory(doc, trajStage.svg, config, p, traj, trajOther, other);

    const bias = integral < 0
      ? "net depression bias: uncorrelated firing weakens synapses on average, which keeps learning stable and competitive (Song, Miller & Abbott 2000)"
      : integral > 0
        ? "net potentiation bias: even uncorrelated firing strengthens synapses on average, so weights tend to run away to the upper bound"
        : "balanced window: uncorrelated firing gives no net drift on average";
    readout.textContent = [
      `Δw(Δt = ${p.deltaT} ms) = ${signed(raw, 5)} (window)`,
      `first pairing from w0 = ${fmt(config.w0, 3)} (${p.rule}): ${signed(first, 5)}`,
      `final weight after ${config.pairings} pairings: ${fmt(traj[traj.length - 1], 3)}`,
      `window integral A+τ+ − A−τ− = ${signed(integral, 4)} ms: ${bias}`,
    ].join(" · ");
  }

  redraw();

  return {
    update(partial) {
      if (destroyed) return;
      if (panel.update(partial)) redraw();
    },
    destroy() {
      destroyed = true;
      panel.destroy();
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Drawing                                                                    */
/* -------------------------------------------------------------------------- */

function drawWindow(doc, svg, p, raw) {
  const amp = Math.max(p.aPlus, p.aMinus, 0.001) * 1.15;
  const box = makeBox(64, 14, 560, 200, -DT_RANGE, DT_RANGE, -amp, amp);
  drawAxes(doc, svg, box, {
    xTicks: [-100, -50, 0, 50, 100],
    yTicks: [-amp / 1.15, 0, amp / 1.15].map((v) => Math.round(v * 1e4) / 1e4),
    xLabel: "Δt = t_post − t_pre (ms)",
    yLabel: "Δw",
  });

  // Zero line.
  svg.appendChild(svgEl(doc, "line", { class: "plot-axis", x1: box.x0, x2: box.x1, y1: box.sy(0), y2: box.sy(0) }));

  // Depression branch (Δt < 0) and potentiation branch (Δt > 0).
  const n = 100;
  const dep = [];
  const pot = [];
  for (let i = 0; i <= n; i++) {
    const d = -DT_RANGE + (DT_RANGE * i) / n; // −100 … 0
    dep.push([d, d === 0 ? -p.aMinus : stdpWindow(d, p)]);
    const u = (DT_RANGE * i) / n; // 0 … 100
    pot.push([u, u === 0 ? p.aPlus : stdpWindow(u, p)]);
  }
  svg.appendChild(svgEl(doc, "path", { class: "sim-trace plot-series--2", "stroke-dasharray": "6 3", d: pathFor(dep, box) }));
  svg.appendChild(svgEl(doc, "path", { class: "sim-trace plot-series--1", d: pathFor(pot, box) }));

  // Marker at the selected Δt.
  const mx = box.sx(p.deltaT);
  const my = box.sy(raw);
  svg.appendChild(svgEl(doc, "line", { class: "plot-grid", x1: mx, x2: mx, y1: box.y0, y2: box.y1 }));
  svg.appendChild(svgEl(doc, "circle", { class: "plot-series--4", cx: mx, cy: my, r: 5 }));
  const markLabel = svgEl(doc, "text", {
    class: "sim-label",
    x: p.deltaT > 40 ? mx - 8 : mx + 8,
    y: raw >= 0 ? my + 18 : my - 10,
    "text-anchor": p.deltaT > 40 ? "end" : "start",
  });
  markLabel.textContent = `Δt = ${p.deltaT} ms, Δw = ${signed(raw, 5)}`;
  svg.appendChild(markLabel);

  // Legend (line style + text, not color alone).
  const legend = [
    ["plot-series--1", null, "potentiation, Δt > 0 (pre before post): +A+·e^(−Δt/τ+)"],
    ["plot-series--2", "6 3", "depression, Δt < 0 (post before pre): −A−·e^(Δt/τ−)"],
  ];
  legend.forEach(([cls, dash, text], i) => {
    const y = box.y0 + 12 + i * 16;
    const attrs = { class: `sim-trace ${cls}`, x1: box.x0 + 6, x2: box.x0 + 26, y1: y - 4, y2: y - 4 };
    if (dash) attrs["stroke-dasharray"] = dash;
    svg.appendChild(svgEl(doc, "line", attrs));
    const label = svgEl(doc, "text", { class: "sim-label", x: box.x0 + 32, y });
    label.textContent = text;
    svg.appendChild(label);
  });
}

function drawTrajectory(doc, svg, config, p, traj, trajOther, otherRule) {
  const n = traj.length - 1;
  const box = makeBox(64, 14, 560, 170, 0, Math.max(1, n), 0, config.wMax);
  drawAxes(doc, svg, box, {
    xTicks: niceTicks(0, Math.max(1, n), 5),
    yTicks: [0, config.wMax / 2, config.wMax].map((v) => Math.round(v * 1000) / 1000),
    xLabel: "pairing number",
    yLabel: "weight w",
  });

  const pts = (arr) => arr.map((w, i) => [i, w]);
  svg.appendChild(svgEl(doc, "path", { class: "sim-trace plot-series--5", "stroke-dasharray": "4 4", d: pathFor(pts(trajOther), box) }));
  svg.appendChild(svgEl(doc, "path", { class: "sim-trace plot-series--3", d: pathFor(pts(traj), box) }));

  const legend = [
    ["plot-series--3", null, `${p.rule} (selected) at Δt = ${p.deltaT} ms`],
    ["plot-series--5", "4 4", `${otherRule} (for comparison)`],
  ];
  legend.forEach(([cls, dash, text], i) => {
    const y = box.y0 + 12 + i * 16;
    const attrs = { class: `sim-trace ${cls}`, x1: box.x0 + 6, x2: box.x0 + 26, y1: y - 4, y2: y - 4 };
    if (dash) attrs["stroke-dasharray"] = dash;
    svg.appendChild(svgEl(doc, "line", attrs));
    const label = svgEl(doc, "text", { class: "sim-label", x: box.x0 + 32, y });
    label.textContent = text;
    svg.appendChild(label);
  });
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function withParamDefaults(p) {
  const o = p && typeof p === "object" ? p : {};
  const fallback = Object.fromEntries(STDP_PARAMS.map((q) => [q.key, q.default]));
  const num = (key, ok) => (typeof o[key] === "number" && Number.isFinite(o[key]) && ok(o[key]) ? o[key] : fallback[key]);
  const nonNeg = (v) => v >= 0;
  const pos = (v) => v > 0;
  return {
    aPlus: num("aPlus", nonNeg),
    aMinus: num("aMinus", nonNeg),
    tauPlus: num("tauPlus", pos),
    tauMinus: num("tauMinus", pos),
  };
}

function signed(v, digits) {
  const s = fmt(Math.abs(v), digits);
  if (Number(s) === 0) return fmt(0, digits);
  return (v < 0 ? "−" : "+") + s;
}

function fmt(v, digits) {
  return Number(v).toFixed(digits);
}

function makeBox(x, y, w, h, xMin, xMax, yMin, yMax) {
  const xSpan = xMax - xMin || 1;
  const ySpan = yMax - yMin || 1;
  return {
    x0: x, x1: x + w, y0: y, y1: y + h,
    sx: (v) => x + ((v - xMin) / xSpan) * w,
    sy: (v) => y + h - ((Math.min(Math.max(v, yMin), yMax) - yMin) / ySpan) * h,
  };
}

function drawAxes(doc, svg, box, { xTicks = [], yTicks = [], xLabel = "", yLabel = "" }) {
  for (const yv of yTicks) {
    const y = box.sy(yv);
    svg.appendChild(svgEl(doc, "line", { class: "plot-grid", x1: box.x0, x2: box.x1, y1: y, y2: y }));
    const label = svgEl(doc, "text", { class: "plot-axis-label", x: box.x0 - 6, y: y + 4, "text-anchor": "end" });
    label.textContent = String(yv);
    svg.appendChild(label);
  }
  for (const xv of xTicks) {
    const label = svgEl(doc, "text", { class: "plot-axis-label", x: box.sx(xv), y: box.y1 + 14, "text-anchor": "middle" });
    label.textContent = String(xv);
    svg.appendChild(label);
  }
  svg.appendChild(svgEl(doc, "line", { class: "plot-axis", x1: box.x0, x2: box.x1, y1: box.y1, y2: box.y1 }));
  svg.appendChild(svgEl(doc, "line", { class: "plot-axis", x1: box.x0, x2: box.x0, y1: box.y0, y2: box.y1 }));
  if (xLabel) {
    const label = svgEl(doc, "text", { class: "plot-axis-label", x: box.x1, y: box.y1 + 28, "text-anchor": "end" });
    label.textContent = xLabel;
    svg.appendChild(label);
  }
  if (yLabel) {
    const cy = Math.round((box.y0 + box.y1) / 2);
    const label = svgEl(doc, "text", {
      class: "plot-axis-label", x: 12, y: cy, "text-anchor": "middle", transform: `rotate(-90 12 ${cy})`,
    });
    label.textContent = yLabel;
    svg.appendChild(label);
  }
}

function pathFor(points, box) {
  let d = "";
  for (const [x, y] of points) d += `${d ? "L" : "M"}${box.sx(x).toFixed(1)} ${box.sy(y).toFixed(1)}`;
  return d;
}

function niceTicks(min, max, count) {
  const raw = (max - min) / Math.max(1, count);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  const ticks = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return ticks;
}
