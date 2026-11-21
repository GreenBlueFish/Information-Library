// src/widgets/types/fourier-3d.js
//
// `fourier-3d` — a periodic signal taken apart into its harmonics, in 3D.
// Time runs across, frequency runs into the picture, and height is the value:
//
//   - each harmonic A_k cos(2πkt/T + φ_k) is a ribbon standing at its own
//     frequency k/T, so the stack of ribbons is the Fourier series spread out;
//   - in front of them, the sum of harmonics 0…N against the signal itself;
//   - on the right-hand wall, a bar for each harmonic as tall as A_k: the
//     amplitude spectrum.
//
// Looking from the front shows the time domain (the ribbons add up to the
// sum); turning the view to look along the time axis shows the frequency
// domain (the bars). Below: the signal and the partial sum, the amplitude
// spectrum on a fixed axis in hertz, and the phase spectrum. "Next step ▶"
// walks through the signal in eight steps; "Add harmonics" plays N upward.
//
// Params keys, in order: signal (select; options from SIGNALS in
// ../sims/fourier.js), harmonics (range, 0–40), period (range, seconds),
// delay (range, fraction of a period, 0–1), azimuth (range, degrees,
// −180–180), elevation (range, degrees, 5–85). No config. Styled by the .zs-*
// and .fx-* classes in alexandria.css.

import { registerWidget } from "../registry.js";
import { buildFrame, buildControlPanel, buildActions, buildReadout, buildStage, svgEl, makeTicker } from "../sim-kit.js";
import { SIGNALS, TAU, fSignal, harmonic, partialSum, rmsError, peak, wrap } from "../sims/fourier.js";
import { project3 } from "./z-surface.js";

export const DEFAULT_PARAMS = [
  { key: "signal", label: "Input signal", control: "select", options: SIGNALS, default: "square wave" },
  { key: "harmonics", label: "Harmonics added, N", control: "range", min: 0, max: 40, step: 1, default: 7 },
  { key: "period", label: "Period T (s)", control: "range", min: 0.5, max: 8, step: 0.5, default: 1 },
  { key: "delay", label: "Delay (fraction of a period)", control: "range", min: 0, max: 1, step: 0.05, default: 0 },
  { key: "azimuth", label: "Turn (degrees)", control: "range", min: -180, max: 180, step: 5, default: -50 },
  { key: "elevation", label: "Tilt (degrees)", control: "range", min: 5, max: 85, step: 5, default: 25 },
];

const W = 760, H3 = 430, HP = 250, HGT = H3 + HP;
const XT = 1.6; // half-width of the time axis, in plane units (t from −T to T)
const YF = -1.0, YB = 1.6; // depth of harmonic 0 and of the last harmonic shown
const YSUM = -1.5; // depth of the partial sum, in front of the ribbons
const XWALL = 1.85; // where the spectrum bars stand
const HS = 0.55; // plane units of height per unit of signal
const FMAX = 10; // right end of the spectrum panels, in hertz
const NPTS = 160; // points along each ribbon

const fmt = (x, d = 2) => {
  if (!Number.isFinite(x)) return x > 0 ? "∞" : "−∞";
  const v = Math.abs(x) < 0.5 * 10 ** -d ? 0 : x;
  return v.toFixed(d).replace("-", "−");
};
const deg = (a) => Math.round((wrap(a) * 180) / Math.PI);
const degs = (a) => String(deg(a)).replace("-", "−");

/** Depth of harmonic k when harmonics 0…N are shown. */
export function depthOf(k, N) {
  return N <= 0 ? YF : YF + ((YB - YF) * k) / N;
}

/**
 * Everything the 3D view draws, as items with a mean depth, sorted far to
 * near (pure, so the tests can check it). Kinds: "ribbon" (one harmonic),
 * "bar" (its spectrum line), "sum", "signal".
 */
