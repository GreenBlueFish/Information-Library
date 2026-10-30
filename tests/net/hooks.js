// tests/net/hooks.js
//
// Node module hooks that let `node` load the suite's `https://` imports
// (fast-check, linkedom from a CDN), as Deno and browsers do natively.
// Dev-only; registered by tests/net/register.js. Nothing here is served.
//
// Each module is read from its copy in tests/vendor/ (written by
// tests/net/vendor.js), so the suite runs offline and on fixed versions. Only a
// module with no copy there is fetched, through HTTPS_PROXY when set.

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const vendorRoot = new URL("../vendor/", import.meta.url);

/** Where tests/vendor/ keeps the copy of an `https://` module. */
export function vendorPath(url) {
  const { host, pathname, search } = new URL(url);
  const query = search ? `__${search.slice(1).replace(/[^\w.=-]/g, "_")}` : "";
  return fileURLToPath(new URL(`${host}${pathname}${query}.js`, vendorRoot));
}

export async function resolve(specifier, context, next) {
  if (specifier.startsWith("https://")) {
    return { url: specifier, shortCircuit: true };
  }
  if (context.parentURL?.startsWith("https://") && /^\.{0,2}\//.test(specifier)) {
    return { url: new URL(specifier, context.parentURL).href, shortCircuit: true };
  }
  return next(specifier, context);
}

export async function load(url, context, next) {
  if (!url.startsWith("https://")) return next(url, context);
  const local = vendorPath(url);
  if (existsSync(local)) {
    return { format: "module", source: readFileSync(local, "utf8"), shortCircuit: true };
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url}: HTTP ${res.status} (no copy at ${local}; run node tests/net/vendor.js)`);
  return { format: "module", source: await res.text(), shortCircuit: true };
}
