// Math › State-Space Systems: the maths in src/widgets/sims/statespace.js and
// the state-plane and state-3d widget types. Simulations are checked against
// closed forms, transfer functions and gains against values worked by hand.
import { describe, it, expect } from "../../harness.js";
import { ensureDom } from "../../dom.js";
import { mountWidget } from "../../../src/widgets/registry.js";
import * as S from "../../../src/widgets/sims/statespace.js";
import { model, walkSteps, stepGain, modeChoice, onEigenLine, DEFAULT_PARAMS as P2, TIME_OPTIONS } from "../../../src/widgets/types/state-plane.js";
import { model3, walkSteps3, DEFAULT_PARAMS as P3 } from "../../../src/widgets/types/state-3d.js";

const close = (a, b, tol = 1e-9) => { if (!(Math.abs(a - b) <= tol)) throw new Error(`${a} is not within ${tol} of ${b}`); };
const dom = await ensureDom();

async function withRealDocument(fn) {
  const prev = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { value: dom.document, configurable: true, writable: true });
  try { return await fn(); } finally {
    if (prev) Object.defineProperty(globalThis, "document", prev); else delete globalThis.document;
  }
}
const state2 = (over = {}) => ({ system: S.SYSTEMS2[0].name, time: TIME_OPTIONS[0], T: 0.2, input: S.INPUTS[0], x1: 1, x2: 0, k1: 0, k2: 0, ...over });
const state3 = (over = {}) => ({ system: S.SYSTEMS3[0].name, input: S.INPUTS[0], x1: 1, x2: 0, x3: 1, azimuth: -35, elevation: 25, ...over });

describe("state-space sims — matrix exponential and sampling", () => {
  it("e^(At) of a rotation generator is the rotation", () => {
    const E = S.expm([[0, -2], [2, 0]]);
    close(E[0][0], Math.cos(2), 1e-12); close(E[1][0], Math.sin(2), 1e-12); close(E[0][1], -Math.sin(2), 1e-12);
  });
  it("e^(At) of a Jordan block has the t·e^(λt) term", () => {
    const E = S.expm([[-1, 1], [0, -1]].map((r) => r.map((x) => 3 * x)));
    close(E[0][0], Math.exp(-3), 1e-12); close(E[0][1], 3 * Math.exp(-3), 1e-12); close(E[1][0], 0, 1e-15);
  });
  it("zero-order hold of x′ = −ax + u gives Φ = e^(−aT), Γ = (1 − e^(−aT))/a", () => {
    const { Phi, Gamma } = S.discretise([[-2]], [1], 0.3);
    close(Phi[0][0], Math.exp(-0.6), 1e-13); close(Gamma[0], (1 - Math.exp(-0.6)) / 2, 1e-13);
  });
  it("sampled poles are e^(sT) of the continuous poles", () => {
    for (const p of S.SYSTEMS2) {
      const { Phi } = S.discretise(p.A, p.B, 0.25);
      const zs = S.poles(Phi), want = S.poles(p.A).map((s) => S.sToZ(s, 0.25));
      for (const w of want) expect(zs.some((z) => Math.hypot(z.re - w.re, z.im - w.im) < 1e-6)).toBe(true);
    }
  });
});

