// src/widgets/sims/investing.js
//
// Simulators for the Investing pages. Each is a pure function
// (config, state) -> PlotSeries[]; each control's `key` is the parameter it
// drives. They are the textbook formulas: compound growth with contributions
// and fees, volatility drag, bond price against yield with the duration and
// convexity approximations, a two-stage discounted cash flow, option payoffs
// and Black-Scholes values and Greeks, the two-asset efficient frontier,
// diversification against the number of holdings, the carry trade, the
// security market line, leveraged daily-rebalanced funds, and sequence risk
// in retirement withdrawals. All are deterministic.

import { num, str, curve, series } from "./util.js";

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

/* ------------------------------------------------------------------ growth */

/**
 * Balance after `years` of monthly compounding at annual rate `r` (decimal),
 * starting from `p0` and adding `pmt` at the end of each month.
 */
export function futureValue(p0, pmt, r, years) {
  const n = Math.round(years * 12);
  const i = r / 12;
  if (Math.abs(i) < 1e-12) return p0 + pmt * n;
  const g = Math.pow(1 + i, n);
  return p0 * g + (pmt * (g - 1)) / i;
}

/** Growth of a starting sum plus monthly saving, before and after a yearly fee (in thousands). */
export function compoundGrowth(config, state) {
  const p0 = Math.max(0, num(state, config, "initial", 10000));
  const pmt = Math.max(0, num(state, config, "monthly", 500));
  const r = num(state, config, "rate", 7) / 100;
  const fee = Math.max(0, num(state, config, "fee", 1)) / 100;
  const yrs = clamp(Math.round(num(state, config, "years", 30)), 1, 60);
  return [
    curve(`at ${(100 * r).toFixed(1)}% a year`, (t) => futureValue(p0, pmt, r, t) / 1000, 0, yrs, yrs * 4 + 1),
    curve(`after a ${(100 * fee).toFixed(2)}% yearly fee`, (t) => futureValue(p0, pmt, r - fee, t) / 1000, 0, yrs, yrs * 4 + 1),
    curve("money put in", (t) => (p0 + pmt * Math.round(t * 12)) / 1000, 0, yrs, yrs * 4 + 1),
  ];
}

/**
 * Geometric (compound) yearly growth for an arithmetic mean return `mu` and a
 * volatility `sigma` (decimals): the exact value for returns that alternate
 * mu + sigma and mu - sigma, and the standard approximation mu - sigma^2 / 2.
 */
export function geometricFromArithmetic(mu, sigma) {
  const up = 1 + mu + sigma, down = 1 + mu - sigma;
  const exact = up > 0 && down > 0 ? Math.sqrt(up * down) - 1 : -1;
  return { exact, approx: mu - (sigma * sigma) / 2 };
}

/** Compound growth against volatility for a fixed average return. */
export function volatilityDrag(config, state) {
  const mu = num(state, config, "mean", 8) / 100;
  return [
    curve("average (arithmetic) return", () => 100 * mu, 0, 60, 2),
    curve("compound return, alternating ±σ", (s) => 100 * geometricFromArithmetic(mu, s / 100).exact, 0, 60, 121),
    curve("approximation μ − σ²/2", (s) => 100 * geometricFromArithmetic(mu, s / 100).approx, 0, 60, 121),
  ];
}

/* ------------------------------------------------------------------- bonds */

/**
 * Price per 100 face of a bond paying an annual coupon `c` (decimal of face)
 * `f` times a year for `years`, at yield to maturity `y` (decimal, same
 * compounding as the coupons).
 */
export function bondPrice(c, y, years, f = 2) {
  const n = Math.max(1, Math.round(years * f));
  const cpn = (100 * c) / f;
  const i = y / f;
  if (Math.abs(i) < 1e-12) return cpn * n + 100;
  const d = Math.pow(1 + i, -n);
  return (cpn * (1 - d)) / i + 100 * d;
}

/**
 * Macaulay and modified duration (years) and convexity (years^2) of the same
 * bond, from its cash flows.
 */
