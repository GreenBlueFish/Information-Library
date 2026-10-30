// src/widgets/types/lif-neuron.js
//
// The `lif-neuron` widget type: an interactive leaky integrate-and-fire (LIF)
// neuron for the "Leaky integrate-and-fire" lesson of the computational
// cortical columns topic.
//
// Model (Lapicque 1907; the modern form as in Gerstner, Kistler, Naud &
// Paninski 2014, "Neuronal Dynamics", ch. 1; Dayan & Abbott 2001, ch. 5):
//
//   τm dV/dt = −(V − V_rest) + R·I(t)          (+ noise, see below)
//   if V ≥ θ:  emit a spike, V ← V_reset, hold V at V_reset for t_ref
//
// R is in MΩ and I in nA, so R·I is in mV. The equation is integrated with the
// forward Euler method at `config.dt` over `config.duration` ms (the number of
// steps is capped at MAX_STEPS so an extreme config cannot freeze the page).
//
// Rheobase (the smallest constant current that ever makes the cell fire):
//   I_rh = (θ − V_rest) / R
// Analytic firing rate for a constant current above rheobase (time to charge
// from V_reset to θ, plus the refractory period):
//   T = t_ref + τm · ln( (R·I + V_rest − V_reset) / (R·I + V_rest − θ) ),  f = 1/T
// which, with V_reset = V_rest (the contract default), is the familiar
//   f = 1 / (t_ref + τm · ln( R·I / (R·I − (θ − V_rest)) )).
//
// Input shapes (I is the slider value, D the duration):
//   constant  I(t) = I throughout
//   step      I(t) = 0 for t < 0.2·D, then I
//   ramp      I(t) = I · t / D             (linear 0 → I over the run)
//   sine      I(t) = I · (0.5 + 0.5·sin(2π t / 50 ms))   (20 Hz, between 0 and I)
//
// Noise: σ (mV) is the standard deviation the FREE membrane (no threshold)
// would have around its mean — an Ornstein–Uhlenbeck diffusion added to each
// Euler step as  σ·sqrt(2·dt/τm)·ξ,  ξ ~ N(0,1). With this scaling the
// stationary std of V is σ independently of τm (up to an O(dt/τm) Euler
// correction). The random numbers come from a fixed-seed PRNG (makeRng(1) by
// default), so the same parameters always draw the same trace.
//
// Drawing: the membrane potential trace, a dashed threshold line, spikes as
// short vertical strokes (stylized: an LIF has no spike shape, so we draw each
// spike from θ to θ + SPIKE_HEIGHT mV, which keeps the subthreshold dynamics
// readable), and the input current in a strip below. When `config.showFI` is
// true a second chart shows the analytic f–I curve over 0..4 nA with markers
// at the current I (analytic, noise-free) and the simulated mean rate of the
// trace above.
//
// Exports pure, DOM-free functions for tests: simulateLif, lifRate, rheobase,
// inputCurrentAt, normalizeLifConfig.

import { registerWidget } from "../registry.js";
import {
  buildFrame,
  buildControlPanel,
  buildReadout,
  buildStage,
  svgEl,
  makeRng,
  gaussian,
} from "../sim-kit.js";

/** Contract defaults for `params` (used when a spec omits them). */
export const LIF_PARAMS = [
  { key: "current", label: "Input current I (nA)", control: "range", min: 0, max: 4, step: 0.05, default: 2 },
  { key: "tau", label: "Membrane time constant τm (ms)", control: "range", min: 2, max: 50, step: 1, default: 20 },
  { key: "threshold", label: "Threshold (mV)", control: "range", min: -60, max: -40, step: 0.5, default: -50 },
  { key: "refractory", label: "Refractory period (ms)", control: "range", min: 0, max: 10, step: 0.5, default: 2 },
  { key: "noise", label: "Input noise σ (mV)", control: "range", min: 0, max: 5, step: 0.1, default: 0 },
  { key: "input", label: "Input shape", control: "select", options: ["constant", "step", "ramp", "sine"], default: "step" },
];

/** Contract defaults for `config`. */
export const LIF_CONFIG = { duration: 200, dt: 0.1, vRest: -65, vReset: -65, resistance: 10, showFI: true };

