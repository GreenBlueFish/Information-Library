// tests/src/ingest/inventory-completeness.test.js
//
// Feature: snn-material-ingestion
//
// Inventory completeness + out-of-scope example tests (task 3.4).
//
// These are EXAMPLE tests (not property-based): they check the concrete,
// already-generated `tools/ingest/inventory.json` against the live corpus on
// disk. Two guarantees are asserted:
//
//   1. Completeness (Req 1.1) — the inventory has a matching record for every
//      file under `Library_Material/SNN Learning Material/` AND for every
//      member of `neuro-reference.zip`. Enumeration is re-derived here from the
//      same read-only seams the pipeline uses (`listCorpusFiles`,
//      `readZipEntryList`), so the test is independent of how the inventory was
//      built — it only trusts the filesystem + the archive.
//
//   2. Out-of-scope classification (Req 1.3) — the two memory-hardware-security
//      PDFs (DRAM retention + Rowhammer) are present in the inventory and marked
//      `scope: "out-of-scope"`.
//
// The inventory is read directly via `node:fs` from `INVENTORY_PATH`. Nothing
// here is served or imported by the runtime (the whole `tools/ingest/` tree is
// dev-only).

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, it, expect } from "../../harness.js";
import {
  listCorpusFiles,
  readZipEntryList,
  CORPUS_DIR,
  ZIP_NAME,
  INVENTORY_PATH,
} from "../../../tools/ingest/run-inventory.js";

/**
 * Read and parse the generated inventory artifact (dev-only, non-served).
 * @returns {Array<{ filename: string, scope: string }>}
 */
function readInventory() {
  const raw = readFileSync(INVENTORY_PATH, "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error("inventory.json did not parse to an array");
  }
  return parsed;
}

/**
 * Re-derive the full set of corpus-relative names the inventory must cover:
 * every file on disk, plus every member of `neuro-reference.zip` under the
 * `neuro-reference.zip/<entry>` naming the pipeline uses.
 * @returns {string[]}
 */
function expectedCorpusNames() {
  const files = listCorpusFiles(CORPUS_DIR);
  const names = [...files];
  const zipPath = join(CORPUS_DIR, ZIP_NAME);
  for (const entry of readZipEntryList(zipPath)) {
    names.push(`${ZIP_NAME}/${entry}`);
  }
  return names;
}

const DRAM_PDF =
  "An_Experimental_Study_of_Data_Retention_Behavior_in_Modern_DRAM_Devices.pdf";
const ROWHAMMER_PDF =
  "Rowhammer_Attacks_in_Dynamic_Random_Access_Memory_and_Defense_Methods.pdf";

describe("snn-material-ingestion › inventory completeness (Req 1.1)", () => {
  it("has a record for every corpus file and every neuro-reference.zip member", () => {
    const inventory = readInventory();
    const recordedFilenames = new Set(inventory.map((r) => r.filename));

    const expected = expectedCorpusNames();
    // Guard against a trivially-passing empty enumeration.
    expect(expected.length > 0).toBe(true);

    const missing = expected.filter((name) => !recordedFilenames.has(name));
    expect(missing).toEqual([]);
  });
});

describe("snn-material-ingestion › out-of-scope classification (Req 1.3)", () => {
  it("marks the DRAM retention paper as out-of-scope", () => {
    const inventory = readInventory();
    const record = inventory.find((r) => r.filename === DRAM_PDF);
    expect(Boolean(record)).toBe(true);
    expect(record.scope).toBe("out-of-scope");
  });

  it("marks the Rowhammer paper as out-of-scope", () => {
    const inventory = readInventory();
    const record = inventory.find((r) => r.filename === ROWHAMMER_PDF);
    expect(Boolean(record)).toBe(true);
    expect(record.scope).toBe("out-of-scope");
  });
});