describe("state-space sims — transfer functions, tests and gains", () => {
  it("gives the hand-worked transfer functions", () => {
    const tf = (name) => { const p = S.system2(name); return S.transferFunction(p.A, p.B, p.C, p.D); };
    const want = {
      "mass on a spring, light damping": [[0, 0, 1], [1, 1, 4]],
      "mass on a spring, heavy damping": [[0, 0, 1], [1, 3, 2]],
      "RLC circuit": [[0, 0, 2], [1, 2, 2]],
      "two tanks in a row": [[0, 0, 1], [1, 1.5, 0.5]],
      "DC motor, angle and speed": [[0, 0, 2], [1, 2, 0]],
      "pendulum balanced upright": [[0, 0, 1], [1, 0, -1]],
      "hidden mode: the input misses one": [[0, 1, 2], [1, 3, 2]],
      "hidden mode: the output misses one": [[0, 1, 2], [1, 3, 2]],
    };
    for (const [name, [num, den]] of Object.entries(want)) {
      const g = tf(name);
      num.forEach((x, i) => close(g.num[i], x, 1e-12));
      den.forEach((x, i) => close(g.den[i], x, 1e-12));
    }
    const p = S.system3("spring with a slow actuator");
    const g = S.transferFunction(p.A, p.B, p.C, p.D);
    [0, 0, 0, 5].forEach((x, i) => close(g.num[i], x, 1e-12));
    [1, 5.4, 6, 20].forEach((x, i) => close(g.den[i], x, 1e-12));
  });
  it("G(s) equals C(sI − A)⁻¹B at a test point for every preset", () => {
    for (const p of [...S.SYSTEMS2, ...S.SYSTEMS3]) {
      const s0 = 0.37, n = p.A.length;
      const M = S.inv(p.A.map((row, i) => row.map((x, j) => (i === j ? s0 : 0) - x)));
      const direct = S.dotv(p.C, S.mv(M, p.B)) + p.D;
      const g = S.transferFunction(p.A, p.B, p.C, p.D);
      close(S.polyAt(g.num, s0) / S.polyAt(g.den, s0), direct, 1e-9);
      expect(g.den.length).toBe(n + 1);
    }
  });
  it("finds the hidden modes", () => {
    const a = S.system2("hidden mode: the input misses one"), b = S.system2("hidden mode: the output misses one");
    expect(S.isControllable(a.A, a.B)).toBe(false); expect(S.isObservable(a.A, a.C)).toBe(true);
    expect(S.isControllable(b.A, b.B)).toBe(true); expect(S.isObservable(b.A, b.C)).toBe(false);
    for (const p of S.SYSTEMS2.slice(0, 8)) { expect(S.isControllable(p.A, p.B)).toBe(true); expect(S.isObservable(p.A, p.C)).toBe(true); }
  });
  it("Ackermann's formula puts the poles where asked", () => {
    for (const p of S.SYSTEMS2.filter((q) => q.place)) {
      const K = S.ackermann(p.A, p.B, p.place);
      const cl = S.closedLoop(p.A, p.B, p.C, p.D, K);
      const { c } = S.leverrier(cl.A);
      close(c[0], p.place[0], 1e-9); close(c[1], p.place[1], 1e-9);
    }
    const m = S.system2("mass on a spring, light damping");
    const K = S.ackermann(m.A, m.B, [4, 8]);
    close(K[0], 4, 1e-12); close(K[1], 3, 1e-12);
    const pend = S.system2("pendulum balanced upright");
    const Kp = S.ackermann(pend.A, pend.B, pend.place);
    close(Kp[0], 3, 1e-12); close(Kp[1], 2, 1e-12);
    const h = S.system2("hidden mode: the input misses one");
    expect(S.ackermann(h.A, h.B, [4, 8])).toBe(null);
  });
  it("the walk-through's gain lands on the 0.1 grid and gives stable poles", () => {
    for (const p of S.SYSTEMS2) for (const time of TIME_OPTIONS) {
      const md = model(state2({ system: p.name, time }));
      const K = stepGain(md);
      K.forEach((k) => { close(Math.round(k * 10) / 10, k, 1e-12); expect(Math.abs(k) <= 10).toBe(true); });
      const after = model(state2({ system: p.name, time, k1: K[0], k2: K[1] }));
      expect(after.stab).toBe("stable");
    }
  });
});

describe("state-space sims — simulation", () => {
  it("the free response equals e^(At)x(0) at the end of the plot", () => {
    for (const p of S.SYSTEMS2) {
      const tEnd = 3;
      const sim = S.simulate(p, { x0: [1, -0.5], tEnd });
      const want = S.mv(S.expm(p.A.map((r) => r.map((x) => x * tEnd))), [1, -0.5]);
      const got = sim.x[sim.x.length - 1];
      close(got[0], want[0], 1e-8 * Math.max(1, Math.abs(want[0]))); close(got[1], want[1], 1e-8 * Math.max(1, Math.abs(want[1])));
    }
  });
  it("a step settles at the steady-state gain G(0) for the stable presets", () => {
    for (const p of S.SYSTEMS2) {
      if (S.stability(S.poles(p.A)) !== "stable") continue;
      const sim = S.simulate(p, { x0: [0, 0], input: S.INPUTS[1], tEnd: 40 });
      const g = S.transferFunction(p.A, p.B, p.C, p.D);
      close(sim.y[sim.y.length - 1], g.num[2] / g.den[2], 1e-6);
    }
  });
  it("an impulse response is C e^(At) B", () => {
    const p = S.system2("mass on a spring, light damping");
    const sim = S.simulate(p, { x0: [0, 0], input: S.INPUTS[2], tEnd: 2, n: 200 });
    const want = S.dotv(p.C, S.mv(S.expm(p.A.map((r) => r.map((x) => 2 * x))), p.B));
    close(sim.y[200], want, 1e-10);
  });
  it("sampling without feedback puts the samples on the continuous path", () => {
    const p = S.system2("RLC circuit");
    const d = S.simulate(p, { x0: [1, 0], discrete: true, T: 0.25, tEnd: 5 });
    const c = S.simulate(p, { x0: [1, 0], tEnd: 5, n: 400 });
    for (let k = 0; k < d.t.length; k++) {
      const i = Math.round(d.t[k] / (5 / 400));
      close(d.x[k][0], c.x[i][0], 1e-9); close(d.x[k][1], c.x[i][1], 1e-9);
    }
  });
  it("time spans fit the slowest mode, an unstable one, and a triple pole", () => {
    close(S.timeSpan(S.poles(S.system2("two tanks in a row").A)), 10, 1e-9);
    close(S.timeSpan(S.poles(S.system2("pendulum balanced upright").A)), Math.log(30), 1e-9);
    close(S.timeSpan(S.poles(S.system3("chain of three lags 1/(s + 1)³").A)), 11, 1e-6);
  });
});

