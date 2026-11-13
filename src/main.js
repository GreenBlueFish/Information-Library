// src/main.js
//
// Runtime entry — boots the Library of Alexandria (design.md — Example Usage).
//
// No build step: this is a native ES module loaded by `index.html` via
// `<script type="module" src="src/main.js">`. It wires the already-built
// components together into the running site:
//
//   Content Loader  → topics + glossary Manifest + per-page JSON (content-loader.js)
//   Router          → hash → RouteResolution, hashchange     (router.js)
//   Renderer        → RouteResolution + page JSON → DOM       (renderer.js)
//   Lookup          → index build + inline definition panel   (lookup/*.js)
//   Widget Registry → declarative widgets, self-registered    (widgets/*.js)
//
// `boot()` loads the topic tree and the glossary Manifest once (NO glossary is
// fetched at boot), installs the lookup handle once on the persistent `#app`,
// then renders on the initial load and on every `hashchange`. Each `render()`
// computes the route's Scope_Chain, lazily loads+merges that chain's
// Glossary_Files into a local index (cached), and re-points the lookup handle
// via `handle.update({ localIndex, loadGlobalIndex, scopeTitle })`. The shell
// (header, nav landmark, main/app landmark, footer) is provided by index.html,
// which also applies the shared stylesheet (Requirement 14.1); boot only fills
// the nav and app landmarks and installs the lookup interaction.
//
// Lookup install ownership (Requirement 8.4; design.md Component 4): the lookup
// listeners are DELEGATED on the persistent `#app` element (index.html's main
// landmark) and resolve selections against the immutable, loaded-once index.
// The renderer replaces `#app`'s CHILDREN on every render, but the `#app`
// element itself — and the listeners installed on it — persist across every
// navigation. So the lookup is installed EXACTLY ONCE at boot, not per render.
// Installing per render would attach a fresh set of dblclick/mouseup listeners
// (each owning its own panel closure) to the same persistent element on every
// hashchange, so after N navigations a single selection would wake N handlers
// and create up to N panels — violating "at most one Lookup_Panel across
// navigations". One install at boot resolves selections on every rendered page
// (the listeners live on the persistent element, not the per-render children)
// while `installLookup`'s single reusable panel guarantees the ≤1-panel contract.
//
// Widget lifecycle ownership (Requirements 10.7, 8.4; design.md Property 5):
// the renderer is a pure, synchronous DOM builder — it mounts widgets through
// the Widget Registry but does NOT retain the mounted instances. Boot owns the
// destroy-on-re-render discipline: before each re-render it calls `destroy()`
// on the PREVIOUS render's widget instances so no animation loop or listener
// leaks across navigations. To collect a render's instances without changing
// `renderPage`'s signature, boot installs a per-render "mount sink" on the
// registry (`setMountSink`) that records every WidgetInstance the registry
// mounts during that `renderPage` pass; see the choice note below.
//
// Choice note (task 11.1 asked us to pick and document the lifecycle approach):
// we chose approach (b) — wrap mounting via the registry to record instances
// for the current render — over approach (a) — have `renderPage`/`renderBlock`
// return the instances they mounted. Approach (b) keeps the renderer's existing
// signatures untouched (so all 124 existing tests stay green) and matches how
// the idempotent-render property test (task 6.5) already models the boot loop:
// it tracks the instances the registry hands back per render and destroys the
// prior set before re-rendering. The registry is the single chokepoint through
// which every widget is created, so a sink there captures exactly the set boot
// must tear down, with no bookkeeping leaking into the renderer.
//
// Non-fatal content failures (Requirement 15.1; design.md Error Handling): a
// missing or malformed `topics.json`/Manifest/page JSON surfaces as a
// `ContentLoadError`. Boot catches the manifest failures and renders an inline
// error block into the app region via `renderError`, so the shell and nav stay
// usable instead of the page going blank. A chain Glossary_File that fails to
// load is partitioned out by `loadGlossaries` (never rejects), so the local
// index is still built from the glossaries that did load.
//
// Requirements: 2.5 (re-resolve + re-render on hashchange without a reload),
// 3.2 (standard page template via the shared renderer), 8.4 (at most one lookup
// panel across navigations — `installLookup` is called ONCE at boot on the
// persistent `#app` and reuses a single panel), 10.7 (destroy prior widgets
// before each re-render), 14.1 (render into the shared shell).

