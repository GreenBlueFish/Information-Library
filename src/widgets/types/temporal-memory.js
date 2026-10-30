// src/widgets/types/temporal-memory.js
//
// The `temporal-memory` widget type: a small, faithful HTM Temporal Memory
// (TM) learning simple symbol sequences, drawn as a grid of minicolumns × cells.
//
// The model (Hawkins & Ahmad 2016; Cui, Ahmad & Hawkins 2016; Numenta's
// "Biological and Machine Intelligence" (BAMI) Temporal Memory pseudocode):
//
//   - Input encoding. Every symbol of the chosen sequences owns
//     `columnsPerSymbol` dedicated minicolumns. There is NO spatial pooler
//     here: the column SDR for a symbol is fixed and non-overlapping, so the
//     lesson isolates what the temporal memory adds on top.
//   - Each minicolumn has `cellsPerColumn` cells. Each cell owns distal
//     dendritic segments; a segment is a list of synapses
//     (presynaptic cell, permanence ∈ [0, 1]). A synapse is "connected" when
//     its permanence ≥ connectedPermanence.
//   - Per time step, given the set of active columns:
//       1. In each active column that contains predictive cells (cells with an
//          active segment), only those cells become active and are winners
//          ("correctly predicted").
//       2. An active column with no predictive cell BURSTS: every cell becomes
//          active. One winner cell is chosen: the cell owning the best
//          matching segment (most potential synapses to the previously active
//          cells), else the least-used cell (fewest segments, ties broken by a
//          seeded RNG), which grows a new segment.
//       3. Learning segments are reinforced: +permanenceIncrement on synapses
//          from previously active cells, −permanenceDecrement on the others,
//          then the segment grows new synapses (initialPermanence) to a random
//          sample of previous winner cells, up to min(maxNewSynapses, number
//          of previous winners) active potential synapses. (The cap keeps one
//          segment from sampling two contexts at once; NuPIC avoids this by
//          using maxNewSynapses smaller than the winners per input.)
//       4. Matching segments in columns that did NOT become active predicted
//          wrongly and get a small punishment (predictedSegmentDecrement,
//          0.02 here) on their synapses from previously active cells. This is
//          what unlearns a stale prediction (e.g. Y after A B C) over passes.
//       5. Segments with ≥ activationThreshold connected synapses to the now
//          active cells are active; their cells are predictive for the next
//          step. Segments with ≥ minThreshold potential synapses (permanence
//          > 0) to active cells are "matching".
//   - Anomaly score = fraction of active columns that were not predicted.
//   - Sequences are separated by a reset() (as in the papers' experiments), so
//     the first symbol of every sequence is always unpredicted.
//
// Why several cells per column matter: in "A B C D" and "X B C Y" the
// symbols B and C appear in two contexts. With ≥ 2 cells per column the TM
// learns different cells for "C after A B" and "C after X B", so it predicts
// D only after A B C and Y only after X B C (high-order memory). With one
// cell per column C has a single representation, and it predicts both D and Y.
//
// Self-registration: importing this module calls registerWidget once.

import { registerWidget } from "../registry.js";
import {
  buildFrame,
  buildControlPanel,
  buildActions,
  buildReadout,
  buildStage,
  svgEl,
  makeRng,
  makeTicker,
} from "../sim-kit.js";

/** Contract defaults for `config` (used when a page omits a key). */
export const DEFAULT_CONFIG = Object.freeze({
  columnsPerSymbol: 4,
  maxNewSynapses: 6,
  permanenceIncrement: 0.1,
  permanenceDecrement: 0.05,
  connectedPermanence: 0.5,
  initialPermanence: 0.51,
});

/** Contract defaults for `params`. */
export const DEFAULT_PARAMS = Object.freeze({
  sequences: "ABCD + XBCY",
  cellsPerColumn: 4,
  activationThreshold: 3,
  seed: 11,
});

/** The selectable training sets. */
export const SEQUENCE_SETS = Object.freeze({
  ABCD: ["ABCD"],
  "ABCD + XBCY": ["ABCD", "XBCY"],
  "ABCDE + ABFGE": ["ABCDE", "ABFGE"],
});

