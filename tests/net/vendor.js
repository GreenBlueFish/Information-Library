// tests/net/vendor.js
//
// Usage: node tests/net/vendor.js
//
// Downloads every `https://` module the suite imports (fast-check, linkedom
// from jsDelivr), and everything those import in turn, into tests/vendor/, so
// tests/net/hooks.js can load them from disk: the suite then runs offline and
// on the same library versions every time. Run it again only to upgrade them;
// it replaces tests/vendor/ wholesale.

import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { vendorPath } from "./hooks.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const vendor = join(root, "tests/vendor");

/** Every `https://...` specifier imported (not just mentioned) by the suite's own test files. */
function suiteRoots() {
  const found = new Set();
  const visit = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (path === vendor) continue;
      if (statSync(path).isDirectory()) visit(path);
      else if (name.endsWith(".js")) {
        const source = readFileSync(path, "utf8").replace(/^\s*\/\/.*$/gm, "");
        for (const m of source.matchAll(/(?:\bfrom|\bimport)\s*\(?\s*["'](https:\/\/[^"']+)["']/g)) found.add(m[1]);
      }
    }
  };
  visit(join(root, "tests"));
  return [...found];
}

/** The specifiers a jsDelivr bundle imports: `from"…"`, `import"…"`, `import("…")`. */
const importsOf = (source) =>
  [...source.matchAll(/(?:\bfrom|\bimport)\s*\(?\s*"([^"]+)"/g)].map((m) => m[1]);

process.env.NODE_USE_ENV_PROXY ??= "1";
rmSync(vendor, { recursive: true, force: true });

const queue = suiteRoots();
const seen = new Set(queue);
while (queue.length) {
  const url = queue.shift();
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url}: HTTP ${res.status}`);
  const source = await res.text();
  const file = vendorPath(url);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, source);
  console.log(`${relative(root, file)}  ← ${url}`);
  for (const spec of importsOf(source)) {
    if (!/^\.{0,2}\//.test(spec)) continue;
    const next = new URL(spec, url).href;
    if (!seen.has(next)) { seen.add(next); queue.push(next); }
  }
}