import { parseHash, resolveRoute, onRouteChange } from "./router.js";
import {
  loadTopics,
  loadPage,
  loadManifest,
  loadGlossaries,
  loadRedirects,
  redirectSegments,
  ContentLoadError,
} from "./content-loader.js";
import { renderPage, renderNav, renderError } from "./renderer.js";
import { buildIndex, mergeIndexes } from "./lookup/search-index.js";
import { findMatches } from "./lookup/matches.js";
import { installLookup } from "./lookup/lookup-ui.js";
import { setMountSink } from "./widgets/registry.js";
// Side-effect import: the parameter-plot type self-registers with the Widget
// Registry at import time, so the renderer's `widget` block can mount it
// (design.md — Example Usage / Component 5). Keep this import even though no
// binding is used.
import "./widgets/types/parameter-plot.js";
// Simulation widget types for the computational-cortical-columns topic; each
// self-registers on import (PROJECT_GUIDE §7.3).
import "./widgets/types/lif-neuron.js";
import "./widgets/types/stdp-explorer.js";
import "./widgets/types/spike-raster.js";
import "./widgets/types/sdr-overlap.js";
import "./widgets/types/temporal-memory.js";
import "./widgets/types/column-voting.js";
// The VGA scanline stepper for the communication-protocols topic.
import "./widgets/types/vga-scanline.js";

/**
 * @typedef {import("./router.js").TopicNode} TopicNode
 * @typedef {import("./widgets/registry.js").WidgetInstance} WidgetInstance
 * @typedef {import("./content-loader.js").Manifest} Manifest
 * @typedef {import("./content-loader.js").ManifestEntry} ManifestEntry
 * @typedef {import("./lookup/lookup-ui.js").InstallOptions} InstallOptions
 */

// ---------------------------------------------------------------------------
// Scope-chain helpers (design.md — Components and Interfaces §6; R5, R11.6)
//
// Three pure functions that translate a route (as parsed slug segments) and the
// glossary Manifest into the data the Lookup_Panel needs: the ordered Scope_Chain
// of Manifest entries (narrowest → `/`), the Source_Annotation for a scope, and
// the current Top_Level_Topic title. They reuse `resolveRoute` so that only
// routes that actually resolve in `topics.json` are ever treated as scopes —
// the Manifest is authoritative for WHICH glossaries exist, but the topic tree
// is authoritative for which routes are real (R11.6).
// ---------------------------------------------------------------------------

/**
 * The scope route string for a prefix of slug segments.
 *
 * `[]` → `"/"` (the root scope), `["a"]` → `"/a"`, `["a","b"]` → `"/a/b"`. This
 * is the canonical form used as a Manifest `scope` value, so it can be compared
 * directly against `manifest.glossaries[i].scope`.
 *
 * @param {string[]} segments Ordered slug segments (a prefix of the route).
 * @returns {string} The scope route: `"/"` for the root, else `"/" + join("/")`.
 */
function scopeRoute(segments) {
  return segments.length === 0 ? "/" : "/" + segments.join("/");
}

/**
 * Compute the Scope_Chain for a route: the ordered list of Manifest glossaries
 * whose scope is the current route or one of its ancestors, up to and including
 * `/`, narrowest-first (Requirements 5.1, 5.2, 5.3, 5.5).
 *
 * For segments `[a,b,c]` the candidate ancestor routes are, narrowest → widest:
 * `/a/b/c`, `/a/b`, `/a`, `/`. For each candidate we confirm the route actually
 * resolves in the topic tree via {@link resolveRoute} (`/` is always valid as
 * the root scope), then include the Manifest entry whose `scope` equals that
 * route if one exists. Ancestor routes with no Glossary_File in the Manifest are
 * omitted, and the remaining ancestors are kept (R5.3). The home route (empty
 * segments) yields the empty chain (R5.5).
 *
 * Only routes that resolve are treated as scopes, so a Manifest entry pointing
 * at a slug that does not resolve in `topics.json` never leaks into a chain
 * (R11.6). The result is a subsequence of the Manifest ordered strictly
 * narrowest-first, with the `/` entry last when present.
 *
 * @param {TopicNode} tree The root topic tree.
 * @param {Manifest} manifest The parsed Manifest (`{ glossaries: [...] }`).
 * @param {string[]} segments Ordered slug segments from {@link parseHash}.
 * @returns {ManifestEntry[]} The Scope_Chain, narrowest-first, `/` last.
 */
