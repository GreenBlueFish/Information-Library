// src/widgets/types/z-surface.js
//
// `z-surface` — the z-transform as a landscape. The reader picks an input
// signal and sees, all at once:
//
//   - a 3D surface of |X(z)| over the complex plane (drag it, or use the two
//     view sliders, to turn it), faded where the sum does not converge, with
//     the unit circle traced on it and a probe at z = e^(jω);
//   - the pole-zero plot from above, with the region of convergence shaded and
//     the vectors from every zero and pole to the probe (the geometric way to
//     read |X| at a point);
//   - the samples x[n];
//   - the slice of the surface along the unit circle, |X(e^(jω))| for
//     0 ≤ ω ≤ 180°, with the probe marked.
//
// "Next step ▶" walks through the signal in eight steps (sequence, sum, poles
// and zeros, surface, ROC, unit circle, the geometric reading, stability and
// causality), and "Sweep ω" moves the probe round the circle.
//
// Params keys, in order: signal (select; options from SIGNALS in
// ../sims/ztransform.js), r (range), theta (range, degrees), omega (range,
// degrees, 0–180), height (select: "decibels", "magnitude"), azimuth (range,
// degrees, −180–180), elevation (range, degrees, 10–85). No config.
// Styled by the .zs-* classes in alexandria.css.

import { registerWidget } from "../registry.js";
import { buildFrame, buildControlPanel, buildActions, buildReadout, buildStage, svgEl, makeTicker } from "../sim-kit.js";
import {
  SIGNALS, C, zSignal, evalX, magX, inRoc, heightAt, HEIGHT, geometric, verdict, withMultiplicity,
} from "../sims/ztransform.js";

export const DEFAULT_PARAMS = [
  { key: "signal", label: "Input signal", control: "select", options: SIGNALS, default: "decaying exponential rⁿu[n]" },
  { key: "r", label: "Radius r", control: "range", min: 0.1, max: 1.2, step: 0.05, default: 0.8 },
  { key: "theta", label: "Angle θ (degrees)", control: "range", min: 0, max: 180, step: 5, default: 45 },
  { key: "omega", label: "Probe frequency ω (degrees)", control: "range", min: 0, max: 180, step: 1, default: 45 },
  { key: "height", label: "Height shows", control: "select", options: ["decibels", "magnitude"], default: "decibels" },
  { key: "azimuth", label: "Turn (degrees)", control: "range", min: -180, max: 180, step: 5, default: -35 },
  { key: "elevation", label: "Tilt (degrees)", control: "range", min: 10, max: 85, step: 5, default: 30 },
];

/** Half-width of the square of the z-plane the surface covers. */
export const EXTENT = 1.6;
const GRID = 40; // cells per side
const BANDS = 10; // colour bands for height
const W = 760, H3 = 430, HP = 250, HGT = H3 + HP;
const LIFT = 1.6; // height of the top of the view, in plane units

const fmt = (x, d = 2) => {
  if (!Number.isFinite(x)) return x > 0 ? "∞" : "−∞";
  const v = Math.abs(x) < 0.5 * 10 ** -d ? 0 : x;
  return v.toFixed(d).replace("-", "−");
};
/** Short form for points in lists: at most two decimals, no trailing zeros. */
const sfmt = (x) => (Math.abs(x) < 5e-3 ? "0" : Number(x.toFixed(2)).toString().replace("-", "−"));
/** A complex number in engineering form, a ± bj. */
export function cfmt(z, d = 2, f = (x) => fmt(x, d)) {
  const re = Math.abs(z[0]) < 0.5 * 10 ** -d ? 0 : z[0];
  const im = Math.abs(z[1]) < 0.5 * 10 ** -d ? 0 : z[1];
  if (im === 0) return f(re);
  if (re === 0) return `${f(im)}j`;
  return `${f(re)} ${im < 0 ? "−" : "+"} ${f(Math.abs(im))}j`;
}
const plist = (pts) =>
  withMultiplicity(pts).map((o) => (o.count > 1 ? `${cfmt(o.at, 2, sfmt)} (×${o.count})` : cfmt(o.at, 2, sfmt))).join(", ");