/** Hard cap on Euler steps per run (keeps a redraw fast for any config). */
const MAX_STEPS = 200000;
/** Max points drawn per trace (the trace is decimated beyond this). */
const MAX_DRAW_POINTS = 1000;
/** Height (mV) of the stylized spike stroke above threshold. */
const SPIKE_HEIGHT = 15;
/** Period (ms) of the "sine" input shape. */
const SINE_PERIOD = 50;
/** Fraction of the run before the "step" input switches on. */
const STEP_ONSET = 0.2;
/** f–I curve current range (nA) — the slider range. */
const FI_MAX_CURRENT = 4;

/**
 * Merge a (possibly partial or malformed) config with the contract defaults.
 * @param {Object} [config]
 * @returns {typeof LIF_CONFIG}
 */
export function normalizeLifConfig(config) {
  const c = config && typeof config === "object" ? config : {};
  const pick = (key, ok) => (ok(c[key]) ? c[key] : LIF_CONFIG[key]);
  const finite = (v) => typeof v === "number" && Number.isFinite(v);
  const positive = (v) => finite(v) && v > 0;
  return {
    duration: pick("duration", positive),
    dt: pick("dt", positive),
    vRest: pick("vRest", finite),
    vReset: pick("vReset", finite),
    resistance: pick("resistance", positive),
    showFI: typeof c.showFI === "boolean" ? c.showFI : LIF_CONFIG.showFI,
  };
}

/**
 * Input current (nA) at time t for the given shape.
 * @param {"constant"|"step"|"ramp"|"sine"} shape
 * @param {number} t         time (ms)
 * @param {number} amplitude I (nA)
 * @param {number} duration  run length D (ms)
 * @returns {number}
 */
export function inputCurrentAt(shape, t, amplitude, duration) {
  switch (shape) {
    case "step":
      return t < STEP_ONSET * duration ? 0 : amplitude;
    case "ramp":
      return duration > 0 ? amplitude * Math.min(1, t / duration) : amplitude;
    case "sine":
      return amplitude * (0.5 + 0.5 * Math.sin((2 * Math.PI * t) / SINE_PERIOD));
    case "constant":
    default:
      return amplitude;
  }
}

/**
 * Rheobase current (nA): (θ − V_rest) / R.
 * @param {{ threshold?: number, vRest?: number, resistance?: number }} [opts]
 * @returns {number}
 */
export function rheobase(opts = {}) {
  const o = withModelDefaults(opts);
  return (o.threshold - o.vRest) / o.resistance;
}

/**
 * Analytic firing rate (Hz) of the noise-free LIF for a constant current I (nA).
 * Returns 0 at or below rheobase.
 * @param {number} current
 * @param {{ tau?: number, threshold?: number, refractory?: number, vRest?: number, vReset?: number, resistance?: number }} [opts]
 * @returns {number}
 */
export function lifRate(current, opts = {}) {
  const o = withModelDefaults(opts);
  const drive = o.resistance * current + o.vRest; // steady-state V without threshold
  if (!(drive > o.threshold)) return 0;
  const charge = o.tau * Math.log((drive - o.vReset) / (drive - o.threshold));
  const period = o.refractory + Math.max(0, charge);
  return period > 0 ? 1000 / period : Infinity;
}

/**
 * Euler-integrate the LIF neuron.
 *
 * @param {{ current?: number, tau?: number, threshold?: number, refractory?: number,
 *           noise?: number, input?: string, duration?: number, dt?: number,
 *           vRest?: number, vReset?: number, resistance?: number, seed?: number }} [opts]
 * @returns {{ t: number[], v: number[], iInput: number[], spikes: number[] }}
 *   t (ms), membrane potential v (mV), input current iInput (nA) at each step,
 *   and spike times (ms).
 */
