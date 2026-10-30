// tests/src/ingest/extraction-smoke.test.js
//
// Feature: snn-material-ingestion
//
// Extraction smoke + source-immutability EXAMPLE tests (task 2.3).
//
// These are example/integration tests (not property-based): they exercise the
// real, dev-only extractor (`tools/ingest/extract-pdf.js` + its vendored parser
// `tools/ingest/vendor/pdf-text.js`) against a representative in-scope PDF from
// the live corpus and assert three guarantees:
//
//   1. Import hygiene (Req 2.1) — both extractor modules import ONLY `node:`
//      builtins or sibling relative (`./`) paths. No bare npm specifier appears
//      in any `import ... from "X"` statement, which is what keeps the pipeline
//      install-free and build-free.
//
//   2. Extraction smoke (Req 2.2) — running `extractPdf` on a representative
//      in-scope PDF writes a non-empty, valid UTF-8 `.txt` artifact under an
//      `extracted/` directory. The run is pointed at a TEMP `extractedDir` and
//      a TEMP COPY of `inventory.json`, so neither the live `extracted/` tree
//      nor the live `inventory.json` is mutated by this test.
//
//   3. Source immutability (Req 2.3) — the corpus file list, plus each file's
//      size and mtime, is snapshotted before and after extraction and asserted
//      unchanged. The extractor reads sources read-only and must never modify,
//      move, or delete anything under the corpus.
//
// Everything here is dev-only and non-served (the whole `tools/ingest/` tree is
// never fetched by `index.html` nor imported by any `src/` runtime module).

import {
  readFileSync,
  existsSync,
  statSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  copyFileSync,
} from "node:fs";
import { join, basename } from "node:path";
import { tmpdir } from "node:os";

import { describe, it, expect } from "../../harness.js";
import {
  extractPdf,
  artifactNameFor,
} from "../../../tools/ingest/extract-pdf.js";
import {
  listCorpusFiles,
  CORPUS_DIR,
  INVENTORY_PATH,
} from "../../../tools/ingest/run-inventory.js";

// Absolute paths to the two dev-only extractor modules whose imports we audit.
// CORPUS_DIR is `<repo>/Library_Material/SNN Learning Material`, so stepping up
// two levels lands at the repo root (sibling of `tools/`).
const REPO_ROOT = join(CORPUS_DIR, "..", "..");
const EXTRACT_PDF_PATH = join(REPO_ROOT, "tools", "ingest", "extract-pdf.js");
const VENDOR_PARSER_PATH = join(
  REPO_ROOT,
  "tools",
  "ingest",
  "vendor",
  "pdf-text.js",
);

// A representative, text-heavy in-scope PDF known to live in the corpus.
const REPRESENTATIVE_PDF = "Izhikevich_Simple_Model_of_Spiking_Neurons.pdf";

/**
 * Extract every module specifier `X` from `import ... from "X"` / `'X'`
 * statements in a module's source text. Covers the forms the extractor uses:
 * `import x from "..."`, `import { a, b } from "..."`, and
 * `import * as ns from "..."` (including statements that wrap across lines).
 *
 * @param {string} source
 * @returns {string[]} the raw specifiers, in source order
 */
function importSpecifiers(source) {
  /** @type {string[]} */
  const specs = [];
  // `[\s\S]*?` lets the clause span newlines (multi-line named imports).
  const re = /\bimport\b[\s\S]*?\bfrom\s*["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    specs.push(m[1]);
  }
  return specs;
}

/**
 * A specifier is allowed iff it is a `node:` builtin or a relative path
 * (starting with `./` or `../`). Anything else is a bare npm specifier.
 *
 * @param {string} spec
 * @returns {boolean}
 */
function isAllowedSpecifier(spec) {
  return spec.startsWith("node:") || spec.startsWith("./") || spec.startsWith("../");
}

/**
 * Snapshot the corpus: every corpus-relative filename mapped to its size and
 * mtime (ms). Used to prove the extractor left the source tree untouched.
 *
 * @returns {Record<string, { size: number, mtimeMs: number }>}
 */
