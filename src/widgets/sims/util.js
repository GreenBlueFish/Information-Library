// src/widgets/sims/util.js
//
// Small helpers shared by the simulators in this folder: reading parameter
// state with a fallback, a seeded random generator (so a plot is the same on
// every redraw for the same parameters), and building PlotSeries.

/** Read a numeric field from `state`, then `config`, then a fallback. */
export function num(state, config, key, fallback) {
  for (const src of [state, config]) {
    const v = src?.[key];
    const n = typeof v === "number" ? v : Number(v);
    if (v !== undefined && v !== "" && Number.isFinite(n)) return n;
  }
  return fallback;
}

/** Read a string field from `state`, then `config`, then a fallback. */
export function str(state, config, key, fallback) {
  for (const src of [state, config]) {
    if (typeof src?.[key] === "string" && src[key].length > 0) return src[key];
  }
  return fallback;
}

/** mulberry32: a tiny deterministic PRNG returning floats in [0, 1). */
export function rng(seed) {
  let a = (Math.floor(seed) >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A standard normal sample from a uniform generator (Box-Muller). */
export function gauss(rand) {
  const u = Math.max(rand(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

/**
 * A PlotSeries from parallel arrays, keeping about `max` points. Long runs are
 * decimated by keeping each chunk's lowest and highest sample in time order,
 * so a one-sample spike peak is never dropped.
 */
export function series(label, xs, ys, max = 1500) {
  const chunk = Math.ceil(xs.length / Math.max(1, Math.floor(max / 2)));
  if (chunk <= 1) return { label, points: xs.map((x, i) => ({ x, y: ys[i] })) };
  const points = [];
  for (let start = 0; start < xs.length; start += chunk) {
    let lo = start, hi = start;
    for (let i = start; i < Math.min(start + chunk, xs.length); i++) {
      if (ys[i] < ys[lo]) lo = i;
      if (ys[i] > ys[hi]) hi = i;
    }
    for (const i of lo <= hi ? [lo, hi] : [hi, lo]) points.push({ x: xs[i], y: ys[i] });
  }
  return { label, points };
}

/** A PlotSeries sampling y = f(x) over [x0, x1]. */
export function curve(label, f, x0, x1, n = 200) {
  const points = [];
  for (let i = 0; i < n; i++) {
    const x = x0 + ((x1 - x0) * i) / (n - 1);
    points.push({ x, y: f(x) });
  }
  return { label, points };
}

/**
 * A spike raster as one series per row: row `i` sits on baseline y = i and
 * each spike draws a tick up to y = i + 0.7.
 * @param {number[][]} trains spike times per row
 * @param {number} tEnd end of the time axis
 * @param {(i: number) => string} label
 */
export function raster(trains, tEnd, label) {
  return trains.map((times, i) => {
    const points = [{ x: 0, y: i }];
    for (const t of times) {
      points.push({ x: t, y: i }, { x: t, y: i + 0.7 }, { x: t, y: i });
    }
    points.push({ x: tEnd, y: i });
    return { label: label(i), points };
  });
}

/** Step current: `amp` between `on` and `off`, zero elsewhere. */
export const step = (t, amp, on, off) => (t >= on && t < off ? amp : 0);
