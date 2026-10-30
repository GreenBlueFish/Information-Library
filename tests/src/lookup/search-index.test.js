// tests/src/lookup/search-index.test.js
//
// Example-based unit tests for the lookup query + fuzzy fallback (task 5.7).
// These pin down the CONCRETE behaviors the property tests describe in the
// abstract, using fixed fixtures drawn from the SNN domain so each case reads
// as a worked example:
//
//   - longest-match over prefixes via `query`           (Requirement 4.2)
//   - single-word resolution via `query`                (Requirement 5.1)
//   - acronym resolution via `query`                    (Requirement 6.2)
//   - alias resolution via `query`                      (Requirement 6.4)
//   - plural strip-and-retry via `fuzzyNearest`         (Requirement 7.2)
//   - typo within edit distance 2, tie-break            (Requirement 7.3)
//   - selection beyond distance 2 returns none          (Requirement 7.4)
//   - empty / punctuation-only selection → no query     (Requirement 4.5)
//
// Why the split between `query` and `fuzzyNearest`:
// `search-index.js` wires the fuzzy fallback through a LAZY dynamic
// `import("./fuzzy.js")` that resolves asynchronously and returns `null` until
// the module has loaded. That makes the fuzzy path non-deterministic on the
// very first `query` miss. To keep these unit tests deterministic and
// synchronous, the exact-match behaviors are exercised through `query`, and the
// fuzzy behaviors (plural, typo, out-of-distance) are exercised by calling
// `fuzzyNearest(index, text, 2)` DIRECTLY against an index built by
// `buildIndex` — exactly the function and signature `query` hands off to, so we
// test the same code path without racing the lazy import.

import { describe, it, expect } from "../../harness.js";
import { buildIndex, query } from "../../../src/lookup/search-index.js";
import { fuzzyNearest } from "../../../src/lookup/fuzzy.js";

/**
 * A small, fixed term table covering every surface-form shape the cases need:
 *   - "neuron" / "neural" — single words (5.1) and the short side of a prefix.
 *   - "neural network" — extends "neural", for the longest-match case (4.2).
 *   - "Spiking Neural Networks" with acronym "SNN" and an alias (6.2, 6.4).
 *   - "box" — a clean `es`-plural stem for the plural pre-step (7.2).
 */
const TERMS = [
  {
    term: "neuron",
    definition: "A single computational unit.",
    pageRef: "/snn/neuron-models",
  },
  {
    term: "neural",
    definition: "Relating to neurons.",
    pageRef: null,
  },
  {
    term: "neural network",
    definition: "A connected graph of neurons.",
    pageRef: "/snn/neural-network",
  },
  {
    term: "Spiking Neural Networks",
    acronym: "SNN",
    aliases: ["spiking net"],
    definition: "Networks that communicate via discrete spikes over time.",
    pageRef: "/snn",
  },
  {
    term: "box",
    definition: "A rectangular container.",
    pageRef: null,
  },
];

const index = buildIndex(TERMS);

describe("search-index query \u2014 exact match", () => {
  it("longest-match wins: 'neural network' resolves to the longer term, not 'neural' (R4.2)", () => {
    const result = query(index, "neural network");
    expect(result !== null).toBe(true);
    expect(result.term).toBe("neural network");
    expect(result.matchKind).toBe("exact");
    expect(result.definition).toBe("A connected graph of neurons.");
    expect(result.pageRef).toBe("/snn/neural-network");
  });

  it("the shorter prefix still resolves on its own: 'neural' alone resolves to 'neural' (R4.2)", () => {
    const result = query(index, "neural");
    expect(result !== null).toBe(true);
    expect(result.term).toBe("neural");
    expect(result.matchKind).toBe("exact");
  });

  it("single word resolves: 'neuron' resolves to the neuron entry (R5.1)", () => {
    const result = query(index, "neuron");
    expect(result !== null).toBe(true);
    expect(result.term).toBe("neuron");
    expect(result.matchKind).toBe("exact");
    expect(result.definition).toBe("A single computational unit.");
  });

  it("acronym resolves to the canonical term: 'SNN' \u2192 Spiking Neural Networks (R6.2)", () => {
    const result = query(index, "SNN");
    expect(result !== null).toBe(true);
    expect(result.term).toBe("Spiking Neural Networks");
    expect(result.matchKind).toBe("exact");
  });

  it("acronym match is case- and whitespace-insensitive: '  snn ' also resolves (R6.2)", () => {
    const result = query(index, "  snn ");
    expect(result !== null).toBe(true);
    expect(result.term).toBe("Spiking Neural Networks");
  });

  it("alias resolves to the canonical term: 'spiking net' \u2192 Spiking Neural Networks (R6.4)", () => {
    const result = query(index, "spiking net");
    expect(result !== null).toBe(true);
    expect(result.term).toBe("Spiking Neural Networks");
    expect(result.matchKind).toBe("exact");
  });
});

