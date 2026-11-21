// src/widgets/types/convolution-3d.js
//
// `convolution-3d` — the convolution y(t) = ∫ x(τ) h(t − τ) dτ as a surface.
// The integrand x(τ)·h(t − τ) depends on two times, τ (across) and t (into the
// picture), so it is a landscape over the (τ, t) floor, drawn as ribbons:
//
//   - "fixed t" slices: each ribbon is the integrand for one t, the
//     flip-and-slide picture; its area is y(t);
//   - "fixed τ" slices: each ribbon is x(τ)·h(t − τ) along t, a copy of the
//     impulse response started at τ and scaled by the input there (echoes);
//   - on the right-hand wall, the output y(t) along the t axis, so each
//     fixed-t ribbon's area lands on the wall at its own t.
//
// Below: x(τ) with the flipped, shifted h(t − τ), their product with its area
// shaded, and the output y(t) traced up to the current t. "Next step ▶" walks
// through the operation in eight steps; "Slide t" plays t forward.
//
// Params keys, in order: x (select; options from SIGNALS in
// ../sims/convolution.js), h (select, same options), a (range, decay rate in
// 1/s, 0.2–3), t (range, seconds, −1–5), slices (select: SLICES), azimuth
// (range, degrees, −180–180), elevation (range, degrees, 5–85). No config.
// Styled by the .zs-*, .fx-* and .cv-* classes in alexandria.css.

import { registerWidget } from "../registry.js";
import { buildFrame, buildControlPanel, buildActions, buildReadout, buildStage, svgEl, makeTicker } from "../sim-kit.js";
import { SIGNALS, cSignal, convolve, outImpulses, sliceAtT, sliceAtTau, outSupport, overlap, productSupport, hasSmooth } from "../sims/convolution.js";
import { project3 } from "./z-surface.js";

export const SLICES = ["fixed t: flip and slide", "fixed τ: echoes of h"];

export const DEFAULT_PARAMS = [
  { key: "x", label: "Input x(t)", control: "select", options: SIGNALS, default: "pulse, 1 s wide" },
  { key: "h", label: "Impulse response h(t)", control: "select", options: SIGNALS, default: "decaying exponential e^(−at)u(t)" },
  { key: "a", label: "Decay rate a (1/s)", control: "range", min: 0.2, max: 3, step: 0.1, default: 1 },
  { key: "t", label: "Shift t (s)", control: "range", min: -1, max: 5, step: 0.05, default: 1 },
  { key: "slices", label: "3D slices", control: "select", options: SLICES, default: SLICES[0] },
  { key: "azimuth", label: "Turn (degrees)", control: "range", min: -180, max: 180, step: 5, default: -50 },
  { key: "elevation", label: "Tilt (degrees)", control: "range", min: 5, max: 85, step: 5, default: 30 },
];

/** The τ range across the view and the t range into it, in seconds. */
export const TAU_RANGE = [-2, 6], T_RANGE = [-1, 5];
const W = 760, H3 = 420, HP = 240, HGT = H3 + HP;
const XT = 1.6; // half-width of the τ axis in plane units
const YF = -1.1, YB = 1.6; // depth of t = −1 and of t = 5
const YX = -1.5; // depth of the x(τ) curve drawn in front
const XWALL = 1.95; // where the output wall stands
const HS = 0.9; // plane units of height per unit of the integrand
const NPTS = 200;
const T_STEP = 0.25, TAU_STEP = 0.125; // spacing of the fixed-t and fixed-τ slices

