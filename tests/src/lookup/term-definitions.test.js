// tests/src/lookup/term-definitions.test.js
//
// Issue #47: terms like VGA are found from the home search, and a term with
// several definitions lets the reader cycle through them.
//
//   - `buildIndex`/`query` carry every definition of the matched term on
//     `result.definitions`, the resolved one first.
//   - `findTerms` (the home search's term matcher) finds a term by its term,
//     alias or acronym, groups repeated terms into one result, and ranks an
//     exact surface match first.
//   - The home page lists matching terms under the search as the person types,
//     with Previous / "n of N" / Next buttons on a term defined more than once.
//   - The lookup panel shows the same cycle control.
//   - Against the real content: "VGA" resolves, and the home search lists it.
//   - VGA vs VSA (one letter apart): an exact term/alias/acronym match always
//     beats the fuzzy fallback, and no fuzzy candidate joins the definitions.
//   - Content is fetched with `cache: "no-cache"`, so a browser never keeps
//     serving a terms.json from before a term was added (the VSA report).
//
// DOM: the shared linkedom DOM from tests/dom.js, re-pinned on the globals per
// case (see home-behavior.test.js). linkedom has no Selection API, so the panel
// case fakes `getSelection` as error-handling.test.js does.

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "../../harness.js";
import { ensureDom } from "../../dom.js";

const dom = await ensureDom();
globalThis.document = dom.document;
globalThis.window = dom.window;

const { buildIndex, query, findTerms } = await import("../../../src/lookup/search-index.js");
const { loadJson, clearContentCache } = await import("../../../src/content-loader.js");
const { installLookup } = await import("../../../src/lookup/lookup-ui.js");
const { renderPage } = await import("../../../src/renderer.js");

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const realTerms = JSON.parse(readFileSync(join(repoRoot, "content", "terms.json"), "utf8"));
const realTopics = JSON.parse(readFileSync(join(repoRoot, "content", "topics.json"), "utf8"));

/** A table where "Spike" is defined twice and "VGA" is an acronym. */
const TERMS = [
  { term: "Spike", definition: "A brief voltage pulse from a neuron.", pageRef: "/snn" },
  { term: "Video Graphics Array", acronym: "VGA", aliases: ["vga port"], definition: "An analog video standard.", pageRef: "/communication-protocols/vga" },
  { term: "spike", definition: "In a raster plot, one tick mark.", pageRef: null },
  { term: "Neuron", definition: "A cell that fires spikes.", pageRef: null },
];

function useRealDom() {
  globalThis.document = dom.document;
  globalThis.window = dom.window;
}

/** Type `text` into the home search and fire its `input` event. */
function typeInto(home, text) {
  const input = home.querySelector(".home-search__input");
  input.value = text;
  input.dispatchEvent(new dom.window.Event("input"));
}

function buildHome(tree, terms) {
  useRealDom();
  const mount = dom.document.createElement("div");
  renderPage({ node: null, path: [], tree, terms }, null, mount);
  return mount.querySelector(".home");
}

function click(el) {
  el.dispatchEvent(new dom.window.Event("click"));
}

describe("query: every definition of the matched term", () => {
  it("returns both definitions of a term defined twice, the resolved one first", () => {
    const result = query(buildIndex(TERMS), "spike");
    expect(result.definitions.length).toBe(2);
    expect(result.definitions[0].definition).toBe(result.definition);
    expect(result.definitions.map((d) => d.definition).sort()).toEqual(
      [TERMS[0].definition, TERMS[2].definition].sort(),
    );
  });

  it("returns a single definition for a term defined once", () => {
    const result = query(buildIndex(TERMS), "VGA");
    expect(result.term).toBe("Video Graphics Array");
    expect(result.definitions.length).toBe(1);
  });
});

describe("findTerms: the home search's term matcher", () => {
  it("finds a term by its acronym, ranking the exact match first", () => {
    const results = findTerms(TERMS, "VGA");
    expect(results[0].term).toBe("Video Graphics Array");
  });

  it("finds a term by a substring of its term or alias", () => {
    expect(findTerms(TERMS, "graphics").map((r) => r.term)).toEqual(["Video Graphics Array"]);
    expect(findTerms(TERMS, "port").map((r) => r.term)).toEqual(["Video Graphics Array"]);
  });

  it("groups a term defined twice into one result holding both definitions", () => {
    const results = findTerms(TERMS, "spike");
    expect(results.length).toBe(1);
    expect(results[0].definitions.length).toBe(2);
  });

  it("returns nothing for an empty text", () => {
    expect(findTerms(TERMS, "   ")).toEqual([]);
  });
});

describe("home search lists matching terms", () => {
  const tree = { slug: "", title: "", children: [{ slug: "snn", title: "Spiking Neural Networks" }] };

  it("shows a term found by its acronym, with its definition and page link", () => {
    const home = buildHome(tree, TERMS);
    const section = home.querySelector(".home-terms");
    expect(section.hidden).toBe(true);

    typeInto(home, "vga");
    expect(section.hidden).toBe(false);
    const first = section.querySelector(".home-term");
    expect(first.querySelector(".home-term__term").textContent).toBe("Video Graphics Array (VGA)");
    expect(first.querySelector(".home-term__link").getAttribute("href")).toBe("#/communication-protocols/vga");

    typeInto(home, "");
    expect(section.hidden).toBe(true);
  });

  it("cycles through a term's definitions with Next and Previous, wrapping", () => {
    const home = buildHome(tree, TERMS);
    typeInto(home, "spike");
    const item = home.querySelector(".home-term");
    const definition = () => item.querySelector(".home-term__definition").textContent;
    const count = () => item.querySelector(".home-term__cycle-count").textContent;
    const [prev, next] = item.querySelectorAll(".home-term__cycle-button");

    expect(definition()).toBe(TERMS[0].definition);
    expect(count()).toBe("1 of 2");
    expect(item.querySelector(".home-term__link")).toBeTruthy();

    click(next);
    expect(definition()).toBe(TERMS[2].definition);
    expect(count()).toBe("2 of 2");
    // The second definition has no page, so its link is gone.
    expect(item.querySelector(".home-term__link")).toBe(null);

    click(next);
    expect(count()).toBe("1 of 2");
    click(prev);
    expect(count()).toBe("2 of 2");
  });

  it("shows no cycle control for a term defined once", () => {
    const home = buildHome(tree, TERMS);
    typeInto(home, "neuron");
    expect(home.querySelector(".home-term__cycle")).toBe(null);
  });
});

