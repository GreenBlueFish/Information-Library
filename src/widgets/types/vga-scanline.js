// src/widgets/types/vga-scanline.js
//
// The `vga-scanline` widget type: step a VGA "beam" through a frame one pixel
// clock at a time and watch where it is (visible area, front porch, sync
// pulse, back porch), what the HSYNC and VSYNC wires are doing, and the image
// (colour bars) being painted line by line.
//
// Model:
//   A video mode is a pixel clock plus, for each axis, four counts: visible,
//   front porch, sync pulse and back porch (VESA Display Monitor Timings,
//   DMT). The horizontal counter h runs 0 … hTotal−1 once per pixel clock and
//   wraps, advancing the vertical counter v, which wraps at vTotal. A sync line
//   is "asserted" while its counter is inside the sync pulse; with negative
//   polarity the wire is driven low while asserted. RGB is driven only when
//   both counters are in the visible area and held at 0 V (black) otherwise.
//
// Visual: the whole frame drawn to scale (visible area, blanking, sync bands)
// with the beam and the painted part of the picture; below it the RGB, HSYNC
// and VSYNC waveforms with a cursor at the beam's position.
//
// Exports (pure, no DOM): MODES, modeTiming, regionOf, beamState, advance,
// stepPixels.

import { registerWidget } from "../registry.js";
import {
  buildFrame,
  buildControlPanel,
  buildActions,
  buildReadout,
  buildStage,
  svgEl,
  makeTicker,
} from "../sim-kit.js";

/**
 * VESA DMT timings. Counts are in pixels (horizontal) and lines (vertical);
 * `pclk` is in MHz; polarity "-" means the sync wire goes low while asserted.
 */
export const MODES = {
  "640x480 at 60 Hz": {
    pclk: 25.175, h: [640, 16, 96, 48], v: [480, 10, 2, 33], hPol: "-", vPol: "-",
  },
  "800x600 at 60 Hz": {
    pclk: 40, h: [800, 40, 128, 88], v: [600, 1, 4, 23], hPol: "+", vPol: "+",
  },
  "1024x768 at 60 Hz": {
    pclk: 65, h: [1024, 24, 136, 160], v: [768, 3, 6, 29], hPol: "-", vPol: "-",
  },
};

const STEPS = { "1 pixel": 1, "8 pixels": 8, "1 line": "line", "10 lines": "10 lines" };

/** Contract defaults (used when a page omits a param). */
const DEFAULT_PARAMS = [
  { key: "mode", label: "Video mode", control: "select", options: Object.keys(MODES), default: "640x480 at 60 Hz" },
  { key: "step", label: "Each step moves", control: "select", options: Object.keys(STEPS), default: "8 pixels" },
];

const TICK_MS = 60;

/**
 * The full timing for a named mode: the four counts per axis, the totals, and
 * the derived line time (µs), line rate (kHz) and frame rate (Hz). Unknown
 * names fall back to 640x480.
 *
 * @param {string} name
 */
export function modeTiming(name) {
  const m = MODES[name] ?? MODES["640x480 at 60 Hz"];
  const hTotal = m.h.reduce((a, b) => a + b, 0);
  const vTotal = m.v.reduce((a, b) => a + b, 0);
  return {
    ...m,
    hTotal,
    vTotal,
    lineUs: hTotal / m.pclk,
    lineKHz: (m.pclk * 1000) / hTotal,
    frameHz: (m.pclk * 1e6) / (hTotal * vTotal),
  };
}

/**
 * Which of the four intervals a counter value falls in.
 *
 * @param {number[]} counts [visible, frontPorch, sync, backPorch]
 * @param {number} pos counter value, 0 … total−1
 * @returns {"visible"|"front porch"|"sync"|"back porch"}
 */
export function regionOf(counts, pos) {
  const [vis, fp, sync] = counts;
  if (pos < vis) return "visible";
  if (pos < vis + fp) return "front porch";
  if (pos < vis + fp + sync) return "sync";
  return "back porch";
}

