// src/widgets/sims/cortex.js
//
// Simulators for the cortical-column pages: HTM-style temporal memory in
// minicolumns, Thousand Brains voting between columns, grid-cell modules as a
// location code, a ring attractor, and the mushroom body's sparse expansion.

import { num, str, rng, series, curve } from "./util.js";

/** k distinct random integers in [0, n). */
function sample(rand, n, k) {
  const picked = new Set();
  while (picked.size < Math.min(k, n)) picked.add(Math.floor(rand() * n));
  return [...picked];
}

/**
 * Temporal memory (Hawkins & Ahmad 2016, simplified): 64 minicolumns of
 * `cells` cells; each symbol activates a fixed set of 6 columns. A column
 * with a predicted cell activates only that cell; otherwise it bursts (all
 * cells fire) and one winner cell grows a dendritic segment onto the previous
 * step's winners; a segment that correctly predicted its cell also grows
 * synapses onto the previous winners. A cell is predicted when one of its segments sees at least
 * `threshold` active cells. Plots, per step, the share of active columns that
 * burst — high while a sequence is new, near zero once it is learned.
 *
 * sequence: "ABCD" repeats one sequence; "ABCD + XBCY" alternates two that
 * share B C, so predicting D or Y needs context a first-order model lacks.
 */
export function temporalMemory(config, state) {
  const cells = Math.round(num(state, config, "cells", 8));
  const threshold = Math.round(num(state, config, "threshold", 4));
  const steps = Math.round(num(state, config, "steps", 80));
  const which = str(state, config, "sequence", "ABCD + XBCY");
  const rand = rng(num(state, config, "seed", 5));
  const C = 64, perSymbol = 6;
  const alphabet = {};
  for (const s of "ABCDXY") alphabet[s] = sample(rand, C, perSymbol);
  const seq = which === "ABCD" ? "ABCD" : "ABCDXBCY";

  const segments = Array.from({ length: C * cells }, () => []); // cell -> [Set of presyn cells]
  let active = new Set(), winners = [], predicted = new Set();
  const xs = [], burstShare = [], predictedShare = [];

  for (let t = 0; t < steps; t++) {
    const cols = alphabet[seq[t % seq.length]];
    const nextActive = new Set(), nextWinners = [];
    let bursts = 0;
    for (const col of cols) {
      const colCells = [];
      for (let k = 0; k < cells; k++) colCells.push(col * cells + k);
      const hits = colCells.filter((c) => predicted.has(c));
      if (hits.length) {
        for (const c of hits) {
          nextActive.add(c); nextWinners.push(c);
          // reinforce: the segment that predicted this cell also grows
          // synapses onto the previous winners, so a context that burst last
          // time is picked up by its new winner cells too
          for (const seg of segments[c]) {
            let n = 0;
            for (const p of seg) if (active.has(p)) n++;
            if (n >= threshold) for (const w of winners) seg.add(w);
          }
        }
      } else {
        bursts++;
        for (const c of colCells) nextActive.add(c);
        // winner: the cell with fewest segments (ties broken at random)
        const fewest = Math.min(...colCells.map((c) => segments[c].length));
        const pool = colCells.filter((c) => segments[c].length === fewest);
        const w = pool[Math.floor(rand() * pool.length)];
        nextWinners.push(w);
        if (winners.length) {
          const pre = sample(rand, winners.length, Math.max(threshold + 2, 8)).map((i) => winners[i]);
          segments[w].push(new Set(pre));
        }
      }
    }
    // predictions for the next step from the new active cells
    const nextPredicted = new Set();
    for (let c = 0; c < segments.length; c++) {
      for (const seg of segments[c]) {
        let n = 0;
        for (const p of seg) if (nextActive.has(p)) n++;
        if (n >= threshold) { nextPredicted.add(c); break; }
      }
    }
    xs.push(t);
    burstShare.push(bursts / cols.length);
    predictedShare.push((cols.length - bursts) / cols.length);
    active = nextActive; winners = nextWinners; predicted = nextPredicted;
  }
  return [series("columns bursting (share)", xs, burstShare), series("columns predicted (share)", xs, predictedShare)];
}

/**
 * Thousand Brains voting (after Hawkins et al. 2017): `objects` objects, each
 * a set of 10 (location, feature) pairs drawn from `features` features. Each
 * column touches a random location on the true object and keeps the objects
 * consistent with everything it has sensed; with voting, columns also keep
 * only objects every column still allows. Plots the mean number of candidate
 * objects left after each sensation, averaged over 40 trials.
 */
export function thousandBrains(config, state) {
  const nObjects = Math.round(num(state, config, "objects", 50));
  const nFeatures = Math.round(num(state, config, "features", 5));
  const columns = Math.round(num(state, config, "columns", 3));
  const rand = rng(num(state, config, "seed", 11));
  const L = 10, maxSteps = 10, trials = 40;
  const objects = Array.from({ length: nObjects }, () =>
    Array.from({ length: L }, () => Math.floor(rand() * nFeatures)));

  const run = (nCols, vote) => {
    const totals = new Array(maxSteps).fill(0);
    for (let trial = 0; trial < trials; trial++) {
      const truth = Math.floor(rand() * nObjects);
      const cand = Array.from({ length: nCols }, () => new Set(objects.keys()));
      for (let s = 0; s < maxSteps; s++) {
        for (const set of cand) {
          const loc = Math.floor(rand() * L);
          const feat = objects[truth][loc];
          for (const o of [...set]) if (objects[o][loc] !== feat) set.delete(o);
        }
        if (vote) {
          const shared = [...cand[0]].filter((o) => cand.every((set) => set.has(o)));
          for (let c = 0; c < nCols; c++) cand[c] = new Set(shared);
        }
        totals[s] += cand[0].size;
      }
    }
    return totals.map((x) => x / trials);
  };
  const xs = Array.from({ length: maxSteps }, (_, i) => i + 1);
  return [
    series("one column", xs, run(1, false)),
    series(`${columns} columns voting`, xs, run(columns, true)),
  ];
}

