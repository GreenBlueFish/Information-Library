// tests/run.js
//
// Entry point for the dev-only test suite. Run it with plain Node (no install,
// no build step):
//
//     node tests/run.js
//
// It imports every `*.test.js` module under `tests/` (each registers its cases
// via the harness on import), then runs them and exits non-zero on any failure
// so a human or CI notices. New test files are picked up automatically.

import { readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { run } from "./harness.js";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Recursively collect `*.test.js` files under a directory.
 * @param {string} dir
 * @returns {string[]}
 */
function collectTestFiles(dir) {
  /** @type {string[]} */
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...collectTestFiles(full));
    } else if (name.endsWith(".test.js")) {
      out.push(full);
    }
  }
  return out;
}

const files = collectTestFiles(here).sort();
if (files.length === 0) {
  console.log("No test files found (looked for *.test.js under tests/).");
  process.exit(0);
}

for (const file of files) {
  console.log(`\n${file.slice(here.length + 1)}`);
  await import(pathToFileURL(file).href);
}

const failures = await run();
process.exit(failures > 0 ? 1 : 0);
