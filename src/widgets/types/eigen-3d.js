// src/widgets/types/eigen-3d.js
//
// `eigen-3d` — a 3×3 matrix acting on space. The 3D view draws the unit
// sphere (a wire globe) and its image under A (an ellipsoid, or a flattened
// one when det A = 0), the real eigen-directions as dashed lines with arrows
// λv, a whole plane of eigenvectors as a shaded disc when an eigenvalue has a
// two-dimensional eigenspace, and for a complex pair the real plane that A
// turns (shaded in amber). A probe vector v and its image Av, and the
// directions of A^j v as numbered dots on the sphere. Below: the
// characteristic polynomial p(λ) = λ³ − (trace)λ² + (sum of 2×2 principal
// minors)λ − det, and the numbers.
//
// "Next step ▶" walks through eight steps. Drag the 3D view to turn it.
//
// Params keys, in order: matrix (select: MATRIX3_OPTIONS from
// ../sims/eigen.js), around (range, degrees, 0–360) and up (range, degrees,
// −90–90): the probe's direction; k (range, 0–10, powers shown); azimuth
// (range, degrees, −180–180), elevation (range, degrees, 5–85).
// Styled by the .zs-* and .eg-* classes in alexandria.css.

import { registerWidget } from "../registry.js";
import { buildFrame, buildControlPanel, buildActions, buildReadout, buildStage, svgEl } from "../sim-kit.js";
import { MATRICES3, MATRIX3_OPTIONS, preset3, eig3, apply, norm, unit, dir3, powers, circle3, charPoly3, lineAngle, dot, fmt, sfmt } from "../sims/eigen.js";
import { project3 } from "./z-surface.js";

export const DEFAULT_PARAMS = [
  { key: "matrix", label: "Matrix A", control: "select", options: MATRIX3_OPTIONS, default: MATRICES3[1].name },
  { key: "around", label: "v: direction around (degrees)", control: "range", min: 0, max: 360, step: 5, default: 30 },
  { key: "up", label: "v: direction up (degrees)", control: "range", min: -90, max: 90, step: 5, default: 25 },
  { key: "k", label: "Powers shown, k", control: "range", min: 0, max: 10, step: 1, default: 0 },
  { key: "azimuth", label: "Turn (degrees)", control: "range", min: -180, max: 180, step: 5, default: -35 },
  { key: "elevation", label: "Tilt (degrees)", control: "range", min: 5, max: 85, step: 5, default: 25 },
];

const W = 760, H3 = 430, HB = 210, HGT = H3 + HB + 10;

const vec = (v, d = 2) => `(${v.map((x) => fmt(x, d)).join(", ")})`;
const L = (x) => `λ = ${sfmt(x)}`;

export function currentMatrix(state) {
  try { return preset3(String(state.matrix)); } catch { return preset3(MATRICES3[1].name); }
}

/** The extent of the scene: the image's reach and the eigen-arrows, at least 1.3. */
export function sceneRadius(m, e) {
  let r = 1;
  for (const lat of [-60, -30, 0, 30, 60, 90]) for (let a = 0; a < 360; a += 15) r = Math.max(r, norm(apply(m, dir3(a, lat))));
  for (const l of e.values) r = Math.max(r, Math.abs(l));
  return Math.max(1.3, r * 1.1);
}

/** Short description of the eigen-structure. */
export function describeEigen3(e) {
  const parts = e.distinct.map((d) => {
    const mult = d.alg > 1 ? ` (${d.alg === 2 ? "double" : "triple"} root)` : "";
    const space = d.vectors.length === 1 ? `along ${vec(d.vectors[0])}` : d.vectors.length === 2 ? "a whole plane of eigenvectors" : "every vector";
    return `${L(d.value)}${mult}, ${space}`;
  });
  for (const c of e.complex) parts.push(`λ = ${sfmt(c.re)} ± ${sfmt(c.im)}j (|λ| = ${sfmt(c.modulus)}, angle ${sfmt(c.angleDeg, 1)}°), a plane that A turns`);
  return parts.join("; ");
}

