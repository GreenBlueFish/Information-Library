// tests/src/ingest/inventory-schema.property.test.js
//
// Property-based test for the dev-only inventory record schema
// (design.md — Correctness Properties → "Property 6: Inventory record schema
// validity").
//
//   Feature: snn-material-ingestion, Property 6
//   Property 6: Inventory record schema validity
//   **Validates: Requirements 1.2, 1.4, 1.5**
//
// Every record written to `tools/ingest/inventory.json` must satisfy a closed
// field contract AND two cross-field invariants:
//   - field shapes valid: `filename` non-empty string; `type` ∈ {pdf,html};
//     `scope` ∈ {in-scope,out-of-scope}; `confidence` ∈ {high,low};
//     `flaggedForReview` boolean; `topicAreas` an array of non-empty strings;
//     optional `extractedText` a non-empty string when present (Req 1.2);
//   - in-scope AND not flagged ⇒ non-empty `topicAreas` — a document that is
//     in scope and confidently classified always names at least one area
//     (Req 1.4);
//   - `flaggedForReview === true` ⇒ empty `topicAreas` — a flagged document is
//     never assigned a guessed area (Req 1.5).
//
// The shared, dependency-free checker `validateInventoryRecord` from
// `tools/ingest/run-inventory.js` encodes this contract (empty problem list =
// valid). This test exercises that checker across many generated records —
// both valid records (expected to report no problems) and intentionally
// malformed / invariant-violating records (expected to report problems) — and
// then asserts every record in the real `inventory.json` passes.
//
// fast-check is loaded as an ES module with NO build step, mirroring
// tests/src/router.additivity.property.test.js: import the module namespace
// from the jsDelivr ESM CDN and normalize the `fc` handle whether the API sits
// on the namespace or under `default`. Run via `node tests/run.js`.

import { describe, it, expect } from "../../harness.js";
import * as fcNS from "https://cdn.jsdelivr.net/npm/fast-check/+esm";
import { readFileSync } from "node:fs";
import {
  validateInventoryRecord,
  createInventoryRecord,
  INVENTORY_FIELDS,
  INVENTORY_PATH,
} from "../../../tools/ingest/run-inventory.js";

// fast-check's ESM build exposes its API on the module namespace; some bundles
// also nest it under `default`. Normalize to a single `fc` handle either way.
const fc = fcNS && typeof fcNS.property === "function" ? fcNS : fcNS.default;

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** A non-empty string usable as a filename / topic-area / extractedText path. */
const nonEmptyStringArb = fc.string({ minLength: 1, maxLength: 40 });

/** A single non-empty topic-area token. */
const topicAreaArb = fc
  .string({ minLength: 1, maxLength: 20 })
  .filter((s) => s.length > 0);

/** A list of valid (non-empty) topic areas. */
const topicAreasArb = fc.array(topicAreaArb, { minLength: 1, maxLength: 5 });

const typeArb = fc.constantFrom(...INVENTORY_FIELDS.type);
const scopeArb = fc.constantFrom(...INVENTORY_FIELDS.scope);
const confidenceArb = fc.constantFrom(...INVENTORY_FIELDS.confidence);

/**
 * A generator of VALID inventory records. It uses the production factory
 * `createInventoryRecord`, which already enforces the flagged⇒empty-areas
 * invariant, so to also satisfy the in-scope-not-flagged⇒non-empty invariant we
 * feed non-empty `topicAreas` whenever the record is in-scope and not flagged.
 */
const validRecordArb = fc
  .record({
    filename: nonEmptyStringArb,
    type: typeArb,
    scope: scopeArb,
    topicAreas: topicAreasArb,
    confidence: confidenceArb,
    flaggedForReview: fc.boolean(),
    extractedText: fc.option(nonEmptyStringArb, { nil: undefined }),
  })
  .map((fields) => createInventoryRecord(fields));

/**
 * A generator of records that INTENTIONALLY violate exactly one rule, each
 * tagged with the problem we expect the validator to surface. The factory is
 * deliberately bypassed here — we hand-build the object so the invariant is
 * actually broken.
 */