/** Small punishment for wrong predictions (BAMI "predictedSegmentDecrement"). */
const PREDICTED_SEGMENT_DECREMENT = 0.02;

/** Play speed. */
const TICK_MS = 400;

/** Clamp to [0, 1]. */
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

/**
 * A minimal HTM Temporal Memory (BAMI pseudocode, without the spatial pooler).
 */
export class TemporalMemory {
  /**
   * @param {Object} opts
   * @param {number} opts.numColumns
   * @param {number} opts.cellsPerColumn
   * @param {number} opts.activationThreshold
   * @param {number} [opts.minThreshold]  matching threshold (default: max(1, activationThreshold − 1))
   * @param {number} opts.maxNewSynapses
   * @param {number} opts.permanenceIncrement
   * @param {number} opts.permanenceDecrement
   * @param {number} [opts.predictedSegmentDecrement]
   * @param {number} opts.connectedPermanence
   * @param {number} opts.initialPermanence
   * @param {number} opts.seed
   */
  constructor(opts) {
    this.numColumns = opts.numColumns;
    this.cellsPerColumn = opts.cellsPerColumn;
    this.activationThreshold = opts.activationThreshold;
    this.minThreshold = Number.isFinite(opts.minThreshold)
      ? opts.minThreshold
      : Math.max(1, opts.activationThreshold - 1);
    this.maxNewSynapses = opts.maxNewSynapses;
    this.permanenceIncrement = opts.permanenceIncrement;
    this.permanenceDecrement = opts.permanenceDecrement;
    this.predictedSegmentDecrement = Number.isFinite(opts.predictedSegmentDecrement)
      ? opts.predictedSegmentDecrement
      : PREDICTED_SEGMENT_DECREMENT;
    this.connectedPermanence = opts.connectedPermanence;
    this.initialPermanence = opts.initialPermanence;
    this.rng = makeRng(opts.seed);
    this.numCells = this.numColumns * this.cellsPerColumn;
    /** @type {Array<Array<{cell:number, synapses:Array<{pre:number, perm:number}>, potential:number}>>} */
    this.cellSegments = Array.from({ length: this.numCells }, () => []);
    this.reset();
  }

  /** Clear the activity state (sequence boundary). Learned synapses persist. */
  reset() {
    /** @type {Set<number>} */ this.activeCells = new Set();
    /** @type {Set<number>} */ this.winnerCells = new Set();
    this.activeSegments = [];
    this.matchingSegments = [];
  }

  /** @param {number} cell */
  columnOf(cell) {
    return Math.floor(cell / this.cellsPerColumn);
  }

  /** Cells that are predictive for the next step. @returns {Set<number>} */
  predictiveCells() {
    return new Set(this.activeSegments.map((s) => s.cell));
  }

  /** Columns containing at least one predictive cell. @returns {Set<number>} */
  predictedColumns() {
    return new Set(this.activeSegments.map((s) => this.columnOf(s.cell)));
  }

  /** Total number of distal segments (for readouts/tests). */
  segmentCount() {
    let n = 0;
    for (const segs of this.cellSegments) n += segs.length;
    return n;
  }

