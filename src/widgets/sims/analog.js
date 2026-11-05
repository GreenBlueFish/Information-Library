// src/widgets/sims/analog.js
//
// Simulators for the Analog Design pages: textbook square-law MOS models and
// the first-order circuit equations built on them (Razavi, Design of Analog
// CMOS Integrated Circuits). Each is a pure function (config, state) ->
// PlotSeries[]; each control's `key` is the parameter it drives. Units are
// noted per simulator (mostly V, mA, kΩ, mS, fF).

import { num, curve } from "./util.js";

const K_BOLTZ = 1.380649e-23;
const Q = 1.602176634e-19;

/** Square-law drain current (mA) with channel-length modulation, any region. */
export function mosId(vgs, vds, vth, k, lambda) {
  const vov = vgs - vth;
  if (vov <= 0 || vds <= 0) return 0;
  const clm = 1 + lambda * vds;
  if (vds < vov) return k * (vov * vds - (vds * vds) / 2) * clm;
  return 0.5 * k * vov * vov * clm;
}

/** ID–VDS output characteristics at three gate voltages. k = μnCox·W/L in mA/V². */
export function mosIV(config, state) {
  const vgs = num(state, config, "vgs", 1.0);
  const vth = num(state, config, "vth", 0.5);
  const k = num(state, config, "k", 2);
  const lambda = num(state, config, "lambda", 0.1);
  const out = [-0.2, 0, 0.2].map((d) =>
    curve(`VGS = ${(vgs + d).toFixed(2)} V`, (v) => mosId(vgs + d, v, vth, k, lambda), 0, 2.5, 126));
  // the parabola ID = k·VDS²/2 where each curve leaves the triode region (VDS = VGS − VTH)
  out.push(curve("triode / saturation boundary", (v) => 0.5 * k * v * v, 0, Math.min(2.5, Math.max(0.05, vgs + 0.2 - vth)), 60));
  return out;
}

/** gm against ID for three device widths: gm = √(2·k·ID). k is for the base W/L. */
export function gmFromId(config, state) {
  const k = num(state, config, "k", 2);
  return [0.5, 1, 2].map((m) =>
    curve(`W/L ×${m}`, (id) => Math.sqrt(2 * k * m * id), 0, 1, 101));
}

/** Common-source stage with resistive load: Vout against Vin. RD in kΩ, k in mA/V². */
export function csTransfer(config, state) {
  const vdd = num(state, config, "vdd", 1.8);
  const rd = num(state, config, "rd", 2);
  const vth = num(state, config, "vth", 0.5);
  const k = num(state, config, "k", 2);
  const a = rd * k; // dimensionless: kΩ × mA/V²
  const vout = (vin) => {
    const vov = vin - vth;
    if (vov <= 0) return vdd;
    const sat = vdd - 0.5 * a * vov * vov;
    if (sat >= vov) return sat;
    const b = 1 + a * vov;
    return (b - Math.sqrt(Math.max(0, b * b - 2 * a * vdd))) / a;
  };
  return [
    curve("Vout", vout, 0, vdd, 181),
    curve("Vin − VTH (triode boundary)", (v) => Math.max(0, v - vth), 0, vdd, 181),
  ];
}

/** Differential pair: branch currents against the differential input (square law). */
export function diffPair(config, state) {
  const iss = num(state, config, "iss", 1);
  const k = num(state, config, "k", 4);
  const vmax = Math.sqrt((2 * iss) / k);
  const delta = (v) => {
    if (v >= vmax) return iss;
    if (v <= -vmax) return -iss;
    return (k / 2) * v * Math.sqrt(Math.max(0, (4 * iss) / k - v * v));
  };
  const lim = 1.5 * vmax;
  return [
    curve("ID1", (v) => (iss + delta(v)) / 2, -lim, lim, 201),
    curve("ID2", (v) => (iss - delta(v)) / 2, -lim, lim, 201),
    curve("ID1 − ID2", delta, -lim, lim, 201),
  ];
}

