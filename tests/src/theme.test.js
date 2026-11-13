// The light/dark switch (src/theme.js).
import { describe, it, expect } from "../harness.js";
import { ensureDom } from "../dom.js";

const dom = await ensureDom();
globalThis.document = dom.document;
const { installThemeToggle, savedTheme, STORAGE_KEY } = await import("../../src/theme.js");

function fakeStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
}
function fakeWin(dark) {
  const listeners = [];
  const mq = { matches: dark, addEventListener: (_, f) => listeners.push(f), removeEventListener() {} };
  return { matchMedia: () => mq, flip(v) { mq.matches = v; listeners.forEach((f) => f()); } };
}
function setup(dark, saved) {
  globalThis.document = dom.document;
  const button = dom.document.createElement("button");
  button.hidden = true;
  const storage = fakeStorage(saved ? { [STORAGE_KEY]: saved } : {});
  const win = fakeWin(dark);
  installThemeToggle(button, win, storage);
  const theme = () => dom.document.documentElement.getAttribute("data-theme");
  return { button, storage, win, theme };
}

describe("theme toggle", () => {
  it("follows the system setting when nothing is saved, and shows the button", () => {
    const { button, theme } = setup(true);
    expect(theme()).toBe("dark");
    expect(button.hidden).toBe(false);
    expect(button.getAttribute("aria-pressed")).toBe("true");
  });

  it("a saved choice wins over the system setting", () => {
    expect(setup(true, "light").theme()).toBe("light");
    expect(setup(false, "dark").theme()).toBe("dark");
  });

  it("a click flips the theme and saves it", () => {
    const { button, storage, theme } = setup(false);
    button.dispatchEvent(new dom.window.Event("click"));
    expect(theme()).toBe("dark");
    expect(savedTheme(storage)).toBe("dark");
    button.dispatchEvent(new dom.window.Event("click"));
    expect(theme()).toBe("light");
    expect(button.textContent.includes("Dark mode")).toBe(true);
  });

  it("tracks system changes until the reader chooses, then stops", () => {
    const { button, win, theme } = setup(false);
    win.flip(true);
    expect(theme()).toBe("dark");
    button.dispatchEvent(new dom.window.Event("click")); // choose light
    win.flip(true);
    expect(theme()).toBe("light");
  });

  it("an unreadable or junk saved value is ignored", () => {
    expect(savedTheme(fakeStorage({ [STORAGE_KEY]: "purple" }))).toBe(null);
    expect(savedTheme({ getItem() { throw new Error("blocked"); } })).toBe(null);
  });
});