function snapshotCorpus() {
  /** @type {Record<string, { size: number, mtimeMs: number }>} */
  const snap = {};
  for (const name of listCorpusFiles(CORPUS_DIR)) {
    const st = statSync(join(CORPUS_DIR, name));
    snap[name] = { size: st.size, mtimeMs: st.mtimeMs };
  }
  return snap;
}

describe("snn-material-ingestion › extractor import hygiene (Req 2.1)", () => {
  it("extract-pdf.js imports only node: builtins or relative ./ paths", () => {
    const source = readFileSync(EXTRACT_PDF_PATH, "utf8");
    const specs = importSpecifiers(source);
    // Guard against a regex that silently matched nothing.
    expect(specs.length > 0).toBe(true);
    const offenders = specs.filter((s) => !isAllowedSpecifier(s));
    expect(offenders).toEqual([]);
  });

  it("vendor/pdf-text.js imports only node: builtins or relative ./ paths", () => {
    const source = readFileSync(VENDOR_PARSER_PATH, "utf8");
    const specs = importSpecifiers(source);
    expect(specs.length > 0).toBe(true);
    const offenders = specs.filter((s) => !isAllowedSpecifier(s));
    expect(offenders).toEqual([]);
  });
});

describe("snn-material-ingestion › extraction smoke + source immutability (Req 2.2, 2.3)", () => {
  it("writes a non-empty UTF-8 .txt and leaves the corpus unchanged", () => {
    // Representative in-scope source must be present in the live corpus.
    const sourceAbs = join(CORPUS_DIR, REPRESENTATIVE_PDF);
    expect(existsSync(sourceAbs)).toBe(true);

    // Isolate all writes: a temp extractedDir + a temp COPY of inventory.json,
    // so neither the live extracted/ tree nor the live inventory.json mutates.
    const workDir = mkdtempSync(join(tmpdir(), "alexandria-extract-smoke-"));
    const tempExtractedDir = join(workDir, "extracted");
    const tempInventoryPath = join(workDir, "inventory.json");

    // Create the temp extracted/ dir and seed the temp inventory from the live
    // one (COPY, never move) so a matching record can be updated in isolation.
    mkdirSync(tempExtractedDir, { recursive: true });
    if (existsSync(INVENTORY_PATH)) {
      copyFileSync(INVENTORY_PATH, tempInventoryPath);
    }

    // Snapshot the corpus + live inventory BEFORE extraction (Req 2.3).
    const before = snapshotCorpus();
    const liveInventoryBefore = existsSync(INVENTORY_PATH)
      ? readFileSync(INVENTORY_PATH, "utf8")
      : null;

    try {
      const result = extractPdf(REPRESENTATIVE_PDF, {
        extractedDir: tempExtractedDir,
        inventoryPath: tempInventoryPath,
      });

      // (Req 2.2) A UTF-8 .txt artifact exists under the temp extracted/ dir,
      // named <stem>.txt, and is non-empty readable text.
      const expectedArtifact = join(
        tempExtractedDir,
        artifactNameFor(REPRESENTATIVE_PDF),
      );
      expect(result.artifactPath).toBe(expectedArtifact);
      expect(existsSync(expectedArtifact)).toBe(true);
      expect(basename(expectedArtifact).endsWith(".txt")).toBe(true);

      // Valid UTF-8, non-empty: round-trip the bytes through a STRICT UTF-8
      // decoder (fatal: true throws on malformed bytes) and confirm recovered
      // text is present.
      const bytes = readFileSync(expectedArtifact);
      expect(bytes.length > 0).toBe(true);
      const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      expect(decoded.trim().length > 0).toBe(true);

      // (Req 2.3) Snapshot the corpus AFTER extraction and assert nothing
      // changed — same file set, same sizes, same mtimes: the source is
      // read-only and was never modified, moved, or deleted.
      const after = snapshotCorpus();
      expect(after).toEqual(before);

      // The LIVE inventory.json must be byte-for-byte unchanged; only the temp
      // copy may have been rewritten by the extractor.
      const liveInventoryAfter = existsSync(INVENTORY_PATH)
        ? readFileSync(INVENTORY_PATH, "utf8")
        : null;
      expect(liveInventoryAfter).toBe(liveInventoryBefore);
    } finally {
      // Clean up every temp artifact this test created.
      rmSync(workDir, { recursive: true, force: true });
    }
  });
});