/** Basic vs cascode current mirror: output current against output voltage. */
export function currentMirror(config, state) {
  const iref = num(state, config, "iref", 100);
  const ratio = num(state, config, "ratio", 1);
  const lambda = num(state, config, "lambda", 0.1);
  const vov = num(state, config, "vov", 0.2);
  const vth = num(state, config, "vth", 0.5);
  const target = iref * ratio;
  // basic mirror: reference side sits at VGS, so λ makes the copy larger than Iref·ratio
  const basic = (v) => {
    const sat = (target * (1 + lambda * Math.max(v, vov))) / (1 + lambda * (vth + vov));
    return v >= vov ? sat : sat * (v / vov) * (2 - v / vov) * (v > 0 ? 1 : 0);
  };
  // cascode: λ is divided by the cascode's gain gm·ro = 2/(λ·Vov); needs ≈ VTH + 2·Vov of headroom
  const leff = (lambda * lambda * vov) / 2;
  const vmin = vth + 2 * vov;
  const casc = (v) => {
    const sat = target * (1 + leff * Math.max(v, vmin)) / (1 + leff * (vth + vov));
    if (v >= vmin) return sat;
    const x = Math.max(0, v) / vmin;
    return sat * x * (2 - x);
  };
  return [
    curve("basic mirror (µA)", basic, 0, 2.5, 201),
    curve("cascode mirror (µA)", casc, 0, 2.5, 201),
    curve("ideal (µA)", () => target, 0, 2.5, 2),
  ];
}

/** CS stage magnitude response with Miller effect. gm mS, R kΩ, C fF; x = log10(f / Hz). */
export function csFrequency(config, state) {
  const gm = num(state, config, "gm", 2);
  const rd = num(state, config, "rd", 10);
  const rs = num(state, config, "rs", 10);
  const cgs = num(state, config, "cgs", 100) * 1e-15;
  const cgd = num(state, config, "cgd", 30) * 1e-15;
  const cl = num(state, config, "cl", 200) * 1e-15;
  const a0 = gm * rd; // mS × kΩ is dimensionless
  const rsOhm = rs * 1e3;
  const rdOhm = rd * 1e3;
  const fin = 1 / (2 * Math.PI * rsOhm * (cgs + (1 + a0) * cgd));
  const fout = 1 / (2 * Math.PI * rdOhm * (cl + cgd * (1 + 1 / Math.max(a0, 1e-9))));
  const fNoMiller = 1 / (2 * Math.PI * rsOhm * (cgs + cgd));
  const mag = (f, p1, p2) => 20 * Math.log10((a0 / Math.sqrt(1 + (f / p1) ** 2)) / Math.sqrt(1 + (f / p2) ** 2));
  return [
    curve(`with Miller multiplication (poles ${(fin / 1e6).toFixed(1)}, ${(fout / 1e6).toFixed(1)} MHz)`, (lf) => mag(10 ** lf, fin, fout), 3, 11, 161),
    curve("if CGD were not multiplied", (lf) => mag(10 ** lf, fNoMiller, fout), 3, 11, 161),
    { label: `low-frequency gain ${a0.toFixed(1)} V/V = ${(20 * Math.log10(a0)).toFixed(1)} dB`, points: [{ x: 3, y: 20 * Math.log10(a0) }, { x: 11, y: 20 * Math.log10(a0) }] },
  ];
}

/** Input-referred voltage noise density (nV/√Hz) of a MOSFET: thermal floor plus 1/f. */
export function noiseSpectrum(config, state) {
  const gm = num(state, config, "gm", 2) * 1e-3;
  const gamma = num(state, config, "gamma", 0.67);
  const fc = num(state, config, "corner", 10000);
  const temp = num(state, config, "temp", 300);
  const thermal = Math.sqrt((4 * K_BOLTZ * temp * gamma) / gm) * 1e9;
  return [
    curve("thermal + flicker", (lf) => thermal * Math.sqrt(1 + fc / 10 ** lf), 0, 8, 161),
    curve(`thermal floor ${thermal.toFixed(2)} nV/√Hz`, () => thermal, 0, 8, 2),
  ];
}

