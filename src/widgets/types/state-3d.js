// src/widgets/types/state-3d.js
//
// `state-3d` — a system with three states, x′ = Ax + Bu, y = Cx + Du. The 3D
// view draws the state's path from x(0) in state space (with its shadow on the
// floor), the real eigen-directions of A as dashed lines through the resting
// point, and for a complex pair of eigenvalues the plane in which the state
// turns (an amber disc). Below: the states and the output against time, and
// the poles and zeros in the s-plane.
//
// "Next step ▶" walks through eight steps; "Play ▶" draws the motion in time.
// Drag the 3D view to turn it.
//
// Params keys, in order: system (select: SYSTEM3_OPTIONS from
// ../sims/statespace.js), input (select: INPUTS), x1, x2, x3 (range, the
// initial state), azimuth (range, degrees, −180–180), elevation (range,
// degrees, 5–85). Styled by the .zs-*, .eg-* and .ss-* classes in alexandria.css.

import { registerWidget } from "../registry.js";
import { buildFrame, buildControlPanel, buildActions, buildReadout, buildStage, svgEl, makeTicker } from "../sim-kit.js";
import { eig3, circle3, unit, dot, norm, sfmt, fmt } from "../sims/eigen.js";
import {
  SYSTEMS3, SYSTEM3_OPTIONS, system3, INPUTS, poles, transferFunction, polyRoots, isControllable, isObservable,
  simulate, equilibrium, timeSpan, expT, poleText, polesText, polyVar, vecText, matText, stability,
} from "../sims/statespace.js";
import { project3 } from "./z-surface.js";
import { niceStep } from "./state-plane.js";

export const DEFAULT_PARAMS = [
  { key: "system", label: "System", control: "select", options: SYSTEM3_OPTIONS, default: SYSTEMS3[0].name },
  { key: "input", label: "Input", control: "select", options: INPUTS, default: INPUTS[0] },
  { key: "x1", label: "x₁(0)", control: "range", min: -2, max: 2, step: 0.1, default: 1 },
  { key: "x2", label: "x₂(0)", control: "range", min: -2, max: 2, step: 0.1, default: 0 },
  { key: "x3", label: "x₃(0)", control: "range", min: -2, max: 2, step: 0.1, default: 1 },
  { key: "azimuth", label: "Turn (degrees)", control: "range", min: -180, max: 180, step: 5, default: -35 },
  { key: "elevation", label: "Tilt (degrees)", control: "range", min: 5, max: 85, step: 5, default: 25 },
];

const W = 760, H3 = 400, HB = 200, HGT = H3 + HB + 10;
const v3 = (v) => vecText(v, 2);

export function model3(state) {
  let sys;
  try { sys = system3(String(state.system)); } catch { sys = SYSTEMS3[0]; }
  const input = INPUTS.includes(String(state.input)) ? String(state.input) : INPUTS[0];
  const x0 = [Number(state.x1) || 0, Number(state.x2) || 0, Number(state.x3) || 0];
  const r = input === INPUTS[1] ? 1 : 0;
  const K = [0, 0, 0];
  const ps = poles(sys.A);
  const tEnd = timeSpan(ps);
  const sim = simulate(sys, { x0, K, input, tEnd, n: 500 });
  const eq = equilibrium(sys, K, r);
  const tf = transferFunction(sys.A, sys.B, sys.C, sys.D);
  const zeros = polyRoots(tf.num);
  const e = eig3(sys.A);
  return { sys, input, x0, r, ps, tEnd, sim, eq, tf, zeros, e, stab: stability(ps),
    ctrb: isControllable(sys.A, sys.B), obsv: isObservable(sys.A, sys.C) };
}

