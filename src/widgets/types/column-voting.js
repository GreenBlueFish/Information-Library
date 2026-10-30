// src/widgets/types/column-voting.js
//
// The `column-voting` widget type: Thousand Brains Theory voting between
// cortical columns that each sense a different patch of the same object.
//
// The model (Hawkins, Ahmad & Cui 2017, "A Theory of How Columns in the
// Neocortex Enable Learning the Structure of the World"; Lewis, Purdy, Ahmad &
// Hawkins 2019, "Locations in the Neocortex: A Theory of Sensorimotor Object
// Recognition Using Cortical Grid Cells"), reduced to its counting core:
//
//   - Objects. `config.objects` objects (mug, bowl, can, pen, ball, box) each
//     have one feature (0..features−1) at each of `config.locations`
//     locations. Generation is seeded and deliberately ambiguous: at every
//     location only two feature values are in use, so any single
//     feature-at-location is consistent with several objects. Objects differ
//     pairwise at ≥ 2 locations so that they can always be told apart.
//   - Sensing. Every step each column's sensor patch touches one location on
//     the object and reports the feature there. Locations are drawn at random
//     without replacement (a fresh random tour of all locations once they are
//     used up), so at a given step different columns touch different
//     locations. With `noise` > 0 the reported feature is replaced by a random
//     wrong feature with that probability.
//   - Location is known. In the theory each column computes the sensor's
//     location in the object's reference frame by path integration of motor
//     commands in grid-cell-like modules (Lewis et al. 2019). We assume that
//     machinery works and give each column the true location directly; the
//     widget is about what happens next.
//   - Per-column evidence. Each column counts, for every object, how many of
//     its sensations contradicted it (mismatches). Its candidates are the
//     objects with the fewest mismatches, within a tolerance ("slack"): 0
//     without noise (exactly the classic intersection of consistent objects),
//     1 with noise > 0, so a single corrupted sensation does not wrongly
//     eliminate the true object.
//   - Voting. With voting on, columns share their evidence over long-range
//     lateral connections: mismatch counts are summed over columns and every
//     column narrows to that consensus candidate set. With voting off each
//     column decides alone.
//   - Recognition. Voting on: the consensus is the single presented object.
//     Voting off: every column individually has the presented object as its
//     only candidate. Steps are capped (20).
//
// The second chart reproduces the qualitative result of Hawkins et al. (2017,
// Fig. 5): with voting, more columns need fewer sensations, and with enough
// columns a single sensation suffices. Without voting every column must
// gather its own evidence, so adding columns does not help (here it even
// hurts slightly, since all columns must finish).
//
// Self-registration: importing this module calls registerWidget once.

import { registerWidget } from "../registry.js";
import { makePlot } from "../plot.js";
import {
  buildFrame,
  buildControlPanel,
  buildActions,
  buildReadout,
  buildStage,
  svgEl,
  makeRng,
} from "../sim-kit.js";

export const OBJECT_NAMES = Object.freeze(["mug", "bowl", "can", "pen", "ball", "box"]);

export const DEFAULT_CONFIG = Object.freeze({ objects: 6, locations: 9, features: 5 });

export const DEFAULT_PARAMS = Object.freeze({
  columns: 3,
  voting: "on",
  object: "mug",
  noise: 0,
  seed: 5,
});

/** Step cap for one trial and for the curve. */
export const MAX_STEPS = 20;

/** Trials averaged per point of the curve. */
export const CURVE_TRIALS = 40;

/**
 * Normalize a (possibly partial) config.
 * @returns {{ objects: number, locations: number, features: number }}
 */
export function normalizeConfig(config) {
  const c = { ...DEFAULT_CONFIG, ...(config && typeof config === "object" ? config : {}) };
  const int = (v, lo, hi, d) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
  };
  return {
    objects: int(c.objects, 2, OBJECT_NAMES.length, DEFAULT_CONFIG.objects),
    locations: int(c.locations, 2, 30, DEFAULT_CONFIG.locations),
    features: int(c.features, 2, 20, DEFAULT_CONFIG.features),
  };
}