describe("state-space widgets", () => {
  it("walk-throughs have eight steps for every system, time and input, with no NaN", () => {
    for (const p of S.SYSTEMS2) for (const time of TIME_OPTIONS) for (const input of S.INPUTS) {
      const md = model(state2({ system: p.name, time, input }));
      const steps = walkSteps(md);
      expect(steps.length).toBe(8);
      for (const st of steps) expect(/NaN|undefined|Infinity/.test(st.title + st.text)).toBe(false);
    }
    for (const p of S.SYSTEMS3) for (const input of S.INPUTS) {
      const steps = walkSteps3(model3(state3({ system: p.name, input })));
      expect(steps.length).toBe(8);
      for (const st of steps) expect(/NaN|undefined|Infinity/.test(st.title + st.text)).toBe(false);
    }
  });
  it("the modes step puts x(0) exactly on an eigen-direction", () => {
    for (const p of S.SYSTEMS2) {
      const md = model(state2({ system: p.name }));
      const i = modeChoice(md);
      if (i < 0) continue;
      const x = onEigenLine(md, i), v = md.e.vectors[i];
      close(x[0] * v[1] - x[1] * v[0], 0, 1e-9);
    }
  });
  it("state-plane paints, walks through, and resets feedback on a new system", async () => {
    await import(`../../../src/widgets/types/state-plane.js?fresh=${Math.random()}`);
    await withRealDocument(async () => {
      const container = dom.document.createElement("div");
      const inst = mountWidget({ type: "state-plane", title: "t", params: P2 }, container);
      const r = () => container.querySelector(".widget__readout").textContent;
      expect(r().includes("Poles −0.5 ± 1.936j: stable")).toBe(true);
      expect(r().includes("G(s) = (1) / (s² + s + 4)")).toBe(true);
      expect(container.querySelectorAll(".ss-field").length > 100).toBe(true);
      expect(container.querySelectorAll(".ss-pole").length).toBe(2);
      const next = [...container.querySelectorAll("button")].find((b) => b.textContent.includes("Next"));
      for (let i = 0; i < 8; i++) next.click();
      expect(container.querySelector(".zs-walk").textContent.startsWith("Step 8 of 8")).toBe(true);
      expect(r().includes("Poles −2 ± 2j: stable")).toBe(true);
      expect(container.querySelectorAll(".ss-pole--open").length).toBe(2);
      inst.update({ time: TIME_OPTIONS[1] });
      expect(container.querySelectorAll(".zs-ucircle").length).toBe(1);
      const sel = container.querySelector("select");
      sel.value = "pendulum balanced upright";
      sel.dispatchEvent(new dom.window.Event("input"));
      expect(r().includes("Feedback")).toBe(false);
      expect(r().includes("unstable")).toBe(true);
      inst.destroy();
    });
  });
  it("state-3d paints the path, the eigen-lines and the plane of a complex pair", async () => {
    await import(`../../../src/widgets/types/state-3d.js?fresh=${Math.random()}`);
    await withRealDocument(async () => {
      const container = dom.document.createElement("div");
      const inst = mountWidget({ type: "state-3d", title: "t", params: P3 }, container);
      const r = () => container.querySelector(".widget__readout").textContent;
      expect(r().includes("Poles −0.2 ± 1.99j and −5: stable")).toBe(true);
      expect(container.querySelectorAll(".eg-eigline").length).toBe(1);
      expect(container.querySelectorAll(".eg-plane").length).toBe(1);
      inst.update({ system: "three tanks in a row" });
      expect(container.querySelectorAll(".eg-eigline").length).toBe(3);
      expect(container.querySelectorAll(".eg-plane").length).toBe(0);
      inst.update({ system: "Lorenz system near the origin" });
      expect(r().includes("Not controllable, not observable")).toBe(true);
      inst.destroy();
    });
  });
});
