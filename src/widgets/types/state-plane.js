// src/widgets/types/state-plane.js
//
// `state-plane` — a system with two states, x′ = Ax + Bu, y = Cx + Du, seen
// three ways at once:
//
//   - the state plane (left): the state x = (x₁, x₂) is a point; the arrows
//     are the state equation's velocity (A − BK)x + Br at each point (when
//     sampled: where one step moves the state); the curve is the solution from
//     x(0), with a dot every second (sampled: one dot per sample); the real
//     eigen-directions are dashed lines through the resting point;
//   - the time plot (top right): x₁(t), x₂(t) and the output y(t);
//   - the poles (bottom right): the eigenvalues of A (or A − BK) as × in the
//     s-plane, with the unstable half shaded, and the zeros of G(s) as ○. When
//     sampled: the z-plane, the unit circle, and the poles of Φ − ΓK.
//
// "Next step ▶" walks through eight steps; "Play ▶" draws the motion in time.
//
// Params keys, in order: system (select: SYSTEM2_OPTIONS from
// ../sims/statespace.js), time (select: TIME_OPTIONS), T (range, s, sample
// period), input (select: INPUTS), x1, x2 (range, the initial state), k1, k2
// (range, the state-feedback gains: u = −k₁x₁ − k₂x₂ + r).
// Styled by the .zs-* and .ss-* classes in alexandria.css.

import { registerWidget } from "../registry.js";
import { buildFrame, buildControlPanel, buildActions, buildReadout, buildStage, svgEl, makeTicker } from "../sim-kit.js";
import { eig2, sfmt, fmt, unit } from "../sims/eigen.js";
import {
  SYSTEMS2, SYSTEM2_OPTIONS, system2, INPUTS, discretise, poles, transferFunction, polyRoots, isControllable,
  isObservable, ackermann, addM, outer, mv, simulate, equilibrium, timeSpan, zToS, sToZ, polyFromRoots,
  expT, poleText, polesText, polyVar, vecText, matText, stability,
} from "../sims/statespace.js";

export const TIME_OPTIONS = ["continuous time", "sampled every T seconds"];

export const DEFAULT_PARAMS = [
  { key: "system", label: "System", control: "select", options: SYSTEM2_OPTIONS, default: SYSTEMS2[0].name },
  { key: "time", label: "Time", control: "select", options: TIME_OPTIONS, default: TIME_OPTIONS[0] },
  { key: "T", label: "Sample period T (seconds)", control: "range", min: 0.05, max: 1.5, step: 0.05, default: 0.2 },
  { key: "input", label: "Input", control: "select", options: INPUTS, default: INPUTS[0] },
  { key: "x1", label: "x₁(0)", control: "range", min: -2, max: 2, step: 0.1, default: 1 },
  { key: "x2", label: "x₂(0)", control: "range", min: -2, max: 2, step: 0.1, default: 0 },
  { key: "k1", label: "Feedback gain k₁", control: "range", min: -10, max: 10, step: 0.1, default: 0 },
  { key: "k2", label: "Feedback gain k₂", control: "range", min: -10, max: 10, step: 0.1, default: 0 },
];

const W = 760, HGT = 450;
const PW = 440;
const RX = PW + 10, RW = W - RX, RH = (HGT - 10) / 2;
const round1 = (x) => Math.round(x * 10) / 10;
const clampK = (x) => Math.max(-10, Math.min(10, round1(x)));

/** Everything the three panels, the readout and the steps need, from the controls. */
export function model(state) {
  let sys;
  try { sys = system2(String(state.system)); } catch { sys = SYSTEMS2[0]; }
  const K = [Number(state.k1) || 0, Number(state.k2) || 0];
  const feedback = Math.abs(K[0]) + Math.abs(K[1]) > 1e-12;
  const discrete = String(state.time) === TIME_OPTIONS[1];
  const T = Math.max(0.01, Number(state.T) || 0.2);
  const input = INPUTS.includes(String(state.input)) ? String(state.input) : INPUTS[0];
  const x0 = [Number(state.x1) || 0, Number(state.x2) || 0];
  const r = input === INPUTS[1] ? 1 : 0;
  let M, Bm, Phi, Gamma, openM;
  if (discrete) {
    ({ Phi, Gamma } = discretise(sys.A, sys.B, T));
    M = addM(Phi, outer(Gamma, K), -1); Bm = Gamma; openM = Phi;
  } else {
    M = addM(sys.A, outer(sys.B, K), -1); Bm = sys.B; openM = sys.A;
  }
  const ps = poles(M), open = poles(openM);
  const tEnd = timeSpan(discrete ? ps.map((z) => zToS(z, T)) : ps);
  const sim = simulate(sys, { x0, K, input, discrete, T, tEnd });
  const cont = discrete && !feedback ? simulate(sys, { x0, K, input, discrete: false, tEnd: sim.t[sim.t.length - 1] }) : null;
  const eq = equilibrium(sys, K, r, discrete, T);
  const Ccl = sys.C.map((c, i) => c - sys.D * K[i]);
  const tf = transferFunction(M, Bm, Ccl, sys.D);
  const openTf = transferFunction(openM, Bm, sys.C, sys.D);
  const zeros = polyRoots(tf.num);
  const e = eig2(M);
  return { sys, K, feedback, discrete, T, input, x0, r, M, Bm, Phi, Gamma, ps, open, tEnd, sim, cont, eq, tf, openTf, zeros, e,
    ctrb: isControllable(sys.A, sys.B), obsv: isObservable(sys.A, sys.C), stab: stability(ps, discrete) };
}