/** One phrase for what a real mode λ does over time. */
function realMode(l) {
  if (Math.abs(l) < 1e-9) return "λ = 0, which neither grows nor decays";
  return l < 0 ? `λ = ${sfmt(l)}, time constant ${sfmt(-1 / l, 2)} s` : `λ = ${sfmt(l)}, growing, doubling every ${sfmt(Math.log(2) / l, 2)} s`;
}
/** The modes, in words: each real eigenvalue with its direction, and the complex pair with its plane. */
export function modesText(e) {
  const parts = e.distinct.map((d) => `${realMode(d.value)}${d.alg > 1 ? ` (a ${d.alg === 2 ? "double" : "triple"} root with only ${d.vectors.length === 1 ? "one direction" : `${d.vectors.length} directions`})` : ""} along ${v3(d.vectors[0])}`);
  for (const c of e.complex) {
    const env = Math.abs(c.re) < 1e-9 ? "with no growth or decay" : c.re < 0 ? `while decaying like e^(${expT(c.re)})` : `while growing like e^(${expT(c.re)})`;
    parts.push(`λ = ${sfmt(c.re)} ± ${sfmt(c.im)}j, turning in the amber plane once every ${sfmt((2 * Math.PI) / c.im, 2)} s ${env}`);
  }
  return parts.join("; ");
}

/** The rates of all modes (real parts), fastest decay first. */
const rates = (e) => [...e.distinct.map((d) => d.value), ...e.complex.map((c) => c.re)].sort((a, b) => a - b);

