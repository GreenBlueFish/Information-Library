// src/widgets/sims/probability.js
//
// `parameter-plot` simulators for the Probability shelf (registered in ./index.js):
//
//   lln            running averages of i.i.d. samples (die, coin, exponential, Cauchy)
//   clt            histogram of standardised sums against the standard normal density
//   markov         a three-state chain's distribution over time and its stationary law
//   random-walk    simple random walk paths with the ±2√n envelope around the drift
//   bayes-update   beta prior and beta posterior for a coin's heads probability
//
// All pure functions of (config, state) returning PlotSeries[]; randomness comes
// from a seeded generator so a given seed always redraws the same picture.

const num = (state, config, key, def) => {
  const v = state && state[key] !== undefined ? Number(state[key]) : config && config[key] !== undefined ? Number(config[key]) : def;
  return Number.isFinite(v) ? v : def;
};
const str = (state, config, key, def) =>
  state && state[key] !== undefined ? String(state[key]) : config && config[key] !== undefined ? String(config[key]) : def;

/** Seeded uniform generator on [0, 1) (mulberry32). */
export function makeUniform(seed) {
  let a = (Math.round(seed) >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One draw from the named distribution, with its mean and standard deviation. */
export const SOURCES = {
  "fair die": { draw: (u) => 1 + Math.floor(6 * u()), mean: 3.5, sd: Math.sqrt(35 / 12) },
  "die roll": { draw: (u) => 1 + Math.floor(6 * u()), mean: 3.5, sd: Math.sqrt(35 / 12) },
  "fair coin (0/1)": { draw: (u) => (u() < 0.5 ? 1 : 0), mean: 0.5, sd: 0.5 },
  "coin flip (0/1)": { draw: (u) => (u() < 0.5 ? 1 : 0), mean: 0.5, sd: 0.5 },
  "exponential (mean 1)": { draw: (u) => -Math.log(1 - u()), mean: 1, sd: 1 },
  "exponential (skewed)": { draw: (u) => -Math.log(1 - u()), mean: 1, sd: 1 },
  uniform: { draw: (u) => u(), mean: 0.5, sd: Math.sqrt(1 / 12) },
  "Cauchy (no mean)": { draw: (u) => Math.tan(Math.PI * (u() - 0.5)), mean: NaN, sd: NaN },
};

export function lln(config, state) {
  const src = SOURCES[str(state, config, "dist", "fair die")] ?? SOURCES["fair die"];
  const n = Math.round(num(state, config, "n", 2000));
  const runs = Math.round(num(state, config, "runs", 3));
  const seed = num(state, config, "seed", 1);
  const series = [];
  const stride = Math.max(1, Math.floor(n / 400));
  for (let r = 0; r < runs; r++) {
    const u = makeUniform(seed * 7919 + r);
    let sum = 0;
    const pts = [];
    for (let k = 1; k <= n; k++) {
      sum += src.draw(u);
      if (k % stride === 0 || k === n || k < 20) pts.push({ x: k, y: sum / k });
    }
    series.push({ label: `run ${r + 1}: average ${(sum / n).toFixed(3)} after ${n}`, points: pts });
  }
  if (Number.isFinite(src.mean)) series.push({ label: `the mean ${src.mean}`, points: [{ x: 1, y: src.mean }, { x: n, y: src.mean }] });
  else series.push({ label: "0, the median (there is no mean)", points: [{ x: 1, y: 0 }, { x: n, y: 0 }] });
  return series;
}

export function clt(config, state) {
  const src = SOURCES[str(state, config, "dist", "exponential (skewed)")] ?? SOURCES["exponential (skewed)"];
  const n = Math.round(num(state, config, "n", 5));
  const samples = Math.round(num(state, config, "samples", 20000));
  const seed = num(state, config, "seed", 2);
  const u = makeUniform(seed);
  const lo = -4, hi = 4, width = 0.2, bins = Math.round((hi - lo) / width);
  const counts = new Array(bins).fill(0);
  let inside = 0;
  for (let s = 0; s < samples; s++) {
    let sum = 0;
    for (let k = 0; k < n; k++) sum += src.draw(u);
    const z = (sum - n * src.mean) / (src.sd * Math.sqrt(n));
    const b = Math.floor((z - lo) / width);
    if (b >= 0 && b < bins) { counts[b]++; inside++; }
  }
  const hist = [];
  counts.forEach((c, b) => {
    const h = c / (samples * width);
    hist.push({ x: lo + b * width, y: h }, { x: lo + (b + 1) * width, y: h });
  });
  const normal = [];
  for (let k = 0; k <= 160; k++) {
    const x = lo + ((hi - lo) * k) / 160;
    normal.push({ x, y: Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI) });
  }
  return [
    { label: `histogram of ${samples} standardised sums of ${n} term${n > 1 ? "s" : ""}`, points: hist },
    { label: "standard normal density", points: normal },
  ];
}

/** The base weather chain; the 'stay' control replaces the diagonal and rescales the rest of each row. */
export const BASE_CHAIN = [
  [0.7, 0.2, 0.1],
  [0.3, 0.4, 0.3],
  [0.2, 0.3, 0.5],
];
export const STATES = ["sunny", "cloudy", "rainy"];

export function chainWithStay(stay) {
  return BASE_CHAIN.map((row, i) => {
    const off = row.reduce((s, p, j) => (j === i ? s : s + p), 0);
    return row.map((p, j) => (j === i ? stay : ((1 - stay) * p) / off));
  });
}

export function stepDistribution(dist, P) {
  return [0, 1, 2].map((j) => dist.reduce((s, p, i) => s + p * P[i][j], 0));
}

export function stationary(P) {
  let d = [1 / 3, 1 / 3, 1 / 3];
  for (let k = 0; k < 5000; k++) d = stepDistribution(d, P);
  return d;
}

export function markov(config, state) {
  const P = chainWithStay(num(state, config, "stay", 0.5));
  const start = Math.max(0, STATES.indexOf(str(state, config, "start", "rainy")));
  const steps = Math.round(num(state, config, "steps", 20));
  let d = [0, 0, 0];
  d[start] = 1;
  const paths = [[], [], []];
  for (let n = 0; n <= steps; n++) {
    d.forEach((p, j) => paths[j].push({ x: n, y: p }));
    d = stepDistribution(d, P);
  }
  const pi = stationary(P);
  return [
    ...paths.map((pts, j) => ({ label: `P(${STATES[j]} on day n)`, points: pts })),
    ...pi.map((p, j) => ({ label: `stationary ${STATES[j]} = ${p.toFixed(3)}`, points: [{ x: 0, y: p }, { x: steps, y: p }] })),
  ];
}

export function randomWalk(config, state) {
  const p = num(state, config, "p", 0.5);
  const n = Math.round(num(state, config, "n", 500));
  const paths = Math.round(num(state, config, "paths", 4));
  const seed = num(state, config, "seed", 3);
  const series = [];
  const stride = Math.max(1, Math.floor(n / 500));
  for (let r = 0; r < paths; r++) {
    const u = makeUniform(seed * 104729 + r);
    let s = 0;
    const pts = [{ x: 0, y: 0 }];
    for (let k = 1; k <= n; k++) {
      s += u() < p ? 1 : -1;
      if (k % stride === 0 || k === n) pts.push({ x: k, y: s });
    }
    series.push({ label: `path ${r + 1} (ends at ${s})`, points: pts });
  }
  const drift = 2 * p - 1;
  const env = (sign) => {
    const pts = [];
    for (let k = 0; k <= 100; k++) {
      const x = (n * k) / 100;
      pts.push({ x, y: drift * x + sign * 2 * Math.sqrt(x * 4 * p * (1 - p)) });
    }
    return pts;
  };
  series.push({ label: "expected position ± 2 standard deviations", points: [...env(1), { x: 0, y: 0, move: true }, ...env(-1)] });
  return series;
}

/** log Γ(x) for x > 0: shift up to x ≥ 8, then Stirling's series (error below 1e-9). */
export function logGamma(x) {
  let shift = 0;
  while (x < 8) { shift += Math.log(x); x += 1; }
  const x2 = x * x;
  return (x - 0.5) * Math.log(x) - x + 0.5 * Math.log(2 * Math.PI)
    + 1 / (12 * x) - 1 / (360 * x * x2) + 1 / (1260 * x2 * x2 * x) - shift;
}

export function betaDensity(x, a, b) {
  if (x <= 0 || x >= 1) return 0;
  return Math.exp((a - 1) * Math.log(x) + (b - 1) * Math.log(1 - x) + logGamma(a + b) - logGamma(a) - logGamma(b));
}

export function bayesUpdate(config, state) {
  const a = num(state, config, "a", 2), b = num(state, config, "b", 2);
  const n = Math.round(num(state, config, "n", 10));
  const k = Math.min(n, Math.round(num(state, config, "k", 7)));
  const curve = (A, B) => {
    const pts = [];
    for (let i = 1; i < 400; i++) { const x = i / 400; pts.push({ x, y: betaDensity(x, A, B) }); }
    return pts;
  };
  const A = a + k, B = b + n - k;
  return [
    { label: `prior Beta(${a}, ${b}), mean ${(a / (a + b)).toFixed(3)}`, points: curve(a, b) },
    { label: `posterior Beta(${A}, ${B}) after ${k} heads in ${n}: mean ${(A / (A + B)).toFixed(3)}`, points: curve(A, B) },
  ];
}
