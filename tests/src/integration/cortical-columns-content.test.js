// tests/src/integration/cortical-columns-content.test.js
//
// Integrity tests for the "Computational Cortical Columns" topic: the topic
// tree, its page files, the widget blocks they embed, and the glossary terms
// that point into it. Complements the generic ingest property tests (schema,
// referential integrity, term collisions) with topic-specific guarantees:
//
//   - the topic is a top-level node whose every node has a page that exists,
//     parses, and resolves through the runtime router;
//   - every page has a title, real content, and ends with a "Sources:" callout
//     (the project's attribution convention, see page-schema.property.test.js);
//   - every widget block uses a type registered by a module under
//     src/widgets/types/, with exactly the parameter keys that type documents,
//     and each of the topic's simulation types is embedded at least once;
//   - glossary terms pointing into the topic resolve, and the topic has its own
//     glossary coverage.

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "../../harness.js";
import { resolveRoute, parseHash } from "../../../src/router.js";
import { hasWidget } from "../../../src/widgets/registry.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const TOPIC = "computational-cortical-columns";

const topics = JSON.parse(readFileSync(join(repoRoot, "content", "topics.json"), "utf8"));
const terms = JSON.parse(readFileSync(join(repoRoot, "content", "terms.json"), "utf8"));
const topic = topics.children.find((c) => c.slug === TOPIC);

/** Parameter keys each simulation widget type documents (PROJECT_GUIDE §7.3). */
const WIDGET_KEYS = {
  "lif-neuron": ["current", "tau", "threshold", "refractory", "noise", "input"],
  "stdp-explorer": ["aPlus", "aMinus", "tauPlus", "tauMinus", "deltaT", "rule"],
  "spike-raster": ["inhibition", "k", "inhibitoryGain", "inputRate", "seed"],
  "sdr-overlap": ["n", "w", "theta", "noise", "seed"],
  "temporal-memory": ["sequences", "cellsPerColumn", "activationThreshold", "seed"],
  "column-voting": ["columns", "voting", "object", "noise", "seed"],
};

/** Every node of the topic with its full route. */
function walk(node, prefix, out = []) {
  const route = `${prefix}/${node.slug}`;
  out.push({ node, route });
  for (const child of node.children ?? []) walk(child, route, out);
  return out;
}

const nodes = topic ? walk(topic, "") : [];
const pages = nodes.map(({ node, route }) => ({
  route,
  path: node.page,
  page: node.page && existsSync(join(repoRoot, node.page))
    ? JSON.parse(readFileSync(join(repoRoot, node.page), "utf8"))
    : null,
}));

/** Re-register every widget type module (other tests may clear the registry). */
async function registerAllTypes() {
  const dir = join(repoRoot, "src", "widgets", "types");
  for (const name of readdirSync(dir)) {
    if (name.endsWith(".js")) {
      await import(`../../../src/widgets/types/${name}?fresh=${Math.random()}`);
    }
  }
}

describe("computational cortical columns — content integrity", () => {
  it("is a top-level topic with a deep tree of at least 8 sections and 40 pages", () => {
    expect(topic === undefined).toBe(false);
    expect(topic.children.length >= 8).toBe(true);
    expect(nodes.length >= 40).toBe(true);
    expect(nodes.some(({ route }) => route.split("/").length === 4)).toBe(true);
  });

  it("every node has a page under content/pages/computational-cortical-columns/ that exists and resolves", () => {
    for (const { node, route } of nodes) {
      expect(typeof node.page).toBe("string");
      expect(node.page.startsWith(`content/pages/${TOPIC}/`)).toBe(true);
      expect(existsSync(join(repoRoot, node.page))).toBe(true);
      const res = resolveRoute(topics, parseHash(`#${route}`));
      expect(Boolean(res && res.node)).toBe(true);
    }
  });

  it("every page has a title, substantive content, and ends with a Sources callout", () => {
    for (const { path, page } of pages) {
      if (!page) throw new Error(`missing page ${path}`);
      expect(typeof page.title === "string" && page.title.length > 0).toBe(true);
      expect(Array.isArray(page.blocks) && page.blocks.length >= 4).toBe(true);
      const last = page.blocks[page.blocks.length - 1];
      if (!(last.type === "callout" && /^Sources: /.test(last.text))) {
        throw new Error(`${path} must end with a "Sources: " callout`);
      }
    }
  });

  it("widget blocks use registered types with their documented parameter keys", async () => {
    await registerAllTypes();
    const used = new Set();
    for (const { path, page } of pages) {
      for (const block of page?.blocks ?? []) {
        if (block.type !== "widget") continue;
        const type = block.widget.type;
        used.add(type);
        if (!hasWidget(type)) throw new Error(`${path}: widget type "${type}" is not registered`);
        const expected = WIDGET_KEYS[type];
        if (expected) {
          const keys = block.widget.params.map((p) => p.key);
          if (keys.join() !== expected.join()) {
            throw new Error(`${path}: ${type} params ${keys.join()} != ${expected.join()}`);
          }
        }
      }
    }
    for (const type of Object.keys(WIDGET_KEYS)) {
      if (!used.has(type)) throw new Error(`widget type "${type}" is not embedded on any page`);
    }
  });

  it("has glossary coverage: at least 60 terms point into the topic and all of them resolve", () => {
    const own = terms.filter((t) => typeof t.pageRef === "string" && t.pageRef.startsWith(`/${TOPIC}`));
    expect(own.length >= 60).toBe(true);
    for (const t of own) {
      const res = resolveRoute(topics, parseHash(`#${t.pageRef}`));
      if (!(res && res.node)) throw new Error(`term "${t.term}" pageRef ${t.pageRef} does not resolve`);
    }
  });
});