export function walkSteps3(md) {
  const { sys, e, ps, x0, sim, tf, zeros, stab } = md;
  const end = sim.t[sim.t.length - 1];
  const rs = rates(e);
  const fast = rs[0], slow = rs[rs.length - 1];
  let step4;
  if (rs.some((x) => x > 1e-9)) {
    step4 = `One mode grows (${realMode(slow)}${e.complex.some((c) => c.re === slow) ? ", the complex pair" : ""}), and the others decay. Whatever the start, the growing part soon dominates, so the path bends onto the unstable direction and leaves along it: after a short time only that mode is visible.`;
  } else if (Math.abs(slow) < 1e-9 && e.complex.some((c) => Math.abs(c.re) < 1e-9)) {
    step4 = `The complex pair sits on the imaginary axis (real part 0), so its turning in the amber plane never dies away: the state keeps circling once every ${sfmt((2 * Math.PI) / e.complex[0].im, 2)} s. The other mode${rs.length > 3 ? "s decay" : " decays"} (${rs.filter((x) => x < -1e-9).map((x) => sfmt(x)).join(", ")} per second), so the path settles onto that circling motion and stays on it.`;
  } else if (fast < slow - 1e-9 && fast / (slow || -1e-9) > 2.5) {
    const slowName = e.complex.some((c) => Math.abs(c.re - slow) < 1e-12) ? "the amber plane of the slow complex pair" : "the slowest eigen-direction";
    step4 = `The modes run at very different speeds: the fastest dies away with time constant ${sfmt(-1 / fast, 2)} s, the slowest with ${Math.abs(slow) < 1e-9 ? "none at all (λ = 0)" : `${sfmt(-1 / slow, 2)} s`}. So the path first drops quickly onto ${slowName}, then ${Math.abs(slow) < 1e-9 ? "stops there: along a λ = 0 line nothing decays or grows, so the state rests wherever it lands" : "moves along it slowly"}. The slow poles, those nearest the imaginary axis, dominate the response: that is why a third-order system can often be approximated by a first- or second-order one.`;
  } else if (e.defective) {
    step4 = `All three eigenvalues are equal (λ = ${sfmt(e.values[0])}) but there is only one eigen-direction, so the matrix is defective. The response is not just e^(${expT(e.values[0])}) but also t·e^(${expT(e.values[0])}) and t²·e^(${expT(e.values[0])}): the path swings out before it comes back along the single dashed line.`;
  } else {
    step4 = `The modes decay at similar speeds (${rs.map((x) => sfmt(x)).join(", ")} per second), so none of them dominates for long and the path curves towards rest without first collapsing onto one line or plane.`;
  }
  const G0 = Math.abs(tf.den[tf.den.length - 1]) > 1e-12 ? tf.num[tf.num.length - 1] / tf.den[tf.den.length - 1] : null;
  const step6 = !md.eq || G0 === null
    ? "Now the input is a unit step from rest. A has an eigenvalue at 0, so there is no resting point for a constant input: the state keeps drifting and the output grows without limit."
    : `Now the input is a unit step from rest. The new resting point (+) solves 0 = Ax + B, so x = −A⁻¹B = ${v3(md.eq)}. ${stab === "stable" ? `The path settles there and y settles at G(0) = ${sfmt(G0)}.` : stab === "unstable" ? "The system is unstable, so the path runs away instead of settling." : "But a mode on the edge of stability never dies away, so the path keeps moving round it instead of settling."}`;
  return [
    { title: "Three states, a point in space", text: `This system has three states, ${sys.states.join(", ")}, so its state is a point in space (the circle is x(0) = ${v3(x0)}). Drag the view, or use Turn and Tilt, to see it from another side.` },
    { title: "The path", text: `The solution x(t) = e^(At)x(0) is the dark curve, for 0 ≤ t ≤ ${sfmt(end, 2)} s, with its shadow on the floor. The time plot shows its three coordinates and the output y. Press Play ▶ to watch the state move.` },
    { title: "Modes", text: `Each real eigenvalue of A gives a straight-line mode (dashed) and a complex pair gives a plane in which the state turns (amber disc). Here: ${modesText(e)}. A start on a dashed line stays on it.` },
    { title: "Fast and slow modes", text: step4 },
    { title: "Poles and stability", text: `The eigenvalues are the poles, plotted bottom right: ${polesText(ps)}. ${stab === "stable" ? "All real parts are negative, so the system is stable." : stab === "unstable" ? "One real part is positive, so the system is unstable." : "A pole sits on the imaginary axis, so the system is on the edge of stability: that mode neither dies away nor grows."}` },
    { title: "Add an input", text: step6 },
    { title: "Input to output", text: `G(s) = C(sI − A)⁻¹B + D = (${polyVar(tf.num)}) / (${polyVar(tf.den)}). The denominator is det(sI − A), third order, with the poles as roots.${zeros.length ? ` The zeros are ${zeros.filter((z) => z.im >= -1e-12).map((z) => poleText(z)).join(" and ")}.` : " There are no zeros."}${!md.ctrb ? " Not every mode can be reached from the input (not controllable)." : ""}${!md.obsv ? " Not every mode shows in the output (not observable), so G has fewer poles than A after cancelling." : ""}` },
    { title: "What the eigenvalues tell you", text: `Each eigenvalue is one mode of the system: its real part says how fast it grows or decays, its imaginary part how fast it turns. ${stab === "stable" ? `The slowest decay, ${sfmt(slow)} per second, sets how long the system takes to settle: about ${sfmt(-4 / slow, 2)} s to fall within 2% (4 time constants).` : stab === "unstable" ? "One mode grows, so this system needs feedback before it can be used." : "One mode sits on the edge (real part 0): it neither dies away nor grows, so the system never settles by itself. Feedback can move that pole into the left half-plane."}` },
  ];
}

function mergeParams(params) {
  return Array.isArray(params) && params.length > 0 ? params : DEFAULT_PARAMS;
}

/** The scene's centre and half-size: holds the path, x(0), the resting point and the origin. */
export function sceneBox(md) {
  const pts = [...md.sim.x, md.x0, [0, 0, 0]];
  if (md.eq) pts.push(md.eq);
  if (md.input === INPUTS[2]) pts.push(md.x0.map((v, i) => v + md.sys.B[i]));
  const fin = pts.filter((p) => p.every(Number.isFinite));
  const lo = [0, 1, 2].map((k) => Math.min(...fin.map((p) => p[k])));
  const hi = [0, 1, 2].map((k) => Math.max(...fin.map((p) => p[k])));
  const c = lo.map((x, k) => (x + hi[k]) / 2);
  const R = Math.max(0.6, 0.55 * Math.max(...hi.map((x, k) => x - lo[k])));
  return { c, R };
}

