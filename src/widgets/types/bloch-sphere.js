// src/widgets/types/bloch-sphere.js
//
// `bloch-sphere` — a qubit state on the Bloch sphere, and what a rotation does
// to it. The reader sets the polar and azimuthal angles (θ, φ) of a starting
// state, picks a rotation axis (X, Y, Z or none) and an angle, and sees the
// starting vector, the rotated vector and the arc it sweeps, with the
// amplitudes, outcome probabilities and Bloch coordinates in the readout.
//
// Params keys, in order: theta (deg, 0–180), phi (deg, 0–360), axis (select:
// "none", "X", "Y", "Z"), angle (deg, 0–360). No config.
// Styled by the .qm-* classes in alexandria.css; the maths is in
// ../sims/quantum.js (blochState, blochVector, rotation, apply1).

import { registerWidget } from "../registry.js";
import { buildFrame, buildControlPanel, buildReadout, buildStage, svgEl } from "../sim-kit.js";
import { blochState, blochVector, rotation, apply1 } from "../sims/quantum.js";

const DEFAULT_PARAMS = [
  { key: "theta", label: "Polar angle θ (degrees)", control: "range", min: 0, max: 180, step: 1, default: 60 },
  { key: "phi", label: "Azimuthal angle φ (degrees)", control: "range", min: 0, max: 360, step: 1, default: 0 },
  { key: "axis", label: "Rotate about", control: "select", options: ["none", "X", "Y", "Z"], default: "none" },
  { key: "angle", label: "Rotation angle (degrees)", control: "range", min: 0, max: 360, step: 5, default: 90 },
];

const W = 560, HGT = 400, CX = 200, CY = 205, R = 150;
const AZ = (-35 * Math.PI) / 180; // camera azimuth
const EL = (18 * Math.PI) / 180; // camera elevation

/** Project a point on (or inside) the unit sphere to screen coordinates; depth > 0 faces the viewer. */
export function project([x, y, z]) {
  const xr = x * Math.cos(AZ) - y * Math.sin(AZ);
  const yr = x * Math.sin(AZ) + y * Math.cos(AZ);
  return {
    sx: CX + R * yr,
    sy: CY - R * (z * Math.cos(EL) - xr * Math.sin(EL)),
    depth: xr * Math.cos(EL) + z * Math.sin(EL),
  };
}

/** The rotated state and the arc of Bloch vectors swept on the way. */
export function rotateState(thetaDeg, phiDeg, axis, angleDeg, steps = 48) {
  const v0 = blochState((thetaDeg * Math.PI) / 180, (phiDeg * Math.PI) / 180);
  if (axis === "none") return { v0, v1: v0, arc: [] };
  const arc = [];
  for (let k = 0; k <= steps; k++) {
    arc.push(blochVector(apply1(rotation(axis, ((angleDeg * Math.PI) / 180) * (k / steps)), v0)));
  }
  return { v0, v1: apply1(rotation(axis, (angleDeg * Math.PI) / 180), v0), arc };
}

function mergeParams(params) {
  return Array.isArray(params) && params.length > 0 ? params : DEFAULT_PARAMS;
}

const fmt = (x) => (Math.abs(x) < 5e-4 ? "0.000" : x.toFixed(3));
const cfmt = (re, im) => {
  const r = Math.abs(re) < 5e-4 ? 0 : re, i = Math.abs(im) < 5e-4 ? 0 : im;
  if (i === 0) return r.toFixed(3);
  if (r === 0) return `${i.toFixed(3)}i`;
  return `${r.toFixed(3)} ${i < 0 ? "−" : "+"} ${Math.abs(i).toFixed(3)}i`;
};

