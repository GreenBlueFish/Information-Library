// src/widgets/types/music-player.js
//
// The `music-player` widget type: a piano keyboard you can click to hear a
// note, and a row of example buttons that play a chord, an arpeggio or a
// melody with Web Audio while the keys light up.
//
// Spec (page JSON):
//   { "type": "music-player", "title": "...",
//     "from": "C3", "to": "C5",                  // keyboard range (default C4..C5)
//     "tonic": "C4",                             // reference for just/Pythagorean tuning
//     "examples": [ { "label": "C major triad", "notes": ["C4","E4","G4"],
//                     "play": "chord" | "arpeggio" | "melody" | "both",
//                     "beats": [1,1,2] } ],      // melody note lengths in beats (default 1)
//     "params": [ tempo (range, BPM), tuning (select: equal|just|pythagorean),
//                 timbre (select: sine|soft|bright) ]   // all optional
//   }
// Guitar: "instrument": "guitar" draws a fretboard instead ("frets": last fret,
// default 12; "firstFret"; "strings": tuning, lowest first, default standard
// E2 A2 D3 G3 B3 E4). An example may then give "shape": "x32010" (or
// "8 10 10 9 8 8"), strummed low to high; a pitch example lights every place
// that pitch is on the neck, and a melody step may name a place, "6:3"
// (string 6, fret 3), to light just that spot, or be a whole shape ("x32010").
// A melody step can be "rest", or a chord written "C4+E4+G4". Notes are scientific pitch names:
// C4 is middle C, A4 = 440 Hz; sharps "#", flats "b", doubles "##"/"bb".
//
// Pure exports (no DOM, tested): noteToMidi, midiToName, frequency, RATIOS,
// schedule, shapeToNotes, STANDARD.

import { registerWidget } from "../registry.js";
import { buildFrame, buildControlPanel, buildReadout, buildStage, svgEl } from "../sim-kit.js";
import { soundOn, onSoundChange } from "../../sound.js";