/**
 * Generate the ambiguous object set.
 * @param {{objects:number, locations:number, features:number}} cfg
 * @param {() => number} rng
 * @returns {Array<{ name: string, features: number[] }>}
 */
export function makeObjects(cfg, rng) {
  const { objects: n, locations: L, features: F } = normalizeConfig(cfg);
  const poolSize = Math.min(F, 2);
  // Per location, the small pool of feature values objects draw from.
  const pools = Array.from({ length: L }, () => shuffle(range(F), rng).slice(0, poolSize));
  const draw = () => pools.map((pool) => pool[Math.floor(rng() * pool.length)]);
  const out = [];
  for (let i = 0; i < n; i++) {
    let feats = draw();
    // Require every pair of objects to differ at ≥ 2 locations (retry).
    for (let tries = 0; tries < 200 && out.some((o) => hamming(o.features, feats) < 2); tries++) {
      feats = draw();
    }
    // Fallback for tiny configs: widen to any feature value.
    for (let tries = 0; tries < 200 && out.some((o) => hamming(o.features, feats) < 2); tries++) {
      feats = Array.from({ length: L }, () => Math.floor(rng() * F));
    }
    out.push({ name: OBJECT_NAMES[i], features: feats });
  }
  return out;
}

/** Mean number of objects consistent with one feature-at-location. */
export function meanAmbiguity(objects) {
  const L = objects[0].features.length;
  let sum = 0;
  for (const o of objects) {
    for (let l = 0; l < L; l++) {
      sum += objects.filter((p) => p.features[l] === o.features[l]).length;
    }
  }
  return sum / (objects.length * L);
}

/**
 * One sensation: the feature at `loc`, corrupted with probability `noise`
 * into a uniformly random different feature.
 */
export function sense(object, loc, noise, rng, features = DEFAULT_CONFIG.features) {
  const truth = object.features[loc];
  if (noise > 0 && rng() < noise) {
    return (truth + 1 + Math.floor(rng() * (features - 1))) % features;
  }
  return truth;
}

/** A fresh evidence record. */
export function newEvidence(nObjects) {
  return { sensations: 0, mismatches: new Array(nObjects).fill(0) };
}

/** Add one sensation (feature at loc) to an evidence record (mutates). */
export function updateEvidence(evidence, objects, loc, feature) {
  evidence.sensations++;
  objects.forEach((o, i) => {
    if (o.features[loc] !== feature) evidence.mismatches[i]++;
  });
  return evidence;
}

/** Sum several evidence records (the vote). */
export function poolEvidence(records, nObjects) {
  const out = newEvidence(nObjects);
  for (const r of records) {
    out.sensations += r.sensations;
    r.mismatches.forEach((m, i) => (out.mismatches[i] += m));
  }
  return out;
}

/** Mismatch tolerance: 0 without noise, 1 with noise. */
export function slackFor(noise) {
  return noise > 0 ? 1 : 0;
}

/** Candidate objects: within `slack` mismatches of the best. */
export function candidates(evidence, slack) {
  const min = Math.min(...evidence.mismatches);
  const out = [];
  evidence.mismatches.forEach((m, i) => {
    if (m <= min + slack) out.push(i);
  });
  return out;
}

/**
 * An incremental trial (used by the widget and by runTrial).
 * @param {{ objects: Array<{features:number[]}>, columns: number, voting: boolean,
 *   objectIndex: number, noise: number, seed: number, features?: number }} opts
 */
