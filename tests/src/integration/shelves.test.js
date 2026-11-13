// tests/src/integration/shelves.test.js
//
// The library's layout after the shelves move:
//   - the root lists shelves, each kept in its own file under content/topics/;
//   - every page lives at content/pages/<route>/index.json (folder per node),
//     so any node can grow children without its file moving;
//   - titles carry no "1." style numbers (the tree's own order is the order);
//   - content/redirects.json sends every old address to a page that exists;
//   - the Credits page is hidden from the nav, the home and the page arrows,
//     but its route resolves.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "../../harness.js";
import { ensureDom } from "../../dom.js";
import { readTopicTree } from "../../../scripts/topic-tree.js";
import { assembleTopics, redirectSegments } from "../../../src/content-loader.js";
import { resolveRoute, parseHash } from "../../../src/router.js";

const dom = await ensureDom();
const { renderPage, renderNav, pageNeighbours } = await import("../../../src/renderer.js");

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const readJson = (rel) => JSON.parse(readFileSync(join(repoRoot, rel), "utf8"));
const tree = readTopicTree(repoRoot);
const redirects = readJson("content/redirects.json").redirects;

/** Every node with its route, depth first. */
function nodes(node = tree, prefix = "", out = []) {
  for (const child of node.children ?? []) {
    const route = `${prefix}/${child.slug}`;
    out.push({ node: child, route });
    nodes(child, route, out);
  }
  return out;
}

function pageFiles(dir = "content/pages", out = []) {
  for (const name of readdirSync(join(repoRoot, dir))) {
    const rel = `${dir}/${name}`;
    if (statSync(join(repoRoot, rel)).isDirectory()) pageFiles(rel, out);
    else if (name.endsWith(".json")) out.push(rel);
  }
  return out;
}

function pinDom() {
  globalThis.document = dom.document;
  globalThis.window = dom.window;
  return dom.document.createElement("div");
}

describe("shelves: the topic tree", () => {
  it("the root holds only shelves (in their own files) and hidden pages", () => {
    const root = readJson("content/topics.json");
    for (const child of root.children) {
      if (child.file) {
        expect(child.slug).toBe(undefined);
        expect(readJson(child.file).shelf).toBe(true);
      } else {
        expect(child.hidden).toBe(true);
      }
    }
    expect(tree.children.filter((c) => c.shelf).length >= 2).toBe(true);
  });

  it("assembleTopics swaps each file stub for the node it names", async () => {
    const root = { slug: "root", children: [{ file: "a.json" }, { slug: "x", hidden: true }] };
    const out = await assembleTopics(root, async (f) => ({ slug: f.replace(".json", ""), shelf: true }));
    expect(out.children.map((c) => c.slug)).toEqual(["a", "x"]);
    expect(root.children[0].slug).toBe(undefined); // input untouched
  });

  it("every page is <route>/index.json, every node has one, and no page file is orphaned", () => {
    const used = new Set();
    for (const { node, route } of nodes()) {
      if (node.ref) {
        // A path step borrows another node's page; it must name a real page.
        expect(node.page).toBe(undefined);
        expect(resolveRoute(tree, parseHash(route)).refPath.join("/")).toBe(node.ref.slice(1));
        continue;
      }
      expect(node.page).toBe(`content/pages${route}/index.json`);
      expect(existsSync(join(repoRoot, node.page))).toBe(true);
      used.add(node.page);
    }
    const orphans = pageFiles().filter((f) => !used.has(f));
    expect(orphans).toEqual([]);
  });

  it("no Computational Cortical Columns text refers to a numbered section", () => {
    const bad = pageFiles("content/pages/brain").filter((f) =>
      /\b[Ss]ections? [1-9](?!\d|\.\d)/.test(readFileSync(join(repoRoot, f), "utf8")));
    expect(bad).toEqual([]);
  });

  it("no title starts with a number", () => {
    for (const { node } of nodes()) {
      if (/^\d+\.\s/.test(node.title)) throw new Error(`numbered title: ${node.title}`);
      const page = node.page ? readJson(node.page) : {};
      if (/^\d+\.\s/.test(page.title ?? "")) throw new Error(`numbered page title: ${node.page}`);
    }
  });
});

