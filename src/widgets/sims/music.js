// src/widgets/sims/music.js
//
// Simulators for the Music Theory pages. Each is a pure function
// (config, state) -> PlotSeries[]; each control's `key` is the parameter it
// drives. Pitches in Hz, intervals in cents (1200 per octave), time in ms.
//
//   harmonic-series   the partials of a tone: stems at f0, 2f0, 3f0, … with
//                     amplitudes falling as 1/n^rolloff
//   beating           two close sine tones and their sum: the loudness swells
//                     |f1 − f2| times a second
//   chord-wave        the summed waveform of a chord: a just major triad
//                     (4:5:6) repeats every 4 periods of the root; an
//                     equal-tempered one never quite repeats
//   dissonance        sensory roughness of two harmonic tones against the
//                     interval between them (Plomp and Levelt 1965, in the
//                     parametrisation of Sethares 1993): dips at simple ratios
//   tuning-cents      how far each just interval (and each Pythagorean one)
//                     is from 12-tone equal temperament, in cents
//   fifths-drift      stacking pure fifths: where each lands in the octave,
//                     against twelve-tone equal fifths; after 12 they miss
//                     by the Pythagorean comma
//   edo-error         for an equal division of the octave into n steps, the
//                     error of its best fifth, major third and harmonic seventh
//   polyrhythm        the onsets of an a-against-b polyrhythm over one cycle

import { num, str, curve } from "./util.js";

export const CENTS = (r) => 1200 * Math.log2(r);

/** Stem series: a vertical line from 0 to y at each x. */
function stems(label, xs, ys) {
  const points = [];
  xs.forEach((x, i) => {
    points.push({ x, y: 0, move: true });
    points.push({ x, y: ys[i] });
  });
  return { label, points };
}

/** The partials of a harmonic tone. */
export function harmonicSeries(config, state) {
  const f0 = num(state, config, "f0", 110);
  const n = Math.max(1, Math.min(32, Math.round(num(state, config, "partials", 16))));
  const roll = num(state, config, "rolloff", 1);
  const xs = [], ys = [];
  for (let k = 1; k <= n; k++) { xs.push(k * f0); ys.push(1 / k ** roll); }
  return [stems(`partials of ${f0.toFixed(0)} Hz`, xs, ys)];
}

/** Two sine tones and their sum over `ms` milliseconds. */
export function beating(config, state) {
  const f1 = num(state, config, "f1", 440);
  const f2 = num(state, config, "f2", 444);
  const ms = num(state, config, "duration", 1000);
  const n = 1500;
  const sum = curve("sum of the two tones", (t) => Math.sin(2 * Math.PI * f1 * t / 1000) + Math.sin(2 * Math.PI * f2 * t / 1000), 0, ms, n);
  const env = curve(`envelope: ${Math.abs(f1 - f2).toFixed(1)} beats per second`, (t) => 2 * Math.abs(Math.cos(Math.PI * (f1 - f2) * t / 1000)), 0, ms, 400);
  return [sum, env];
}

const CHORDS = {
  "major, just (4:5:6)": [1, 5 / 4, 3 / 2],
  "major, equal-tempered": [1, 2 ** (4 / 12), 2 ** (7 / 12)],
  "minor, just (10:12:15)": [1, 6 / 5, 3 / 2],
  "perfect fifth, just (2:3)": [1, 3 / 2],
  "tritone, equal-tempered": [1, 2 ** 0.5],
  "diminished triad, equal-tempered": [1, 2 ** (3 / 12), 2 ** (6 / 12)],
};
export const CHORD_NAMES = Object.keys(CHORDS);

/** The summed waveform of a chord built on `root` Hz. */
export function chordWave(config, state) {
  const root = num(state, config, "root", 220);
  const name = str(state, config, "chord", CHORD_NAMES[0]);
  const ratios = CHORDS[name] ?? CHORDS[CHORD_NAMES[0]];
  const ms = num(state, config, "duration", 40);
  return [curve(name, (t) => ratios.reduce((a, r) => a + Math.sin(2 * Math.PI * root * r * t / 1000), 0), 0, ms, 1400)];
}

/** Sethares' fit of the Plomp–Levelt curve for two sine partials. */
export function roughness(f1, a1, f2, a2) {
  const fmin = Math.min(f1, f2);
  const s = 0.24 / (0.0207 * fmin + 18.96);
  const d = Math.abs(f2 - f1);
  return a1 * a2 * (Math.exp(-3.5 * s * d) - Math.exp(-5.75 * s * d));
}