  /**
   * Run one time step.
   * @param {Iterable<number>} activeColumns
   * @param {boolean} [learn=true]
   * @returns {{ anomaly: number, burstColumns: Set<number>, predictedCells: Set<number> }}
   *   `predictedCells` = the cells that were predictive before this input.
   */
  compute(activeColumns, learn = true) {
    const cols = Array.from(new Set(activeColumns)).sort((a, b) => a - b);
    const colSet = new Set(cols);
    const prevActive = this.activeCells;
    const prevWinners = Array.from(this.winnerCells).sort((a, b) => a - b);
    const predictedCells = this.predictiveCells();
    // Target sample size of a learning segment. BAMI grows
    // (maxNewSynapses − active potential synapses); in NuPIC's regime
    // maxNewSynapses is below the number of winner cells per input, so a
    // segment never samples more than one input's winners. Here one input has
    // only columnsPerSymbol winners, so we cap the target at that number:
    // otherwise a segment that already sees all of B's winners would also grow
    // onto a second context's B cells and merge the two contexts.
    const sample = Math.min(this.maxNewSynapses, prevWinners.length);

    const activeByCol = groupByColumn(this, this.activeSegments);
    const matchingByCol = groupByColumn(this, this.matchingSegments);

    const nextActive = new Set();
    const nextWinners = new Set();
    const burstColumns = new Set();
    let unpredicted = 0;

    for (const col of cols) {
      const segs = activeByCol.get(col);
      if (segs) {
        // Correctly predicted column: only the predictive cells fire.
        for (const seg of segs) {
          nextActive.add(seg.cell);
          nextWinners.add(seg.cell);
          if (learn) {
            this._adapt(seg, prevActive);
            this._grow(seg, prevWinners, sample - seg.potential);
          }
        }
        continue;
      }
      // Bursting column: unexpected input, every cell fires.
      unpredicted++;
      burstColumns.add(col);
      const first = col * this.cellsPerColumn;
      for (let c = first; c < first + this.cellsPerColumn; c++) nextActive.add(c);
      const matching = matchingByCol.get(col);
      let winner;
      if (matching) {
        let best = matching[0];
        for (const seg of matching) if (seg.potential > best.potential) best = seg;
        winner = best.cell;
        if (learn) {
          this._adapt(best, prevActive);
          this._grow(best, prevWinners, sample - best.potential);
        }
      } else {
        winner = this._leastUsedCell(col);
        if (learn && prevWinners.length > 0) {
          const seg = { cell: winner, synapses: [], potential: 0 };
          this.cellSegments[winner].push(seg);
          this._grow(seg, prevWinners, sample);
        }
      }
      nextWinners.add(winner);
    }

    // Punish segments that predicted a column that did not become active.
    if (learn && this.predictedSegmentDecrement > 0) {
      for (const seg of this.matchingSegments) {
        if (colSet.has(this.columnOf(seg.cell))) continue;
        for (const syn of seg.synapses) {
          if (prevActive.has(syn.pre)) syn.perm = clamp01(syn.perm - this.predictedSegmentDecrement);
        }
        seg.synapses = seg.synapses.filter((s) => s.perm > 0);
      }
    }

    this.activeCells = nextActive;
    this.winnerCells = nextWinners;
    this._activateDendrites();

    return {
      anomaly: cols.length === 0 ? 0 : unpredicted / cols.length,
      burstColumns,
      predictedCells,
    };
  }

  /** Compute active / matching segments against the current active cells. */
  _activateDendrites() {
    const active = [];
    const matching = [];
    for (const segs of this.cellSegments) {
      for (const seg of segs) {
        let connected = 0;
        let potential = 0;
        for (const syn of seg.synapses) {
          if (!this.activeCells.has(syn.pre)) continue;
          if (syn.perm > 0) potential++;
          if (syn.perm >= this.connectedPermanence) connected++;
        }
        seg.potential = potential;
        if (connected >= this.activationThreshold) active.push(seg);
        if (potential >= this.minThreshold) matching.push(seg);
      }
    }
    this.activeSegments = active;
    this.matchingSegments = matching;
  }

  /** Hebbian update of one learning segment. */
  _adapt(seg, prevActive) {
    for (const syn of seg.synapses) {
      syn.perm = clamp01(
        prevActive.has(syn.pre)
          ? syn.perm + this.permanenceIncrement
          : syn.perm - this.permanenceDecrement,
      );
    }
    seg.synapses = seg.synapses.filter((s) => s.perm > 0);
  }

  /** Grow up to `n` new synapses to a random sample of previous winners. */
  _grow(seg, prevWinners, n) {
    if (n <= 0) return;
    const existing = new Set(seg.synapses.map((s) => s.pre));
    const pool = prevWinners.filter((c) => !existing.has(c));
    for (let k = 0; k < n && pool.length > 0; k++) {
      const i = Math.floor(this.rng() * pool.length);
      const pre = pool.splice(i, 1)[0];
      seg.synapses.push({ pre, perm: this.initialPermanence });
    }
  }