export function computeScopeChain(tree, manifest, segments) {
  // Home ⇒ empty chain (R5.5).
  if (!Array.isArray(segments) || segments.length === 0) {
    return [];
  }

  const glossaries = manifest && Array.isArray(manifest.glossaries)
    ? manifest.glossaries
    : [];

  /** @type {ManifestEntry[]} */
  const chain = [];

  // Walk prefixes narrowest (longest) → widest (shortest), then `/` last.
  for (let len = segments.length; len >= 0; len--) {
    const prefix = segments.slice(0, len);
    const route = scopeRoute(prefix);

    // The route must resolve in the topic tree to count as a scope. `/` (the
    // empty prefix) is always valid as the root scope; any other prefix must
    // resolve to a real node (resolveRoute returns null for an unresolved
    // route). This is what keeps a Manifest scope that does not resolve in
    // topics.json out of the chain (R11.6).
    if (len > 0 && !resolveRoute(tree, prefix)) {
      continue;
    }

    // Include the Manifest entry whose scope equals this route, if one exists;
    // an ancestor route with no Glossary_File is simply skipped (R5.3).
    const entry = glossaries.find((g) => g && g.scope === route);
    if (entry) {
      chain.push(entry);
    }
  }

  return chain;
}

/**
 * The Source_Annotation for a Manifest entry's scope: the scope route and its
 * human title from `topics.json`, or `"General"` for the `/` scope (R4.7).
 *
 * The title is read by resolving the scope route back to its topic node and
 * taking that node's `title`. A scope that does not resolve (defensive) falls
 * back to the route string itself as the title so the panel still has something
 * to label the source with.
 *
 * @param {TopicNode} tree The root topic tree.
 * @param {string} scope The Manifest `scope` route (`"/"` or `"/a/b/c"`).
 * @returns {{ route: string, title: string }} The runtime-only source.
 */
export function sourceFor(tree, scope) {
  if (scope === "/") {
    return { route: "/", title: "General" };
  }

  const segments = parseHash(scope);
  const resolution = resolveRoute(tree, segments);
  const title = resolution && resolution.node && resolution.node.title
    ? resolution.node.title
    : scope;

  return { route: scope, title };
}

/**
 * The current Top_Level_Topic title: the title of the route's first-segment
 * top-level node, or `""` on the home page (empty segments) (R9.1).
 *
 * This is the title shown in the empty-local message ("No definition in
 * <current Top_Level_Topic title>"), so it reads the first segment's node from
 * the tree rather than the deepest node. A first segment that does not resolve
 * (defensive) yields `""`.
 *
 * @param {TopicNode} tree The root topic tree.
 * @param {string[]} segments Ordered slug segments from {@link parseHash}.
 * @returns {string} The top-level topic title, or `""` on home / unresolved.
 */
export function topLevelTitle(tree, segments) {
  if (!Array.isArray(segments) || segments.length === 0) {
    return "";
  }

  const topSegment = segments[0];
  const children = tree && Array.isArray(tree.children) ? tree.children : [];
  const node = children.find((child) => child && child.slug === topSegment);

  return node && node.title ? node.title : "";
}

