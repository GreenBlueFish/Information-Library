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

  it("dendrite-match: more active cells than cells is clamped, not a flat line at the floor", () => {
    const [fm, miss] = SIMS["dendrite-match"]({}, { cells: 256, active: 400 });
    expect(fm.label.includes("clamped")).toBe(true);
    expect(fm.points.every((p) => Number.isFinite(p.y))).toBe(true);
    expect(fm.points.some((p) => p.y > -30) && miss.points.some((p) => p.y > -30)).toBe(true);
  });

  it("izhikevich-network: both populations spike, and more excitation means more spikes", () => {
    const total = (s) => ys(s).reduce((x, y) => x + y, 0);
    const [e, i] = SIMS["izhikevich-network"]({}, {});
    expect(total(e) > 0 && total(i) > 0).toBe(true);
    const [eHigh] = SIMS["izhikevich-network"]({}, { excitation: 1.5 });
    expect(total(eHigh) > total(e)).toBe(true);
    expect(JSON.stringify(SIMS["izhikevich-network"]({}, {})[0])).toBe(JSON.stringify(e));
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

  it("evidence-inference: with noisy sensing, evidence finds the object where elimination loses it", () => {
    const [evidence, elimination] = SIMS["evidence-inference"]({}, { noise: 10 });
    expect(evidence.points.at(-1).y > 90).toBe(true);
    expect(elimination.points.at(-1).y < 50).toBe(true);
  });
  it("tyre-curve: force peaks at peakSlip, and more load gives less than proportionally more grip", () => {
    const [light, mid, heavy] = SIMS["tyre-curve"]({}, { peakSlip: 7 });
    const peak = (s) => s.points.reduce((b, p) => (p.y > b.y ? p : b));
    expect(Math.abs(peak(mid).x - 7) < 0.3).toBe(true);
    expect(peak(heavy).y > peak(mid).y && peak(heavy).y < 1.5 * peak(mid).y).toBe(true);
    expect(peak(light).y > 0.5 * peak(mid).y).toBe(true);
  });

  it("cornering-speed: v = sqrt(mu g r) without downforce, and downforce only adds speed", () => {
    const [plain, aero] = SIMS["cornering-speed"]({}, { mu: 1, vTop: 1000 });
    const at = (s, r) => s.points.find((p) => Math.abs(p.x - r) < 1).y;
    expect(Math.abs(at(plain, 100) - Math.sqrt(9.81 * 100) * 3.6) < 0.5).toBe(true);
    expect(aero.points.every((p, i) => p.y >= plain.points[i].y)).toBe(true);
    expect(at(aero, 200) - at(plain, 200) > at(aero, 20) - at(plain, 20)).toBe(true);
  });

  it("weight-transfer: braking loads the front axle, accelerating the rear, total unchanged", () => {
    const [front, rear] = SIMS["weight-transfer"]({}, {});
    const first = 0, last = front.points.length - 1;
    expect(front.points[first].y > rear.points[first].y).toBe(true);
    expect(rear.points[last].y > front.points[last].y).toBe(true);
    const total = front.points[60].y + rear.points[60].y;
    expect(Math.abs(total - 1200 * 9.81 / 1000) < 1e-6).toBe(true);
  });
});