const fmt = (x, d = 2) => {
  if (!Number.isFinite(x)) return x > 0 ? "∞" : "−∞";
  const v = Math.abs(x) < 0.5 * 10 ** -d ? 0 : x;
  return v.toFixed(d).replace("-", "−");
};
const sfmt = (x) => (Math.abs(x) < 5e-3 ? "0" : String(Number(x.toFixed(2))).replace("-", "−"));
const xOf = (tau) => -XT + ((tau - TAU_RANGE[0]) / (TAU_RANGE[1] - TAU_RANGE[0])) * 2 * XT;
const yOf = (t) => YF + ((t - T_RANGE[0]) / (T_RANGE[1] - T_RANGE[0])) * (YB - YF);
const grid = (lo, hi, n) => Array.from({ length: n + 1 }, (_, i) => lo + ((hi - lo) * i) / n);
const TAUS = grid(TAU_RANGE[0], TAU_RANGE[1], NPTS);
const TS = grid(T_RANGE[0], T_RANGE[1], NPTS);

/** First and last index where vals is non-zero, widened by one sample (the whole range if all zero). */
function span(vals) {
  let i0 = -1, i1 = -1;
  vals.forEach((v, i) => { if (Math.abs(v) > 1e-9) { if (i0 < 0) i0 = i; i1 = i; } });
  if (i0 < 0) return [0, 0];
  return [Math.max(0, i0 - 1), Math.min(vals.length - 1, i1 + 1)];
}

/** y(t) sampled on the t axis, with the impulses of y, and the largest |value|. */
export function outputCurve(x, h, ts = TS) {
  const ys = ts.map((t) => convolve(x, h, t));
  const imps = outImpulses(x, h);
  let top = 0;
  for (const v of ys) top = Math.max(top, Math.abs(v));
  for (const [, w] of imps) top = Math.max(top, Math.abs(w));
  return { ys, imps, top };
}

/**
 * Everything the 3D view draws, as items with a mean depth, sorted far to
 * near (pure, for the tests). Kinds: "ribbon" (one slice: pts, base,
 * arrows as pairs of projected points), "wall" (the output curve), "x" (the
 * input in front).
 */
