// tests/net/hooks.js
//
// Node module hooks that let `node` load the suite's `https://` imports
// (fast-check, linkedom from a CDN), as Deno and browsers do natively.
// Dev-only; registered by tests/net/register.js. Nothing here is served.

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
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url}: HTTP ${res.status}`);
  return { format: "module", source: await res.text(), shortCircuit: true };
}
