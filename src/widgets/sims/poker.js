// src/widgets/sims/poker.js
//
// Simulators for the Poker pages: the chance of hitting a draw, the value of a
// call, the thresholds a bet size sets, the risk of ruin of a bankroll, how far
// a measured win rate can stray from the true one, and tournament equity by
// the Independent Chip Model. Each is a pure function (config, state) ->
// PlotSeries[]; each control's `key` is the parameter it drives. All are exact
// formulas (combinatorics, expected value, the Malmuth-Harville model) or the
// standard normal approximations used in poker texts.

import { num, str, curve } from "./util.js";

/** Binomial coefficient n choose k (0 when k is out of range). */
export function choose(n, k) {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
}

/**
 * Chance (0-1) that at least one of `outs` cards comes when `draws` cards are
 * dealt from `unseen` cards: 1 - C(unseen - outs, draws) / C(unseen, draws).
 */
export function hitChance(outs, unseen, draws) {
  if (outs <= 0) return 0;
  return 1 - choose(unseen - outs, draws) / choose(unseen, draws);
}

/**
 * Chance of hitting against the number of outs: exact by the turn and river
 * (two cards to come) and by the next card, beside the rule of 4 and 2.
 * `unseen` is the number of cards unseen on the flop (47 heads-up).
 */
export function outsOdds(config, state) {
  const unseen = Math.round(Math.min(50, Math.max(30, num(state, config, "unseen", 47))));
  const pct = (f) => (x) => 100 * f(Math.round(x));
  return [
    curve("exact, turn and river", pct((o) => hitChance(o, unseen, 2)), 0, 20, 21),
    curve("rule of 4 (4 × outs)", (o) => Math.min(100, 4 * Math.round(o)), 0, 20, 21),
    curve("exact, next card only", pct((o) => hitChance(o, unseen, 1)), 0, 20, 21),
    curve("rule of 2 (2 × outs)", (o) => 2 * Math.round(o), 0, 20, 21),
  ];
}

/**
 * Expected value (in big blinds) of calling a bet, relative to folding, for a
 * hand with equity `eq` (0-1): eq·(pot + bet + implied) - (1 - eq)·bet, where
 * `pot` includes the bet already made and `implied` is what more the caller
 * expects to win on later streets when they hit.
 */
export function callEV(eq, pot, bet, implied = 0) {
  return eq * (pot + implied) - (1 - eq) * bet;
}

/** EV of calling against the caller's equity, with and without implied odds. */
export function callEv(config, state) {
  const pot = Math.max(0, num(state, config, "pot", 10)); // before the bet
  const bet = Math.max(0, num(state, config, "bet", 5));
  const implied = Math.max(0, num(state, config, "implied", 0));
  return [
    curve("EV of calling (bb)", (e) => callEV(e / 100, pot + bet, bet, 0), 0, 100, 101),
    curve(`with ${implied} bb implied odds`, (e) => callEV(e / 100, pot + bet, bet, implied), 0, 100, 101),
    curve("folding (0)", () => 0, 0, 100, 2),
  ];
}

/**
 * What a bet of `b` into a pot of `p` demands, as fractions, with a share `r`
 * of the final pot taken as rake: how often a pure bluff must work, the
 * minimum defence frequency, and the equity a caller needs (which is also the
 * share of bluffs in a balanced, polarised river range when r = 0).
 */
export function betThresholds(b, p, r = 0) {
  return {
    bluff: b / (p * (1 - r) + b),
    mdf: p / (p + b),
    callerEquity: b / ((p + 2 * b) * (1 - r)),
  };
}

/** The three thresholds against bet size as a percentage of the pot. */
export function betSizing(config, state) {
  const rake = Math.min(0.2, Math.max(0, num(state, config, "rake", 0) / 100));
  const maxSize = Math.min(500, Math.max(50, num(state, config, "maxSize", 200)));
  const at = (k) => (s) => 100 * betThresholds(s / 100, 1, rake)[k];
  return [
    curve("a bluff must work (%)", at("bluff"), 0, maxSize, 201),
    curve("minimum defence frequency (%)", at("mdf"), 0, maxSize, 201),
    curve("caller's required equity (%)", at("callerEquity"), 0, maxSize, 201),
  ];
}

/**
 * Risk of ruin (0-1) for a bankroll of `bank` big blinds, a win rate `w` and a
 * standard deviation `sd` (both in big blinds per 100 hands), by the diffusion
 * formula exp(-2·w·B / sd²). A losing or break-even player is ruined for sure.
 */