export function sceneItems(x, h, mode, azDeg, elDeg, tNow) {
  const az = (azDeg * Math.PI) / 180, el = (elDeg * Math.PI) / 180;
  const P = (px, py, ph) => project3(px, py, ph, az, el);
  const items = [];
  const arrow = (px, py, w) => [P(px, py, 0), P(px, py, HS * w)];
  if (mode === SLICES[1]) {
    const taus = grid(TAU_RANGE[0], TAU_RANGE[1], Math.round((TAU_RANGE[1] - TAU_RANGE[0]) / TAU_STEP));
    for (const [t0] of x.imp) if (t0 >= TAU_RANGE[0] && t0 <= TAU_RANGE[1] && !taus.some((u) => Math.abs(u - t0) < 1e-9)) taus.push(t0);
    for (const tau of taus) {
      const px = xOf(tau);
      const isImp = x.imp.find(([t0]) => Math.abs(t0 - tau) < 1e-9);
      let vals, arrows;
      if (isImp) {
        // x has an impulse of weight w at τ₀: this slice is w·h(t − τ₀) (a weight, not a density).
        const w = isImp[1];
        vals = TS.map((t) => w * h.f(t - tau));
        arrows = h.imp.map(([t1, w1]) => [tau + t1, w * w1]);
      } else ({ vals, arrows } = sliceAtTau(x, h, tau, TS));
      const live = vals.some((v) => Math.abs(v) > 1e-9) || arrows.length > 0;
      if (!live) continue;
      const [i0, i1] = span(vals);
      const pts = TS.slice(i0, i1 + 1).map((t, i) => P(px, yOf(t), HS * vals[i0 + i]));
      const base = [P(px, yOf(TS[i1]), 0), P(px, yOf(TS[i0]), 0)];
      items.push({ kind: "ribbon", key: tau, impulse: !!isImp, pts, base,
        arrows: arrows.filter(([t]) => t >= T_RANGE[0] && t <= T_RANGE[1]).map(([t, w]) => arrow(px, yOf(t), w)),
        depth: (P(px, YF, 0).depth + P(px, YB, 0).depth) / 2 });
    }
  } else {
    const ts = grid(T_RANGE[0], T_RANGE[1], Math.round((T_RANGE[1] - T_RANGE[0]) / T_STEP));
    for (const t of ts) {
      const py = yOf(t);
      const { vals, arrows } = sliceAtT(x, h, t, TAUS);
      const [i0, i1] = span(vals);
      const pts = TAUS.slice(i0, i1 + 1).map((tau, i) => P(xOf(tau), py, HS * vals[i0 + i]));
      const base = [P(xOf(TAUS[i1]), py, 0), P(xOf(TAUS[i0]), py, 0)];
      items.push({ kind: "ribbon", key: t, pts, base,
        arrows: arrows.filter(([tau]) => tau >= TAU_RANGE[0] && tau <= TAU_RANGE[1]).map(([tau, w]) => arrow(xOf(tau), py, w)),
        depth: (P(-XT, py, 0).depth + P(XT, py, 0).depth) / 2 });
    }
  }
  // The current fixed-t slice, drawn bold in either mode.
  {
    const py = yOf(tNow);
    const { vals, arrows } = sliceAtT(x, h, tNow, TAUS);
    items.push({ kind: "current", pts: TAUS.map((tau, i) => P(xOf(tau), py, HS * vals[i])),
      base: [P(XT, py, 0), P(-XT, py, 0)],
      arrows: arrows.filter(([tau]) => tau >= TAU_RANGE[0] && tau <= TAU_RANGE[1]).map(([tau, w]) => arrow(xOf(tau), py, w)),
      depth: P(0, py, 0).depth + 1e-6 });
  }
  const out = outputCurve(x, h);
  const ws = out.top > 0 ? 1.2 / out.top : 1;
  items.push({ kind: "wall", scale: ws, pts: TS.map((t, i) => P(XWALL, yOf(t), HS * ws * out.ys[i])),
    arrows: out.imps.filter(([t]) => t >= T_RANGE[0] && t <= T_RANGE[1]).map(([t, w]) => [P(XWALL, yOf(t), 0), P(XWALL, yOf(t), HS * ws * w)]),
    dot: P(XWALL, yOf(tNow), HS * ws * convolve(x, h, tNow)), foot: [P(XT, yOf(tNow), 0), P(XWALL, yOf(tNow), 0)],
    depth: P(XWALL, 0, 0).depth });
  items.push({ kind: "x", pts: TAUS.map((tau) => P(xOf(tau), YX, HS * x.f(tau))),
    arrows: x.imp.map(([t0, w]) => arrow(xOf(t0), YX, w)), depth: P(0, YX, 0).depth });
  items.sort((p, q) => p.depth - q.depth);
  return items;
}

/** Where the product lives at time t, in words: "for τ = 0 … 1", "at a spike at τ = 0.75", or "nowhere". */
export function describeProduct(x, h, t) {
  const { range, spikes } = productSupport(x, h, t);
  const parts = [];
  if (range) parts.push(`for τ = ${sfmt(range[0])} … ${Number.isFinite(range[1]) ? sfmt(range[1]) : "∞"}`);
  if (spikes.length) parts.push(`${range ? "plus " : ""}in ${spikes.length === 1 ? "a spike" : "spikes"} at τ = ${spikes.map(sfmt).join(" and ")}`);
  return parts.length ? parts.join(", ") : "nowhere";
}