/**
 * Project a point (x, y in the plane, h = height in plane units) for a view
 * turned by `az` and tilted by `el` (radians). `depth` grows toward the viewer.
 */
export function project3(x, y, h, az, el) {
  const xr = x * Math.cos(az) - y * Math.sin(az);
  const yr = x * Math.sin(az) + y * Math.cos(az);
  return { u: xr, v: h * Math.cos(el) + yr * Math.sin(el), depth: -yr * Math.cos(el) + h * Math.sin(el) };
}

/** Height (0…LIFT) of the surface at z for the chosen mode. */
function lift(sig, z, mode) {
  const hm = HEIGHT[mode] ?? HEIGHT.decibels;
  return (LIFT * (heightAt(sig, z, mode) - hm.lo)) / (hm.hi - hm.lo);
}

/**
 * The surface as quads, sorted far to near, each with its band (0…BANDS−1)
 * and whether its centre is inside the ROC. Pure, so the tests can check it.
 */
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
      const centre = [x0 + step / 2, y0 + step / 2];
      quads.push({
        pts,
        depth: pts.reduce((s, p) => s + p.depth, 0) / 4,
        band: Math.max(0, Math.min(BANDS - 1, Math.floor((hMean / LIFT) * BANDS))),
        inside: inRoc(sig, centre),
      });
    }
  }
  quads.sort((a, b) => a.depth - b.depth);
  return quads;
}

