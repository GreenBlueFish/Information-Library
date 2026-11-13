// tests/src/lookup/definition-card.source.test.js
//
// Requirement 11.5: the definition card shows where a definition comes from.
// `fillDefinitionCard` renders a source label ("from <Topic>") under the
// definition — drawn from `d.source?.title` into the `classes.source` element —
// and omits that label when a definition carries no `source`. When a term has
// several definitions and the card cycles, the label follows the shown
// definition's source in `show(i)`.
//
// DOM: the shared linkedom DOM from tests/dom.js, pinned on the globals the way
// term-definitions.test.js does, so the card can create nodes against it.

import { describe, it, expect } from "../../harness.js";
import { ensureDom } from "../../dom.js";

const dom = await ensureDom();
globalThis.document = dom.document;
globalThis.window = dom.window;

const { fillDefinitionCard } = await import("../../../src/lookup/definition-card.js");

/** The class names the lookup panel passes for the card parts (lookup-ui.js). */
const CLASS = {
  term: "lookup-panel__term",
  acronym: "lookup-panel__acronym",
  definition: "lookup-panel__definition",
  source: "lookup-panel__source",
  link: "lookup-panel__link",
  cycle: "lookup-panel__cycle",
  cycleButton: "lookup-panel__cycle-button",
  cycleCount: "lookup-panel__cycle-count",
};

/** A fresh detached container the card fills. */
function makeContainer() {
  return dom.document.createElement("div");
}

/** Fill a container with these definitions and return the controller + node. */
function fill(definitions) {
  const container = makeContainer();
  const controller = fillDefinitionCard(dom.document, container, definitions, CLASS);
  return { container, controller };
}

/** The rendered source label's text, or null when no label is in the card. */
function sourceText(container) {
  const label = container.querySelector(`.${CLASS.source}`);
  // The card removes the label from the tree (or empties it) when a definition
  // has no source, so "no label" means an absent or empty node.
  return label && label.textContent ? label.textContent : null;
}

/** The two cycle buttons (Prev, Next), present only for 2+ definitions. */
function cycleButtons(container) {
  return [...container.querySelectorAll(`.${CLASS.cycleButton}`)];
}

function click(el) {
  el.dispatchEvent(new dom.window.Event("click"));
}

describe("definition-card source label (Req 11.5)", () => {
  it("shows 'from <Topic>' for a definition that carries a source", () => {
    const { container } = fill([
      {
        term: "Spike",
        definition: "A brief voltage pulse from a neuron.",
        pageRef: "/snn",
        source: { route: "/snn", title: "Spiking Neural Networks" },
      },
    ]);
    expect(sourceText(container)).toBe("from Spiking Neural Networks");
  });

  it("places the source label under the definition and before the Open page link", () => {
    const { container } = fill([
      {
        term: "Neuron",
        definition: "A cell that fires spikes.",
        pageRef: "/snn",
        source: { route: "/snn", title: "Spiking Neural Networks" },
      },
    ]);
    const parts = [...container.children].map((el) => el.className);
    expect(parts.indexOf(CLASS.definition) < parts.indexOf(CLASS.source)).toBe(true);
    expect(parts.indexOf(CLASS.source) < parts.indexOf(CLASS.link)).toBe(true);
  });

  it("omits the label when the definition has no source", () => {
    const { container } = fill([
      { term: "Neuron", definition: "A cell that fires spikes.", pageRef: null },
    ]);
    expect(sourceText(container)).toBe(null);
  });

  it("omits the label for a source with no title", () => {
    const { container } = fill([
      {
        term: "Neuron",
        definition: "A cell that fires spikes.",
        pageRef: null,
        source: { route: "/snn" },
      },
    ]);
    expect(sourceText(container)).toBe(null);
  });

  it("updates the label as the card cycles through definitions with different sources", () => {
    const { container } = fill([
      {
        term: "Spike",
        definition: "A brief voltage pulse from a neuron.",
        pageRef: "/snn",
        source: { route: "/snn", title: "Spiking Neural Networks" },
      },
      {
        term: "Spike",
        definition: "A sharp transient on a signal line.",
        pageRef: null,
        source: { route: "/analog-design", title: "Analog Design" },
      },
    ]);

    // First definition's source shows to start.
    expect(sourceText(container)).toBe("from Spiking Neural Networks");

    const [, next] = cycleButtons(container);
    click(next);
    expect(sourceText(container)).toBe("from Analog Design");

    click(next);
    expect(sourceText(container)).toBe("from Spiking Neural Networks");
  });

  it("drops the label when cycling from a sourced definition to one with no source", () => {
    const { container } = fill([
      {
        term: "Gain",
        definition: "Output over input of an amplifier.",
        pageRef: "/analog-design",
        source: { route: "/analog-design", title: "Analog Design" },
      },
      { term: "Gain", definition: "A general increase in magnitude.", pageRef: null },
    ]);

    expect(sourceText(container)).toBe("from Analog Design");

    const [, next] = cycleButtons(container);
    click(next);
    expect(sourceText(container)).toBe(null);

    click(next);
    expect(sourceText(container)).toBe("from Analog Design");
  });
});