/** Total roughness of two harmonic tones (n partials, amplitudes 0.88^k) a ratio r apart. */
export function toneRoughness(f0, r, n) {
  let total = 0;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= n; j++) {
      total += roughness(i * f0, 0.88 ** (i - 1), j * f0 * r, 0.88 ** (j - 1));
    }
  }
  // the partials within each tone add a constant; leave it out
  return total;
}

export function dissonance(config, state) {
  const f0 = num(state, config, "f0", 261.63);
  const n = Math.max(1, Math.min(12, Math.round(num(state, config, "partials", 6))));
  const pts = curve(`${n} partials`, (c) => toneRoughness(f0, 2 ** (c / 1200), n), 0, 1250, 626);
  const mx = Math.max(...pts.points.map((p) => p.y));
  pts.points.forEach((p) => { p.y /= mx || 1; });
  return [pts];
}

export const JUST = [1, 16 / 15, 9 / 8, 6 / 5, 5 / 4, 4 / 3, 45 / 32, 3 / 2, 8 / 5, 5 / 3, 9 / 5, 15 / 8, 2];
export const PYTH = [1, 256 / 243, 9 / 8, 32 / 27, 81 / 64, 4 / 3, 729 / 512, 3 / 2, 128 / 81, 27 / 16, 16 / 9, 243 / 128, 2];

/** Cents by which each just / Pythagorean interval differs from equal temperament. */
export function tuningCents(config, state) {
  const xs = JUST.map((_, i) => i);
  const which = str(state, config, "show", "both");
  const out = [];
  if (which !== "Pythagorean") out.push(stems("just minus equal (cents)", xs.map((x) => x - 0.08), JUST.map((r, i) => CENTS(r) - 100 * i)));
  if (which !== "just") out.push(stems("Pythagorean minus equal (cents)", xs.map((x) => x + 0.08), PYTH.map((r, i) => CENTS(r) - 100 * i)));
  return out;
}

/** k pure fifths up, folded into one octave, against k equal fifths. */
export function fifthsDrift(config, state) {
  const k = Math.max(1, Math.min(53, Math.round(num(state, config, "fifths", 12))));
  const xs = [], pure = [], eq = [];
  for (let i = 0; i <= k; i++) {
    xs.push(i);
    pure.push(((i * CENTS(1.5)) % 1200 + 1200) % 1200);
    eq.push((i * 700) % 1200);
  }
  return [
    { label: "pure fifths (cents above the start, in one octave)", points: xs.map((x, i) => ({ x, y: pure[i] })) },
    { label: "equal-tempered fifths", points: xs.map((x, i) => ({ x, y: eq[i] })) },
  ];
}

/** Error (cents) of the nearest step of n-EDO to a just ratio. */
export function edoErr(n, ratio) {
  const c = CENTS(ratio);
  const step = 1200 / n;
  return Math.round(c / step) * step - c;
}

export function edoError(config, state) {
  const lo = Math.max(5, Math.round(num(state, config, "from", 5)));
  const hi = Math.max(lo + 5, Math.round(num(state, config, "to", 60)));
  const xs = [];
  for (let n = lo; n <= hi; n++) xs.push(n);
  const line = (label, r) => ({ label, points: xs.map((n) => ({ x: n, y: edoErr(n, r) })) });
  return [line("fifth 3/2", 3 / 2), line("major third 5/4", 5 / 4), line("harmonic seventh 7/4", 7 / 4)];
}

/** Onsets of a against b over one cycle (time 0..1), drawn as stems at heights 1 and 2. */
export function polyrhythm(config, state) {
  const a = Math.max(1, Math.min(16, Math.round(num(state, config, "a", 3))));
  const b = Math.max(1, Math.min(16, Math.round(num(state, config, "b", 2))));
  const row = (n, h) => {
    const points = [];
    for (let i = 0; i < n; i++) { points.push({ x: i / n, y: h - 0.8, move: true }); points.push({ x: i / n, y: h }); }
    return points;
  };
  return [
    { label: `${a} evenly spaced beats`, points: row(a, 2) },
    { label: `${b} evenly spaced beats`, points: row(b, 1) },
    { label: "cycle", points: [{ x: 0, y: 0 }, { x: 1, y: 0 }] },
  ];
}
