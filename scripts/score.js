// scripts/score.js
//
// The library's score: how much a learner can understand and try out, not how
// long its glossary is. Every count is over the topic tree as the real router
// reaches it.
//
//   pages        — distinct page files that parse as PageContent with a title
//                  and at least MIN_TEXT characters of readable text (prose,
//                  heading, list, code, callout): a real explanation, not a
//                  stub; a second node pointing at the same file adds nothing
//   column pages — such pages under one of COLUMN_ROOTS, the Computational
//                  Cortical Columns material goals.md asks to understand
//   sim pages    — such pages with at least one working simulation widget
//   sims         — distinct simulations working on such pages: a widget type,
//                  or for `parameter-plot` the `config.sim` it runs
//   links        — terms in content/terms.json whose `pageRef` lands on a
//                  node with such a page
//
// A widget works when its type is one of src/widgets/types/, it mounts in a DOM (linkedom,
// the one the tests use) without throwing, draws something, shows no error or
// placeholder and has no NaN in what it drew. A `parameter-plot` only counts
// when `config.sim` names a real simulator in src/widgets/sims/ that returns
// finite, non-empty series for its defaults; without one it plots a generic
// demo curve, which simulates nothing.
//
//   score = pages + 2·column pages + 3·sim pages + 3·sims + floor(links / 10)
//
// Prints the breakdown, then the score alone on the last line. Higher is
// better. Usage: node scripts/score.js

import { readdirSync, readFileSync } from "node:fs";
import { register } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { parseHash, resolveRoute } from "../src/router.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const MIN_TEXT = 1000;
export const COLUMN_ROOTS = ["computational-cortical-columns", "neuroscience/cortical-columns"];
export const WEIGHTS = { pages: 1, columnPages: 2, simPages: 3, sims: 3, linksPer: 10 };

/** The readable text in a content block, whitespace collapsed. */
function blockText(block) {
  const parts = [block?.text, block?.source, ...(Array.isArray(block?.items) ? block.items : [])];
  return parts.filter((p) => typeof p === "string").join(" ").replace(/\s+/g, " ").trim();
}

/** The page at `path` when it is PageContent with real text, else null. */
function loadPage(path, readPage) {
  if (typeof path !== "string") return null;
  try {
    const page = readPage(path);
    if (typeof page?.title !== "string" || !page.title.trim() || !Array.isArray(page.blocks)) return null;
    return page.blocks.map(blockText).join(" ").length >= MIN_TEXT ? page : null;
  } catch {
    return null;
  }
}

let widgetsReady = null;

/**
 * A DOM to mount into, and the mount function of every widget type in
 * src/widgets/types/. Each type module is loaded afresh and its mount function
 * taken from the registry straight away, so a stand-in registered for the same
 * type elsewhere (as some tests do) is never the one measured.
 */
function prepareWidgets() {
  widgetsReady ??= (async () => {
    const { ensureDom } = await import("../tests/dom.js");
    const dom = await ensureDom();
    const { getWidget, widgetTypes } = await import("../src/widgets/registry.js");
    const snapshot = () => new Map(widgetTypes().map((t) => [t, getWidget(t)]));
    const mounts = new Map();
    const dir = join(root, "src/widgets/types");
    for (const name of readdirSync(dir).filter((n) => n.endsWith(".js")).sort()) {
      const before = snapshot();
      await import(`${pathToFileURL(join(dir, name)).href}?score`);
      for (const [type, mount] of snapshot()) if (before.get(type) !== mount) mounts.set(type, mount);
    }
    const { SIMS } = await import("../src/widgets/sims/index.js");
    return { dom, mounts, SIMS };
  })();
  return widgetsReady;
}

/** True when `sim` returns finite, non-empty series for its defaults. */
function simRuns(sim, config) {
  try {
    const out = sim(config, {});
    return (
      Array.isArray(out) &&
      out.length > 0 &&
      out.every((s) => s?.points?.length > 0 && s.points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)))
    );
  } catch {
    return false;
  }
}

/**
 * The simulation a widget spec runs, named for counting distinct ones, when it
 * mounts and works; else null.
 */
