// The global sound switch (src/sound.js).
import { describe, it, expect } from "../harness.js";
import { soundOn, setSound, onSoundChange, STORAGE_KEY } from "../../src/sound.js";

function fakeStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
}

describe("sound switch", () => {
  it("is on by default and remembers off", () => {
    const st = fakeStorage();
    expect(soundOn(st)).toBe(true);
    setSound(false, st);
    expect(soundOn(st)).toBe(false);
    expect(st.getItem(STORAGE_KEY)).toBe("off");
  });
  it("tells subscribers, and stops after unsubscribe", () => {
    const seen = [];
    const off = onSoundChange((on) => seen.push(on));
    setSound(false, fakeStorage());
    setSound(true, fakeStorage());
    off();
    setSound(false, fakeStorage());
    expect(seen).toEqual([false, true]);
  });
  it("blocked storage counts as on", () => {
    expect(soundOn({ getItem() { throw new Error("no"); } })).toBe(true);
  });
});
