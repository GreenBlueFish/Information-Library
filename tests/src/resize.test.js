// Size controls for figures and simulations (src/resize.js).
import { describe, it, expect } from "../harness.js";
import { ensureDom } from "../dom.js";

const dom = await ensureDom();
globalThis.document = dom.document;
const { installResizers, stepSize, savedSize, clampSize, STORAGE_KEY, SIZES } = await import("../../src/resize.js");

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
const sizeOf = (block) => (block.hasAttribute("data-sized") ? block.style.getPropertyValue("--size") : "100%");

describe("size controls", () => {
  it("steps through the sizes, from any size, and stops at the ends", () => {
    expect(SIZES[0]).toBe(25);
    expect(stepSize(100, -1)).toBe(85);
    expect(stepSize(25, -1)).toBe(25);
    expect(stepSize(100, +1)).toBe(100);
    expect(stepSize(55, +1)).toBe(70);
    expect(stepSize(63, +1)).toBe(70);
    expect(stepSize(63, -1)).toBe(55);
    expect(stepSize(21, -1)).toBe(21);
  });

  it("sizes are whole percents between 20 and 100", () => {
    expect(clampSize(5)).toBe(20);
    expect(clampSize(63.4)).toBe(63);
    expect(clampSize(140)).toBe(100);
    expect(clampSize("x")).toBe(100);
  });

  it("each block is wrapped with its toolbar outside it, and gets a drag handle", () => {
    const p = page();
    installResizers(p, "a.json", fakeStorage());
    const wraps = p.querySelectorAll(".sizable");
    expect(wraps.length).toBe(2);
    for (const w of wraps) {
      expect(w.children[0].className).toBe("size-controls");
      expect(w.children[1].classList.contains("block")).toBe(true);
      expect(Boolean(w.children[1].querySelector(":scope > .size-handle"))).toBe(true);
    }
    expect(p.querySelector(".size-controls__larger").disabled).toBe(true);
  });

  it("smaller shrinks the block, is remembered, and comes back after a re-render", () => {
    const storage = fakeStorage();
    let p = page();
    installResizers(p, "a.json", storage);
    const fig = p.querySelector(".block--figure");
    const bar = fig.parentNode.querySelector(".size-controls");
    click(bar.querySelector(".size-controls__smaller"));
    click(bar.querySelector(".size-controls__smaller"));
    expect(sizeOf(fig)).toBe("70%");
    expect(savedSize("a.json#0", storage)).toBe(70);
    expect(savedSize("a.json#1", storage)).toBe(100);
    p = page();
    installResizers(p, "a.json", storage);
    const fig2 = p.querySelector(".block--figure");
    expect(sizeOf(fig2)).toBe("70%");
    click(fig2.parentNode.querySelector(".size-controls__reset"));
    expect(fig2.hasAttribute("data-sized")).toBe(false);
    expect(JSON.parse(storage.getItem(STORAGE_KEY))).toEqual({});
  });

  it("expand fills the window, one block at a time, and Escape closes it", () => {
    const p = page();
    installResizers(p, "b.json", fakeStorage());
    const [a, b] = p.querySelectorAll(".sizable");
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
    click(fig.parentNode.querySelector(".size-controls__smaller"));
    expect(sizeOf(fig)).toBe("85%");
  });
});