/**
 * Grid-cell modules along a 1-D track: each module fires periodically with
 * its own spacing (base × ratio^m). One module is ambiguous; together their
 * phases pin down position over a range far longer than any one spacing.
 */
export function gridCells(config, state) {
  const base = num(state, config, "spacing", 30); // cm
  const ratio = num(state, config, "ratio", 1.42);
  const modules = Math.round(num(state, config, "modules", 3));
  const L = 300, kappa = 3;
  const out = [];
  for (let m = 0; m < modules; m++) {
    const lambda = base * ratio ** m;
    out.push(curve(`module ${m + 1}: ${lambda.toFixed(0)} cm`,
      (x) => m * 1.2 + Math.exp(kappa * (Math.cos((2 * Math.PI * x) / lambda) - 1)), 0, L, 600));
  }
  return out;
}

/**
 * Ring attractor: 64 rate neurons on a ring with local excitation J1 cos(Δθ)
 * and uniform inhibition J0. A cue at `cue`° is applied for 100 ms, then
 * removed. Strong enough recurrence holds the bump (a memory of the cue);
 * weak recurrence lets it decay.
 */
export function ringAttractor(config, state) {
  const J1 = num(state, config, "excitation", 6);
  const J0 = num(state, config, "inhibition", -2);
  const cue = (num(state, config, "cue", 180) * Math.PI) / 180;
  const N = 64, dt = 1, tau = 10;
  const theta = Array.from({ length: N }, (_, i) => (2 * Math.PI * i) / N);
  const W = theta.map((a) => theta.map((b) => (J0 + J1 * Math.cos(a - b)) / N));
  const f = (x) => Math.tanh(Math.max(0, x));
  let r = new Array(N).fill(0);
  let duringCue = null;
  for (let t = 0; t < 400; t += dt) {
    const input = theta.map((a) => (t < 100 ? 1.5 * Math.exp(2 * (Math.cos(a - cue) - 1)) : 0) + 0.1);
    const next = r.map((ri, i) => {
      let rec = 0;
      for (let j = 0; j < N; j++) rec += W[i][j] * r[j];
      return ri + (dt / tau) * (-ri + f(rec + input[i]));
    });
    r = next;
    if (t === 99) duringCue = r.slice();
  }
  const deg = theta.map((a) => (a * 180) / Math.PI);
  return [series("rate during cue", deg, duringCue), series("rate 300 ms after cue", deg, r)];
}

/**
 * Mushroom body expansion: 50 projection neurons (PNs) project onto 2000
 * Kenyon cells (KCs), each KC sampling `inputs` random PNs; a KC fires when
 * its summed input exceeds a threshold set so about `sparsity`% fire.
 * Plots KC-code overlap against PN-code overlap for pairs of odors: below
 * the diagonal means the expansion separates similar odors.
 */
export function mushroomBody(config, state) {
  const k = Math.round(num(state, config, "inputs", 6));
  const sparsity = num(state, config, "sparsity", 5) / 100;
  const rand = rng(num(state, config, "seed", 2));
  const P = 50, K = 2000, activePN = 15;
  const conn = Array.from({ length: K }, () => sample(rand, P, k));
  // a fixed tiny per-cell offset breaks ties the same way for every odor
  const jitter = conn.map(() => rand() * 1e-3);
  const kcCode = (pn) => {
    const drive = conn.map((ins, c) => ins.reduce((s, i) => s + pn[i], 0) + jitter[c]);
    const sorted = [...drive].sort((a, b) => b - a);
    const cut = sorted[Math.max(0, Math.round(sparsity * K) - 1)];
    return drive.map((d) => (d >= cut ? 1 : 0));
  };
  const overlap = (a, b) => {
    let both = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) { both += a[i] & b[i]; na += a[i]; nb += b[i]; }
    return both / Math.max(1, Math.sqrt(na * nb));
  };
  const base = new Array(P).fill(0);
  for (const i of sample(rand, P, activePN)) base[i] = 1;
  const baseKC = kcCode(base);
  const pts = [];
  for (let swap = 0; swap <= activePN; swap++) {
    const odor = base.slice();
    const on = odor.flatMap((v, i) => (v ? [i] : []));
    const off = sample(rand, P - activePN, swap).map((i) => odor.flatMap((v, j) => (v ? [] : [j]))[i]);
    for (let s = 0; s < swap; s++) {
      odor[on[s]] = 0;
      odor[off[s]] = 1;
    }
    pts.push({ x: overlap(base, odor), y: overlap(baseKC, kcCode(odor)) });
  }
  pts.sort((a, b) => a.x - b.x);
  return [{ label: "KC overlap", points: pts }, curve("no separation (y = x)", (x) => x, 0, 1, 2)];
}
