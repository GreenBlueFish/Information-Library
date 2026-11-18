// A number beside every slider (src/widgets/slider-value.js).
import { describe, it, expect } from "../../harness.js";
import { ensureDom } from "../../dom.js";

const dom = await ensureDom();
globalThis.document = dom.document;
const { decimalsFor, formatValue } = await import("../../../src/widgets/slider-value.js");
const { buildControlPanel } = await import("../../../src/widgets/sim-kit.js");

const fire = (el, type) => el.dispatchEvent(new dom.window.Event(type));

describe("slider value readout", () => {
  it("shows as many decimals as the step has", () => {
    expect(decimalsFor(1)).toBe(0);
    expect(decimalsFor(5)).toBe(0);
    expect(decimalsFor(0.05)).toBe(2);
    expect(decimalsFor(0.0005)).toBe(4);
    expect(decimalsFor(1e-7)).toBe(7);
    expect(decimalsFor(undefined)).toBe(2);
    expect(formatValue(2, 0.05)).toBe("2.00");
    expect(formatValue("0.0105", 0.0005)).toBe("0.0105");
    expect(formatValue(-50, 0.5)).toBe("−50.0");
    expect(formatValue(-0.001, 0.1)).toBe("0.0");
  });

  it("every range control gets a readout that follows the slider; other controls don't", () => {
    const parent = dom.document.createElement("div");
    const params = [
      { key: "i", label: "Current", control: "range", min: 0, max: 4, step: 0.05, default: 2 },
      { key: "n", label: "Count", control: "number", min: 0, max: 9, step: 1, default: 3 },
      { key: "m", label: "Mode", control: "select", options: ["a", "b"], default: "a" },
    ];
    const panel = buildControlPanel(dom.document, parent, params, () => {});
    const outs = parent.querySelectorAll(".widget__control-value");
    expect(outs.length).toBe(1);
    expect(outs[0].textContent).toBe("2.00");
    const slider = parent.querySelector('input[type="range"]');
    slider.value = "3.35";
    fire(slider, "input");
    expect(outs[0].textContent).toBe("3.35");
    // Setting the value in code updates the number too.
    panel.update({ i: 1.5 });
    expect(outs[0].textContent).toBe("1.50");
  });
});