// ---------------------------------------------------------------------------
// Caching layers (design.md — "Caching layers"; Requirements 4.2–4.6)
//
// Three session-lifetime module Maps back the glossary-index work so navigation
// never rebuilds an index it has already built:
//
//   perFileIndex — one SearchIndex per Glossary_File URL. Each file's
//     `buildIndex` runs ONCE and is reused by every chain (and by the global
//     index) that includes that file, so building the chain index for `/a/b`
//     reuses the `/a` and `/` file indexes already built for `/a`.
//   chainIndex   — the MERGED Scope_Chain index, keyed by the chain's file URLs
//     joined in order (narrowest-first). Revisiting a route reuses its merged
//     index without re-merging.
//   globalIndex  — the merged NON-chain ("Search_All") index, keyed the same
//     chain-file way. Owned conceptually by `loadGlobalIndex` (task 10.3); the
//     Map is declared here so 10.3 can reuse the same per-file cache.
//
// The underlying RAW glossary JSON is cached (and failures evicted) by the
// Content Loader's own URL cache inside `loadGlossaries`; these Maps sit one
// layer up and cache the BUILT indexes.
// ---------------------------------------------------------------------------

/**
 * Built SearchIndex per Glossary_File URL, reused across chains and the global
 * index so each file's `buildIndex` runs at most once per session.
 * @type {Map<string, import("./lookup/search-index.js").SearchIndex>}
 */
const perFileIndex = new Map();

/**
 * Merged Scope_Chain index per chain key (the chain's file URLs joined in
 * order). Reused when a route is revisited (R4.5).
 * @type {Map<string, import("./lookup/search-index.js").SearchIndex>}
 */
const chainIndex = new Map();

/**
 * Merged non-chain ("Search_All") index per chain key — the glossaries OUTSIDE
 * the current chain, merged once and reused. Populated by `loadGlobalIndex`
 * (task 10.3); declared here so that task can share `perFileIndex` (R4.6).
 * @type {Map<string, import("./lookup/search-index.js").SearchIndex>}
 */
const globalIndex = new Map();

/**
 * The SearchIndex for one loaded Glossary_File, built once and memoized by file
 * URL. The entries already carry their runtime-only `source` (attached by
 * `loadGlossary`), so the built index — and any merge of it — preserves the
 * Source_Annotation untouched (R1.6, R4.7).
 *
 * @param {import("./content-loader.js").LoadedGlossary} loaded A loaded glossary
 *   (`{ file, scope, source, entries }`) from `loadGlossaries`.
 * @returns {import("./lookup/search-index.js").SearchIndex} The per-file index.
 */
function perFileIndexFor(loaded) {
  const cached = perFileIndex.get(loaded.file);
  if (cached) return cached;
  const built = buildIndex(loaded.entries);
  perFileIndex.set(loaded.file, built);
  return built;
}

/**
 * The chain key for an ordered list of loaded glossaries: their file URLs joined
 * in order (narrowest-first). Used to key both the merged chain index and the
 * merged non-chain (global) index for a chain.
 *
 * @param {import("./content-loader.js").LoadedGlossary[]} results The loaded
 *   glossaries in chain order.
 * @returns {string} The chain key.
 */
function chainKeyFor(results) {
  return results.map((r) => r.file).join("\n");
}

/**
 * The merged Scope_Chain SearchIndex for the glossaries that loaded, cached by
 * chain key (R4.5). Each file is built once via {@link perFileIndexFor} and the
 * per-file indexes are folded together with `mergeIndexes`, which preserves the
 * nearer-first ordering of the inputs and every definition's `source` (R6.3).
 *
 * @param {import("./content-loader.js").LoadedGlossary[]} results The chain's
 *   loaded glossaries, narrowest-first.
 * @returns {import("./lookup/search-index.js").SearchIndex} The merged index.
 */
function mergedChainIndex(results) {
  const key = chainKeyFor(results);
  const cached = chainIndex.get(key);
  if (cached) return cached;
  const merged = mergeIndexes(results.map(perFileIndexFor));
  chainIndex.set(key, merged);
  return merged;
}

