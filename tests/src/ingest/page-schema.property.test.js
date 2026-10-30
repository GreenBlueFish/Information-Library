// tests/src/ingest/page-schema.property.test.js
//
// Property-based test for the SNN Material Ingestion authoring contract.
//
//   Feature: snn-material-ingestion, Property 4
//   Property 4: PageContent schema validity
//   **Validates: Requirements 4.1, 4.3, 4.6** (and 5.1 attribution presence)
//
// For all authored pages/blocks, this asserts the structural invariants an
// ingested concept page must satisfy (design.md — Data Models → PageContent,
// Widget_Spec; Correctness Properties → Property 4), with the source-attribution
// presence check (Req 5.1) folded into the same walk:
//
//   - the page has a non-empty string `title` (Req 4.1);
//   - `blocks` is an array and every block's `type` is one of the supported
//     types `prose | heading | list | code | callout | widget`, carrying that
//     type's required fields (Req 4.1):
//       prose   -> { text: string }
//       heading -> { text: string, level: 2 | 3 | 4 }   (Req 4.3)
//       list    -> { items: string[] }
//       code    -> { lang: string, source: string }
//       callout -> { text: string }
//       widget  -> { widget: Widget_Spec }
//   - every `heading` block's `level` is exactly 2, 3, or 4 (Req 4.3);
//   - every `widget` block's `widget.type` is a REGISTERED widget type (no new
//     type is introduced) whose `params`/`default` conform to Widget_Spec
//     (Req 4.6):
//       params: ParamControl[]; each ParamControl has a string `key` + `label`,
//       `control` in { range, number, select }, and a `default` that lies
//       inside the declared range (range/number) or option set (select);
//   - at least one block names a source — the attribution-presence check:
//     a `callout`/`prose` block whose text mentions a source (e.g. contains
//     "Source", "Adapted from", "Based on", "From") (Req 5.1).
//
// The registered-widget oracle is the REAL runtime registry: importing the
// `parameter-plot` type module self-registers it, and `hasWidget` is then the
// single source of truth for "is this type registered" — exactly what the
// renderer consults at mount time. That keeps the test honest about Req 4.6
// (pages may only reference a type the runtime actually knows).
//
// fast-check is loaded as an ES module from the jsDelivr ESM CDN with NO build
// step, following the established convention (see
// tests/src/router.additivity.property.test.js): import the module namespace
// and normalize the `fc` handle whether the API sits on the namespace or under
// `default`. Run via `node tests/run.js`; to run offline, vendor fast-check's
// ESM build and swap the specifier, leaving the rest alone. Each property runs
// a minimum of 100 iterations.