  /** Cell with the fewest segments in `col`, ties broken at random. */
  _leastUsedCell(col) {
    const first = col * this.cellsPerColumn;
    let fewest = Infinity;
    let candidates = [];
    for (let c = first; c < first + this.cellsPerColumn; c++) {
      const n = this.cellSegments[c].length;
      if (n < fewest) {
        fewest = n;
        candidates = [c];
      } else if (n === fewest) candidates.push(c);
    }
    return candidates[Math.floor(this.rng() * candidates.length)];
  }
}

function groupByColumn(tm, segments) {
  const map = new Map();
  for (const seg of segments) {
    const col = tm.columnOf(seg.cell);
    if (!map.has(col)) map.set(col, []);
    map.get(col).push(seg);
  }
  return map;
}

/**
 * Unique symbols of the sequences, in order of first appearance.
 * @param {string[]} sequences
 * @returns {string[]}
 */
export function alphabetOf(sequences) {
  const out = [];
  for (const seq of sequences) for (const s of seq) if (!out.includes(s)) out.push(s);
  return out;
}

/**
 * Map each symbol to its dedicated, non-overlapping block of columns.
 * @param {string[]} symbols
 * @param {number} columnsPerSymbol
 * @returns {Map<string, number[]>}
 */
export function symbolColumns(symbols, columnsPerSymbol) {
  const map = new Map();
  symbols.forEach((sym, i) => {
    map.set(sym, Array.from({ length: columnsPerSymbol }, (_, k) => i * columnsPerSymbol + k));
  });
  return map;
}

/**
 * Feed every sequence `passes` times with learning on, resetting between
 * sequences.
 * @param {TemporalMemory} tm
 * @param {string[]} sequences
 * @param {number} passes
 * @param {Map<string, number[]>} columnsOf
 */
export function trainSequences(tm, sequences, passes, columnsOf) {
  for (let p = 0; p < passes; p++) {
    for (const seq of sequences) {
      for (const sym of seq) tm.compute(columnsOf.get(sym), true);
      tm.reset();
    }
  }
}

/**
 * Symbols predicted next: those with a majority of their columns predicted.
 * @param {TemporalMemory} tm
 * @param {Map<string, number[]>} columnsOf
 * @returns {string[]}
 */
export function predictedSymbols(tm, columnsOf) {
  const predicted = tm.predictedColumns();
  const out = [];
  for (const [sym, cols] of columnsOf) {
    const hits = cols.filter((c) => predicted.has(c)).length;
    if (hits * 2 > cols.length) out.push(sym);
  }
  return out;
}

/**
 * Build a TM + column map for a (params, config) pair.
 * @returns {{ tm: TemporalMemory, sequences: string[], symbols: string[], columnsOf: Map<string, number[]> }}
 */
export function buildModel(params, config) {
  const p = { ...DEFAULT_PARAMS, ...(params || {}) };
  const c = { ...DEFAULT_CONFIG, ...(config || {}) };
  const sequences = SEQUENCE_SETS[p.sequences] || SEQUENCE_SETS[DEFAULT_PARAMS.sequences];
  const symbols = alphabetOf(sequences);
  const cps = Math.max(1, Math.round(Number(c.columnsPerSymbol) || DEFAULT_CONFIG.columnsPerSymbol));
  const columnsOf = symbolColumns(symbols, cps);
  const tm = new TemporalMemory({
    numColumns: symbols.length * cps,
    cellsPerColumn: Math.max(1, Math.round(Number(p.cellsPerColumn) || 1)),
    activationThreshold: Math.max(1, Math.round(Number(p.activationThreshold) || 1)),
    maxNewSynapses: Number(c.maxNewSynapses),
    permanenceIncrement: Number(c.permanenceIncrement),
    permanenceDecrement: Number(c.permanenceDecrement),
    connectedPermanence: Number(c.connectedPermanence),
    initialPermanence: Number(c.initialPermanence),
    seed: Number(p.seed),
  });
  return { tm, sequences, symbols, columnsOf };
}