export async function workingSim(spec) {
  const { dom, mounts, SIMS } = await prepareWidgets();
  const mount = typeof spec?.type === "string" ? mounts.get(spec.type) : undefined;
  if (!mount) return null;
  let name = spec.type;
  if (spec.type === "parameter-plot") {
    const sim = spec.config?.sim;
    if (typeof sim !== "string" || !Object.hasOwn(SIMS, sim) || !simRuns(SIMS[sim], spec.config)) return null;
    name = `parameter-plot:${sim}`;
  }
  const container = dom.freshMount();
  const ambient = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { value: dom.document, configurable: true, writable: true });
  let instance = null;
  try {
    instance = mount({ container, spec });
    if (!instance) return null;
    const drew = container.querySelector("svg, canvas, button, input, select") !== null;
    const failed =
      container.querySelector(".widget-placeholder, .block--error") !== null ||
      [...container.querySelectorAll(".widget__control-error")].some((e) => !e.hidden) ||
      /NaN/.test(container.innerHTML);
    return drew && !failed ? name : null;
  } catch {
    return null;
  } finally {
    try {
      instance?.destroy?.();
    } catch {
      // A widget that can't tear down still drew; the tests catch that.
    }
    if (ambient) Object.defineProperty(globalThis, "document", ambient);
    else delete globalThis.document;
  }
}

/**
 * Score a library: `topics` is the tree, `terms` the glossary, `readPage` reads
 * a page file by its path (throwing when it can't).
 */
export async function measure(topics, terms, readPage) {
  const pages = new Map(); // page file -> { column, sims: Set }
  const nodes = [];
  const walk = (node, path) => {
    if (node !== topics) nodes.push({ node, path });
    for (const child of node.children ?? []) walk(child, node === topics ? child.slug : `${path}/${child.slug}`);
  };
  for (const child of topics.children ?? []) walk(child, child.slug);

  for (const { node, path } of nodes) {
    const column = COLUMN_ROOTS.some((r) => path === r || path.startsWith(`${r}/`));
    const seen = pages.get(node.page);
    if (seen) {
      seen.column ||= column;
      continue;
    }
    const page = loadPage(node.page, readPage);
    if (!page) continue;
    const sims = new Set();
    for (const block of page.blocks) {
      if (block?.type !== "widget") continue;
      const name = await workingSim(block.widget);
      if (name) sims.add(name);
    }
    pages.set(node.page, { column, sims });
  }

  let links = 0;
  const withRefs = terms.filter((t) => t.pageRef);
  for (const term of withRefs) {
    const segments = parseHash(term.pageRef);
    const res = segments.length ? resolveRoute(topics, segments, () => {}) : null;
    if (res && res.node.slug === segments.at(-1) && pages.has(res.node.page)) links++;
  }

  const all = [...pages.values()];
  const sims = new Set(all.flatMap((p) => [...p.sims]));
  const counts = {
    pages: all.length,
    columnPages: all.filter((p) => p.column).length,
    simPages: all.filter((p) => p.sims.size > 0).length,
    sims: sims.size,
    links,
    terms: withRefs.length,
  };
  const score =
    WEIGHTS.pages * counts.pages +
    WEIGHTS.columnPages * counts.columnPages +
    WEIGHTS.simPages * counts.simPages +
    WEIGHTS.sims * counts.sims +
    Math.floor(links / WEIGHTS.linksPer);
  return { ...counts, score };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  // tests/dom.js loads linkedom by https:// URL; these hooks serve it from
  // tests/vendor/, as they do for the test suite.
  register("../tests/net/hooks.js", import.meta.url);
  const readJson = (rel) => JSON.parse(readFileSync(join(root, rel), "utf8"));
  const r = await measure(readJson("content/topics.json"), readJson("content/terms.json"), readJson);
  console.log(`pages with content (>= ${MIN_TEXT} chars): ${r.pages}`);
  console.log(`  of them on cortical columns: ${r.columnPages}`);
  console.log(`  of them with a working simulation: ${r.simPages}`);
  console.log(`distinct working simulations: ${r.sims}`);
  console.log(`term links that land: ${r.links} of ${r.terms}`);
  console.log(r.score);
}