/** The gain the walk-through's feedback step uses: the preset's own, or Ackermann's formula for its target poles. */
export function stepGain(md) {
  const { sys, discrete, T } = md;
  let K;
  if (sys.stepK) K = sys.stepK.slice();
  else {
    const target = sys.place;
    if (discrete) {
      const { Phi, Gamma } = discretise(sys.A, sys.B, T);
      const sRoots = polyRoots([1, ...target]);
      K = ackermann(Phi, Gamma, polyFromRoots(sRoots.map((s) => sToZ(s, T))));
    } else K = ackermann(sys.A, sys.B, target);
  }
  return K ? K.map(clampK) : [0, 0];
}

const v2 = (v) => vecText(v, 2);
const unitOf = (md) => (md.discrete ? "z" : "λ");

/** Which eigen-direction the modes step puts x(0) on: a stable one if the other is unstable, else the slower one. */
export function modeChoice(md) {
  const { e, discrete } = md;
  if (e.kind !== "real") return -1;
  const grow = (l) => (discrete ? Math.abs(l) : l); // bigger = slower decay or growth
  const unstable = (l) => (discrete ? Math.abs(l) > 1 + 1e-9 : l > 1e-9);
  const [a, b] = e.values;
  if (unstable(a) && !unstable(b)) return 1;
  if (unstable(b) && !unstable(a)) return 0;
  return grow(a) >= grow(b) ? 0 : 1;
}

/** x(0) on eigen-direction i, scaled so its larger entry is 1, on the sliders' 0.1 grid. */
export function onEigenLine(md, i) {
  const v = md.e.vectors[i];
  const s = Math.max(Math.abs(v[0]), Math.abs(v[1]));
  return [round1(v[0] / s), round1(v[1] / s)];
}

function modeWords(l, discrete, T) {
  if (discrete) {
    const a = Math.abs(l);
    if (Math.abs(a - 1) < 1e-9) return `${l < 0 ? "flips sign each step and " : ""}keeps its size`;
    return `${l < 0 ? "flips sign each step and " : ""}${a < 1 ? "shrinks" : "grows"} by a factor ${sfmt(a)} each step`;
  }
  if (Math.abs(l) < 1e-9) return "stays where it is (λ = 0: no restoring force along this line)";
  return l < 0 ? `dies away like e^(${expT(l)}), time constant ${sfmt(-1 / l, 2)} s` : `grows like e^(${expT(l)}), doubling every ${sfmt(Math.log(2) / l, 2)} s`;
}