function mountState3d(ctx, uid) {
  const spec = ctx.spec ?? {};
  const { doc, root } = buildFrame(ctx.container, spec);
  const params = mergeParams(spec.params);
  const panel = buildControlPanel(doc, root, params, (state, key) => {
    if (key === "system") { stepIndex = -1; play = null; stopPlay(); }
    schedule();
  });
  let stepIndex = -1, play = null, actions = null;
  const ticker = makeTicker(() => {
    play = play === null ? 0 : play + 1 / 150;
    if (play >= 1) { play = null; stopPlay(); }
    schedule();
  }, 40);
  const setPressed = (on) => { if (actions) actions.buttons[2].setAttribute("aria-pressed", on ? "true" : "false"); };
  const startPlay = () => { play = 0; ticker.start(); setPressed(true); };
  const stopPlay = () => { ticker.stop(); setPressed(false); };
  const go = (i) => {
    stepIndex = i;
    if (i === 0) {
      panel.update({ input: INPUTS[0] });
      if (Math.abs(Number(panel.state.x1)) + Math.abs(Number(panel.state.x2)) + Math.abs(Number(panel.state.x3)) < 1e-9) panel.update({ x1: 1, x2: 0, x3: 1 });
    }
    if (i === 1 || i === 3) startPlay();
    if (i === 5) { panel.update({ input: INPUTS[1], x1: 0, x2: 0, x3: 0 }); startPlay(); }
    if (![1, 3, 5].includes(i)) { play = null; stopPlay(); }
    redraw();
  };
  actions = buildActions(doc, root, [
    { label: "◀ Back", secondary: true, onClick: () => go(Math.max(0, stepIndex - 1)) },
    { label: "Next step ▶", onClick: () => go(Math.min(7, stepIndex + 1)) },
    { label: "Play ▶", secondary: true, onClick: () => { if (ticker.running()) { stopPlay(); play = null; schedule(); } else startPlay(); } },
  ]);
  const stage = buildStage(doc, root, W, HGT,
    "A system with three states: the path of the state in space with the eigen-directions, the states and output against time, and the poles and zeros");
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
  const shownCount = (md) => {
    const n = md.sim.t.length;
    return play === null ? n : Math.max(1, Math.min(n, Math.floor(play * (n - 1)) + 1));
  };

  function draw3d(md, s) {
    const g = add(svg, "g", { class: `zs-panel${[0, 1, 2, 3, 5].includes(stepIndex) ? " zs-focus" : ""}` });
    add(g, "rect", { x: 0, y: 0, width: W, height: H3, class: "zs-frame" });
    const az = (Number(s.azimuth) * Math.PI) / 180, el = (Number(s.elevation) * Math.PI) / 180;
    const { c, R } = sceneBox(md);
    const P = (v) => project3((v[0] - c[0]) / R, (v[1] - c[1]) / R, (v[2] - c[2]) / R, az, el);
    const sc = H3 / 2 - 40;
    const S = (v) => { const p = P(v); return [W / 2 + sc * p.u, H3 / 2 + 10 - sc * p.v]; };
    const clip = add(g, "clipPath", { id: `ss3-clip-${uid}` });
    add(clip, "rect", { x: 1, y: 1, width: W - 2, height: H3 - 2 });
    const body = add(g, "g", { "clip-path": `url(#ss3-clip-${uid})` });
    // The floor (x₃ at the bottom of the box) with a grid, and the box's back edges.
    const fz = c[2] - R;
    const at = (a, b, z = fz) => [c[0] + a * R, c[1] + b * R, z];
    const st = niceStep(2 * R);
    for (let v = Math.ceil((c[0] - R) / st) * st; v <= c[0] + R + 1e-9; v += st) add(body, "path", { d: poly([S([v, c[1] - R, fz]), S([v, c[1] + R, fz])]), class: "zs-grid" });
    for (let v = Math.ceil((c[1] - R) / st) * st; v <= c[1] + R + 1e-9; v += st) add(body, "path", { d: poly([S([c[0] - R, v, fz]), S([c[0] + R, v, fz])]), class: "zs-grid" });
    add(body, "path", { d: `${poly([S(at(-1, -1)), S(at(1, -1)), S(at(1, 1)), S(at(-1, 1))])} Z`, class: "zs-axis" });
    // Axes through the origin, where it is inside the box.
    const inBox = (p) => p.every((x, k) => Math.abs(x - c[k]) <= R + 1e-9);
    const names = ["x₁", "x₂", "x₃"];
    for (let k = 0; k < 3; k++) {
      const a = [0, 0, 0], b = [0, 0, 0];
      a[k] = c[k] - R; b[k] = c[k] + R;
      for (let j = 0; j < 3; j++) if (j !== k) { a[j] = Math.max(c[j] - R, Math.min(c[j] + R, 0)); b[j] = a[j]; }
      if (k !== 2 && !inBox([0, 0, 0])) { a[2] = fz; b[2] = fz; }
      add(body, "path", { d: poly([S(a), S(b)]), class: "zs-axis" });
      const t = S(b.map((x, j) => (j === k ? x + 0.08 * R : x)));
      text(body, t[0], t[1] + 4, names[k], "sim-label zs-hint");
    }
    // The complex-pair plane and the eigen-lines through the resting point.
    const base = md.eq ?? [0, 0, 0];
    for (const cp of md.e.complex) {
      const e1 = unit(cp.u), w = cp.w.map((x, i) => x - dot(cp.w, e1) * e1[i]), e2 = unit(w);
      add(body, "path", { d: `${poly(circle3(e1, e2, 48).map((p) => S(p.map((x, i) => base[i] + 0.7 * R * x))))} Z`, class: "eg-plane" });
    }
    let li = 0;
    for (const d of md.e.distinct) {
      for (const u of d.vectors.slice(0, 1)) {
        const i = Math.min(li, 2);
        add(body, "path", { d: poly([S(base.map((x, k) => x - 3 * R * u[k])), S(base.map((x, k) => x + 3 * R * u[k]))]), class: `eg-eigline eg-e${i}` });
        let tip = S(base.map((x, k) => x + 0.85 * R * u[k]));
        if (tip[0] < 40 || tip[0] > W - 80 || tip[1] < 30 || tip[1] > H3 - 20) tip = S(base.map((x, k) => x - 0.85 * R * u[k]));
        text(body, tip[0] + 6, tip[1] - 6, `λ = ${sfmt(d.value)}`, `sim-label eg-lab eg-e${i}`, "start");
        li++;
      }
    }
    // The path, its shadow, x(0), the resting point.
    const k = shownCount(md);
    const xs = md.sim.x.slice(0, k);
    add(body, "path", { d: poly(xs.map((p) => S([p[0], p[1], fz]))), class: "ss-traj ss-traj--faint" });
    if (md.input === INPUTS[2]) add(body, "path", { d: poly([S(md.x0), S(md.sim.x[0])]), class: "ss-jump" });
    add(body, "path", { d: poly(xs.map(S)), class: "ss-traj" });
    const x0p = S(md.x0);
    add(body, "circle", { cx: x0p[0].toFixed(1), cy: x0p[1].toFixed(1), r: 5, class: "ss-x0" });
    text(body, x0p[0] + 8, x0p[1] + 14, "x(0)", "sim-label", "start");
    if (md.r && md.eq) {
      const e = S(md.eq);
      add(body, "path", { d: `M${(e[0] - 7).toFixed(1)} ${e[1].toFixed(1)} h14 M${e[0].toFixed(1)} ${(e[1] - 7).toFixed(1)} v14`, class: "ss-eq" });
      text(body, e[0] + 8, e[1] - 8, "rest", "sim-label zs-hint", "start");
    }
    if (play !== null) { const q = S(xs[xs.length - 1]); add(body, "circle", { cx: q[0].toFixed(1), cy: q[1].toFixed(1), r: 6, class: "ss-now" }); }
    add(g, "rect", { x: 4, y: 4, width: 420, height: 36, class: "ss-caption" });
    text(g, 10, 18, "dark: the state's path · faint: its shadow on the floor", "sim-label", "start");
    text(g, 10, 34, "dashed: eigen-directions · amber: the plane a complex pair turns", "sim-label", "start");
    text(g, 10, H3 - 10, `grid: ${sfmt(st)} · drag to turn`, "sim-label zs-hint", "start");
  }

  function drawTime(md) {
    const x0 = 0, y0 = H3 + 10, wd = 450, ht = HB;
    const g = add(svg, "g", { class: `zs-panel${[1, 3, 5].includes(stepIndex) ? " zs-focus" : ""}` });
    add(g, "rect", { x: x0, y: y0, width: wd, height: ht, class: "zs-frame" });
    text(g, x0 + wd / 2, y0 + 16, "states and output against time (s)");
    const { t, x, y } = md.sim;
    const end = t[t.length - 1];
    const vals = [0, ...x.flat(), ...y].filter(Number.isFinite);
    let lo = Math.min(...vals), hi = Math.max(...vals);
    if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
    const pad = 0.08 * (hi - lo); lo -= pad; hi += pad;
    const left = x0 + 40, right = x0 + wd - 10, topY = y0 + 26, botY = y0 + ht - 24;
    const X = (u) => left + (u / end) * (right - left);
    const Y = (v) => botY - ((v - lo) / (hi - lo)) * (botY - topY);
    add(g, "path", { d: `M${left} ${Y(0).toFixed(1)} H${right}`, class: "zs-axis" });
    const ts = niceStep(end);
    for (let u = 0; u <= end + 1e-9; u += ts) {
      add(g, "path", { d: `M${X(u).toFixed(1)} ${botY} v3`, class: "zs-axis" });
      text(g, X(u), botY + 14, sfmt(u, 2), "sim-label zs-hint");
    }
    const ys = niceStep(hi - lo);
    for (let v = Math.ceil(lo / ys) * ys; v <= hi; v += ys) text(g, left - 4, Y(v) + 4, sfmt(v, 2), "sim-label zs-hint", "end");
    const k = shownCount(md);
    const series = [[y, "ss-y"], [x.map((p) => p[0]), "ss-x1"], [x.map((p) => p[1]), "ss-x2"], [x.map((p) => p[2]), "ss-x3"]];
    for (const [vs, cls] of series) add(g, "path", { d: poly(vs.slice(0, k).map((v, i) => [X(t[i]), Y(v)])), class: `ss-line ${cls}` });
    if (play !== null) add(g, "path", { d: `M${X(t[k - 1]).toFixed(1)} ${topY} V${botY}`, class: "zs-probe-line" });
    ["x₁", "x₂", "x₃"].forEach((n, i) => text(g, left + 4 + 22 * i, topY + 10, n, `sim-label ss-x${i + 1}-text`, "start"));
    text(g, left + 70, topY + 10, "y (thick)", "sim-label ss-y-text", "start");
  }

  function drawPoles(md) {
    const x0 = 460, y0 = H3 + 10, wd = W - x0, ht = HB;
    const g = add(svg, "g", { class: `zs-panel${[4, 6, 7].includes(stepIndex) ? " zs-focus" : ""}` });
    add(g, "rect", { x: x0, y: y0, width: wd, height: ht, class: "zs-frame" });
    text(g, x0 + wd / 2, y0 + 16, "poles × and zeros ○ in the s-plane");
    const all = [...md.ps, ...md.zeros];
    const R = Math.min(40, Math.max(1.5, ...all.map((p) => 1.18 * Math.hypot(p.re, p.im))));
    const cx = x0 + wd / 2, cy = y0 + 26 + (ht - 40) / 2, sc = (ht - 44) / 2 / R;
    const P = (p) => [cx + sc * p.re, cy - sc * p.im];
    const clip = add(g, "clipPath", { id: `ss3-pclip-${uid}` });
    add(clip, "rect", { x: x0 + 1, y: y0 + 22, width: wd - 2, height: ht - 24 });
    const body = add(g, "g", { "clip-path": `url(#ss3-pclip-${uid})` });
    const xl = x0 + 1, xr = x0 + wd - 1, yt = y0 + 22, yb = y0 + ht - 1;
    add(body, "rect", { x: cx.toFixed(1), y: yt, width: (xr - cx).toFixed(1), height: yb - yt, class: "ss-unstable" });
    add(body, "path", { d: `M${xl} ${cy.toFixed(1)} H${xr}`, class: "zs-axis" });
    add(body, "path", { d: `M${cx.toFixed(1)} ${yt} V${yb}`, class: "zs-axis" });
    const st = niceStep(3 * R);
    for (let v = st; v <= R * 1.6; v += st) for (const sgn of [-1, 1]) {
      const px = cx + sgn * v * sc;
      if (px < xl + 8 || px > xr - 8) continue;
      add(body, "path", { d: `M${px.toFixed(1)} ${cy.toFixed(1)} v3`, class: "zs-axis" });
      text(body, px, cy + 14, sfmt(sgn * v, 2), "sim-label zs-hint");
    }
    text(body, xr - 4, yb - 6, "right half: unstable", "sim-label zs-hint", "end");
    for (const p of md.ps) { const [x, y] = P(p); add(body, "path", { d: `M${x - 6} ${y - 6} L${x + 6} ${y + 6} M${x - 6} ${y + 6} L${x + 6} ${y - 6}`, class: "ss-pole" }); }
    for (const z of md.zeros) { const [x, y] = P(z); add(body, "circle", { cx: x.toFixed(1), cy: y.toFixed(1), r: 5, class: "zs-zero" }); }
    const used = [];
    for (const p of md.ps) {
      if (p.im < -1e-12) continue;
      if (used.some((u) => Math.abs(u.re - p.re) < 1e-6 && Math.abs(u.im - p.im) < 1e-6)) continue;
      const [x, y] = P(p);
      let ly = y - 10;
      while (used.some((u) => Math.abs(u.x - x) < 70 && Math.abs(u.ly - ly) < 12)) ly -= 13;
      used.push({ re: p.re, im: p.im, x, ly });
      const anchor = x > xr - 70 ? "end" : x < xl + 70 ? "start" : "middle";
      text(body, x, ly, poleText(p), "sim-label ss-pole-text", anchor);
    }
  }

  function redraw() {
    if (destroyed) return;
    const s = panel.state;
    const md = model3(s);
    stage.clear();
    draw3d(md, s);
    drawTime(md);
    drawPoles(md);
    const steps = walkSteps3(md);
    walk.textContent = stepIndex < 0
      ? "Press Next step ▶ to walk through the system one idea at a time."
      : `Step ${stepIndex + 1} of ${steps.length}: ${steps[stepIndex].title}. ${steps[stepIndex].text}`;
    actions.buttons[0].disabled = stepIndex <= 0;
    actions.buttons[1].disabled = stepIndex >= steps.length - 1;
    const last = md.sim.x[md.sim.x.length - 1], tl = md.sim.t[md.sim.t.length - 1];
    readout.textContent = [
      `${md.sys.name}: A = ${matText(md.sys.A)}, B = ${vecText(md.sys.B, 0)}, C = ${vecText(md.sys.C, 0)}.`,
      `Poles ${polesText(md.ps)}: ${md.stab}.`,
      `G(s) = (${polyVar(md.tf.num)}) / (${polyVar(md.tf.den)}).`,
      `${md.ctrb ? "Controllable" : "Not controllable"}, ${md.obsv ? "observable" : "not observable"}.`,
      `At t = ${sfmt(tl, 2)} s: x = ${v3(last)}, y = ${fmt(md.sim.y[md.sim.y.length - 1], 3)}.`,
    ].join(" ");
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

let uidCounter = 0;
registerWidget("state-3d", (ctx) => mountState3d(ctx, ++uidCounter));
