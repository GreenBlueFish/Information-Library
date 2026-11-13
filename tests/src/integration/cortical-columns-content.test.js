// tests/src/integration/cortical-columns-content.test.js
//
// Integrity tests for the "Computational Cortical Columns" topic: the topic
// tree, its page files, the widget blocks they embed, and the glossary terms
// that point into it. Complements the generic ingest property tests (schema,
// referential integrity, term collisions) with topic-specific guarantees:
//
//   - the topic is a node on its shelf whose every node has a page that exists,
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
import { readTopicTree } from "../../../scripts/topic-tree.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const TOPIC = "computational-cortical-columns";

const topics = readTopicTree(repoRoot);

// The legacy single content/terms.json was deleted in task 18. The glossary
// data now lives split across one file per Top_Level_Topic, listed in the
// Manifest; concatenating them in Manifest order yields byte-for-byte the same
// 1,874 entries the old table held, so these topic-coverage checks are unchanged.
function loadSplitTerms() {
  const manifest = JSON.parse(
    readFileSync(join(repoRoot, "content", "terms", "index.json"), "utf8"),
  );
  const all = [];
  for (const { file } of manifest.glossaries) {
    all.push(...JSON.parse(readFileSync(join(repoRoot, file), "utf8")));
  }
  return all;
}
const terms = loadSplitTerms();
const SHELF = "brain";
const topic = topics.children.find((c) => c.slug === SHELF)?.children?.find((c) => c.slug === TOPIC);

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

const nodes = topic ? walk(topic, `/${SHELF}`) : [];
/** A node's page file: its own, or for a path step (`ref`) the page it borrows. */
function pageOf(node, route) {
  if (node.page) return node.page;
  const res = resolveRoute(topics, parseHash(`#${route}`));
  return res ? res.pageFile : undefined;
}

const pages = nodes.map(({ node, route }) => {
  const path = pageOf(node, route);
  return {
    route,
    path,
    borrowed: !node.page,
    page: path && existsSync(join(repoRoot, path))
      ? JSON.parse(readFileSync(join(repoRoot, path), "utf8"))
      : null,
  };
});

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
  it("is a topic on its shelf with a deep tree of at least 8 sections and 40 pages", () => {
    expect(topic === undefined).toBe(false);
    expect(topic.children.length >= 8).toBe(true);
    expect(nodes.length >= 40).toBe(true);
    expect(nodes.some(({ route }) => route.split("/").length === 5)).toBe(true);
  });

  it("every node has a page under content/pages/brain/computational-cortical-columns/ that exists and resolves", () => {
    for (const { node, route } of nodes) {
      const res = resolveRoute(topics, parseHash(`#${route}`));
      expect(Boolean(res && res.node)).toBe(true);
      if (node.ref) {
        // A path step borrows the page of a reference topic elsewhere on the shelf.
        expect(node.page).toBe(undefined);
        expect(typeof res.pageFile).toBe("string");
        expect(existsSync(join(repoRoot, res.pageFile))).toBe(true);
        continue;
      }
      expect(typeof node.page).toBe("string");
      expect(node.page.startsWith(`content/pages/${SHELF}/${TOPIC}/`)).toBe(true);
      expect(existsSync(join(repoRoot, node.page))).toBe(true);
    }
  });

  it("every page has a title, substantive content, and ends with a Sources callout", () => {
    for (const { path, page, borrowed } of pages) {
      if (!page) throw new Error(`missing page ${path}`);
      expect(typeof page.title === "string" && page.title.length > 0).toBe(true);
      expect(Array.isArray(page.blocks) && page.blocks.length >= 4).toBe(true);
      const last = page.blocks[page.blocks.length - 1];
      // Borrowed reference pages follow their own topic's style: a "Sources: " prose block.
      if (!((last.type === "callout" || borrowed) && /^Sources: /.test(last.text))) {
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
    const own = terms.filter((t) => typeof t.pageRef === "string" && t.pageRef.startsWith(`/${SHELF}/${TOPIC}`));
    expect(own.length >= 60).toBe(true);
    for (const t of own) {
      const res = resolveRoute(topics, parseHash(`#${t.pageRef}`));
      if (!(res && res.node)) throw new Error(`term "${t.term}" pageRef ${t.pageRef} does not resolve`);
    }
  });
});
