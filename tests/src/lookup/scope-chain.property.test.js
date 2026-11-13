// tests/src/lookup/scope-chain.property.test.js
//
// Feature: glossary-scoped-search, Property 1
// Feature: glossary-scoped-search, Property 6
//
// Property-based tests for the Scope_Chain computation and its nearer-first
// merge ordering (design.md — Correctness Properties → "Property 1: Scope_Chain
// is a prefix-ordered subset of the Manifest" and "Property 6: Nearer glossary
// definitions come first").
//
//   Property 1: Scope_Chain is a prefix-ordered subset of the Manifest
//   Property 6: Nearer glossary definitions come first
//   **Validates: Requirements 5.1, 5.2, 5.3, 5.5, 6.3**
//
// Property 1 — for any topic tree, Manifest, and route segments,
// `computeScopeChain(tree, manifest, segments)` returns a SUBSEQUENCE of the
// Manifest whose scopes are exactly the ancestor routes of the selection (the
// route itself, each ancestor, and `/`) that BOTH resolve in the topic tree and
// carry a Glossary_File, ordered strictly narrowest-first (each entry's scope is
// a proper route-ancestor of the previous entry's scope) and ending at `/` when
// present; the home route (empty segments) yields the empty chain (R5.1, R5.2,
// R5.3, R5.5).
//
// Property 6 — for any term defined in more than one Scope_Chain glossary, the
// merged chain index (built by merging the per-scope indexes in chain order,
// narrowest-first) lists the nearer (narrower-scope) glossary's definition
// BEFORE the further glossary's definition within that term's definition list
// (R6.3). We assert this through the real runtime path: build each loaded
// glossary into its own index, `mergeIndexes` them in the order
// `computeScopeChain` produced, then `findMatches`/`query` the shared term and
// read the ordered `definitions` list — exactly what the Lookup_Panel shows.
//
// Importing `src/main.js` runs `boot()` at module top-level, which reaches for
// `document.getElementById("app")` and fetches the content manifests. We install
// a linkedom DOM (with the `#app`/`#nav` landmarks) and a fetch stub that 404s
// every URL BEFORE importing main.js, so boot resolves cleanly: the two manifest
// loads fail with a typed `ContentLoadError`, which boot catches and renders as
// an inline error, then returns — it never throws out of the import, and the
// three pure, exported helpers under test (`computeScopeChain`, `sourceFor`,
// `topLevelTitle`) are then callable with hand-built tree + Manifest fixtures.
//
// fast-check is loaded as an ES module with NO build step, matching the sibling
// lookup property tests' convention (jsDelivr ESM CDN; run under
// `node --import ./tests/net/register.js tests/run.js`, where the net hook serves
// it from the vendored copy offline on a pinned version).

import { describe, it, expect } from "../../harness.js";
import * as fcNS from "https://cdn.jsdelivr.net/npm/fast-check/+esm";
import { ensureDom } from "../../dom.js";
import { buildIndex, mergeIndexes, query } from "../../../src/lookup/search-index.js";
import { findMatches } from "../../../src/lookup/matches.js";
import { normalize } from "../../../src/lookup/trie.js";

// fast-check's ESM build exposes its API on the module namespace; some bundles
// also nest it under `default`. Normalize to a single `fc` handle either way.
const fc = fcNS && typeof fcNS.property === "function" ? fcNS : fcNS.default;

// ---------------------------------------------------------------------------
// Install the browser surfaces boot() needs, BEFORE importing main.js.
// ---------------------------------------------------------------------------

const dom = await ensureDom();
const { document, window } = dom;
globalThis.document = document;
globalThis.window = window;

// The two landmarks boot fills (index.html's #app / #nav). boot() calls
// `document.getElementById("app")`; without the element it would try to render
// an error into `null`. We provide both so boot proceeds to the manifest loads.
for (const [id, tag] of [["app", "main"], ["nav", "nav"]]) {
  if (!document.getElementById(id)) {
    const el = document.createElement(tag);
    el.id = id;
    document.body.appendChild(el);
  }
}

// A fetch stub that 404s every URL. content-loader turns a non-ok response into
// a typed `ContentLoadError`, which boot catches in `reportBootError` and
// renders as an inline error before returning — so importing main.js never
// throws, and the pure helpers we test below load cleanly. We do NOT rely on any
// real content here: every fixture is hand-built.
const realFetch = globalThis.fetch;
globalThis.fetch = async () => ({
  ok: false,
  status: 404,
  statusText: "Not Found",
  async text() {
    return "";
  },
});

// Now import main.js; its top-level boot() runs against the stubbed environment.
const main = await import("../../../src/main.js");
const { computeScopeChain, sourceFor, topLevelTitle } = main;

