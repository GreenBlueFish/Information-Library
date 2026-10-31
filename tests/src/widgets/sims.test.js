// tests/src/widgets/sims.test.js
//
// The simulators behind `config.sim` (src/widgets/sims/): every one returns
// finite, non-empty series for its defaults and is deterministic, and a few
// carry a qualitative claim a page makes about them, checked here so the page
// cannot drift from what the plot shows.

import { describe, it, expect } from "../../harness.js";
import { SIMS } from "../../../src/widgets/sims/index.js";

const ys = (s) => s.points.map((p) => p.y);
const spikes = (s, at = 19.9) => ys(s).filter((y) => y >= at).length;

describe("widgets/sims", () => {
  for (const [name, sim] of Object.entries(SIMS)) {
    it(`${name}: finite, non-empty and deterministic for its defaults`, () => {
      const out = sim({}, {});
      expect(Array.isArray(out) && out.length > 0).toBe(true);
      for (const s of out) {
        expect(s.points.length > 0).toBe(true);
        expect(s.points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
      }
      expect(JSON.stringify(sim({}, {}))).toBe(JSON.stringify(out));
    });
  }

  it("lif: no spikes below rheobase, more spikes for more current", () => {
    expect(spikes(SIMS.lif({}, { current: 1 })[0])).toBe(0);
    expect(spikes(SIMS.lif({}, { current: 4 })[0]) > spikes(SIMS.lif({}, { current: 2 })[0])).toBe(true);
  });

  it("adex: adaptation (b > 0) lowers the spike count", () => {
    expect(spikes(SIMS.adex({}, { b: 200 })[0]) < spikes(SIMS.adex({}, { b: 0, a: 0 })[0])).toBe(true);
  });

  it("hh: fires repetitively at 10 uA/cm^2 and not at 1", () => {
    const peaks = (I) => {
      const v = ys(SIMS.hh({}, { current: I })[0]);
      return v.filter((x, i) => i > 0 && x > 0 && v[i - 1] <= 0).length;
    };
    expect(peaks(10) > 3).toBe(true);
    expect(peaks(1)).toBe(0);
  });

  it("ifb: a step from rest starts with a burst; from a depolarised hold it does not", () => {
    const isis = (hold) => {
      const pts = SIMS.ifb({}, { hold, current: 1.5 })[0].points;
      const t = pts.filter((p) => p.y >= 19.9 && p.x > 300).map((p) => p.x);
      return t.slice(1).map((x, i) => x - t[i]);
    };
    const fromRest = isis(0), fromDepolarised = isis(0.5);
    expect(fromRest.length >= 3 && fromRest.slice(0, 3).every((d) => d < 8)).toBe(true);
    expect(fromDepolarised.length > 3 && fromDepolarised.every((d) => d > 20)).toBe(true);
  });

  it("stdp-triplet: post-before-pre turns from depression to potentiation as frequency rises", () => {
    const [, postPre] = SIMS["stdp-triplet"]({}, {});
    expect(postPre.points[0].y < 0).toBe(true);
    expect(postPre.points.at(-1).y > 0).toBe(true);
  });

  it("temporal-memory: bursting falls once the sequences are learned", () => {
    const burst = ys(SIMS["temporal-memory"]({}, {})[0]);
    expect(burst.slice(0, 4).every((b) => b === 1)).toBe(true);
    const late = burst.slice(-16);
    expect(late.reduce((a, b) => a + b, 0) / late.length < 0.1).toBe(true);
  });

  it("thousand-brains: voting columns narrow the candidates faster than one column", () => {
    const [one, many] = SIMS["thousand-brains"]({}, {});
    expect(many.points[1].y < one.points[1].y).toBe(true);
  });

  it("ring-attractor: the bump outlasts the cue with strong recurrence, not with weak", () => {
    const after = (J1) => Math.max(...ys(SIMS["ring-attractor"]({}, { excitation: J1 })[1]));
    expect(after(6) > 0.2).toBe(true);
    expect(after(0) < 0.2).toBe(true);
  });

  it("nef-decode: more neurons decode x more accurately", () => {
    const err = (n) => {
      const [target, est] = SIMS["nef-decode"]({}, { neurons: n });
      return target.points.reduce((s, p, i) => s + (p.y - est.points[i].y) ** 2, 0);
    };
    expect(err(40) < err(4)).toBe(true);
  });

  it("ldn: the decoded state tracks the delayed input", () => {
    const [, delayed, decoded] = SIMS.ldn({}, {});
    const tail = delayed.points.slice(250);
    const mse = tail.reduce((s, p, i) => s + (p.y - decoded.points[250 + i].y) ** 2, 0) / tail.length;
    expect(mse < 0.01).toBe(true);
  });
});

describe("widgets/sims (mushroom body)", () => {
  it("mushroom-body: an identical odor gives an identical KC code, and similar odors are separated", () => {
    const [kc] = SIMS["mushroom-body"]({}, {});
    expect(kc.points.at(-1).y).toBe(1);
    const mid = kc.points.find((p) => p.x >= 0.5 && p.x < 0.9);
    expect(mid.y < mid.x).toBe(true);
  });
});
