// src/widgets/types/fft-butterfly.js
//
// `fft-butterfly` — the radix-2 fast Fourier transform of eight samples,
// drawn as its butterfly diagram: the input in bit-reversed order on the left,
// three stages of butterflies, and X[k] in natural order on the right. Every
// node shows its complex value. "Next stage ▶" fills the diagram in one stage
// at a time, outlining the butterflies of that stage, and the walk line says
// what that stage computes. Below: the input x[n] and the magnitudes |X[k]|,
// and the readout compares the cost with the direct DFT for a chosen size.
//
// Params keys, in order: input (select; keys of FFT_INPUTS in
// ../sims/fourier.js), size (select of powers of two, for the cost count
// only). No config. Styled by the .zs-* and .fx-* classes in alexandria.css.

import { registerWidget } from "../registry.js";
import { buildFrame, buildControlPanel, buildActions, buildReadout, buildStage, svgEl } from "../sim-kit.js";
import { FFT_INPUTS, fftStages, dft, opCounts, bitReverse } from "../sims/fourier.js";

export const SIZES = ["8", "64", "1024", "65536", "1048576"];
export const DEFAULT_PARAMS = [
  { key: "input", label: "Input x[n]", control: "select", options: Object.keys(FFT_INPUTS), default: "square: four 1s, four 0s" },
  { key: "size", label: "Count the work for N =", control: "select", options: SIZES, default: "1024" },
];

const W = 760, HD = 360, HB = 150, HGT = HD + HB + 10;
const N = 8;
const SUB = "₀₁₂₃₄₅₆₇₈₉";
const sub = (n) => String(n).replace(/\d/g, (c) => SUB[c]);
const SUP = { 0: "⁰", 1: "¹", 2: "²", 3: "³" };

/** A short complex value: "2", "−j", "1 − 2.41j". */
export function cshort(v) {
  const r = (x) => (Math.abs(x) < 5e-3 ? 0 : Math.round(x * 100) / 100);
  const re = r(v[0]), im = r(v[1]);
  const num = (x) => String(Math.abs(x));
  if (im === 0) return String(re).replace("-", "−");
  const imPart = Math.abs(im) === 1 ? "j" : `${num(im)}j`;
  if (re === 0) return `${im < 0 ? "−" : ""}${imPart}`;
  return `${String(re).replace("-", "−")} ${im < 0 ? "−" : "+"} ${imPart}`;
}

/** What each stage of the walk says, for the chosen input. */
export function stageTexts(name) {
  const x = FFT_INPUTS[name];
  const { stages } = fftStages(x);
  const out = stages[3];
  const direct = dft(x);
  const maxErr = Math.max(...out.map((v, k) => Math.hypot(v[0] - direct[k][0], v[1] - direct[k][1])));
  return [
    { title: "Shuffle into bit-reversed order", text: `The FFT splits the samples into even and odd positions, then splits each half again, until only pairs are left. Doing every split at once puts sample n at position (n written in 3 bits, read backwards): x[1] = x[001₂] goes to 100₂ = 4, x[3] = x[011₂] to 110₂ = 6. So the left column reads x[0], x[4], x[2], x[6], x[1], x[5], x[3], x[7]. Nothing is computed yet.` },
    { title: "Stage 1: four 2-point DFTs", text: "Each butterfly takes two inputs a and b and puts out a + b on top and a − b below. That is the whole DFT of two samples. The twiddle factor here is W₈⁰ = 1, so there is nothing to multiply: four butterflies, no multiplications." },
    { title: "Stage 2: two 4-point DFTs", text: "Now the pairs are combined. Each butterfly multiplies its lower input by a twiddle factor W first, then adds and subtracts: top = a + W·b, bottom = a − W·b. The twiddles are W₈⁰ = 1 and W₈² = −j, a quarter turn. After this stage each block of four holds the 4-point DFT of every other sample (the even ones in the top block, the odd ones in the bottom)." },
    { title: "Stage 3: one 8-point DFT", text: `The last stage joins the even half E[k] and the odd half O[k] with the twiddles W₈⁰, W₈¹, W₈², W₈³ (turns of 0°, −45°, −90°, −135°): X[k] = E[k] + W₈ᵏ·O[k] and X[k + 4] = E[k] − W₈ᵏ·O[k]. The right column is X[0] … X[7] in natural order; it matches the DFT computed straight from its definition to within ${maxErr < 1e-12 ? "rounding (under 10⁻¹²)" : maxErr.toExponential(1)}. Three stages of four butterflies: 12 multiplications by a twiddle (7 of them by W₈⁰ = 1, which cost nothing) against 64 for the definition.` },
  ];
}

function mergeParams(params) {
  return Array.isArray(params) && params.length > 0 ? params : DEFAULT_PARAMS;
}