/** The eight walk-through steps, as { title, text }. */
export function walkSteps(x, h, t) {
  const y = convolve(x, h, t);
  const imps = outImpulses(x, h);
  const [s0, s1] = outSupport(x, h);
  const ps = describeProduct(x, h, t);
  const ovText = ps === "nowhere" ? "they do not overlap at all, so the product is zero everywhere" : `the product can be non-zero ${ps}`;
  const imOnly = !hasSmooth(x) && !hasSmooth(h);
  const areaX = x.area, areaH = h.area;
  const areas = Number.isFinite(areaX) && Number.isFinite(areaH)
    ? `The areas multiply: area of y = area of x × area of h = ${sfmt(areaX)} × ${sfmt(areaH)} = ${sfmt(areaX * areaH)}.`
    : "One of the two never dies away, so its area is infinite, and so is the area of y.";
  const lasts = Number.isFinite(s1)
    ? `The durations add: x lasts from ${sfmt(x.s0)} to ${sfmt(x.s1)} s and h from ${sfmt(h.s0)} to ${sfmt(h.s1)} s, so y can be non-zero only from ${sfmt(s0)} to ${sfmt(s1)} s.`
    : `y starts at ${sfmt(s0)} s, the sum of the two start times, and since one signal goes on for ever, so does y.`;
  return [
    { title: "Two signals", text: `x is the input: ${x.text}. h is the impulse response, what the system puts out when the input is a single spike at t = 0: ${h.text}. Convolution gives the output, y(t) = ∫ x(τ) h(t − τ) dτ. The left panel shows x(τ) and h(τ) on the same τ axis.` },
    { title: "Flip", text: "Flip h about τ = 0 to get h(−τ). The reason: at time t, the input that arrived at time τ has been in the system for t − τ seconds, so it is weighted by h(t − τ). The newest input meets the start of the response, and older input meets the later, more faded part. Reading τ from left to right, the response therefore runs backwards." },
    { title: "Slide", text: `Now move the flipped copy right by t: h(t − τ). The dashed line marks τ = t, where the start of the response sits. With t = ${sfmt(t)} s, ${ovText}. Drag Shift t, or press Slide t, to move it.` },
    { title: "Multiply", text: `Multiply the two curves point by point: x(τ)·h(t − τ), in the middle panel. It is zero wherever either one is zero, so only the overlap counts.${imOnly ? " Both signals here are impulses, so the product is a spike only when two spikes line up exactly." : ""}` },
    { title: "Add up", text: `The area under that product is the output at this one moment: y(${sfmt(t)}) = ${fmt(y, 3)}${imps.length ? ` (plus the spikes of y, which come from two impulses lining up: ${imps.map(([p, w]) => `${sfmt(w)}·δ(t − ${sfmt(p)})`).join(" + ")})` : ""}. The dot in the right-hand panel is that value. In the 3D view, the bold ribbon is this product, at depth t.` },
    { title: "Every t at once", text: "Do the same for every t and the products stack up into a landscape over the (τ, t) floor: each ribbon is one t, and its area is the height of the curve on the right-hand wall, y(t). Turn the view to look along the τ axis (Turn −90°) and the wall shows y(t) head on." },
    { title: "Echoes: the other reading", text: "Now the 3D view slices the same landscape the other way, along t at fixed τ. Each ribbon is x(τ)·h(t − τ) as t runs: a copy of the impulse response that starts at time τ, scaled by the input there. The input is a crowd of tiny impulses, each sets off its own copy of h, and y is the sum of all the copies. Seen from the side they pile up, and the wall shows their total." },
    { title: "What convolution keeps", text: `${lasts} ${areas} The order does not matter: x * h = h * x (swap the two selects; y does not change). And in frequency, convolution becomes multiplication: Y(f) = X(f)·H(f).` },
  ];
}

function mergeParams(params) {
  return Array.isArray(params) && params.length > 0 ? params : DEFAULT_PARAMS;
}

