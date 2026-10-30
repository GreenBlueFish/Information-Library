// scripts/score.js
//
// The library's coverage score: how much of it a learner can actually reach.
//
//   pages  — distinct page files, reached by walking the topic tree, that
//            parse as PageContent with a title and at least MIN_TEXT
//            characters of readable text (prose, heading, list, code,
//            callout); a near-empty page or a second node pointing at the same
//            file adds nothing
//   links  — terms in content/terms.json whose `pageRef` resolves, through the
//            real router, to a node with such a page
//
// Prints the breakdown, then the score (pages + links) alone on the last line.
// Higher is better. Usage: node scripts/score.js

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseHash, resolveRoute } from "../src/router.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (rel) => JSON.parse(readFileSync(join(root, rel), "utf8"));

const MIN_TEXT = 100;

/** The readable text in a content block, whitespace collapsed. */
function blockText(block) {
  const parts = [block?.text, block?.source, ...(Array.isArray(block?.items) ? block.items : [])];
  return parts.filter((p) => typeof p === "string").join(" ").replace(/\s+/g, " ").trim();
}

/** True when the node's page file loads as PageContent with real text. */
function hasPage(node) {
  if (typeof node.page !== "string") return false;
  try {
    const page = readJson(node.page);
    if (typeof page.title !== "string" || !page.title.trim() || !Array.isArray(page.blocks)) return false;
    return page.blocks.map(blockText).join(" ").length >= MIN_TEXT;
  } catch {
    return false;
  }
}

const topics = readJson("content/topics.json");
const terms = readJson("content/terms.json");

const pageFiles = new Set();
const walk = (node) => {
  if (node !== topics && hasPage(node)) pageFiles.add(node.page);
  for (const child of node.children ?? []) walk(child);
};
walk(topics);
const pages = pageFiles.size;

let links = 0;
const withRefs = terms.filter((t) => t.pageRef);
for (const term of withRefs) {
  const segments = parseHash(term.pageRef);
  const res = segments.length ? resolveRoute(topics, segments, () => {}) : null;
  if (res && res.node.slug === segments.at(-1) && hasPage(res.node)) links++;
}

console.log(`pages with content: ${pages}`);
console.log(`term links that land: ${links} of ${withRefs.length}`);
console.log(pages + links);