export function makeTrial(opts) {
  const objects = opts.objects;
  const n = objects.length;
  const L = objects[0].features.length;
  const C = Math.max(1, Math.round(opts.columns));
  const F = opts.features ?? DEFAULT_CONFIG.features;
  const noise = Number(opts.noise) || 0;
  const slack = slackFor(noise);
  const rng = makeRng(opts.seed);
  const target = objects[opts.objectIndex];
  const evidence = Array.from({ length: C }, () => newEvidence(n));
  /** @type {number[][]} */
  const tours = [];
  let step = 0;
  let recognizedAt = null;
  let last = [];

  // Location for the g-th sensation overall (column c at step t has g = t·C + c):
  // consecutive random tours of all locations, so a step's columns differ.
  function locationAt(g) {
    const r = Math.floor(g / L);
    while (tours.length <= r) tours.push(shuffle(range(L), rng));
    return tours[r][g % L];
  }

  function state() {
    const consensus = poolEvidence(evidence, n);
    const consensusCands = candidates(consensus, slack);
    const columnCands = opts.voting
      ? evidence.map(() => consensusCands)
      : evidence.map((e) => candidates(e, slack));
    return {
      step,
      sensed: last,
      evidence,
      consensus,
      consensusCandidates: consensusCands,
      columnCandidates: columnCands,
      recognized: recognizedAt !== null,
      recognizedAt,
    };
  }

  function isRecognized(s) {
    const only = (c) => c.length === 1 && c[0] === opts.objectIndex;
    return opts.voting ? only(s.consensusCandidates) : s.columnCandidates.every(only);
  }

  return {
    step() {
      last = [];
      for (let c = 0; c < C; c++) {
        const loc = locationAt(step * C + c);
        const feature = sense(target, loc, noise, rng, F);
        updateEvidence(evidence[c], objects, loc, feature);
        last.push({ loc, feature });
      }
      step++;
      const s = state();
      if (recognizedAt === null && isRecognized(s)) {
        recognizedAt = step;
        s.recognized = true;
        s.recognizedAt = step;
      }
      return s;
    },
    state,
    get steps() {
      return step;
    },
  };
}

/**
 * Sensations (steps) until recognition, capped at `cap`.
 * @param {{ objects: Array, columns: number, voting: boolean, objectIndex: number,
 *   noise: number, seed: number, features?: number, cap?: number }} opts
 * @returns {number}
 */
export function runTrial(opts) {
  const cap = opts.cap ?? MAX_STEPS;
  const trial = makeTrial(opts);
  for (let t = 0; t < cap; t++) {
    const s = trial.step();
    if (s.recognized) return s.recognizedAt;
  }
  return cap;
}

/**
 * Mean steps to recognition vs number of columns, voting on and off.
 * Trial i presents object i mod n with the same trial seed for every column
 * count and both voting modes (common random numbers).
 * @returns {{ on: Array<{x:number,y:number}>, off: Array<{x:number,y:number}> }}
 */
export function meanStepsCurve({
  objects,
  noise = 0,
  seed = 1,
  trials = CURVE_TRIALS,
  cap = MAX_STEPS,
  maxColumns = 9,
  features = DEFAULT_CONFIG.features,
}) {
  const on = [];
  const off = [];
  for (let C = 1; C <= maxColumns; C++) {
    let sumOn = 0;
    let sumOff = 0;
    for (let i = 0; i < trials; i++) {
      const base = {
        objects,
        columns: C,
        objectIndex: i % objects.length,
        noise,
        seed: (Math.imul(seed, 2654435761) + i * 40503 + 17) >>> 0,
        features,
        cap,
      };
      sumOn += runTrial({ ...base, voting: true });
      sumOff += runTrial({ ...base, voting: false });
    }
    on.push({ x: C, y: sumOn / trials });
    off.push({ x: C, y: sumOff / trials });
  }
  return { on, off };
}

/** Cache of curves keyed by object set / noise. */
const curveCache = new Map();

function cachedCurve(key, compute) {
  if (curveCache.has(key)) return curveCache.get(key);
  const value = compute();
  if (curveCache.size > 32) curveCache.delete(curveCache.keys().next().value);
  curveCache.set(key, value);
  return value;
}

/* -------------------------------------------------------------------------- */
/* Widget                                                                     */
/* -------------------------------------------------------------------------- */

registerWidget("column-voting", (ctx) => mountColumnVoting(ctx));