describe("shelves: redirects", () => {
  it("every redirect target resolves", () => {
    for (const [from, to] of Object.entries(redirects)) {
      expect(resolveRoute(tree, parseHash(to)) !== null).toBe(true);
      expect(resolveRoute(tree, parseHash(from))).toBe(null);
    }
  });

  it("no redirect points at another redirect", () => {
    for (const to of Object.values(redirects)) {
      expect(redirectSegments(redirects, parseHash(to))).toBe(null);
    }
  });

  it("an old deep address keeps its tail and lands on the same page", () => {
    const moved = redirectSegments(redirects, parseHash("#/snn/neuron-models/lif"));
    expect(moved).toEqual(["brain", "snn", "neuron-models", "lif"]);
    expect(resolveRoute(tree, moved).node.slug).toBe("lif");
  });

  it("the longest matching prefix wins", () => {
    const map = { "/a": "/x/a", "/a/credits": "/credits" };
    expect(redirectSegments(map, ["a", "credits"])).toEqual(["credits"]);
    expect(redirectSegments(map, ["a", "b"])).toEqual(["x", "a", "b"]);
    expect(redirectSegments(map, ["z"])).toBe(null);
  });

  it("no link inside the library relies on a redirect", () => {
    const bad = [];
    for (const file of pageFiles()) {
      for (const m of readFileSync(join(repoRoot, file), "utf8").matchAll(/#\/([a-z0-9][a-z0-9/-]*)/g)) {
        if (!resolveRoute(tree, parseHash(m[1]))) bad.push(`${file}: #/${m[1]}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe("shelves: hidden pages and the home", () => {
  it("the Credits page resolves but is in no nav, home card or page arrow", () => {
    expect(resolveRoute(tree, ["credits"]).node.slug).toBe("credits");
    const nav = pinDom();
    renderNav(tree, [], nav);
    expect([...nav.querySelectorAll(".nav-tree__link")].some((a) => a.getAttribute("href") === "#/credits")).toBe(false);
    const home = pinDom();
    renderPage({ node: null, path: [], tree }, null, home);
    expect(home.querySelector('a[href="#/credits"]')).toBe(null);
    const last = nodes().filter(({ node }) => !node.hidden).at(-1);
    expect(pageNeighbours(tree, last.route.slice(1).split("/")).next).toBe(null);
  });

  it("the home has a section per shelf holding a card per topic", () => {
    const home = pinDom();
    renderPage({ node: null, path: [], tree }, null, home);
    const sections = [...home.querySelectorAll(".home-shelf")];
    const shelves = tree.children.filter((c) => c.shelf);
    expect(sections.length).toBe(shelves.length);
    shelves.forEach((shelf, i) => {
      expect(sections[i].querySelectorAll(".home-card").length).toBe(shelf.children.length);
    });
  });
});

describe("path steps (ref nodes)", () => {
  const t = {
    slug: "root",
    children: [
      { slug: "s", title: "Shelf", shelf: true, children: [
        { slug: "ref-topic", title: "Ref Topic", page: "r.json", children: [{ slug: "leaf", title: "Leaf", page: "leaf.json" }] },
        { slug: "path", title: "Path", page: "p.json", children: [
          { slug: "step", title: "Leaf", ref: "/s/ref-topic/leaf" },
          { slug: "broken", title: "Broken", ref: "/s/nowhere" },
          { slug: "chained", title: "Chained", ref: "/s/path/step" },
        ] },
      ] },
    ],
  };

  it("a step resolves on the path, with the borrowed page and its home", () => {
    const res = resolveRoute(t, ["s", "path", "step"]);
    expect(res.node.slug).toBe("step");
    expect(res.pageFile).toBe("leaf.json");
    expect(res.refPath).toEqual(["s", "ref-topic", "leaf"]);
    expect(res.crumbs.map((n) => n.slug)).toEqual(["s", "path", "step"]);
  });

  it("a ref to a missing page, or to another ref, does not resolve and is reported", () => {
    const seen = [];
    expect(resolveRoute(t, ["s", "path", "broken"], (e) => seen.push(e.kind))).toBe(null);
    expect(resolveRoute(t, ["s", "path", "chained"], (e) => seen.push(e.kind))).toBe(null);
    expect(seen).toEqual(["bad-ref", "bad-ref"]);
  });

  it("the page says where it lives, naming the topics above it but not the shelf", () => {
    const mount = pinDom();
    const res = resolveRoute(t, ["s", "path", "step"]);
    renderPage({ ...res, tree: t }, { title: "Leaf", blocks: [] }, mount);
    const note = mount.querySelector(".page-ref-note");
    expect(note.textContent).toBe("This page lives in Ref Topic.");
    expect(note.querySelector("a").getAttribute("href")).toBe("#/s/ref-topic/leaf");
  });
});

describe("shared pages search both topics' glossaries", async () => {
  const { linkedRoutes, topLevelTitle } = await import("../../../src/main.js");
  it("a step links to the page it borrows, and the page links back to the step", () => {
    const step = ["brain", "computational-cortical-columns", "spiking-neuron-models", "leaky-integrate-and-fire"];
    expect(linkedRoutes(tree, step)).toEqual([["brain", "snn", "neuron-models", "lif"]]);
    expect(linkedRoutes(tree, ["brain", "snn", "neuron-models", "lif"])).toEqual([step]);
    expect(linkedRoutes(tree, ["brain", "snn"])).toEqual([]);
  });
  it("the topic title skips the shelf", () => {
    expect(topLevelTitle(tree, ["brain", "snn", "encoding"])).toBe("Spiking Neural Networks");
    expect(topLevelTitle(tree, ["brain"])).toBe("Brain & Neuromorphic");
  });
});
