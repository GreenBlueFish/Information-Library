// tests/src/widgets/vga-scanline.test.js
//
// Unit tests for the `vga-scanline` widget type
// (src/widgets/types/vga-scanline.js).
//
// Model (pure functions, no DOM): the VESA DMT totals and rates for each mode,
// the region a counter is in, sync polarity on the wires, and wrapping of the
// beam from h into v and v into a new frame.
// Widget (DOM): first paint, Step moves the beam, update() changes mode and
// resets the beam, destroy() stops cleanly.

import { describe, it, expect } from "../../harness.js";
import { ensureDom } from "../../dom.js";
import { mountWidget } from "../../../src/widgets/registry.js";
import {
  MODES,
  modeTiming,
  regionOf,
  beamState,
  advance,
  stepPixels,
} from "../../../src/widgets/types/vga-scanline.js";

const dom = await ensureDom();

async function ensureRegistered() {
  await import(`../../../src/widgets/types/vga-scanline.js?fresh=${Math.random()}`);
}

function makeEvent(el, type) {
  const view = el.ownerDocument.defaultView ?? dom.window ?? globalThis;
  return new view.Event(type, { bubbles: true });
}

async function withRealDocument(fn) {
  const prevDesc = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", {
    value: dom.document,
    configurable: true,
    writable: true,
  });
  try {
    return await fn();
  } finally {
    if (prevDesc) Object.defineProperty(globalThis, "document", prevDesc);
    else delete globalThis.document;
  }
}

function spec() {
  return {
    type: "vga-scanline",
    title: "Step the beam through a VGA frame",
    params: [
      { key: "mode", label: "Video mode", control: "select", options: Object.keys(MODES), default: "640x480 at 60 Hz" },
      { key: "step", label: "Each step moves", control: "select", options: ["1 pixel", "8 pixels", "1 line", "10 lines"], default: "8 pixels" },
    ],
  };
}

const near = (a, b, tol) => Math.abs(a - b) <= tol;

describe("widgets/vga-scanline — model", () => {
  it("640x480 at 60 Hz has the standard 800 × 525 totals and rates", () => {
    const t = modeTiming("640x480 at 60 Hz");
    expect(t.hTotal).toBe(800);
    expect(t.vTotal).toBe(525);
    expect(near(t.lineUs, 31.778, 0.001)).toBe(true);
    expect(near(t.lineKHz, 31.469, 0.001)).toBe(true);
    expect(near(t.frameHz, 59.94, 0.01)).toBe(true);
  });

  it("the other modes match their DMT totals and land near 60 Hz", () => {
    const a = modeTiming("800x600 at 60 Hz");
    expect([a.hTotal, a.vTotal]).toEqual([1056, 628]);
    const b = modeTiming("1024x768 at 60 Hz");
    expect([b.hTotal, b.vTotal]).toEqual([1344, 806]);
    for (const name of Object.keys(MODES)) {
      expect(near(modeTiming(name).frameHz, 60, 0.4)).toBe(true);
    }
  });

  it("regionOf splits a line into visible, front porch, sync and back porch", () => {
    const h = [640, 16, 96, 48];
    expect(regionOf(h, 0)).toBe("visible");
    expect(regionOf(h, 639)).toBe("visible");
    expect(regionOf(h, 640)).toBe("front porch");
    expect(regionOf(h, 656)).toBe("sync");
    expect(regionOf(h, 751)).toBe("sync");
    expect(regionOf(h, 752)).toBe("back porch");
    expect(regionOf(h, 799)).toBe("back porch");
  });

  it("negative polarity drives the wire low while sync is asserted; positive drives it high", () => {
    const neg = modeTiming("640x480 at 60 Hz");
    expect(beamState(neg, 700, 0).hsync).toBe(true);
    expect(beamState(neg, 700, 0).hsyncLevel).toBe(0);
    expect(beamState(neg, 100, 0).hsyncLevel).toBe(1);
    expect(beamState(neg, 0, 490).vsyncLevel).toBe(0);
    const pos = modeTiming("800x600 at 60 Hz");
    expect(beamState(pos, 800 + 40, 0).hsyncLevel).toBe(1);
    expect(beamState(pos, 0, 0).hsyncLevel).toBe(0);
  });

  it("RGB is driven only inside the visible area", () => {
    const t = modeTiming("640x480 at 60 Hz");
    expect(beamState(t, 10, 10).visible).toBe(true);
    expect(beamState(t, 650, 10).visible).toBe(false);
    expect(beamState(t, 10, 500).visible).toBe(false);
  });

  it("advance wraps h into v and v into a new frame", () => {
    const t = modeTiming("640x480 at 60 Hz");
    expect(advance(t, { h: 799, v: 0 }, 1)).toEqual({ h: 0, v: 1, frames: 0 });
    expect(advance(t, { h: 799, v: 524 }, 1)).toEqual({ h: 0, v: 0, frames: 1 });
    expect(advance(t, { h: 5, v: 3 }, stepPixels(t, "1 line"))).toEqual({ h: 5, v: 4, frames: 0 });
    expect(advance(t, { h: 0, v: 0 }, 800 * 525 * 2 + 3)).toEqual({ h: 3, v: 0, frames: 2 });
  });

  it("beam time matches clocks ÷ pixel clock", () => {
    const t = modeTiming("640x480 at 60 Hz");
    expect(near(beamState(t, 0, 1).timeUs, t.lineUs, 1e-9)).toBe(true);
  });
});