/**
 * Everything the wires say at beam position (h, v).
 *
 * @param {ReturnType<typeof modeTiming>} t
 * @param {number} h
 * @param {number} v
 */
export function beamState(t, h, v) {
  const hRegion = regionOf(t.h, h);
  const vRegion = regionOf(t.v, v);
  const hsync = hRegion === "sync";
  const vsync = vRegion === "sync";
  const level = (asserted, pol) => (asserted === (pol === "+") ? 1 : 0);
  return {
    hRegion,
    vRegion,
    visible: hRegion === "visible" && vRegion === "visible",
    hsync,
    vsync,
    hsyncLevel: level(hsync, t.hPol),
    vsyncLevel: level(vsync, t.vPol),
    timeUs: (v * t.hTotal + h) / t.pclk,
  };
}

/**
 * Move the beam forward n pixel clocks, wrapping h into v and v into a new
 * frame.
 *
 * @param {ReturnType<typeof modeTiming>} t
 * @param {{ h: number, v: number }} pos
 * @param {number} n
 * @returns {{ h: number, v: number, frames: number }} new position and how
 *   many frame boundaries were crossed
 */
export function advance(t, pos, n) {
  const perFrame = t.hTotal * t.vTotal;
  const abs = pos.v * t.hTotal + pos.h + Math.max(0, Math.floor(n));
  const inFrame = abs % perFrame;
  return { h: inFrame % t.hTotal, v: Math.floor(inFrame / t.hTotal), frames: Math.floor(abs / perFrame) };
}

/**
 * Pixel clocks one step covers for a `step` option.
 *
 * @param {ReturnType<typeof modeTiming>} t
 * @param {string} step
 */
export function stepPixels(t, step) {
  const s = STEPS[step] ?? 1;
  if (s === "line") return t.hTotal;
  if (s === "10 lines") return 10 * t.hTotal;
  return s;
}

registerWidget("vga-scanline", (ctx) => mountVgaScanline(ctx));

const VIEW_W = 640;
const FRAME_H = 400;
const FRAME_BOX = { left: 20, top: 24, width: 600, height: 360 };
const WAVE_H = 230;
const WAVE = { left: 70, right: 620, rowH: 70, top: 20 };
const BARS = 6;