const invalidRecordArb = fc.oneof(
  // Non-object values.
  fc.constant({ value: null, why: "null" }),
  fc.constant({ value: 42, why: "number" }),
  fc.constant({ value: "nope", why: "string" }),
  // Empty filename.
  fc.record({ type: typeArb, scope: scopeArb, topicAreas: topicAreasArb }).map((r) => ({
    value: { filename: "", type: r.type, scope: r.scope, topicAreas: r.topicAreas, confidence: "high", flaggedForReview: false },
    why: "empty filename",
  })),
  // Bad type literal.
  fc.record({ filename: nonEmptyStringArb }).map((r) => ({
    value: { filename: r.filename, type: "docx", scope: "in-scope", topicAreas: ["x"], confidence: "high", flaggedForReview: false },
    why: "bad type",
  })),
  // Bad scope literal.
  fc.record({ filename: nonEmptyStringArb }).map((r) => ({
    value: { filename: r.filename, type: "pdf", scope: "maybe", topicAreas: ["x"], confidence: "high", flaggedForReview: false },
    why: "bad scope",
  })),
  // Bad confidence literal.
  fc.record({ filename: nonEmptyStringArb }).map((r) => ({
    value: { filename: r.filename, type: "pdf", scope: "in-scope", topicAreas: ["x"], confidence: "medium", flaggedForReview: false },
    why: "bad confidence",
  })),
  // flaggedForReview not a boolean.
  fc.record({ filename: nonEmptyStringArb }).map((r) => ({
    value: { filename: r.filename, type: "pdf", scope: "in-scope", topicAreas: [], confidence: "high", flaggedForReview: "yes" },
    why: "non-boolean flag",
  })),
  // topicAreas contains an empty string.
  fc.record({ filename: nonEmptyStringArb }).map((r) => ({
    value: { filename: r.filename, type: "pdf", scope: "in-scope", topicAreas: ["ok", ""], confidence: "high", flaggedForReview: false },
    why: "empty topicArea string",
  })),
  // INVARIANT: flagged ⇒ empty topicAreas (violated — flagged but has an area).
  fc.record({ filename: nonEmptyStringArb, area: topicAreaArb }).map((r) => ({
    value: { filename: r.filename, type: "pdf", scope: "in-scope", topicAreas: [r.area], confidence: "low", flaggedForReview: true },
    why: "flagged but non-empty topicAreas (Req 1.5)",
  })),
  // INVARIANT: in-scope & not flagged ⇒ non-empty topicAreas (violated — empty).
  fc.record({ filename: nonEmptyStringArb }).map((r) => ({
    value: { filename: r.filename, type: "pdf", scope: "in-scope", topicAreas: [], confidence: "high", flaggedForReview: false },
    why: "in-scope not-flagged but empty topicAreas (Req 1.4)",
  })),
  // extractedText present but empty.
  fc.record({ filename: nonEmptyStringArb }).map((r) => ({
    value: { filename: r.filename, type: "pdf", scope: "in-scope", topicAreas: ["x"], confidence: "high", flaggedForReview: false, extractedText: "" },
    why: "empty extractedText",
  })),
);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("inventory record schema (Property 6) \u2014 Feature: snn-material-ingestion, Property 6 \u2014 Validates: Requirements 1.2, 1.4, 1.5", () => {
  it("accepts all well-formed records (valid field shapes + both cross-field invariants)", () => {
    fc.assert(
      fc.property(validRecordArb, (record) => {
        const problems = validateInventoryRecord(record);
        expect(problems).toEqual([]);

        // The two invariants hold on a valid record by construction — assert
        // them directly so the property is self-documenting.
        if (record.flaggedForReview === true) {
          // Req 1.5: a flagged record carries no topic areas.
          expect(record.topicAreas.length).toBe(0);
        }
        if (record.flaggedForReview === false && record.scope === "in-scope") {
          // Req 1.4: in-scope and confidently classified ⇒ >= 1 area.
          expect(record.topicAreas.length > 0).toBe(true);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("rejects records that break a field-shape rule or a cross-field invariant", () => {
    fc.assert(
      fc.property(invalidRecordArb, ({ value }) => {
        const problems = validateInventoryRecord(value);
        // A malformed / invariant-violating record must surface >= 1 problem.
        expect(problems.length > 0).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it("targeted invariant checks: flagged\u21d2empty and in-scope-not-flagged\u21d2non-empty", () => {
    // flaggedForReview true but a topic area present (Req 1.5 violation).
    const flaggedWithArea = {
      filename: "x.pdf",
      type: "pdf",
      scope: "in-scope",
      topicAreas: ["neuron-models"],
      confidence: "low",
      flaggedForReview: true,
    };
    expect(validateInventoryRecord(flaggedWithArea).length > 0).toBe(true);

    // in-scope, not flagged, but no areas (Req 1.4 violation).
    const inScopeNoArea = {
      filename: "x.pdf",
      type: "pdf",
      scope: "in-scope",
      topicAreas: [],
      confidence: "high",
      flaggedForReview: false,
    };
    expect(validateInventoryRecord(inScopeNoArea).length > 0).toBe(true);

    // out-of-scope, not flagged, empty areas is FINE (the in-scope invariant
    // only applies to in-scope records).
    const outOfScopeNoArea = {
      filename: "x.pdf",
      type: "pdf",
      scope: "out-of-scope",
      topicAreas: [],
      confidence: "high",
      flaggedForReview: false,
    };
    expect(validateInventoryRecord(outOfScopeNoArea)).toEqual([]);

    // flagged with empty areas is FINE.
    const flaggedEmpty = {
      filename: "x.pdf",
      type: "pdf",
      scope: "in-scope",
      topicAreas: [],
      confidence: "low",
      flaggedForReview: true,
    };
    expect(validateInventoryRecord(flaggedEmpty)).toEqual([]);
  });

  it("every record in the real inventory.json satisfies the schema", () => {
    const raw = readFileSync(INVENTORY_PATH, "utf8");
    const records = JSON.parse(raw);
    expect(Array.isArray(records)).toBe(true);
    expect(records.length > 0).toBe(true);

    for (const record of records) {
      const problems = validateInventoryRecord(record);
      if (problems.length !== 0) {
        throw new Error(
          `inventory record ${JSON.stringify(record.filename)} is invalid: ${problems.join("; ")}`,
        );
      }
    }
  });
});
