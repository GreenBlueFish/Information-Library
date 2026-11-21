// src/widgets/types/s-surface.js
//
// `s-surface` — the Laplace transform as a landscape, the continuous-time
// twin of `z-surface`. The reader picks a signal and sees, all at once:
//
//   - a 3D surface of |X(s)| over the s-plane (σ across, jω deep; drag it, or
//     use the two view sliders, to turn it), faded where the integral does not
//     converge, with the jω axis traced on it and a probe at s = jω;
//   - the pole-zero plot from above, with the region of convergence shaded
//     (always a vertical strip) and the vectors from every zero and pole to
//     the probe;
//   - the signal x(t), impulses drawn as arrows;
//   - the slice of the surface along the jω axis, |X(jω)| for 0 ≤ ω ≤ 3 rad/s.
//
// "Next step ▶" walks through the signal in eight steps, "Sweep ω" moves the
// probe up the axis.
//
// Params keys, in order: signal (select; options from SIGNALS in
// ../sims/laplace.js), a (range, 1/s), w0 (range, rad/s), omega (range, rad/s,
// 0–3), height (select: "decibels", "magnitude"), azimuth (range, degrees,
// −180–180), elevation (range, degrees, 10–85). No config. It reuses the
// .zs-* classes of z-surface in alexandria.css.

import { registerWidget } from "../registry.js";
import { buildFrame, buildControlPanel, buildActions, buildReadout, buildStage, svgEl, makeTicker } from "../sim-kit.js";
import {
  SIGNALS, C, sSignal, evalX, magX, inRoc, heightAt, HEIGHT, geometric, verdict, withMultiplicity,
} from "../sims/laplace.js";
import { project3, cfmt } from "./z-surface.js";

export const DEFAULT_PARAMS = [
  { key: "signal", label: "Input signal", control: "select", options: SIGNALS, default: "damped sine e^(−at)sin(ω₀t)u(t)" },
  { key: "a", label: "Decay rate a (1/s)", control: "range", min: -1, max: 2, step: 0.1, default: 0.5 },
  { key: "w0", label: "Frequency ω₀ (rad/s)", control: "range", min: 0, max: 2.5, step: 0.1, default: 1.5 },
  { key: "omega", label: "Probe frequency ω (rad/s)", control: "range", min: 0, max: 3, step: 0.05, default: 1 },
  { key: "height", label: "Height shows", control: "select", options: ["decibels", "magnitude"], default: "decibels" },
  { key: "azimuth", label: "Turn (degrees)", control: "range", min: -180, max: 180, step: 5, default: -35 },
  { key: "elevation", label: "Tilt (degrees)", control: "range", min: 10, max: 85, step: 5, default: 30 },
];

/** Half-width of the square of the s-plane the surface covers (σ and ω). */
export const EXTENT = 3;
const GRID = 40;
const BANDS = 10;
const W = 760, H3 = 430, HP = 250, HGT = H3 + HP;
const LIFT = 3; // height of the top of the view, in plane units
const WMAX = 3; // top of the probe's range and of the response panel

const fmt = (x, d = 2) => {
  if (!Number.isFinite(x)) return x > 0 ? "∞" : "−∞";
  const v = Math.abs(x) < 0.5 * 10 ** -d ? 0 : x;
  return v.toFixed(d).replace("-", "−");
};
const sfmt = (x) => (Math.abs(x) < 5e-3 ? "0" : Number(x.toFixed(2)).toString().replace("-", "−"));
const plist = (pts) =>
  withMultiplicity(pts).map((o) => (o.count > 1 ? `${cfmt(o.at, 2, sfmt)} (×${o.count})` : cfmt(o.at, 2, sfmt))).join(", ");

function lift(sig, s, mode) {
  const hm = HEIGHT[mode] ?? HEIGHT.decibels;
  return (LIFT * (heightAt(sig, s, mode) - hm.lo)) / (hm.hi - hm.lo);
}