/** The eight walk-through steps for the current controls. */
export function walkSteps(md) {
  const { sys, discrete, T, e, ps, x0, sim, tf, zeros, K, feedback } = md;
  const [n1, n2] = sys.states;
  const S = discrete ? "z" : "s";
  const end = sim.t[sim.t.length - 1];
  const field = discrete ? mv(md.M, x0).map((v, i) => v + md.Bm[i] * md.r) : mv(md.M, x0).map((v, i) => v + md.Bm[i] * md.r);
  const step2 = discrete
    ? `Sampled every T = ${sfmt(T)} s, the state equation becomes x[k+1] = Φx[k] + Γu[k] with Φ = e^(AT) = ${matText(md.Phi)} and Γ = ${v2(md.Gamma)}. Each arrow points from a state towards the state one sample later. From x[0] = ${v2(x0)} the next state is ${v2(field)}.`
    : `The state equation x′ = Ax + Bu says how fast the state moves from any point. With no input it is x′ = Ax: at x(0) = ${v2(x0)} the velocity is Ax(0) = ${v2(field)}${Math.hypot(field[0], field[1]) < 1e-9 ? ", zero: this x(0) is itself a resting point, so the state stays put (move x(0) to see the arrows act)" : ""}. The arrows show this direction at every point of the plane (faint arrows are slow, dark ones fast). The rule is the same everywhere, so the state only has to follow the arrows.`;
  const step3 = discrete
    ? `The dots are x[0], x[1], x[2], … for ${sim.t.length - 1} samples (${sfmt(end, 2)} s). Each one is Φ times the one before, so x[k] = Φ^k x[0].${md.cont ? " The faint curve is the continuous motion: the samples sit exactly on it, because Φ = e^(AT) is the continuous motion over one period." : ""} The time plot shows the same numbers as x₁[k], x₂[k] and y[k].`
    : `The curve is the solution x(t) = e^(At) x(0) for 0 ≤ t ≤ ${sfmt(end, 2)} s, with a dot every second. It is tangent to the arrows everywhere. The time plot top right shows the same motion as two signals, ${n1.split(" x")[0].split(",")[0]} x₁(t) and ${n2.split(" x")[0].split(",")[0]} x₂(t), and the output y(t). Press Play ▶ to watch the state move.`;
  let step4;
  if (e.kind === "real") {
    const i = modeChoice(md);
    const l = e.values[i];
    step4 = `${discrete ? "Φ" : "A"} has two real eigenvalues, ${unitOf(md)} = ${sfmt(e.values[0])} along ${v2(e.vectors[0])} and ${unitOf(md)} = ${sfmt(e.values[1])} along ${v2(e.vectors[1])} (the dashed lines). Started on one of these lines, the state stays on it: x(0) is now ${v2(onEigenLine(md, i))}, on the ${unitOf(md)} = ${sfmt(l)} line, and the motion ${modeWords(l, discrete, T)}. Any other start is a mix of the two modes, each one doing its own thing.`;
  } else if (e.kind === "complex") {
    const sigma = discrete ? Math.log(e.modulus) / T : e.re, omega = discrete ? (e.angleDeg * Math.PI) / 180 / T : e.im;
    step4 = discrete
      ? `The eigenvalues of Φ are complex, z = ${sfmt(e.re)} ± ${sfmt(e.im)}j, size ${sfmt(e.modulus)} and angle ${sfmt(e.angleDeg, 1)}°: each step turns the state about ${sfmt(e.angleDeg, 1)}° round the resting point and scales it by ${sfmt(e.modulus)}. There is no straight-line mode; the samples ${e.modulus < 1 - 1e-9 ? "spiral in" : e.modulus > 1 + 1e-9 ? "spiral out" : "go round a closed loop"}.`
      : `The eigenvalues are complex, λ = ${sfmt(e.re)} ± ${sfmt(e.im)}j, so no direction is kept and there is no straight-line mode. The real part ${sfmt(sigma)} sets the envelope e^(${expT(sigma)})${Math.abs(sigma) > 1e-9 ? (sigma < 0 ? ", so the state spirals in" : ", so the state spirals out") : ": no growth or decay, so the state goes round a closed loop"}; the imaginary part ${sfmt(omega)} rad/s sets the turning speed, one turn every ${sfmt((2 * Math.PI) / omega, 2)} s.`;
  } else if (e.kind === "repeated") {
    step4 = `${discrete ? "Φ" : "A"} has one repeated eigenvalue, ${unitOf(md)} = ${sfmt(e.values[0])}, with only one eigen-direction ${v2(e.vectors[0])} (dashed). Starting on it the state stays on it; any other start curves towards it.`;
  } else {
    step4 = `${discrete ? "Φ" : "A"} is ${sfmt(e.values[0])} times the identity: every direction is an eigen-direction, so every start moves in a straight line.`;
  }
  const stab = md.stab;
  const rule = discrete ? "inside the unit circle, |z| < 1" : "in the left half-plane, real part < 0";
  const step5 = `The eigenvalues of ${discrete ? "Φ" : "A"} are the poles of the system, the × marks bottom right: ${polesText(ps)}. A system is stable when every pole lies ${rule}. ${stab === "stable" ? "Here they all do, so every start returns to rest." : stab === "unstable" ? "Here one does not, so almost every start runs away." : "Here a pole sits on the edge, so the motion neither dies away nor grows (or it drifts at a constant rate)."}${discrete ? ` Sampling maps each pole s of A to z = e^(sT): ${polesText(poles(md.sys.A))} become ${polesText(md.open)}.` : ""}`;
  const eq = md.eq;
  const step6 = (() => {
    const dc = tf.den.reduce((s, a) => s + a, 0);
    const G0 = discrete ? (Math.abs(dc) > 1e-12 ? tf.num.reduce((s, a) => s + a, 0) / dc : null)
      : (Math.abs(tf.den[tf.den.length - 1]) > 1e-12 ? tf.num[tf.num.length - 1] / tf.den[tf.den.length - 1] : null);
    if (!eq || G0 === null) return `Now the input is a unit step, u = 1 from t = 0, and x(0) = 0. There is no resting point for a constant input: ${discrete ? "Φ has an eigenvalue at 1" : "A has an eigenvalue at 0"}, so the state keeps drifting and the output y grows without limit.`;
    return `Now the input is a unit step, u = 1 from t = 0, starting from rest. The arrows now point towards a new resting point (+), where ${discrete ? "x = Φx + Γ, so x = (I − Φ)⁻¹Γ" : "0 = Ax + B, so x = −A⁻¹B"} = ${v2(eq)}. ${stab === "stable" ? `The state settles there and the output settles at y = ${sfmt(G0)}, the steady-state gain G(${discrete ? "1" : "0"}).` : `But the system is not stable, so the state ${stab === "unstable" ? "runs away from it" : "does not settle there"}.`}`;
  })();
  const zText = zeros.length ? ` It has a zero at ${S} = ${zeros.map((z) => poleText(z)).join(", ")} (○), a root of the numerator${(!md.ctrb || !md.obsv) ? "" : ", where G = 0"}.` : " It has no zeros.";
  const cancel = !md.ctrb ? " The input cannot reach one mode (the system is not controllable), so that pole cancels against a zero and G looks first order." : !md.obsv ? " The output cannot see one mode (the system is not observable), so that pole cancels against a zero and G looks first order." : "";
  const step7 = `From input to output the states drop out: Y(${S}) = G(${S})U(${S}) with G(${S}) = C(${S}I − ${discrete ? "Φ" : "A"})⁻¹${discrete ? "Γ" : "B"} + D = (${polyVar(tf.num, S)}) / (${polyVar(tf.den, S)}). Its denominator is the characteristic polynomial det(${S}I − ${discrete ? "Φ" : "A"}), so its poles are the eigenvalues.${zText}${cancel}`;
  const Ks = stepGain(md);
  const step8 = (() => {
    const lbl = discrete ? "Φ − ΓK" : "A − BK";
    if (!feedback) return `Feed the state back: u = −Kx + r with K = (k₁, k₂). The system becomes ${discrete ? "x[k+1]" : "x′"} = (${lbl})x + ${discrete ? "Γ" : "B"}r, and the poles move. Set the two Feedback gain sliders (Next step ▶ chose K = ${v2(Ks)}).`;
    const cl = polesText(ps), ol = polesText(md.open);
    return `Feed the state back: u = −Kx + r with K = ${vecText(K, 1)}. The system becomes ${discrete ? "x[k+1]" : "x′"} = (${lbl})x + ${discrete ? "Γ" : "B"}r with ${lbl} = ${matText(md.M)}, and its poles move from ${ol} (faint ×) to ${cl} (bold ×), which ${md.stab === "stable" ? "are all stable" : "are not all stable"}.${!md.ctrb ? " One pole has not moved and cannot: the input never reaches that mode." : " With two gains and a controllable system the two poles can be put anywhere (in conjugate pairs)."} The zeros stay where they were.`;
  })();
  return [
    { title: "The state is a point", text: `This system has two states, ${n1} and ${n2}, so its state is a point in the plane (the circle marks x(0) = ${v2(x0)}). Knowing the state now, and the input from now on, is enough to work out the whole future: nothing else about the past matters.` },
    { title: discrete ? "One step at a time" : "The state equation is a field of arrows", text: step2 },
    { title: "Follow the arrows", text: step3 },
    { title: e.kind === "real" ? "Modes: the straight-line solutions" : "Modes", text: step4 },
    { title: "Poles are eigenvalues", text: step5 },
    { title: "Add an input", text: step6 },
    { title: "Input to output: the transfer function", text: step7 },
    { title: "Feedback moves the poles", text: step8 },
  ];
}