function mountVgaScanline(ctx) {
  const spec = ctx.spec ?? {};
  const params = mergeParams(spec.params);
  const { doc, root } = buildFrame(ctx.container, spec);
  let t = null;
  let pos = { h: 0, v: 0 };
  let frames = 0;
  const panel = buildControlPanel(doc, root, params, (state, key) => {
    if (key === "mode") reset();
    redraw();
  });

  let playButton = null;
  const step = () => {
    const next = advance(t, pos, stepPixels(t, String(panel.state.step)));
    frames += next.frames;
    pos = { h: next.h, v: next.v };
  };
  const ticker = makeTicker(() => {
    step();
    redraw();
  }, TICK_MS);
  const actions = buildActions(doc, root, [
    { label: "Step", onClick: () => { step(); redraw(); } },
    {
      label: "Play",
      secondary: true,
      onClick: () => {
        const running = ticker.toggle();
        playButton.setAttribute("aria-pressed", String(running));
        playButton.textContent = running ? "Pause" : "Play";
      },
    },
    { label: "Jump to HSYNC", secondary: true, onClick: () => { jumpTo("h"); redraw(); } },
    { label: "Jump to VSYNC", secondary: true, onClick: () => { jumpTo("v"); redraw(); } },
    { label: "Reset", secondary: true, onClick: () => { reset(); redraw(); } },
  ]);
  playButton = actions.buttons[1];
  playButton.setAttribute("aria-pressed", "false");

  const frameStage = buildStage(doc, root, VIEW_W, FRAME_H, "The whole frame to scale, with the beam and the painted picture");
  const waveStage = buildStage(doc, root, VIEW_W, WAVE_H, "RGB, HSYNC and VSYNC waveforms with a cursor at the beam");
  const readout = buildReadout(doc, root);
  let destroyed = false;

  function reset() {
    t = modeTiming(String(panel.state.mode));
    pos = { h: 0, v: 0 };
    frames = 0;
  }

  /** Put the beam on the first clock of the next horizontal or vertical sync pulse. */
  function jumpTo(axis) {
    const hSyncStart = t.h[0] + t.h[1];
    const vSyncStart = t.v[0] + t.v[1];
    if (axis === "h") {
      const v = pos.h < hSyncStart ? pos.v : (pos.v + 1) % t.vTotal;
      pos = { h: hSyncStart, v };
    } else {
      pos = { h: 0, v: vSyncStart };
    }
  }

  function redraw() {
    if (destroyed) return;
    const s = beamState(t, pos.h, pos.v);
    drawFrame(doc, frameStage, t, pos);
    drawWaves(doc, waveStage, t, pos);
    const wire = (asserted, lvl) => `${asserted ? "asserted" : "idle"} (wire ${lvl ? "high" : "low"})`;
    readout.textContent =
      `h = ${pos.h} of ${t.hTotal}, v = ${pos.v} of ${t.vTotal}. ` +
      `Horizontal: ${s.hRegion}; vertical: ${s.vRegion}. ` +
      `RGB ${s.visible ? "driven (pixel drawn)" : "held at 0 V (blanked)"}; ` +
      `HSYNC ${wire(s.hsync, s.hsyncLevel)}; VSYNC ${wire(s.vsync, s.vsyncLevel)}. ` +
      `${(s.timeUs / 1000).toFixed(3)} ms into frame ${frames + 1}; ` +
      `line ${t.lineUs.toFixed(2)} µs (${t.lineKHz.toFixed(2)} kHz), frame ${t.frameHz.toFixed(2)} Hz.`;
  }

  reset();
  redraw();

  return {
    update(partial) {
      const modeBefore = panel.state.mode;
      if (panel.update(partial)) {
        if (panel.state.mode !== modeBefore) reset();
        redraw();
      }
    },
    destroy() {
      destroyed = true;
      ticker.stop();
      actions.destroy();
      panel.destroy();
    },
  };
}

function drawFrame(doc, stage, t, pos) {
  stage.clear();
  const svg = stage.svg;
  const k = Math.min(FRAME_BOX.width / t.hTotal, FRAME_BOX.height / t.vTotal);
  const x0 = FRAME_BOX.left;
  const y0 = FRAME_BOX.top;
  const [hv, hfp, hs] = t.h;
  const [vv, vfp, vs] = t.v;
  const rect = (cls, x, y, w, h) =>
    svg.appendChild(svgEl(doc, "rect", { class: cls, x: x0 + x * k, y: y0 + y * k, width: Math.max(0, w * k), height: Math.max(0, h * k) }));

  rect("vga-area", 0, 0, t.hTotal, t.vTotal);
  rect("vga-area vga-area--sync", hv + hfp, 0, hs, t.vTotal);
  rect("vga-area vga-area--sync", 0, vv + vfp, t.hTotal, vs);
  rect("vga-area vga-area--visible", 0, 0, hv, vv);

  // The picture painted so far this frame: six colour bars, full rows above
  // the beam and the current row up to it.
  const rowsDone = Math.min(pos.v, vv);
  const barW = hv / BARS;
  for (let b = 0; b < BARS; b++) {
    const cls = `plot-series--${b + 1}`;
    if (rowsDone > 0) rect(cls, b * barW, 0, barW, rowsDone);
    if (pos.v < vv) {
      const w = Math.min(barW, Math.max(0, Math.min(pos.h, hv) - b * barW));
      if (w > 0) rect(cls, b * barW, pos.v, w, 1);
    }
  }

  const label = (text, x, y, anchor = "start") => {
    const el = svgEl(doc, "text", { class: "sim-label", x, y, "text-anchor": anchor });
    el.textContent = text;
    svg.appendChild(el);
  };
  label(`visible ${hv}×${vv}`, x0, y0 - 6);
  label("HSYNC", x0 + (hv + hfp + hs / 2) * k, y0 - 6, "middle");
  label("VSYNC", x0 + t.hTotal * k + 4, y0 + (vv + vfp + vs) * k + 4);

  const bx = x0 + (pos.h + 0.5) * k;
  const by = y0 + (pos.v + 0.5) * k;
  svg.appendChild(svgEl(doc, "line", { class: "vga-cursor", x1: x0, y1: by, x2: x0 + t.hTotal * k, y2: by }));
  svg.appendChild(svgEl(doc, "circle", { class: "vga-beam", cx: bx, cy: by, r: 6 }));
}