export function simulateLif(opts = {}) {
  const o = withModelDefaults(opts);
  const dt = o.dt;
  const steps = Math.max(1, Math.min(MAX_STEPS, Math.round(o.duration / dt)));
  const rng = makeRng(o.seed);
  const noiseScale = o.noise > 0 ? o.noise * Math.sqrt((2 * dt) / o.tau) : 0;
  const refSteps = Math.max(0, Math.round(o.refractory / dt));

  const t = new Array(steps + 1);
  const v = new Array(steps + 1);
  const iInput = new Array(steps + 1);
  /** @type {number[]} */
  const spikes = [];

  let vm = o.vRest;
  let refLeft = 0;
  t[0] = 0;
  v[0] = vm;
  iInput[0] = inputCurrentAt(o.input, 0, o.current, o.duration);
  for (let k = 1; k <= steps; k++) {
    const tk = k * dt;
    const iPrev = iInput[k - 1];
    if (refLeft > 0) {
      refLeft--;
      vm = o.vReset;
    } else {
      vm += (dt / o.tau) * (-(vm - o.vRest) + o.resistance * iPrev);
      if (noiseScale > 0) vm += noiseScale * gaussian(rng);
      if (vm >= o.threshold) {
        spikes.push(tk);
        vm = o.vReset;
        refLeft = refSteps;
      }
    }
    t[k] = tk;
    v[k] = vm;
    iInput[k] = inputCurrentAt(o.input, tk, o.current, o.duration);
  }
  return { t, v, iInput, spikes };
}

/* -------------------------------------------------------------------------- */
/* Widget                                                                     */
/* -------------------------------------------------------------------------- */

registerWidget("lif-neuron", (ctx) => mountLif(ctx));

/**
 * @param {import("../registry.js").WidgetContext} ctx
 * @returns {import("../registry.js").WidgetInstance}
 */
