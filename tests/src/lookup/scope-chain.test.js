// tests/src/lookup/scope-chain.test.js
//
// Example tests for the Scope_Chain helpers in `src/main.js` (task 10.4) —
// Requirement 14.1. These pin the four shapes `computeScopeChain` must produce
// against small, hand-built tree + Manifest fixtures, complementing the
// property test (which covers the universal prefix-ordered-subset invariant):
//
//   1. A DEEP route (/a/b/c): the chain is the resolvable ancestors that carry a
//      Glossary_File, narrowest-first, ending at `/`.
//   2. A TOP-LEVEL topic (/a): the chain is just that topic's glossary then `/`.
//   3. A route with NO OWN glossary (ancestor-skipping): the route's own scope
//      has no Manifest entry, so the chain skips it and starts at the nearest
//      ancestor that does have one (R5.3).
//   4. HOME (empty segments): the chain is empty (R5.5).
//
// Importing `src/main.js` runs `boot()` at module top-level, which reaches for
// `document.getElementById("app")` and fetches the content manifests. We install
// a linkedom DOM (with the `#app`/`#nav` landmarks) and a fetch stub that 404s
// every URL BEFORE importing main.js, so boot resolves cleanly: the manifest
// loads fail with a typed `ContentLoadError`, which boot catches and renders as
// an inline error before returning — the import never throws, and the exported
// pure helpers (`computeScopeChain`, `sourceFor`, `topLevelTitle`) are callable.

import { describe, it, expect } from "../../harness.js";
import { ensureDom } from "../../dom.js";

const dom = await ensureDom();
const { document, window } = dom;
globalThis.document = document;
globalThis.window = window;

for (const [id, tag] of [["app", "main"], ["nav", "nav"]]) {
  if (!document.getElementById(id)) {
    const el = document.createElement(tag);
    el.id = id;
    document.body.appendChild(el);
  }
}

// 404 every fetch so boot's manifest loads fail into a caught ContentLoadError.
const realFetch = globalThis.fetch;
globalThis.fetch = async () => ({
  ok: false,
  status: 404,
  statusText: "Not Found",
  async text() {
    return "";
  },
});

const main = await import("../../../src/main.js");
const { computeScopeChain, sourceFor, topLevelTitle } = main;

if (realFetch) globalThis.fetch = realFetch;

// ---------------------------------------------------------------------------
// A small topic tree: alpha › beta › gamma, with a sibling top-level "delta".
//
//   root
//     alpha            (/alpha)            — top-level topic, has a page
//       beta           (/alpha/beta)       — grouping (has children)
//         gamma        (/alpha/beta/gamma) — leaf page
//     delta            (/delta)            — a second top-level topic
// ---------------------------------------------------------------------------
const tree = {
  slug: "",
  title: "root",
  children: [
    {
      slug: "alpha",
      title: "Alpha",
      children: [
        {
          slug: "beta",
          title: "Beta",
          children: [
            { slug: "gamma", title: "Gamma", page: "content/pages/alpha/beta/gamma.json" },
          ],
        },
      ],
    },
    { slug: "delta", title: "Delta", page: "content/pages/delta.json" },
  ],
};

/** A Manifest with glossaries at the given scopes (ordered `/`-first then asc). */
function manifestFor(scopes) {
  const ordered = [
    ...(scopes.includes("/") ? ["/"] : []),
    ...scopes.filter((s) => s !== "/").sort(),
  ];
  return {
    glossaries: ordered.map((scope) => ({
      scope,
      file: scope === "/" ? "content/terms/_root.json" : `content/terms${scope}.json`,
    })),
  };
}

describe("computeScopeChain example cases (R14.1)", () => {
  it("deep route /alpha/beta/gamma → narrowest-first chain of resolvable ancestors ending at /", () => {
    // Every ancestor carries a glossary: /alpha/beta/gamma, /alpha/beta, /alpha, /.
    const manifest = manifestFor(["/", "/alpha", "/alpha/beta", "/alpha/beta/gamma"]);
    const chain = computeScopeChain(tree, manifest, ["alpha", "beta", "gamma"]);

    expect(chain.map((e) => e.scope)).toEqual([
      "/alpha/beta/gamma",
      "/alpha/beta",
      "/alpha",
      "/",
    ]);
    // The files ride along with the entries, narrowest-first.
    expect(chain.map((e) => e.file)).toEqual([
      "content/terms/alpha/beta/gamma.json",
      "content/terms/alpha/beta.json",
      "content/terms/alpha.json",
      "content/terms/_root.json",
    ]);
  });

  it("top-level topic /alpha → that topic's glossary then / (two entries)", () => {
    const manifest = manifestFor(["/", "/alpha"]);
    const chain = computeScopeChain(tree, manifest, ["alpha"]);

    expect(chain.map((e) => e.scope)).toEqual(["/alpha", "/"]);
    expect(chain.map((e) => e.file)).toEqual([
      "content/terms/alpha.json",
      "content/terms/_root.json",
    ]);
  });

  it("route with no own glossary skips its scope and starts at the nearest ancestor that has one (R5.3)", () => {
    // /alpha/beta/gamma has NO glossary; /alpha and / do. The chain skips the
    // gamma and beta scopes (no Glossary_File) and begins at /alpha.
    const manifest = manifestFor(["/", "/alpha"]);
    const chain = computeScopeChain(tree, manifest, ["alpha", "beta", "gamma"]);

    expect(chain.map((e) => e.scope)).toEqual(["/alpha", "/"]);
    // No entry for the route's own scope leaks into the chain.
    expect(chain.some((e) => e.scope === "/alpha/beta/gamma")).toBe(false);
    expect(chain.some((e) => e.scope === "/alpha/beta")).toBe(false);
  });

  it("home (empty segments) → empty chain (R5.5)", () => {
    const manifest = manifestFor(["/", "/alpha", "/delta"]);
    expect(computeScopeChain(tree, manifest, [])).toEqual([]);
  });

  it("a Manifest scope that does not resolve in the tree never enters the chain (R11.6)", () => {
    // "/alpha/ghost" is not a real route; its glossary must be ignored even
    // though it is a prefix-shaped ancestor string of the selection text.
    const manifest = manifestFor(["/", "/alpha", "/alpha/ghost"]);
    const chain = computeScopeChain(tree, manifest, ["alpha", "ghost"]);
    // /alpha/ghost does not resolve, so only /alpha and / (both resolvable,
    // both with glossaries) make the chain.
    expect(chain.map((e) => e.scope)).toEqual(["/alpha", "/"]);
  });
});

describe("sourceFor and topLevelTitle example cases (R14.1)", () => {
  it("sourceFor(/) is the General root source; a topic scope reads its title from the tree", () => {
    expect(sourceFor(tree, "/")).toEqual({ route: "/", title: "General" });
    expect(sourceFor(tree, "/alpha")).toEqual({ route: "/alpha", title: "Alpha" });
    expect(sourceFor(tree, "/alpha/beta/gamma")).toEqual({
      route: "/alpha/beta/gamma",
      title: "Gamma",
    });
  });

  it("topLevelTitle names the first-segment topic, and is empty on home", () => {
    expect(topLevelTitle(tree, ["alpha", "beta", "gamma"])).toBe("Alpha");
    expect(topLevelTitle(tree, ["delta"])).toBe("Delta");
    expect(topLevelTitle(tree, [])).toBe("");
  });
});
