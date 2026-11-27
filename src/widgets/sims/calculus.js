// src/widgets/sims/calculus.js
//
// Simulators for the Calculus pages, all on f(x) = x^2 so every number on the
// page can be checked by hand: a tolerance band round a limit, secant lines
// closing on the tangent, and Riemann sums closing on the area.

import { num, curve } from "./util.js";

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const sq = (x) => x * x;

/** f(x) = x^2 for x within `delta` of 3, against the band 9 - eps to 9 + eps. */
export function limitBand(config, state) {
  const eps = clamp(num(state, config, "eps", 1), 0.05, 3);
  const d = clamp(num(state, config, "delta", 0.3), 0.01, 0.5);
  const lo = 3 - d, hi = 3 + d;
  return [
    curve("f(x) = x²", sq, lo, hi, 101),
    curve("9 + ε", () => 9 + eps, lo, hi, 2),
    curve("9 − ε", () => 9 - eps, lo, hi, 2),
  ];
}

/** x^2, the secant through x = a and x = a + h, and the tangent at x = a. */
export function secant(config, state) {
  const a = clamp(num(state, config, "a", 1), 0, 2);
  const h = clamp(num(state, config, "h", 1), 0.01, 2);
  const m = (sq(a + h) - sq(a)) / h;
  return [
    curve("f(x) = x²", sq, 0, 4, 161),
    curve(`secant, slope ${m.toFixed(2)}`, (x) => sq(a) + m * (x - a), 0, 4, 2),
    curve(`tangent at a, slope ${(2 * a).toFixed(2)}`, (x) => sq(a) + 2 * a * (x - a), 0, 4, 2),
  ];
}

/** Left and right Riemann sums of x^2 on [0, 2] with `n` equal strips. */
export function riemannSums(n) {
  const w = 2 / n;
  let left = 0, right = 0;
  for (let i = 0; i < n; i++) {
    left += sq(i * w) * w;
    right += sq((i + 1) * w) * w;
  }
  return { left, right };
}

/** The curve and the tops of the left and right rectangles. */
export function riemann(config, state) {
  const n = clamp(Math.round(num(state, config, "n", 4)), 1, 100);
  const w = 2 / n;
  const tops = (offset) => {
    const points = [];
    for (let i = 0; i < n; i++) {
      const y = sq((i + offset) * w);
      points.push({ x: i * w, y }, { x: (i + 1) * w, y });
    }
    return points;
  };
  const s = riemannSums(n);
  return [
    curve("f(x) = x²", sq, 0, 2, 101),
    { label: `left sum ${s.left.toFixed(4)}`, points: tops(0) },
    { label: `right sum ${s.right.toFixed(4)}`, points: tops(1) },
  ];
}
