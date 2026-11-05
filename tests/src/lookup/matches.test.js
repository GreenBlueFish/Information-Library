// tests/src/lookup/matches.test.js
//
// Ranked matches for a highlighted selection (src/lookup/matches.js) and the
// lookup panel's arrow-key navigation through them:
//
//   - The exact match comes first, then terms close to the selection.
//   - Words such as "the" show nothing; "it" does not resolve to the IT
//     neuron type, but "IT" does.
//   - Plurals, possessives and hyphenated words resolve ("FPGAs", "HTM's",
//     "STDP-like").
//   - Against the real content: "pulvinar" has a definition, and every
//     acronym used in a page's prose resolves (the acronyms list below).
//   - The panel shows "Match 1 of N"; ArrowDown / ArrowUp step through the
//     matches, clamped at both ends; Escape closes the panel.

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "../../harness.js";
import { ensureDom } from "../../dom.js";

const dom = await ensureDom();
globalThis.document = dom.document;
globalThis.window = dom.window;

const { buildIndex } = await import("../../../src/lookup/search-index.js");
const { findMatches } = await import("../../../src/lookup/matches.js");
const { installLookup } = await import("../../../src/lookup/lookup-ui.js");

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const realTerms = JSON.parse(readFileSync(join(repoRoot, "content", "terms.json"), "utf8"));
const realIndex = buildIndex(realTerms);

const TERMS = [
  { term: "Pyramidal Neuron", aliases: ["pyramidal cell", "pyramidal cells"], definition: "A cortical excitatory cell.", pageRef: null },
  { term: "Layer 2/3 Pyramidal Cell", definition: "A pyramidal cell of layers 2 and 3.", pageRef: null },
  { term: "Neuron", aliases: ["neurons"], definition: "A cell that fires spikes.", pageRef: null },
  { term: "Intratelencephalic Neuron", acronym: "IT", definition: "A pyramidal cell projecting within the forebrain.", pageRef: null },
  { term: "Field-Programmable Gate Array", acronym: "FPGA", definition: "A reconfigurable chip.", pageRef: null },
  { term: "Hierarchical Temporal Memory", acronym: "HTM", definition: "Numenta's theory.", pageRef: null },
  { term: "Spike-Timing-Dependent Plasticity", acronym: "STDP", definition: "Timing-based plasticity.", pageRef: null },
];
const index = buildIndex(TERMS);
const names = (matches) => matches.map((m) => m.term);

describe("findMatches: ranked matches", () => {
  it("puts the exact match first and related terms after it", () => {
    const m = findMatches(index, "pyramidal cells");
    expect(m[0].term).toBe("Pyramidal Neuron");
    expect(m[0].matchKind).toBe("exact");
    expect(names(m).includes("Layer 2/3 Pyramidal Cell")).toBe(true);
  });

  it("offers terms containing a word that is not a term on its own", () => {
    const m = findMatches(index, "pyramidal");
    expect(m.length >= 2).toBe(true);
    expect(m[0].term).toBe("Pyramidal Neuron");
  });

  it("finds terms inside a longer selection", () => {
    const m = findMatches(index, "the apical dendrite of a pyramidal neuron");
    expect(names(m).includes("Pyramidal Neuron")).toBe(true);
  });

  it("shows nothing for words like the, and, of", () => {
    for (const w of ["the", "and", "of", "The", "a"]) expect(findMatches(index, w).length).toBe(0);
  });

  it("does not read the pronoun 'it' as the acronym IT", () => {
    expect(findMatches(index, "it").length).toBe(0);
    expect(findMatches(index, "IT")[0].term).toBe("Intratelencephalic Neuron");
  });

  it("resolves plurals, possessives and hyphenated words", () => {
    expect(findMatches(index, "FPGAs")[0].term).toBe("Field-Programmable Gate Array");
    expect(findMatches(index, "HTM's")[0].term).toBe("Hierarchical Temporal Memory");
    expect(findMatches(index, "STDP-like")[0].term).toBe("Spike-Timing-Dependent Plasticity");
  });

  it("catches a typo in a longer word, but not in a three-letter one", () => {
    expect(findMatches(index, "nueron")[0].term).toBe("Neuron");
    expect(findMatches(index, "tha").length).toBe(0);
  });
});

