// Size controls for figures and simulations (src/resize.js).
import { describe, it, expect } from "../harness.js";
import { ensureDom } from "../dom.js";

const dom = await ensureDom();
globalThis.document = dom.document;
const { installResizers, stepSize, savedSize, STORAGE_KEY } = await import("../../src/resize.js");

function fakeStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
}
function page() {
  globalThis.document = dom.document;
  const p = dom.document.createElement("div");
  p.innerHTML = '<figure class="block block--figure"><img class="figure__image"></figure>' +
    '<p>text</p><div class="block block--widget"><div class="widget"></div></div>';
  dom.document.body.appendChild(p);
  return p;
}
const click = (b) => b.dispatchEvent(new dom.window.Event("click"));

describe("size controls", () => {
  it("steps through the sizes and stops at the ends", () => {
    expect(stepSize(100, -1)).toBe(85);
    expect(stepSize(40, -1)).toBe(40);
    expect(stepSize(100, +1)).toBe(100);
    expect(stepSize(55, +1)).toBe(70);
  });

  it("every figure and simulation gets a toolbar, and + is off at full size", () => {
    const p = page();
    installResizers(p, "a.json", fakeStorage());
    const bars = p.querySelectorAll(".size-controls");
    expect(bars.length).toBe(2);
    expect(p.querySelector(".block--widget > .size-controls")).toBeTruthy();
    expect(p.querySelector(".size-controls__larger").disabled).toBe(true);
  });

  it("smaller shrinks the block, is remembered, and comes back after a re-render", () => {
    const storage = fakeStorage();
    let p = page();
    installResizers(p, "a.json", storage);
    const fig = p.querySelector(".block--figure");
    click(fig.querySelector(".size-controls__smaller"));
    click(fig.querySelector(".size-controls__smaller"));
    expect(fig.getAttribute("data-size")).toBe("70");
    expect(savedSize("a.json#0", storage)).toBe(70);
    expect(savedSize("a.json#1", storage)).toBe(100);
    p = page();
    installResizers(p, "a.json", storage);
    expect(p.querySelector(".block--figure").getAttribute("data-size")).toBe("70");
    click(p.querySelector(".block--figure .size-controls__reset"));
    expect(p.querySelector(".block--figure").hasAttribute("data-size")).toBe(false);
    expect(JSON.parse(storage.getItem(STORAGE_KEY))).toEqual({});
  });

  it("expand fills the window, one block at a time, and Escape closes it", () => {
    const p = page();
    installResizers(p, "b.json", fakeStorage());
    const [a, b] = p.querySelectorAll(".block--figure, .block--widget");
    click(a.querySelector(".size-controls__expand"));
    expect(a.getAttribute("data-expanded")).toBe("true");
    click(b.querySelector(".size-controls__expand"));
    expect(a.hasAttribute("data-expanded")).toBe(false);
    expect(b.getAttribute("data-expanded")).toBe("true");
    const esc = new dom.window.Event("keydown"); esc.key = "Escape"; dom.document.dispatchEvent(esc);
    expect(b.hasAttribute("data-expanded")).toBe(false);
  });

  it("blocked storage still resizes", () => {
    const p = page();
    installResizers(p, "c.json", { getItem() { throw new Error("no"); }, setItem() { throw new Error("no"); } });
    const fig = p.querySelector(".block--figure");
    click(fig.querySelector(".size-controls__smaller"));
    expect(fig.getAttribute("data-size")).toBe("85");
  });
});
