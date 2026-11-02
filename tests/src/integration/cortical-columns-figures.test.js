// tests/src/integration/cortical-columns-figures.test.js
//
// The figures on the cortical column pages (Computational Cortical Columns and
// the Neuroscience cortical-columns pages):
//
//   - every figure names an existing file under assets/figures/ and has alt text;
//   - every image taken from elsewhere (anything but our own .svg diagrams) in
//     assets/figures/computational-cortical-columns/ has a row in CREDITS.md
//     there, with its licence and source, and is used on at least one page;
//   - every figure showing such an image credits it in its caption ("Image: ...").

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "../../harness.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const FIG_DIR = "assets/figures/computational-cortical-columns";
const PAGE_ROOTS = ["content/pages/computational-cortical-columns", "content/pages/neuroscience/cortical-columns"];

function jsonFiles(dir) {
  return readdirSync(join(repoRoot, dir)).flatMap((name) => {
    const rel = `${dir}/${name}`;
    if (statSync(join(repoRoot, rel)).isDirectory()) return jsonFiles(rel);
    return name.endsWith(".json") ? [rel] : [];
  });
}

const figures = PAGE_ROOTS.flatMap(jsonFiles).flatMap((path) =>
  JSON.parse(readFileSync(join(repoRoot, path), "utf8")).blocks
    .filter((b) => b.type === "figure")
    .map((b) => ({ path, ...b })),
);
const credits = readFileSync(join(repoRoot, FIG_DIR, "CREDITS.md"), "utf8");
const outside = readdirSync(join(repoRoot, FIG_DIR)).filter((f) => /\.(png|jpe?g|gif|webp)$/i.test(f));

describe("cortical column figures", () => {
  it("the pages carry figures, each with an existing image and alt text", () => {
    expect(figures.length >= 15).toBe(true);
    for (const f of figures) {
      expect(f.src.startsWith("assets/figures/")).toBe(true);
      expect(existsSync(join(repoRoot, f.src))).toBe(true);
      expect(typeof f.alt === "string" && f.alt.trim().length > 40).toBe(true);
    }
  });

  it("every outside image has a credits row with licence and source, and is used", () => {
    expect(outside.length >= 1).toBe(true);
    for (const file of outside) {
      const row = credits.split("\n").find((line) => line.startsWith(`| \`${file}\``));
      expect(Boolean(row)).toBe(true);
      expect(/commons\.wikimedia\.org\/wiki\/File:/.test(row)).toBe(true);
      expect(/Public domain|CC0|CC BY/.test(row)).toBe(true);
      expect(figures.some((f) => f.src === `${FIG_DIR}/${file}`)).toBe(true);
    }
  });

  it("every figure of an outside image credits it in the caption", () => {
    for (const f of figures.filter((f) => !f.src.endsWith(".svg"))) {
      expect(/Image: .+(public domain|CC0|CC BY)/i.test(f.caption ?? "")).toBe(true);
    }
  });
});