// Restore whatever fetch the host had, so we do not leak the 404 stub into other
// suites in the shared Node process.
if (realFetch) globalThis.fetch = realFetch;

// ---------------------------------------------------------------------------
// Fixture builders: a random topic tree and a Manifest over a subset of it.
// ---------------------------------------------------------------------------

/** A slug segment: 1–5 lowercase letters (matches SLUG_PATTERN, no dashes). */
const slugArb = fc
  .array(fc.integer({ min: 97, max: 122 }), { minLength: 1, maxLength: 5 })
  .map((codes) => codes.map((c) => String.fromCharCode(c)).join(""));

/**
 * A small topic tree with unique sibling slugs at each level, depth up to 3.
 * Every leaf gets a `page` so `resolveRoute` treats it as a real route, and
 * every node carries a `title` so `sourceFor`/`topLevelTitle` have something to
 * read. Returns `{ tree, routes }` where `routes` is every resolvable route in
 * the tree as a `string[]` segment list (narrowest included), so the Manifest
 * and the selection can be drawn from routes that actually resolve.
 */
function treeArb() {
  // Build a tree by generating, at up to three levels, sets of unique slugs.
  return fc
    .array(
      fc.record({
        slug: slugArb,
        title: fc.string({ minLength: 1, maxLength: 8 }),
        kids: fc.array(
          fc.record({
            slug: slugArb,
            title: fc.string({ minLength: 1, maxLength: 8 }),
            kids: fc.array(
              fc.record({ slug: slugArb, title: fc.string({ minLength: 1, maxLength: 8 }) }),
              { minLength: 0, maxLength: 2 },
            ),
          }),
          { minLength: 0, maxLength: 2 },
        ),
      }),
      { minLength: 1, maxLength: 3 },
    )
    .map((tops) => {
      /** @type {string[][]} */
      const routes = [];

      // Dedupe sibling slugs so resolveRoute's uniqueness check never rejects a
      // route we generated; a duplicate at any level is dropped.
      function uniqueBySlug(nodes) {
        const seen = new Set();
        const out = [];
        for (const n of nodes) {
          if (seen.has(n.slug)) continue;
          seen.add(n.slug);
          out.push(n);
        }
        return out;
      }

      const topNodes = uniqueBySlug(tops).map((t) => {
        const midNodes = uniqueBySlug(t.kids ?? []).map((m) => {
          const leafNodes = uniqueBySlug(m.kids ?? []).map((l) => ({
            slug: l.slug,
            title: l.title,
            page: `content/pages/${t.slug}/${m.slug}/${l.slug}.json`,
          }));
          const mid = { slug: m.slug, title: m.title };
          if (leafNodes.length > 0) {
            mid.children = leafNodes;
          } else {
            mid.page = `content/pages/${t.slug}/${m.slug}.json`;
          }
          return mid;
        });
        const top = { slug: t.slug, title: t.title };
        if (midNodes.length > 0) {
          top.children = midNodes;
        } else {
          top.page = `content/pages/${t.slug}.json`;
        }
        return top;
      });

      const tree = { slug: "", title: "root", children: topNodes };

      // Walk the tree collecting every resolvable route (segment list).
      function walk(nodes, prefix) {
        for (const n of nodes) {
          const route = [...prefix, n.slug];
          routes.push(route);
          if (Array.isArray(n.children) && n.children.length > 0) {
            walk(n.children, route);
          }
        }
      }
      walk(topNodes, []);

      return { tree, routes };
    })
    .filter((x) => x.routes.length > 0);
}

/** The scope-route string for a segment list, matching Manifest `scope` form. */
function routeString(segments) {
  return segments.length === 0 ? "/" : "/" + segments.join("/");
}

/** Every proper ancestor route of a segment list, narrowest→widest, then `/`. */
function ancestorRoutes(segments) {
  const out = [];
  for (let len = segments.length; len >= 1; len--) {
    out.push(routeString(segments.slice(0, len)));
  }
  out.push("/");
  return out;
}

/** Whether `a` ("/x/y") is a proper route-ancestor of `b` ("/x/y/z"). */
function isProperAncestor(a, b) {
  if (a === b) return false;
  if (a === "/") return b !== "/"; // root is an ancestor of everything else
  return b === a || b.startsWith(a + "/");
}