const LETTERS = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/** MIDI number of a note name ("C4" → 60, "F#3" → 54, "Bb4" → 70), or null. */
export function noteToMidi(name) {
  const m = /^([A-Ga-g])(##|bb|#|b|x)?(-?\d+)$/.exec(String(name).trim());
  if (!m) return null;
  const acc = { "#": 1, "##": 2, x: 2, b: -1, bb: -2 }[m[2] ?? ""] ?? 0;
  return 12 * (Number(m[3]) + 1) + LETTERS[m[1].toUpperCase()] + acc;
}

/** Sharp-spelled name of a MIDI number (61 → "C#4"). */
export function midiToName(midi) {
  return `${NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

/** Frequency ratios above the tonic for each semitone, by tuning. */
export const RATIOS = {
  just: [1, 16 / 15, 9 / 8, 6 / 5, 5 / 4, 4 / 3, 45 / 32, 3 / 2, 8 / 5, 5 / 3, 9 / 5, 15 / 8],
  pythagorean: [1, 256 / 243, 9 / 8, 32 / 27, 81 / 64, 4 / 3, 729 / 512, 3 / 2, 128 / 81, 27 / 16, 16 / 9, 243 / 128],
};

/**
 * Frequency (Hz) of a MIDI note. Equal temperament: 440·2^((m−69)/12). Just and
 * Pythagorean tuning are built on `tonicMidi` (tuned equal-tempered), each
 * note taking the ratio of its interval above the tonic.
 */
export function frequency(midi, tuning = "equal", tonicMidi = 60) {
  const et = (m) => 440 * 2 ** ((m - 69) / 12);
  const table = RATIOS[tuning];
  if (!table) return et(midi);
  const d = midi - tonicMidi;
  const oct = Math.floor(d / 12);
  return et(tonicMidi) * table[((d % 12) + 12) % 12] * 2 ** oct;
}

/**
 * When each note of an example sounds: [{ midi, start, dur }] in seconds.
 * chord: all at once for 2 beats; arpeggio: one per beat, then the chord;
 * melody: one after another with `beats` lengths ("rest" takes time, no note).
 */
export function schedule(example, bpm = 90, strings = null) {
  const beat = 60 / Math.max(20, bpm);
  if (example.shape && strings) {
    // A guitar shape: strum low to high (play "chord" or "both"), or pick it note by note ("arpeggio").
    const notes = shapeToNotes(example.shape, strings);
    const play = example.play ?? "both";
    const out = [];
    if (play === "arpeggio" || play === "both") notes.forEach((n, i) => out.push({ ...n, start: i * beat * 0.5, dur: beat * 0.5 }));
    const t = play === "chord" ? 0 : notes.length * beat * 0.5;
    if (play !== "arpeggio") notes.forEach((n, i) => out.push({ ...n, start: t + i * 0.025, dur: 2 * beat }));
    return out;
  }
  const notes = (example.notes ?? []).map((n) => (n === "rest" ? null : noteToMidi(n)));
  const out = [];
  const play = example.play ?? "chord";
  if (play === "chord") {
    for (const m of notes) if (m !== null) out.push({ midi: m, start: 0, dur: 2 * beat });
  } else if (play === "arpeggio" || play === "both") {
    notes.forEach((m, i) => { if (m !== null) out.push({ midi: m, start: i * beat, dur: beat * 0.95 }); });
    const t = notes.length * beat;
    for (const m of notes) if (m !== null) out.push({ midi: m, start: t, dur: 2 * beat });
  } else {
    // A melody step may be a chord: "C4+E4+G4" sounds its notes together.
    let t = 0;
    (example.notes ?? []).forEach((step, i) => {
      const len = (Array.isArray(example.beats) ? Number(example.beats[i]) || 1 : 1) * beat;
      // On a guitar a step may be a whole chord shape ("x32010"), strummed.
      if (strings && /^([x0-9]{6}|([x0-9]{1,2}-){5}[x0-9]{1,2})$/i.test(String(step))) {
        shapeToNotes(step, strings).forEach((n, k) => out.push({ ...n, start: t + k * 0.012, dur: len * 0.92 }));
        t += len;
        return;
      }
      for (const part of String(step).split("+")) {
        // On a guitar a step may name a place: "6:3" is string 6, fret 3.
        const at = strings ? /^(\d):(\d{1,2})$/.exec(part) : null;
        if (at) {
          const k = strings.length - Number(at[1]);
          const open = k >= 0 && k < strings.length ? noteToMidi(strings[k]) : null;
          if (open !== null) out.push({ midi: open + Number(at[2]), start: t, dur: len * 0.92, pos: `${at[1]}:${Number(at[2])}` });
          continue;
        }
        const m = part === "rest" ? null : noteToMidi(part);
        if (m !== null) out.push({ midi: m, start: t, dur: len * 0.92 });
      }
      t += len;
    });
  }
  return out;
}

/**
 * Group scheduled notes into steps: notes that start within `tol` seconds of
 * the first note of a group (a chord, or a strum) form one step.
 * @param {{midi:number,start:number,dur:number}[]} events
 * @returns {Array<typeof events>}
 */
export function stepGroups(events, tol = 0.1) {
  const sorted = [...events].sort((a, b) => a.start - b.start);
  const groups = [];
  for (const e of sorted) {
    const g = groups[groups.length - 1];
    if (g && e.start - g[0].start <= tol) g.push(e);
    else groups.push([e]);
  }
  return groups;
}

/** Standard guitar tuning, lowest string first. */
export const STANDARD = ["E2", "A2", "D3", "G3", "B3", "E4"];

/**
 * The notes of a guitar shape, lowest string first: "x32010" (one character
 * per string, x = not played) or "8 10 10 9 8 8" / "x-3-5-5-x-x" for frets
 * above 9. Returns [{ midi, pos: "string:fret" }], strings numbered 6 (low) to 1.
 */
export function shapeToNotes(shape, strings = STANDARD) {
  const s = String(shape).trim();
  const parts = /[\s-]/.test(s) ? s.split(/[\s-]+/) : s.split("");
  const n = strings.length;
  const out = [];
  parts.slice(0, n).forEach((p, k) => {
    if (/^x$/i.test(p)) return;
    const f = Number(p);
    if (!Number.isInteger(f) || f < 0) return;
    const open = noteToMidi(strings[k]);
    if (open === null) return;
    out.push({ midi: open + f, pos: `${n - k}:${f}` });
  });
  return out;
}

const DEFAULT_PARAMS = [
  { key: "tempo", label: "Tempo (beats per minute)", control: "range", min: 40, max: 200, step: 5, default: 90 },
];

const HARMONICS = {
  sine: [1],
  soft: [1, 0.35, 0.12, 0.05],
  bright: [1, 0.6, 0.45, 0.3, 0.22, 0.15, 0.1],
};

registerWidget("music-player", (ctx) => mountMusicPlayer(ctx));

function mountMusicPlayer(ctx) {
  const spec = ctx.spec ?? {};
  const params = Array.isArray(spec.params) && spec.params.length ? spec.params : DEFAULT_PARAMS;
  const { doc, root } = buildFrame(ctx.container, spec);
  const panel = buildControlPanel(doc, root, params, () => {});
  const win = doc.defaultView ?? globalThis;
  const AC = win.AudioContext ?? win.webkitAudioContext;
  let audio = null;
  const timers = new Set();
  const voices = new Set();
  let destroyed = false;

  const lo = noteToMidi(spec.from ?? "C4") ?? 60;
  const hi = Math.max(lo + 11, noteToMidi(spec.to ?? "C5") ?? 72);
  const tonic = noteToMidi(spec.tonic ?? "C4") ?? 60;

  // Example buttons: pressing one selects it and plays it all.
  const row = doc.createElement("div");
  row.className = "widget__actions";
  const buttons = [];
  const examples = Array.isArray(spec.examples) ? spec.examples : [];
  let current = examples[0] ?? null;
  let stepIndex = -1;
  examples.forEach((ex, i) => {
    const b = doc.createElement("button");
    b.type = "button";
    b.className = "widget__button widget__button--secondary";
    b.textContent = `▶ ${ex.label}`;
    b.setAttribute("aria-pressed", i === 0 ? "true" : "false");
    b.addEventListener("click", () => { select(i); playExample(ex); });
    buttons.push(b);
    row.appendChild(b);
  });
  root.appendChild(row);

  // Step controls: walk through the selected example one chord or note at a time.
  let stepPos = null;
  const stepRow = doc.createElement("div");
  stepRow.className = "widget__actions music-steps";
  const mk = (text, label, fn) => {
    const b = doc.createElement("button");
    b.type = "button";
    b.className = "widget__button widget__button--secondary";
    b.textContent = text;
    b.setAttribute("aria-label", label);
    b.addEventListener("click", fn);
    stepRow.appendChild(b);
    return b;
  };
  if (examples.length) {
    mk("◀ Step", "Previous step", () => step(-1));
    mk("Step ▶", "Next step", () => step(+1));
    mk("▶ Play all", "Play the whole example", () => { if (current) playExample(current); });
    mk("■ Stop", "Stop", () => { stopAll(); });
    const pos = doc.createElement("span");
    pos.className = "music-steps__pos";
    stepRow.appendChild(pos);
    root.appendChild(stepRow);
    stepPos = pos;
  }

  function select(i) {
    current = examples[i] ?? null;
    stepIndex = -1;
    buttons.forEach((b, k) => b.setAttribute("aria-pressed", k === i ? "true" : "false"));
    showPos();
  }
  function groupsOf(ex) {
    return stepGroups(schedule(ex, Number(panel.state.tempo) || 90, guitar ? (spec.strings ?? STANDARD) : null));
  }
  function showPos() {
    if (!stepPos || !current) return;
    const n = groupsOf(current).length;
    stepPos.textContent = stepIndex < 0 ? `${current.label}: ${n} steps` : `Step ${stepIndex + 1} of ${n}`;
  }
  function step(dir) {
    if (!current) return;
    const groups = groupsOf(current);
    if (!groups.length) return;
    stepIndex = stepIndex < 0 ? (dir > 0 ? 0 : groups.length - 1) : (stepIndex + dir + groups.length) % groups.length;
    stopAll();
    const g = groups[stepIndex];
    const t0 = g[0].start;
    // Sound the step briefly, and keep its keys or frets lit until the next step.
    playNotes(g.map((e) => ({ ...e, start: e.start - t0, dur: Math.max(0.9, e.dur) })), true);
    readout.textContent = `${current.label}, step ${stepIndex + 1} of ${groups.length}: ${describe([...new Set(g.map((e) => e.midi))])}`;
    showPos();
  }

  // The instrument: a piano keyboard, or a guitar fretboard.
  /** @type {Map<number, Element[]>} every mark for a pitch */
  const keyEls = new Map();
  /** @type {Map<string, Element>} guitar marks by "string:fret" */
  const posEls = new Map();
  const addMark = (m, el) => { if (!keyEls.has(m)) keyEls.set(m, []); keyEls.get(m).push(el); };
  const guitar = spec.instrument === "guitar";
  let litClass = "piano-key--on";
  if (guitar) {
    litClass = "fret-spot--on";
    const tuningNotes = (Array.isArray(spec.strings) ? spec.strings : STANDARD).map((n) => noteToMidi(n) ?? 40);
    const f0 = Math.max(0, Math.round(Number(spec.firstFret ?? 0)));
    const f1 = Math.max(f0 + 3, Math.round(Number(spec.frets ?? 12)));
    const FW = 54, SG = 24, X0 = 48, Y0 = 22;
    const nStr = tuningNotes.length;
    const W = X0 + (f1 - f0 + 1) * FW + 10, H = Y0 * 2 + (nStr - 1) * SG + 14;
    const stage = buildStage(doc, root, W, H, "Guitar fretboard: high string on top as in tab; click a fret to hear it");
    const xOf = (f) => (f === 0 ? X0 - 22 : X0 + (f - f0 - 0.5) * FW + (f0 === 0 ? 0 : FW));
    for (let f = f0 === 0 ? 1 : f0; f <= f1; f++) {
      const x = X0 + (f - (f0 === 0 ? 0 : f0 - 1)) * FW;
      stage.svg.appendChild(svgEl(doc, "line", { class: f === 0 ? "fret-line" : "fret-line", x1: x, y1: Y0, x2: x, y2: Y0 + (nStr - 1) * SG }));
      const lab = svgEl(doc, "text", { class: "sim-label", x: x - FW / 2, y: H - 2, "text-anchor": "middle" });
      lab.textContent = [3, 5, 7, 9, 12, 15, 17, 19, 21, 24].includes(f) ? String(f) : "";
      stage.svg.appendChild(lab);
    }
    stage.svg.appendChild(svgEl(doc, "line", { class: f0 === 0 ? "fret-nut" : "fret-line", x1: X0, y1: Y0, x2: X0, y2: Y0 + (nStr - 1) * SG }));
    for (let k = 0; k < nStr; k++) {
      const y = Y0 + (nStr - 1 - k) * SG; // string k (0 = lowest) drawn lowest
      stage.svg.appendChild(svgEl(doc, "line", { class: "fret-string", x1: X0 - 30, y1: y, x2: W - 10, y2: y }));
      for (let f = f0 === 0 ? 0 : f0; f <= f1; f++) {
        if (f0 > 0 && f === 0) continue;
        const m = tuningNotes[k] + f;
        const c = svgEl(doc, "circle", { class: "fret-spot", cx: xOf(f), cy: y, r: 9 });
        const title = svgEl(doc, "title", {});
        title.textContent = `${midiToName(m)} (string ${nStr - k}, fret ${f})`;
        c.appendChild(title);
        posEls.set(`${nStr - k}:${f}`, c);
        addMark(m, c);
        stage.svg.appendChild(c);
        c.addEventListener("pointerdown", () => {
          playNotes([{ midi: m, start: 0, dur: 0.9, pos: `${nStr - k}:${f}` }]);
          readout.textContent = `${describe([m])}: string ${nStr - k}, fret ${f}`;
        });
      }
    }
  } else {
    const whites = [];
    for (let m = lo; m <= hi; m++) if (!NAMES[m % 12].includes("#")) whites.push(m);
    const WW = 40;
    const W = whites.length * WW;
    const H = 150;
    const stage = buildStage(doc, root, W + 2, H + 2, "Piano keyboard: click a key to hear it");
    whites.forEach((m, i) => {
      const r = svgEl(doc, "rect", { class: "piano-key piano-key--white", x: 1 + i * WW, y: 1, width: WW, height: H, rx: 3 });
      addMark(m, r);
      stage.svg.appendChild(r);
      if (m % 12 === 0) {
        const t = svgEl(doc, "text", { class: "sim-label", x: 1 + i * WW + WW / 2, y: H - 8, "text-anchor": "middle" });
        t.textContent = midiToName(m);
        stage.svg.appendChild(t);
      }
    });
    for (let m = lo; m <= hi; m++) {
      if (!NAMES[m % 12].includes("#")) continue;
      const left = whites.indexOf(m - 1);
      if (left < 0) continue;
      const r = svgEl(doc, "rect", { class: "piano-key piano-key--black", x: 1 + (left + 1) * WW - 12, y: 1, width: 24, height: H * 0.62, rx: 2 });
      addMark(m, r);
      stage.svg.appendChild(r);
    }
    for (const [m, els] of keyEls) {
      els[0].addEventListener("pointerdown", () => {
        playNotes([{ midi: m, start: 0, dur: 0.9 }]);
        readout.textContent = describe([m]);
      });
    }
  }
  const readout = buildReadout(doc, root);
  readout.textContent = AC
    ? (guitar ? "Click a fret, or press ▶ on an example." : "Click a key, or press ▶ on an example.")
    : "This browser has no Web Audio, so the examples can't sound; the keys still light up.";

  function tuning() { return String(panel.state.tuning ?? "equal"); }
  function describe(midis) {
    const t = tuning();
    return midis.map((m) => `${midiToName(m)} ${frequency(m, t, tonic).toFixed(2)} Hz`).join(", ") +
      (t === "equal" ? "" : ` (${t} tuning on ${midiToName(tonic)})`);
  }

  function light(ev, on) {
    const els = ev.pos && posEls.has(ev.pos) ? [posEls.get(ev.pos)] : keyEls.get(ev.midi) ?? [];
    for (const el of els) {
      if (on) el.classList.add(litClass);
      else el.classList.remove(litClass);
    }
  }

  function later(fn, ms) {
    const id = win.setTimeout(() => { timers.delete(id); if (!destroyed) fn(); }, ms);
    timers.add(id);
  }

  function playNotes(events, hold = false) {
    for (const e of events) {
      later(() => light(e, true), e.start * 1000);
      if (!hold) later(() => light(e, false), (e.start + e.dur) * 1000);
    }
    if (!AC || !soundOn()) return;
    try {
      audio = audio ?? new AC();
      if (audio.state === "suspended" && audio.resume) audio.resume();
    } catch {
      return;
    }
    const now = audio.currentTime + 0.03;
    const partials = HARMONICS[String(panel.state.timbre ?? "soft")] ?? HARMONICS.soft;
    const total = partials.reduce((a, b) => a + b, 0);
    const level = 0.22 / Math.max(1, Math.sqrt(events.filter((e) => e.start === events[0]?.start).length)) / total;
    for (const e of events) {
      const f = frequency(e.midi, tuning(), tonic);
      const gain = audio.createGain();
      const t0 = now + e.start;
      const t1 = t0 + e.dur;
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(level, t0 + 0.015);
      gain.gain.setTargetAtTime(level * 0.6, t0 + 0.015, 0.25);
      gain.gain.setTargetAtTime(0, t1, 0.06);
      gain.connect(audio.destination);
      partials.forEach((amp, k) => {
        if (f * (k + 1) > 12000) return;
        const osc = audio.createOscillator();
        const g = audio.createGain();
        g.gain.value = amp;
        osc.frequency.value = f * (k + 1);
        osc.connect(g).connect(gain);
        osc.start(t0);
        osc.stop(t1 + 0.4);
        voices.add(osc);
        osc.onended = () => voices.delete(osc);
      });
    }
  }

  function playExample(ex) {
    stopAll();
    stepIndex = -1;
    showPos();
    const ev = schedule(ex, Number(panel.state.tempo) || 90, guitar ? (spec.strings ?? STANDARD) : null);
    playNotes(ev);
    const uniq = [...new Set(ev.map((e) => e.midi))];
    readout.textContent = `${ex.label}: ${describe(uniq)}`;
  }

  function stopAll() {
    for (const id of timers) win.clearTimeout(id);
    timers.clear();
    for (const osc of voices) { try { osc.stop(); } catch { /* already stopped */ } }
    voices.clear();
    for (const els of keyEls.values()) for (const el of els) el.classList.remove(litClass);
  }

  const offSound = onSoundChange((on) => {
    if (!on) for (const osc of voices) { try { osc.stop(); } catch { /* stopped */ } }
  });
  showPos();

  return {
    update(partial) { panel.update(partial); },
    destroy() {
      destroyed = true;
      offSound();
      stopAll();
      panel.destroy();
      if (audio && audio.close) { try { audio.close(); } catch { /* closed */ } }
    },
  };
}
