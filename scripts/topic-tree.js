// scripts/topic-tree.js
//
// Read the whole topic tree from disk in Node (tests and scripts). The browser
// does the same through `loadTopics()` in src/content-loader.js:
// `content/topics.json` is the root, and each `{ "file": ... }` stub among its
// children is replaced by the shelf node kept in that file under
// `content/topics/`.

import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * @param {string} repoRoot Absolute path of the repository root.
 * @returns {any} The assembled root topic node.
 */
export function readTopicTree(repoRoot) {
  const read = (rel) => JSON.parse(readFileSync(join(repoRoot, rel), "utf8"));
  const root = read("content/topics.json");
  if (!root || !Array.isArray(root.children)) return root;
  return {
    ...root,
    children: root.children.map((child) =>
      child && typeof child.file === "string" && child.slug === undefined ? read(child.file) : child,
    ),
  };
}