function drawWaves(doc, stage, t, pos) {
  stage.clear();
  const svg = stage.svg;
  const span = WAVE.right - WAVE.left;
  const [hv, hfp, hs] = t.h;
  const [vv, vfp, vs] = t.v;
  const yOf = (row, level) => WAVE.top + row * WAVE.rowH + (level ? 8 : 40);
  const trace = (row, cls, total, edges) => {
    // edges: [[pos, level], …] starting at 0
    let d = "";
    edges.forEach(([p, lvl], i) => {
      const x = WAVE.left + (p / total) * span;
      d += i === 0 ? `M${x} ${yOf(row, lvl)}` : ` H${x} V${yOf(row, lvl)}`;
    });
    d += ` H${WAVE.right}`;
    svg.appendChild(svgEl(doc, "path", { class: `sim-trace ${cls}`, d }));
  };
  const idle = (pol) => (pol === "+" ? 0 : 1);
  const visibleLine = pos.v < vv;

  trace(0, "plot-series--3", t.hTotal, visibleLine ? [[0, 1], [hv, 0]] : [[0, 0]]);
  trace(1, "plot-series--5", t.hTotal, [[0, idle(t.hPol)], [hv + hfp, 1 - idle(t.hPol)], [hv + hfp + hs, idle(t.hPol)]]);
  trace(2, "plot-series--4", t.vTotal, [[0, idle(t.vPol)], [vv + vfp, 1 - idle(t.vPol)], [vv + vfp + vs, idle(t.vPol)]]);

  const names = [
    ["RGB", visibleLine ? "this line" : "blank line"],
    ["HSYNC", "this line"],
    ["VSYNC", "whole frame"],
  ];
  names.forEach(([name, sub], row) => {
    const a = svgEl(doc, "text", { class: "sim-label", x: 4, y: yOf(row, 1) + 12 });
    a.textContent = name;
    svg.appendChild(a);
    const b = svgEl(doc, "text", { class: "sim-label", x: 4, y: yOf(row, 1) + 28 });
    b.textContent = sub;
    svg.appendChild(b);
  });

  const cx = (p, total) => WAVE.left + ((p + 0.5) / total) * span;
  const h = cx(pos.h, t.hTotal);
  const v = cx(pos.v, t.vTotal);
  svg.appendChild(svgEl(doc, "line", { class: "vga-cursor", x1: h, y1: WAVE.top, x2: h, y2: WAVE.top + 2 * WAVE.rowH - 20 }));
  svg.appendChild(svgEl(doc, "line", { class: "vga-cursor", x1: v, y1: WAVE.top + 2 * WAVE.rowH, x2: v, y2: WAVE.top + 3 * WAVE.rowH - 20 }));
}

function mergeParams(params) {
  const given = Array.isArray(params) ? params.filter((p) => p && typeof p.key === "string") : [];
  const keys = new Set(given.map((p) => p.key));
  return [...given, ...DEFAULT_PARAMS.filter((p) => !keys.has(p.key))];
}
