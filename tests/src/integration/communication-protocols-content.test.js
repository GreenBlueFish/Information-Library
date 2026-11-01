// tests/src/integration/communication-protocols-content.test.js
//
// Integrity tests for the "Communication Protocols" topic and for figure
// blocks everywhere:
//
//   - the topic is a top-level node with exactly one subtopic, VGA, and every
//     node has a page that exists, parses and resolves through the router;
//   - every page ends with a "Sources:" block;
//   - the VGA page embeds the vga-scanline widget with the keys it documents
//     and at least one figure;
//   - every figure block on any page names an image file that exists under
//     assets/ and carries alt text;
//   - glossary terms pointing into the topic resolve.

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "../../harness.js";
import { resolveRoute, parseHash } from "../../../src/router.js";
import { MODES } from "../../../src/widgets/types/vga-scanline.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const TOPIC = "communication-protocols";

const topics = JSON.parse(readFileSync(join(repoRoot, "content", "topics.json"), "utf8"));
const terms = JSON.parse(readFileSync(join(repoRoot, "content", "terms.json"), "utf8"));
const topic = topics.children.find((c) => c.slug === TOPIC);

const readPage = (rel) => JSON.parse(readFileSync(join(repoRoot, rel), "utf8"));

/** Every page JSON under content/pages/, as repo-relative paths. */
function allPageFiles(dir = join(repoRoot, "content", "pages"), rel = "content/pages", out = []) {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) allPageFiles(abs, `${rel}/${name}`, out);
    else if (name.endsWith(".json")) out.push(`${rel}/${name}`);
  }
  return out;
}

describe("communication-protocols content", () => {
  it("is a top-level topic whose only subtopic is VGA", () => {
    expect(topic === undefined).toBe(false);
    expect((topic.children ?? []).map((c) => c.slug)).toEqual(["vga"]);
  });

  it("every node has a page that parses, resolves and names its sources", () => {
    for (const node of [topic, ...topic.children]) {
      expect(existsSync(join(repoRoot, node.page))).toBe(true);
      const page = readPage(node.page);
      expect(typeof page.title === "string" && page.title.length > 0).toBe(true);
      const last = page.blocks.at(-1);
      expect(last.text.startsWith("Sources:")).toBe(true);
    }
    const res = resolveRoute(topics, parseHash("/communication-protocols/vga"), () => {});
    expect(res.node.slug).toBe("vga");
  });

  it("the VGA page embeds the scanline widget with its documented keys and valid options", () => {
    const page = readPage(topic.children[0].page);
    const widgets = page.blocks.filter((b) => b.type === "widget");
    expect(widgets.map((w) => w.widget.type)).toEqual(["vga-scanline"]);
    const params = widgets[0].widget.params;
    expect(params.map((p) => p.key)).toEqual(["mode", "step"]);
    for (const option of params[0].options) expect(option in MODES).toBe(true);
    expect(page.blocks.filter((b) => b.type === "figure").length >= 1).toBe(true);
  });

  it("every figure on every page points at an existing image and has alt text", () => {
    let figures = 0;
    for (const file of allPageFiles()) {
      for (const block of readPage(file).blocks ?? []) {
        if (block.type !== "figure") continue;
        figures++;
        expect(block.src.startsWith("assets/")).toBe(true);
        expect(existsSync(join(repoRoot, block.src))).toBe(true);
        expect(typeof block.alt === "string" && block.alt.trim().length > 20).toBe(true);
      }
    }
    expect(figures >= 4).toBe(true);
  });

  it("glossary terms pointing into the topic resolve", () => {
    const into = terms.filter((t) => typeof t.pageRef === "string" && t.pageRef.startsWith(`/${TOPIC}`));
    expect(into.length >= 10).toBe(true);
    for (const t of into) {
      const segments = parseHash(t.pageRef);
      const res = resolveRoute(topics, segments, () => {});
      expect(res.node.slug).toBe(segments.at(-1));
    }
  });
});
