// src/widgets/types/eigen-plane.js
//
// `eigen-plane` — what a 2×2 matrix does to the plane, and the directions it
// keeps. Three panels:
//
//   - the plane: the unit circle and its image (an ellipse), the columns
//     A e₁ and A e₂ with the image of the unit square, a probe vector v at a
//     chosen angle with its image Av, the eigen-directions as lines through
//     the origin labelled with their λ, and (when k > 0) the directions of
//     v, Av, A²v … A^k v as numbered dots on the unit circle;
//   - the sweep: as v turns from 0° to 180°, its image's part along v
//     (v·Av) and sideways (v × Av). The sideways part is zero exactly at an
//     eigen-direction, and there the along part is the eigenvalue;
//   - the characteristic polynomial p(λ) = λ² − (trace)λ + det, whose roots
//     are the eigenvalues.
//
// "Next step ▶" walks through eight steps; "Sweep v" turns the probe.
//
// Params keys, in order: matrix (select: MATRIX2_OPTIONS from
// ../sims/eigen.js; the last option uses the sliders), a, b, c, d (range,
// −5–5, the entries [[a, b], [c, d]]), theta (range, degrees, 0–360, the
// probe's direction), k (range, 0–10, powers shown). Choosing a preset sets
// the sliders; moving a slider switches the select to the custom option.
// Styled by the .zs-* and .eg-* classes in alexandria.css.

import { registerWidget } from "../registry.js";
import { buildFrame, buildControlPanel, buildActions, buildReadout, buildStage, svgEl, makeTicker } from "../sim-kit.js";
import { MATRICES2, MATRIX2_OPTIONS, CUSTOM2, preset2, eig2, probe2, angleOf, powers, apply, norm, unit, charPoly2, lineAngle, fmt, sfmt } from "../sims/eigen.js";

export const DEFAULT_PARAMS = [
  { key: "matrix", label: "Matrix A", control: "select", options: MATRIX2_OPTIONS, default: MATRICES2[1].name },
  { key: "a", label: "a (top left)", control: "range", min: -5, max: 5, step: 0.05, default: 2 },
  { key: "b", label: "b (top right)", control: "range", min: -5, max: 5, step: 0.05, default: 1 },
  { key: "c", label: "c (bottom left)", control: "range", min: -5, max: 5, step: 0.05, default: 1 },
  { key: "d", label: "d (bottom right)", control: "range", min: -5, max: 5, step: 0.05, default: 2 },
  { key: "theta", label: "Direction of v (degrees)", control: "range", min: 0, max: 360, step: 1, default: 20 },
  { key: "k", label: "Powers shown, k", control: "range", min: 0, max: 10, step: 1, default: 0 },
];

const W = 760, HGT = 450;
const PW = 440; // the plane panel is PW × HGT
const RX = PW + 10, RW = W - RX, RH = (HGT - 10) / 2;

/** The matrix the widget uses: the preset's exact entries, or the sliders. */
export function currentMatrix(state) {
  if (String(state.matrix) !== CUSTOM2) {
    try { return preset2(String(state.matrix)); } catch { /* fall through */ }
  }
  return [[Number(state.a), Number(state.b)], [Number(state.c), Number(state.d)]];
}

/** Half-width of the plane view, in units: room for the ellipse and the eigenvalue arrows. */
export function viewRadius(m) {
  const e = eig2(m);
  let r = 1;
  for (let i = 0; i < 64; i++) r = Math.max(r, norm(apply(m, [Math.cos((i * Math.PI) / 32), Math.sin((i * Math.PI) / 32)])));
  for (const l of e.values) r = Math.max(r, Math.abs(l));
  return Math.min(6, Math.max(1.6, 1.15 * r));
}

/** Angle (degrees, 0–180) of each eigen-direction, or [] when there is none (complex) or every direction (scalar). */
export function eigenAngles(e) {
  if (e.kind === "real" || e.kind === "repeated") return e.vectors.map(angleOf);
  return [];
}

const L = (x) => `λ = ${sfmt(x)}`;
const vec = (v, d = 2) => `(${fmt(v[0], d)}, ${fmt(v[1], d)})`;

