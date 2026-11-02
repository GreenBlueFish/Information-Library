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

  it("spatial-pooler: boosting narrows the spread of column use", () => {
    const [plain, boosted] = SIMS["spatial-pooler"]({}, {});
    const spread = (s) => s.points[0].y - s.points.at(-1).y;
    expect(spread(boosted) < spread(plain)).toBe(true);
  });

  it("dendrite-match: false matches fall and misses rise with the threshold", () => {
    const [fm, miss] = SIMS["dendrite-match"]({}, {});
    expect(fm.points[9].y < -10).toBe(true);
    expect(miss.points[9].y < -1).toBe(true);
    expect(fm.points[15].y < fm.points[5].y && miss.points[15].y > miss.points[5].y).toBe(true);
  });

  it("hebb-oja: plain Hebb grows without bound, Oja settles at |w| = 1 along the first component", () => {
    const [hebb, ojaNorm, ojaAlign] = SIMS["hebb-oja"]({}, {});
    expect(hebb.points.at(-1).y > 5).toBe(true);
    expect(Math.abs(ojaNorm.points.at(-1).y - 1) < 0.05).toBe(true);
    expect(ojaAlign.points.at(-1).y > 0.95).toBe(true);
  });

  it("adaptive-threshold: the rate rises much less after the step than with a fixed threshold", () => {
    const [fixed, adaptive] = SIMS["adaptive-threshold"]({}, {});
    const rise = (s) => s.points.at(-1).y - s.points[5].y;
    expect(rise(adaptive) < rise(fixed) / 3).toBe(true);
  });

  it("ei-amplifier: settles at h / (1 − wEE + wEI·wIE)", () => {
    const [E] = SIMS["ei-amplifier"]({}, { wEE: 1.5, wEI: 1, wIE: 1 });
    expect(Math.abs(E.points.at(-1).y - 2) < 0.01).toBe(true);
  });

  it("predictive-coding: settles near 1.6 for the tutorial's numbers, nearer the prior when the input is noisy", () => {
    const end = (v) => SIMS["predictive-coding"]({}, { sensoryVariance: v })[0].points.at(-1).y;
    expect(Math.abs(end(1) - 1.6) < 0.05).toBe(true);
    expect(end(5) > end(1) && end(1) > end(0.2)).toBe(true);
  });

  it("laminar-flow: L4e responds before L2/3e", () => {
    const [l23, l4] = SIMS["laminar-flow"]({}, {});
    const peak = (s) => s.points.reduce((a, p) => (p.y > a.y ? p : a)).x;
    expect(peak(l4) < peak(l23)).toBe(true);
  });

  it("cuba-coba: conductance-based input saturates below the reversal potential, current-based does not", () => {
    const [cuba, coba] = SIMS["cuba-coba"]({}, { inputs: 1000 });
    expect(Math.max(...ys(cuba)) > 0).toBe(true);
    expect(Math.max(...ys(coba)) < 0).toBe(true);
  });

  it("nmda-dendrite: NMDA turns a small response into a plateau past a few synapses", () => {
    const [withNmda, ampa] = SIMS["nmda-dendrite"]({}, {});
    expect(withNmda.points[1].y < 10 && withNmda.points[19].y > 40).toBe(true);
    expect(Math.max(...ys(ampa)) < 10).toBe(true);
  });

  it("path-integration: landmarks keep the error from accumulating", () => {
    const end = (landmark) => SIMS["path-integration"]({}, { landmark })[0].points.at(-1).y;
    expect(end(0) > 10).toBe(true);
    expect(end(20) < end(0)).toBe(true);
  });

  it("scalar-encoder: full overlap at the reference, none far away", () => {
    const [o] = SIMS["scalar-encoder"]({}, {});
    expect(o.points.find((p) => p.x === 50).y).toBe(21);
    expect(o.points[0].y).toBe(0);
  });
});