/** Closed-loop gain A/(1+Aβ) against open-loop gain A (x = log10 A). */
export function feedbackGain(config, state) {
  const beta = num(state, config, "beta", 0.1);
  return [
    curve("closed-loop gain A/(1+Aβ)", (la) => { const a = 10 ** la; return a / (1 + a * beta); }, 0, 5, 101),
    curve(`ideal 1/β = ${(1 / beta).toFixed(1)}`, () => 1 / beta, 0, 5, 2),
    curve("open-loop gain A", (la) => Math.min(10 ** la, 1 / beta * 3), 0, 5, 101),
  ];
}

/** Step response of a feedback amplifier with two poles; time in 1/ω_u of the loop. */
export function stepResponse(config, state) {
  const t0 = num(state, config, "loopGain", 100); // low-frequency loop gain Aβ
  const r = num(state, config, "p2Ratio", 2); // second pole ÷ unity-loop-gain frequency
  const p1 = 1 / t0;
  const p2 = r;
  const wn2 = p1 * p2 * (1 + t0);
  const twoZw = p1 + p2;
  const dt = 0.002;
  const n = 6000;
  let y = 0, v = 0;
  const xs = [], ys = [];
  for (let i = 0; i < n; i++) {
    const acc = wn2 * (1 - y) - twoZw * v;
    v += acc * dt;
    y += v * dt;
    if (i % 20 === 0) { xs.push(i * dt); ys.push(y); }
  }
  const pm = 90 - (Math.atan(1 / r) * 180) / Math.PI;
  const peak = Math.max(...ys);
  return [
    { label: `output (phase margin ≈ ${pm.toFixed(0)}°, overshoot ${Math.max(0, (peak - 1) * 100).toFixed(0)}%)`, points: xs.map((x, i) => ({ x, y: ys[i] })) },
    { label: "final value", points: [{ x: 0, y: 1 }, { x: xs[xs.length - 1], y: 1 }] },
  ];
}

/** Bandgap reference: a CTAT base–emitter voltage plus a scaled PTAT voltage. */
export function bandgap(config, state) {
  const mult = num(state, config, "multiplier", 8.4);
  const n = num(state, config, "emitterRatio", 8);
  const vbe300 = 0.75;
  const vg = 1.2;
  const vbe = (c) => vg + ((vbe300 - vg) * (c + 273.15)) / 300;
  const vt = (c) => (K_BOLTZ * (c + 273.15)) / Q;
  const ptat = (c) => mult * vt(c) * Math.log(n);
  return [
    curve("VBE (falls with T)", vbe, -40, 125, 101),
    curve(`${mult.toFixed(1)}·VT·ln(${n}) (rises with T)`, ptat, -40, 125, 101),
    curve("VREF = sum", (c) => vbe(c) + ptat(c), -40, 125, 101),
  ];
}

/** Switched-capacitor integrator: output staircase against clock cycle. */
export function scIntegrator(config, state) {
  const ratio = num(state, config, "ratio", 0.25); // Cs / CF
  const vin = num(state, config, "vin", 0.1);
  const n = Math.round(num(state, config, "cycles", 20));
  const pts = [{ x: 0, y: 0 }];
  let v = 0;
  for (let i = 1; i <= n; i++) {
    v -= ratio * vin; // inverting integrator: ΔVout = −(Cs/CF)·Vin each clock
    pts.push({ x: i - 1e-3, y: pts[pts.length - 1].y }, { x: i, y: v });
  }
  return [{ label: "Vout", points: pts }];
}

/** Ring oscillator: frequency against stage count for a given per-stage delay. */
export function ringOscillator(config, state) {
  const td = num(state, config, "delay", 20); // ps per stage
  const vary = num(state, config, "vddScale", 1); // delay scales ~1/vddScale
  return [
    curve("oscillation frequency (GHz)", (n) => 1e3 / (2 * Math.round(n) * (td / vary)), 3, 31, 15),
  ];
}