describe("widgets/vga-scanline — widget", () => {
  it("paints the frame and waveforms on first paint", async () => {
    await ensureRegistered();
    await withRealDocument(() => {
      const container = dom.freshMount();
      const instance = mountWidget(spec(), container);
      expect(instance === null).toBe(false);
      const plots = container.querySelectorAll(".widget__plot");
      expect(plots.length).toBe(2);
      expect(plots[0].querySelector(".vga-beam") === null).toBe(false);
      const readout = container.querySelector(".widget__readout").textContent;
      expect(readout.includes("h = 0 of 800, v = 0 of 525")).toBe(true);
      instance.destroy();
    });
  });

  it("Step moves the beam by the chosen step", async () => {
    await ensureRegistered();
    await withRealDocument(() => {
      const container = dom.freshMount();
      const instance = mountWidget(spec(), container);
      const step = container.querySelectorAll(".widget__button")[0];
      step.dispatchEvent(makeEvent(step, "click"));
      const readout = container.querySelector(".widget__readout").textContent;
      expect(readout.includes("h = 8 of 800")).toBe(true);
      instance.destroy();
    });
  });

  it("Jump to HSYNC lands in the sync pulse with the wire low", async () => {
    await ensureRegistered();
    await withRealDocument(() => {
      const container = dom.freshMount();
      const instance = mountWidget(spec(), container);
      const jump = container.querySelectorAll(".widget__button")[2];
      jump.dispatchEvent(makeEvent(jump, "click"));
      const readout = container.querySelector(".widget__readout").textContent;
      expect(readout.includes("h = 656")).toBe(true);
      expect(readout.includes("HSYNC asserted (wire low)")).toBe(true);
      instance.destroy();
    });
  });

  it("update() switches mode and resets the beam; an unknown option is rejected", async () => {
    await ensureRegistered();
    await withRealDocument(() => {
      const container = dom.freshMount();
      const instance = mountWidget(spec(), container);
      instance.update({ mode: "1024x768 at 60 Hz" });
      let readout = container.querySelector(".widget__readout").textContent;
      expect(readout.includes("h = 0 of 1344, v = 0 of 806")).toBe(true);
      instance.update({ mode: "4K" });
      readout = container.querySelector(".widget__readout").textContent;
      expect(readout.includes("of 1344")).toBe(true);
      instance.destroy();
    });
  });
});
