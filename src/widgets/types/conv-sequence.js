// src/widgets/types/conv-sequence.js
//
// `conv-sequence` — discrete convolution y[n] = Σ_k x[k] h[n − k] of two short
// sequences, shown three ways at once:
//
//   - flip and slide: x[k] as stems, with h[n − k] (h flipped and moved to n)
//     under it, and each product x[k]·h[n − k] written where they meet;
//   - the multiplication table x[k]·h[m], where y[n] is the sum along the
//     anti-diagonal k + m = n (the same table as multiplying polynomials);
//   - the output y[n] as stems, with the current n marked.
//
// "◀ n" and "n ▶" step n; "Play" runs n through every value.
//
// Params keys, in order: x (select; options from SEQUENCE_NAMES in
// ../sims/convolution.js), h (select, same options), n (range, 0–14).
// No config. Styled by the .zs-*, .fx-* and .cv-* classes in alexandria.css.

import { registerWidget } from "../registry.js";
import { buildFrame, buildControlPanel, buildActions, buildReadout, buildStage, svgEl, makeTicker } from "../sim-kit.js";
import { SEQUENCES, SEQUENCE_NAMES, dconv, dterms, nfmt } from "../sims/convolution.js";

export const DEFAULT_PARAMS = [
  { key: "x", label: "Sequence x[n]", control: "select", options: SEQUENCE_NAMES, default: "1, 2, 3" },
  { key: "h", label: "Sequence h[n]", control: "select", options: SEQUENCE_NAMES, default: "1, 1, 1, 1" },
  { key: "n", label: "Output index n", control: "range", min: 0, max: 14, step: 1, default: 2 },
];

const W = 760, HT = 230, HB = 300, HGT = HT + HB;
const KMIN = -7, KMAX = 14;
const SUP = { "-": "⁻", 0: "⁰", 1: "¹", 2: "²", 3: "³", 4: "⁴", 5: "⁵", 6: "⁶", 7: "⁷", 8: "⁸", 9: "⁹" };
const sup = (k) => String(k).split("").map((c) => SUP[c] ?? c).join("");

/** A sequence as a polynomial in z⁻¹, e.g. "1 + 2z⁻¹ + 3z⁻²". */
export function polyText(seq) {
  const parts = [];
  seq.forEach((v, k) => {
    if (Math.abs(v) < 1e-12) return;
    const mag = nfmt(Math.abs(v));
    const coef = k === 0 ? mag : mag === "1" ? "" : mag;
    const term = k === 0 ? coef : `${coef}z${sup(-k)}`;
    parts.push({ neg: v < 0, term });
  });
  if (!parts.length) return "0";
  return parts.map((p, i) => (i === 0 ? (p.neg ? "−" : "") + p.term : `${p.neg ? " − " : " + "}${p.term}`)).join("");
}

/** The sum that makes y[n], written out, e.g. "1·1 + 2·1 = 3". */
export function sumText(x, h, n) {
  const terms = dterms(x, h, n);
  const total = terms.reduce((s, t) => s + t.p, 0);
  if (!terms.length) return `no k has both x[k] and h[${n} − k] inside the sequences, so y[${n}] = 0`;
  return `y[${n}] = ${terms.map((t) => `x[${t.k}]·h[${n - t.k}]`).join(" + ")} = ${terms.map((t) => `${nfmt(t.xk)}·${nfmt(t.hk)}`).join(" + ")} = ${nfmt(total)}`;
}

function mergeParams(params) {
  return Array.isArray(params) && params.length > 0 ? params : DEFAULT_PARAMS;
}