export function riskOfRuin(bank, w, sd) {
  if (w <= 0) return 1;
  return Math.min(1, Math.exp((-2 * w * bank) / (sd * sd)));
}

/** Risk of ruin against bankroll in 100-big-blind buy-ins. */
export function ruin(config, state) {
  const w = num(state, config, "winrate", 5);
  const sd = Math.max(1, num(state, config, "sd", 90));
  const series = (label, rate) => curve(label, (bi) => 100 * riskOfRuin(bi * 100, rate, sd), 0, 100, 201);
  return [
    series(`win rate ${w} bb/100`, w),
    series(`half that (${w / 2} bb/100)`, w / 2),
  ];
}

/** Expected winnings and the 95% band after `hands` hands (bb). */
export function winBand(hands, w, sd) {
  const blocks = hands / 100;
  const mean = w * blocks;
  const half = 1.96 * sd * Math.sqrt(blocks);
  return { mean, low: mean - half, high: mean + half };
}

/**
 * Winnings against hands played: the expectation and a 95% band around it.
 * Hands are in thousands (`hands` is the most shown) and winnings in buy-ins
 * of 100 bb, so the axis labels stay short.
 */
export function winrateConfidence(config, state) {
  const w = num(state, config, "winrate", 5);
  const sd = Math.max(1, num(state, config, "sd", 90));
  const maxK = Math.max(1, num(state, config, "hands", 100));
  const f = (k) => (thousands) => winBand(thousands * 1000, w, sd)[k] / 100;
  return [
    curve("expected winnings (buy-ins)", f("mean"), 0, maxK, 201),
    curve("95% band, high", f("high"), 0, maxK, 201),
    curve("95% band, low", f("low"), 0, maxK, 201),
  ];
}

/**
 * Prize equity of each player by the Independent Chip Model (Malmuth-Harville):
 * a player finishes first with probability stack / total chips, and the rest
 * finish in the same way among the remaining players. Returns each player's
 * expected share of the prize pool, for `payouts` (fractions, 1st first).
 */
export function icm(stacks, payouts) {
  const n = stacks.length;
  const memo = new Map();
  // eq(mask) -> array: expected payout of each player when the players in
  // `mask` remain and are competing for places n - |mask| onwards.
  const eq = (mask) => {
    if (memo.has(mask)) return memo.get(mask);
    const out = new Array(n).fill(0);
    let total = 0, left = 0;
    for (let i = 0; i < n; i++) if (mask & (1 << i)) { total += stacks[i]; left++; }
    const place = n - left;
    if (left === 0 || place >= payouts.length || total <= 0) {
      memo.set(mask, out);
      return out;
    }
    for (let i = 0; i < n; i++) {
      if (!(mask & (1 << i))) continue;
      const p = stacks[i] / total;
      if (p === 0) continue;
      out[i] += p * payouts[place];
      const rest = eq(mask & ~(1 << i));
      for (let j = 0; j < n; j++) out[j] += p * rest[j];
    }
    memo.set(mask, out);
    return out;
  };
  return eq((1 << n) - 1);
}

/** The payout structures the ICM plot offers, as fractions of the prize pool. */
export const PAYOUTS = {
  "50/30/20": [0.5, 0.3, 0.2],
  "65/35": [0.65, 0.35],
  "winner takes all": [1],
  "40/25/20/15": [0.4, 0.25, 0.2, 0.15],
};

/**
 * One player's prize equity against their share of the chips, with the other
 * players splitting the rest evenly, beside the chip-proportional share.
 */
export function icmEquity(config, state) {
  const payouts = PAYOUTS[str(state, config, "payouts", "50/30/20")] ?? PAYOUTS["50/30/20"];
  // at least as many players as prizes, so the whole pool is still to be won
  const players = Math.round(Math.min(9, Math.max(2, payouts.length, num(state, config, "players", 4))));
  const hero = (share) => {
    const s = Math.min(0.999, Math.max(0.001, share / 100));
    const others = (1 - s) / (players - 1);
    const stacks = [s, ...new Array(players - 1).fill(others)];
    return 100 * icm(stacks, payouts)[0];
  };
  return [
    curve("ICM prize equity (%)", hero, 0, 100, 101),
    curve("chip share (%)", (s) => s, 0, 100, 2),
  ];
}