/** The surface as quads, sorted far to near (pure, for the tests). */
export function surfaceQuads(sig, mode, azDeg, elDeg, n = GRID) {
  const az = (azDeg * Math.PI) / 180, el = (elDeg * Math.PI) / 180;
  const step = (2 * EXTENT) / n;
  const hs = [];
  for (let i = 0; i <= n; i++) {
    const row = [];
    for (let k = 0; k <= n; k++) row.push(lift(sig, [-EXTENT + k * step, -EXTENT + i * step], mode));
    hs.push(row);
  }
  const quads = [];
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < n; k++) {
      const x0 = -EXTENT + k * step, y0 = -EXTENT + i * step;
      const corners = [
        [x0, y0, hs[i][k]], [x0 + step, y0, hs[i][k + 1]],
        [x0 + step, y0 + step, hs[i + 1][k + 1]], [x0, y0 + step, hs[i + 1][k]],
      ];
      const pts = corners.map(([x, y, h]) => project3(x, y, h, az, el));
      const hMean = (corners[0][2] + corners[1][2] + corners[2][2] + corners[3][2]) / 4;
      quads.push({
        pts,
        depth: pts.reduce((sum, p) => sum + p.depth, 0) / 4,
        band: Math.max(0, Math.min(BANDS - 1, Math.floor((hMean / LIFT) * BANDS))),
        inside: inRoc(sig, [x0 + step / 2, y0 + step / 2]),
      });
    }
  }
  quads.sort((p, q) => p.depth - q.depth);
  return quads;
}

/** The eight walk-through steps for a signal, as { title, text }. */
export function walkSteps(sig, omega, mode = "decibels") {
  const v = verdict(sig);
  const probe = [0, omega];
  const g = geometric(sig, probe);
  const hm = HEIGHT[mode] ?? HEIGHT.decibels;
  const kind = sig.finite
    ? "It is finite: it is zero outside a short stretch of time."
    : sig.leftSided
      ? "It is left-sided: it is zero from t = 0 on and runs back to t = −∞."
      : sig.rightSided
        ? "It is right-sided: it starts at t = 0 and runs on forever."
        : "It is two-sided: it runs forever in both directions.";
  const rocWhy = sig.roc.empty
    ? "Here no strip works, so the transform does not exist for any s: the faded surface is just the formula."
    : sig.finite
      ? "An integral over a finite stretch always converges, so the ROC is the whole plane."
      : sig.leftSided
        ? "A left-sided signal converges to the left of a line: left of its leftmost pole, because there e^(−σt) shrinks fast enough as t → −∞."
        : sig.rightSided
          ? "A right-sided signal converges to the right of a line: right of its rightmost pole, because there e^(−σt) shrinks fast enough to tame x(t) as t → ∞."
          : "A two-sided signal needs both halves to converge: the right-sided half right of one pole, the left-sided half left of the other, which leaves a strip between them.";
  const zeros = sig.zeros.length ? `Zeros at ${plist(sig.zeros)}${sig.name.startsWith("3-second") ? " and further up and down the axis" : ""}.` : "No zeros.";
  const poles = sig.poles.length ? `Poles at ${plist(sig.poles)}.` : "No poles.";
  const dist = (arr) => (arr.length ? arr.map((d) => fmt(d)).join(" × ") : "none, so 1");
  const m = magX(sig, probe);
  const valText = (val) => (mode === "decibels" && val > 0 && Number.isFinite(val) ? `${fmt(val)} (${fmt(hm.of(val), 1)} dB)` : fmt(val));
  const ruler = g
    ? `|X| is the constant |${fmt(sig.gain, 3)}| times the distances from each zero to the probe (${dist(g.zeroDistances)}) divided by the distances from each pole (${dist(g.poleDistances)}) = ${valText(g.value)}.`
    : `This X(s) is not a ratio of polynomials (it has an e^(−s) in it), so there is no ruler reading; its value at the probe is |X| = ${valText(m)}.`;
  return [
    { title: "The signal", text: `${sig.time}. ${kind} It is drawn in the x(t) panel${sig.impulses.length ? "; an arrow is an impulse, of area 1" : ""}.` },
    {
      title: "The transform",
      text: `Each moment of the signal is weighted by e^(−st) and the weighted signal is integrated: X(s) = ∫ x(t) e^(−st) dt. For this signal the integral comes to ${sig.formula}. With s = σ + jω, the weight e^(−st) = e^(−σt)·e^(−jωt): the real part σ sets how fast the weight grows or shrinks, the imaginary part ω how fast it turns.`,
    },
    {
      title: "Zeros and poles",
      text: `${zeros} ${poles} A zero is where X(s) = 0: the surface touches the floor. A pole is where X(s) is infinite: the surface shoots up (it is cut off at the top of the view).${sig.rational ? ` Zeros and poles fix X(s) up to one constant factor, here ${fmt(sig.gain, 3)}.` : ""}${sig.note && /poles|zeros/.test(sig.note) ? ` ${sig.note}` : ""}`,
    },
    {
      title: "The surface",
      text: `The 3D view plots ${mode === "decibels" ? "20·log₁₀|X(s)| in decibels, from −30 dB (floor) to +30 dB (top)" : "|X(s)| itself, from 0 (floor) to 5 (top)"} above every point of the s-plane, σ from −3 to 3 across and ω from −3 to 3 deep. Peaks stand over the poles, pits sink at the zeros, and the colour follows the height. Drag the view, or use Turn and Tilt, to look from any side.`,
    },
    {
      title: "Region of convergence",
      text: `${sig.roc.empty ? `There is no region of convergence: ${sig.rocText}.` : `The integral only converges for ${sig.rocText}: the region of convergence (ROC), shaded in the s-plane panel and drawn solid on the surface.`} ${rocWhy} Convergence depends only on σ, never on ω, so the ROC is always a vertical strip or half-plane, and it never contains a pole. The right- and left-sided exponentials share X(s) = 1/(s + a) and differ only in their ROC.`,
    },
    {
      title: "The jω axis",
      text: `On the imaginary axis s = jω, and the integral becomes ∫ x(t) e^(−jωt) dt: the Fourier transform. So the frequency response is the height of the surface along the line traced on it, unrolled in the bottom-right panel. For this signal the Fourier transform ${v.fourier}.`,
    },
    {
      title: "Reading |X| with a ruler",
      text: `At the probe, s = j${fmt(omega)}. ${ruler} Move the probe frequency, or press Sweep ω: the response dips where the probe passes close to a zero and peaks where it passes close to a pole.`,
    },
    {
      title: "Stable? Causal?",
      text: `${v.stable ? "Stable: the jω axis lies inside the ROC, so ∫|x(t)| dt is finite and the Fourier transform exists." : "Not stable: the jω axis is not inside the ROC, so ∫|x(t)| dt is infinite."} ${v.causal ? "Causal: x(t) = 0 for t < 0, so the ROC is a right half-plane." : "Not causal: it is not zero before t = 0."} ${v.causal && sig.poles.length ? `For a causal signal, stable means every pole is in the left half-plane; the rightmost pole here has Re p = ${fmt(v.maxRe)}.` : ""}`.trim(),
    },
  ];
}