function mountConvSequence(ctx) {
  const spec = ctx.spec ?? {};
  const { doc, root } = buildFrame(ctx.container, spec);
  const params = mergeParams(spec.params);
  const nMax = Number(params.find((p) => p.key === "n")?.max ?? 14);
  const panel = buildControlPanel(doc, root, params, () => redraw());
  const lenY = () => {
    const x = SEQUENCES[String(panel.state.x)] ?? [1], h = SEQUENCES[String(panel.state.h)] ?? [1];
    return x.length + h.length - 1;
  };
  const setN = (n) => { panel.update({ n: Math.max(0, Math.min(nMax, n)) }); redraw(); };
  const ticker = makeTicker(() => {
    const n = Number(panel.state.n);
    setN(n + 1 >= Math.min(nMax + 1, lenY() + 1) ? 0 : n + 1);
  }, 900);
  const actions = buildActions(doc, root, [
    { label: "◀ n", secondary: true, onClick: () => setN(Number(panel.state.n) - 1) },
    { label: "n ▶", onClick: () => setN(Number(panel.state.n) + 1) },
    {
      label: "Play", secondary: true,
      onClick: () => {
        const on = ticker.toggle();
        actions.buttons[2].setAttribute("aria-pressed", on ? "true" : "false");
      },
    },
  ]);
  const stage = buildStage(doc, root, W, HGT,
    "Discrete convolution: x[k] with h flipped and shifted to n, the multiplication table with the anti-diagonal for n, and the output y[n]");
  const readout = buildReadout(doc, root);
  let destroyed = false;
  const svg = stage.svg;
  const add = (parent, name, attrs) => { const el = svgEl(doc, name, attrs); parent.appendChild(el); return el; };
  const text = (parent, x, y, s, cls = "sim-label", anchor = "middle") => {
    const t = add(parent, "text", { x: x.toFixed(1), y: y.toFixed(1), class: cls, "text-anchor": anchor });
    t.textContent = s;
    return t;
  };

  function stems(g, X, Y, seq, off, cls, n0 = 0) {
    seq.forEach((v, i) => {
      const k = n0 + i * (off ?? 1);
      if (k < KMIN || k > KMAX) return;
      add(g, "path", { d: `M${X(k).toFixed(1)} ${Y(0).toFixed(1)} V${Y(v).toFixed(1)}`, class: `cv-stem ${cls}` });
      add(g, "circle", { cx: X(k).toFixed(1), cy: Y(v).toFixed(1), r: 3.5, class: `cv-dot ${cls}` });
    });
  }

  function redraw() {
    if (destroyed) return;
    const x = SEQUENCES[String(panel.state.x)] ?? [1];
    const h = SEQUENCES[String(panel.state.h)] ?? [1];
    const n = Math.round(Number(panel.state.n));
    const y = dconv(x, h);
    stage.clear();

    // Top: flip and slide.
    const g = add(svg, "g", { class: "zs-panel" });
    add(g, "rect", { x: 0, y: 0, width: W, height: HT, class: "zs-frame" });
    text(g, W / 2, 16, `x[k] (top) and h[${n} − k], h flipped and moved to k = ${n} (bottom); products where they meet`);
    const left = 30, right = W - 20;
    const X = (k) => left + ((k - KMIN) / (KMAX - KMIN)) * (right - left);
    let top = 0;
    for (const v of [...x, ...h]) top = Math.max(top, Math.abs(v));
    top = top || 1;
    const hasNeg = [...x, ...h].some((v) => v < 0);
    const rowH = 62;
    const Yx = (v) => 30 + rowH * (hasNeg ? 0.5 : 0.85) - (v / top) * rowH * (hasNeg ? 0.45 : 0.8);
    const Yh = (v) => 30 + rowH + 40 + rowH * (hasNeg ? 0.5 : 0.85) - (v / top) * rowH * (hasNeg ? 0.45 : 0.8);
    add(g, "path", { d: `M${left} ${Yx(0).toFixed(1)} H${right}`, class: "zs-axis" });
    add(g, "path", { d: `M${left} ${Yh(0).toFixed(1)} H${right}`, class: "zs-axis" });
    // Overlap band.
    const terms = dterms(x, h, n);
    if (terms.length) {
      const k0 = terms[0].k, k1 = terms[terms.length - 1].k;
      add(g, "rect", { x: (X(k0) - 9).toFixed(1), y: 24, width: (X(k1) - X(k0) + 18).toFixed(1), height: HT - 44, class: "cv-overlap" });
    }
    stems(g, X, Yx, x, 1, "cv-x");
    stems(g, X, Yh, h, -1, "cv-h", n); // h[n − k] at k = n − m for m = 0, 1, …
    text(g, left - 4, Yx(0) + 4, "x", "sim-label", "end");
    text(g, left - 4, Yh(0) + 4, "h", "sim-label", "end");
    for (let k = KMIN; k <= KMAX; k++) if (k % 2 === 0 || k === n) text(g, X(k), HT - 8, String(k).replace("-", "−"), k === n ? "sim-label" : "sim-label zs-hint");
    for (const tm of terms) text(g, X(tm.k), Yh(0) + 18, nfmt(tm.p), "sim-label cv-prod");
    add(g, "path", { d: `M${X(n).toFixed(1)} 24 V${HT - 20}`, class: "zs-probe-line" });

    // Bottom left: the multiplication table.
    const tb = add(svg, "g", { class: "zs-panel" });
    const tw = 400;
    add(tb, "rect", { x: 0, y: HT + 10, width: tw, height: HB - 10, class: "zs-frame" });
    text(tb, tw / 2, HT + 26, `table of x[k]·h[m]: y[${n}] is the sum where k + m = ${n}`);
    const cell = Math.min(40, (tw - 70) / Math.max(h.length, 1), (HB - 80) / Math.max(x.length, 1));
    const gx = 50, gy = HT + 58;
    h.forEach((v, m) => text(tb, gx + cell * (m + 0.5), gy - 8, nfmt(v), "sim-label cv-h-text"));
    x.forEach((v, k) => text(tb, gx - 8, gy + cell * (k + 0.6), nfmt(v), "sim-label cv-x-text", "end"));
    text(tb, gx - 8, gy - 8, "x \\ h", "sim-label zs-hint", "end");
    x.forEach((xv, k) => h.forEach((hv, m) => {
      const on = k + m === n;
      add(tb, "rect", { x: (gx + cell * m).toFixed(1), y: (gy + cell * k).toFixed(1), width: cell.toFixed(1), height: cell.toFixed(1), class: on ? "cv-cell cv-cell--on" : "cv-cell" });
      text(tb, gx + cell * (m + 0.5), gy + cell * (k + 0.6), nfmt(xv * hv), on ? "sim-label" : "sim-label zs-hint");
    }));

    // Bottom right: the output.
    const ob = add(svg, "g", { class: "zs-panel" });
    const ox0 = tw + 10, ow = W - ox0;
    add(ob, "rect", { x: ox0, y: HT + 10, width: ow, height: HB - 10, class: "zs-frame" });
    text(ob, ox0 + ow / 2, HT + 26, `output y[n]: ${y.length} values = ${x.length} + ${h.length} − 1`);
    const oL = ox0 + 26, oR = W - 14;
    const OX = (k) => oL + ((k + 1) / 16) * (oR - oL);
    let ymin = 0, ymax = 0;
    for (const v of y) { ymin = Math.min(ymin, v); ymax = Math.max(ymax, v); }
    const span = Math.max(ymax - ymin, 1e-9);
    const oT = HT + 48, oB = HGT - 30;
    const OY = (v) => oB - ((v - ymin) / span) * (oB - oT);
    add(ob, "path", { d: `M${oL} ${OY(0).toFixed(1)} H${oR}`, class: "zs-axis" });
    y.forEach((v, k) => {
      if (k > 14) return;
      const on = k === n;
      add(ob, "path", { d: `M${OX(k).toFixed(1)} ${OY(0).toFixed(1)} V${OY(v).toFixed(1)}`, class: on ? "cv-stem cv-out-stem--on" : "cv-stem cv-out-stem" });
      add(ob, "circle", { cx: OX(k).toFixed(1), cy: OY(v).toFixed(1), r: on ? 5 : 3.5, class: on ? "zs-probe" : "cv-dot cv-out-dot" });
      if (on || y.length <= 8) text(ob, OX(k), OY(v) - 8, nfmt(v), on ? "sim-label" : "sim-label zs-hint");
    });
    if (n >= y.length) add(ob, "circle", { cx: OX(n).toFixed(1), cy: OY(0).toFixed(1), r: 5, class: "zs-probe" });
    for (let k = 0; k <= 14; k += 2) text(ob, OX(k), HGT - 12, String(k), "sim-label zs-hint");

    actions.buttons[0].disabled = n <= 0;
    actions.buttons[1].disabled = n >= nMax;
    readout.textContent = `${sumText(x, h, n)}. As polynomials in z⁻¹: (${polyText(x)})·(${polyText(h)}) = ${polyText(y)}.`;
  }

  redraw();
  return {
    update(partial) { if (panel.update(partial)) redraw(); },
    destroy() { destroyed = true; ticker.stop(); panel.destroy(); actions.destroy(); },
  };
}

registerWidget("conv-sequence", (ctx) => mountConvSequence(ctx));