describe(
  "computeScopeChain \u2014 Property 1: Scope_Chain is a prefix-ordered subset of the Manifest " +
    "(Validates: Requirements 5.1, 5.2, 5.3, 5.5)",
  () => {
    it(
      "returns a narrowest-first subsequence of the Manifest over the route's resolvable ancestors",
      () => {
        fc.assert(
          fc.property(
            treeArb().chain(({ tree, routes }) =>
              fc
                // Pick a selection route from the tree (so the route resolves),
                // plus a random subset of candidate scopes to put in the Manifest
                // (each is either an ancestor route, `/`, or a random other
                // tree route — the chain must still only pick resolvable ancestors).
                .record({
                  selection: fc.constantFrom(...routes),
                  manifestScopes: fc.subarray(
                    [
                      "/",
                      ...routes.map(routeString),
                    ],
                    { minLength: 0 },
                  ),
                })
                .map(({ selection, manifestScopes }) => ({
                  tree,
                  selection,
                  manifestScopes,
                })),
            ),
            ({ tree, selection, manifestScopes }) => {
              // Build the Manifest: one entry per chosen scope, in `/`-first then
              // ascending order (the migration's deterministic order). Each entry
              // gets a file derived from its scope so entries are distinguishable.
              const scopes = [...new Set(manifestScopes)];
              const ordered = [
                ...(scopes.includes("/") ? ["/"] : []),
                ...scopes.filter((s) => s !== "/").sort(),
              ];
              const manifest = {
                glossaries: ordered.map((scope) => ({
                  scope,
                  file:
                    scope === "/"
                      ? "content/terms/_root.json"
                      : `content/terms${scope}.json`,
                })),
              };

              const chain = computeScopeChain(tree, manifest, selection);
              const chainScopes = chain.map((e) => e.scope);

              // The set of ancestor routes of the selection (incl. itself and `/`).
              const ancestors = new Set(ancestorRoutes(selection));

              // (a) Subset of the Manifest: every chain entry is one of the
              //     Manifest's own entry objects (by reference) — the chain is a
              //     reordering (narrowest-first) of a subset, never an invented
              //     entry. No entry appears twice.
              const seenEntries = new Set();
              for (const e of chain) {
                expect(manifest.glossaries.includes(e)).toBe(true);
                expect(seenEntries.has(e)).toBe(false);
                seenEntries.add(e);
              }

              // (b) Every chain scope is an ancestor route of the selection AND
              //     present in the Manifest (R5.1). No non-ancestor leaks in.
              for (const s of chainScopes) {
                expect(ancestors.has(s)).toBe(true);
                expect(ordered.includes(s)).toBe(true);
              }

              // (c) Completeness: every Manifest entry whose scope is an ancestor
              //     route of the selection IS in the chain — ancestors with a
              //     Glossary_File are kept, only those without one are skipped
              //     (R5.3). (All selection ancestors resolve by construction, and
              //     `/` is always a valid scope.)
              for (const g of manifest.glossaries) {
                if (ancestors.has(g.scope)) {
                  expect(chainScopes.includes(g.scope)).toBe(true);
                }
              }

              // (d) Strictly narrowest-first: each scope is a proper route-
              //     ancestor of the previous one, so the chain narrows monotonically
              //     and ends at `/` when present (R5.2).
              for (let i = 1; i < chainScopes.length; i++) {
                expect(isProperAncestor(chainScopes[i], chainScopes[i - 1])).toBe(true);
              }
              if (chainScopes.length > 0 && ordered.includes("/")) {
                expect(chainScopes[chainScopes.length - 1]).toBe("/");
              }
            },
          ),
          { numRuns: 150 },
        );
      },
    );

    it("yields the empty chain for the home route (empty segments) \u2014 R5.5", () => {
      fc.assert(
        fc.property(
          treeArb().chain(({ tree, routes }) =>
            fc
              .subarray(["/", ...routes.map(routeString)], { minLength: 0 })
              .map((manifestScopes) => ({ tree, manifestScopes })),
          ),
          ({ tree, manifestScopes }) => {
            const manifest = {
              glossaries: [...new Set(manifestScopes)].map((scope) => ({
                scope,
                file: scope === "/" ? "content/terms/_root.json" : `content/terms${scope}.json`,
              })),
            };
            expect(computeScopeChain(tree, manifest, [])).toEqual([]);
          },
        ),
        { numRuns: 100 },
      );
    });
  },
);

// ---------------------------------------------------------------------------
// Property 6 — nearer glossary definitions come first in the merged chain index.
// ---------------------------------------------------------------------------

/**
 * Build a loaded-glossary fixture: a list of entries all carrying the SAME
 * `source` (as the loader attaches per Glossary_File). Each entry is
 * `{ term, definition, pageRef, source }`.
 *
 * @param {string} route The scope route (source.route).
 * @param {string} title The scope title (source.title).
 * @param {Array<{term: string, definition: string}>} defs
 */
function glossary(route, title, defs) {
  const source = { route, title };
  return defs.map((d) => ({
    term: d.term,
    definition: d.definition,
    pageRef: `${route}/x`,
    source,
  }));
}