/** The eight walk-through steps for a signal, as { title, text }. */
export function walkSteps(sig, omegaDeg, mode = "decibels") {
  const v = verdict(sig);
  const w = (omegaDeg * Math.PI) / 180;
  const probe = C.polar(1, w);
  const g = geometric(sig, probe);
  const hm = HEIGHT[mode] ?? HEIGHT.decibels;
  const kind = sig.finite
    ? "It is finite: only a few samples are not zero."
    : sig.leftSided
      ? "It is left-sided: every sample from n = 0 on is zero, and it runs off to n = −∞."
      : sig.rightSided
        ? "It is right-sided: it starts at n = 0 and runs on forever."
        : "It is two-sided: it runs forever in both directions.";
  const rocWhy = sig.roc.empty
    ? "Here no ring works, so the transform does not exist for any z: the faded surface is just the formula."
    : sig.finite
      ? "A finite sum always converges, so the ROC is the whole plane, except z = 0 when a sample sits at n > 0 (z⁻ⁿ blows up there)."
      : sig.leftSided
        ? "A left-sided signal converges inside a circle: inside its innermost pole."
        : sig.rightSided
          ? "A right-sided signal converges outside a circle: outside its outermost pole, because far from the origin z⁻ⁿ shrinks fast enough to tame the samples."
          : "A two-sided signal needs both halves to converge: the right-sided half outside one pole, the left-sided half inside the other, which leaves a ring between them.";
  const zeros = sig.zeros.length ? `Zeros at ${plist(sig.zeros)}.` : "No zeros.";
  const poles = sig.poles.length ? `Poles at ${plist(sig.poles)}.` : "No poles.";
  const dist = (arr) => (arr.length ? arr.map((d) => fmt(d)).join(" × ") : "1");
  const val = g.value;
  const valText = mode === "decibels" ? `${fmt(val)} (${fmt(hm.of(val), 1)} dB)` : fmt(val);
  return [
    { title: "The sequence", text: `${sig.sequence}. ${kind} Its samples are the stems in the x[n] panel.` },
    {
      title: "The transform",
      text: `Each sample is weighted by z⁻ⁿ and the weighted samples are added up: X(z) = Σ x[n] z⁻ⁿ. For this signal the sum comes to ${sig.formula}. With z = ρe^(jω), the weight z⁻ⁿ = ρ⁻ⁿ e^(−jωn): the distance ρ from the origin sets how fast the weights grow or shrink, the angle ω how fast they turn.`,
    },
    {
      title: "Zeros and poles",
      text: `${zeros} ${poles} A zero is where X(z) = 0: the surface touches the floor. A pole is where X(z) is infinite: the surface shoots up (it is cut off at the top of the view). Zeros and poles fix X(z) up to one constant factor, here ${fmt(sig.gain, 3)}.`,
    },
    {
      title: "The surface",
      text: `The 3D view plots ${mode === "decibels" ? "20·log₁₀|X(z)| in decibels, from −30 dB (floor) to +30 dB (top)" : "|X(z)| itself, from 0 (floor) to 10 (top)"} above every point of the plane. Peaks stand over the poles, pits sink at the zeros, and the colour follows the height. Drag the view, or use Turn and Tilt, to look at it from any side.`,
    },
    {
      title: "Region of convergence",
      text: `${sig.roc.empty ? `There is no region of convergence: ${sig.rocText}.` : `The sum only converges for ${sig.rocText}: that is the region of convergence (ROC), shaded in the z-plane panel and drawn solid on the surface.`} ${rocWhy} The ROC never contains a pole, and the formula alone does not say which signal you have: the right-sided and left-sided exponentials share X(z) = z/(z − r) and differ only in their ROC.`,
    },
    {
      title: "The unit circle",
      text: `On the circle |z| = 1, z = e^(jω) and the sum becomes Σ x[n] e^(−jωn): the discrete-time Fourier transform (DTFT). So the frequency response is the height of the surface along the ring traced on it, unrolled in the bottom-right panel. For this signal the DTFT ${v.dtft}.`,
    },
    {
      title: "Reading |X| with a ruler",
      text: `At the probe, ω = ${omegaDeg}°, z = e^(jω) = ${cfmt(probe)}. |X| is the constant |${fmt(sig.gain, 3)}| times the distances from each zero to the probe (${dist(g.zeroDistances)}) divided by the distances from each pole (${dist(g.poleDistances)}) = ${valText}. Drag the probe frequency, or press Sweep ω: the response dips where the probe passes close to a zero and peaks where it passes close to a pole.`,
    },
    {
      title: "Stable? Causal?",
      text: `${v.stable ? "Stable: the unit circle lies inside the ROC, so Σ|x[n]| is finite and the DTFT exists." : "Not stable: the unit circle is not inside the ROC, so Σ|x[n]| is infinite."} ${v.causal ? "Causal: x[n] = 0 for n < 0, so the ROC is everything outside a circle (plus ∞)." : "Not causal: it has samples before n = 0."} ${sig.rightSided && !sig.finite ? `For a causal signal, stable means every pole is inside the unit circle; the outermost pole here has |p| = ${fmt(v.maxPole)}.` : ""}`.trim(),
    },
  ];
}

function mergeParams(params) {
  return Array.isArray(params) && params.length > 0 ? params : DEFAULT_PARAMS;
}

