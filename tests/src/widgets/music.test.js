// Music Theory: the simulators (src/widgets/sims/music.js) and the pure parts
// of the music-player widget (src/widgets/types/music-player.js).
import { describe, it, expect } from "../../harness.js";
import * as m from "../../../src/widgets/sims/music.js";
import { noteToMidi, midiToName, frequency, schedule, shapeToNotes, STANDARD, stepGroups } from "../../../src/widgets/types/music-player.js";

const close = (a, b, tol) => { if (Math.abs(a - b) > tol) throw new Error(`${a} is not within ${tol} of ${b}`); };

describe("music sims", () => {
  it("cents and the Pythagorean comma", () => {
    close(m.CENTS(2), 1200, 1e-9);
    close(m.CENTS(1.5), 701.955, 0.001);
    close(12 * m.CENTS(1.5) - 7 * 1200, 23.460, 0.001);
  });

  it("equal-division errors match the known values", () => {
    close(m.edoErr(12, 3 / 2), -1.955, 0.001);
    close(m.edoErr(12, 5 / 4), 13.686, 0.001);
    close(m.edoErr(19, 5 / 4), -7.366, 0.01);
    close(m.edoErr(31, 5 / 4), 0.783, 0.01);
    close(m.edoErr(53, 3 / 2), -0.068, 0.001);
  });

  it("tuning-cents: just major third is 13.7 cents flat of equal, Pythagorean 7.8 sharp", () => {
    const [just, pyth] = m.tuningCents({}, { show: "both" });
    const at = (s, k) => s.points.filter((p) => !p.move)[k].y;
    close(at(just, 4), -13.686, 0.001);
    close(at(pyth, 4), 7.820, 0.001);
    close(at(just, 7), 1.955, 0.001);
    close(at(just, 12), 0, 1e-9);
  });

  it("dissonance dips at the fifth and octave, peaks near a semitone", () => {
    const pts = m.dissonance({}, { partials: 6 })[0].points;
    const at = (c) => pts.reduce((a, b) => (Math.abs(b.x - c) < Math.abs(a.x - c) ? b : a)).y;
    expect(at(702) < at(650)).toBe(true);
    expect(at(702) < at(750)).toBe(true);
    expect(at(1200) < at(1150)).toBe(true);
    expect(at(100) > 0.9).toBe(true);
  });

  it("beating envelope has |f1 - f2| beats per second", () => {
    const [, env] = m.beating({}, { f1: 440, f2: 444, duration: 1000 });
    const zeros = env.points.filter((p, i, a) => i > 0 && i < a.length - 1 && p.y < a[i - 1].y && p.y <= a[i + 1].y).length;
    expect(zeros).toBe(4);
  });

  it("fifths drift: 12 pure fifths overshoot 7 octaves by the comma", () => {
    const [pure, eq] = m.fifthsDrift({}, { fifths: 12 });
    close(pure.points[12].y, 23.460, 0.001);
    expect(eq.points[12].y).toBe(0);
  });

  it("polyrhythm and harmonic series have the right counts", () => {
    const [a, b] = m.polyrhythm({}, { a: 3, b: 4 });
    expect(a.points.length).toBe(6);
    expect(b.points.length).toBe(8);
    const [h] = m.harmonicSeries({}, { f0: 100, partials: 8 });
    expect(h.points.filter((p) => !p.move).map((p) => p.x)).toEqual([100, 200, 300, 400, 500, 600, 700, 800]);
  });
});

describe("music-player helpers", () => {
  it("note names to MIDI and back", () => {
    expect(noteToMidi("C4")).toBe(60);
    expect(noteToMidi("A4")).toBe(69);
    expect(noteToMidi("Bb3")).toBe(58);
    expect(noteToMidi("F##4")).toBe(67);
    expect(noteToMidi("Cb4")).toBe(59);
    expect(noteToMidi("H4")).toBe(null);
    expect(midiToName(61)).toBe("C#4");
  });

  it("frequencies in the three tunings", () => {
    close(frequency(69), 440, 1e-9);
    close(frequency(60), 261.626, 0.001);
    close(frequency(64, "just", 60) / frequency(60, "just", 60), 5 / 4, 1e-12);
    close(frequency(64, "pythagorean", 60) / frequency(60, "pythagorean", 60), 81 / 64, 1e-12);
    close(frequency(76, "just", 60) / frequency(60, "just", 60), 5 / 2, 1e-12);
    close(frequency(55, "just", 60) / frequency(60, "just", 60), 3 / 4, 1e-12);
  });

  it("schedules chords, arpeggios and melodies", () => {
    expect(schedule({ notes: ["C4", "E4", "G4"], play: "chord" }, 60).map((e) => e.start)).toEqual([0, 0, 0]);
    const arp = schedule({ notes: ["C4", "E4"], play: "arpeggio" }, 60);
    expect(arp.map((e) => e.start)).toEqual([0, 1, 2, 2]);
    const mel = schedule({ notes: ["C4", "rest", "D4"], play: "melody", beats: [2, 1, 1] }, 60);
    expect(mel.map((e) => [e.midi, e.start])).toEqual([[60, 0], [62, 3]]);
    const waltz = schedule({ notes: ["C3", "G3+C4+E4"], play: "melody" }, 60);
    expect(waltz.map((e) => [e.midi, e.start])).toEqual([[48, 0], [55, 1], [60, 1], [64, 1]]);
  });

  it("reads guitar shapes, lowest string first", () => {
    expect(shapeToNotes("x32010").map((n) => midiToName(n.midi))).toEqual(["C3", "E3", "G3", "C4", "E4"]);
    expect(shapeToNotes("x32010")[0].pos).toBe("5:3");
    expect(shapeToNotes("8 10 10 9 8 8").map((n) => midiToName(n.midi))).toEqual(["C3", "G3", "C4", "E4", "G4", "C5"]);
    expect(shapeToNotes("x-x-0-2-3-2", STANDARD).map((n) => midiToName(n.midi))).toEqual(["D3", "A3", "D4", "F#4"]);
    const strum = schedule({ shape: "022100", play: "chord" }, 60, STANDARD);
    expect(strum.length).toBe(6);
    expect(strum[5].start > strum[0].start).toBe(true);
    const placed = schedule({ notes: ["6:3", "5:3+4:2"], play: "melody" }, 60, STANDARD);
    expect(placed.map((e) => [midiToName(e.midi), e.pos])).toEqual([["G2", "6:3"], ["C3", "5:3"], ["E3", "4:2"]]);
    const strums = schedule({ notes: ["x32010", "1-3-3-2-1-1"], play: "melody" }, 60, STANDARD);
    expect(strums.length).toBe(11);
    expect(strums[5].start).toBe(1);
  });

  it("groups a schedule into steps: one chord or strum per step", () => {
    const prog = schedule({ notes: ["C4+E4+G4", "F4+A4+C5", "G4+B4+D5"], play: "melody" }, 60);
    expect(stepGroups(prog).map((g) => g.length)).toEqual([3, 3, 3]);
    const arp = schedule({ notes: ["C4", "E4", "G4"], play: "both" }, 60);
    expect(stepGroups(arp).map((g) => g.length)).toEqual([1, 1, 1, 3]);
    const strum = schedule({ notes: ["x32010", "320003"], play: "melody" }, 60, STANDARD);
    expect(stepGroups(strum).map((g) => g.length)).toEqual([5, 6]);
  });
});