describe("lookup panel cycles through definitions", () => {
  it("shows 1 of 2 for a term defined twice and steps to the other", () => {
    useRealDom();
    const view = dom.window;
    const root = dom.document.createElement("div");
    root.textContent = "a spike here";
    dom.document.body.appendChild(root);

    const realGetSelection = view.getSelection;
    view.getSelection = () => ({
      toString: () => "spike",
      rangeCount: 1,
      getRangeAt: () => ({ getBoundingClientRect: () => ({ left: 0, top: 0, bottom: 10, right: 10 }) }),
    });

    try {
      installLookup(buildIndex(TERMS), root);
      root.dispatchEvent(new view.Event("mouseup"));

      const panel = dom.document.body.querySelector(".lookup-panel");
      expect(panel.querySelector(".lookup-panel__cycle-count").textContent).toBe("1 of 2");
      expect(panel.querySelector(".lookup-panel__definition").textContent).toBe(TERMS[0].definition);

      const [, next] = panel.querySelectorAll(".lookup-panel__cycle-button");
      click(next);
      expect(panel.querySelector(".lookup-panel__cycle-count").textContent).toBe("2 of 2");
      expect(panel.querySelector(".lookup-panel__definition").textContent).toBe(TERMS[2].definition);
    } finally {
      view.getSelection = realGetSelection;
      dom.document.body.querySelector(".lookup-panel")?.remove();
      root.remove();
    }
  });
});

describe("real content: VGA is found", () => {
  it("double-click lookup of 'VGA' resolves to Video Graphics Array", () => {
    const result = query(buildIndex(realTerms), "(VGA)");
    expect(result.term).toBe("Video Graphics Array");
  });

  it("the home search lists Video Graphics Array for 'VGA'", () => {
    const home = buildHome(realTopics, realTerms);
    typeInto(home, "VGA");
    const terms = [...home.querySelectorAll(".home-term__term")].map((t) => t.textContent);
    expect(terms[0]).toBe("Video Graphics Array (VGA)");
  });
});

/** Query once and let the lazily imported fuzzy fallback finish loading. */
async function warmFuzzy(index) {
  query(index, "zzqqxx");
  await new Promise((r) => setTimeout(r, 50));
}

describe("VGA vs VSA: exact beats fuzzy", () => {
  const VSA = { term: "Vector Symbolic Architecture", acronym: "VSA", definition: "Computing with high-dimensional vectors.", pageRef: null };
  const VGA = { term: "Video Graphics Array", acronym: "VGA", definition: "An analog video standard.", pageRef: null };

  it("'VGA' resolves exactly to Video Graphics Array, in any case, with VSA indexed first", async () => {
    const index = buildIndex([VSA, VGA]);
    await warmFuzzy(index);
    for (const text of ["VGA", "vga", "Vga", "(VGA)", "VGA:"]) {
      const result = query(index, text);
      expect(result.term).toBe("Video Graphics Array");
      expect(result.matchKind).toBe("exact");
      // The one-letter-off VSA is never mixed into the definitions to cycle.
      expect(result.definitions.map((d) => d.term)).toEqual(["Video Graphics Array"]);
    }
  });

  it("'VSA' still resolves exactly to Vector Symbolic Architecture", async () => {
    const index = buildIndex([VGA, VSA]);
    await warmFuzzy(index);
    expect(query(index, "VSA").term).toBe("Vector Symbolic Architecture");
  });

  it("against the real terms.json, 'VGA' is exact and its definitions hold only VGA", async () => {
    const index = buildIndex(realTerms);
    await warmFuzzy(index);
    const result = query(index, "VGA");
    expect(result.matchKind).toBe("exact");
    expect(result.definitions.every((d) => d.term === "Video Graphics Array")).toBe(true);
  });

  it("without a VGA entry (a stale terms.json), the VSA hit is flagged approximate", async () => {
    const index = buildIndex([VSA]);
    await warmFuzzy(index);
    const result = query(index, "VGA");
    expect(result.term).toBe("Vector Symbolic Architecture");
    expect(result.matchKind).toBe("fuzzy");
  });
});

describe("content is revalidated on load", () => {
  it("fetches with cache: no-cache so a newly added term is never missed", async () => {
    const realFetch = globalThis.fetch;
    let seen = null;
    globalThis.fetch = async (url, init) => {
      seen = init;
      return { ok: true, status: 200, text: async () => "[]", json: async () => [] };
    };
    try {
      clearContentCache();
      await loadJson("content/terms-revalidate-check.json");
      expect(seen && seen.cache).toBe("no-cache");
    } finally {
      globalThis.fetch = realFetch;
      clearContentCache();
    }
  });
});