describe("findMatches: the real terms.json", () => {
  it("defines pulvinar", () => {
    const m = findMatches(realIndex, "pulvinar");
    expect(m[0].term).toBe("Pulvinar");
    expect(m[0].matchKind).toBe("exact");
  });

  it("resolves acronyms used across the pages", () => {
    const acronyms = [
      "LGN", "V1", "L4", "L2/3", "L5", "PV", "SST", "VIP", "GABA", "CA1", "CA3", "MEC", "EPSP",
      "IPSP", "GPU", "FPGA", "IEEE", "PNAS", "NEST", "MNIST", "LSTM", "BPTT", "TTL", "RGB",
      "VPM", "POm", "SNc", "GPi", "VTA", "LFP", "EEG", "fMRI", "AHP", "HCN", "ISI", "KC", "PN",
    ];
    const missing = acronyms.filter((a) => {
      const m = findMatches(realIndex, a);
      return m.length === 0 || m[0].matchKind !== "exact";
    });
    expect(missing).toEqual([]);
  });

  it("every term has a non-empty definition and no repeated acronym", () => {
    const seen = new Map();
    const repeated = [];
    for (const t of realTerms) {
      expect(typeof t.definition === "string" && t.definition.trim() !== "").toBe(true);
      if (t.acronym) {
        const k = t.acronym.toLowerCase();
        if (seen.has(k) && seen.get(k) !== t.term.toLowerCase()) repeated.push(t.acronym);
        seen.set(k, t.term.toLowerCase());
      }
    }
    expect(repeated).toEqual([]);
  });
});

describe("lookup panel: arrow keys step through matches", () => {
  function setup(text) {
    const view = dom.window;
    const root = dom.document.createElement("div");
    root.textContent = text;
    dom.document.body.appendChild(root);
    const real = view.getSelection;
    view.getSelection = () => ({
      toString: () => text,
      rangeCount: 1,
      getRangeAt: () => ({ getBoundingClientRect: () => ({ left: 0, top: 0, bottom: 10, right: 10 }) }),
    });
    installLookup(index, root);
    root.dispatchEvent(new view.Event("mouseup"));
    return {
      panel: () => dom.document.body.querySelector(".lookup-panel"),
      key: (k) => {
        const e = new view.Event("keydown");
        e.key = k;
        dom.document.dispatchEvent(e);
      },
      done: () => {
        view.getSelection = real;
        root.remove();
        dom.document.body.querySelector(".lookup-panel")?.remove();
      },
    };
  }

  it("shows Match 1 of N, moves down and up, and stops at the ends", () => {
    const t = setup("pyramidal");
    try {
      const count = () => t.panel().querySelector(".lookup-panel__match-count").textContent;
      const term = () => t.panel().querySelector(".lookup-panel__term").textContent;
      const total = findMatches(index, "pyramidal").length;
      expect(count()).toBe(`Match 1 of ${total}`);
      expect(term()).toBe("Pyramidal Neuron");

      t.key("ArrowUp");
      expect(count()).toBe(`Match 1 of ${total}`);

      t.key("ArrowDown");
      expect(count()).toBe(`Match 2 of ${total}`);
      expect(term() !== "Pyramidal Neuron").toBe(true);

      t.key("ArrowUp");
      expect(term()).toBe("Pyramidal Neuron");

      for (let i = 0; i < total + 3; i++) t.key("ArrowDown");
      expect(count()).toBe(`Match ${total} of ${total}`);
    } finally {
      t.done();
    }
  });

  it("closes on Escape", () => {
    const t = setup("pyramidal");
    try {
      expect(Boolean(t.panel())).toBe(true);
      t.key("Escape");
      expect(Boolean(t.panel())).toBe(false);
    } finally {
      t.done();
    }
  });

  it("shows no panel at all for an ordinary word like 'the'", () => {
    const t = setup("the");
    try {
      expect(Boolean(t.panel())).toBe(false);
    } finally {
      t.done();
    }
  });

  it("shows no match row when there is only one match", () => {
    const t = setup("FPGA");
    try {
      expect(t.panel().querySelector(".lookup-panel__matches")).toBe(null);
    } finally {
      t.done();
    }
  });
});
