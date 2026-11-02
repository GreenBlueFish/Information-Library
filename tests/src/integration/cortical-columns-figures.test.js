// tests/src/integration/cortical-columns-figures.test.js
//
// The figures on the cortical column pages (Computational Cortical Columns and
// the Neuroscience cortical-columns pages):
//
//   - every figure names an existing file under assets/figures/ and has alt text;
//   - every image taken from elsewhere (anything but our own .svg diagrams) in
//     assets/figures/computational-cortical-columns/ has a row in CREDITS.md
//     there, with its licence and source, and is used on at least one page;
//   - every figure showing such an image credits it in its caption ("Image: ..."),
//     naming the same licence as its CREDITS.md row;
//   - the Image Credits page shows readers every CREDITS.md row: file, author,
//     licence and source address.

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
const CREDITS_PAGE = "content/pages/computational-cortical-columns/image-credits/index.json";
const rows = credits
  .split("\n")
  .filter((line) => line.startsWith("| `"))
  .map((line) => {
    const cells = line.replace(/^\|\s*|\s*\|$/g, "").split(" | ");
    return {
      file: cells[0].replace(/`/g, ""),
      author: cells[2],
      licence: cells[3].replace(/\[(.*?)\]\(.*?\)/, "$1"),
      source: cells[4].match(/\((https:[^)]+)\)/)[1],
    };
  });

/** The licence as a caption names it: "public domain", "CC0", "CC BY-SA 3.0". */
function captionLicence(licence) {
  if (/^Public domain/.test(licence)) return "public domain";
  return licence;
}

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

  it("every caption names the licence of its image's credits row", () => {
    for (const f of figures.filter((f) => !f.src.endsWith(".svg"))) {
      const row = rows.find((r) => f.src === `${FIG_DIR}/${r.file}`);
      if (!row) throw new Error(`${f.path}: ${f.src} has no CREDITS.md row`);
      const want = captionLicence(row.licence);
      // "CC BY 2.5" must not match a caption that says "CC BY 2.5 JP" or "CC BY-SA 2.5".
      const named = new RegExp(`${want.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w.-]| JP)`, "i");
      if (!named.test(f.caption.split("Image: ").pop())) {
        throw new Error(`${f.path}: caption of ${row.file} should name "${want}" (CREDITS.md)`);
      }
    }
  });

  it("the Image Credits page shows every credits row to readers", () => {
    const page = JSON.parse(readFileSync(join(repoRoot, CREDITS_PAGE), "utf8"));
    const text = page.blocks.flatMap((b) => [b.text ?? "", ...(b.items ?? [])]).join("\n");
    expect(rows.length).toBe(outside.length);
    for (const r of rows) {
      for (const part of [r.file, r.author, r.licence, r.source]) {
        if (!text.includes(part)) throw new Error(`${CREDITS_PAGE} is missing "${part}" for ${r.file}`);
      }
    }
  });
});
