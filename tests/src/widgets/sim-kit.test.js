// tests/src/widgets/sim-kit.test.js
//
// Unit tests for the shared simulation-widget kit (src/widgets/sim-kit.js):
//   - seeded RNG is deterministic and uniform-ish in [0, 1)
//   - defaultsFrom / validateParam follow the Widget_Spec contract (Req 10.4,
//     10.6): numeric defaults coerced, out-of-range and unknown options rejected
//   - buildControlPanel reflects defaults on first paint, applies in-range
//     changes, rejects out-of-range ones (keeps last valid value, marks the
//     control invalid), and detaches its listeners on destroy (Req 10.7)
//   - makeTicker starts, stops, and toggles an interval loop
//
// DOM setup mirrors parameter-plot.test.js: the shared `ensureDom()` real DOM.

import { describe, it, expect } from "../../harness.js";
import { ensureDom } from "../../dom.js";
import {
  makeRng,
  gaussian,
  defaultsFrom,
  validateParam,
  buildFrame,
  buildControlPanel,
  buildActions,
  buildStage,
  makeTicker,
} from "../../../src/widgets/sim-kit.js";

const dom = await ensureDom();

function makeInputEvent(el) {
  const view = el.ownerDocument.defaultView ?? dom.window ?? globalThis;
  return new view.Event("input", { bubbles: true });
}

const PARAMS = [
  { key: "rate", label: "Rate", control: "range", min: 0, max: 10, step: 1, default: 4 },
  { key: "mode", label: "Mode", control: "select", options: ["a", "b"], default: "b" },
];

describe("widgets/sim-kit", () => {
  it("makeRng is deterministic per seed and stays in [0, 1)", () => {
    const a = makeRng(42);
    const b = makeRng(42);
    const c = makeRng(43);
    const seqA = Array.from({ length: 50 }, () => a());
    const seqB = Array.from({ length: 50 }, () => b());
    const seqC = Array.from({ length: 50 }, () => c());
    expect(seqA).toEqual(seqB);
    expect(seqA.join() === seqC.join()).toBe(false);
    expect(seqA.every((x) => x >= 0 && x < 1)).toBe(true);
    const mean = seqA.reduce((s, x) => s + x, 0) / seqA.length;
    expect(mean > 0.3 && mean < 0.7).toBe(true);
  });

  it("gaussian samples have roughly zero mean and unit variance", () => {
    const rng = makeRng(9);
    const xs = Array.from({ length: 4000 }, () => gaussian(rng));
    const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
    const variance = xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length;
    expect(Math.abs(mean) < 0.1).toBe(true);
    expect(Math.abs(variance - 1) < 0.1).toBe(true);
  });

  it("defaultsFrom coerces numeric defaults and keeps select strings", () => {
    const state = defaultsFrom([
      { key: "x", label: "X", control: "number", min: 0, max: 5, default: "3" },
      { key: "m", label: "M", control: "select", options: ["p"], default: "p" },
    ]);
    expect(state).toEqual({ x: 3, m: "p" });
  });

  it("validateParam accepts in-range values and rejects out-of-range or unknown options", () => {
    expect(validateParam(PARAMS[0], "7")).toEqual({ ok: true, value: 7 });
    expect(validateParam(PARAMS[0], 11).ok).toBe(false);
    expect(validateParam(PARAMS[0], -1).ok).toBe(false);
    expect(validateParam(PARAMS[0], "abc").ok).toBe(false);
    expect(validateParam(PARAMS[1], "a")).toEqual({ ok: true, value: "a" });
    expect(validateParam(PARAMS[1], "z").ok).toBe(false);
  });

  it("buildControlPanel reflects defaults, applies valid input, rejects invalid input", () => {
    const container = dom.freshMount();
    const { doc, root } = buildFrame(container, { title: "Kit" });
    expect(root.querySelector(".widget__title").textContent).toBe("Kit");

    const changes = [];
    const panel = buildControlPanel(doc, root, PARAMS, (state, key) => changes.push([key, state[key]]));
    const inputs = root.querySelectorAll(".widget__control input, .widget__control select");
    expect(inputs.length).toBe(2);
    expect(inputs[0].value).toBe("4");
    expect(inputs[1].value).toBe("b");
    expect(panel.state).toEqual({ rate: 4, mode: "b" });

    inputs[0].value = "6";
    inputs[0].dispatchEvent(makeInputEvent(inputs[0]));
    expect(panel.state.rate).toBe(6);
    expect(changes).toEqual([["rate", 6]]);

    inputs[0].value = "99";
    inputs[0].dispatchEvent(makeInputEvent(inputs[0]));
    const field = root.querySelectorAll(".widget__control")[0];
    expect(field.classList.contains("widget__control--invalid")).toBe(true);
    expect(field.querySelector(".widget__control-error").hidden).toBe(false);
    expect(inputs[0].value).toBe("6");
    expect(panel.state.rate).toBe(6);
    expect(changes.length).toBe(1);

    expect(panel.update({ rate: 2 })).toBe(true);
    expect(panel.state.rate).toBe(2);
    expect(field.classList.contains("widget__control--invalid")).toBe(false);
    expect(panel.update({ rate: 50 })).toBe(false);
    expect(panel.state.rate).toBe(2);

    panel.destroy();
    inputs[0].value = "3";
    inputs[0].dispatchEvent(makeInputEvent(inputs[0]));
    expect(panel.state.rate).toBe(2);
  });

  it("buildActions wires click handlers and buildStage creates an SVG in a plot host", () => {
    const container = dom.freshMount();
    const { doc, root } = buildFrame(container, {});
    let clicks = 0;
    const actions = buildActions(doc, root, [{ label: "Step", onClick: () => clicks++ }]);
    const view = doc.defaultView ?? dom.window;
    actions.buttons[0].dispatchEvent(new view.Event("click"));
    expect(clicks).toBe(1);
    expect(actions.buttons[0].getAttribute("type")).toBe("button");
    actions.destroy();
    actions.buttons[0].dispatchEvent(new view.Event("click"));
    expect(clicks).toBe(1);

    const stage = buildStage(doc, root, 100, 50, "test drawing");
    expect(stage.host.className).toBe("widget__plot");
    expect(stage.svg.getAttribute("viewBox")).toBe("0 0 100 50");
  });

  it("makeTicker starts, stops and toggles", async () => {
    let ticks = 0;
    const ticker = makeTicker(() => ticks++, 5);
    expect(ticker.running()).toBe(false);
    ticker.start();
    expect(ticker.running()).toBe(true);
    await new Promise((r) => setTimeout(r, 40));
    ticker.stop();
    const seen = ticks;
    expect(seen > 0).toBe(true);
    await new Promise((r) => setTimeout(r, 30));
    expect(ticks).toBe(seen);
    expect(ticker.toggle()).toBe(true);
    expect(ticker.toggle()).toBe(false);
  });
});
