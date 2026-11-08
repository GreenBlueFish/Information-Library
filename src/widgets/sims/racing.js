// src/widgets/sims/racing.js
//
// Simulators for the Racing pages: a tyre's force against slip angle, the
// quickest speed a car can hold round a corner, and how braking and
// accelerating move load between the axles. Each is a pure function
// (config, state) -> PlotSeries[]; each control's `key` is the parameter it
// drives. These are first-order textbook models (Milliken and Milliken, Race
// Car Vehicle Dynamics; Pacejka, Tire and Vehicle Dynamics), meant to show the
// shape of each effect, not to predict a particular car.

import { num, curve } from "./util.js";

const G = 9.81; // m/s²
const RHO = 1.225; // air density, kg/m³

/**
 * Peak friction coefficient of a tyre at vertical load fz (kN): it falls as
 * the load rises above the reference load fz0 (load sensitivity), never below
 * a fifth of mu0.
 */
export function tyreMu(mu0, fz, fz0, sensitivity) {
  return Math.max(0.2 * mu0, mu0 * (1 - sensitivity * (fz / fz0 - 1)));
}

/**
 * Lateral force (kN) at slip angle `alpha` (deg) by the Pacejka "magic
 * formula" with E = 0: F = D·sin(C·atan(B·α)). B is set so the force peaks at
 * `peakSlip` degrees; D = μ·Fz is the peak force.
 */
export function lateralForce(alpha, fz, mu, peakSlip, shape) {
  const b = Math.tan(Math.PI / (2 * shape)) / peakSlip;
  return mu * fz * Math.sin(shape * Math.atan(b * alpha));
}

/** Tyre lateral force against slip angle at three vertical loads. Loads in kN, angles in degrees. */
export function tyreCurve(config, state) {
  const mu0 = num(state, config, "mu", 1.4);
  const load = num(state, config, "load", 4);
  const peakSlip = Math.max(0.5, num(state, config, "peakSlip", 7));
  const shape = Math.min(1.95, Math.max(1.05, num(state, config, "shape", 1.4)));
  const sens = num(state, config, "sensitivity", 0.15);
  return [0.5, 1, 1.5].map((m) => {
    const fz = load * m;
    const mu = tyreMu(mu0, fz, load, sens);
    return curve(`load ${fz.toFixed(1)} kN`, (a) => lateralForce(a, fz, mu, peakSlip, shape), 0, 20, 161);
  });
}

/**
 * Steady cornering speed (km/h) against corner radius (m): m·v²/r = μ·(m·g + ½ρ·ClA·v²),
 * capped at the car's top speed. ClA is the downforce coefficient times frontal area (m²).
 */
export function cornerSpeed(radius, mu, mass, clA, vTopKmh) {
  const k = (mu * RHO * clA) / (2 * mass);
  const denom = 1 / radius - k;
  const vTop = vTopKmh / 3.6;
  if (denom <= 0) return vTopKmh;
  return Math.min(vTop, Math.sqrt((mu * G) / denom)) * 3.6;
}

/** Cornering speed against radius, with and without downforce. */
export function corneringSpeed(config, state) {
  const mu = num(state, config, "mu", 1.4);
  const mass = Math.max(100, num(state, config, "mass", 1200));
  const clA = num(state, config, "clA", 1.5);
  const vTop = num(state, config, "vTop", 300);
  return [
    curve("grip from weight only", (r) => cornerSpeed(r, mu, mass, 0, vTop), 10, 300, 146),
    curve(`with downforce (ClA = ${clA.toFixed(1)} m²)`, (r) => cornerSpeed(r, mu, mass, clA, vTop), 10, 300, 146),
  ];
}

/**
 * Load on the front and rear axles (kN) against longitudinal acceleration
 * (in g; negative is braking). ΔF = m·a·h/L moves from the rear to the front
 * under braking and back under acceleration. `front` is the static share on
 * the front axle (0–1), h and L in metres.
 */
export function axleLoads(ax, mass, front, cgHeight, wheelbase) {
  const w = (mass * G) / 1000;
  const shift = (mass * ax * G * cgHeight) / wheelbase / 1000;
  return { front: w * front - shift, rear: w * (1 - front) + shift };
}

/** Front and rear axle load against longitudinal acceleration. */
export function weightTransfer(config, state) {
  const mass = num(state, config, "mass", 1200);
  const front = Math.min(0.8, Math.max(0.2, num(state, config, "front", 0.5)));
  const h = num(state, config, "cgHeight", 0.45);
  const L = Math.max(1, num(state, config, "wheelbase", 2.6));
  // clamp each axle at zero: past that the wheels lift off
  return [
    curve("front axle", (a) => Math.max(0, axleLoads(a, mass, front, h, L).front), -1.5, 1, 126),
    curve("rear axle", (a) => Math.max(0, axleLoads(a, mass, front, h, L).rear), -1.5, 1, 126),
  ];
}