/** A term: 1–3 lowercase-letter tokens joined by single spaces. */
const termArb = fc
  .array(
    fc
      .array(fc.integer({ min: 97, max: 122 }), { minLength: 1, maxLength: 6 })
      .map((codes) => codes.map((c) => String.fromCharCode(c)).join("")),
    { minLength: 1, maxLength: 3 },
  )
  .map((tokens) => tokens.join(" "));

describe(
  "merged Scope_Chain index \u2014 Property 6: Nearer glossary definitions come first " +
    "(Validates: Requirement 6.3)",
  () => {
    it(
      "lists the nearer (narrower-scope) glossary's definition before the further one for a shared term",
      () => {
        fc.assert(
          fc.property(
            fc.record({
              // A term defined in BOTH a nearer and a further glossary, plus some
              // filler entries unique to each scope so the glossaries are not
              // identical. `chainLen` scopes stand in for the Scope_Chain order.
              sharedTerm: termArb,
              nearFiller: fc.array(termArb, { minLength: 0, maxLength: 3 }),
              farFiller: fc.array(termArb, { minLength: 0, maxLength: 3 }),
              midGlossaries: fc.integer({ min: 0, max: 2 }),
            }),
            ({ sharedTerm, nearFiller, farFiller, midGlossaries }) => {
              // The nearest scope defines the shared term with a marker definition
              // distinct from the furthest scope's, so we can tell them apart in
              // the ordered definition list.
              const nearDef = `NEAR:${sharedTerm}`;
              const farDef = `FAR:${sharedTerm}`;

              const near = glossary("/a/b/c", "C (near)", [
                { term: sharedTerm, definition: nearDef },
                ...nearFiller.map((t, i) => ({ term: t, definition: `nf${i}:${t}` })),
              ]);
              // Optional middle glossaries (do not define the shared term) to
              // exercise a longer chain; they sit between near and far.
              const mids = Array.from({ length: midGlossaries }, (_, k) =>
                glossary(`/a/b/m${k}`, `M${k}`, [
                  { term: `${sharedTerm} mid ${k}`, definition: `mid${k}` },
                ]),
              );
              const far = glossary("/", "General (far)", [
                { term: sharedTerm, definition: farDef },
                ...farFiller.map((t, i) => ({ term: t, definition: `ff${i}:${t}` })),
              ]);

              // Chain order is narrowest-first: near, [mids...], far. Build each
              // into its own index and merge in that order — the production path.
              const chainLoaded = [near, ...mids, far];
              const merged = mergeIndexes(chainLoaded.map((g) => buildIndex(g)));

              // Read the shared term's ordered definition list two ways: via the
              // exact `query` result and via `findMatches` (what the panel runs).
              const q = query(merged, sharedTerm);
              expect(q !== null).toBe(true);
              const qDefs = q.definitions;
              const nearPosQ = qDefs.findIndex((d) => d.definition === nearDef);
              const farPosQ = qDefs.findIndex((d) => d.definition === farDef);
              expect(nearPosQ >= 0).toBe(true);
              expect(farPosQ >= 0).toBe(true);
              // The nearer-scope definition comes before the further one (R6.3).
              expect(nearPosQ < farPosQ).toBe(true);

              const matches = findMatches(merged, sharedTerm);
              const match = matches.find((m) =>
                m.definitions.some((d) => d.definition === nearDef) &&
                m.definitions.some((d) => d.definition === farDef),
              );
              expect(match !== undefined).toBe(true);
              const mDefs = match.definitions;
              const nearPos = mDefs.findIndex((d) => d.definition === nearDef);
              const farPos = mDefs.findIndex((d) => d.definition === farDef);
              expect(nearPos < farPos).toBe(true);

              // Confirm the ordering truly reflects scope distance by reading the
              // same list from the index's own `byTerm` group (the entries carry
              // their runtime-only `source`): the entry defining `nearDef` is the
              // narrower-scope glossary's, and it precedes the `/`-scope one.
              const group = merged.byTerm.get(normalize(sharedTerm).join(" "));
              expect(Array.isArray(group)).toBe(true);
              const nearEntryPos = group.findIndex((e) => e.definition === nearDef);
              const farEntryPos = group.findIndex((e) => e.definition === farDef);
              expect(nearEntryPos >= 0 && farEntryPos >= 0).toBe(true);
              expect(nearEntryPos < farEntryPos).toBe(true);
              expect(group[nearEntryPos].source.route).toBe("/a/b/c");
              expect(group[farEntryPos].source.route).toBe("/");
            },
          ),
          { numRuns: 150 },
        );
      },
    );
  },
);