/**
 * Load a set of Manifest entries and build their merged SearchIndex, caching the
 * merged result in `cache` under `key` and reusing `perFileIndex` for each file
 * so no glossary is built twice (R4.6). Failures are partitioned out by
 * `loadGlossaries` (never rejects), so a missing file does not sink the rest of
 * the merge; the caller learns of them through the returned `failures` flag.
 *
 * This backs both the home page's "search every glossary" local index (all
 * Manifest entries) and the Search_All non-chain index (every entry outside the
 * chain). The merged index is cached so a revisit does not re-merge, and the
 * underlying per-file indexes are shared with the chain index (R4.5, R4.6).
 *
 * @param {TopicNode} tree The root topic tree (for each entry's Source_Annotation).
 * @param {ManifestEntry[]} entries The Manifest entries to load and merge.
 * @param {Map<string, import("./lookup/search-index.js").SearchIndex>} cache The
 *   merged-index cache to read/populate (`chainIndex`-style).
 * @param {string} key The cache key (a file-URL join; stable per entry set).
 * @returns {Promise<{ index: import("./lookup/search-index.js").SearchIndex, failures: boolean }>}
 */
async function mergedIndexForEntries(tree, entries, cache, key) {
  const loadEntries = entries.map((entry) => ({
    file: entry.file,
    source: sourceFor(tree, entry.scope),
  }));
  const { results, failures } = await loadGlossaries(loadEntries);
  const hadFailures = Array.isArray(failures) && failures.length > 0;

  const cached = cache.get(key);
  if (cached) return { index: cached, failures: hadFailures };

  const merged = mergeIndexes(results.map(perFileIndexFor));
  cache.set(key, merged);
  return { index: merged, failures: hadFailures };
}

/**
 * Boot the runtime: load the content manifests, install the lookup handle, and
 * render on the initial load and on every hash change.
 *
 * The topic tree and glossary Manifest are loaded ONCE (navigation does not
 * reload them); no Glossary_File is fetched at boot. Each route's glossaries
 * and per-page JSON are fetched per render and memoized (by URL in the Content
 * Loader, and as built indexes in the module caches). Returns once the initial
 * render has been kicked off; subsequent renders are driven by the `hashchange`
 * subscription.
 *
 * @returns {Promise<void>}
 */