export function bondRisk(c, y, years, f = 2) {
  const n = Math.max(1, Math.round(years * f));
  const cpn = (100 * c) / f;
  const i = y / f;
  let pv = 0, wt = 0, cx = 0;
  for (let k = 1; k <= n; k++) {
    const cf = cpn + (k === n ? 100 : 0);
    const disc = cf / Math.pow(1 + i, k);
    pv += disc;
    wt += (k / f) * disc;
    cx += (k * (k + 1) * disc) / Math.pow(1 + i, 2);
  }
  const macaulay = wt / pv;
  return { price: pv, macaulay, modified: macaulay / (1 + i), convexity: cx / (pv * f * f) };
}

/** Bond price against yield, with the duration line and duration+convexity curve at a chosen yield. */
export function bondPriceYield(config, state) {
  const c = num(state, config, "coupon", 4) / 100;
  const years = clamp(num(state, config, "maturity", 10), 0.5, 50);
  const y0 = num(state, config, "yield", 4) / 100;
  const { price: p0, modified: dm, convexity: cv } = bondRisk(c, y0, years);
  return [
    curve("price (per 100 face)", (y) => bondPrice(c, y / 100, years), 0, 15, 151),
    curve(`duration only (D = ${dm.toFixed(2)})`, (y) => p0 * (1 - dm * (y / 100 - y0)), 0, 15, 2),
    curve("duration + convexity", (y) => {
      const dy = y / 100 - y0;
      return p0 * (1 - dm * dy + 0.5 * cv * dy * dy);
    }, 0, 15, 151),
  ];
}

/* --------------------------------------------------------------- valuation */

/**
 * Two-stage discounted cash flow value: free cash flow `fcf` now, growing at
 * `g1` for `n` years, then forever at `g2`, discounted at `r` (decimals).
 * Returns { total, terminal } as present values.
 */
export function dcfValue(fcf, g1, n, g2, r) {
  let pv = 0, cf = fcf;
  for (let t = 1; t <= n; t++) {
    cf *= 1 + g1;
    pv += cf / Math.pow(1 + r, t);
  }
  if (r <= g2) return { total: Infinity, terminal: Infinity };
  const tv = (cf * (1 + g2)) / (r - g2);
  const pvTv = tv / Math.pow(1 + r, n);
  return { total: pv + pvTv, terminal: pvTv };
}

/** Value against the discount rate, split into the forecast years and the terminal value. */
export function dcf(config, state) {
  const fcf = num(state, config, "fcf", 10);
  const g1 = num(state, config, "growth", 8) / 100;
  const n = clamp(Math.round(num(state, config, "years", 5)), 1, 20);
  const g2 = num(state, config, "terminal", 2.5) / 100;
  const lo = Math.max(g2 * 100 + 0.5, 4);
  const cap = (v) => (Number.isFinite(v) ? Math.min(v, 2000) : 2000);
  return [
    curve("total value", (r) => cap(dcfValue(fcf, g1, n, g2, r / 100).total), lo, 16, 121),
    curve("of which terminal value", (r) => cap(dcfValue(fcf, g1, n, g2, r / 100).terminal), lo, 16, 121),
  ];
}

/* ----------------------------------------------------------------- options */

/** Standard normal cumulative distribution (Abramowitz and Stegun 26.2.17, |error| < 7.5e-8). */
export function normCdf(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp((-x * x) / 2);
  const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - p : p;
}

/** Standard normal density. */
export const normPdf = (x) => 0.3989422804014327 * Math.exp((-x * x) / 2);

/**
 * Black-Scholes value and Greeks of a European option on a non-dividend stock.
 * S spot, K strike, T years, r rate and v volatility (decimals).
 * Theta is per calendar day, vega per 1 volatility point.
 */