export function sceneItems(sig, N, azDeg, elDeg) {
  const az = (azDeg * Math.PI) / 180, el = (elDeg * Math.PI) / 180;
  const P = (x, y, h) => project3(x, y, h, az, el);
  const tOf = (x) => (x / XT) * sig.T;
  const items = [];
  const curve = (fn, y) => {
    const pts = [];
    for (let i = 0; i <= NPTS; i++) { const x = -XT + (2 * XT * i) / NPTS; pts.push(P(x, y, HS * fn(tOf(x)))); }
    return pts;
  };
  for (let k = 0; k <= N; k++) {
    const { A } = sig.coeff(k);
    const y = depthOf(k, N);
    const pts = curve((t) => harmonic(sig, k, t), y);
    const base = [P(XT, y, 0), P(-XT, y, 0)];
    items.push({ kind: "ribbon", k, A, pts, base, depth: (P(-XT, y, 0).depth + P(XT, y, 0).depth) / 2 });
    const b0 = P(XWALL, y, 0), b1 = P(XWALL, y, HS * A);
    items.push({ kind: "bar", k, A, pts: [b0, b1], depth: b0.depth });
  }
  const sumPts = curve((t) => partialSum(sig, N, t), YSUM);
  items.push({ kind: "signal", pts: curve((t) => sig.x(t), YSUM), depth: P(0, YSUM, 0).depth + 1e-6 });
  items.push({ kind: "sum", pts: sumPts, depth: P(0, YSUM, 0).depth });
  items.sort((p, q) => p.depth - q.depth);
  return items;
}

/** The eight walk-through steps, as { title, text }. */
export function walkSteps(sig, N) {
  const f0 = 1 / sig.T;
  const firsts = [];
  for (let k = 0; k <= 7 && firsts.length < 5; k++) {
    const { A } = sig.coeff(k);
    if (A > 1e-9) firsts.push(`A${String(k).replace(/\d/g, (c) => "₀₁₂₃₄₅₆₇₈₉"[c])} = ${fmt(A, 3)}`);
  }
  const rms = rmsError(sig, N, 2000);
  const pk = peak(sig, Math.max(N, 1), 2000);
  const pulse = sig.name.startsWith("pulse");
  const shifted = sig.delay > 0 && sig.delay < 1;
  return [
    { title: "The signal", text: `This is a ${sig.name}: ${sig.text}. It repeats every T = ${fmt(sig.T)} s, so its fundamental frequency is f₀ = 1/T = ${fmt(f0)} Hz (ω₀ = 2π/T = ${fmt(2 * Math.PI * f0)} rad/s). The dashed curve at the front of the 3D view and in the left panel is the signal itself.` },
    { title: "Sinusoids as building blocks", text: `Each ribbon in the 3D view is one sinusoid, a harmonic A_k cos(2πk t/T + φ_k), standing at its own frequency k·f₀ along the depth axis: k = 0 is the constant (the average), k = 1 the fundamental at ${fmt(f0)} Hz, k = 2 twice that, and so on. Fourier's claim is that every reasonable periodic signal is a sum of these.` },
    { title: "How much of each", text: `The amount of harmonic k comes from one integral over a period, c_k = (1/T)∫ x(t) e^(−j2πkt/T) dt, and A_k = 2|c_k| (A₀ = c₀). For this signal: ${sig.formula}, ${sig.rule}. The first few are ${firsts.join(", ")}.` },
    { title: "Adding them up", text: `The solid curve in front is the sum of harmonics 0 to ${N}; the dashed curve is the signal. Look from the front (Turn 0°, Tilt 10°) and the ribbons line up behind it. The root-mean-square gap between the two is ${fmt(rms, 4)}${N === 0 ? "" : `; push N up and it shrinks`}.` },
    { title: "The spectrum", text: `Now look along the time axis (Turn −90°): time disappears, and what is left is a bar at each frequency k·f₀ as tall as A_k. That is the amplitude spectrum, the same signal described by frequency instead of by time. The middle panel draws it on a fixed axis in hertz; hollow stems are harmonics not added yet.` },
    { title: "Phase", text: `Height is not everything: each harmonic also has a phase φ_k, where its cosine peaks in the period. The right-hand panel shows φ_k in degrees. ${shifted ? `With a delay of ${fmt(sig.delay)} of a period, every phase moved by −360°·k·${fmt(sig.delay)}: a straight line in k, while every A_k stayed the same.` : "Move Delay: every phase moves by −360°·k·delay, a straight line in k, while the amplitudes do not change at all."}` },
    { title: "How well it converges", text: sig.jumps ? `This signal jumps, so its coefficients fall only as 1/k and the sum converges slowly. Near each jump the sum overshoots by about 9% of the jump however many terms are added (the Gibbs phenomenon): with N = ${Math.max(N, 1)} the peak is ${fmt(pk, 3)} against a true top of 1. The overshoot gets narrower as N grows, never lower.` : `This signal has no jumps, so its coefficients fall at least as fast as 1/k² and a handful of harmonics already draw it closely: the root-mean-square gap with N = ${N} is ${fmt(rms, 4)}.` },
    { title: "From series to transform", text: pulse ? `The harmonics are spaced f₀ = 1/T = ${fmt(f0)} Hz apart. Raise the period T and they crowd together, while the dashed envelope (the shape of one pulse's Fourier transform, 2·|sinc(0.5f)|/T) stays the same shape. In the limit T → ∞ the pulses stop repeating, the lines merge into a continuous curve, and the Fourier series becomes the Fourier transform.` : `The harmonics are spaced f₀ = 1/T = ${fmt(f0)} Hz apart, so a longer period packs them closer. Pick the pulse train and raise the period T to watch the lines crowd together under a fixed envelope: in the limit of an infinite period the series becomes the Fourier transform of a single pulse.` },
  ];
}

