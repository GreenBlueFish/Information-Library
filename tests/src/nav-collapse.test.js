// tests/src/nav-collapse.test.js
//
// The sidebar topic tree (renderNav) opens on the top-level topics only: each
// node with subtopics gets a `button.nav-tree__toggle` and its nested list
// starts `hidden`. The active route's ancestors open on their own, a click
// toggles one node, and what the reader opened survives the re-render that
// every route change does.
//
// Uses the real linkedom DOM from tests/dom.js (clicks need real listeners),
// re-pinned as the ambient `document` at the start of each test because other
// suites install their own stub; see home-behavior.test.js for the rationale.

import { describe, it, expect } from "../harness.js";
import { ensureDom } from "../dom.js";

const dom = await ensureDom();
globalThis.document = dom.document;
globalThis.window = dom.window;

const { renderNav, resetNavExpansion } = await import("../../src/renderer.js");

function tree() {
  return {
    slug: "root",
    title: "Root",
    children: [
      {
        slug: "snn",
        title: "Spiking Neural Networks",
        children: [
          {
            slug: "neuron-models",
            title: "Neuron Models",
            children: [{ slug: "lif", title: "Leaky Integrate-and-Fire" }],
          },
        ],
      },
      {
        slug: "columns",
        title: "Cortical Columns",
        children: [{ slug: "layers", title: "Layers" }],
      },
      { slug: "math", title: "Mathematics" },
    ],
  };
}

/** Render the nav for `activePath` into a fresh mount on the real DOM. */
function nav(activePath) {
  globalThis.document = dom.document;
  globalThis.window = dom.window;
  const mount = dom.document.createElement("div");
  renderNav(tree(), activePath, mount);
  return mount;
}

/** The toggle button in the row of the node whose link points at `href`. */
function toggleFor(mount, href) {
  const link = mount.querySelector(`.nav-tree__link[href="${href}"]`);
  return link.parentNode.querySelector(".nav-tree__toggle");
}

/** True when the link to `href` sits under no hidden list. */
function visible(mount, href) {
  let node = mount.querySelector(`.nav-tree__link[href="${href}"]`);
  while (node && node !== mount) {
    if (node.hidden) return false;
    node = node.parentNode;
  }
  return true;
}

function click(button) {
  button.dispatchEvent(new dom.window.Event("click"));
}

describe("renderNav collapsible subtopics", () => {
  it("opens on the home route with only the top-level topics visible", () => {
    resetNavExpansion();
    const m = nav([]);
    expect(visible(m, "#/snn")).toBe(true);
    expect(visible(m, "#/columns")).toBe(true);
    expect(visible(m, "#/math")).toBe(true);
    expect(visible(m, "#/snn/neuron-models")).toBe(false);
    expect(visible(m, "#/columns/layers")).toBe(false);

    const t = toggleFor(m, "#/snn");
    expect(t.getAttribute("type")).toBe("button");
    expect(t.getAttribute("aria-expanded")).toBe("false");
    const list = m.querySelector(`#${t.getAttribute("aria-controls")}`);
    expect(list.hidden).toBe(true);
    // A leaf gets no toggle.
    expect(toggleFor(m, "#/math")).toBe(null);
  });

  it("opens the active route's ancestors so the current page shows", () => {
    resetNavExpansion();
    const m = nav(["snn", "neuron-models", "lif"]);
    expect(visible(m, "#/snn/neuron-models/lif")).toBe(true);
    expect(toggleFor(m, "#/snn").getAttribute("aria-expanded")).toBe("true");
    expect(visible(m, "#/columns/layers")).toBe(false);
  });

  it("a click expands then collapses one node, leaving others alone", () => {
    resetNavExpansion();
    const m = nav([]);
    click(toggleFor(m, "#/snn"));
    expect(toggleFor(m, "#/snn").getAttribute("aria-expanded")).toBe("true");
    expect(visible(m, "#/snn/neuron-models")).toBe(true);
    expect(visible(m, "#/snn/neuron-models/lif")).toBe(false);
    expect(visible(m, "#/columns/layers")).toBe(false);

    click(toggleFor(m, "#/snn"));
    expect(toggleFor(m, "#/snn").getAttribute("aria-expanded")).toBe("false");
    expect(visible(m, "#/snn/neuron-models")).toBe(false);
  });

  it("keeps what the reader opened across a re-render", () => {
    resetNavExpansion();
    click(toggleFor(nav([]), "#/columns"));
    const m = nav(["math"]);
    expect(visible(m, "#/columns/layers")).toBe(true);
    expect(visible(m, "#/snn/neuron-models")).toBe(false);
    resetNavExpansion();
  });
});