export function blackScholes(S, K, T, r, v, kind = "call") {
  if (T <= 0 || v <= 0) {
    const call = Math.max(0, S - K), put = Math.max(0, K - S);
    return { price: kind === "call" ? call : put, delta: kind === "call" ? (S > K ? 1 : 0) : (S < K ? -1 : 0), gamma: 0, vega: 0, theta: 0 };
  }
  const sq = v * Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + (v * v) / 2) * T) / sq;
  const d2 = d1 - sq;
  const disc = K * Math.exp(-r * T);
  const gamma = normPdf(d1) / (S * sq);
  const vega = (S * normPdf(d1) * Math.sqrt(T)) / 100;
  if (kind === "call") {
    return {
      price: S * normCdf(d1) - disc * normCdf(d2),
      delta: normCdf(d1),
      gamma,
      vega,
      theta: (-(S * normPdf(d1) * v) / (2 * Math.sqrt(T)) - r * disc * normCdf(d2)) / 365,
    };
  }
  return {
    price: disc * normCdf(-d2) - S * normCdf(-d1),
    delta: normCdf(d1) - 1,
    gamma,
    vega,
    theta: (-(S * normPdf(d1) * v) / (2 * Math.sqrt(T)) + r * disc * normCdf(-d2)) / 365,
  };
}

/**
 * The legs of each strategy: [kind, strike offset from K, quantity] where kind
 * is "call", "put" or "stock". Quantities are per share; negative is short.
 */
export const STRATEGIES = {
  "long call": [["call", 0, 1]],
  "long put": [["put", 0, 1]],
  "short put": [["put", 0, -1]],
  "covered call": [["stock", 0, 1], ["call", 10, -1]],
  "protective put": [["stock", 0, 1], ["put", -10, 1]],
  "bull call spread": [["call", 0, 1], ["call", 15, -1]],
  "long straddle": [["call", 0, 1], ["put", 0, 1]],
  "iron condor": [["put", -20, 1], ["put", -10, -1], ["call", 10, -1], ["call", 20, 1]],
  collar: [["stock", 0, 1], ["put", -10, 1], ["call", 10, -1]],
};

/**
 * Profit per share at expiry and value today (both net of the premiums paid
 * now, priced by Black-Scholes) for a strategy around strike K with the stock
 * bought at S0 = K.
 */
export function strategyProfit(name, K, v, T, r, S) {
  const legs = STRATEGIES[name] ?? STRATEGIES["long call"];
  const S0 = K;
  let atExpiry = 0, today = 0;
  for (const [kind, off, q] of legs) {
    if (kind === "stock") {
      atExpiry += q * (S - S0);
      today += q * (S - S0);
      continue;
    }
    const k = K + off;
    const cost = blackScholes(S0, k, T, r, v, kind).price;
    const payoff = kind === "call" ? Math.max(0, S - k) : Math.max(0, k - S);
    atExpiry += q * (payoff - cost);
    today += q * (blackScholes(S, k, T, r, v, kind).price - cost);
  }
  return { atExpiry, today };
}

/** Profit of an option strategy against the stock price at expiry and today. */
export function optionPayoff(config, state) {
  const name = str(state, config, "strategy", "long call");
  const K = 100;
  const v = Math.max(1, num(state, config, "vol", 25)) / 100;
  const days = Math.max(1, num(state, config, "days", 60));
  const T = days / 365;
  const r = num(state, config, "rate", 4) / 100;
  return [
    curve("profit at expiry", (S) => strategyProfit(name, K, v, T, r, S).atExpiry, 50, 150, 201),
    curve(`profit today (${days} days left)`, (S) => strategyProfit(name, K, v, T, r, S).today, 50, 150, 201),
    curve("break-even (0)", () => 0, 50, 150, 2),
  ];
}