describe("widgets/sims (poker)", () => {
  it("outs-odds: exact draw odds match the combinatorics (9 outs: 35.0% by the river, 19.1% next card)", () => {
    const [twoCards, rule4, oneCard, rule2] = SIMS["outs-odds"]({}, {});
    const at = (s, o) => s.points.find((p) => p.x === o).y;
    expect(Math.abs(at(twoCards, 9) - 34.97) < 0.01).toBe(true);
    expect(Math.abs(at(oneCard, 9) - (100 * 9) / 47) < 1e-9).toBe(true);
    expect(at(rule4, 9)).toBe(36);
    expect(at(rule2, 9)).toBe(18);
    expect(at(twoCards, 0)).toBe(0);
  });

  it("call-ev: EV crosses zero at the pot-odds equity b/(p + 2b), and implied odds only add", () => {
    const [plain, implied] = SIMS["call-ev"]({}, { pot: 100, bet: 50, implied: 40 });
    const cross = plain.points.find((p) => Math.abs(p.x - 25) < 1e-9);
    expect(Math.abs(cross.y) < 1e-9).toBe(true);
    expect(implied.points.every((p, i) => p.y >= plain.points[i].y)).toBe(true);
  });

  it("bet-sizing: a pot-sized bet needs a 50% bluff, 50% defence and 33% caller equity", () => {
    const [bluff, mdf, caller] = SIMS["bet-sizing"]({}, { maxSize: 200, rake: 0 });
    const at = (s) => s.points.find((p) => Math.abs(p.x - 100) < 1e-9).y;
    expect(Math.abs(at(bluff) - 50) < 1e-9).toBe(true);
    expect(Math.abs(at(mdf) - 50) < 1e-9).toBe(true);
    expect(Math.abs(at(caller) - 100 / 3) < 1e-9).toBe(true);
    const [, , raked] = SIMS["bet-sizing"]({}, { maxSize: 200, rake: 5 });
    expect(at(raked) > at(caller)).toBe(true);
    const [rb, rm] = SIMS["bet-sizing"]({}, { maxSize: 200, rake: 5 });
    expect(Math.abs(at(rb) + at(rm) - 100) < 1e-9).toBe(true);
  });

  it("risk-of-ruin: exp(-2wB/sd^2), and half the win rate means more risk", () => {
    const [full, half] = SIMS["risk-of-ruin"]({}, { winrate: 5, sd: 90 });
    const at = (s, bi) => s.points.find((p) => Math.abs(p.x - bi) < 1e-9).y;
    expect(Math.abs(at(full, 30) - 100 * Math.exp((-2 * 5 * 3000) / 8100)) < 1e-9).toBe(true);
    expect(at(half, 30) > at(full, 30)).toBe(true);
    expect(at(full, 0)).toBe(100);
  });

  it("winrate-confidence: the band is mean +/- 1.96 sd sqrt(N/100), in buy-ins against thousands of hands", () => {
    const [mean, high, low] = SIMS["winrate-confidence"]({}, { winrate: 5, sd: 90, hands: 100 });
    const last = mean.points.length - 1;
    expect(mean.points[last].x).toBe(100);
    expect(Math.abs(mean.points[last].y - 50) < 1e-9).toBe(true);
    expect(Math.abs(high.points[last].y - 50 - (1.96 * 90 * Math.sqrt(1000)) / 100) < 1e-9).toBe(true);
    expect(Math.abs(mean.points[last].y - low.points[last].y - (high.points[last].y - mean.points[last].y)) < 1e-6).toBe(true);
  });

  it("icm: the textbook 50/30/20 example, equities sum to the pool, and big stacks are worth less than their chips", async () => {
    const { icm } = await import("../../../src/widgets/sims/poker.js");
    const eq = icm([5000, 3000, 2000], [0.5, 0.3, 0.2]);
    expect(eq.map((x) => Math.round(x * 1000))).toEqual([384, 328, 289]);
    expect(Math.abs(icm([4, 3, 2, 1], [0.5, 0.3, 0.2]).reduce((a, b) => a + b, 0) - 1) < 1e-12).toBe(true);
    const [curveIcm] = SIMS["icm-equity"]({}, { players: 4, payouts: "50/30/20" });
    const at = (s) => s.points.find((p) => Math.abs(p.x - 60) < 1e-9).y;
    expect(at(curveIcm) < 60).toBe(true);
    const [wta] = SIMS["icm-equity"]({}, { players: 5, payouts: "winner takes all" });
    expect(Math.abs(at(wta) - 60) < 1e-9).toBe(true);
    // two players left of a four-prize payout: they share the top two prizes, all of the money left
    const [two] = SIMS["icm-equity"]({}, { players: 2, payouts: "40/25/20/15" });
    expect(Math.abs(two.points.find((p) => p.x === 50).y - 50) < 1e-9).toBe(true);
  });
});

