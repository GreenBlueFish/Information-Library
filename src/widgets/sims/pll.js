// src/widgets/sims/pll.js
//
// Simulators for the PLL Building Blocks chapter of Analog Design: the
// phase/frequency detector characteristic with reset delay, dead zone and
// up/down mismatch; the loop-gain phase of a charge-pump PLL with a
// second- or third-order passive filter; a PLL output phase-noise budget; and
// free-running VCO phase noise from a figure of merit. Each is a pure function
// (config, state) -> PlotSeries[].

import { num, curve } from "./util.js";

const TWO_PI = 2 * Math.PI;

/**
 * Average charge-pump current (in units of I_P) for a constant phase error
 * `phi` (rad) between equal-frequency inputs, for a tristate PFD.
 * reset: reset-pulse width as a fraction of the reference period;
 * wmin: shortest pulse that turns a switch on (fraction of the period);
 * mismatch: (I_UP - I_DN) / I_P.
 * A positive phi means the reference leads. Edges that land while the reset is
 * still active are missed, so beyond 2*pi*(1 - reset) the output wraps to the
 * other sign (the blind zone).
 */
export function pfdAverage(phi, reset, wmin, mismatch) {
  let p = phi;
  const lim = TWO_PI * (1 - reset);
  if (p > lim) p -= TWO_PI;
  else if (p < -lim) p += TWO_PI;
  const iUp = 1 + mismatch / 2;
  const iDn = 1 - mismatch / 2;
  const w = Math.abs(p) / TWO_PI;
  const lead = Math.max(0, w + reset - wmin); // the leading output's effective width
  const lag = Math.max(0, reset - wmin); // the lagging output: the reset pulse only
  return p >= 0 ? iUp * lead - iDn * lag : iUp * lag - iDn * lead;
}

/** PFD/CP characteristic against phase error (x in units of pi, -2..2). */
export function pfdCharacteristic(config, state) {
  const reset = num(state, config, "reset", 5) / 100;
  const wmin = num(state, config, "wmin", 1) / 100;
  const mismatch = num(state, config, "mismatch", 0) / 100;
  return [
    curve("average CP current / I_P", (x) => pfdAverage(x * Math.PI, reset, wmin, mismatch), -2, 2, 801),
    curve("ideal PFD (no reset delay, no dead zone)", (x) => (Math.abs(x) >= 2 ? Math.sign(x) : x / 2), -2, 2, 401),
  ];
}

/**
 * Open-loop phase (degrees) of a type II charge-pump PLL with a second-order
 * passive filter (R in series with C1, C2 across both), normalised so the
 * crossover sits at the geometric mean of the zero and the pole, plus an
 * optional extra pole (R3-C3 section) at ratio p3 times the crossover.
 * b = 1 + C1/C2. Returns the phase at w/wc = 10^lx.
 */
export function loopPhase(lx, b, p3) {
  const r = 10 ** lx; // omega / omega_c
  const sb = Math.sqrt(b);
  let ph = -180 + (Math.atan(r * sb) - Math.atan(r / sb)) * (180 / Math.PI);
  if (p3 > 0) ph -= Math.atan(r / p3) * (180 / Math.PI);
  return ph;
}

/** Phase margin (degrees) of the same loop at its designed crossover. */
export function phaseMargin(b, p3) {
  return 180 + loopPhase(0, b, p3);
}

/** Loop-gain phase against log10(omega/omega_c) for a chosen capacitor ratio. */
export function loopFilterPhase(config, state) {
  const ratio = num(state, config, "ratio", 15); // C1 / C2
  const p3 = num(state, config, "pole3", 0); // omega_3 / omega_c, 0 = no third pole
  const b = 1 + ratio;
  const pm = phaseMargin(b, p3);
  const out = [
    curve(`loop-gain phase, phase margin ${pm.toFixed(1)}°`, (lx) => loopPhase(lx, b, p3), -2, 2, 241),
    { label: "−180° (oscillation)", points: [{ x: -2, y: -180 }, { x: 2, y: -180 }] },
  ];
  if (p3 > 0) out.push(curve("without the third pole", (lx) => loopPhase(lx, b, 0), -2, 2, 241));
  return out;
}

/**
 * Closed-loop transfer |H|^2 of a type II PLL (to the output, divided by N^2)
 * at offset f, natural frequency fn and damping zeta.
 */
