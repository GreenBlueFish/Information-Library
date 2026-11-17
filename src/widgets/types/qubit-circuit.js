// src/widgets/types/qubit-circuit.js
//
// `qubit-circuit` — a two-qubit circuit sandbox. Each of five time steps has a
// select for qubit 1 and one for qubit 2. Single-qubit gates (H, X, Y, Z, S, T,
// Rx(π/2), Ry(π/2)) act independently; a "●" on one wire and a "⊕" on the other
// in the same step is a CNOT. Starting from |00>, the widget draws the circuit,
// the outcome probabilities of |00>, |01>, |10>, |11> with their amplitudes, and
// reports whether the result is entangled (entropy of qubit 1's reduced state).
//
// Params keys, in order: q1s1 … q1s5, q2s1 … q2s5 (selects over GATE_OPTIONS).
// The maths is in ../sims/quantum.js (runCircuit, entanglementEntropy).

import { registerWidget } from "../registry.js";
import { buildFrame, buildControlPanel, buildReadout, buildStage, svgEl } from "../sim-kit.js";
import { runCircuit, entanglementEntropy } from "../sims/quantum.js";

export const GATE_OPTIONS = ["—", "H", "X", "Y", "Z", "S", "T", "Rx(π/2)", "Ry(π/2)", "●", "⊕"];
export const STEPS = 5;

const DEFAULT_PARAMS = [];
for (const q of [1, 2])
  for (let k = 1; k <= STEPS; k++)
    DEFAULT_PARAMS.push({
      key: `q${q}s${k}`,
      label: `Qubit ${q}, step ${k}`,
      control: "select",
      options: GATE_OPTIONS,
      default: q === 1 && k === 1 ? "H" : k === 2 ? (q === 1 ? "●" : "⊕") : "—",
    });

const W = 640, HGT = 330;
const BASIS = ["|00⟩", "|01⟩", "|10⟩", "|11⟩"];

/** Columns [[gate on qubit 1, gate on qubit 2], …] from the control state. */
export function columnsFrom(state) {
  const cols = [];
  for (let k = 1; k <= STEPS; k++) cols.push([String(state[`q1s${k}`] ?? "—"), String(state[`q2s${k}`] ?? "—")]);
  return cols;
}

function mergeParams(params) {
  return Array.isArray(params) && params.length > 0 ? params : DEFAULT_PARAMS;
}

function mountCircuit(ctx) {
  const spec = ctx.spec ?? {};
  const { doc, root } = buildFrame(ctx.container, spec);
  const panel = buildControlPanel(doc, root, mergeParams(spec.params), () => redraw());
  const stage = buildStage(doc, root, W, HGT, "Two-qubit circuit and the probabilities of its four outcomes");
  const readout = buildReadout(doc, root);
  let destroyed = false;

  const add = (name, attrs, text) => {
    const el = svgEl(doc, name, attrs);
    if (text !== undefined) el.textContent = text;
    stage.svg.appendChild(el);
    return el;
  };

  function redraw() {
    if (destroyed) return;
    const cols = columnsFrom(panel.state);
    const { psi, invalid } = runCircuit(cols);
    stage.clear();

    // --- circuit ---------------------------------------------------------
    const x0 = 70, dx = 100, ys = [40, 100];
    ys.forEach((y, q) => {
      add("text", { x: 20, y: y + 5, class: "sim-label" }, `q${q + 1} |0⟩`);
      add("line", { x1: x0 - 10, y1: y, x2: x0 + dx * STEPS, y2: y, class: "qm-wire" });
    });
    cols.forEach(([g1, g2], k) => {
      const cx = x0 + dx * k + dx / 2;
      const bad = invalid.includes(k);
      const gates = [g1, g2];
      const ci = gates.indexOf("●"), ti = gates.indexOf("⊕");
      if (!bad && ci >= 0 && ti >= 0) add("line", { x1: cx, y1: ys[0], x2: cx, y2: ys[1], class: "qm-wire" });
      gates.forEach((g, q) => {
        const y = ys[q];
        if (g === "—") return;
        if (g === "●") add("circle", { cx, cy: y, r: 6, class: bad ? "qm-control qm-invalid" : "qm-control" });
        else if (g === "⊕") {
          add("circle", { cx, cy: y, r: 12, class: bad ? "qm-target qm-invalid" : "qm-target" });
          add("line", { x1: cx - 12, y1: y, x2: cx + 12, y2: y, class: "qm-target-cross" });
          add("line", { x1: cx, y1: y - 12, x2: cx, y2: y + 12, class: "qm-target-cross" });
        } else {
          const w = g.length > 2 ? 64 : 34;
          add("rect", { x: cx - w / 2, y: y - 17, width: w, height: 34, rx: 4, class: "qm-gate" });
          add("text", { x: cx, y: y + 5, class: "sim-label", "text-anchor": "middle" }, g);
        }
      });
      if (bad) add("text", { x: cx, y: ys[1] + 32, class: "sim-label qm-invalid-text", "text-anchor": "middle" }, "needs ● and ⊕");
    });

    // --- outcome probabilities ------------------------------------------
    const by = 170, bh = 120, bw = 90;
    for (let i = 0; i < 4; i++) {
      const re = psi[2 * i], im = psi[2 * i + 1];
      const p = re * re + im * im;
      const x = 90 + i * 130;
      add("rect", { x, y: by, width: bw, height: bh, class: "sim-cell" });
      add("rect", { x, y: (by + bh * (1 - p)).toFixed(1), width: bw, height: (bh * p).toFixed(1), class: "sim-bar" });
      add("text", { x: x + bw / 2, y: by + bh + 18, class: "sim-label", "text-anchor": "middle" }, `${BASIS[i]}  P = ${p.toFixed(2)}`);
      const a = (v) => (Math.abs(v) < 5e-4 ? 0 : v);
      const amp = a(im) === 0 ? a(re).toFixed(2) : a(re) === 0 ? `${a(im).toFixed(2)}i` : `${a(re).toFixed(2)}${a(im) < 0 ? "−" : "+"}${Math.abs(a(im)).toFixed(2)}i`;
      add("text", { x: x + bw / 2, y: by - 8, class: "sim-label", "text-anchor": "middle" }, `amp ${amp}`);
    }

    const { entropy } = entanglementEntropy(psi);
    const z1 = psi[0] ** 2 + psi[1] ** 2 + psi[2] ** 2 + psi[3] ** 2 - (psi[4] ** 2 + psi[5] ** 2 + psi[6] ** 2 + psi[7] ** 2);
    const z2 = psi[0] ** 2 + psi[1] ** 2 + psi[4] ** 2 + psi[5] ** 2 - (psi[2] ** 2 + psi[3] ** 2 + psi[6] ** 2 + psi[7] ** 2);
    const ent = entropy < 1e-6 ? "a product state (not entangled)" : entropy > 0.999 ? "maximally entangled" : "partly entangled";
    readout.textContent =
      `⟨Z₁⟩ = ${z1.toFixed(3)}, ⟨Z₂⟩ = ${z2.toFixed(3)}; entanglement entropy of qubit 1 = ${entropy.toFixed(3)} bit: ${ent}.` +
      (invalid.length ? ` Step${invalid.length > 1 ? "s" : ""} ${invalid.map((k) => k + 1).join(", ")} skipped: a CNOT needs one ● and one ⊕ in the same step.` : "");
  }

  redraw();
  return {
    update(partial) { if (panel.update(partial)) redraw(); },
    destroy() { destroyed = true; panel.destroy(); },
  };
}

registerWidget("qubit-circuit", (ctx) => mountCircuit(ctx));
