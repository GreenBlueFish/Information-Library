// Probability shelf: the parameter-plot simulators in src/widgets/sims/probability.js.
import { describe, it, expect } from "../../harness.js";
import * as p from "../../../src/widgets/sims/probability.js";

const close = (a, b, tol) => { if (Math.abs(a - b) > tol) throw new Error(`${a} is not within ${tol} of ${b}`); };

describe("probability sims", () => {
  it("the seeded generator is reproducible and roughly uniform", () => {
    const a = p.makeUniform(5), b = p.makeUniform(5);
    let s = 0;
    for (let i = 0; i < 20000; i++) { const x = a(); expect(x === b()).toBe(true); s += x; }
    close(s / 20000, 0.5, 0.01);
  });

  it("running averages of a die settle near 3.5", () => {
    const series = p.lln({}, { dist: "fair die", n: 20000, runs: 2, seed: 4 });
    for (const run of series.slice(0, 2)) close(run.points[run.points.length - 1].y, 3.5, 0.05);
  });

  it("the CLT histogram is a normalised density close to the normal for n = 30", () => {
    const [hist, normal] = p.clt({}, { dist: "exponential (skewed)", n: 30, samples: 20000, seed: 2 });
    let area = 0;
    for (let i = 1; i < hist.points.length; i += 2) area += hist.points[i].y * 0.2;
    close(area, 1, 0.01);
    const at0 = hist.points.find((pt) => Math.abs(pt.x - 0) < 1e-9).y;
    close(at0, normal.points[80].y, 0.04);
  });

  it("the Markov chain's stationary law matches the numpy eigenvector, and rows sum to 1", () => {
    const pi = p.stationary(p.BASE_CHAIN);
    close(pi[0], 0.4565, 1e-4); close(pi[1], 0.2826, 1e-4); close(pi[2], 0.2609, 1e-4);
    for (const stay of [0, 0.3, 0.95]) for (const row of p.chainWithStay(stay)) close(row.reduce((s, x) => s + x, 0), 1, 1e-12);
  });

  it("random-walk paths take ±1 steps", () => {
    const [path] = p.randomWalk({}, { p: 0.5, n: 100, paths: 1, seed: 9 });
    for (let i = 1; i < path.points.length; i++) expect(Math.abs(path.points[i].y - path.points[i - 1].y)).toBe(1);
  });

  it("beta densities integrate to 1 and the posterior uses the conjugate update", () => {
    let s = 0;
    for (let i = 1; i < 10000; i++) s += p.betaDensity(i / 10000, 9, 5) / 10000;
    close(s, 1, 1e-4);
    close(p.logGamma(5), Math.log(24), 1e-8);
    expect(p.bayesUpdate({}, { a: 2, b: 2, n: 10, k: 7 })[1].label.includes("Beta(9, 5)")).toBe(true);
    expect(p.bayesUpdate({}, { a: 1, b: 1, n: 3, k: 50 })[1].label.includes("Beta(4, 1)")).toBe(true); // k capped at n
  });
});