function mountLif(ctx) {
  const spec = ctx.spec ?? {};
  const params = Array.isArray(spec.params) && spec.params.length > 0 ? spec.params : LIF_PARAMS;
  const config = normalizeLifConfig(spec.config);
  const fallback = Object.fromEntries(LIF_PARAMS.map((p) => [p.key, p.default]));

  const { doc, root } = buildFrame(ctx.container, spec);
  const panel = buildControlPanel(doc, root, params, () => redraw());
  const trace = buildStage(doc, root, 640, 330, "Membrane potential and input current over time");
  const fi = config.showFI
    ? buildStage(doc, root, 640, 230, "Firing rate versus input current (f–I curve)")
    : null;
  const readout = buildReadout(doc, root);
  let destroyed = false;

  function currentOpts() {
    const s = panel.state;
    const num = (key) => (typeof s[key] === "number" && Number.isFinite(s[key]) ? s[key] : fallback[key]);
    const shapes = ["constant", "step", "ramp", "sine"];
    return {
      current: num("current"),
      tau: num("tau"),
      threshold: num("threshold"),
      refractory: num("refractory"),
      noise: num("noise"),
      input: shapes.includes(s.input) ? s.input : fallback.input,
      duration: config.duration,
      dt: config.dt,
      vRest: config.vRest,
      vReset: config.vReset,
      resistance: config.resistance,
      seed: 1,
    };
  }

  function redraw() {
    if (destroyed) return;
    const opts = currentOpts();
    const sim = simulateLif(opts);
    const simRate = (sim.spikes.length / opts.duration) * 1000;
    const analytic = lifRate(opts.current, opts);
    const rh = rheobase(opts);

    trace.clear();
    drawTrace(doc, trace.svg, sim, opts);
    if (fi) {
      fi.clear();
      drawFI(doc, fi.svg, opts, simRate, analytic);
    }

    const parts = [
      `Spikes: ${sim.spikes.length}`,
      `mean rate ${simRate.toFixed(1)} Hz`,
      `rheobase ${rh.toFixed(2)} nA`,
      analytic > 0
        ? `analytic rate for constant ${opts.current.toFixed(2)} nA: ${analytic.toFixed(1)} Hz`
        : `analytic rate for constant ${opts.current.toFixed(2)} nA: 0 Hz (below rheobase)`,
    ];
    if (opts.noise > 0) parts.push("analytic rate is noise-free");
    readout.textContent = parts.join(" · ");
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

function drawTrace(doc, svg, sim, o) {
  const { t, v, iInput, spikes } = sim;
  const duration = t[t.length - 1];
  let vMin = Math.min(o.vRest, o.vReset);
  for (const x of v) if (x < vMin) vMin = x;
  vMin = Math.floor((vMin - 3) / 5) * 5;
  const vMax = Math.ceil((o.threshold + SPIKE_HEIGHT + 2) / 5) * 5;

  const top = makeBox(56, 14, 568, 200, 0, duration, vMin, vMax);
  drawAxes(doc, svg, top, {
    xTicks: [],
    yTicks: niceTicks(vMin, vMax, 4),
    yLabel: "V (mV)",
  });

  // Threshold line + label.
  svg.appendChild(
    svgEl(doc, "line", {
      class: "sim-threshold",
      x1: top.sx(0), x2: top.sx(duration), y1: top.sy(o.threshold), y2: top.sy(o.threshold),
    }),
  );
  const thrLabel = svgEl(doc, "text", {
    class: "sim-label", x: top.x1 - 4, y: top.sy(o.threshold) - 5, "text-anchor": "end",
  });
  thrLabel.textContent = `threshold θ = ${o.threshold} mV`;
  svg.appendChild(thrLabel);

  // Membrane trace.
  svg.appendChild(
    svgEl(doc, "path", { class: "sim-trace plot-series--1", d: pathFor(t, v, top) }),
  );

  // Spikes as vertical strokes from θ to θ + SPIKE_HEIGHT.
  for (const ts of spikes) {
    svg.appendChild(
      svgEl(doc, "line", {
        class: "sim-spike plot-series--1",
        x1: top.sx(ts), x2: top.sx(ts),
        y1: top.sy(o.threshold), y2: top.sy(o.threshold + SPIKE_HEIGHT),
      }),
    );
  }
  const spikeLabel = svgEl(doc, "text", { class: "sim-label", x: top.x0 + 4, y: top.y0 + 12 });
  spikeLabel.textContent = `membrane potential V(t); spikes drawn as strokes (${spikes.length})`;
  svg.appendChild(spikeLabel);

  // Input-current strip.
  const iMax = Math.max(FI_MAX_CURRENT, o.current);
  const bottom = makeBox(56, 236, 568, 56, 0, duration, 0, iMax);
  drawAxes(doc, svg, bottom, {
    xTicks: niceTicks(0, duration, 5),
    yTicks: [0, iMax],
    xLabel: "time (ms)",
    yLabel: "I (nA)",
  });
  svg.appendChild(
    svgEl(doc, "path", { class: "sim-trace plot-series--3", d: pathFor(t, iInput, bottom) }),
  );
  const inLabel = svgEl(doc, "text", { class: "sim-label", x: bottom.x0 + 4, y: bottom.y0 + 12 });
  inLabel.textContent = `input current I(t), ${o.input}`;
  svg.appendChild(inLabel);
}

function drawFI(doc, svg, o, simRate, analytic) {
  const samples = 161;
  const xs = [];
  const ys = [];
  for (let i = 0; i < samples; i++) {
    const current = (FI_MAX_CURRENT * i) / (samples - 1);
    xs.push(current);
    ys.push(lifRate(current, o));
  }
  const fMax = Math.max(10, ...ys, simRate, analytic);
  const yTop = niceCeil(fMax * 1.05);
  const box = makeBox(56, 14, 568, 170, 0, FI_MAX_CURRENT, 0, yTop);
  drawAxes(doc, svg, box, {
    xTicks: [0, 1, 2, 3, 4],
    yTicks: niceTicks(0, yTop, 4),
    xLabel: "input current I (nA)",
    yLabel: "rate (Hz)",
  });
  svg.appendChild(svgEl(doc, "path", { class: "sim-trace plot-series--2", d: pathFor(xs, ys, box) }));

  // Rheobase marker on the x axis.
  const rh = rheobase(o);
  if (rh >= 0 && rh <= FI_MAX_CURRENT) {
    const rhLabel = svgEl(doc, "text", {
      class: "sim-label", x: box.sx(rh), y: box.y1 - 6, "text-anchor": "middle",
    });
    rhLabel.textContent = "rheobase";
    svg.appendChild(rhLabel);
  }

  // Markers: analytic (circle) and simulated (square) at the current I.
  const cx = box.sx(Math.min(o.current, FI_MAX_CURRENT));
  svg.appendChild(svgEl(doc, "circle", { class: "plot-series--2", cx, cy: box.sy(analytic), r: 5 }));
  svg.appendChild(
    svgEl(doc, "rect", { class: "plot-series--1", x: cx - 4, y: box.sy(simRate) - 4, width: 8, height: 8 }),
  );

  // Legend (text, so color is not the only signal).
  const legend = [
    ["plot-series--2", "analytic f–I curve (noise-free, constant input); circle = current I"],
    ["plot-series--1", `square = simulated mean rate of the trace above (${o.input} input)`],
  ];
  legend.forEach(([cls, text], i) => {
    const y = box.y0 + 14 + i * 16;
    if (i === 0) {
      svg.appendChild(svgEl(doc, "circle", { class: cls, cx: box.x0 + 16, cy: y - 4, r: 4 }));
    } else {
      svg.appendChild(svgEl(doc, "rect", { class: cls, x: box.x0 + 12, y: y - 8, width: 8, height: 8 }));
    }
    const label = svgEl(doc, "text", { class: "sim-label", x: box.x0 + 28, y });
    label.textContent = text;
    svg.appendChild(label);
  });
}

/* -------------------------------------------------------------------------- */
/* Small chart helpers                                                        */
/* -------------------------------------------------------------------------- */

function withModelDefaults(opts) {
  const o = opts && typeof opts === "object" ? opts : {};
  const fallback = Object.fromEntries(LIF_PARAMS.map((p) => [p.key, p.default]));
  const cfg = normalizeLifConfig(o);
  const num = (key, dflt) => (typeof o[key] === "number" && Number.isFinite(o[key]) ? o[key] : dflt);
  return {
    current: num("current", fallback.current),
    tau: Math.max(1e-6, num("tau", fallback.tau)),
    threshold: num("threshold", fallback.threshold),
    refractory: Math.max(0, num("refractory", fallback.refractory)),
    noise: Math.max(0, num("noise", fallback.noise)),
    input: typeof o.input === "string" ? o.input : fallback.input,
    duration: cfg.duration,
    dt: cfg.dt,
    vRest: cfg.vRest,
    vReset: cfg.vReset,
    resistance: cfg.resistance,
    seed: num("seed", 1),
  };
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
    label.textContent = fmtTick(yv);
    svg.appendChild(label);
  }
  for (const xv of xTicks) {
    const x = box.sx(xv);
    const label = svgEl(doc, "text", { class: "plot-axis-label", x, y: box.y1 + 14, "text-anchor": "middle" });
    label.textContent = fmtTick(xv);
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
    const label = svgEl(doc, "text", {
      class: "plot-axis-label", x: 12, y: (box.y0 + box.y1) / 2,
      "text-anchor": "middle", transform: `rotate(-90 12 ${Math.round((box.y0 + box.y1) / 2)})`,
    });
    label.textContent = yLabel;
    svg.appendChild(label);
  }
}

function pathFor(xs, ys, box) {
  const n = xs.length;
  const stride = Math.max(1, Math.ceil(n / MAX_DRAW_POINTS));
  let d = "";
  for (let i = 0; i < n; i += stride) {
    d += `${d ? "L" : "M"}${box.sx(xs[i]).toFixed(1)} ${box.sy(ys[i]).toFixed(1)}`;
  }
  if ((n - 1) % stride !== 0) d += `L${box.sx(xs[n - 1]).toFixed(1)} ${box.sy(ys[n - 1]).toFixed(1)}`;
  return d;
}

function niceStep(span, count) {
  const raw = span / Math.max(1, count);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  return (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
}

function niceTicks(min, max, count) {
  if (!(max > min)) return [min];
  const step = niceStep(max - min, count);
  const ticks = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) {
    ticks.push(Math.round(v * 1e6) / 1e6);
  }
  return ticks;
}

function niceCeil(v) {
  const step = niceStep(v, 4);
  return Math.ceil(v / step) * step;
}

function fmtTick(v) {
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 1000) / 1000);
}