export function walkSteps(m, around, up, k) {
  const e = eig3(m);
  const v = dir3(around, up), Av = apply(m, v);
  const [tr, mn, det] = e.coeffs;
  const nReal = e.distinct.reduce((s, d) => s + d.vectors.length, 0);
  const allVals = [...e.values.map(sfmt)];
  const sumText = e.complex.length
    ? `${sfmt(e.values[0])} + 2 × ${sfmt(e.complex[0].re)} = ${sfmt(tr)} = trace, and ${sfmt(e.values[0])} × ${sfmt(e.complex[0].modulus ** 2)} = ${sfmt(det)} = det`
    : `${allVals.join(" + ")} = ${sfmt(tr)} = trace, and ${allVals.join(" × ")} = ${sfmt(det)} = det`;
  let shape;
  if (e.symmetric) shape = `A is symmetric, so its eigenvalues are real and its eigenvectors are perpendicular: they are the axes of the ellipsoid, and the half-lengths of those axes are |λ| = ${e.values.map((x) => sfmt(Math.abs(x))).join(", ")}${e.values.some((x) => Math.abs(x) < 1e-9) ? " (a zero half-length means that axis is flattened away, so the image is flat)" : ""}.`;
  else if (e.complex.length) {
    const c = e.complex[0];
    shape = `Only one real direction survives, ${vec(e.distinct[0].vectors[0])} with ${L(e.values[0])}. The other two eigenvalues are complex, ${sfmt(c.re)} ± ${sfmt(c.im)}j: in the amber plane A turns vectors by about ${sfmt(c.angleDeg, 1)}° and scales them by about ${sfmt(c.modulus)} (exactly so when A is a rotation).`;
  } else if (e.defective) shape = `The eigenvalue ${sfmt(e.distinct.find((d) => d.vectors.length < d.alg).value)} is a repeated root with too few eigenvectors (${nReal} in all, not 3): A is defective and has no eigenbasis.`;
  else if (e.distinct.some((d) => d.vectors.length === 2)) shape = `The repeated eigenvalue ${sfmt(e.distinct.find((d) => d.vectors.length === 2).value)} has a whole plane of eigenvectors (shaded blue): every vector in it is left where it is, scaled by λ.`;
  else shape = `A is not symmetric, so its three eigen-directions need not be perpendicular: here the angles between them are ${sfmt(lineAngle(e.distinct[0].vectors[0], e.distinct[1].vectors[0]), 1)}°, ${sfmt(lineAngle(e.distinct[0].vectors[0], e.distinct[2].vectors[0]), 1)}° and ${sfmt(lineAngle(e.distinct[1].vectors[0], e.distinct[2].vectors[0]), 1)}°. They are not the axes of the ellipsoid.`;
  const pw = powers(m, v, Math.max(1, k));
  const last = pw[pw.length - 1];
  const mags = [...e.values.map(Math.abs), ...e.complex.map((c) => c.modulus)].sort((p, q) => q - p);
  const dominant = mags.length > 1 && mags[0] - mags[1] > 1e-9 && e.values.length && Math.abs(e.values[0]) === mags[0];
  const step7 = norm(last) < 1e-12
    ? "Repeated multiplication sends this v to zero."
    : dominant
      ? `Multiply by A again and again (the numbered dots on the sphere are the directions of v, Av, A²v, …). The component along the eigenvector with the largest |λ| = ${sfmt(mags[0])} grows fastest, so the direction swings onto that line: after ${pw.length - 1} steps it is ${sfmt(lineAngle(last, e.distinct[0].vectors[0]), 2)}° away.`
      : "Multiply by A again and again (the numbered dots): no single eigenvalue is largest in size here, so the direction does not settle onto one line.";
  return [
    { title: "The sphere and its image", text: "The wire globe is every unit vector. A sends it to the green surface: an ellipsoid, or a flat ellipse or segment if A squashes some direction to zero. The columns of A are where the x, y and z axes land." },
    { title: "Most vectors turn", text: `The probe v = ${vec(v)} goes to Av = ${vec(Av)}, which points ${sfmt(lineAngle(v, Av), 1)}° off v's line. Turn v with the two direction sliders, and the view with Turn and Tilt or by dragging.` },
    { title: "Directions that stay on their line", text: `The dashed lines are the eigen-directions: there Av = λv, and the thick arrow is λv. ${e.complex.length ? "A real 3×3 matrix always has at least one, because its characteristic polynomial is a cubic, and a cubic always crosses zero." : `This matrix has ${nReal === 3 ? "three independent ones" : nReal === 2 ? "only two independent ones" : "only one"}.`} Move v onto a dashed line and Av lands on the same line.` },
    { title: "The characteristic polynomial", text: `The eigenvalues are the roots of p(λ) = det(λI − A) = λ³ − ${sfmt(tr)}λ² + ${sfmt(mn)}λ − ${sfmt(det)}: the coefficients are the trace, the sum of the three 2×2 minors on the diagonal, and the determinant. The graph below shows it crossing zero at each real eigenvalue.` },
    { title: e.symmetric ? "Symmetric: perpendicular axes" : "The shape of the eigen-structure", text: shape },
    { title: "Trace and determinant", text: `The roots add up to the trace and multiply to the determinant: ${sumText}. The determinant is also how much A scales volume, so the green surface encloses |det A| = ${sfmt(Math.abs(det))} times the volume of the unit ball${Math.abs(det) < 1e-9 ? ": none at all, since A flattens space" : ""}.` },
    { title: "Powers of A", text: step7 },
    { title: "What the eigenvalues tell you", text: `Every λ says what A does along one direction. Size |λ| > 1 grows it, |λ| < 1 shrinks it, λ < 0 flips it, a complex pair turns a plane. Here: ${describeEigen3(e)}.` },
  ];
}