/** A Black-Scholes value or Greek against the stock price for three times to expiry. */
export function optionGreeks(config, state) {
  const what = str(state, config, "measure", "call value");
  const K = 100;
  const v = Math.max(1, num(state, config, "vol", 25)) / 100;
  const r = num(state, config, "rate", 4) / 100;
  const pick = {
    "call value": (o) => o.price,
    "put value": (o) => o.price,
    delta: (o) => o.delta,
    gamma: (o) => o.gamma,
    "vega (per vol point)": (o) => o.vega,
    "theta (per day)": (o) => o.theta,
  }[what] ?? ((o) => o.price);
  const kind = what === "put value" ? "put" : "call";
  const out = [];
  for (const d of [365, 90, 14]) {
    out.push(curve(`${d} days to expiry`, (S) => pick(blackScholes(S, K, d / 365, r, v, kind)), 60, 140, 161));
  }
  if (what === "call value" || what === "put value") {
    out.push(curve("at expiry (intrinsic)", (S) => (kind === "call" ? Math.max(0, S - K) : Math.max(0, K - S)), 60, 140, 161));
  }
  return out;
}

/* --------------------------------------------------------------- portfolio */

/**
 * Expected return and volatility (decimals) of a two-asset portfolio with
 * weight w in A.
 */
export function twoAsset(w, ra, va, rb, vb, rho) {
  const ret = w * ra + (1 - w) * rb;
  const varp = w * w * va * va + (1 - w) * (1 - w) * vb * vb + 2 * w * (1 - w) * rho * va * vb;
  return { ret, vol: Math.sqrt(Math.max(0, varp)) };
}

/** The curve of portfolios from all B to all A, plus the two pure assets. */
export function frontier(config, state) {
  const ra = num(state, config, "retA", 8) / 100;
  const va = num(state, config, "volA", 18) / 100;
  const rb = num(state, config, "retB", 4) / 100;
  const vb = num(state, config, "volB", 6) / 100;
  const rho = clamp(num(state, config, "corr", 0), -1, 1);
  const xs = [], ys = [];
  for (let i = 0; i <= 100; i++) {
    const p = twoAsset(i / 100, ra, va, rb, vb, rho);
    xs.push(100 * p.vol);
    ys.push(100 * p.ret);
  }
  // the same mix if the two were perfectly correlated (a straight line)
  const line = [twoAsset(0, ra, va, rb, vb, 1), twoAsset(1, ra, va, rb, vb, 1)];
  return [
    series(`mixes of A and B (ρ = ${rho})`, xs, ys),
    { label: "if perfectly correlated (ρ = 1)", points: line.map((p) => ({ x: 100 * p.vol, y: 100 * p.ret })) },
  ];
}

/** Volatility of an equal-weight portfolio of n stocks, each of volatility s with pairwise correlation rho. */
export function equalWeightVol(n, s, rho) {
  return Math.sqrt((s * s) / n + (1 - 1 / n) * rho * s * s);
}

/** Portfolio volatility against the number of holdings, with its floor. */
export function diversification(config, state) {
  const s = num(state, config, "vol", 35) / 100;
  const rho = clamp(num(state, config, "corr", 0.3), 0, 1);
  return [
    curve("portfolio volatility", (n) => 100 * equalWeightVol(Math.round(n), s, rho), 1, 60, 60),
    curve("floor: market risk you can't diversify away", () => 100 * s * Math.sqrt(rho), 1, 60, 2),
  ];
}

/** CAPM expected return r_f + beta (E[R_m] - r_f), in percent. */
export function capm(rf, beta, erp) {
  return rf + beta * erp;
}

/**
 * The security market line, and a stock with beta `beta` that you expect to
 * return `forecast` (percent): the gap between them is its alpha.
 */
export function sml(config, state) {
  const rf = num(state, config, "rf", 4);
  const erp = num(state, config, "erp", 5);
  const beta = num(state, config, "beta", 1.2);
  const fc = num(state, config, "forecast", 12);
  return [
    curve("security market line (CAPM required return)", (b) => capm(rf, b, erp), 0, 2.5, 2),
    { label: `your stock: β ${beta}, alpha ${(fc - capm(rf, beta, erp)).toFixed(1)} points`, points: [{ x: beta, y: capm(rf, beta, erp) }, { x: beta, y: fc }] },
  ];
}