/* -------------------------------------------------------------------------- */
/* Widget                                                                     */
/* -------------------------------------------------------------------------- */

registerWidget("temporal-memory", (ctx) => mountTemporalMemory(ctx));

const VIEW_W = 640;
const GRID_TOP = 34;
const LABEL_SPACE = 44;

function mountTemporalMemory(ctx) {
  const spec = ctx.spec ?? {};
  const config = { ...DEFAULT_CONFIG, ...(spec.config && typeof spec.config === "object" ? spec.config : {}) };
  const { doc, root } = buildFrame(ctx.container, spec);

  const panel = buildControlPanel(doc, root, spec.params, () => {
    rebuild(true);
    redraw();
  });
  const params = () => ({ ...DEFAULT_PARAMS, ...panel.state });

  let model;
  let passes = 0;
  let seqIndex = 0;
  let pos = 0; // symbols of sequences[seqIndex] already fed
  let last = null; // { symbol, result }
  let note = "";

  function rebuild(settingsChanged) {
    model = buildModel(params(), config);
    passes = 0;
    seqIndex = 0;
    pos = 0;
    last = null;
    note = settingsChanged ? "Settings changed: learning reset. " : "";
  }

  function step() {
    const seqs = model.sequences;
    if (pos >= seqs[seqIndex].length) {
      // Sequence boundary: reset activity, move to the next sequence.
      model.tm.reset();
      pos = 0;
      seqIndex = (seqIndex + 1) % seqs.length;
    }
    const symbol = seqs[seqIndex][pos];
    const result = model.tm.compute(model.columnsOf.get(symbol), true);
    pos++;
    if (pos >= seqs[seqIndex].length && seqIndex === seqs.length - 1) passes++;
    last = { symbol, result };
    note = "";
  }

  rebuild(false);

  let playButton = null;
  const ticker = makeTicker(() => {
    step();
    redraw();
  }, TICK_MS);

  const actions = buildActions(doc, root, [
    { label: "Step", onClick: () => { step(); redraw(); } },
    {
      label: "Play",
      secondary: true,
      onClick: () => {
        const running = ticker.toggle();
        playButton.setAttribute("aria-pressed", String(running));
        playButton.textContent = running ? "Pause" : "Play";
      },
    },
    {
      label: "Train ×10",
      secondary: true,
      onClick: () => {
        model.tm.reset();
        trainSequences(model.tm, model.sequences, 10, model.columnsOf);
        passes += 10;
        seqIndex = 0;
        pos = 0;
        last = null;
        note = "Trained 10 passes. ";
        redraw();
      },
    },
    {
      label: "Reset",
      secondary: true,
      onClick: () => {
        rebuild(false);
        note = "Learning reset. ";
        redraw();
      },
    },
  ]);
  playButton = actions.buttons[1];
  playButton.setAttribute("aria-pressed", "false");

  const stage = buildStage(doc, root, VIEW_W, 200, "Temporal memory cell grid");
  const legend = doc.createElement("p");
  legend.className = "widget__readout";
  legend.textContent =
    "Legend: solid fill, first color = active and correctly predicted · solid fill, second color = active " +
    "because the column burst · thick outline = predictive (expects to fire next) · plain = inactive. " +
    "Labels under each symbol say whether its columns burst or were predicted. " +
    "Each symbol has its own fixed columns (no spatial pooler).";
  root.appendChild(legend);
  const readout = buildReadout(doc, root);

  function redraw() {
    const { tm, symbols, columnsOf, sequences } = model;
    const cpc = tm.cellsPerColumn;
    const nCols = tm.numColumns;
    const groupGap = 8;
    const usable = VIEW_W - 20 - groupGap * (symbols.length - 1);
    const colW = Math.min(22, usable / nCols);
    const cellH = Math.min(22, 150 / cpc);
    const height = GRID_TOP + cpc * cellH + LABEL_SPACE;
    stage.svg.setAttribute("viewBox", `0 0 ${VIEW_W} ${Math.round(height)}`);
    stage.clear();

    const svg = stage.svg;
    const predictive = tm.predictiveCells();
    const predictedCols = tm.predictedColumns();
    const active = tm.activeCells;
    const burst = last ? last.result.burstColumns : new Set();
    const wasPredicted = last ? last.result.predictedCells : new Set();
    const totalW = nCols * colW + groupGap * (symbols.length - 1);
    let x = (VIEW_W - totalW) / 2;

    const title = svgEl(doc, "text", { x: 10, y: 16, class: "sim-label" });
    title.textContent = `${nCols} minicolumns × ${cpc} cell${cpc > 1 ? "s" : ""}`;
    svg.appendChild(title);

    for (const sym of symbols) {
      const cols = columnsOf.get(sym);
      const groupX = x;
      for (const col of cols) {
        for (let k = 0; k < cpc; k++) {
          const cell = col * cpc + k;
          const classes = ["sim-cell"];
          if (active.has(cell)) {
            // Bursting cells vs cells that fired because they were predicted.
            classes.push(burst.has(col) || !wasPredicted.has(cell) ? "sim-cell--burst" : "sim-cell--active");
          }
          if (predictive.has(cell)) classes.push("sim-cell--predicted");
          svg.appendChild(
            svgEl(doc, "rect", {
              x: x + 1.5,
              y: GRID_TOP + k * cellH + 1.5,
              width: Math.max(1, colW - 3),
              height: Math.max(1, cellH - 3),
              rx: 2,
              class: classes.join(" "),
            }),
          );
        }
        x += colW;
      }
      const cx = (groupX + x) / 2;
      const base = GRID_TOP + cpc * cellH;
      const label = svgEl(doc, "text", { x: cx, y: base + 16, "text-anchor": "middle", class: "sim-label" });
      label.textContent = sym;
      svg.appendChild(label);
      let status = "";
      if (cols.some((c) => burst.has(c))) status = "burst";
      else if (last && cols.some((c) => hasActive(active, c, cpc))) status = "✓ pred.";
      if (cols.filter((c) => predictedCols.has(c)).length * 2 > cols.length) status += status ? " · next?" : "next?";
      if (status) {
        const st = svgEl(doc, "text", { x: cx, y: base + 34, "text-anchor": "middle", class: "sim-label" });
        st.textContent = status;
        svg.appendChild(st);
      }
      x += groupGap;
    }

    // Readout.
    const nextSyms = predictedSymbols(tm, columnsOf);
    const nextText = nextSyms.length ? nextSyms.join(", ") : "none";
    let inputText;
    if (last) {
      const seq = sequences[seqIndex];
      const shown = seq.slice(0, pos).split("").join(" ");
      const tail = pos < seq.length ? " _" : " (end: reset next)";
      inputText = `Input: ${last.symbol} (sequence ${shown}${tail})`;
    } else {
      inputText = `Input: none yet (next: ${sequences[seqIndex][0]})`;
    }
    const anomaly = last ? last.result.anomaly.toFixed(2) : "–";
    const start = last && pos === 1 ? " (sequence start: no context, always 1)" : "";
    const thresholdNote =
      tm.activationThreshold > columnsOf.values().next().value.length
        ? ` · Threshold > ${columnsOf.values().next().value.length} active winner cells per symbol: nothing can be predicted`
        : "";
    readout.textContent =
      `${note}${inputText} · Predicted next: ${nextText} · Anomaly: ${anomaly}${start} · ` +
      `Passes trained: ${passes}${thresholdNote}`;
  }

  redraw();

  return {
    update(partial) {
      if (panel.update(partial)) {
        rebuild(true);
        redraw();
      }
    },
    destroy() {
      ticker.stop();
      panel.destroy();
      actions.destroy();
    },
  };
}

function hasActive(active, col, cpc) {
  for (let k = 0; k < cpc; k++) if (active.has(col * cpc + k)) return true;
  return false;
}