function mergeParams(params) {
  return Array.isArray(params) && params.length > 0 ? params : DEFAULT_PARAMS;
}

function mountFourier3d(ctx) {
  const spec = ctx.spec ?? {};
  const { doc, root } = buildFrame(ctx.container, spec);
  const params = mergeParams(spec.params);
  const nMax = Number(params.find((p) => p.key === "harmonics")?.max ?? 40);
  const panel = buildControlPanel(doc, root, params, () => schedule());
  let stepIndex = -1;
  const ticker = makeTicker(() => {
    const n = Number(panel.state.harmonics);
    panel.update({ harmonics: n >= nMax ? 0 : n + 1 });
    schedule();
  }, 350);
  const go = (i) => {
    stepIndex = i;
    if (i === 3) panel.update({ azimuth: 0, elevation: 10 });
    if (i === 4) panel.update({ azimuth: -90, elevation: 10 });
    redraw();
  };
  const actions = buildActions(doc, root, [
    { label: "◀ Back", secondary: true, onClick: () => go(Math.max(0, stepIndex - 1)) },
    { label: "Next step ▶", onClick: () => go(Math.min(7, stepIndex + 1)) },
    {
      label: "Add harmonics", secondary: true,
      onClick: () => {
        const on = ticker.toggle();
        actions.buttons[2].setAttribute("aria-pressed", on ? "true" : "false");
      },
    },
  ]);
  const stage = buildStage(doc, root, W, HGT,
    "A periodic signal split into its harmonics in 3D, time across and frequency in depth, with the signal, the amplitude spectrum and the phase spectrum below");
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
    const el = Math.max(5, Math.min(85, drag.el + (ev.clientY - drag.y) * 0.3));
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

  function draw3d(sig, N, s) {
    const g = add(svg, "g", { class: `zs-panel${[1, 3, 4].includes(stepIndex) ? " zs-focus" : ""}` });
    add(g, "rect", { x: 0, y: 0, width: W, height: H3, class: "zs-frame" });
    const az = (Number(s.azimuth) * Math.PI) / 180, el = (Number(s.elevation) * Math.PI) / 180;
    const P = (x, y, h) => project3(x, y, h, az, el);
    const corners = [];
    for (const x of [-XT, XWALL]) for (const y of [YSUM, YB]) for (const h of [-1.6 * HS, 1.6 * HS]) corners.push(P(x, y, h));
    const uMin = Math.min(...corners.map((c) => c.u)), uMax = Math.max(...corners.map((c) => c.u));
    const vMin = Math.min(...corners.map((c) => c.v)), vMax = Math.max(...corners.map((c) => c.v));
    const scale = Math.min((W - 60) / (uMax - uMin), (H3 - 70) / (vMax - vMin));
    const ox = W / 2 - (scale * (uMin + uMax)) / 2, oy = H3 / 2 + 10 + (scale * (vMin + vMax)) / 2;
    const S = (p) => [ox + scale * p.u, oy - scale * p.v];

    // Floor: the frequency axis under the ribbons and the time axis in front.
    const floor = [[-XT, YSUM], [XWALL, YSUM], [XWALL, YB], [-XT, YB]].map(([x, y]) => S(P(x, y, -1.6 * HS)));
    add(g, "path", { d: `${poly(floor)} Z`, class: "zs-floor" });
    add(g, "path", { d: poly([S(P(-XT, YSUM, 0)), S(P(XT, YSUM, 0))]), class: "zs-axis" });
    add(g, "path", { d: poly([S(P(XWALL, YF, 0)), S(P(XWALL, YB, 0))]), class: "zs-axis" });

    for (const it of sceneItems(sig, N, Number(s.azimuth), Number(s.elevation))) {
      if (it.kind === "ribbon") {
        if (it.A < 1e-9) { add(g, "path", { d: poly(it.base.map(S)), class: "zs-grid" }); continue; }
        const pts = it.pts.map(S);
        add(g, "path", { d: `${poly(pts.concat(it.base.map(S)))} Z`, class: `fx-ribbon fx-c${it.k % 6}` });
        add(g, "path", { d: poly(pts), class: `fx-line fx-c${it.k % 6}` });
      } else if (it.kind === "bar") {
        if (it.A < 1e-9) continue;
        add(g, "path", { d: poly(it.pts.map(S)), class: `fx-bar fx-c${it.k % 6}` });
      } else if (it.kind === "signal") {
        add(g, "path", { d: poly(it.pts.map(S)), class: "fx-signal" });
      } else {
        add(g, "path", { d: poly(it.pts.map(S)), class: "fx-sum" });
      }
    }
    const lab = (x, y, h, s2, anchor = "middle") => { const p = S(P(x, y, h)); text(g, p[0], p[1], s2, "sim-label zs-hint", anchor); };
    lab(XT * 1.15, YSUM, 0, "time t", "start");
    lab(XWALL, YB + 0.45, 0, "frequency");
    lab(XWALL + 0.3, YF, -0.1, "0 Hz", "start");
    if (N > 0) lab(XWALL + 0.3, YB, -0.1, `${fmt(N / sig.T, 1)} Hz`, "start");
    lab(-XT, YSUM, 1.25 * HS, "sum of 0…N", "start");
    text(g, 12, 20, `${N + 1} harmonic${N ? "s" : ""}, k = 0 … ${N}, spaced f₀ = ${fmt(1 / sig.T)} Hz apart; each ribbon shows t from −T to T`, "sim-label", "start");
    text(g, 12, 38, "front: the signal (dashed) and the sum · right wall: amplitude bars", "sim-label", "start");
    text(g, W - 12, H3 - 12, "drag to turn", "sim-label zs-hint", "end");
  }

  function drawTime(sig, N, x0, y0, wd, ht) {
    const g = add(svg, "g", { class: `zs-panel${[0, 3, 6].includes(stepIndex) ? " zs-focus" : ""}` });
    add(g, "rect", { x: x0, y: y0, width: wd, height: ht, class: "zs-frame" });
    text(g, x0 + wd / 2, y0 + 16, `signal and sum of 0…${N}, t = −T … T`);
    const left = x0 + 12, right = x0 + wd - 12, mid = y0 + 26 + (ht - 46) / 2, half = (ht - 56) / 2;
    const m = 1.5;
    const X = (t) => left + ((t + sig.T) / (2 * sig.T)) * (right - left);
    const Y = (v) => mid - (half * Math.max(-m, Math.min(m, v))) / m;
    add(g, "path", { d: `M${left} ${mid} H${right}`, class: "zs-axis" });
    const n = 400, sp = [], xp = [];
    for (let i = 0; i <= n; i++) {
      const t = -sig.T + (2 * sig.T * i) / n;
      sp.push([X(t), Y(partialSum(sig, N, t))]);
      xp.push([X(t), Y(sig.x(t))]);
    }
    add(g, "path", { d: poly(xp), class: "fx-signal" });
    add(g, "path", { d: poly(sp), class: "fx-sum" });
    text(g, left, y0 + ht - 6, "−T", "sim-label", "start");
    text(g, (left + right) / 2, y0 + ht - 6, "0");
    text(g, right, y0 + ht - 6, "T", "sim-label", "end");
    text(g, left + 2, Y(1) + 4, "1", "sim-label zs-hint", "start");
  }

  function drawSpectrum(sig, N, x0, y0, wd, ht) {
    const g = add(svg, "g", { class: `zs-panel${[2, 4, 7].includes(stepIndex) ? " zs-focus" : ""}` });
    add(g, "rect", { x: x0, y: y0, width: wd, height: ht, class: "zs-frame" });
    text(g, x0 + wd / 2, y0 + 16, "amplitude A_k at f = k/T");
    const left = x0 + 30, right = x0 + wd - 12, topY = y0 + 30, botY = y0 + ht - 22;
    let top = 0;
    const kMax = Math.floor(FMAX * sig.T + 1e-9);
    for (let k = 0; k <= Math.max(kMax, N); k++) top = Math.max(top, sig.coeff(k).A);
    top = top > 0 ? top * 1.1 : 1;
    const X = (f) => left + (f / FMAX) * (right - left);
    const Y = (v) => botY - (v / top) * (botY - topY);
    add(g, "path", { d: `M${left} ${topY} V${botY} H${right}`, class: "zs-axis" });
    if (sig.name.startsWith("pulse")) {
      const pts = [];
      for (let i = 0; i <= 300; i++) {
        const f = (FMAX * i) / 300, u = f * TAU;
        const sn = Math.abs(u) < 1e-12 ? 1 : Math.sin(Math.PI * u) / (Math.PI * u);
        pts.push([X(f), Y(Math.min(top, ((2 * TAU) / sig.T) * Math.abs(sn)))]);
      }
      add(g, "path", { d: poly(pts), class: "fx-signal" });
    }
    for (let k = 0; k <= kMax; k++) {
      const { A } = sig.coeff(k);
      if (A < 1e-9) continue;
      const x = X(k / sig.T), y = Y(A);
      const on = k <= N;
      add(g, "path", { d: `M${x.toFixed(1)} ${botY} V${y.toFixed(1)}`, class: `fx-stem${on ? "" : " fx-stem--off"}` });
      add(g, "circle", { cx: x.toFixed(1), cy: y.toFixed(1), r: 2.5, class: `fx-dot${on ? "" : " fx-dot--off"}` });
    }
    for (const f of [0, 5, 10]) text(g, X(f), botY + 14, f === 10 ? "10 Hz" : String(f), "sim-label", f === 10 ? "end" : "middle");
    text(g, left - 4, topY + 4, fmt(top, 2), "sim-label", "end");
    if (N > kMax) text(g, right, topY + 10, `${N - kMax} more beyond 10 Hz`, "sim-label zs-hint", "end");
  }

  function drawPhase(sig, N, x0, y0, wd, ht) {
    const g = add(svg, "g", { class: `zs-panel${stepIndex === 5 ? " zs-focus" : ""}` });
    add(g, "rect", { x: x0, y: y0, width: wd, height: ht, class: "zs-frame" });
    text(g, x0 + wd / 2, y0 + 16, "phase φ_k in degrees");
    const left = x0 + 36, right = x0 + wd - 12, topY = y0 + 30, botY = y0 + ht - 22;
    const X = (f) => left + (f / FMAX) * (right - left);
    const Y = (d) => (topY + botY) / 2 - (d / 180) * ((botY - topY) / 2);
    add(g, "path", { d: `M${left} ${topY} V${botY}`, class: "zs-axis" });
    add(g, "path", { d: `M${left} ${Y(0)} H${right}`, class: "zs-axis" });
    const kMax = Math.floor(FMAX * sig.T + 1e-9);
    for (let k = 1; k <= kMax; k++) {
      const { A, phi } = sig.coeff(k);
      if (A < 1e-9) continue;
      const x = X(k / sig.T), y = Y(deg(phi));
      const on = k <= N;
      add(g, "path", { d: `M${x.toFixed(1)} ${Y(0)} V${y.toFixed(1)}`, class: `fx-stem${on ? "" : " fx-stem--off"}` });
      add(g, "circle", { cx: x.toFixed(1), cy: y.toFixed(1), r: 2.5, class: `fx-dot${on ? "" : " fx-dot--off"}` });
    }
    text(g, left - 4, topY + 4, "180", "sim-label", "end");
    text(g, left - 4, Y(0) + 4, "0", "sim-label", "end");
    text(g, left - 4, botY, "−180", "sim-label", "end");
    for (const f of [0, 5, 10]) text(g, X(f), botY + 14, f === 10 ? "10 Hz" : String(f), "sim-label", f === 10 ? "end" : "middle");
  }

  function redraw() {
    if (destroyed) return;
    const s = panel.state;
    let sig;
    try { sig = fSignal(String(s.signal), Number(s.period), Number(s.delay)); } catch { sig = fSignal(SIGNALS[0]); }
    const N = Math.max(0, Math.round(Number(s.harmonics)));
    stage.clear();
    draw3d(sig, N, s);
    const pw = (W - 20) / 3;
    drawTime(sig, N, 0, H3 + 10, pw, HP - 10);
    drawSpectrum(sig, N, pw + 10, H3 + 10, pw, HP - 10);
    drawPhase(sig, N, 2 * pw + 20, H3 + 10, pw, HP - 10);
    const steps = walkSteps(sig, N);
    walk.textContent = stepIndex < 0
      ? "Press Next step ▶ to walk through this signal one idea at a time."
      : `Step ${stepIndex + 1} of ${steps.length}: ${steps[stepIndex].title}. ${steps[stepIndex].text}`;
    actions.buttons[0].disabled = stepIndex <= 0;
    actions.buttons[1].disabled = stepIndex >= steps.length - 1;
    const parts = [];
    for (let k = 0; k <= Math.min(N, 5); k++) {
      const { A, phi } = sig.coeff(k);
      if (A > 1e-9) parts.push(k === 0 ? `A₀ = ${fmt(A, 3)}` : `k = ${k}: A = ${fmt(A, 3)}, φ = ${degs(phi)}°`);
    }
    readout.textContent = `${sig.formula}. Fundamental f₀ = ${fmt(1 / sig.T)} Hz. ${parts.join("; ")}${N > 5 ? "; …" : ""}. RMS gap between signal and sum: ${fmt(rmsError(sig, N, 2000), 4)}.`;
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

registerWidget("fourier-3d", (ctx) => mountFourier3d(ctx));