/* ---------------------------------------------------------------- currency */

/**
 * One-year return on the trader's own money from a carry trade: borrow the
 * funding currency at `rf`, hold the target at `rt`, with leverage L (assets /
 * equity), when the target currency moves `fx` against the funding currency
 * (decimals; fx < 0 means the funding currency strengthened).
 */
export function carryReturn(rf, rt, fx, L) {
  const asset = (1 + rt) * (1 + fx) - 1; // target deposit, in funding-currency terms
  return L * asset - (L - 1) * rf;
}

/**
 * Carry trade return beyond the funding rate (what keeping the money in the
 * funding currency would earn), on the trader's own money, against the
 * exchange-rate move: L (asset return - rf).
 */
export function carryTrade(config, state) {
  const rf = num(state, config, "funding", 0.5) / 100;
  const rt = num(state, config, "target", 4.5) / 100;
  const L = Math.max(1, num(state, config, "leverage", 5));
  const excess = (m, lev) => 100 * (carryReturn(rf, rt, m / 100, lev) - rf);
  return [
    curve("1× (own money only)", (m) => excess(m, 1), -20, 20, 81),
    curve(`levered ${L}×`, (m) => excess(m, L), -20, 20, 81),
    curve("break-even (0)", () => 0, -20, 20, 2),
  ];
}

/* ----------------------------------------------------- leverage and drift */

/**
 * Approximate yearly compound return of a daily-rebalanced fund with leverage
 * L on an index of arithmetic yearly return mu and volatility s (decimals),
 * with fee f and borrowing at rate rb on the borrowed part:
 * L mu - (L-1) rb - f - L^2 s^2 / 2.
 */
export function leveragedGrowth(L, mu, s, rb = 0, f = 0) {
  return L * mu - (L - 1) * rb - f - (L * L * s * s) / 2;
}

/** Compound return of 1×, 2× and 3× daily funds against the index's volatility. */
export function leveragedFunds(config, state) {
  const mu = num(state, config, "mean", 8) / 100;
  const rb = num(state, config, "borrow", 4) / 100;
  return [1, 2, 3].map((L) =>
    curve(`${L}× daily`, (s) => 100 * leveragedGrowth(L, mu, s / 100, rb, L === 1 ? 0 : 0.009), 0, 50, 101),
  );
}

/* --------------------------------------------------------------- spending */

/**
 * Balance path when withdrawing `w` (fixed, adjusted for nothing: a real
 * amount) at the start of each year from `b0`, with yearly returns `rets`.
 */
export function drawdownPath(b0, w, rets) {
  const out = [b0];
  let b = b0;
  for (const r of rets) {
    b = Math.max(0, (b - w) * (1 + r));
    out.push(b);
  }
  return out;
}

/**
 * Sequence risk: the same 30 yearly real returns in two orders (bad years
 * first, and bad years last), and the constant return with the same compound
 * average. The set: three years of -15%, then returns that bring the 30-year
 * compound average to `avg`.
 */
export function sequenceReturns(avg) {
  const bad = [-0.15, -0.15, -0.15];
  const total = Math.pow(1 + avg, 30);
  const rest = Math.pow(total / Math.pow(0.85, 3), 1 / 27) - 1;
  return bad.concat(Array(27).fill(rest));
}

/** Retirement balance over 30 years for two orders of the same returns. */
export function withdrawal(config, state) {
  const b0 = 1000;
  const rate = num(state, config, "rate", 4) / 100;
  const avg = num(state, config, "real", 4) / 100;
  const w = b0 * rate;
  const seq = sequenceReturns(avg);
  const years = Array.from({ length: 31 }, (_, i) => i);
  return [
    series("bad years first", years, drawdownPath(b0, w, seq)),
    series("bad years last", years, drawdownPath(b0, w, seq.slice().reverse())),
    series(`steady ${(100 * avg).toFixed(1)}% every year`, years, drawdownPath(b0, w, Array(30).fill(avg))),
  ];
}