/** One sentence on the eigenvalues, for the readout and the steps. */
export function describeEigen(e) {
  switch (e.kind) {
    case "real":
      return `two eigenvalues, λ₁ = ${sfmt(e.values[0])} along ${vec(e.vectors[0])} and λ₂ = ${sfmt(e.values[1])} along ${vec(e.vectors[1])}`;
    case "repeated":
      return `one repeated eigenvalue λ = ${sfmt(e.values[0])}, but only one eigen-direction, ${vec(e.vectors[0])}: the matrix is defective`;
    case "scalar":
      return `one repeated eigenvalue λ = ${sfmt(e.values[0])}, and every vector is an eigenvector: A is ${sfmt(e.values[0])} times the identity`;
    default:
      return `no real eigenvalues: λ = ${sfmt(e.re)} ± ${sfmt(e.im)}j, size |λ| = ${sfmt(e.modulus)} and angle ${sfmt(e.angleDeg, 1)}°, so A turns every vector`;
  }
}

/** The eight walk-through steps for matrix m, probe angle theta and k powers. */
export function walkSteps(m, theta, k) {
  const e = eig2(m);
  const p = probe2(m, theta);
  const cols = `A e₁ = ${vec([m[0][0], m[1][0]])} and A e₂ = ${vec([m[0][1], m[1][1]])}`;
  const angles = eigenAngles(e);
  const step4 = e.kind === "complex"
    ? `This matrix has no direction that stays put: the sideways curve never touches zero, because A turns every vector by some angle. Its eigenvalues are complex, ${sfmt(e.re)} ± ${sfmt(e.im)}j. The angle of λ, ${sfmt(e.angleDeg, 1)}°, is how far A turns things on average, and |λ| = ${sfmt(e.modulus)} is how much it grows them.`
    : e.kind === "scalar"
      ? `Here every direction stays put: A = ${sfmt(e.values[0])}·I stretches every vector by ${sfmt(e.values[0])}, so the sideways curve is zero everywhere and every v is an eigenvector.`
      : `v now points along the first eigen-direction, ${sfmt(angles[0], 1)}°. Av lies on the same line: Av = λ₁v with λ₁ = ${sfmt(e.values[0])}${e.values[0] < 0 ? " (negative, so Av points the opposite way)" : ""}. In the sweep panel the sideways part is zero here and the along part is ${sfmt(e.values[0])}.`;
  const step5 = e.kind === "real"
    ? `The second eigen-direction is at ${sfmt(angles[1], 1)}°, with λ₂ = ${sfmt(e.values[1])}${e.values[1] === 0 ? ": A squashes this direction to the origin" : ""}. A 2×2 matrix has at most two eigen-directions (unless it is a multiple of I). ${Math.abs(lineAngle(e.vectors[0], e.vectors[1]) - 90) < 1e-6 ? "These two are perpendicular, as they always are for a symmetric matrix." : `These two are ${sfmt(lineAngle(e.vectors[0], e.vectors[1]), 1)}° apart, not perpendicular: A is not symmetric.`}`
    : e.kind === "repeated"
      ? `There is no second eigen-direction. The sideways curve only touches zero once (at ${sfmt(angles[0], 1)}°) without crossing, so λ = ${sfmt(e.values[0])} is a double root of the polynomial with a single direction. A shear is the classic case.`
      : e.kind === "scalar"
        ? "Pick any direction with the slider: Av always lies along v."
        : "With no real eigen-direction, the ellipse is still the image of the circle, but no arrow lands on its own line.";
  const trDet = e.kind === "complex"
    ? `sum ${sfmt(e.re)} + ${sfmt(e.re)} = ${sfmt(e.tr)} = trace, product |λ|² = ${sfmt(e.modulus * e.modulus)} = det`
    : `sum ${sfmt(e.values[0])} + ${sfmt(e.values[1])} = ${sfmt(e.tr)} = trace, product ${sfmt(e.values[0])} × ${sfmt(e.values[1])} = ${sfmt(e.det)} = det`;
  const pw = powers(m, p.v, Math.max(k, 1));
  const last = pw[pw.length - 1];
  let step7;
  if (e.kind === "real" && Math.abs(Math.abs(e.values[0]) - Math.abs(e.values[1])) > 1e-9) {
    step7 = norm(last) < 1e-12
      ? "Repeated multiplication sends this v to zero."
      : `Apply A again and again: v, Av, A²v, … (the numbered dots show their directions). Each time, the part along the first eigenvector is multiplied by λ₁ = ${sfmt(e.values[0])} and the part along the second by λ₂ = ${sfmt(e.values[1])}. The bigger |λ| wins, so the direction swings onto the λ₁ line: after ${pw.length - 1} steps it is ${sfmt(lineAngle(last, e.vectors[0]), 2)}° away. This is power iteration.`;
  } else if (e.kind === "complex") {
    step7 = `Apply A again and again: each step turns the vector by about ${sfmt(e.angleDeg, 1)}° and scales its size by about ${sfmt(e.modulus)}, so the dots go round and never settle on a line${e.modulus < 1 ? "; the vectors spiral in to zero" : e.modulus > 1 ? "; the vectors spiral outwards" : ""}.`;
  } else {
    step7 = "Apply A again and again: with two eigenvalues of the same size, neither direction wins, so the dots do not settle onto one line (or, for a repeated λ, they creep towards it only slowly).";
  }
  return [
    { title: "A matrix moves every vector", text: `A sends e₁ = (1, 0) to its first column and e₂ = (0, 1) to its second: ${cols}. The unit square becomes the shaded parallelogram, and the dashed unit circle becomes the solid ellipse. Every other vector goes where its coordinates say: A(x, y) = x·Ae₁ + y·Ae₂.` },
    { title: "Most vectors turn", text: `The probe v at ${sfmt(theta, 0)}° goes to Av = ${vec(p.Av)}. Av has length ${sfmt(p.stretch)} and points ${sfmt(Math.abs(p.turnDeg), 1)}° ${p.turnDeg >= 0 ? "anticlockwise" : "clockwise"} from v. In general a matrix both stretches and turns a vector.` },
    { title: "Look for directions that do not turn", text: "Split Av into a part along v (v·Av) and a part sideways (v × Av). The top-right panel plots both as v turns from 0° to 180° (after that the pattern repeats with signs flipped). Where the sideways part crosses zero, Av lies on v's own line: that direction is an eigenvector. Press Sweep v to turn the probe." },
    { title: e.kind === "complex" ? "No direction stays put" : "The first eigenvector", text: step4 },
    { title: e.kind === "real" ? "The second eigenvector" : "Only one line, or every line", text: step5 },
    { title: "The characteristic polynomial", text: `Av = λv means (A − λI)v = 0 for some v ≠ 0, which happens exactly when det(A − λI) = 0. For a 2×2 matrix that is λ² − (a + d)λ + (ad − bc) = λ² − ${sfmt(e.tr)}λ + ${sfmt(e.det)} = 0, drawn bottom right. ${e.kind === "complex" ? "This parabola never crosses zero, so the roots are complex." : `It crosses zero at the eigenvalues${e.kind === "real" ? "" : " (here it only touches, at a double root)"}.`} The roots always satisfy: ${trDet}.` },
    { title: "Powers of A", text: step7 },
    { title: "In the eigenbasis A only stretches", text: e.kind === "real"
      ? `Measure vectors in the eigenvectors instead of e₁ and e₂ and A does nothing but stretch: by ${sfmt(e.values[0])} along one line and by ${sfmt(e.values[1])} along the other. The light parallelogram on v₁ and v₂ maps to the green one on λ₁v₁ and λ₂v₂. That is diagonalisation, A = PDP⁻¹, and it is why A^k is easy: just raise the λs to the k-th power.`
      : e.kind === "complex"
        ? `There is no real eigenbasis, but there is a real one in which A is "turn by ${sfmt(e.angleDeg, 1)}° and scale by ${sfmt(e.modulus)}" (in suitably stretched axes).`
        : e.kind === "scalar" ? "Any basis is an eigenbasis: A is already diagonal in every one." : "A defective matrix has no eigenbasis: one direction is not enough to describe the plane, so A cannot be made diagonal. The best one can do is the Jordan form, λ on the diagonal with a 1 above it." },
  ];
}

