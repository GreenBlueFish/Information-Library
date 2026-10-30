// src/main.js
//
// Runtime entry — boots the Library of Alexandria (design.md — Example Usage).
//
// No build step: this is a native ES module loaded by `index.html` via
// `<script type="module" src="src/main.js">`. It wires the already-built
// components together into the running site:
//
//   Content Loader  → topics + terms + per-page JSON        (content-loader.js)
//   Router          → hash → RouteResolution, hashchange     (router.js)
//   Renderer        → RouteResolution + page JSON → DOM       (renderer.js)
//   Lookup          → index build + inline definition panel   (lookup/*.js)
//   Widget Registry → declarative widgets, self-registered    (widgets/*.js)
//
// `boot()` loads the topic tree and the lookup table once, builds the search
// index, then renders on the initial load and on every `hashchange`. The shell
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
// missing or malformed `topics.json`/`terms.json`/page JSON surfaces as a
// `ContentLoadError`. Boot catches it and renders an inline error block into
// the app region via `renderError`, so the shell and nav stay usable instead of
// the page going blank.
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
  loadTerms,
  ContentLoadError,
} from "./content-loader.js";
import { renderPage, renderNav, renderError } from "./renderer.js";
import { buildIndex } from "./lookup/search-index.js";
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

/**
 * @typedef {import("./router.js").TopicNode} TopicNode
 * @typedef {import("./widgets/registry.js").WidgetInstance} WidgetInstance
 */

/**
 * Boot the runtime: load the content manifests, build the lookup index, and
 * render on the initial load and on every hash change.
 *
 * The topic tree and lookup table are loaded ONCE (navigation does not reload
 * them); only per-page JSON is fetched per route (and the Content Loader
 * memoizes those by URL). Returns once the initial render has been kicked off;
 * subsequent renders are driven by the `hashchange` subscription.
 *
 * @returns {Promise<void>}
 */
export async function boot() {
  const app = document.getElementById("app");
  const nav = document.getElementById("nav");

  // The topic tree and lookup table are the two manifests the whole site reads;
  // load them once up front. A failure here is non-fatal: render an inline
  // error into the app region and stop (there is no tree to navigate).
  /** @type {TopicNode} */
  let tree;
  /** @type {ReturnType<typeof buildIndex>} */
  let index;
  try {
    tree = /** @type {TopicNode} */ (await loadTopics());
    const terms = await loadTerms();
    index = buildIndex(terms);
  } catch (err) {
    reportBootError(err, app);
    return;
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

    // Resolve the route. A null resolution (bad/duplicate slug, missing leaf
    // page) is treated as the home route by the renderer; an empty/unknown hash
    // already falls back home inside resolveRoute (Requirement 2.4).
    const resolution = resolveRoute(tree, parseHash(location.hash));

    // Nav reflects the active route's ancestor chain + the full tree. Rendered
    // from the already-loaded tree, so it stays usable even if the page load
    // below fails (Requirement 15.1).
    renderNav(tree, resolution?.path ?? [], nav);

    // Attach the tree to the home resolution so the renderer's home view can
    // build its topic cards (renderHome reads `resolution.tree`); harmless for
    // a topic-page resolution, which the renderer builds from `resolution.node`.
    const renderResolution = attachTree(resolution, tree);

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
  }

  // Install the lookup interaction ONCE, on the persistent `#app` element,
  // before wiring navigation. Its dblclick/mouseup listeners are delegated on
  // `#app` and resolve selections against the loaded-once index, so a single
  // install captures selections on every page the renderer later swaps into
  // `#app`'s children. `installLookup` creates and reuses ONE panel element, so
  // this single install guarantees at most one Lookup_Panel across navigations
  // (Requirement 8.4). Installing per render would stack listeners on the same
  // persistent element and let one selection spawn a panel per past render.
  installLookup(index, app);

  // Re-resolve and re-render on every hash change (Requirement 2.5), then do
  // the initial render for the current hash.
  onRouteChange(render);
  await render();
}

/**
 * Attach the root topic tree to a resolution so the renderer's home view can
 * build its topic cards (renderHome reads `resolution.tree`). Returns a shallow
 * copy so the frozen HOME_ROUTE singleton from the router is never mutated. A
 * null resolution (treated as home by the renderer) still gets the tree.
 *
 * @param {ReturnType<typeof resolveRoute>} resolution
 * @param {TopicNode} tree
 * @returns {object} A resolution-shaped object carrying `tree`.
 */
function attachTree(resolution, tree) {
  if (!resolution) {
    return { path: [], node: null, pageFile: null, crumbs: [], tree };
  }
  return { ...resolution, tree };
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
