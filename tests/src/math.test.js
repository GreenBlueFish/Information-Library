// tests/src/math.test.js
//
// Formulas in content text (src/math.js): the TeX subset parses into the
// MathML a reader expects, bad input fails loudly, text with formulas is drawn
// with <math> elements, and every formula in content/ parses.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "../harness.js";
import { ensureDom } from "../dom.js";
import { parseTex, splitMath, texToMathML, appendRichText, TexError } from "../../src/math.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");

const { document } = await ensureDom();
const html = (tex, display = false) => texToMathML(document, tex, display).outerHTML;

describe("math › splitMath", () => {
  it("splits inline and display formulas out of text", () => {
    expect(splitMath("gain $g_m r_o$ and $$x^2$$ end")).toEqual([
      { text: "gain " }, { tex: "g_m r_o", display: false }, { text: " and " }, { tex: "x^2", display: true }, { text: " end" },
    ]);
  });
  it("keeps \\$ as a dollar sign and leaves an unclosed $ as text", () => {
    expect(splitMath("costs \\$5")).toEqual([{ text: "costs $5" }]);
    expect(splitMath("a $ b")).toEqual([{ text: "a $ b" }]);
  });
});

describe("math › MathML", () => {
  it("draws subscripts, with letter labels upright as one name", () => {
    expect(html("V_{GS}")).toBe('<math alttext="V_{GS}" class="math"><msub><mi>V</mi><mi>GS</mi></msub></math>');
    expect(html("g_m")).toBe('<math alttext="g_m" class="math"><msub><mi>g</mi><mi>m</mi></msub></math>');
  });
  it("stacks fractions and roots", () => {
    expect(html("\\frac{a}{b}").includes("<mfrac><mi>a</mi><mi>b</mi></mfrac>")).toBe(true);
    expect(html("\\sqrt{x}").includes("<msqrt><mi>x</mi></msqrt>")).toBe(true);
    expect(html("\\sqrt[3]{x}").includes("<mroot><mi>x</mi><mn>3</mn></mroot>")).toBe(true);
  });
  it("draws binomial coefficients as a bracketed fraction with no bar", () => {
    const out = html("\\binom{52}{2}");
    expect(/<mfrac linethickness="0">(<mrow>)?<mn>52<\/mn>(<\/mrow>)?(<mrow>)?<mn>2<\/mn>/.test(out)).toBe(true);
    expect(out.includes(">(</mo>") && out.includes(">)</mo>")).toBe(true);
    expect(html("a \\mid b").includes("<mo>∣</mo>")).toBe(true);
  });
  it("knows Greek letters, operators, functions and text", () => {
    const out = html("\\tau \\approx 10\\,\\text{ms} \\cdot \\exp(-t)");
    for (const bit of ["<mi>τ</mi>", "<mo>≈</mo>", "<mtext>ms</mtext>", "<mo>·</mo>", "<mi>exp</mi>", "<mo>−</mo>"]) {
      expect([bit, out.includes(bit)]).toEqual([bit, true]);
    }
  });
  it("marks display formulas as blocks and puts limits underneath", () => {
    const out = html("\\sum_{i=1}^{N} x_i", true);
    expect(out.includes('display="block"')).toBe(true);
    expect(out.includes("<munderover>")).toBe(true);
    expect(html("\\lim_{x\\to 0} x").includes("<msub>")).toBe(true);
    expect(html("\\lim_{x\\to 0} x", true).includes("<munder>")).toBe(true);
  });
  it("refuses what it doesn't support", () => {
    for (const bad of ["\\unknown", "{a", "a}", "a^b^c", "", "x \\\\ y", "50%"]) {
      let threw = false;
      try { parseTex(bad); } catch (e) { threw = e instanceof TexError; }
      expect([bad, threw]).toEqual([bad, true]);
    }
  });
});

describe("math › appendRichText", () => {
  it("sets text without formulas as plain text", () => {
    const p = document.createElement("p");
    appendRichText(p, "no math <b>here</b>");
    expect(p.textContent).toBe("no math <b>here</b>");
    expect(p.children.length).toBe(0);
  });
  it("puts a <math> element where each formula was", () => {
    const p = document.createElement("p");
    appendRichText(p, "so $A_v = -g_m R_D$ here");
    expect(p.querySelectorAll("math").length).toBe(1);
    expect(p.textContent.startsWith("so ")).toBe(true);
  });
  it("shows a broken formula as its source, marked as an error", () => {
    const p = document.createElement("p");
    appendRichText(p, "bad $\\nope$");
    expect(p.querySelector(".math-error").textContent).toBe("\\nope");
  });
});

// ---------------------------------------------------------------------------
// Every formula in the content parses.
// ---------------------------------------------------------------------------

function jsonFiles(dir) {
  return readdirSync(join(repoRoot, dir)).flatMap((name) => {
    const rel = `${dir}/${name}`;
    if (statSync(join(repoRoot, rel)).isDirectory()) return jsonFiles(rel);
    return name.endsWith(".json") ? [rel] : [];
  });
}

/** Every string in a page or term that the renderer shows as rich text. */
function richStrings(node, out = []) {
  if (Array.isArray(node)) { for (const x of node) richStrings(x, out); return out; }
  if (!node || typeof node !== "object") return out;
  if (node.type === "code" || node.type === "widget" || node.type === "math") return out;
  for (const [k, v] of Object.entries(node)) {
    if (k === "src" || k === "lang" || k === "pageRef" || k === "widget") continue;
    if (typeof v === "string") out.push(v);
    else richStrings(v, out);
  }
  return out;
}

// The legacy content/terms.json was deleted in task 18; the glossary definitions
// now live split under content/terms/, so scan that whole folder instead.
const files = [...jsonFiles("content/pages"), ...jsonFiles("content/terms")];
const loaded = files.map((f) => [f, JSON.parse(readFileSync(join(repoRoot, f), "utf8"))]);

describe("math › content", () => {
  it("every $...$ formula and math block in content/ parses", () => {
    const bad = [];
    for (const [f, data] of loaded) {
      for (const s of richStrings(data)) {
        for (const part of splitMath(s)) {
          if (!("tex" in part)) continue;
          try { parseTex(part.tex); } catch (e) { bad.push(`${f}: $${part.tex}$ (${e.message})`); }
        }
      }
      for (const b of Array.isArray(data.blocks) ? data.blocks : []) {
        if (b.type !== "math") continue;
        try { parseTex(b.tex); } catch (e) { bad.push(`${f}: math block ${b.tex} (${e.message})`); }
      }
    }
    expect(bad).toEqual([]);
  });
  it("no content text has an unpaired $", () => {
    const bad = [];
    for (const [f, data] of loaded) {
      for (const s of richStrings(data)) {
        if (splitMath(s).some((p) => "text" in p && p.text.includes("$")) && !/\\\$/.test(s)) bad.push(`${f}: ${s.slice(0, 80)}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