describe("widgets/sims (investing)", () => {
  it("compound-growth: matches the closed form, and a fee only lowers the balance", async () => {
    const { futureValue } = await import("../../../src/widgets/sims/investing.js");
    expect(Math.abs(futureValue(10000, 0, 0.07, 10) - 10000 * Math.pow(1 + 0.07 / 12, 120)) < 1e-6).toBe(true);
    expect(Math.abs(futureValue(0, 100, 0, 2) - 2400) < 1e-9).toBe(true);
    const [gross, net] = SIMS["compound-growth"]({}, {});
    expect(net.points.every((p, i) => p.y <= gross.points[i].y + 1e-9)).toBe(true);
  });

  it("volatility-drag: +50% then -50% compounds to -13.4% a year; zero volatility costs nothing", async () => {
    const { geometricFromArithmetic } = await import("../../../src/widgets/sims/investing.js");
    expect(Math.abs(geometricFromArithmetic(0, 0.5).exact - (Math.sqrt(0.75) - 1)) < 1e-12).toBe(true);
    expect(Math.abs(geometricFromArithmetic(0.08, 0).exact - 0.08) < 1e-12).toBe(true);
  });

  it("bond-price-yield: a bond at a yield equal to its coupon prices at par; price falls as yield rises", async () => {
    const { bondPrice, bondRisk } = await import("../../../src/widgets/sims/investing.js");
    expect(Math.abs(bondPrice(0.05, 0.05, 10) - 100) < 1e-9).toBe(true);
    expect(bondPrice(0.05, 0.06, 10) < 100).toBe(true);
    // a zero-coupon bond's Macaulay duration is its maturity
    expect(Math.abs(bondRisk(0, 0.04, 7).macaulay - 7) < 1e-9).toBe(true);
    // duration predicts a small move well
    const r = bondRisk(0.04, 0.04, 10);
    const exact = bondPrice(0.04, 0.0401, 10) - 100;
    expect(Math.abs(exact - -r.modified * 100 * 0.0001) < 0.002).toBe(true);
  });

  it("option models: Black-Scholes gives the textbook 10.4506 and satisfies put-call parity", async () => {
    const { blackScholes, normCdf } = await import("../../../src/widgets/sims/investing.js");
    expect(Math.abs(normCdf(0) - 0.5) < 1e-7).toBe(true);
    expect(Math.abs(normCdf(1.96) - 0.975) < 1e-4).toBe(true);
    const c = blackScholes(100, 100, 1, 0.05, 0.2, "call"), p = blackScholes(100, 100, 1, 0.05, 0.2, "put");
    expect(Math.abs(c.price - 10.4506) < 1e-3).toBe(true);
    expect(Math.abs(c.price - p.price - (100 - 100 * Math.exp(-0.05))) < 1e-6).toBe(true);
    expect(Math.abs(c.delta - p.delta - 1) < 1e-9).toBe(true);
  });

  it("option-payoff: a long call loses its premium below the strike; a covered call is capped", async () => {
    const { strategyProfit, blackScholes } = await import("../../../src/widgets/sims/investing.js");
    const prem = blackScholes(100, 100, 60 / 365, 0.04, 0.25, "call").price;
    expect(Math.abs(strategyProfit("long call", 100, 0.25, 60 / 365, 0.04, 80).atExpiry + prem) < 1e-9).toBe(true);
    const a = strategyProfit("covered call", 100, 0.25, 60 / 365, 0.04, 130).atExpiry;
    const b = strategyProfit("covered call", 100, 0.25, 60 / 365, 0.04, 150).atExpiry;
    expect(Math.abs(a - b) < 1e-9).toBe(true);
    for (const s of ["option-payoff", "option-greeks"]) {
      expect(SIMS[s]({}, {}).every((ser) => ser.points.every((p) => Number.isFinite(p.y)))).toBe(true);
    }
  });

  it("dcf: a constant-growth case matches the Gordon formula", async () => {
    const { dcfValue } = await import("../../../src/widgets/sims/investing.js");
    // growth equal in both stages: value = FCF (1 + g) / (r - g)
    const v = dcfValue(10, 0.03, 5, 0.03, 0.08).total;
    expect(Math.abs(v - (10 * 1.03) / 0.05) < 1e-9).toBe(true);
  });

  it("portfolio: two-asset risk, diversification floor and CAPM", async () => {
    const { twoAsset, equalWeightVol, capm } = await import("../../../src/widgets/sims/investing.js");
    expect(Math.abs(twoAsset(0.5, 0.1, 0.2, 0.1, 0.2, -1).vol) < 1e-12).toBe(true);
    expect(Math.abs(twoAsset(0.5, 0.1, 0.2, 0.04, 0.1, 1).vol - 0.15) < 1e-12).toBe(true);
    expect(Math.abs(equalWeightVol(1e9, 0.3, 0.25) - 0.15) < 1e-6).toBe(true);
    expect(capm(4, 1.5, 5)).toBe(11.5);
  });

  it("carry-trade: breaks even when the funding currency rises by the rate gap", async () => {
    const { carryReturn } = await import("../../../src/widgets/sims/investing.js");
    expect(Math.abs(carryReturn(0.005, 0.045, 1.005 / 1.045 - 1, 5) - 0.005) < 1e-12).toBe(true);
  });

  it("withdrawal: the same returns in a worse order leave less money", () => {
    const [badFirst, badLast] = SIMS["withdrawal"]({}, { rate: 5, real: 4 });
    expect(badFirst.points.at(-1).y < badLast.points.at(-1).y).toBe(true);
  });

  it("every investing simulator returns finite points at its defaults", () => {
    for (const s of ["compound-growth", "volatility-drag", "bond-price-yield", "dcf", "frontier", "diversification", "sml", "carry-trade", "leveraged-funds", "withdrawal"]) {
      const out = SIMS[s]({}, {});
      expect(out.length > 0).toBe(true);
      expect(out.every((ser) => ser.points.length > 0 && ser.points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)))).toBe(true);
    }
  });
});