export async function boot() {
  const app = document.getElementById("app");
  const nav = document.getElementById("nav");

  // The topic tree and the glossary Manifest are the two manifests the whole
  // site reads; load them once up front (Flow 1 / R4.1). NO Glossary_File is
  // fetched at boot — the Manifest only lists which glossaries exist; each
  // route's chain of glossaries is loaded lazily in `render()`. A failure here
  // is non-fatal: render an inline error into the app region and stop (there is
  // no tree to navigate).
  /** @type {TopicNode} */
  let tree;
  /** @type {Manifest} */
  let manifest;
  /** @type {Record<string, string>} */
  let redirects = {};
  try {
    tree = /** @type {TopicNode} */ (await loadTopics());
    manifest = /** @type {Manifest} */ (await loadManifest());
    redirects = await loadRedirects();
  } catch (err) {
    reportBootError(err, app);
    return;
  }

  /**
   * Lazily load every Manifest glossary and concatenate their entries — the
   * data source for the home page's term search (the old full `terms` array).
   * Memoized so the full set is loaded at most once; reuses the shared
   * `perFileIndex`/Content-Loader caches via `loadGlossaries`, so a glossary
   * already loaded for a chain is not re-fetched.
   *
   * Threaded into the home view as `installHome(home, tree, loadAllTerms)` (via
   * `resolution.loadAllTerms`): on the first keystroke the home term search
   * awaits this once and reuses the resolved array (R10.2, R10.3, R11.7). The
   * global cache it builds on is also shared with task 10.3's `loadGlobalIndex`.
   * @type {Promise<import("./content-loader.js").TermEntry[]>|null}
   */
  let allTermsPromise = null;
  /** @returns {Promise<import("./content-loader.js").TermEntry[]>} */
  function loadAllTerms() {
    if (allTermsPromise) return allTermsPromise;
    const glossaries = Array.isArray(manifest?.glossaries) ? manifest.glossaries : [];
    const entries = glossaries.map((g) => ({
      file: g.file,
      source: sourceFor(tree, g.scope),
    }));
    allTermsPromise = loadGlossaries(entries).then(({ results }) =>
      results.flatMap((r) => r.entries)
    );
    return allTermsPromise;
  }

  /**
   * The widget instances the MOST RECENT render mounted. Before each re-render
   * we call `destroy()` on each of these, then swap in the set the new render
   * mounts — so at most one render's worth of widgets is ever live, and nothing
   * leaks across navigations (Requirement 10.7).
   * @type {WidgetInstance[]}
   */
  let liveInstances = [];

  /**
   * Resolve the current hash, render the nav + page, and mount widgets. Re-run
   * on every hash change (Requirement 2.5). The lookup is NOT (re)installed
   * here — it is installed once in boot() on the persistent `#app` element.
   * @returns {Promise<void>}
   */
  async function render() {
    // Tear down the PREVIOUS render's widgets before building the new DOM so no
    // animation loop or listener survives the re-render (Requirement 10.7).
    for (const instance of liveInstances) {
      try {
        instance.destroy();
      } catch {
        // A widget's own destroy throwing must not abort the re-render; the
        // DOM is about to be cleared and rebuilt regardless.
      }
    }
    liveInstances = [];

    // Parse the hash once: both the route resolution and the Scope_Chain wiring
    // below read the same slug segments (Flow 2 step 1).
    let segments = parseHash(location.hash);

    // An old address (a topic that has since moved, e.g. `#/snn/...` before the
    // shelves) renders the page where it lives now. Only a route that no longer
    // resolves is redirected; the address bar is corrected with replaceState,
    // which keeps the old address out of the history and fires no hashchange.
    if (segments.length > 0 && resolveRoute(tree, segments) === null) {
      const moved = redirectSegments(redirects, segments);
      if (moved && moved.join("/") !== segments.join("/") && resolveRoute(tree, moved) !== null) {
        segments = moved;
        if (typeof history !== "undefined" && typeof history.replaceState === "function") {
          try {
            history.replaceState(history.state, "", "#/" + moved.join("/"));
          } catch {
            // A sandboxed frame may refuse; the page still renders at its new home.
          }
        }
      }
    }

    // Resolve the route. A null resolution (bad/duplicate slug, missing leaf
    // page) is treated as the home route by the renderer; an empty/unknown hash
    // already falls back home inside resolveRoute (Requirement 2.4).
    const resolution = resolveRoute(tree, segments);

    // Nav reflects the active route's ancestor chain + the full tree. Rendered
    // from the already-loaded tree, so it stays usable even if the page load
    // below fails (Requirement 15.1).
    renderNav(tree, resolution?.path ?? [], nav);

    // Attach the tree to the resolution so the renderer's home view can build
    // its topic cards (renderHome reads `resolution.tree`); harmless for a
    // topic-page resolution, which the renderer builds from `resolution.node`.
    //
    // The home term search loads over EVERY Glossary_File lazily: no glossary is
    // fetched at boot, so instead of an eager `terms` array we attach the lazy
    // `loadAllTerms` accessor, which `renderHome` threads into `installHome`.
    const renderResolution = attachTree(resolution, tree, loadAllTerms);

    // Load the page JSON only when the resolved route has a backing page file.
    // The home route and non-leaf groupings have none, so they render from the
    // tree/node alone. A content failure is non-fatal: render an inline error
    // into the app region, leaving the shell + nav intact (Requirement 15.1).
    let page = null;
    const pageFile = resolution ? resolution.pageFile : null;
    if (pageFile) {
      try {
        page = await loadPage(pageFile);
      } catch (err) {
        if (err instanceof ContentLoadError) {
          renderError(err, app);
          lastRouteKey = null; // the next successful page opens at its top
          // The nav is already rendered above; stop this render here. The
          // lookup is installed ONCE in boot() on the persistent `#app`, so
          // this early return does not skip it — its delegated listeners stay
          // live and will resolve selections on the next successful render.
          return;
        }
        throw err;
      }
    }

    // Collect the widgets THIS render mounts: install a sink on the registry,
    // render (the renderer's widget block mounts through the registry, which
    // reports each instance to the sink), then uninstall the sink. This is how
    // boot owns the widget lifecycle without changing the renderer's signature
    // (see the Choice note at the top of this file).
    /** @type {WidgetInstance[]} */
    const mounted = [];
    setMountSink((instance) => mounted.push(instance));
    try {
      renderPage(renderResolution, page, app);
    } finally {
      setMountSink(null);
    }
    liveInstances = mounted;

    // A move to another page (the pager arrows, a nav link, a card) starts at
    // the top of the new page. Without this the browser keeps the old scroll
    // offset, so the arrows at the foot of one page land the reader at the
    // foot of the next.
    const routeKey = (resolution?.path ?? []).join("/");
    if (lastRouteKey !== null && routeKey !== lastRouteKey && typeof window !== "undefined" && typeof window.scrollTo === "function") {
      window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    }
    lastRouteKey = routeKey;

    // -----------------------------------------------------------------------
    // Scope-chain wiring (Flow 2 — R5.4, R6, R11.6). Independent of the page
    // render above: even a route with no backing page (home, a grouping node)
    // still has a Scope_Chain and must re-point the lookup handle.
    // -----------------------------------------------------------------------

    // 1–2. Compute the Scope_Chain for this route: the Manifest glossaries whose
    // scope is this route or an ancestor, narrowest-first down to `/` (R5).
    const chain = computeScopeChain(tree, manifest, segments);

    // The full Manifest glossary set, and the chain's file URLs, drive both the
    // home local index (all glossaries) and the Search_All non-chain set (every
    // Manifest entry whose file is not already in the chain).
    const allEntries = Array.isArray(manifest?.glossaries) ? manifest.glossaries : [];
    const chainFiles = new Set(chain.map((entry) => entry.file));

    // 3. Load the chain's Glossary_Files in parallel, attaching each entry's
    // Source_Annotation (its scope's title from topics.json). Failures are
    // partitioned out by `loadGlossaries` (never rejects), so one missing file
    // does not blank the rest of the chain (R4.2, R4.8).
    const chainEntries = chain.map((entry) => ({
      file: entry.file,
      source: sourceFor(tree, entry.scope),
    }));
    const { results } = await loadGlossaries(chainEntries);

    // 4. Merge the loaded glossaries into one local index, cached by chain key;
    // each file is built once and reused across chains (R4.5). The merge keeps
    // nearer-first order so the narrower glossary's definition shows first (R6.3).
    const chainLocalIndex = mergedChainIndex(results);

    // 5. The empty-local message names the current Top_Level_Topic (R9.1).
    const scopeTitle = topLevelTitle(tree, segments);

    // 6. Decide this route's `localIndex` + `loadGlobalIndex` (design Flow 4):
    //
    //   • HOME (empty chain): the panel searches EVERY glossary directly with NO
    //     Search_All control (R10.1). The local index is the merged index over
    //     ALL Manifest glossaries, and `loadGlobalIndex` is null so the panel
    //     renders no Search_All row.
    //   • CHAIN COVERS EVERY MANIFEST ENTRY: there is nothing outside the chain
    //     to search, so `loadGlobalIndex` is null (R7.7). The chain index is the
    //     local index.
    //   • ELSE: the chain index is the local index, and `loadGlobalIndex` is a
    //     closure that lazily loads the NON-chain glossaries, builds+caches their
    //     merged index (keyed by their file URLs, reusing `perFileIndex`), and
    //     returns `{ matches, failures }` for a selection (R4.6, R8.1).
    //
    // The closure captures THIS route's `tree` and non-chain entry set in locals,
    // so a later route's render re-points the handle at a fresh closure and this
    // one is never read with a stale chain (R5.4).

    /** @type {import("./lookup/search-index.js").SearchIndex} */
    let localIndex;
    /** @type {InstallOptions["loadGlobalIndex"]} */
    let loadGlobalIndex;

    if (chain.length === 0) {
      // Home: merge every glossary into the local index; no Search_All control.
      const homeKey = `home\n${allEntries.map((g) => g.file).join("\n")}`;
      const { index } = await mergedIndexForEntries(tree, allEntries, globalIndex, homeKey);
      localIndex = index;
      loadGlobalIndex = null;
    } else {
      localIndex = chainLocalIndex;

      // The Manifest entries OUTSIDE the chain — what Search_All would search.
      const nonChainEntries = allEntries.filter((g) => g && !chainFiles.has(g.file));

      if (nonChainEntries.length === 0) {
        // The chain already covers every Manifest entry: nothing to search for.
        loadGlobalIndex = null;
      } else {
        // Key the merged non-chain index by this chain's non-chain file set, so
        // every route with the same non-chain set reuses one merged index.
        const globalKey = nonChainEntries.map((g) => g.file).join("\n");
        loadGlobalIndex = async (text) => {
          const { index, failures } = await mergedIndexForEntries(
            tree,
            nonChainEntries,
            globalIndex,
            globalKey,
          );
          return { matches: findMatches(index, text), failures };
        };
      }
    }

    // 7. Re-point the single installed lookup handle at this route's data; only
    // the closure's data is swapped, no listener moves (R5.4, R11.4).
    handle.update({ localIndex, loadGlobalIndex, scopeTitle });
  }

  /** Route of the last render (null before the first), for scroll-to-top. */
  let lastRouteKey = null;

  // Install the lookup interaction ONCE, on the persistent `#app` element,
  // before wiring navigation (Flow 1; R11.4). Its dblclick/mouseup listeners
  // are delegated on `#app`, so a single install captures selections on every
  // page the renderer later swaps into `#app`'s children. `installLookup`
  // creates and reuses ONE panel element, so this single install guarantees at
  // most one Lookup_Panel across navigations (R8.4, R11.4). Installing per
  // render would stack listeners on the same persistent element and let one
  // selection spawn a panel per past render.
  //
  // The install starts with an EMPTY local index and no Search_All loader; the
  // first `render()` below immediately re-points the returned handle at the
  // current route's merged chain index via `handle.update(...)`. `buildIndex([])`
  // is an empty-but-valid SearchIndex so a selection before the first render
  // simply finds nothing rather than throwing.
  const handle = installLookup(app, {
    localIndex: buildIndex([]),
    loadGlobalIndex: null,
    scopeTitle: "",
  });

  // Re-resolve and re-render on every hash change (Requirement 2.5), then do
  // the initial render for the current hash.
  onRouteChange(render);
  await render();
}