function mountZSurface(ctx) {
  const spec = ctx.spec ?? {};
  const { doc, root } = buildFrame(ctx.container, spec);
  const panel = buildControlPanel(doc, root, mergeParams(spec.params), () => schedule());
  let stepIndex = -1; // −1: no walk-through step shown yet
  const ticker = makeTicker(() => {
    const next = (Number(panel.state.omega) + 2) % 181;
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
    "Surface of the magnitude of X(z) over the complex plane, with the pole-zero plot, the samples x[n] and the frequency response below");
  const walk = doc.createElement("p");
  walk.className = "zs-walk";
  root.appendChild(walk);
  const readout = buildReadout(doc, root);
  let destroyed = false;
  let pending = false;

  // --- dragging the 3D view ------------------------------------------------
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
    panel.update({ azimuth: Math.round(az), elevation: Math.round(el) });
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

  function drawMarkers(g, at, sig, size) {
    for (const o of withMultiplicity(sig.zeros)) {
      const [x, y] = at(o.at);
      add(g, "circle", { cx: x.toFixed(1), cy: y.toFixed(1), r: size, class: "zs-zero" });
      if (o.count > 1) text(g, x + size + 2, y - size, `×${o.count}`, "sim-label zs-mult", "start");
    }
    for (const o of withMultiplicity(sig.poles)) {
      const [x, y] = at(o.at);
      add(g, "path", { d: `M${x - size} ${y - size} L${x + size} ${y + size} M${x - size} ${y + size} L${x + size} ${y - size}`, class: "zs-pole" });
      if (o.count > 1) text(g, x + size + 2, y - size, `×${o.count}`, "sim-label zs-mult", "start");
    }
  }

  function draw3d(sig, s) {
    const g = add(svg, "g", { class: `zs-panel${stepIndex === 3 || stepIndex === 4 ? " zs-focus" : ""}` });
    add(g, "rect", { x: 0, y: 0, width: W, height: H3, class: "zs-frame" });
    const az = (Number(s.azimuth) * Math.PI) / 180, el = (Number(s.elevation) * Math.PI) / 180;
    const P = (x, y, h) => project3(x, y, h, az, el);
    // Fit the view: the floor square and the top of the box.
    const corners = [];
    for (const x of [-EXTENT, EXTENT]) for (const y of [-EXTENT, EXTENT]) for (const h of [0, LIFT]) corners.push(P(x, y, h));
    const uMin = Math.min(...corners.map((c) => c.u)), uMax = Math.max(...corners.map((c) => c.u));
    const vMin = Math.min(...corners.map((c) => c.v)), vMax = Math.max(...corners.map((c) => c.v));
    const scale = Math.min((W - 40) / (uMax - uMin), (H3 - 40) / (vMax - vMin));
    const ox = W / 2 - (scale * (uMin + uMax)) / 2, oy = H3 / 2 + (scale * (vMin + vMax)) / 2;
    const S = (p) => [ox + scale * p.u, oy - scale * p.v];

    // Floor: the square, the axes, the unit circle and the ROC boundaries.
    const floor = [[-EXTENT, -EXTENT], [EXTENT, -EXTENT], [EXTENT, EXTENT], [-EXTENT, EXTENT]].map(([x, y]) => S(P(x, y, 0)));
    add(g, "path", { d: `${poly(floor)} Z`, class: "zs-floor" });
    add(g, "path", { d: poly([S(P(-EXTENT, 0, 0)), S(P(EXTENT, 0, 0))]), class: "zs-axis" });
    add(g, "path", { d: poly([S(P(0, -EXTENT, 0)), S(P(0, EXTENT, 0))]), class: "zs-axis" });
    const ring = (rad, cls) => {
      if (!(rad > 0) || rad > EXTENT) return;
      const pts = [];
      for (let k = 0; k <= 96; k++) { const t = (2 * Math.PI * k) / 96; pts.push(S(P(rad * Math.cos(t), rad * Math.sin(t), 0))); }
      add(g, "path", { d: poly(pts), class: cls });
    };
    ring(1, "zs-floor-circle");
    if (!sig.roc.empty) { ring(sig.roc.inner, "zs-roc-edge"); if (Number.isFinite(sig.roc.outer)) ring(sig.roc.outer, "zs-roc-edge"); }

    // The surface, far to near.
    const quads = surfaceQuads(sig, String(s.height), Number(s.azimuth), Number(s.elevation));
    for (const q of quads) {
      add(g, "path", {
        d: `${poly(q.pts.map(S))} Z`,
        class: `zs-face zs-band-${q.band}${q.inside ? "" : " zs-face--outside"}`,
      });
    }

    // The unit circle on the surface: the near half solid, the far half lighter.
    const front = [], back = [];
    const flush = () => {
      if (front.length > 1) add(g, "path", { d: poly(front), class: "zs-ucircle" });
      if (back.length > 1) add(g, "path", { d: poly(back), class: "zs-ucircle zs-ucircle--back" });
    };
    let lastFar = null;
    for (let k = 0; k <= 180; k++) {
      const t = (2 * Math.PI * k) / 180;
      const z = [Math.cos(t), Math.sin(t)];
      const p = P(z[0], z[1], lift(sig, z, String(s.height)));
      const far = p.depth < 0;
      if (lastFar !== null && far !== lastFar) {
        // Carry the joining point so the two halves meet.
        (far ? back : front).push(S(p));
        flush(); front.length = 0; back.length = 0;
      }
      (far ? back : front).push(S(p));
      lastFar = far;
    }
    flush();

    const re = S(P(EXTENT * 1.1, 0, 0)), im = S(P(0, EXTENT * 1.1, 0));
    text(g, re[0], re[1] + 4, "Re z");
    text(g, im[0], im[1] + 4, "Im z");

    // Poles and zeros on the floor, and the probe.
    const fl = (q) => S(P(q[0], q[1], 0));
    // Each pole inside the square gets a "tent pole" from the floor to the top of the view.
    for (const o of withMultiplicity(sig.poles)) {
      if (Math.abs(o.at[0]) > EXTENT || Math.abs(o.at[1]) > EXTENT) continue;
      const a = fl(o.at), b = S(P(o.at[0], o.at[1], LIFT));
      add(g, "path", { d: poly([a, b]), class: "zs-pole-line" });
    }
    drawMarkers(g, (q) => fl(q), sig, 5);
    const w = (Number(s.omega) * Math.PI) / 180;
    const pz = [Math.cos(w), Math.sin(w)];
    const top = S(P(pz[0], pz[1], lift(sig, pz, String(s.height)))), bot = fl(pz);
    add(g, "path", { d: poly([bot, top]), class: "zs-probe-line" });
    add(g, "circle", { cx: top[0].toFixed(1), cy: top[1].toFixed(1), r: 5, class: "zs-probe" });
    add(g, "circle", { cx: bot[0].toFixed(1), cy: bot[1].toFixed(1), r: 3, class: "zs-probe" });
    text(g, 12, 20, `height: ${String(s.height) === "decibels" ? "20·log₁₀|X(z)|, −30 to +30 dB" : "|X(z)|, 0 to 10"}`, "sim-label", "start");
    text(g, 12, 38, sig.roc.empty ? "no region of convergence: the whole surface is faded" : "solid: inside the ROC · faded: outside", "sim-label", "start");
    text(g, W - 12, H3 - 12, "drag to turn", "sim-label zs-hint", "end");
  }

  function drawPlane(sig, s, x0, y0, wd, ht) {
    const g = add(svg, "g", { class: `zs-panel${[2, 4, 6].includes(stepIndex) ? " zs-focus" : ""}` });
    add(g, "rect", { x: x0, y: y0, width: wd, height: ht, class: "zs-frame" });
    text(g, x0 + wd / 2, y0 + 16, "z-plane from above");
    const R = 1.8, cx = x0 + wd / 2, cy = y0 + 24 + (ht - 30) / 2, k = (Math.min(wd, ht - 30) / 2 - 6) / R;
    const at = (q) => [cx + k * Math.max(-R, Math.min(R, q[0])), cy - k * Math.max(-R, Math.min(R, q[1]))];
    // ROC shading, clipped to the panel's square.
    const sq = `M${cx - k * R} ${cy - k * R} H${cx + k * R} V${cy + k * R} H${cx - k * R} Z`;
    const circ = (rad) => `M${cx + k * rad} ${cy} A${k * rad} ${k * rad} 0 1 0 ${cx - k * rad} ${cy} A${k * rad} ${k * rad} 0 1 0 ${cx + k * rad} ${cy} Z`;
    if (!sig.roc.empty) {
      const outer = Number.isFinite(sig.roc.outer) && sig.roc.outer < R * 1.42 ? circ(Math.min(sig.roc.outer, R * 1.42)) : sq;
      const inner = sig.roc.inner > 0 ? circ(sig.roc.inner) : "";
      add(g, "path", { d: `${outer} ${inner}`, class: "zs-roc", "fill-rule": "evenodd" });
    }
    add(g, "path", { d: `M${cx - k * R} ${cy} H${cx + k * R} M${cx} ${cy - k * R} V${cy + k * R}`, class: "zs-axis" });
    add(g, "circle", { cx, cy, r: k, class: "zs-unit" });
    const w = (Number(s.omega) * Math.PI) / 180;
    const probe = [Math.cos(w), Math.sin(w)];
    const pp = at(probe);
    for (const q of sig.zeros) { const a = at(q); add(g, "path", { d: poly([a, pp]), class: "zs-vec zs-vec--zero" }); }
    for (const q of sig.poles) { const a = at(q); add(g, "path", { d: poly([a, pp]), class: "zs-vec zs-vec--pole" }); }
    drawMarkers(g, at, sig, 4);
    add(g, "circle", { cx: pp[0].toFixed(1), cy: pp[1].toFixed(1), r: 4, class: "zs-probe" });
    const off = sig.poles.concat(sig.zeros).filter((q) => Math.abs(q[0]) > R || Math.abs(q[1]) > R);
    if (off.length) text(g, x0 + wd / 2, y0 + ht - 6, `${off.length} point(s) beyond the edge, drawn at it`, "sim-label zs-hint");
  }

  function drawStems(sig, x0, y0, wd, ht) {
    const g = add(svg, "g", { class: `zs-panel${[0, 1].includes(stepIndex) ? " zs-focus" : ""}` });
    add(g, "rect", { x: x0, y: y0, width: wd, height: ht, class: "zs-frame" });
    text(g, x0 + wd / 2, y0 + 16, "samples x[n], n = −10 … 20");
    const ns = []; for (let n = -10; n <= 20; n++) ns.push(n);
    const xs = ns.map((n) => sig.x(n));
    const m = Math.max(1e-9, ...xs.map((v) => Math.abs(v)));
    const left = x0 + 14, right = x0 + wd - 14, mid = y0 + 40 + (ht - 62) / 2, half = (ht - 72) / 2;
    const X = (n) => left + ((n + 10) / 30) * (right - left);
    add(g, "path", { d: `M${left} ${mid} H${right}`, class: "zs-axis" });
    for (let i = 0; i < ns.length; i++) {
      const x = X(ns[i]), y = mid - (half * xs[i]) / m;
      if (xs[i] !== 0) add(g, "path", { d: `M${x.toFixed(1)} ${mid} V${y.toFixed(1)}`, class: "zs-stem" });
      add(g, "circle", { cx: x.toFixed(1), cy: y.toFixed(1), r: 2.5, class: "zs-stem-dot" });
    }
    for (const n of [-10, 0, 10, 20]) text(g, X(n), y0 + ht - 6, String(n));
    text(g, x0 + wd - 8, y0 + 32, `max |x| = ${fmt(m)}`, "sim-label zs-hint", "end");
  }

  function drawResponse(sig, s, x0, y0, wd, ht) {
    const g = add(svg, "g", { class: `zs-panel${[5, 6].includes(stepIndex) ? " zs-focus" : ""}` });
    add(g, "rect", { x: x0, y: y0, width: wd, height: ht, class: "zs-frame" });
    const mode = String(s.height);
    const hm = HEIGHT[mode] ?? HEIGHT.decibels;
    text(g, x0 + wd / 2, y0 + 16, mode === "decibels" ? "|X(e^jω)| in dB on the unit circle" : "|X(e^jω)| on the unit circle");
    const left = x0 + 34, right = x0 + wd - 18, topY = y0 + 30, botY = y0 + ht - 22;
    const X = (deg) => left + (deg / 180) * (right - left);
    const Y = (v) => botY - ((v - hm.lo) / (hm.hi - hm.lo)) * (botY - topY);
    add(g, "path", { d: `M${left} ${topY} V${botY} H${right}`, class: "zs-axis" });
    if (mode === "decibels") add(g, "path", { d: `M${left} ${Y(0).toFixed(1)} H${right}`, class: "zs-grid" });
    const pts = [];
    for (let d = 0; d <= 180; d++) {
      const t = (d * Math.PI) / 180;
      pts.push([X(d), Y(heightAt(sig, [Math.cos(t), Math.sin(t)], mode))]);
    }
    add(g, "path", { d: poly(pts), class: `zs-response${verdict(sig).stable ? "" : " zs-response--outside"}` });
    const om = Number(s.omega);
    const t = (om * Math.PI) / 180;
    const py = Y(heightAt(sig, [Math.cos(t), Math.sin(t)], mode));
    add(g, "path", { d: `M${X(om).toFixed(1)} ${botY} V${py.toFixed(1)}`, class: "zs-probe-line" });
    add(g, "circle", { cx: X(om).toFixed(1), cy: py.toFixed(1), r: 4, class: "zs-probe" });
    for (const d of [0, 90, 180]) text(g, X(d), botY + 14, `${d}°`);
    text(g, left - 4, topY + 4, mode === "decibels" ? "+30" : "10", "sim-label", "end");
    text(g, left - 4, botY, mode === "decibels" ? "−30" : "0", "sim-label", "end");
    if (!verdict(sig).stable) text(g, x0 + wd / 2, topY + 12, "unit circle not inside the ROC", "sim-label zs-hint");
  }

  function redraw() {
    if (destroyed) return;
    const s = panel.state;
    let sig;
    try { sig = zSignal(String(s.signal), Number(s.r), Number(s.theta)); } catch { sig = zSignal(SIGNALS[0]); }
    stage.clear();
    draw3d(sig, s);
    const pw = (W - 20) / 3;
    drawPlane(sig, s, 0, H3 + 10, pw, HP - 10);
    drawStems(sig, pw + 10, H3 + 10, pw, HP - 10);
    drawResponse(sig, s, 2 * pw + 20, H3 + 10, pw, HP - 10);

    const steps = walkSteps(sig, Number(s.omega), String(s.height));
    walk.textContent = stepIndex < 0
      ? "Press Next step ▶ to walk through this signal one idea at a time."
      : `Step ${stepIndex + 1} of ${steps.length}: ${steps[stepIndex].title}${/[?.!]$/.test(steps[stepIndex].title) ? "" : "."} ${steps[stepIndex].text}`;
    actions.buttons[0].disabled = stepIndex <= 0;
    actions.buttons[1].disabled = stepIndex >= steps.length - 1;

    const w = (Number(s.omega) * Math.PI) / 180;
    const z = C.polar(1, w);
    const m = magX(sig, z);
    const val = evalX(sig, z);
    const unused = ["r", "theta"].filter((k) => !sig.uses.includes(k));
    readout.textContent =
      `${sig.formula}; ROC: ${sig.rocText}. At ω = ${Number(s.omega)}°: X(e^(jω)) = ${Number.isFinite(val[0]) ? cfmt(val, 3) : "∞"}, |X| = ${fmt(m, 3)}` +
      `${m > 0 && Number.isFinite(m) ? ` (${fmt(20 * Math.log10(m), 1)} dB)` : ""}.` +
      (unused.length ? ` This signal ignores ${unused.map((k) => (k === "r" ? "r" : "θ")).join(" and ")}.` : "") +
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

registerWidget("z-surface", (ctx) => mountZSurface(ctx));