function mountConvolution3d(ctx) {
  const spec = ctx.spec ?? {};
  const { doc, root } = buildFrame(ctx.container, spec);
  const params = mergeParams(spec.params);
  const panel = buildControlPanel(doc, root, params, () => schedule());
  let stepIndex = -1;
  const ticker = makeTicker(() => {
    let t = Number(panel.state.t) + 0.05;
    if (t > T_RANGE[1] + 1e-9) t = T_RANGE[0];
    panel.update({ t: Math.round(t * 100) / 100 });
    schedule();
  }, 60);
  const go = (i) => {
    stepIndex = i;
    if (i === 5) panel.update({ slices: SLICES[0], azimuth: -50, elevation: 30 });
    if (i === 6) panel.update({ slices: SLICES[1], azimuth: -90, elevation: 15 });
    redraw();
  };
  const actions = buildActions(doc, root, [
    { label: "◀ Back", secondary: true, onClick: () => go(Math.max(0, stepIndex - 1)) },
    { label: "Next step ▶", onClick: () => go(Math.min(7, stepIndex + 1)) },
    {
      label: "Slide t", secondary: true,
      onClick: () => {
        const on = ticker.toggle();
        actions.buttons[2].setAttribute("aria-pressed", on ? "true" : "false");
      },
    },
  ]);
  const stage = buildStage(doc, root, W, HGT,
    "Convolution in 3D: the product x(τ)h(t − τ) as ribbons over the τ and t axes, with the output y(t) on the wall, and below it the flipped and shifted signals, their product and the output");
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
  /** An upward (or downward) arrow from screen point p to q with a small head. */
  const arrowPath = (p, q) => {
    const dx = q[0] - p[0], dy = q[1] - p[1], len = Math.hypot(dx, dy);
    if (len < 1) return "";
    const ux = dx / len, uy = dy / len, s = Math.min(6, len / 2);
    const a = [q[0] - s * ux + 0.6 * s * uy, q[1] - s * uy - 0.6 * s * ux];
    const b = [q[0] - s * ux - 0.6 * s * uy, q[1] - s * uy + 0.6 * s * ux];
    return `${poly([p, q])} ${poly([a, q, b])}`;
  };

  function draw3d(x, h, s) {
    const g = add(svg, "g", { class: `zs-panel${[4, 5, 6].includes(stepIndex) ? " zs-focus" : ""}` });
    add(g, "rect", { x: 0, y: 0, width: W, height: H3, class: "zs-frame" });
    const az = (Number(s.azimuth) * Math.PI) / 180, el = (Number(s.elevation) * Math.PI) / 180;
    const P = (px, py, ph) => project3(px, py, ph, az, el);
    const corners = [];
    for (const px of [-XT, XWALL]) for (const py of [YX, YB]) for (const ph of [-1.3 * HS, 1.3 * HS]) corners.push(P(px, py, ph));
    const uMin = Math.min(...corners.map((c) => c.u)), uMax = Math.max(...corners.map((c) => c.u));
    const vMin = Math.min(...corners.map((c) => c.v)), vMax = Math.max(...corners.map((c) => c.v));
    const scale = Math.min((W - 60) / (uMax - uMin), (H3 - 70) / (vMax - vMin));
    const ox = W / 2 - (scale * (uMin + uMax)) / 2, oy = H3 / 2 + 10 + (scale * (vMin + vMax)) / 2;
    const S = (p) => [ox + scale * p.u, oy - scale * p.v];

    const floor = [[-XT, YF], [XT, YF], [XT, YB], [-XT, YB]].map(([px, py]) => S(P(px, py, 0)));
    add(g, "path", { d: `${poly(floor)} Z`, class: "zs-floor" });
    // The line τ = t on the floor, and the axes.
    const diag = [];
    for (const t of grid(T_RANGE[0], T_RANGE[1], 24)) if (t >= TAU_RANGE[0] && t <= TAU_RANGE[1]) diag.push(S(P(xOf(t), yOf(t), 0)));
    add(g, "path", { d: poly(diag), class: "zs-grid" });
    add(g, "path", { d: poly([S(P(-XT, YX, 0)), S(P(XT, YX, 0))]), class: "zs-axis" });
    add(g, "path", { d: poly([S(P(XWALL, YF, 0)), S(P(XWALL, YB, 0))]), class: "zs-axis" });

    const wall = [[YF, 0], [YB, 0], [YB, 1.3 * HS], [YF, 1.3 * HS]].map(([py, ph]) => S(P(XWALL, py, ph)));
    add(g, "path", { d: `${poly(wall)} Z`, class: "zs-floor cv-wall" });
    const fixedTau = String(s.slices) === SLICES[1];
    // Seen edge-on, fixed-t ribbons are clutter in front of the wall: fade them.
    const fade = fixedTau ? 1 : 1 - 0.85 * Math.max(0, (Math.abs(Math.sin(az)) - 0.8) / 0.2);
    let i = 0;
    for (const it of sceneItems(x, h, String(s.slices), Number(s.azimuth), Number(s.elevation), Number(s.t))) {
      if (it.kind === "ribbon") {
        const pts = it.pts.map(S);
        const c = `cv-c${(i++) % 2}${it.impulse ? " cv-imp" : ""}`;
        add(g, "path", { d: `${poly(pts.concat(it.base.map(S)))} Z`, class: `fx-ribbon ${c}`, opacity: fade.toFixed(2) });
        add(g, "path", { d: poly(pts), class: `cv-line ${c}`, opacity: fade.toFixed(2) });
        for (const [p, q] of it.arrows) add(g, "path", { d: arrowPath(S(p), S(q)), class: `cv-arrow ${c}`, opacity: fade.toFixed(2) });
      } else if (it.kind === "current") {
        const pts = it.pts.map(S);
        add(g, "path", { d: `${poly(pts.concat(it.base.map(S)))} Z`, class: "cv-area" });
        add(g, "path", { d: poly(pts), class: "fx-sum" });
        for (const [p, q] of it.arrows) add(g, "path", { d: arrowPath(S(p), S(q)), class: "cv-arrow cv-arrow--now" });
      } else if (it.kind === "wall") {
        add(g, "path", { d: poly(it.foot.map(S)), class: "zs-probe-line" });
        add(g, "path", { d: poly(it.pts.map(S)), class: "cv-out" });
        for (const [p, q] of it.arrows) add(g, "path", { d: arrowPath(S(p), S(q)), class: "cv-arrow cv-arrow--out" });
        const d = S(it.dot);
        add(g, "circle", { cx: d[0].toFixed(1), cy: d[1].toFixed(1), r: 4, class: "zs-probe" });
      } else {
        add(g, "path", { d: poly(it.pts.map(S)), class: "fx-signal" });
        for (const [p, q] of it.arrows) add(g, "path", { d: arrowPath(S(p), S(q)), class: "cv-arrow cv-arrow--x" });
      }
    }
    const lab = (px, py, ph, s2, anchor = "middle") => { const p = S(P(px, py, ph)); text(g, p[0], p[1], s2, "sim-label zs-hint", anchor); };
    lab(XT * 1.08, YX, 0, "τ", "start");
    lab(-XT, YX, -0.25 * HS, `τ = ${sfmt(TAU_RANGE[0])}`, "start");
    lab(XT, YX, -0.25 * HS, `τ = ${TAU_RANGE[1]}`, "end");
    lab(-XT, YX, 1.15 * HS, "x(τ)", "start");
    lab(XWALL + 0.2, YF, -0.1, `t = ${sfmt(T_RANGE[0])}`, "start");
    lab(XWALL + 0.2, YB, -0.1, `t = ${T_RANGE[1]}`, "start");
    lab(XWALL, YB + 0.35, 1.3 * HS, "y(t) on the wall", "middle");
    text(g, 12, 20, fixedTau
      ? "each ribbon: x(τ)·h(t − τ) along t for one τ, a copy of h started at τ and scaled by x(τ)"
      : "each ribbon: the product x(τ)·h(t − τ) for one t; its area is y(t), drawn on the right-hand wall", "sim-label", "start");
    text(g, 12, 38, `bold: the slice at t = ${sfmt(Number(s.t))} s · dashed line on the floor: τ = t · front: the input x(τ)`, "sim-label", "start");
    text(g, W - 12, H3 - 12, "drag to turn", "sim-label zs-hint", "end");
  }

  /** A small 2D panel frame; returns mapping helpers. */
  function frame2d(x0, y0, wd, ht, title, focus, lo, hi, range) {
    const g = add(svg, "g", { class: `zs-panel${focus ? " zs-focus" : ""}` });
    add(g, "rect", { x: x0, y: y0, width: wd, height: ht, class: "zs-frame" });
    text(g, x0 + wd / 2, y0 + 16, title);
    const left = x0 + 14, right = x0 + wd - 10, topY = y0 + 28, botY = y0 + ht - 22;
    const X = (u) => left + ((u - range[0]) / (range[1] - range[0])) * (right - left);
    const Y = (v) => botY - ((Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * (botY - topY);
    add(g, "path", { d: `M${left} ${Y(0).toFixed(1)} H${right}`, class: "zs-axis" });
    for (let u = Math.ceil(range[0]); u <= range[1]; u++) {
      add(g, "path", { d: `M${X(u).toFixed(1)} ${Y(0).toFixed(1)} v3`, class: "zs-axis" });
      if (u % 2 === 0) text(g, X(u), botY + 14, String(u).replace("-", "−"), "sim-label zs-hint");
    }
    return { g, X, Y, left, right, topY, botY };
  }
  const curve = (g, X, Y, us, vs, cls) => add(g, "path", { d: poly(us.map((u, i) => [X(u), Y(vs[i])])), class: cls });
  const arrows2d = (g, X, Y, list, cls) => { for (const [u, w] of list) add(g, "path", { d: arrowPath([X(u), Y(0)], [X(u), Y(w)]), class: cls }); };

  function drawPanels(x, h, s, pw) {
    const t = Number(s.t);
    const neg = SIGNALS.length && (x.name.startsWith("damped") || h.name.startsWith("damped"));
    const lo = neg ? -1.15 : -0.2, hi = 1.2;
    const y0 = H3 + 10, ht = HP - 10;
    // 1. x(τ) and the flipped, shifted h.
    const mode = stepIndex === 0 ? "h(τ)" : stepIndex === 1 ? "h(−τ)" : "h(t − τ)";
    const shift = stepIndex === 0 ? null : stepIndex === 1 ? 0 : t;
    const A = frame2d(0, y0, pw, ht, `x(τ) and ${mode}`, [0, 1, 2].includes(stepIndex), lo, hi, TAU_RANGE);
    const ov = shift === null ? null : overlap(x, h, shift);
    if (ov && ov[1] > ov[0]) {
      const p = Math.max(ov[0], TAU_RANGE[0]), q = Math.min(ov[1], TAU_RANGE[1]);
      if (q > p) add(A.g, "rect", { x: A.X(p).toFixed(1), y: A.topY, width: (A.X(q) - A.X(p)).toFixed(1), height: A.botY - A.topY, class: "cv-overlap" });
    }
    curve(A.g, A.X, A.Y, TAUS, TAUS.map((u) => x.f(u)), "cv-x");
    arrows2d(A.g, A.X, A.Y, x.imp, "cv-arrow cv-arrow--x");
    const hv = TAUS.map((u) => (shift === null ? h.f(u) : h.f(shift - u)));
    curve(A.g, A.X, A.Y, TAUS, hv, "cv-h");
    arrows2d(A.g, A.X, A.Y, h.imp.map(([t1, w]) => [shift === null ? t1 : shift - t1, w]).filter(([u]) => u >= TAU_RANGE[0] && u <= TAU_RANGE[1]), "cv-arrow cv-arrow--h");
    if (shift !== null && shift >= TAU_RANGE[0]) {
      add(A.g, "path", { d: `M${A.X(shift).toFixed(1)} ${A.topY} V${A.botY}`, class: "zs-probe-line" });
      text(A.g, A.X(shift) + 3, A.topY + 10, shift === 0 ? "τ = 0" : "τ = t", "sim-label zs-hint", "start");
    }

    // 2. The product and its area.
    const B = frame2d(pw + 10, y0, pw, ht, "product x(τ)·h(t − τ)", [3, 4].includes(stepIndex), lo, hi, TAU_RANGE);
    const { vals, arrows } = sliceAtT(x, h, t, TAUS);
    const area = TAUS.map((u, i) => [B.X(u), B.Y(vals[i])]);
    add(B.g, "path", { d: `${poly(area)} L${B.X(TAU_RANGE[1]).toFixed(1)} ${B.Y(0).toFixed(1)} L${B.X(TAU_RANGE[0]).toFixed(1)} ${B.Y(0).toFixed(1)} Z`, class: "cv-area" });
    add(B.g, "path", { d: poly(area), class: "fx-sum" });
    arrows2d(B.g, B.X, B.Y, arrows.filter(([u]) => u >= TAU_RANGE[0] && u <= TAU_RANGE[1]), "cv-arrow cv-arrow--now");
    text(B.g, B.right, B.topY + 10, `area = y(${sfmt(t)}) = ${fmt(convolve(x, h, t), 3)}`, "sim-label", "end");

    // 3. The output.
    const out = outputCurve(x, h);
    let ymin = 0, ymax = 0;
    for (const v of out.ys) { ymin = Math.min(ymin, v); ymax = Math.max(ymax, v); }
    for (const [, w] of out.imps) { ymin = Math.min(ymin, w); ymax = Math.max(ymax, w); }
    const span = Math.max(ymax - ymin, 1e-6);
    const C = frame2d(2 * pw + 20, y0, pw, ht, "output y(t)", [4, 5, 7].includes(stepIndex), ymin - 0.08 * span, ymax + 0.12 * span, T_RANGE);
    curve(C.g, C.X, C.Y, TS, out.ys, "cv-out cv-out--ghost");
    const upto = TS.filter((u) => u <= t);
    if (upto.length > 1) curve(C.g, C.X, C.Y, upto, upto.map((u) => convolve(x, h, u)), "cv-out");
    arrows2d(C.g, C.X, C.Y, out.imps.filter(([u]) => u >= T_RANGE[0] && u <= T_RANGE[1]), "cv-arrow cv-arrow--out");
    const yn = convolve(x, h, t);
    add(C.g, "circle", { cx: C.X(t).toFixed(1), cy: C.Y(yn).toFixed(1), r: 4, class: "zs-probe" });
    text(C.g, C.left + 2, C.topY + 10, `top ${fmt(ymax, 2)}`, "sim-label zs-hint", "start");
  }

  function redraw() {
    if (destroyed) return;
    const s = panel.state;
    let x, h;
    try { x = cSignal(String(s.x), Number(s.a)); } catch { x = cSignal(SIGNALS[0]); }
    try { h = cSignal(String(s.h), Number(s.a)); } catch { h = cSignal(SIGNALS[4], 1); }
    stage.clear();
    draw3d(x, h, s);
    const pw = (W - 20) / 3;
    drawPanels(x, h, s, pw);
    const t = Number(s.t);
    const steps = walkSteps(x, h, t);
    walk.textContent = stepIndex < 0
      ? "Press Next step ▶ to walk through the convolution one idea at a time."
      : `Step ${stepIndex + 1} of ${steps.length}: ${steps[stepIndex].title}. ${steps[stepIndex].text}`;
    actions.buttons[0].disabled = stepIndex <= 0;
    actions.buttons[1].disabled = stepIndex >= steps.length - 1;
    const imps = outImpulses(x, h);
    const ps = describeProduct(x, h, t);
    readout.textContent = `x(t) = ${x.formula}, h(t) = ${h.formula}. At t = ${sfmt(t)} s the product is non-zero ${ps === "nowhere" ? "nowhere" : ps}, y(t) = ${fmt(convolve(x, h, t), 3)}${imps.length ? `; y also has spikes ${imps.map(([p, w]) => `${sfmt(w)}·δ(t − ${sfmt(p)})`).join(" + ")}` : ""}.`;
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

registerWidget("convolution-3d", (ctx) => mountConvolution3d(ctx));
