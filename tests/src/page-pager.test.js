// tests/src/page-pager.test.js
//
// Every topic page ends with previous/next arrows (`nav.page-pager`) linking to
// the topics either side of it in the sidebar's order: depth-first, each topic
// before its subtopics. The first page has no "previous", the last no "next",
// and a page rendered without the tree (no `resolution.tree`) has no pager.
//
// Uses the real linkedom DOM from tests/dom.js, re-pinned as the ambient
// `document` per render because other suites install their own stub.

import { describe, it, expect } from "../harness.js";
import { ensureDom } from "../dom.js";

const dom = await ensureDom();
globalThis.document = dom.document;
globalThis.window = dom.window;

const { renderPage, pageNeighbours } = await import("../../src/renderer.js");

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
      { slug: "math", title: "Mathematics" },
    ],
  };
}

/** Render the topic page at `path` into a fresh mount; return its pager. */
function pagerAt(path, withTree = true) {
  globalThis.document = dom.document;
  globalThis.window = dom.window;
  const t = tree();
  let node = null;
  let siblings = t.children;
  for (const slug of path) {
    node = siblings.find((n) => n.slug === slug);
    siblings = node.children ?? [];
  }
  const resolution = { path, node, pageFile: null, crumbs: [] };
  if (withTree) resolution.tree = t;
  const mount = dom.document.createElement("div");
  renderPage(resolution, { title: node.title, blocks: [] }, mount);
  return mount.querySelector(".page > nav.page-pager");
}

const href = (pager, dir) =>
  pager.querySelector(`.page-pager__link--${dir}`)?.getAttribute("href") ?? null;

describe("page pager (previous / next arrows)", () => {
  it("walks the tree depth-first, a topic before its subtopics", () => {
    const order = [["snn"], ["snn", "neuron-models"], ["snn", "neuron-models", "lif"], ["math"]];
    for (let i = 0; i < order.length; i++) {
      const { prev, next } = pageNeighbours(tree(), order[i]);
      expect(prev ? prev.path.join("/") : null).toBe(i > 0 ? order[i - 1].join("/") : null);
      expect(next ? next.path.join("/") : null).toBe(
        i < order.length - 1 ? order[i + 1].join("/") : null,
      );
    }
  });

  it("links both neighbours from a middle page, with titles and arrows", () => {
    const p = pagerAt(["snn", "neuron-models"]);
    expect(p.getAttribute("aria-label")).toBe("Previous and next pages");
    expect(href(p, "prev")).toBe("#/snn");
    expect(href(p, "next")).toBe("#/snn/neuron-models/lif");
    const next = p.querySelector(".page-pager__link--next");
    expect(next.getAttribute("rel")).toBe("next");
    expect(next.querySelector(".page-pager__title").textContent).toBe("Leaky Integrate-and-Fire");
    expect(next.querySelector(".page-pager__arrow").getAttribute("aria-hidden")).toBe("true");
  });

  it("gives the first page only next and the last only previous", () => {
    const first = pagerAt(["snn"]);
    expect(href(first, "prev")).toBe(null);
    expect(href(first, "next")).toBe("#/snn/neuron-models");
    const last = pagerAt(["math"]);
    expect(href(last, "prev")).toBe("#/snn/neuron-models/lif");
    expect(href(last, "next")).toBe(null);
  });

  it("renders no pager without the tree, or for a path not in it", () => {
    expect(pagerAt(["math"], false)).toBe(null);
    const { prev, next } = pageNeighbours(tree(), ["nope"]);
    expect(prev).toBe(null);
    expect(next).toBe(null);
  });

  it("builds the order once per tree and reuses it", () => {
    const t = tree();
    pageNeighbours(t, ["snn", "neuron-models"]);
    const b = pageNeighbours(t, ["snn", "neuron-models", "lif"]);
    expect(pageNeighbours(t, ["snn"]).next === b.prev).toBe(true);
    // A different tree object gets its own order.
    expect(pageNeighbours(tree(), ["snn"]).next === b.prev).toBe(false);
  });
});