import { describe, it, expect } from "../../harness.js";
import * as fcNS from "https://cdn.jsdelivr.net/npm/fast-check/+esm";
import { readdirSync, statSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// The runtime's `hasWidget` is the registered-type oracle for Req 4.6. Importing
// the type module self-registers "parameter-plot" (design.md — Component 5:
// self-registration at import time), but the shared Node process interleaves all
// test files' cases and several of them call `clearWidgetRegistry()` inside their
// own `it` bodies (see tests/src/widgets/registry.test.js,
// renderer.idempotent.property.test.js, integration/boot-navigation.test.js).
// So a one-time registration would be wiped out from under us before our cases
// run. Mirroring boot-navigation.test.js, we RE-ASSERT the registration at the
// start of every case via `ensureParameterPlotRegistered()`. The real mount
// function is not exported and we only need `hasWidget("parameter-plot")` to be
// true, so a trivial stand-in mount is registered (registerWidget replaces by
// type, so this never stacks).
import "../../../src/widgets/types/parameter-plot.js";
import { hasWidget, registerWidget } from "../../../src/widgets/registry.js";

/** Guarantee "parameter-plot" is a registered type for the oracle this case uses. */
function ensureParameterPlotRegistered() {
  registerWidget("parameter-plot", () => ({ update() {}, destroy() {} }));
}

// fast-check's ESM build exposes its API on the module namespace; some bundles
// also nest it under `default`. Normalize to a single `fc` handle either way.
const fc = fcNS && typeof fcNS.property === "function" ? fcNS : fcNS.default;

const SUPPORTED_BLOCK_TYPES = ["prose", "heading", "list", "code", "callout", "widget"];
const HEADING_LEVELS = [2, 3, 4];
const PARAM_CONTROLS = ["range", "number", "select"];

// Phrases that mark a block as a source-attribution line (Req 5.1). Matching is
// case-insensitive; authored attribution is a callout or prose block that names
// the source document(s) it draws from.
const ATTRIBUTION_MARKERS = ["source", "adapted from", "based on", "from "];

// ---------------------------------------------------------------------------
// Pure PageContent schema checker (the thing under test).
//
// Returns { ok: true } for a conforming page, or { ok: false, reason } naming
// the first violation. `isRegistered` is injected (the real `hasWidget`) so the
// checker stays pure and the widget-type oracle is explicit.
// ---------------------------------------------------------------------------

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

/** Does a block carry a source-attribution line? (Req 5.1) */
function namesASource(block) {
  if (!block || typeof block !== "object") return false;
  if (block.type !== "callout" && block.type !== "prose") return false;
  if (typeof block.text !== "string") return false;
  const haystack = block.text.toLowerCase();
  return ATTRIBUTION_MARKERS.some((m) => haystack.includes(m));
}

/** Validate a single ParamControl inside a Widget_Spec (Req 4.6). */
function checkParamControl(p) {
  if (!p || typeof p !== "object") return "param is not an object";
  if (!isNonEmptyString(p.key)) return "param.key must be a non-empty string";
  if (!isNonEmptyString(p.label)) return "param.label must be a non-empty string";
  if (!PARAM_CONTROLS.includes(p.control)) {
    return `param.control must be one of ${PARAM_CONTROLS.join("|")}`;
  }
  if (p.control === "select") {
    if (!Array.isArray(p.options) || p.options.length === 0) {
      return "select param requires a non-empty options array";
    }
    if (!p.options.every((o) => typeof o === "string")) {
      return "select param options must be strings";
    }
    if (!p.options.includes(p.default)) {
      return "select param default must be one of its options";
    }
    return null;
  }
  // range | number: numeric default must sit within [min, max] when declared.
  if (typeof p.default !== "number" || Number.isNaN(p.default)) {
    return `${p.control} param default must be a number`;
  }
  if (typeof p.min === "number" && p.default < p.min) {
    return `${p.control} param default is below declared min`;
  }
  if (typeof p.max === "number" && p.default > p.max) {
    return `${p.control} param default is above declared max`;
  }
  if (typeof p.min === "number" && typeof p.max === "number" && p.min > p.max) {
    return `${p.control} param declares min > max`;
  }
  return null;
}

/** Validate a Widget_Spec: registered type + conforming params/default (Req 4.6). */
function checkWidgetSpec(spec, isRegistered) {
  if (!spec || typeof spec !== "object") return "widget.widget must be an object";
  if (!isNonEmptyString(spec.type)) return "widget.type must be a non-empty string";
  if (!isRegistered(spec.type)) return `widget.type "${spec.type}" is not a registered type`;
  if (spec.title !== undefined && !isNonEmptyString(spec.title)) {
    return "widget.title, when present, must be a non-empty string";
  }
  if (!Array.isArray(spec.params)) return "widget.params must be an array";
  for (const p of spec.params) {
    const err = checkParamControl(p);
    if (err) return err;
  }
  return null;
}

/** Validate a single ContentBlock (Req 4.1, 4.3, 4.6). */
function checkBlock(block, isRegistered) {
  if (!block || typeof block !== "object") return "block is not an object";
  if (!SUPPORTED_BLOCK_TYPES.includes(block.type)) {
    return `unsupported block type: ${JSON.stringify(block.type)}`;
  }
  switch (block.type) {
    case "prose":
    case "callout":
      if (typeof block.text !== "string") return `${block.type} block requires a string text`;
      return null;
    case "heading":
      if (typeof block.text !== "string") return "heading block requires a string text";
      if (!HEADING_LEVELS.includes(block.level)) {
        return "heading.level must be 2, 3, or 4";
      }
      return null;
    case "list":
      if (!Array.isArray(block.items)) return "list.items must be an array";
      if (!block.items.every((i) => typeof i === "string")) {
        return "list.items must all be strings";
      }
      return null;
    case "code":
      if (typeof block.lang !== "string") return "code.lang must be a string";
      if (typeof block.source !== "string") return "code.source must be a string";
      return null;
    case "widget":
      return checkWidgetSpec(block.widget, isRegistered);
    default:
      return `unsupported block type: ${JSON.stringify(block.type)}`;
  }
}

/**
 * Pure PageContent schema checker. Walks the page once: validates `title`,
 * validates every block, and (in the same walk) records whether any block names
 * a source. Returns { ok, reason? }.
 *
 * @param {unknown} page
 * @param {(type: string) => boolean} isRegistered
 * @returns {{ ok: boolean, reason?: string }}
 */
function checkPageContent(page, isRegistered) {
  if (!page || typeof page !== "object") return { ok: false, reason: "page is not an object" };
  if (!isNonEmptyString(page.title)) return { ok: false, reason: "title must be a non-empty string" };
  if (!Array.isArray(page.blocks)) return { ok: false, reason: "blocks must be an array" };

  let hasAttribution = false;
  for (const block of page.blocks) {
    const err = checkBlock(block, isRegistered);
    if (err) return { ok: false, reason: err };
    if (namesASource(block)) hasAttribution = true;
  }
  if (!hasAttribution) {
    return { ok: false, reason: "no block names a source (attribution missing)" };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Generators — produce the whole valid page space and targeted invalid pages.
// ---------------------------------------------------------------------------

const nonEmptyText = fc
  .string({ minLength: 1, maxLength: 40 })
  .map((s) => `t ${s}`); // guarantee a non-whitespace char regardless of fc version

// One valid attribution block (callout or prose) that names a source (Req 5.1).
const attributionBlockArb = fc.record({
  type: fc.constantFrom("callout", "prose"),
  marker: fc.constantFrom("Source:", "Adapted from", "Based on", "From "),
  tail: fc.string({ maxLength: 30 }),
}).map(({ type, marker, tail }) => ({ type, text: `${marker} Izhikevich (2003) ${tail}` }));

// A valid ParamControl of each flavor, default always inside range/options.
const rangeOrNumberParamArb = fc.record({
  key: nonEmptyText,
  label: nonEmptyText,
  control: fc.constantFrom("range", "number"),
  min: fc.integer({ min: -10, max: 0 }),
  span: fc.integer({ min: 0, max: 10 }),
  frac: fc.double({ min: 0, max: 1, noNaN: true }),
}).map(({ key, label, control, min, span, frac }) => {
  const max = min + span;
  // Clamp to [min, max] so floating-point rounding can never nudge the default
  // past a boundary — the generator must produce a strictly valid default.
  const def = Math.min(max, Math.max(min, min + frac * (max - min)));
  return { key, label, control, min, max, step: 0.1, default: def };
});

const selectParamArb = fc.record({
  key: nonEmptyText,
  label: nonEmptyText,
  options: fc.array(nonEmptyText, { minLength: 1, maxLength: 4 }),
  pick: fc.nat(),
}).map(({ key, label, options, pick }) => ({
  key,
  label,
  control: "select",
  options,
  default: options[pick % options.length], // guaranteed within options
}));

const paramControlArb = fc.oneof(rangeOrNumberParamArb, selectParamArb);

const widgetBlockArb = fc.record({
  title: fc.option(nonEmptyText, { nil: undefined }),
  params: fc.array(paramControlArb, { minLength: 0, maxLength: 4 }),
}).map(({ title, params }) => {
  const widget = { type: "parameter-plot", params };
  if (title !== undefined) widget.title = title;
  return { type: "widget", widget };
});

// A valid non-attribution content block of any supported type.
const genericBlockArb = fc.oneof(
  fc.record({ type: fc.constant("prose"), text: nonEmptyText }),
  fc.record({ type: fc.constant("callout"), text: nonEmptyText }),
  fc.record({ type: fc.constant("heading"), text: nonEmptyText, level: fc.constantFrom(2, 3, 4) }),
  fc.record({ type: fc.constant("list"), items: fc.array(nonEmptyText, { maxLength: 5 }) }),
  fc.record({ type: fc.constant("code"), lang: nonEmptyText, source: fc.string({ maxLength: 40 }) }),
  widgetBlockArb,
);

// A fully valid PageContent: non-empty title, >= 1 attribution block, plus a
// random tail of generic blocks. The attribution block is placed first (as
// authored pages do) and interleaved copies are also allowed by shuffling.
const validPageArb = fc.record({
  title: nonEmptyText,
  intro: fc.option(nonEmptyText, { nil: undefined }),
  attribution: attributionBlockArb,
  rest: fc.array(genericBlockArb, { maxLength: 6 }),
}).map(({ title, intro, attribution, rest }) => {
  const page = { title, blocks: [attribution, ...rest] };
  if (intro !== undefined) page.intro = intro;
  return page;
});

// An INVALID page: take a valid page and apply exactly one corruption so the
// checker must reject it. Each corruption targets a distinct rule.
const invalidPageArb = fc.record({
  base: validPageArb,
  kind: fc.constantFrom(
    "empty-title",
    "blocks-not-array",
    "bad-block-type",
    "bad-heading-level",
    "unregistered-widget",
    "param-default-out-of-range",
    "select-default-not-in-options",
    "missing-attribution",
    "list-items-not-strings",
  ),
}).map(({ base, kind }) => {
  const page = JSON.parse(JSON.stringify(base));
  switch (kind) {
    case "empty-title":
      page.title = "   ";
      return { page, kind };
    case "blocks-not-array":
      page.blocks = { nope: true };
      return { page, kind };
    case "bad-block-type":
      page.blocks.push({ type: "diagram", text: "x" });
      return { page, kind };
    case "bad-heading-level":
      page.blocks.push({ type: "heading", text: "h", level: 1 });
      return { page, kind };
    case "unregistered-widget":
      page.blocks.push({ type: "widget", widget: { type: "not-a-real-widget", params: [] } });
      return { page, kind };
    case "param-default-out-of-range":
      page.blocks.push({
        type: "widget",
        widget: {
          type: "parameter-plot",
          params: [{ key: "k", label: "L", control: "range", min: 0, max: 5, default: 99 }],
        },
      });
      return { page, kind };
    case "select-default-not-in-options":
      page.blocks.push({
        type: "widget",
        widget: {
          type: "parameter-plot",
          params: [{ key: "k", label: "L", control: "select", options: ["a", "b"], default: "z" }],
        },
      });
      return { page, kind };
    case "missing-attribution":
      // Drop every attribution-naming block so no source is named.
      page.blocks = page.blocks.filter((b) => !namesASource(b));
      // Ensure at least one (non-attribution) block remains so the only defect
      // is the missing attribution, not an empty page.
      page.blocks.push({ type: "prose", text: "plain body text with no credit line" });
      return { page, kind };
    case "list-items-not-strings":
      page.blocks.push({ type: "list", items: ["ok", 42] });
      return { page, kind };
    default:
      return { page, kind };
  }
});

// ---------------------------------------------------------------------------
// Enumerate any EXISTING authored pages this feature touches, so the property
// also guards real on-disk content (handles the "none yet" case gracefully).
// ---------------------------------------------------------------------------

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..", ".."); // tests/src/ingest -> repo root
const pagesRoot = join(repoRoot, "content", "pages");

// The folders this feature authors into (design.md — additive topic-tree). We
// read every page JSON found under content/pages/ (existing + feature-added);
// if a path is absent we skip it rather than fail.
function collectPageFiles(dir) {
  /** @type {string[]} */
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out; // directory absent — nothing authored there yet
  }
  for (const name of entries) {
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) out.push(...collectPageFiles(full));
    else if (name.endsWith(".json")) out.push(full);
  }
  return out;
}

describe("snn-material-ingestion \u2014 PageContent schema (Property 4) \u2014 Validates: Requirements 4.1, 4.3, 4.6, 5.1", () => {
  it("accepts every well-formed PageContent across the generated page space", () => {
    ensureParameterPlotRegistered();
    fc.assert(
      fc.property(validPageArb, (page) => {
        const result = checkPageContent(page, hasWidget);
        expect(result.ok).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it("rejects pages that violate a single schema rule (bad type/level, unregistered widget, bad default, missing attribution)", () => {
    ensureParameterPlotRegistered();
    fc.assert(
      fc.property(invalidPageArb, ({ page }) => {
        const result = checkPageContent(page, hasWidget);
        expect(result.ok).toBe(false);
        expect(isNonEmptyString(result.reason)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it("the attribution-presence check is sensitive: a valid page minus its source-naming blocks is rejected", () => {
    ensureParameterPlotRegistered();
    fc.assert(
      fc.property(validPageArb, (page) => {
        const stripped = {
          title: page.title,
          blocks: page.blocks
            .filter((b) => !namesASource(b))
            .concat([{ type: "prose", text: "body with no credit" }]),
        };
        const result = checkPageContent(stripped, hasWidget);
        expect(result.ok).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it("every authored page already on disk under content/pages/ conforms (no-op when none exist)", () => {
    ensureParameterPlotRegistered();
    const files = collectPageFiles(pagesRoot);
    for (const file of files) {
      let page;
      try {
        page = JSON.parse(readFileSync(file, "utf8"));
      } catch (e) {
        throw new Error(`authored page is not valid JSON: ${file} (${e.message})`);
      }
      const result = checkPageContent(page, hasWidget);
      expect(result.ok).toBe(true);
    }
    // Sanity: enumeration is graceful whether or not feature pages exist yet.
    expect(Array.isArray(files)).toBe(true);
  });
});