/**
 * Attach the root topic tree to a resolution so the renderer's home view can
 * build its topic cards (renderHome reads `resolution.tree`), plus the home
 * term-search accessor `loadAllTerms` — the lazy full-set accessor the renderer
 * threads into `installHome` (R10.2, R10.3). Returns a shallow copy so the
 * frozen HOME_ROUTE singleton from the router is never mutated. A null
 * resolution (treated as home by the renderer) still gets the tree and accessor.
 *
 * @param {ReturnType<typeof resolveRoute>} resolution
 * @param {TopicNode} tree
 * @param {() => Promise<import("./content-loader.js").TermEntry[]>} [loadAllTerms]
 *   Lazy full-set accessor for the home term search.
 * @returns {object} A resolution-shaped object carrying `tree` and `loadAllTerms`.
 */
function attachTree(resolution, tree, loadAllTerms) {
  if (!resolution) {
    return { path: [], node: null, pageFile: null, crumbs: [], tree, loadAllTerms };
  }
  return { ...resolution, tree, loadAllTerms };
}

/**
 * Render a boot-time content failure into the app region. A `ContentLoadError`
 * becomes an inline error block naming the file (Requirement 15.1); anything
 * else is re-thrown so a genuine programming bug is not silently swallowed.
 *
 * @param {unknown} err The caught error.
 * @param {HTMLElement|null} app The app/main region to render into.
 * @returns {void}
 */
function reportBootError(err, app) {
  if (err instanceof ContentLoadError) {
    renderError(err, app);
    return;
  }
  throw err;
}

// Kick off the runtime. `index.html` loads this module with `type="module"`, so
// the DOM shell is already parsed by the time this top-level call runs.
boot();