function mergeParams(params) {
  return Array.isArray(params) && params.length > 0 ? params : DEFAULT_PARAMS;
}

function mountEigenPlane(ctx, uid) {
  const spec = ctx.spec ?? {};
  const { doc, root } = buildFrame(ctx.container, spec);
  const params = mergeParams(spec.params);
  const panel = buildControlPanel(doc, root, params, (state, key) => {
    if (key === "matrix" && String(state.matrix) !== CUSTOM2) syncSliders();
    else if (["a", "b", "c", "d"].includes(key) && String(state.matrix) !== CUSTOM2) panel.update({ matrix: CUSTOM2 });
    schedule();
  });
  function syncSliders() {
    try {
      const m = preset2(String(panel.state.matrix));
      panel.update({ a: m[0][0], b: m[0][1], c: m[1][0], d: m[1][1] });
    } catch { /* custom */ }
  }
  syncSliders();
  let stepIndex = -1;
  const ticker = makeTicker(() => {
    panel.update({ theta: (Math.round(Number(panel.state.theta)) + 2) % 360 });
    schedule();
  }, 60);
  const go = (i) => {
    stepIndex = i;
    const m = currentMatrix(panel.state);
    const e = eig2(m);
    const ang = eigenAngles(e);
    if (i === 1 || i === 2) {
      panel.update({ k: 0 });
      // Show a vector that really turns: move v off an eigen-line if it sits on one.
      if (i === 1 && (Math.abs(probe2(m, Number(panel.state.theta)).turnDeg) < 3 || Math.abs(probe2(m, Number(panel.state.theta)).turnDeg) > 177) && e.kind !== "scalar") {
        panel.update({ theta: Math.round(((ang.length ? ang[0] : 0) + 35) % 180) });
      }
    }
    if (i === 3 && ang.length) panel.update({ theta: Math.round(ang[0]), k: 0 });
    if (i === 4 && ang.length > 1) panel.update({ theta: Math.round(ang[1]), k: 0 });
    if (i === 6) {
      const base = ang.length ? ang[0] : 0;
      panel.update({ theta: Math.round((base + 70) % 180), k: 8 });
    }
    redraw();
  };
  const actions = buildActions(doc, root, [
    { label: "◀ Back", secondary: true, onClick: () => go(Math.max(0, stepIndex - 1)) },
    { label: "Next step ▶", onClick: () => go(Math.min(7, stepIndex + 1)) },
    {
      label: "Sweep v", secondary: true,
      onClick: () => {
        const on = ticker.toggle();
        actions.buttons[2].setAttribute("aria-pressed", on ? "true" : "false");
      },
    },
  ]);
  const stage = buildStage(doc, root, W, HGT,
    "A 2 by 2 matrix acting on the plane: the unit circle and its image ellipse, a probe vector v and its image Av, the eigen-directions, and two graphs: the parts of Av along and across v as v turns, and the characteristic polynomial");
  const walk = doc.createElement("p");
  walk.className = "zs-walk";
  root.appendChild(walk);
  const readout = buildReadout(doc, root);
  const svg = stage.svg;
  let destroyed = false;
  let pending = false;

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

  function drawPlane(m, e, s) {
    const R = viewRadius(m);
    const g = add(svg, "g", { class: `zs-panel${[0, 1, 3, 4, 6, 7].includes(stepIndex) ? " zs-focus" : ""}` });
    add(g, "rect", { x: 0, y: 0, width: PW, height: HGT, class: "zs-frame" });
    const cx = PW / 2, cy = HGT / 2, sc = (Math.min(PW, HGT) / 2 - 14) / R;
    const S = (v) => [cx + sc * v[0], cy - sc * v[1]];
    // Clip a long line through the origin in direction u to the view.
    const lineThrough = (u) => { const r = R * 1.5; return [S([-r * u[0], -r * u[1]]), S([r * u[0], r * u[1]])]; };
    const clip = add(g, "clipPath", { id: `eg-clip-${uid}` });
    add(clip, "rect", { x: 1, y: 1, width: PW - 2, height: HGT - 2 });
    const body = add(g, "g", { "clip-path": `url(#eg-clip-${uid})` });
    for (let i = -Math.floor(R); i <= Math.floor(R); i++) {
      if (i === 0) continue;
      add(body, "path", { d: poly([S([i, -R]), S([i, R])]), class: "zs-grid" });
      add(body, "path", { d: poly([S([-R, i]), S([R, i])]), class: "zs-grid" });
    }
    add(body, "path", { d: poly([S([-R * 1.2, 0]), S([R * 1.2, 0])]), class: "zs-axis" });
    add(body, "path", { d: poly([S([0, -R * 1.2]), S([0, R * 1.2])]), class: "zs-axis" });
    const c1 = [m[0][0], m[1][0]], c2 = [m[0][1], m[1][1]];
    if (stepIndex === 7 && e.kind === "real") {
      const [v1, v2] = e.vectors;
      const [l1, l2] = e.values;
      add(body, "path", { d: `${poly([S([0, 0]), S(v1), S([v1[0] + v2[0], v1[1] + v2[1]]), S(v2)])} Z`, class: "eg-par eg-par--before" });
      const w1 = v1.map((x) => l1 * x), w2 = v2.map((x) => l2 * x);
      add(body, "path", { d: `${poly([S([0, 0]), S(w1), S([w1[0] + w2[0], w1[1] + w2[1]]), S(w2)])} Z`, class: "eg-par" });
    } else {
      add(body, "path", { d: `${poly([S([0, 0]), S(c1), S([c1[0] + c2[0], c1[1] + c2[1]]), S(c2)])} Z`, class: "eg-par" });
    }
    const circ = Array.from({ length: 97 }, (_, i) => [Math.cos((i * Math.PI) / 48), Math.sin((i * Math.PI) / 48)]);
    add(body, "path", { d: poly(circ.map(S)), class: "eg-circle" });
    add(body, "path", { d: poly(circ.map((v) => S(apply(m, v)))), class: "eg-ellipse" });
    // Eigen-directions.
    if (e.kind === "real" || e.kind === "repeated") {
      e.vectors.forEach((u, i) => {
        add(body, "path", { d: poly(lineThrough(u)), class: `eg-eigline eg-e${i}` });
        const l = e.values[i];
        if (Math.abs(l) > 1e-9) add(body, "path", { d: arrowPath(S([0, 0]), S(u.map((x) => l * x)), 9), class: `eg-eigvec eg-e${i}` });
        const tip = S(u.map((x) => (R * 0.92) * x));
        const lab = e.kind === "repeated" ? `${L(l)} (double)` : L(l);
        text(body, tip[0] + (u[1] >= 0 ? 6 : -6), tip[1] - 6, lab, `sim-label eg-lab eg-e${i}`, u[0] * (u[1] >= 0 ? 1 : -1) >= 0 ? "end" : "start");
      });
    }
    // Columns.
    if (stepIndex <= 0) {
      add(body, "path", { d: arrowPath(S([0, 0]), S(c1), 7), class: "eg-col" });
      add(body, "path", { d: arrowPath(S([0, 0]), S(c2), 7), class: "eg-col" });
      const t1 = S(c1), t2 = S(c2);
      text(body, t1[0] + 4, t1[1] + 14, "Ae₁", "sim-label zs-hint", "start");
      text(body, t2[0] + 4, t2[1] - 4, "Ae₂", "sim-label zs-hint", "start");
    }
    // Powers: directions of A^j v on the unit circle.
    const p = probe2(m, Number(s.theta));
    const k = Math.round(Number(s.k));
    if (k > 0) {
      const pw = powers(m, p.v, k);
      pw.forEach((w, j) => {
        if (norm(w) < 1e-12) return;
        const u = unit(w), q = S(u);
        add(body, "circle", { cx: q[0].toFixed(1), cy: q[1].toFixed(1), r: j === k ? 5 : 3.5, class: `eg-pow${j === k ? " eg-pow--last" : ""}` });
        const lq = S(u.map((x) => 1.13 * x));
        text(body, lq[0], lq[1] + 4, String(j), "sim-label zs-hint");
      });
    }
    // The probe and its image.
    add(body, "path", { d: arrowPath(S([0, 0]), S(p.v), 8), class: "eg-v" });
    add(body, "path", { d: arrowPath(S([0, 0]), S(p.Av), 9), class: "eg-av" });
    const tv = S(p.v), ta = S(p.Av);
    text(body, tv[0] + 5, tv[1] - 5, "v", "sim-label eg-v-text", "start");
    text(body, ta[0] + 5, ta[1] - 5, "Av", "sim-label eg-av-text", "start");
    if (stepIndex === 7 && e.kind === "real") {
      text(g, 10, 18, "light: the parallelogram on v₁ and v₂", "sim-label", "start");
      text(g, 10, 34, "green: its image, on λ₁v₁ and λ₂v₂", "sim-label", "start");
    } else {
      text(g, 10, 18, "dashed: unit circle · solid: its image under A", "sim-label", "start");
      text(g, 10, 34, "shaded: image of the unit square", "sim-label", "start");
    }
    text(g, 10, HGT - 10, `grid: 1 unit`, "sim-label zs-hint", "start");
  }

  /** A small graph frame with a horizontal range [x0, x1] and vertical [lo, hi]. */
  function frame(xa, ya, wd, ht, title, focus, x0, x1, lo, hi) {
    const g = add(svg, "g", { class: `zs-panel${focus ? " zs-focus" : ""}` });
    add(g, "rect", { x: xa, y: ya, width: wd, height: ht, class: "zs-frame" });
    text(g, xa + wd / 2, ya + 16, title);
    const left = xa + 34, right = xa + wd - 10, topY = ya + 26, botY = ya + ht - 24;
    const X = (u) => left + ((u - x0) / (x1 - x0)) * (right - left);
    const Y = (v) => botY - ((Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * (botY - topY);
    return { g, X, Y, left, right, topY, botY };
  }

  function drawSweep(m, e, s) {
    const thetas = Array.from({ length: 181 }, (_, i) => i);
    const ps = thetas.map((t) => probe2(m, t));
    let top = 0.5;
    for (const q of ps) top = Math.max(top, Math.abs(q.along), Math.abs(q.side));
    top *= 1.1;
    const F = frame(RX, 0, RW, RH, "parts of Av as v turns", [2, 3, 4].includes(stepIndex), 0, 180, -top, top);
    add(F.g, "path", { d: `M${F.left} ${F.Y(0).toFixed(1)} H${F.right}`, class: "zs-axis" });
    for (const t of [0, 45, 90, 135, 180]) {
      add(F.g, "path", { d: `M${F.X(t).toFixed(1)} ${F.Y(0).toFixed(1)} v3`, class: "zs-axis" });
      text(F.g, F.X(t), F.botY + 14, `${t}°`, "sim-label zs-hint");
    }
    text(F.g, F.left - 4, F.Y(top / 1.1) + 4, sfmt(top / 1.1, 2), "sim-label zs-hint", "end");
    text(F.g, F.left - 4, F.Y(-top / 1.1) + 4, sfmt(-top / 1.1, 2), "sim-label zs-hint", "end");
    add(F.g, "path", { d: poly(thetas.map((t, i) => [F.X(t), F.Y(ps[i].along)])), class: "eg-along" });
    add(F.g, "path", { d: poly(thetas.map((t, i) => [F.X(t), F.Y(ps[i].side)])), class: "eg-side" });
    for (const [i, a] of eigenAngles(e).entries()) {
      add(F.g, "path", { d: `M${F.X(a).toFixed(1)} ${F.topY} V${F.botY}`, class: `eg-eigline eg-e${i}` });
      const l = e.values[i];
      add(F.g, "circle", { cx: F.X(a).toFixed(1), cy: F.Y(l).toFixed(1), r: 4, class: `eg-dot eg-e${i}` });
      text(F.g, F.X(a) + (a > 150 ? -4 : 4), F.Y(l) - 6, L(l), `sim-label eg-lab eg-e${i}`, a > 150 ? "end" : "start");
    }
    const th = ((Number(s.theta) % 180) + 180) % 180;
    const q = probe2(m, th);
    add(F.g, "path", { d: `M${F.X(th).toFixed(1)} ${F.topY} V${F.botY}`, class: "zs-probe-line" });
    add(F.g, "circle", { cx: F.X(th).toFixed(1), cy: F.Y(q.along).toFixed(1), r: 3.5, class: "zs-probe" });
    add(F.g, "circle", { cx: F.X(th).toFixed(1), cy: F.Y(q.side).toFixed(1), r: 3.5, class: "zs-probe" });
    text(F.g, F.left + 2, F.botY - 4, "along: v·Av", "sim-label eg-along-text", "start");
    text(F.g, F.right, F.botY - 4, "sideways: v × Av", "sim-label eg-side-text", "end");
  }

  function drawPoly(m, e) {
    let centre = e.tr / 2, half = 2.5;
    if (e.kind === "real") half = Math.max(2, (e.values[0] - e.values[1] === 0 ? 0 : Math.abs(e.values[0] - e.values[1])) / 2 + 1.5);
    if (e.kind === "complex") half = Math.max(2, e.im + 1.5);
    const x0 = centre - half, x1 = centre + half;
    const ls = Array.from({ length: 121 }, (_, i) => x0 + ((x1 - x0) * i) / 120);
    const vs = ls.map((l) => charPoly2(m, l));
    const lo = Math.min(-0.5, ...vs.map((v) => Math.max(v, -50)));
    const hi = Math.max(0.5, Math.min(Math.max(...vs), Math.abs(lo) * 4 + 1));
    const F = frame(RX, RH + 10, RW, RH, "p(λ) = det(λI − A) = λ² − (trace)λ + det", stepIndex === 5, x0, x1, lo - 0.05 * (hi - lo), hi);
    add(F.g, "path", { d: `M${F.left} ${F.Y(0).toFixed(1)} H${F.right}`, class: "zs-axis" });
    for (let t = Math.ceil(x0); t <= Math.floor(x1); t++) {
      add(F.g, "path", { d: `M${F.X(t).toFixed(1)} ${F.Y(0).toFixed(1)} v3`, class: "zs-axis" });
      if ((x1 - x0) < 9 || t % 2 === 0) text(F.g, F.X(t), F.botY + 14, String(t).replace("-", "−"), "sim-label zs-hint");
    }
    // Draw only the part inside the frame; where the curve leaves it, break the line.
    const yLo = lo - 0.05 * (hi - lo);
    let dpath = "", pen = false;
    ls.forEach((l, i) => {
      const inside = vs[i] >= yLo && vs[i] <= hi;
      if (inside) { dpath += `${pen ? "L" : "M"}${F.X(l).toFixed(1)} ${F.Y(vs[i]).toFixed(1)} `; }
      pen = inside;
    });
    add(F.g, "path", { d: dpath.trim(), class: "eg-poly" });
    if (e.kind === "complex") {
      add(F.g, "circle", { cx: F.X(e.re).toFixed(1), cy: F.Y(charPoly2(m, e.re)).toFixed(1), r: 3.5, class: "zs-probe" });
      text(F.g, F.left + 2, F.topY + 10, `no real roots: λ = ${sfmt(e.re)} ± ${sfmt(e.im)}j`, "sim-label", "start");
    } else {
      const shown = e.kind === "real" ? e.values : [e.values[0]];
      shown.forEach((l, i) => {
        add(F.g, "circle", { cx: F.X(l).toFixed(1), cy: F.Y(0).toFixed(1), r: 4, class: `eg-dot eg-e${i}` });
        text(F.g, F.X(l), F.Y(0) - 8, L(l), `sim-label eg-lab eg-e${i}`);
      });
    }
    text(F.g, F.right, F.botY - 4, `trace ${sfmt(e.tr)} · det ${sfmt(e.det)}`, "sim-label zs-hint", "end");
  }

  function redraw() {
    if (destroyed) return;
    const s = panel.state;
    let m = currentMatrix(s);
    if (!m.flat().every(Number.isFinite)) m = [[1, 0], [0, 1]];
    const e = eig2(m);
    stage.clear();
    drawPlane(m, e, s);
    drawSweep(m, e, s);
    drawPoly(m, e);
    const steps = walkSteps(m, Number(s.theta), Math.round(Number(s.k)));
    walk.textContent = stepIndex < 0
      ? "Press Next step ▶ to walk through what the matrix does, one idea at a time."
      : `Step ${stepIndex + 1} of ${steps.length}: ${steps[stepIndex].title}. ${steps[stepIndex].text}`;
    actions.buttons[0].disabled = stepIndex <= 0;
    actions.buttons[1].disabled = stepIndex >= steps.length - 1;
    const p = probe2(m, Number(s.theta));
    const k = Math.round(Number(s.k));
    let pw = "";
    if (k > 0) {
      const w = powers(m, p.v, k)[k];
      pw = ` A^${k}v = ${vec(w)}, length ${sfmt(norm(w))}${e.kind === "real" && norm(w) > 1e-12 ? `, ${sfmt(lineAngle(w, e.vectors[0]), 2)}° from the λ₁ line` : ""}.`;
    }
    readout.textContent = `A = [[${sfmt(m[0][0])}, ${sfmt(m[0][1])}], [${sfmt(m[1][0])}, ${sfmt(m[1][1])}]]: trace ${sfmt(e.tr)}, det ${sfmt(e.det)}, ${describeEigen(e)}. v at ${sfmt(Number(s.theta), 0)}°: Av = ${vec(p.Av)}, length ${sfmt(p.stretch)}, turned ${sfmt(p.turnDeg, 1)}°.${pw}`;
  }

  redraw();
  return {
    update(partial) {
      if (panel.update(partial)) {
        if (partial && "matrix" in partial && String(panel.state.matrix) !== CUSTOM2) syncSliders();
        redraw();
      }
    },
    destroy() {
      destroyed = true;
      ticker.stop();
      panel.destroy();
      actions.destroy();
    },
  };
}

let uidCounter = 0;
registerWidget("eigen-plane", (ctx) => mountEigenPlane(ctx, ++uidCounter));
