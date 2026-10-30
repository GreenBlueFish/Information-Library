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
//
// `--skip <list>` leaves out the test files named in <list> (one path relative
// to tests/ per line; `#` starts a comment). scripts/hive-test.sh passes
// tests/known-gaps.txt this way.
//
// `--quiet` prints only the summary and the failures, summary first (see
// `run` in harness.js); scripts/hive-test.sh passes it too.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, it, run } from "./harness.js";

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

const skipAt = process.argv.indexOf("--skip");
const skip = new Set(
  skipAt === -1
    ? []
    : readFileSync(process.argv[skipAt + 1], "utf8")
        .split("\n")
        .map((line) => line.replace(/#.*/, "").trim())
        .filter(Boolean),
);

const quiet = process.argv.includes("--quiet");

const files = collectTestFiles(here)
  .filter((file) => !skip.has(file.slice(here.length + 1)))
  .sort();
for (const name of skip) console.log(`skipped (known gap): ${name}`);
if (files.length === 0) {
  console.log("No test files found (looked for *.test.js under tests/).");
  process.exit(0);
}

// A file that cannot be imported (a missing module, a throw at top level) is
// reported as one failing case under its name, and the rest still run.
for (const file of files) {
  const name = file.slice(here.length + 1);
  if (!quiet) console.log(`\n${name}`);
  try {
    await import(pathToFileURL(file).href);
  } catch (err) {
    describe(name, () => {
      it("imports", () => {
        throw err;
      });
    });
  }
}

const failures = await run({ quiet });
process.exit(failures > 0 ? 1 : 0);