function mergeParams(params) {
  return Array.isArray(params) && params.length > 0 ? params : DEFAULT_PARAMS;
}

/** A "nice" grid step for a span. */
export function niceStep(span) {
  const raw = span / 6, p = 10 ** Math.floor(Math.log10(raw)), f = raw / p;
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p;
}

/** The plane's view: centre and half-height (in state units) holding the motion, x(0), the resting point and the origin. */
export function planeView(md) {
  const pts = [...md.sim.x, md.x0, [0, 0]];
  if (md.eq) pts.push(md.eq);
  if (md.cont) pts.push(...md.cont.x);
  if (md.input === INPUTS[2] && !md.discrete) pts.push(md.x0.map((v, i) => v + md.sys.B[i]));
  const fin = pts.filter((p) => p.every(Number.isFinite));
  const xs = fin.map((p) => p[0]), ys = fin.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const half = Math.max(0.6, 0.58 * Math.max(x1 - x0, ((y1 - y0) * HGT) / PW));
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, half };
}

function mountStatePlane(ctx, uid) {
  const spec = ctx.spec ?? {};
  const { doc, root } = buildFrame(ctx.container, spec);
  const params = mergeParams(spec.params);
  const panel = buildControlPanel(doc, root, params, (state, key) => {
    // A new system starts afresh: no feedback, and the walk-through from the top.
    if (key === "system") { panel.update({ k1: 0, k2: 0 }); stepIndex = -1; play = null; stopPlay(); }
    schedule();
  });
  let stepIndex = -1;
  let play = null; // fraction of the time span drawn, or null for all of it
  const ticker = makeTicker(() => {
    play = play === null ? 0 : play + 1 / 150;
    if (play >= 1) { play = null; stopPlay(); }
    schedule();
  }, 40);
  const startPlay = () => { play = 0; ticker.start(); setPressed(true); };
  const stopPlay = () => { ticker.stop(); setPressed(false); };
  let actions = null;
  const setPressed = (on) => { if (actions) actions.buttons[2].setAttribute("aria-pressed", on ? "true" : "false"); };
  const go = (i) => {
    stepIndex = i;
    let md = model(panel.state);
    if (i === 0) {
      panel.update({ input: INPUTS[0], k1: 0, k2: 0 });
      if (Math.abs(Number(panel.state.x1)) + Math.abs(Number(panel.state.x2)) < 1e-9) panel.update({ x1: 1, x2: 0 });
    }
    if (i === 2) startPlay();
    if (i === 3) {
      panel.update({ input: INPUTS[0], k1: 0, k2: 0 });
      md = model(panel.state);
      const c = modeChoice(md);
      if (c >= 0) { const [a, b] = onEigenLine(md, c); panel.update({ x1: a, x2: b }); }
      startPlay();
    }
    if (i === 5) { panel.update({ input: INPUTS[1], x1: 0, x2: 0, k1: 0, k2: 0 }); startPlay(); }
    if (i === 7) {
      md = model(panel.state);
      const [a, b] = stepGain(md);
      panel.update({ k1: a, k2: b });
      startPlay();
    }
    if (![2, 3, 5, 7].includes(i)) { play = null; stopPlay(); }
    redraw();
  };
  actions = buildActions(doc, root, [
    { label: "◀ Back", secondary: true, onClick: () => go(Math.max(0, stepIndex - 1)) },
    { label: "Next step ▶", onClick: () => go(Math.min(7, stepIndex + 1)) },
    { label: "Play ▶", secondary: true, onClick: () => { if (ticker.running()) { stopPlay(); play = null; schedule(); } else startPlay(); } },
  ]);
  const stage = buildStage(doc, root, W, HGT,
    "A system with two states: the state plane with the velocity arrows and the path of the state, the states and output against time, and the poles and zeros");
  const walk = doc.createElement("p");
  walk.className = "zs-walk";
  root.appendChild(walk);
  const readout = buildReadout(doc, root);
  const svg = stage.svg;
  let destroyed = false, pending = false;

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
  const arrowPath = (p, q, head = 7) => {
    const dx = q[0] - p[0], dy = q[1] - p[1], len = Math.hypot(dx, dy);
    if (len < 1) return "";
    const ux = dx / len, uy = dy / len, s = Math.min(head, len / 2);
    const a = [q[0] - s * ux + 0.5 * s * uy, q[1] - s * uy - 0.5 * s * ux];
    const b = [q[0] - s * ux - 0.5 * s * uy, q[1] - s * uy + 0.5 * s * ux];
    return `${poly([p, q])} M${a[0].toFixed(1)} ${a[1].toFixed(1)} L${q[0].toFixed(1)} ${q[1].toFixed(1)} L${b[0].toFixed(1)} ${b[1].toFixed(1)}`;
  };
  const shownCount = (md) => {
    const n = md.sim.t.length;
    return play === null ? n : Math.max(1, Math.min(n, Math.floor(play * (n - 1)) + 1));
  };

  function drawPlane(md) {
    const view = planeView(md);
    const g = add(svg, "g", { class: `zs-panel${[0, 1, 2, 3, 5].includes(stepIndex) ? " zs-focus" : ""}` });
    add(g, "rect", { x: 0, y: 0, width: PW, height: HGT, class: "zs-frame" });
    const sc = (HGT / 2 - 18) / view.half;
    const S = (p) => [PW / 2 + sc * (p[0] - view.cx), HGT / 2 - sc * (p[1] - view.cy)];
    const xl = view.cx - PW / 2 / sc, xr = view.cx + PW / 2 / sc, yb = view.cy - HGT / 2 / sc, yt = view.cy + HGT / 2 / sc;
    const clip = add(g, "clipPath", { id: `ss-clip-${uid}` });
    add(clip, "rect", { x: 1, y: 1, width: PW - 2, height: HGT - 2 });
    const body = add(g, "g", { "clip-path": `url(#ss-clip-${uid})` });
    const st = niceStep(2 * view.half);
    for (let v = Math.ceil(xl / st) * st; v <= xr; v += st) if (Math.abs(v) > st / 2) add(body, "path", { d: poly([S([v, yb]), S([v, yt])]), class: "zs-grid" });
    for (let v = Math.ceil(yb / st) * st; v <= yt; v += st) if (Math.abs(v) > st / 2) add(body, "path", { d: poly([S([xl, v]), S([xr, v])]), class: "zs-grid" });
    add(body, "path", { d: poly([S([xl, 0]), S([xr, 0])]), class: "zs-axis" });
    add(body, "path", { d: poly([S([0, yb]), S([0, yt])]), class: "zs-axis" });
    // The arrow field.
    const n = 15, cell = PW / n;
    const pts = [];
    let top = 0;
    for (let i = 0; i < n; i++) for (let j = 0; j < Math.round(HGT / cell); j++) {
      const px = [(i + 0.5) * cell, (j + 0.5) * cell];
      const p = [view.cx + (px[0] - PW / 2) / sc, view.cy - (px[1] - HGT / 2) / sc];
      const f = mv(md.M, p).map((v, k) => v + md.Bm[k] * md.r - (md.discrete ? p[k] : 0));
      const sp = Math.hypot(f[0], f[1]);
      top = Math.max(top, sp);
      pts.push({ px, f, sp });
    }
    for (const q of pts) {
      if (q.sp < 1e-12 * Math.max(1, top)) continue;
      const len = 0.42 * cell;
      const d = [q.f[0] / q.sp, -q.f[1] / q.sp];
      const a = [q.px[0] - d[0] * len, q.px[1] - d[1] * len], b = [q.px[0] + d[0] * len, q.px[1] + d[1] * len];
      add(body, "path", { d: arrowPath(a, b, 5), class: "ss-field", "stroke-opacity": (0.2 + 0.65 * Math.sqrt(q.sp / (top || 1))).toFixed(2) });
    }
    // Eigen-directions through the resting point.
    const base = md.eq ?? [0, 0];
    if (md.e.kind === "real" || md.e.kind === "repeated") {
      md.e.vectors.forEach((u, i) => {
        const R = 4 * view.half;
        add(body, "path", { d: poly([S([base[0] - R * u[0], base[1] - R * u[1]]), S([base[0] + R * u[0], base[1] + R * u[1]])]), class: `eg-eigline eg-e${i}` });
        // Label where the line leaves the view, on the side with more room.
        let tx = 0.8 * view.half;
        const tip = S([base[0] + tx * u[0], base[1] + tx * u[1]]);
        const inside = tip[0] > 30 && tip[0] < PW - 30 && tip[1] > 44 && tip[1] < HGT - 20;
        const lp = inside ? tip : S([base[0] - tx * u[0], base[1] - tx * u[1]]);
        text(body, lp[0] + 6, lp[1] - 6, `${unitOf(md)} = ${sfmt(md.e.values[i])}`, `sim-label eg-lab eg-e${i}`, "start");
      });
    }
    // The continuous motion behind the samples.
    if (md.cont) add(body, "path", { d: poly(md.cont.x.map(S)), class: "ss-traj ss-traj--faint" });
    // The motion.
    const k = shownCount(md);
    const xs = md.sim.x.slice(0, k);
    if (md.input === INPUTS[2] && !md.discrete) {
      add(body, "path", { d: arrowPath(S(md.x0), S(md.sim.x[0]), 6), class: "ss-jump" });
      const m = S(md.x0.map((v, i) => (v + md.sim.x[0][i]) / 2));
      text(body, m[0] + 6, m[1], "impulse: x jumps by B", "sim-label zs-hint", "start");
    }
    if (md.discrete) {
      add(body, "path", { d: poly(xs.map(S)), class: "ss-traj ss-traj--steps" });
      xs.forEach((p) => { const q = S(p); add(body, "circle", { cx: q[0].toFixed(1), cy: q[1].toFixed(1), r: 2.6, class: "ss-sample" }); });
    } else {
      add(body, "path", { d: poly(xs.map(S)), class: "ss-traj" });
      const dt = md.sim.t[1] - md.sim.t[0];
      const every = Math.max(1, Math.round(1 / dt));
      for (let i = every; i < k; i += every) { const q = S(md.sim.x[i]); add(body, "circle", { cx: q[0].toFixed(1), cy: q[1].toFixed(1), r: 2, class: "ss-tick" }); }
    }
    const x0p = S(md.x0);
    add(body, "circle", { cx: x0p[0].toFixed(1), cy: x0p[1].toFixed(1), r: 5, class: "ss-x0" });
    text(body, x0p[0] + 8, x0p[1] + 14, md.discrete ? "x[0]" : "x(0)", "sim-label", "start");
    if (md.r && md.eq) {
      const e = S(md.eq);
      add(body, "path", { d: `M${(e[0] - 7).toFixed(1)} ${e[1].toFixed(1)} h14 M${e[0].toFixed(1)} ${(e[1] - 7).toFixed(1)} v14`, class: "ss-eq" });
      text(body, e[0] + 8, e[1] - 8, "rest", "sim-label zs-hint", "start");
    }
    if (play !== null || k < md.sim.t.length) {
      const q = S(xs[xs.length - 1]);
      add(body, "circle", { cx: q[0].toFixed(1), cy: q[1].toFixed(1), r: 6, class: "ss-now" });
    }
    add(g, "rect", { x: 4, y: 4, width: 300, height: 36, class: "ss-caption" });
    text(g, 10, 18, md.discrete ? "arrows: where one sample period moves the state" : "arrows: the velocity x′ of the state", "sim-label", "start");
    text(g, 10, 34, md.discrete ? "dots: the samples x[k]" : "curve: the state's path, a dot every second", "sim-label", "start");
    text(g, PW - 8, HGT - 24, `→ ${md.sys.states[0]}`, "sim-label zs-hint", "end");
    text(g, PW - 8, HGT - 9, `↑ ${md.sys.states[1]}`, "sim-label zs-hint", "end");
    text(g, 10, HGT - 9, `grid: ${sfmt(st)}`, "sim-label zs-hint", "start");
  }

  function drawTime(md) {
    const g = add(svg, "g", { class: `zs-panel${[2, 3, 5].includes(stepIndex) ? " zs-focus" : ""}` });
    add(g, "rect", { x: RX, y: 0, width: RW, height: RH, class: "zs-frame" });
    text(g, RX + RW / 2, 16, md.discrete ? "states and output, sample by sample (t in s)" : "states and output against time (s)");
    const { t, x, y } = md.sim;
    const end = t[t.length - 1];
    const vals = [0, ...x.flat(), ...y].filter(Number.isFinite);
    let lo = Math.min(...vals), hi = Math.max(...vals);
    if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
    const pad = 0.08 * (hi - lo); lo -= pad; hi += pad;
    const left = RX + 36, right = RX + RW - 10, topY = 26, botY = RH - 24;
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
    const series = [[y, "ss-y"], [x.map((p) => p[0]), "ss-x1"], [x.map((p) => p[1]), "ss-x2"]];
    for (const [vs, cls] of series) {
      const pts = vs.slice(0, k).map((v, i) => [X(t[i]), Y(v)]);
      if (md.discrete) {
        add(g, "path", { d: poly(pts), class: `ss-line ${cls} ss-line--steps` });
        for (const p of pts) add(g, "circle", { cx: p[0].toFixed(1), cy: p[1].toFixed(1), r: 1.8, class: `ss-dot ${cls}` });
      } else add(g, "path", { d: poly(pts), class: `ss-line ${cls}` });
    }
    if (play !== null) add(g, "path", { d: `M${X(t[k - 1]).toFixed(1)} ${topY} V${botY}`, class: "zs-probe-line" });
    text(g, left + 4, topY + 10, "x₁", "sim-label ss-x1-text", "start");
    text(g, left + 24, topY + 10, "x₂", "sim-label ss-x2-text", "start");
    text(g, left + 44, topY + 10, "y (thick)", "sim-label ss-y-text", "start");
  }

  function drawPoles(md) {
    const g = add(svg, "g", { class: `zs-panel${[4, 6, 7].includes(stepIndex) ? " zs-focus" : ""}` });
    const y0 = RH + 10;
    add(g, "rect", { x: RX, y: y0, width: RW, height: RH, class: "zs-frame" });
    text(g, RX + RW / 2, y0 + 16, md.discrete ? "poles × and zeros ○ in the z-plane" : "poles × and zeros ○ in the s-plane");
    const all = [...md.ps, ...md.open, ...md.zeros];
    let R = Math.max(md.discrete ? 1.25 : 1.5, ...all.map((p) => 1.18 * Math.hypot(p.re, p.im)));
    R = Math.min(R, 40);
    const cx = RX + RW / 2, cy = y0 + 26 + (RH - 40) / 2, sc = (RH - 44) / 2 / R;
    const P = (p) => [cx + sc * p.re, cy - sc * p.im];
    const clip = add(g, "clipPath", { id: `ss-pclip-${uid}` });
    add(clip, "rect", { x: RX + 1, y: y0 + 22, width: RW - 2, height: RH - 24 });
    const body = add(g, "g", { "clip-path": `url(#ss-pclip-${uid})` });
    const xl = RX + 1, xr = RX + RW - 1, yt = y0 + 22, yb = y0 + RH - 1;
    if (md.discrete) {
      const r = sc;
      add(body, "rect", { x: xl, y: yt, width: xr - xl, height: yb - yt, class: "ss-unstable" });
      add(body, "circle", { cx: cx.toFixed(1), cy: cy.toFixed(1), r: r.toFixed(1), class: "ss-stable-disc" });
      add(body, "circle", { cx: cx.toFixed(1), cy: cy.toFixed(1), r: r.toFixed(1), class: "zs-ucircle" });
    } else {
      add(body, "rect", { x: cx.toFixed(1), y: yt, width: (xr - cx).toFixed(1), height: yb - yt, class: "ss-unstable" });
    }
    add(body, "path", { d: `M${xl} ${cy.toFixed(1)} H${xr}`, class: "zs-axis" });
    add(body, "path", { d: `M${cx.toFixed(1)} ${yt} V${yb}`, class: "zs-axis" });
    const st = niceStep(3 * R);
    for (let v = st; v <= R * 1.6; v += st) for (const sgn of [-1, 1]) {
      const px = cx + sgn * v * sc;
      if (px < xl + 8 || px > xr - 8) continue;
      add(body, "path", { d: `M${px.toFixed(1)} ${cy.toFixed(1)} v3`, class: "zs-axis" });
      text(body, px, cy + 14, sfmt(sgn * v, 2), "sim-label zs-hint");
    }
    text(body, xr - 4, yb - 6, md.discrete ? "outside |z| = 1: unstable" : "right half: unstable", "sim-label zs-hint", "end");
    const cross = (p, cls, s = 6) => { const [x, y] = P(p); add(body, "path", { d: `M${x - s} ${y - s} L${x + s} ${y + s} M${x - s} ${y + s} L${x + s} ${y - s}`, class: cls }); };
    if (md.feedback) for (const p of md.open) cross(p, "ss-pole ss-pole--open", 5);
    for (const p of md.ps) cross(p, "ss-pole");
    for (const z of md.zeros) { const [x, y] = P(z); add(body, "circle", { cx: x.toFixed(1), cy: y.toFixed(1), r: 5, class: "zs-zero" }); }
    // Labels: one per real pole, one per pair (at the upper one).
    const used = [];
    for (const p of md.ps) {
      if (p.im < -1e-12) continue;
      const [x, y] = P(p);
      let ly = y - 10;
      while (used.some((u) => Math.abs(u[0] - x) < 70 && Math.abs(u[1] - ly) < 12)) ly -= 13;
      used.push([x, ly]);
      const anchor = x > xr - 70 ? "end" : x < xl + 70 ? "start" : "middle";
      text(body, x, ly, poleText(p), "sim-label ss-pole-text", anchor);
    }
  }

  function redraw() {
    if (destroyed) return;
    const s = panel.state;
    const md = model(s);
    stage.clear();
    drawPlane(md);
    drawTime(md);
    drawPoles(md);
    const steps = walkSteps(md);
    walk.textContent = stepIndex < 0
      ? "Press Next step ▶ to walk through the system one idea at a time."
      : `Step ${stepIndex + 1} of ${steps.length}: ${steps[stepIndex].title}. ${steps[stepIndex].text}`;
    actions.buttons[0].disabled = stepIndex <= 0;
    actions.buttons[1].disabled = stepIndex >= steps.length - 1;
    const { sys } = md;
    const S = md.discrete ? "z" : "s";
    const last = md.sim.x[md.sim.x.length - 1], tl = md.sim.t[md.sim.t.length - 1];
    const parts = [
      `${sys.name}: x′ = Ax + Bu, y = Cx with A = ${matText(sys.A)}, B = ${vecText(sys.B, 0)}, C = ${vecText(sys.C, 0)}.`,
      md.discrete ? `Sampled every ${sfmt(md.T)} s: Φ = ${matText(md.Phi)}, Γ = ${v2(md.Gamma)}.` : "",
      md.feedback ? `Feedback K = ${vecText(md.K, 1)}: ${md.discrete ? "Φ − ΓK" : "A − BK"} = ${matText(md.M)}.` : "",
      `Poles ${polesText(md.ps)}: ${md.stab}.`,
      `G(${S}) = (${polyVar(md.tf.num, S)}) / (${polyVar(md.tf.den, S)}).`,
      `${md.ctrb ? "Controllable" : "Not controllable"}, ${md.obsv ? "observable" : "not observable"}.`,
      `At t = ${sfmt(tl, 2)} s: x = ${v2(last)}, y = ${fmt(md.sim.y[md.sim.y.length - 1], 3)}.`,
    ];
    readout.textContent = parts.filter(Boolean).join(" ");
  }

  redraw();
  return {
    update(partial) { if (panel.update(partial)) redraw(); },
    destroy() {
      destroyed = true;
      ticker.stop();
      panel.destroy();
      actions.destroy();
    },
  };
}

let uidCounter = 0;
registerWidget("state-plane", (ctx) => mountStatePlane(ctx, ++uidCounter));