function mergeParams(params) {
  return Array.isArray(params) && params.length > 0 ? params : DEFAULT_PARAMS;
}

function mountEigen3d(ctx) {
  const spec = ctx.spec ?? {};
  const { doc, root } = buildFrame(ctx.container, spec);
  const params = mergeParams(spec.params);
  const panel = buildControlPanel(doc, root, params, () => schedule());
  let stepIndex = -1;
  const go = (i) => {
    stepIndex = i;
    if (i === 1) panel.update({ k: 0 });
    if (i === 6) panel.update({ around: 40, up: 35, k: 8 });
    redraw();
  };
  const actions = buildActions(doc, root, [
    { label: "◀ Back", secondary: true, onClick: () => go(Math.max(0, stepIndex - 1)) },
    { label: "Next step ▶", onClick: () => go(Math.min(7, stepIndex + 1)) },
  ]);
  const stage = buildStage(doc, root, W, HGT,
    "A 3 by 3 matrix acting on space: the unit sphere and its image, the eigen-directions with arrows lambda times v, a probe vector and its image, and below the characteristic polynomial and the numbers");
  const walk = doc.createElement("p");
  walk.className = "zs-walk";
  root.appendChild(walk);
  const readout = buildReadout(doc, root);
  const svg = stage.svg;
  let destroyed = false, pending = false, drag = null;

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
  const add = (parent, name, attrs) => { const el = svgEl(doc, name, attrs); parent.appendChild(el); return el; };
  const text = (parent, x, y, s, cls = "sim-label", anchor = "middle") => {
    const t = add(parent, "text", { x: x.toFixed(1), y: y.toFixed(1), class: cls, "text-anchor": anchor });
    t.textContent = s;
    return t;
  };
  const poly = (pts) => pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
  const arrowPath = (p, q, head = 8) => {
    const dx = q[0] - p[0], dy = q[1] - p[1], len = Math.hypot(dx, dy);
    if (len < 1) return "";
    const ux = dx / len, uy = dy / len, s = Math.min(head, len / 2);
    const a = [q[0] - s * ux + 0.5 * s * uy, q[1] - s * uy - 0.5 * s * ux];
    const b = [q[0] - s * ux - 0.5 * s * uy, q[1] - s * uy + 0.5 * s * ux];
    return `${poly([p, q])} M${a[0].toFixed(1)} ${a[1].toFixed(1)} L${q[0].toFixed(1)} ${q[1].toFixed(1)} L${b[0].toFixed(1)} ${b[1].toFixed(1)}`;
  };

  function draw3d(m, e, s) {
    const g = add(svg, "g", { class: `zs-panel${[0, 1, 2, 4, 6].includes(stepIndex) ? " zs-focus" : ""}` });
    add(g, "rect", { x: 0, y: 0, width: W, height: H3, class: "zs-frame" });
    const az = (Number(s.azimuth) * Math.PI) / 180, el = (Number(s.elevation) * Math.PI) / 180;
    const R = sceneRadius(m, e);
    const P = (v) => project3(v[0], v[1], v[2], az, el);
    const sc = (Math.min(W, H3) / 2 - 24) / R;
    const S = (v) => { const p = P(v); return [W / 2 + sc * p.u, H3 / 2 + 8 - sc * p.v]; };
    const depth = (v) => P(v).depth;
    // Axes.
    for (const [ax, name] of [[[1, 0, 0], "x"], [[0, 1, 0], "y"], [[0, 0, 1], "z"]]) {
      add(g, "path", { d: poly([S(ax.map((x) => -R * x)), S(ax.map((x) => R * x))]), class: "zs-axis" });
      const t = S(ax.map((x) => R * 1.04 * x));
      text(g, t[0], t[1], name, "sim-label zs-hint");
    }
    // Planes first (eigen-planes, turning planes).
    const disc = (e1, e2, r, cls) => add(g, "path", { d: `${poly(circle3(e1, e2, 48).map((p) => S(p.map((x) => r * x))))} Z`, class: cls });
    for (const d of e.distinct) if (d.vectors.length === 2) disc(d.vectors[0], d.vectors[1], Math.max(1.15, Math.abs(d.value) * 1.1), "eg-plane eg-plane--eigen");
    for (const c of e.complex) {
      const u = c.u, w = unit(c.w.map((x, i) => x - dot(c.w, u) * u[i]));
      disc(u, w, 1.15, "eg-plane");
    }
    // The unit sphere: latitude and longitude circles, back halves faint.
    const wires = [];
    for (const lat of [-60, -30, 0, 30, 60]) {
      const r = Math.cos((lat * Math.PI) / 180), z = Math.sin((lat * Math.PI) / 180);
      wires.push(Array.from({ length: 49 }, (_, i) => { const t = (2 * Math.PI * i) / 48; return [r * Math.cos(t), r * Math.sin(t), z]; }));
    }
    for (let lon = 0; lon < 180; lon += 30) {
      const a = (lon * Math.PI) / 180;
      wires.push(Array.from({ length: 49 }, (_, i) => { const t = (2 * Math.PI * i) / 48; return [Math.cos(t) * Math.cos(a), Math.cos(t) * Math.sin(a), Math.sin(t)]; }));
    }
    for (const wire of wires) {
      for (let i = 0; i + 1 < wire.length; i++) {
        const mid = wire[i].map((x, j) => (x + wire[i + 1][j]) / 2);
        add(g, "path", { d: poly([S(wire[i]), S(wire[i + 1])]), class: depth(mid) < 0 ? "eg-mesh eg-mesh--back" : "eg-mesh" });
      }
    }
    // Its image. A point A·s faces the viewer when the surface normal there,
    // cof(A)·s (the cofactor matrix, = det·A^(−T)), points towards the eye.
    const cof = [[m[1][1] * m[2][2] - m[1][2] * m[2][1], m[1][2] * m[2][0] - m[1][0] * m[2][2], m[1][0] * m[2][1] - m[1][1] * m[2][0]],
      [m[0][2] * m[2][1] - m[0][1] * m[2][2], m[0][0] * m[2][2] - m[0][2] * m[2][0], m[0][1] * m[2][0] - m[0][0] * m[2][1]],
      [m[0][1] * m[1][2] - m[0][2] * m[1][1], m[0][2] * m[1][0] - m[0][0] * m[1][2], m[0][0] * m[1][1] - m[0][1] * m[1][0]]];
    const detA = e.coeffs[2];
    // Depth is linear, so the depths of the three unit axes make the direction towards the eye.
    const towards = [0, 1, 2].map((i) => P([0, 1, 2].map((j) => (j === i ? 1 : 0))).depth);
    for (const wire of wires) {
      for (let i = 0; i + 1 < wire.length; i++) {
        const mid = wire[i].map((x, j) => (x + wire[i + 1][j]) / 2);
        let front = true;
        if (Math.abs(detA) > 1e-9) {
          const nrm = apply(cof, mid).map((x) => x * Math.sign(detA));
          front = dot(nrm, towards) >= 0;
        }
        add(g, "path", { d: poly([S(apply(m, wire[i])), S(apply(m, wire[i + 1]))]), class: front ? "eg-image" : "eg-image eg-image--back" });
      }
    }
    // Eigen-directions.
    let ci = 0;
    for (const d of e.distinct) {
      for (const u of d.vectors.length === 3 ? [] : d.vectors) {
        const cls = `eg-e${Math.min(ci, 2)}`;
        add(g, "path", { d: poly([S(u.map((x) => -R * x)), S(u.map((x) => R * x))]), class: `eg-eigline ${cls}` });
        if (Math.abs(d.value) > 1e-9) add(g, "path", { d: arrowPath(S([0, 0, 0]), S(u.map((x) => d.value * x)), 9), class: `eg-eigvec ${cls}` });
        const tip = S(u.map((x) => R * 0.95 * x));
        text(g, tip[0] + 6, tip[1] - 6, L(d.value), `sim-label eg-lab ${cls}`, "start");
      }
      ci++;
    }
    // Powers on the sphere.
    const v = dir3(Number(s.around), Number(s.up));
    const k = Math.round(Number(s.k));
    if (k > 0) {
      powers(m, v, k).forEach((w, j) => {
        if (norm(w) < 1e-12) return;
        const q = S(unit(w));
        add(g, "circle", { cx: q[0].toFixed(1), cy: q[1].toFixed(1), r: j === k ? 5 : 3.5, class: `eg-pow${j === k ? " eg-pow--last" : ""}` });
        text(g, q[0] + 6, q[1] + 4, String(j), "sim-label zs-hint", "start");
      });
    }
    const Av = apply(m, v);
    add(g, "path", { d: arrowPath(S([0, 0, 0]), S(v), 8), class: "eg-v" });
    add(g, "path", { d: arrowPath(S([0, 0, 0]), S(Av), 9), class: "eg-av" });
    const tv = S(v), ta = S(Av);
    text(g, tv[0] + 5, tv[1] - 5, "v", "sim-label eg-v-text", "start");
    text(g, ta[0] + 5, ta[1] - 5, "Av", "sim-label eg-av-text", "start");
    text(g, 12, 20, "grey globe: unit sphere · green: its image under A · dashed: eigen-directions, arrows λv", "sim-label", "start");
    if (e.complex.length) text(g, 12, 38, "amber disc: the real plane that A turns (complex pair)", "sim-label", "start");
    else if (e.distinct.some((d) => d.vectors.length === 2)) text(g, 12, 38, "blue disc: a whole plane of eigenvectors", "sim-label", "start");
    text(g, W - 12, H3 - 12, "drag to turn", "sim-label zs-hint", "end");
  }

  function drawBottom(m, e) {
    const y0 = H3 + 10, pw = (W - 10) / 2;
    // Characteristic polynomial.
    const roots = [...e.values, ...e.complex.map((c) => c.re)];
    let x0 = Math.min(...roots) - 1, x1 = Math.max(...roots) + 1;
    if (x1 - x0 < 4) { const c = (x0 + x1) / 2; x0 = c - 2; x1 = c + 2; }
    const ls = Array.from({ length: 161 }, (_, i) => x0 + ((x1 - x0) * i) / 160);
    const vs = ls.map((l) => charPoly3(m, l));
    // Scale to the wiggle between the roots (at least ±1), so the crossings show.
    const r0 = Math.min(...roots), r1 = Math.max(...roots);
    let span = 1;
    ls.forEach((l, i) => { if (l >= r0 - 0.3 && l <= r1 + 0.3) span = Math.max(span, Math.abs(vs[i])); });
    span *= 2.5;
    let lo = Math.max(Math.min(...vs), -span), hi = Math.min(Math.max(...vs), span);
    const g = add(svg, "g", { class: `zs-panel${[3, 5].includes(stepIndex) ? " zs-focus" : ""}` });
    add(g, "rect", { x: 0, y: y0, width: pw, height: HB, class: "zs-frame" });
    text(g, pw / 2, y0 + 16, "p(λ) = det(λI − A)");
    const left = 14, right = pw - 10, topY = y0 + 26, botY = y0 + HB - 24;
    const pad = 0.08 * (hi - lo || 1);
    const X = (u) => left + ((u - x0) / (x1 - x0)) * (right - left);
    const Y = (v) => botY - ((Math.max(lo - pad, Math.min(hi + pad, v)) - (lo - pad)) / (hi - lo + 2 * pad || 1)) * (botY - topY);
    add(g, "path", { d: `M${left} ${Y(0).toFixed(1)} H${right}`, class: "zs-axis" });
    for (let t = Math.ceil(x0); t <= Math.floor(x1); t++) {
      add(g, "path", { d: `M${X(t).toFixed(1)} ${Y(0).toFixed(1)} v3`, class: "zs-axis" });
      text(g, X(t), botY + 14, String(t).replace("-", "−"), "sim-label zs-hint");
    }
    let dpath = "", pen = false;
    ls.forEach((l, i) => {
      const inside = vs[i] >= lo - pad && vs[i] <= hi + pad;
      if (inside) dpath += `${pen ? "L" : "M"}${X(l).toFixed(1)} ${Y(vs[i]).toFixed(1)} `;
      pen = inside;
    });
    add(g, "path", { d: dpath.trim(), class: "eg-poly" });
    e.distinct.forEach((d, i) => {
      add(g, "circle", { cx: X(d.value).toFixed(1), cy: Y(0).toFixed(1), r: 4, class: `eg-dot eg-e${Math.min(i, 2)}` });
      text(g, X(d.value), Y(0) - 8 - 12 * (i % 2), sfmt(d.value), `sim-label eg-lab eg-e${Math.min(i, 2)}`);
    });
    const [tr, mn, det] = e.coeffs;
    text(g, left + 2, topY + 10, `λ³ − ${sfmt(tr)}λ² + ${sfmt(mn)}λ − ${sfmt(det)}`.replace("+ −", "− ").replace("− −", "+ "), "sim-label", "start");
    // Numbers.
    const g2 = add(svg, "g", { class: `zs-panel${stepIndex === 7 ? " zs-focus" : ""}` });
    const xa = pw + 10;
    add(g2, "rect", { x: xa, y: y0, width: pw, height: HB, class: "zs-frame" });
    text(g2, xa + pw / 2, y0 + 16, "the numbers");
    const lines = [`A = [${m.map((r) => `[${r.map((x) => sfmt(x)).join(", ")}]`).join(", ")}]`,
      `trace ${sfmt(tr)} · minors ${sfmt(mn)} · det ${sfmt(det)}`];
    for (const d of e.distinct) {
      const mult = d.alg > 1 ? ` ×${d.alg}` : "";
      lines.push(`${L(d.value)}${mult}: ${d.vectors.length === 1 ? vec(d.vectors[0]) : d.vectors.length === 2 ? "a plane of eigenvectors" : "every vector"}${d.vectors.length < d.alg ? " (too few: defective)" : ""}`);
    }
    for (const c of e.complex) lines.push(`λ = ${sfmt(c.re)} ± ${sfmt(c.im)}j: |λ| = ${sfmt(c.modulus)}, angle ${sfmt(c.angleDeg, 1)}°`);
    lines.push(e.symmetric ? "symmetric: real λs, perpendicular eigenvectors" : "not symmetric");
    lines.forEach((ln, i) => text(g2, xa + 12, y0 + 40 + 22 * i, ln, "sim-label", "start"));
  }

  function redraw() {
    if (destroyed) return;
    const s = panel.state;
    const m = currentMatrix(s);
    const e = eig3(m);
    stage.clear();
    draw3d(m, e, s);
    drawBottom(m, e);
    const steps = walkSteps(m, Number(s.around), Number(s.up), Math.round(Number(s.k)));
    walk.textContent = stepIndex < 0
      ? "Press Next step ▶ to walk through what the matrix does to space, one idea at a time."
      : `Step ${stepIndex + 1} of ${steps.length}: ${steps[stepIndex].title}. ${steps[stepIndex].text}`;
    actions.buttons[0].disabled = stepIndex <= 0;
    actions.buttons[1].disabled = stepIndex >= steps.length - 1;
    const v = dir3(Number(s.around), Number(s.up)), Av = apply(m, v);
    const k = Math.round(Number(s.k));
    let pw = "";
    if (k > 0) { const w = powers(m, v, k)[k]; pw = ` A^${k}v = ${vec(w)}, length ${sfmt(norm(w))}.`; }
    readout.textContent = `${describeEigen3(e)}. v = ${vec(v)}: Av = ${vec(Av)}, length ${sfmt(norm(Av))}, ${sfmt(lineAngle(v, Av), 1)}° off v's line.${pw}`;
  }

  redraw();
  return {
    update(partial) { if (panel.update(partial)) redraw(); },
    destroy() {
      destroyed = true;
      panel.destroy();
      actions.destroy();
      svg.removeEventListener("pointerdown", onDown);
      svg.removeEventListener("pointermove", onMove);
      svg.removeEventListener("pointerup", onUp);
      svg.removeEventListener("pointercancel", onUp);
    },
  };
}

registerWidget("eigen-3d", (ctx) => mountEigen3d(ctx));