const VIEW_W = 640;
const PANEL_W = 206;
const PANEL_GAP = 7;
const ROW_H = 14;

function mountColumnVoting(ctx) {
  const spec = ctx.spec ?? {};
  const cfg = normalizeConfig(spec.config);
  const { doc, root } = buildFrame(ctx.container, spec);

  const panel = buildControlPanel(doc, root, spec.params, () => {
    restart();
    redraw();
  });
  const params = () => ({ ...DEFAULT_PARAMS, ...panel.state });

  let objects;
  let objectsSeed = null;
  let trial;
  let snapshot;
  let objectIndex = 0;

  function restart() {
    const p = params();
    const seed = Number(p.seed);
    if (objectsSeed !== seed) {
      objects = makeObjects(cfg, makeRng(seed));
      objectsSeed = seed;
    }
    objectIndex = Math.max(0, objects.findIndex((o) => o.name === p.object));
    trial = makeTrial({
      objects,
      columns: Number(p.columns),
      voting: p.voting !== "off",
      objectIndex,
      noise: Number(p.noise),
      seed: (seed * 7919 + 1) >>> 0,
      features: cfg.features,
    });
    snapshot = trial.state();
  }

  function step() {
    if (trial.steps >= MAX_STEPS) return;
    snapshot = trial.step();
  }

  restart();

  const actions = buildActions(doc, root, [
    { label: "Step", onClick: () => { step(); redraw(); } },
    {
      label: "Run to recognition",
      secondary: true,
      onClick: () => {
        while (!snapshot.recognized && trial.steps < MAX_STEPS) step();
        redraw();
      },
    },
    { label: "Reset", secondary: true, onClick: () => { restart(); redraw(); } },
  ]);

  const stage = buildStage(doc, root, VIEW_W, 300, "Per-column object evidence and consensus");
  const readout = buildReadout(doc, root);

  const curveHost = doc.createElement("div");
  curveHost.className = "widget__plot";
  root.appendChild(curveHost);
  const plot = makePlot(curveHost);
  const caption = doc.createElement("p");
  caption.className = "widget__readout";
  root.appendChild(caption);

  function redraw() {
    drawColumns();
    drawReadout();
    drawCurve();
  }

  function drawColumns() {
    const p = params();
    const voting = p.voting !== "off";
    const C = snapshot.evidence.length;
    const perRow = Math.min(3, C);
    const rows = Math.ceil(C / 3);
    const panelH = 26 + objects.length * ROW_H + 8;
    const consensusH = 26 + objects.length * ROW_H + 8;
    const height = rows * (panelH + PANEL_GAP) + consensusH + 4;
    stage.svg.setAttribute("viewBox", `0 0 ${VIEW_W} ${Math.round(height)}`);
    stage.clear();
    const x0 = (VIEW_W - (perRow * PANEL_W + (perRow - 1) * PANEL_GAP)) / 2;

    for (let c = 0; c < C; c++) {
      const x = x0 + (c % 3) * (PANEL_W + PANEL_GAP);
      const y = Math.floor(c / 3) * (panelH + PANEL_GAP);
      const s = snapshot.sensed[c];
      const title = s
        ? `Column ${c + 1}: location ${s.loc + 1} → feature ${s.feature + 1}`
        : `Column ${c + 1}: nothing sensed yet`;
      drawPanel(x, y, PANEL_W, panelH, title, snapshot.evidence[c], snapshot.columnCandidates[c]);
    }
    const yc = rows * (panelH + PANEL_GAP);
    const ctitle = voting
      ? "Consensus (evidence summed over columns by voting)"
      : "Pooled evidence (for comparison only: voting is off, nothing is shared)";
    drawPanel(x0, yc, Math.max(PANEL_W, perRow * PANEL_W + (perRow - 1) * PANEL_GAP), consensusH,
      ctitle, snapshot.consensus, snapshot.consensusCandidates);
  }

  function drawPanel(x, y, w, h, title, evidence, cands) {
    const svg = stage.svg;
    svg.appendChild(svgEl(doc, "rect", { x, y, width: w, height: h, rx: 4, class: "sim-cell" }));
    const t = svgEl(doc, "text", { x: x + 6, y: y + 16, class: "sim-label" });
    t.textContent = title;
    svg.appendChild(t);
    const nameW = 42;
    const barX = x + 6 + nameW;
    const barMax = w - nameW - 40;
    const single = cands.length === 1;
    objects.forEach((o, i) => {
      const ry = y + 24 + i * ROW_H;
      const label = svgEl(doc, "text", { x: x + 6, y: ry + 10, class: "sim-label" });
      label.textContent = o.name;
      svg.appendChild(label);
      const n = evidence.sensations;
      const frac = n > 0 ? (n - evidence.mismatches[i]) / n : 0;
      const isCand = cands.includes(i);
      svg.appendChild(
        svgEl(doc, "rect", {
          x: barX,
          y: ry + 2,
          width: Math.max(0, frac * barMax),
          height: ROW_H - 4,
          class: single && isCand ? "sim-bar sim-bar--winner" : "sim-bar",
        }),
      );
      const mark = svgEl(doc, "text", { x: barX + barMax + 4, y: ry + 10, class: "sim-label" });
      mark.textContent = n === 0 ? "" : isCand ? (single ? "✓ only" : "✓") : "✗";
      svg.appendChild(mark);
    });
  }

  function drawReadout() {
    const p = params();
    const voting = p.voting !== "off";
    const s = snapshot;
    const name = (i) => objects[i].name;
    let agree;
    if (s.step === 0) {
      agree = "No sensations yet";
    } else if (voting || s.columnCandidates.length === 1) {
      const cands = s.consensusCandidates;
      agree =
        cands.length === 1
          ? `Columns agree on: ${name(cands[0])} ${cands[0] === objectIndex ? "✓" : `✗ (presented: ${name(objectIndex)})`}`
          : `Candidates: ${cands.map(name).join(", ")}`;
    } else {
      const done = s.columnCandidates.filter((c) => c.length === 1 && c[0] === objectIndex).length;
      agree = s.recognized
        ? `Every column alone recognises: ${name(objectIndex)} ✓`
        : `${done} of ${s.columnCandidates.length} columns have recognised ${name(objectIndex)} on their own`;
    }
    const steps = s.recognized
      ? String(s.recognizedAt)
      : s.step >= MAX_STEPS
        ? `not within ${MAX_STEPS}`
        : "–";
    readout.textContent = `Step ${s.step} · ${agree} · Steps to recognition: ${steps}`;
  }

  function drawCurve() {
    const p = params();
    const noise = Number(p.noise);
    const key = `${objectsSeed}|${noise}|${cfg.objects}|${cfg.locations}|${cfg.features}`;
    const curve = cachedCurve(key, () =>
      meanStepsCurve({ objects, noise, seed: objectsSeed, features: cfg.features }),
    );
    plot.draw([
      { label: "Voting on", points: curve.on },
      { label: "Voting off", points: curve.off },
    ]);
    caption.textContent =
      `Chart: mean sensations to recognition (y) vs number of columns (x, 1–9), ` +
      `${CURVE_TRIALS} seeded trials per point, capped at ${MAX_STEPS}, noise ${noise}. ` +
      `Each feature-at-location is shared by ${meanAmbiguity(objects).toFixed(1)} of ` +
      `${objects.length} objects on average. Voting off counts a trial as recognised only ` +
      `when every column has recognised the object on its own.`;
  }

  redraw();

  return {
    update(partial) {
      if (panel.update(partial)) {
        restart();
        redraw();
      }
    },
    destroy() {
      panel.destroy();
      actions.destroy();
      plot.dispose();
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                  */
/* -------------------------------------------------------------------------- */

function range(n) {
  return Array.from({ length: n }, (_, i) => i);
}

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function hamming(a, b) {
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
  return d;
}