function mountBloch(ctx) {
  const spec = ctx.spec ?? {};
  const { doc, root } = buildFrame(ctx.container, spec);
  const panel = buildControlPanel(doc, root, mergeParams(spec.params), () => redraw());
  const stage = buildStage(doc, root, W, HGT, "Bloch sphere showing the starting state, the rotated state and the arc between them");
  const readout = buildReadout(doc, root);
  let destroyed = false;

  function path(points, cls) {
    if (points.length < 2) return;
    const d = points.map((p, i) => `${i ? "L" : "M"}${p.sx.toFixed(1)} ${p.sy.toFixed(1)}`).join(" ");
    stage.svg.appendChild(svgEl(doc, "path", { d, class: cls }));
  }

  function circle3d(f, cls) {
    // Draw the near half solid and the far half dashed.
    const front = [], back = [];
    for (let k = 0; k <= 96; k++) {
      const p = project(f((2 * Math.PI * k) / 96));
      (p.depth >= 0 ? front : back).push(p);
      if (p.depth >= 0 && back.length) { path(back, `${cls} qm-hidden`); back.length = 0; }
      if (p.depth < 0 && front.length) { path(front, cls); front.length = 0; }
    }
    path(front, cls); path(back, `${cls} qm-hidden`);
  }

  function label(p, text, dx, dy) {
    const t = svgEl(doc, "text", { x: (p.sx + dx).toFixed(1), y: (p.sy + dy).toFixed(1), class: "sim-label", "text-anchor": "middle" });
    t.textContent = text;
    stage.svg.appendChild(t);
  }

  function arrow(r, cls) {
    const o = project([0, 0, 0]), p = project(r);
    stage.svg.appendChild(svgEl(doc, "line", { x1: o.sx, y1: o.sy, x2: p.sx.toFixed(1), y2: p.sy.toFixed(1), class: cls }));
    stage.svg.appendChild(svgEl(doc, "circle", { cx: p.sx.toFixed(1), cy: p.sy.toFixed(1), r: 6, class: `${cls} qm-tip` }));
  }

  function redraw() {
    if (destroyed) return;
    const s = panel.state;
    const { v0, v1, arc } = rotateState(Number(s.theta), Number(s.phi), String(s.axis), Number(s.angle));
    stage.clear();
    const o = project([0, 0, 0]);
    stage.svg.appendChild(svgEl(doc, "circle", { cx: o.sx, cy: o.sy, r: R, class: "qm-sphere" }));
    circle3d((t) => [Math.cos(t), Math.sin(t), 0], "qm-ring");
    circle3d((t) => [Math.sin(t), 0, Math.cos(t)], "qm-ring");
    for (const [a, b, name, dx, dy] of [
      [[0, 0, 1], [0, 0, -1], ["|0⟩", "|1⟩"], 0, [-10, 22]],
      [[1, 0, 0], [-1, 0, 0], ["|+⟩", "|−⟩"], 0, [18, -8]],
      [[0, 1, 0], [0, -1, 0], ["|+i⟩", "|−i⟩"], 0, [-10, -10]],
    ]) {
      const pa = project(a.map((c) => c * 1.12)), pb = project(b.map((c) => c * 1.12));
      stage.svg.appendChild(svgEl(doc, "line", { x1: pb.sx.toFixed(1), y1: pb.sy.toFixed(1), x2: pa.sx.toFixed(1), y2: pa.sy.toFixed(1), class: "qm-axis" }));
      label(project(a.map((c) => c * 1.2)), name[0], dx, dy[0] < 0 ? -2 : 6);
      label(project(b.map((c) => c * 1.2)), name[1], dx, dy[1] > 0 ? 14 : 6);
    }
    if (arc.length) path(arc.map(project), "qm-trail");
    const r0 = blochVector(v0), r1 = blochVector(v1);
    arrow(r0, "qm-vector qm-vector--start");
    if (String(s.axis) !== "none") arrow(r1, "qm-vector qm-vector--end");

    // Side panel: probabilities as bars for the final state.
    const fin = String(s.axis) !== "none" ? v1 : v0;
    const p0 = fin[0] ** 2 + fin[1] ** 2, p1 = 1 - p0;
    const bx = 400, by = 80, bh = 220;
    const title = svgEl(doc, "text", { x: bx + 60, y: by - 30, class: "sim-label", "text-anchor": "middle" });
    title.textContent = String(s.axis) !== "none" ? "after the rotation" : "measurement in Z";
    stage.svg.appendChild(title);
    [[p0, "P(0)"], [p1, "P(1)"]].forEach(([p, name], i) => {
      const x = bx + 15 + i * 70;
      stage.svg.appendChild(svgEl(doc, "rect", { x, y: by, width: 40, height: bh, class: "sim-cell" }));
      stage.svg.appendChild(svgEl(doc, "rect", { x, y: (by + bh * (1 - p)).toFixed(1), width: 40, height: (bh * p).toFixed(1), class: "sim-bar" }));
      label({ sx: x + 20, sy: by + bh }, name, 0, 18);
      label({ sx: x + 20, sy: by + bh * (1 - p) }, p.toFixed(2), 0, -6);
    });

    const line = (name, v, r) =>
      `${name}: α = ${cfmt(v[0], v[1])}, β = ${cfmt(v[2], v[3])}; P(0) = ${fmt(v[0] ** 2 + v[1] ** 2)}; Bloch (⟨X⟩, ⟨Y⟩, ⟨Z⟩) = (${fmt(r[0])}, ${fmt(r[1])}, ${fmt(r[2])})`;
    readout.textContent =
      String(s.axis) === "none"
        ? line("State", v0, r0)
        : `${line("Start", v0, r0)}. ${line(`After R${s.axis}(${Number(s.angle)}°)`, v1, r1)}.`;
  }

  redraw();
  return {
    update(partial) { if (panel.update(partial)) redraw(); },
    destroy() { destroyed = true; panel.destroy(); },
  };
}

registerWidget("bloch-sphere", (ctx) => mountBloch(ctx));