describe("search-index query \u2014 empty / punctuation-only selection (R4.5)", () => {
  it("an empty string normalizes to zero tokens and is not queried (returns null)", () => {
    expect(query(index, "")).toBe(null);
  });

  it("a whitespace-only selection is not queried (returns null)", () => {
    expect(query(index, "   \t\n ")).toBe(null);
  });

  it("a punctuation-only selection is not queried (returns null)", () => {
    expect(query(index, "...")).toBe(null);
    expect(query(index, "()")).toBe(null);
    expect(query(index, "\u201c\u201d")).toBe(null);
  });
});

describe("fuzzy fallback \u2014 fuzzyNearest(index, text, 2)", () => {
  it("plural strip-and-retry: 'neurons' \u2192 neuron via a trailing 's' (R7.2)", () => {
    const entry = fuzzyNearest(index, "neurons", 2);
    expect(entry !== null).toBe(true);
    expect(entry.term).toBe("neuron");
  });

  it("plural strip-and-retry handles 'es': 'boxes' \u2192 box (R7.2)", () => {
    const entry = fuzzyNearest(index, "boxes", 2);
    expect(entry !== null).toBe(true);
    expect(entry.term).toBe("box");
  });

  it("a typo within edit distance 2 resolves: 'nueron' \u2192 neuron (R7.3)", () => {
    // "nueron" \u2192 "neuron" is one transposition, which is two single-character
    // edits under Levenshtein (substitute 'u'\u2192'e' and 'e'\u2192'u'), i.e. distance 2.
    const entry = fuzzyNearest(index, "nueron", 2);
    expect(entry !== null).toBe(true);
    expect(entry.term).toBe("neuron");
  });

  it("a one-character typo resolves: 'neurom' \u2192 neuron (R7.3)", () => {
    // "neurom" is Levenshtein distance 1 from "neuron" (substitute the final
    // 'm'\u2192'n') and strictly farther from every other indexed surface form \u2014
    // notably distance 2 from "neural" (positions 5 and 6 differ: o\u2260a, m\u2260l) \u2014
    // so the smallest-distance winner is unambiguously "neuron".
    const entry = fuzzyNearest(index, "neurom", 2);
    expect(entry !== null).toBe(true);
    expect(entry.term).toBe("neuron");
  });

  it("smallest distance wins, ties break lexicographically by surface form (R7.3)", () => {
    // Two single-word terms, "fox" and "fog", each exactly distance 1 from the
    // selection "foz" (substitute the last char). The tie must break by
    // lexicographic order of the surface form: "fog" < "fox", so "fog" wins.
    const tieIndex = buildIndex([
      { term: "fox", definition: "An animal.", pageRef: null },
      { term: "fog", definition: "Low cloud.", pageRef: null },
    ]);
    const entry = fuzzyNearest(tieIndex, "foz", 2);
    expect(entry !== null).toBe(true);
    expect(entry.term).toBe("fog");
  });

  it("a nearer candidate beats a farther one regardless of lexical order (R7.3)", () => {
    // "cat" is distance 1 from "cot"; "cab" is distance 2. Smallest distance
    // must win even though "cab" sorts before "cat".
    const distIndex = buildIndex([
      { term: "cat", definition: "A feline.", pageRef: null },
      { term: "cab", definition: "A taxi.", pageRef: null },
    ]);
    const entry = fuzzyNearest(distIndex, "cot", 2);
    expect(entry !== null).toBe(true);
    expect(entry.term).toBe("cat");
  });

  it("a selection beyond edit distance 2 returns none (R7.4)", () => {
    // "zzzzzzz" shares no useful structure with any indexed surface form, so no
    // candidate lands within distance 2.
    expect(fuzzyNearest(index, "zzzzzzz", 2)).toBe(null);
  });

  it("an empty / punctuation-only selection has nothing to match and returns none (R7.4)", () => {
    expect(fuzzyNearest(index, "", 2)).toBe(null);
    expect(fuzzyNearest(index, "...", 2)).toBe(null);
  });
});
