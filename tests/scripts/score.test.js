// tests/scripts/score.test.js
//
// The library's score (scripts/score.js): real pages count and stubs don't,
// cortical-column pages and working simulations are credited, a widget that
// simulates nothing or fails to mount is not, and glossary links count a tenth
// of a point each. The last case runs it on the real library: every widget a
// page embeds has to work.

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "../harness.js";
import { measure, workingSim, MIN_TEXT } from "../../scripts/score.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const readJson = (rel) => JSON.parse(readFileSync(join(root, rel), "utf8"));

const prose = (n) => ({ type: "prose", text: "x".repeat(n) });
const page = (...blocks) => ({ title: "A page", blocks: [prose(MIN_TEXT), ...blocks] });
const plot = (sim) => ({
  type: "widget",
  widget: {
    type: "parameter-plot",
    title: "A plot",
    params: [{ key: "current", label: "Current", control: "range", min: 0, max: 5, step: 0.1, default: 2 }],
    config: sim === undefined ? {} : { sim },
  },
});

/** Score a tree whose page files are given inline as `{ path: PageContent }`. */
function score(children, files, terms = []) {
  const readPage = (path) => {
    if (!(path in files)) throw new Error(`no file ${path}`);
    return files[path];
  };
  return measure({ slug: "root", title: "Root", children }, terms, readPage);
}

const node = (slug, page, children) => ({ slug, title: slug, page, ...(children ? { children } : {}) });

describe("scripts/score", () => {
  it("counts a page with real text once, and not a stub", async () => {
    const r = await score([node("a", "a.json"), node("b", "b.json"), node("c", "a.json")], {
      "a.json": page(),
      "b.json": { title: "Stub", blocks: [prose(MIN_TEXT - 1)] },
    });
    expect(r.pages).toBe(1);
    expect(r.score).toBe(1);
  });

  it("credits pages under the cortical-column topics", async () => {
    const r = await score(
      [
        node("computational-cortical-columns", "ccc.json", [node("htm", "htm.json")]),
        node("neuroscience", "n.json", [node("cortical-columns", "nc.json"), node("cell-types", "ct.json")]),
      ],
      { "ccc.json": page(), "htm.json": page(), "n.json": page(), "nc.json": page(), "ct.json": page() },
    );
    expect(r.pages).toBe(5);
    expect(r.columnPages).toBe(3);
    expect(r.score).toBe(5 + 2 * 3);
  });

  it("credits a page with a working simulator, and each distinct simulator once", async () => {
    const r = await score([node("a", "a.json"), node("b", "b.json"), node("c", "c.json")], {
      "a.json": page(plot("lif"), plot("hh")),
      "b.json": page(plot("lif")),
      "c.json": page(),
    });
    expect(r.simPages).toBe(2);
    expect(r.sims).toBe(2);
    expect(r.score).toBe(3 + 3 * 2 + 3 * 2);
  });

  it("gives nothing for a widget that simulates nothing or can't mount", async () => {
    const r = await score([node("a", "a.json")], {
      "a.json": page(plot(), plot("no-such-sim"), plot("constructor"), { type: "widget", widget: { type: "no-such-widget" } }),
    });
    expect(r.simPages).toBe(0);
    expect(r.sims).toBe(0);
  });

  it("gives nothing for a simulation on a stub page", async () => {
    const r = await score([node("a", "a.json")], { "a.json": { title: "Stub", blocks: [plot("lif")] } });
    expect(r.simPages).toBe(0);
    expect(r.score).toBe(0);
  });

  it("counts a widget type of its own as one simulation", async () => {
    expect(await workingSim({ type: "sdr-overlap", title: "SDR overlap" })).toBe("sdr-overlap");
    expect(await workingSim(plot("lif").widget)).toBe("parameter-plot:lif");
  });

  it("gives a tenth of a point per term link that lands on a counted page", async () => {
    const terms = [
      ...Array.from({ length: 19 }, (_, i) => ({ term: `t${i}`, pageRef: "#/a" })),
      { term: "stub", pageRef: "#/b" },
      { term: "lost", pageRef: "#/nowhere" },
      { term: "plain" },
    ];
    const r = await score([node("a", "a.json"), node("b", "b.json")], { "a.json": page(), "b.json": { title: "B", blocks: [] } }, terms);
    expect(r.links).toBe(19);
    expect(r.terms).toBe(21);
    expect(r.score).toBe(1 + 1);
  });

  it("finds every widget in the library working", async () => {
    const topics = readJson("content/topics.json");
    const broken = [];
    const walk = (n) => {
      if (n.page) {
        for (const block of readJson(n.page).blocks ?? []) {
          if (block.type === "widget") broken.push(workingSim(block.widget).then((name) => (name ? null : `${n.page}: ${block.widget.type}`)));
        }
      }
      (n.children ?? []).forEach(walk);
    };
    walk(topics);
    expect((await Promise.all(broken)).filter(Boolean)).toEqual([]);
    const r = await measure(topics, readJson("content/terms.json"), readJson);
    expect(r.simPages > 0 && r.sims > 0 && r.columnPages > 0).toBe(true);
  });
});