function mergeParams(params) {
  return Array.isArray(params) && params.length > 0 ? params : DEFAULT_PARAMS;
}

function mountSSurface(ctx) {
  const spec = ctx.spec ?? {};
  const { doc, root } = buildFrame(ctx.container, spec);
  const panel = buildControlPanel(doc, root, mergeParams(spec.params), () => schedule());
  let stepIndex = -1;
  const ticker = makeTicker(() => {
    let next = Math.round((Number(panel.state.omega) + 0.05) * 100) / 100;
    if (next > WMAX) next = 0;
    panel.update({ omega: next });
    schedule();
  }, 60);
  const actions = buildActions(doc, root, [
    { label: "◀ Back", secondary: true, onClick: () => { stepIndex = Math.max(0, stepIndex - 1); redraw(); } },
    { label: "Next step ▶", onClick: () => { stepIndex = Math.min(7, stepIndex + 1); redraw(); } },
    {
      label: "Sweep ω", secondary: true,
      onClick: () => {
        const on = ticker.toggle();
        actions.buttons[2].setAttribute("aria-pressed", on ? "true" : "false");
      },
    },
  ]);
  const stage = buildStage(doc, root, W, HGT,
    "Surface of the magnitude of X(s) over the s-plane, with the pole-zero plot, the signal x(t) and the frequency response below");
  const walk = doc.createElement("p");
  walk.className = "zs-walk";
  root.appendChild(walk);
  const readout = buildReadout(doc, root);
  let destroyed = false;
  let pending = false;

  let drag = null;
  const svg = stage.svg;
  const toView = (ev) => {
    const box = svg.getBoundingClientRect ? svg.getBoundingClientRect() : null;
    if (!box || !box.width) return null;
    return { x: ((ev.clientX - box.left) * W) / box.width, y: ((ev.clientY - box.top) * HGT) / box.height };
  };
  const onDown = (ev) => {
    const p = toView(ev);
    if (!p || p.y > H3) return;
    drag = { x: ev.clientX, y: ev.clientY, az: Number(panel.state.azimuth), el: Number(panel.state.elevation) };
    if (svg.setPointerCapture && ev.pointerId !== undefined) svg.setPointerCapture(ev.pointerId);
    ev.preventDefault?.();
  };
  const onMove = (ev) => {
    if (!drag) return;
    let az = drag.az - (ev.clientX - drag.x) * 0.5;
    az = ((((az + 180) % 360) + 360) % 360) - 180;
    const el = Math.max(10, Math.min(85, drag.el + (ev.clientY - drag.y) * 0.3));
    panel.update({ azimuth: Math.round(az / 5) * 5, elevation: Math.round(el / 5) * 5 });
    schedule();
  };
  const onUp = () => { drag = null; };
  svg.addEventListener("pointerdown", onDown);
  svg.addEventListener("pointermove", onMove);
  svg.addEventListener("pointerup", onUp);
  svg.addEventListener("pointercancel", onUp);
  svg.classList?.add("zs-draggable");

  function schedule() {
    if (pending || destroyed) return;
    const raf = globalThis.requestAnimationFrame;
    if (typeof raf !== "function") { redraw(); return; }
    pending = true;
    raf(() => { pending = false; redraw(); });
  }

  const add = (parent, name, attrs) => {
    const el = svgEl(doc, name, attrs);
    parent.appendChild(el);
    return el;
  };
  const text = (parent, x, y, s, cls = "sim-label", anchor = "middle") => {
    const t = add(parent, "text", { x: x.toFixed(1), y: y.toFixed(1), class: cls, "text-anchor": anchor });
    t.textContent = s;
    return t;
  };
  const poly = (pts) => pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");

  function drawMarkers(g, at, sig, size, keep = () => true) {
    for (const o of withMultiplicity(sig.zeros)) {
      if (!keep(o.at)) continue;
      const [x, y] = at(o.at);
      add(g, "circle", { cx: x.toFixed(1), cy: y.toFixed(1), r: size, class: "zs-zero" });
      if (o.count > 1) text(g, x + size + 2, y - size, `×${o.count}`, "sim-label zs-mult", "start");
    }
    for (const o of withMultiplicity(sig.poles)) {
      if (!keep(o.at)) continue;
      const [x, y] = at(o.at);
      add(g, "path", { d: `M${x - size} ${y - size} L${x + size} ${y + size} M${x - size} ${y + size} L${x + size} ${y - size}`, class: "zs-pole" });
      if (o.count > 1) text(g, x + size + 2, y - size, `×${o.count}`, "sim-label zs-mult", "start");
    }
  }
  const inView = (q) => Math.abs(q[0]) <= EXTENT + 1e-9 && Math.abs(q[1]) <= EXTENT + 1e-9;

  function draw3d(sig, s) {
    const g = add(svg, "g", { class: `zs-panel${stepIndex === 3 || stepIndex === 4 ? " zs-focus" : ""}` });
    add(g, "rect", { x: 0, y: 0, width: W, height: H3, class: "zs-frame" });
    const az = (Number(s.azimuth) * Math.PI) / 180, el = (Number(s.elevation) * Math.PI) / 180;
    const P = (x, y, h) => project3(x, y, h, az, el);
    const corners = [];
    for (const x of [-EXTENT, EXTENT]) for (const y of [-EXTENT, EXTENT]) for (const h of [0, LIFT]) corners.push(P(x, y, h));
    const uMin = Math.min(...corners.map((c) => c.u)), uMax = Math.max(...corners.map((c) => c.u));
    const vMin = Math.min(...corners.map((c) => c.v)), vMax = Math.max(...corners.map((c) => c.v));
    const scale = Math.min((W - 40) / (uMax - uMin), (H3 - 40) / (vMax - vMin));
    const ox = W / 2 - (scale * (uMin + uMax)) / 2, oy = H3 / 2 + (scale * (vMin + vMax)) / 2;
    const S = (p) => [ox + scale * p.u, oy - scale * p.v];
    const mode = String(s.height);

    const floor = [[-EXTENT, -EXTENT], [EXTENT, -EXTENT], [EXTENT, EXTENT], [-EXTENT, EXTENT]].map(([x, y]) => S(P(x, y, 0)));
    add(g, "path", { d: `${poly(floor)} Z`, class: "zs-floor" });
    add(g, "path", { d: poly([S(P(-EXTENT, 0, 0)), S(P(EXTENT, 0, 0))]), class: "zs-axis" });
    add(g, "path", { d: poly([S(P(0, -EXTENT, 0)), S(P(0, EXTENT, 0))]), class: "zs-floor-circle" });
    const edge = (sigma) => {
      if (!Number.isFinite(sigma) || Math.abs(sigma) > EXTENT) return;
      add(g, "path", { d: poly([S(P(sigma, -EXTENT, 0)), S(P(sigma, EXTENT, 0))]), class: "zs-roc-edge" });
    };
    if (!sig.roc.empty) { edge(sig.roc.lo); edge(sig.roc.hi); }

    for (const q of surfaceQuads(sig, mode, Number(s.azimuth), Number(s.elevation))) {
      add(g, "path", { d: `${poly(q.pts.map(S))} Z`, class: `zs-face zs-band-${q.band}${q.inside ? "" : " zs-face--outside"}` });
    }

    // The jω axis on the surface: the near part solid, the far part lighter.
    const front = [], back = [];
    const flush = () => {
      if (front.length > 1) add(g, "path", { d: poly(front), class: "zs-ucircle" });
      if (back.length > 1) add(g, "path", { d: poly(back), class: "zs-ucircle zs-ucircle--back" });
    };
    let lastFar = null;
    for (let k = 0; k <= 240; k++) {
      const w = -EXTENT + (2 * EXTENT * k) / 240;
      const p = P(0, w, lift(sig, [0, w], mode));
      const far = p.depth < 0;
      if (lastFar !== null && far !== lastFar) {
        (far ? back : front).push(S(p));
        flush(); front.length = 0; back.length = 0;
      }
      (far ? back : front).push(S(p));
      lastFar = far;
    }
    flush();

    const re = S(P(EXTENT * 1.1, 0, 0)), im = S(P(0, EXTENT * 1.1, 0));
    text(g, re[0], re[1] + 4, "σ = Re s");
    text(g, im[0], im[1] + 4, "jω = Im s");

    const fl = (q) => S(P(q[0], q[1], 0));
    for (const o of withMultiplicity(sig.poles)) {
      if (!inView(o.at)) continue;
      add(g, "path", { d: poly([fl(o.at), S(P(o.at[0], o.at[1], LIFT))]), class: "zs-pole-line" });
    }
    drawMarkers(g, fl, sig, 5, inView);
    const pz = [0, Number(s.omega)];
    const top = S(P(pz[0], pz[1], lift(sig, pz, mode))), bot = fl(pz);
    add(g, "path", { d: poly([bot, top]), class: "zs-probe-line" });
    add(g, "circle", { cx: top[0].toFixed(1), cy: top[1].toFixed(1), r: 5, class: "zs-probe" });
    add(g, "circle", { cx: bot[0].toFixed(1), cy: bot[1].toFixed(1), r: 3, class: "zs-probe" });
    text(g, 12, 20, `height: ${mode === "decibels" ? "20·log₁₀|X(s)|, −30 to +30 dB" : "|X(s)|, 0 to 5"}`, "sim-label", "start");
    text(g, 12, 38, sig.roc.empty ? "no region of convergence: the whole surface is faded" : "solid: inside the ROC · faded: outside", "sim-label", "start");
    text(g, W - 12, H3 - 12, "drag to turn", "sim-label zs-hint", "end");
  }

  function drawPlane(sig, s, x0, y0, wd, ht) {
    const g = add(svg, "g", { class: `zs-panel${[2, 4, 6].includes(stepIndex) ? " zs-focus" : ""}` });
    add(g, "rect", { x: x0, y: y0, width: wd, height: ht, class: "zs-frame" });
    text(g, x0 + wd / 2, y0 + 16, "s-plane from above");
    const R = EXTENT, cx = x0 + wd / 2, cy = y0 + 24 + (ht - 30) / 2, k = (Math.min(wd, ht - 30) / 2 - 6) / R;
    const at = (q) => [cx + k * Math.max(-R, Math.min(R, q[0])), cy - k * Math.max(-R, Math.min(R, q[1]))];
    if (!sig.roc.empty) {
      const lo = Math.max(-R, sig.roc.lo), hi = Math.min(R, sig.roc.hi);
      if (hi > lo) add(g, "rect", { x: (cx + k * lo).toFixed(1), y: (cy - k * R).toFixed(1), width: (k * (hi - lo)).toFixed(1), height: (2 * k * R).toFixed(1), class: "zs-roc" });
    }
    add(g, "path", { d: `M${cx - k * R} ${cy} H${cx + k * R}`, class: "zs-axis" });
    add(g, "path", { d: `M${cx} ${cy - k * R} V${cy + k * R}`, class: "zs-unit" });
    const pp = at([0, Number(s.omega)]);
    for (const q of sig.zeros) { if (inView(q)) add(g, "path", { d: poly([at(q), pp]), class: "zs-vec zs-vec--zero" }); }
    for (const q of sig.poles) { if (inView(q)) add(g, "path", { d: poly([at(q), pp]), class: "zs-vec zs-vec--pole" }); }
    drawMarkers(g, at, sig, 4);
    add(g, "circle", { cx: pp[0].toFixed(1), cy: pp[1].toFixed(1), r: 4, class: "zs-probe" });
    text(g, cx + k * R - 2, cy + 12, "σ", "sim-label zs-hint", "end");
    text(g, cx + 4, cy - k * R + 10, "jω", "sim-label zs-hint", "start");
    const off = sig.poles.concat(sig.zeros).filter((q) => !inView(q));
    if (off.length) text(g, x0 + wd / 2, y0 + ht - 6, `${off.length} point(s) beyond the edge, drawn at it`, "sim-label zs-hint");
  }

  function drawSignal(sig, x0, y0, wd, ht) {
    const g = add(svg, "g", { class: `zs-panel${[0, 1].includes(stepIndex) ? " zs-focus" : ""}` });
    add(g, "rect", { x: x0, y: y0, width: wd, height: ht, class: "zs-frame" });
    text(g, x0 + wd / 2, y0 + 16, "signal x(t), t = −4 … 8 s");
    const T0 = -4, T1 = 8, N = 480;
    const ts = []; for (let i = 0; i <= N; i++) ts.push(T0 + ((T1 - T0) * i) / N);
    const xs = ts.map((t) => sig.x(t));
    const m = Math.max(1e-9, ...xs.map((v) => Math.abs(v)), ...sig.impulses.map((i) => Math.abs(i.weight)));
    const left = x0 + 14, right = x0 + wd - 14, mid = y0 + 40 + (ht - 62) / 2, half = (ht - 72) / 2;
    const X = (t) => left + ((t - T0) / (T1 - T0)) * (right - left);
    const Y = (v) => mid - (half * v) / m;
    add(g, "path", { d: `M${left} ${mid} H${right}`, class: "zs-axis" });
    add(g, "path", { d: `M${X(0).toFixed(1)} ${mid - half} V${mid + half}`, class: "zs-grid" });
    // The smooth part, broken at jumps so a step is drawn as a step.
    let d = "", prev = null;
    for (let i = 0; i <= N; i++) {
      const p = [X(ts[i]), Y(xs[i])];
      const jump = prev && Math.abs(p[1] - prev[1]) > half * 0.5;
      d += `${!prev || jump ? "M" : "L"}${p[0].toFixed(1)} ${p[1].toFixed(1)} `;
      prev = p;
    }
    add(g, "path", { d: d.trim(), class: "zs-response" });
    for (const imp of sig.impulses) {
      const x = X(imp.at), yTop = Y(imp.weight);
      add(g, "path", { d: `M${x.toFixed(1)} ${mid} V${yTop.toFixed(1)} M${(x - 4).toFixed(1)} ${(yTop + 6).toFixed(1)} L${x.toFixed(1)} ${yTop.toFixed(1)} L${(x + 4).toFixed(1)} ${(yTop + 6).toFixed(1)}`, class: "zs-stem" });
    }
    for (const t of [-4, 0, 4, 8]) text(g, X(t), y0 + ht - 6, String(t).replace("-", "−"));
    text(g, x0 + wd - 8, y0 + 32, `max |x| = ${fmt(m)}${sig.impulses.length ? " (arrows: impulses)" : ""}`, "sim-label zs-hint", "end");
  }

  function drawResponse(sig, s, x0, y0, wd, ht) {
    const g = add(svg, "g", { class: `zs-panel${[5, 6].includes(stepIndex) ? " zs-focus" : ""}` });
    add(g, "rect", { x: x0, y: y0, width: wd, height: ht, class: "zs-frame" });
    const mode = String(s.height);
    const hm = HEIGHT[mode] ?? HEIGHT.decibels;
    text(g, x0 + wd / 2, y0 + 16, mode === "decibels" ? "|X(jω)| in dB on the jω axis" : "|X(jω)| on the jω axis");
    const left = x0 + 34, right = x0 + wd - 18, topY = y0 + 30, botY = y0 + ht - 22;
    const X = (w) => left + (w / WMAX) * (right - left);
    const Y = (v) => botY - ((v - hm.lo) / (hm.hi - hm.lo)) * (botY - topY);
    add(g, "path", { d: `M${left} ${topY} V${botY} H${right}`, class: "zs-axis" });
    if (mode === "decibels") add(g, "path", { d: `M${left} ${Y(0).toFixed(1)} H${right}`, class: "zs-grid" });
    const pts = [];
    for (let i = 0; i <= 240; i++) { const w = (WMAX * i) / 240; pts.push([X(w), Y(heightAt(sig, [0, w], mode))]); }
    const stable = verdict(sig).stable;
    add(g, "path", { d: poly(pts), class: `zs-response${stable ? "" : " zs-response--outside"}` });
    const om = Number(s.omega);
    const py = Y(heightAt(sig, [0, om], mode));
    add(g, "path", { d: `M${X(om).toFixed(1)} ${botY} V${py.toFixed(1)}`, class: "zs-probe-line" });
    add(g, "circle", { cx: X(om).toFixed(1), cy: py.toFixed(1), r: 4, class: "zs-probe" });
    for (const w of [0, 1, 2, 3]) text(g, X(w), botY + 14, String(w));
    text(g, left - 4, topY + 4, mode === "decibels" ? "+30" : "5", "sim-label", "end");
    text(g, left - 4, botY, mode === "decibels" ? "−30" : "0", "sim-label", "end");
    text(g, x0 + wd - 6, botY - 4, "ω (rad/s)", "sim-label zs-hint", "end");
    if (!stable) text(g, x0 + wd / 2, topY + 12, "jω axis not inside the ROC", "sim-label zs-hint");
  }

  function redraw() {
    if (destroyed) return;
    const s = panel.state;
    let sig;
    try { sig = sSignal(String(s.signal), Number(s.a), Number(s.w0)); } catch { sig = sSignal(SIGNALS[0]); }
    stage.clear();
    draw3d(sig, s);
    const pw = (W - 20) / 3;
    drawPlane(sig, s, 0, H3 + 10, pw, HP - 10);
    drawSignal(sig, pw + 10, H3 + 10, pw, HP - 10);
    drawResponse(sig, s, 2 * pw + 20, H3 + 10, pw, HP - 10);

    const steps = walkSteps(sig, Number(s.omega), String(s.height));
    walk.textContent = stepIndex < 0
      ? "Press Next step ▶ to walk through this signal one idea at a time."
      : `Step ${stepIndex + 1} of ${steps.length}: ${steps[stepIndex].title}${/[?.!]$/.test(steps[stepIndex].title) ? "" : "."} ${steps[stepIndex].text}`;
    actions.buttons[0].disabled = stepIndex <= 0;
    actions.buttons[1].disabled = stepIndex >= steps.length - 1;

    const om = Number(s.omega);
    const m = magX(sig, [0, om]);
    const val = evalX(sig, [0, om]);
    const unused = ["a", "w0"].filter((k) => !sig.uses.includes(k));
    readout.textContent =
      `${sig.formula}; ROC: ${sig.rocText}. At ω = ${fmt(om)} rad/s: X(jω) = ${Number.isFinite(val[0]) ? cfmt(val, 3) : "∞"}, |X| = ${fmt(m, 3)}` +
      `${m > 0 && Number.isFinite(m) ? ` (${fmt(20 * Math.log10(m), 1)} dB)` : ""}.` +
      (unused.length ? ` This signal ignores ${unused.map((k) => (k === "a" ? "a" : "ω₀")).join(" and ")}.` : "") +
      (sig.note ? ` ${sig.note}` : "");
  }

  redraw();
  return {
    update(partial) { if (panel.update(partial)) redraw(); },
    destroy() {
      destroyed = true;
      ticker.stop();
      panel.destroy();
      actions.destroy();
      svg.removeEventListener("pointerdown", onDown);
      svg.removeEventListener("pointermove", onMove);
      svg.removeEventListener("pointerup", onUp);
      svg.removeEventListener("pointercancel", onUp);
    },
  };
}

registerWidget("s-surface", (ctx) => mountSSurface(ctx));