function mountFft(ctx) {
  const spec = ctx.spec ?? {};
  const { doc, root } = buildFrame(ctx.container, spec);
  const panel = buildControlPanel(doc, root, mergeParams(spec.params), () => redraw());
  let shown = 0; // stages filled in: 0 = only the shuffled input
  let walkOn = false;
  const actions = buildActions(doc, root, [
    { label: "◀ Back", secondary: true, onClick: () => { shown = Math.max(0, shown - 1); walkOn = true; redraw(); } },
    { label: "Next stage ▶", onClick: () => { if (walkOn) shown = Math.min(3, shown + 1); walkOn = true; redraw(); } },
    { label: "Show all", secondary: true, onClick: () => { shown = 3; walkOn = true; redraw(); } },
  ]);
  const stage = buildStage(doc, root, W, HGT,
    "Butterfly diagram of an 8-point radix-2 FFT, with the input samples and the output magnitudes below");
  const walk = doc.createElement("p");
  walk.className = "zs-walk";
  root.appendChild(walk);
  const readout = buildReadout(doc, root);
  const svg = stage.svg;

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

  function drawDiagram(stages, butterflies) {
    const g = add(svg, "g", { class: "zs-panel" });
    add(g, "rect", { x: 0, y: 0, width: W, height: HD, class: "zs-frame" });
    const colX = [100, 290, 480, 670];
    const rowY = (i) => 46 + i * 39;
    const bw = 92, bh = 22;
    text(g, colX[0], 22, "input, bit-reversed");
    text(g, colX[1], 22, "after stage 1");
    text(g, colX[2], 22, "after stage 2");
    text(g, colX[3], 22, "output X[k]");
    // Butterfly wires, stage by stage.
    for (const b of butterflies) {
      const xa = colX[b.stage - 1] + bw / 2, xb = colX[b.stage] - bw / 2;
      const on = b.stage <= shown;
      const focus = walkOn && b.stage === shown;
      const cls = `fx-wire${on ? "" : " fx-wire--off"}${focus ? " fx-wire--focus" : ""}`;
      const yt = rowY(b.top), yb = rowY(b.bottom);
      add(g, "path", { d: `M${xa} ${yt} L${xb} ${yt} M${xa} ${yb} L${xb} ${yb} M${xa} ${yt} L${xb} ${yb} M${xa} ${yb} L${xb} ${yt}`, class: cls });
      if (on || focus) {
        text(g, xa + 8, yb - 4, `W${sub(8)}${SUP[b.twiddle]}`, "sim-label fx-twiddle", "start");
        text(g, xb - 10, yb + 13, "−", "sim-label fx-twiddle", "end");
      }
    }
    // Nodes.
    for (let c = 0; c < 4; c++) {
      for (let i = 0; i < N; i++) {
        const x = colX[c], y = rowY(i);
        const known = c <= shown;
        add(g, "rect", { x: x - bw / 2, y: y - bh / 2, width: bw, height: bh, rx: 4, class: `fx-node${known ? "" : " fx-node--off"}` });
        text(g, x, y + 4, known ? cshort(stages[c][i]) : "?", "sim-label");
      }
    }
    for (let i = 0; i < N; i++) {
      text(g, colX[0] - bw / 2 - 6, rowY(i) + 4, `x[${bitReverse(i, 3)}]`, "sim-label zs-hint", "end");
      text(g, colX[3] + bw / 2 + 6, rowY(i) + 4, `X[${i}]`, "sim-label zs-hint", "start");
    }
  }

  function drawBars(values, x0, y0, wd, ht, title, mag) {
    const g = add(svg, "g", { class: "zs-panel" });
    add(g, "rect", { x: x0, y: y0, width: wd, height: ht, class: "zs-frame" });
    text(g, x0 + wd / 2, y0 + 16, title);
    const vals = values.map((v) => (mag ? Math.hypot(v[0], v[1]) : v));
    const m = Math.max(1e-9, ...vals.map((v) => Math.abs(v)));
    const anyNeg = vals.some((v) => v < -1e-9);
    const left = x0 + 30, right = x0 + wd - 20, topY = y0 + 28, botY = y0 + ht - 22;
    const base = anyNeg ? (topY + botY) / 2 : botY;
    const span = anyNeg ? (botY - topY) / 2 : botY - topY;
    add(g, "path", { d: `M${left} ${base} H${right}`, class: "zs-axis" });
    for (let i = 0; i < N; i++) {
      const x = left + ((i + 0.5) / N) * (right - left), y = base - (vals[i] / m) * span;
      add(g, "path", { d: `M${x.toFixed(1)} ${base} V${y.toFixed(1)}`, class: "fx-stem" });
      add(g, "circle", { cx: x.toFixed(1), cy: y.toFixed(1), r: 3, class: "fx-dot" });
      text(g, x, y0 + ht - 6, String(i));
    }
    text(g, left - 4, topY + 4, (Math.round(m * 100) / 100).toString(), "sim-label", "end");
  }

  function redraw() {
    const s = panel.state;
    const name = FFT_INPUTS[String(s.input)] ? String(s.input) : Object.keys(FFT_INPUTS)[0];
    const x = FFT_INPUTS[name];
    const { stages, butterflies } = fftStages(x);
    stage.clear();
    drawDiagram(stages, butterflies);
    const half = (W - 10) / 2;
    drawBars(x, 0, HD + 10, half, HB, "input x[n]", false);
    drawBars(stages[3], half + 10, HD + 10, half, HB, "output |X[k]|", true);
    const texts = stageTexts(name);
    walk.textContent = walkOn
      ? `Step ${shown + 1} of 4: ${texts[shown].title}. ${texts[shown].text}`
      : "Press Next stage ▶ to fill the diagram in one stage at a time.";
    actions.buttons[0].disabled = !walkOn || shown <= 0;
    actions.buttons[1].disabled = walkOn && shown >= 3;
    const size = Number(s.size) || 1024;
    const c = opCounts(size);
    readout.textContent = `X[k] = ${stages[3].map(cshort).join(", ")}. For N = ${size.toLocaleString("en-US")}: the definition takes N² = ${c.direct.toLocaleString("en-US")} complex multiplications, the FFT (N/2)·log₂N = ${c.fft.toLocaleString("en-US")}, ${Math.round(c.direct / c.fft).toLocaleString("en-US")} times fewer.`;
  }

  redraw();
  return {
    update(partial) { if (panel.update(partial)) redraw(); },
    destroy() { panel.destroy(); actions.destroy(); },
  };
}

registerWidget("fft-butterfly", (ctx) => mountFft(ctx));