export function closedLoopSq(f, fn, zeta) {
  const x = f / fn;
  const num_ = 1 + (2 * zeta * x) ** 2;
  const den = (1 - x * x) ** 2 + (2 * zeta * x) ** 2;
  return num_ / den;
}

/** |1 - H|^2, the high-pass shaping the loop applies to VCO noise. */
export function errorSq(f, fn, zeta) {
  const x = f / fn;
  return x ** 4 / ((1 - x * x) ** 2 + (2 * zeta * x) ** 2);
}

/**
 * PLL output phase noise: the PFD/CP floor, FoM + 10 log f_ref + 20 log N, low-
 * pass shaped by the loop, and the VCO's 1/f^2 noise high-pass shaped.
 * Returns spectra (linear, rad^2/Hz single-sided as L(f)) and the rms jitter.
 */
export function pllNoise({ fref, n, fom, vco1M, fn, zeta }) {
  const floor = 10 ** ((fom + 10 * Math.log10(fref) + 20 * Math.log10(n)) / 10);
  const ref = (f) => floor * closedLoopSq(f, fn, zeta);
  const vco = (f) => 10 ** (vco1M / 10) * (1e6 / f) ** 2 * errorSq(f, fn, zeta);
  // integrate 2*L(f) from 1 kHz to 100 MHz on a log grid (trapezoid in ln f)
  let area = 0;
  const steps = 600;
  let prev = null;
  for (let i = 0; i <= steps; i++) {
    const f = 10 ** (3 + (5 * i) / steps);
    const v = (ref(f) + vco(f)) * f; // d(ln f) = df / f
    if (prev !== null) area += 0.5 * (v + prev) * ((5 * Math.LN10) / steps);
    prev = v;
  }
  const rmsPhase = Math.sqrt(2 * area);
  const jitter = rmsPhase / (TWO_PI * fref * n);
  return { ref, vco, rmsPhase, jitter };
}

/** Output phase-noise budget against log10(offset / Hz). */
export function pllPhaseNoise(config, state) {
  const p = {
    fref: num(state, config, "fref", 50) * 1e6,
    n: num(state, config, "n", 48),
    fom: num(state, config, "fom", -225),
    vco1M: num(state, config, "vco", -110),
    fn: num(state, config, "fn", 300) * 1e3,
    zeta: num(state, config, "zeta", 0.707),
  };
  const r = pllNoise(p);
  const db = (v) => 10 * Math.log10(v);
  return [
    curve(`total (rms jitter ${(r.jitter * 1e15).toFixed(0)} fs, 1 kHz to 100 MHz)`, (lf) => db(r.ref(10 ** lf) + r.vco(10 ** lf)), 3, 8, 251),
    curve("reference, PFD and charge pump (low-pass)", (lf) => db(r.ref(10 ** lf)), 3, 8, 251),
    curve("VCO (high-pass)", (lf) => db(r.vco(10 ** lf)), 3, 8, 251),
  ];
}

/** Free-running VCO phase noise L(df) in dBc/Hz from its figure of merit. */
export function vcoL(df, f0, pmW, fom, fc) {
  return -fom + 20 * Math.log10(f0 / df) - 10 * Math.log10(pmW) + 10 * Math.log10(1 + fc / df);
}

/** Ring against LC VCO at the same frequency and power, against log10(offset / Hz). */
export function vcoPhaseNoise(config, state) {
  const f0 = num(state, config, "f0", 2.4) * 1e9;
  const p = num(state, config, "power", 2);
  const fomLc = num(state, config, "fomLc", 188);
  const fomRing = num(state, config, "fomRing", 160);
  const fc = num(state, config, "corner", 200) * 1e3;
  const at1M = (fom) => vcoL(1e6, f0, p, fom, fc).toFixed(1);
  return [
    curve(`LC VCO (${at1M(fomLc)} dBc/Hz at 1 MHz)`, (lf) => vcoL(10 ** lf, f0, p, fomLc, fc), 3, 8, 201),
    curve(`ring VCO (${at1M(fomRing)} dBc/Hz at 1 MHz)`, (lf) => vcoL(10 ** lf, f0, p, fomRing, fc), 3, 8, 201),
  ];
}
