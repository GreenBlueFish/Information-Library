// tests/src/integration/boot-navigation.test.js
//
// End-to-end integration test of boot + navigation (task 11.2) — Requirements
// 2.5, 3.3, 8.4, 10.7. Unlike seed-content.test.js (which exercises routing
// logic against the seed JSON directly) this suite boots the REAL runtime entry
// `src/main.js` against the REAL seed content and drives it the way a browser
// would: it fills the `#app`/`#nav` shell, sets `location.hash`, fires
// `hashchange`, and asserts the page re-renders, the lookup installs exactly
// once, and no widget instance leaks across navigations.
//
// What makes this an integration test (not a unit test): it wires NOTHING by
// hand. The whole pipeline — content-loader → router → renderer → lookup →
// widget registry — runs through `boot()` exactly as it does in the browser;
// the test only provides the ambient browser surfaces that Node/linkedom lack.
//
// ---------------------------------------------------------------------------
// Environment the runtime expects, and how we provide it
// ---------------------------------------------------------------------------
// `main.js` (and the modules it wires) reach for four browser surfaces that do
// not exist under Node + linkedom. We install all four BEFORE importing main.js,
// because main.js runs `boot()` at module top-level (see "auto-run" below):
//
//   1. The HTML shell — `document.getElementById("app")` / `"nav"`. linkedom
//      gives us an empty <body>, so we create `<main id="app">` and
//      `<nav id="nav">` on it, mirroring index.html's landmarks.
//
//   2. `location` with a settable `hash` and working `hashchange`. linkedom's
//      window has no `location`. `render()` reads the BARE global `location.hash`
//      while `onRouteChange` reads `window.location.hash`, so we install ONE
//      shared location object as BOTH `globalThis.location` and `window.location`.
//      Setting `.hash` and dispatching a `hashchange` on `window` re-runs the
//      router (linkedom's window.addEventListener/dispatchEvent work — verified).
//
//   3. `fetch` serving the real files from disk. content-loader.js does
//      `fetch(url)` → `response.ok` → `response.text()` → `JSON.parse`. We map a
//      relative URL like "content/topics.json" to reading that file from the repo
//      root (node:fs) and return a minimal Response-like object.
//
//   4. (nothing else — buildIndex, the renderer, and the registry all run on the
//      DOM/globals above.)
//
// ---------------------------------------------------------------------------
// Handling main.js's top-level auto-run
// ---------------------------------------------------------------------------
// main.js ends with a bare `boot()` call, so `import("…/main.js")` kicks off a
// boot against whatever ambient DOM/location/fetch exist at import time. We make
// that deterministic by:
//   - installing the full environment (shell + location + fetch) FIRST, with the
//     initial hash already set to "#/snn", THEN importing main.js. The auto-run
//     therefore boots the route we want.
//   - also importing the EXPORTED `boot` and awaiting a fresh `boot()` call so we
//     have a Promise to await before asserting (the top-level call's Promise is
//     not observable from outside the module).
// Running boot() twice is harmless and idempotent here: `render()` clears
// `#app`/`#nav` with `replaceChildren()` before each render, `installLookup`
// creates/reuses a SINGLE panel element, and the content loader memoizes fetches
// by URL — so the second boot reproduces the same DOM rather than stacking onto
// it. The "≤1 lookup panel" and "no widget leak" assertions below hold precisely
// because of that idempotence, which is part of what this test pins.
//
// ---------------------------------------------------------------------------
// Observing the widget lifecycle (Requirement 10.7)
// ---------------------------------------------------------------------------
// main.js imports the REAL parameter-plot type, which self-registers. We REPLACE
// that registration with a spy for "parameter-plot" (registerWidget replaces by
// type — Req 10.1). Two reasons: (1) the real widget sets `input.type`, a
// getter-only property under the headless DOM (linkedom), which throws and
// aborts the render of any widget page — so a spy is required just to render the
// neuron-models page headlessly; (2) the spy increments a live counter on mount
// and decrements it on destroy, which is exactly the observability the no-leak
// invariant needs. Because boot destroys the previous render's instances before
// building the next DOM, navigating to a widget page, away, and back repeatedly
// must never leave more than one page's worth of widgets live — the no-leak
// invariant (R10.7).
//
// The spy must be RE-ASSERTED before every render: other test files in the
// shared Node process call `clearWidgetRegistry()` inside their cases, and the
// runner interleaves all files' cases, so a one-time registration would be wiped
// out before this suite's cases run. `navigate()` re-registers the spy each time.

import { readFileSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "../../harness.js";
import { ensureDom } from "../../dom.js";

// This file lives at <repo>/tests/src/integration/, so the repo root is three
// directories up — the base the runtime's relative fetch URLs resolve against.
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..", "..");

// ---------------------------------------------------------------------------
// Install the browser surfaces the runtime needs, BEFORE importing main.js.
// ---------------------------------------------------------------------------

const dom = await ensureDom();
const { document, window } = dom;

// Pin the ambient globals to this suite's real linkedom DOM: other test files in
// the shared Node process install their own minimal `document` stubs at import
// time, and whichever ran last would otherwise win.
globalThis.document = document;
globalThis.window = window;

// (1) The HTML shell: the two landmarks boot fills (index.html's #app / #nav).
let app = document.getElementById("app");
if (!app) {
  app = document.createElement("main");
  app.id = "app";
  app.className = "app";
  document.body.appendChild(app);
}
let nav = document.getElementById("nav");
if (!nav) {
  nav = document.createElement("nav");
  nav.id = "nav";
  nav.className = "site-nav";
  document.body.appendChild(nav);
}

// (2) A single shared `location` with a settable hash, installed as both the bare
// global (read by render()) and window.location (read by onRouteChange). Setting
// `.hash` stores the normalized value; navigation is driven by dispatching a
// `hashchange` on window (see navigate() below).
const locationShim = { hash: "#/snn", protocol: "http:" };
globalThis.location = locationShim;
try {
  // linkedom's window has no own `location`; define it to point at the same shim.
  Object.defineProperty(window, "location", {
    value: locationShim,
    configurable: true,
    writable: true,
  });
} catch {
  window.location = locationShim;
}

// (3) A disk-serving fetch: map a relative content URL to the file on disk and
// return a minimal Response-like object shaped exactly as content-loader.js reads
// it (`ok`, `status`, `text()`), so the real loader runs unchanged.
//
// This MUST be re-asserted before every render: content-loader.test.js captures
// `globalThis.fetch` at ITS import time (before ours) and, in a finally after
// each of its cases, restores that captured value — Node's native fetch, NOT our
// disk fetch. Because the runner interleaves all files' cases, by the time this
// suite's navigations run, a content-loader case may have "restored" fetch out
// from under us. `installDiskFetch()` (called from `navigate()`) puts ours back.
async function fetchFromDisk(url) {
  const abs = join(repoRoot, String(url));
  let text;
  try {
    text = readFileSync(abs, "utf8");
  } catch {
    // A missing file maps to a non-ok response (never a thrown fetch), matching
    // how a static server would answer; content-loader turns this into a typed
    // ContentLoadError. The seed paths all exist, so this is a safety net.
    return { ok: false, status: 404, statusText: "Not Found", async text() { return ""; } };
  }
  return { ok: true, status: 200, statusText: "OK", async text() { return text; } };
}

/** Ensure the disk-serving fetch is the active `globalThis.fetch`. */
function installDiskFetch() {
  globalThis.fetch = fetchFromDisk;
}
installDiskFetch();

// ---------------------------------------------------------------------------
// Replace the widget type with a lifecycle spy (import registry BEFORE main.js
// so main.js's real parameter-plot registration can then be overridden).
// ---------------------------------------------------------------------------

const registry = await import("../../../src/widgets/registry.js");

// Live/created/destroyed counters the no-leak assertion reads. `live` is the
// number of mounted-but-not-yet-destroyed spy instances at any moment.
const widgetStats = { created: 0, destroyed: 0, live: 0, maxLive: 0 };

/**
 * The spy mount function for "parameter-plot". It mounts a visible marker (so
 * the renderer's `.block--widget` container is non-empty, like a real widget)
 * and drives the lifecycle counters: +1 live on mount, -1 on the first destroy.
 *
 * @param {import("../../../src/widgets/registry.js").WidgetContext} ctx
 * @returns {import("../../../src/widgets/registry.js").WidgetInstance}
 */
function spyMount(ctx) {
  widgetStats.created += 1;
  widgetStats.live += 1;
  if (widgetStats.live > widgetStats.maxLive) widgetStats.maxLive = widgetStats.live;
  const marker = (ctx.container.ownerDocument ?? document).createElement("div");
  marker.className = "widget widget--spy";
  ctx.container.appendChild(marker);
  let destroyed = false;
  return {
    update() {},
    destroy() {
      // Idempotent: repeated teardown decrements `live` exactly once, so it can
      // never go negative.
      if (destroyed) return;
      destroyed = true;
      widgetStats.destroyed += 1;
      widgetStats.live -= 1;
    },
  };
}

/**
 * Ensure the spy owns the "parameter-plot" type. This is re-asserted before
 * every render because OTHER test files in the shared Node process call
 * `clearWidgetRegistry()` inside their cases, and the run phase interleaves all
 * files' cases — so a top-level registration alone would be wiped out from
 * under us by the time this suite's cases run. `registerWidget` replaces by type
 * (Req 10.1), so re-registering the same function is a no-op when already set.
 */
function ensureSpyRegistered() {
  registry.registerWidget("parameter-plot", spyMount);
}

/** Reset the lifecycle counters to a clean baseline (no DOM changes). */
function resetWidgetStats() {
  widgetStats.created = 0;
  widgetStats.destroyed = 0;
  widgetStats.live = 0;
  widgetStats.maxLive = 0;
}

// ---------------------------------------------------------------------------
// Boot the real runtime EXACTLY ONCE.
//
// main.js runs boot() at module top-level, so importing it boots the runtime a
// single time against the environment installed above (initial hash "#/snn").
// We deliberately do NOT call the exported boot() again: each boot() subscribes
// its own `onRouteChange` handler and installs its own lookup closure, so
// re-booting would stack renders and lookup panels — artifacts of the test, not
// the runtime, which boots once. Instead we drive every subsequent navigation
// through the SINGLE subscription that this one boot registered, by setting
// `location.hash` and dispatching a `hashchange` (exactly what a browser does).
// ---------------------------------------------------------------------------

// Why a SPY for "parameter-plot": the real widget's mount sets `input.type`,
// which is a getter-only property under the headless DOM (linkedom) and throws,
// aborting the render of any page that declares a widget. The spy stands in for
// the real widget's observable contract — it mounts visible DOM and exposes
// update/destroy — which is exactly what the no-leak invariant (R10.7) needs to
// observe, without depending on a real plot the headless DOM cannot build.
ensureSpyRegistered();

const main = await import("../../../src/main.js");
// main.js's real parameter-plot self-registered during that import and replaced
// our spy; put the spy back. (navigate() re-asserts this before every render.)
ensureSpyRegistered();

/**
 * Wait until `predicate()` is truthy, polling across macrotasks so the runtime's
 * async render (which awaits `loadPage`) can settle. Throws if it never becomes
 * true within the bound, so a genuine failure surfaces as a clear timeout rather
 * than a misleading later assertion.
 *
 * @param {() => boolean} predicate
 * @param {string} describe What we were waiting for (used in the timeout error).
 * @param {number} [tries]
 * @returns {Promise<void>}
 */
async function waitFor(predicate, describe, tries = 200) {
  for (let i = 0; i < tries; i++) {
    if (predicate()) return;
    // Yield to the macrotask queue so pending fetch/loadPage promises resolve.
    await new Promise((r) => setTimeout(r, 0));
  }
  if (!predicate()) {
    throw new Error(`timed out waiting for: ${describe}`);
  }
}

/**
 * Navigate to a hash the way a browser does — set `location.hash`, dispatch a
 * `hashchange` on window — and wait for the single boot's subscribed render to
 * finish by polling for the expected page title in #app. No reload, no re-boot:
 * this exercises the runtime's own hashchange → re-resolve → re-render path
 * (Requirement 2.5).
 *
 * @param {string} hash e.g. "#/snn/neuron-models"
 * @param {string} expectedTitle The .page-title text the destination renders.
 */
async function navigate(hash, expectedTitle) {
  // Re-assert the surfaces other test files may have reset since our last render:
  // the disk fetch (content-loader.test.js "restores" Node's native fetch) and
  // the widget spy (various files call clearWidgetRegistry()). Both must be in
  // place before this render loads a page or mounts a widget.
  installDiskFetch();
  ensureSpyRegistered();
  locationShim.hash = hash;
  const Ev = window.Event ?? globalThis.Event;
  window.dispatchEvent(new Ev("hashchange"));
  await waitFor(() => {
    const t = app.querySelector(".page .page-title");
    return !!t && t.textContent === expectedTitle;
  }, `#app to render page titled "${expectedTitle}"`);
}

/** Count elements matching a selector across the whole document. */
function countInDoc(selector) {
  return document.querySelectorAll(selector).length;
}

/**
 * Remove any lookup panels this suite's gestures created, so the shared linkedom
 * `document.body` is left clean for other test files (whose own assertions query
 * `document` for `.lookup-panel`). Called in a finally after the lookup case.
 */
function removeLookupPanels() {
  for (const panel of Array.from(document.querySelectorAll(".lookup-panel"))) {
    panel.remove();
  }
}

// Wait for the single auto-run boot's initial render to settle at "#/snn" before
// the suite's assertions, so the first case sees a fully rendered page.
await waitFor(
  () => {
    const t = app.querySelector(".page .page-title");
    return !!t && t.textContent === "Spiking Neural Networks";
  },
  'initial boot to render the SNN page at "#/snn"',
);

describe("boot + navigation integration (R2.5, R3.3, R8.4, R10.7)", () => {
  // =========================================================================
  // R3.3 / R14.1 — after boot at "#/snn", #app renders the SNN page and #nav
  // carries the tree + breadcrumb.
  // =========================================================================
  describe("initial boot renders the resolved page and nav", () => {
    it("renders the SNN page into #app (a .page titled 'Spiking Neural Networks')", async () => {
      await navigate("#/snn", "Spiking Neural Networks");

      const page = app.querySelector(".page");
      expect(page).toBeTruthy();

      const title = page.querySelector(".page-title");
      expect(title).toBeTruthy();
      expect(title.textContent).toBe("Spiking Neural Networks");

      // R3.3: the page's body blocks render in order — the SNN index leads with
      // a callout, so at least one .block is present.
      expect(app.querySelectorAll(".block").length > 0).toBe(true);
    });

    it("fills #nav with the topic tree and a breadcrumb for the active route", () => {
      // The nav tree is rendered from the already-loaded topic tree…
      const tree = nav.querySelector(".nav-tree");
      expect(tree).toBeTruthy();
      // …and includes a link to the active SNN route.
      const links = Array.from(nav.querySelectorAll(".nav-tree__link"));
      const snnLink = links.find((a) => a.getAttribute("href") === "#/snn");
      expect(snnLink).toBeTruthy();

      // A breadcrumb trail exists for the active (non-home) route (R2.3).
      const crumb = nav.querySelector(".breadcrumb");
      expect(crumb).toBeTruthy();
      expect(crumb.textContent.includes("Home")).toBe(true);
    });
  });

  // =========================================================================
  // R2.5 / R3.3 — navigating to a deeper route re-renders the page WITHOUT a
  // full reload (driven purely by setting the hash + a hashchange event).
  // =========================================================================
  describe("hash navigation re-renders without a reload (R2.5, R3.3)", () => {
    it("navigating to '#/snn/neuron-models' re-renders #app to that page", async () => {
      // Hold a reference to the current page element; after navigation the app
      // region is rebuilt (replaceChildren), so this exact node is gone — proof
      // the render happened in place rather than via a document reload.
      const before = app.querySelector(".page");
      expect(before).toBeTruthy();

      await navigate("#/snn/neuron-models", "Neuron Models");

      const page = app.querySelector(".page");
      expect(page).toBeTruthy();
      // The re-render replaced the prior page node (no reload, just a re-render).
      expect(page === before).toBe(false);

      const title = page.querySelector(".page-title");
      expect(title.textContent).toBe("Neuron Models");

      // R3.3: among the ordered blocks is the widget block from the seed page.
      const widgetBlock = page.querySelector(".block--widget");
      expect(widgetBlock).toBeTruthy();
    });

    it("navigating back to '#/snn' restores the SNN page", async () => {
      await navigate("#/snn", "Spiking Neural Networks");
      const title = app.querySelector(".page .page-title");
      expect(title.textContent).toBe("Spiking Neural Networks");
    });
  });

  // =========================================================================
  // R8.4 — at most one Lookup_Panel at a time, ACROSS NAVIGATIONS. This is the
  // end-to-end guarantee asserted against the REAL booted `#app` (not a fresh
  // isolated region): after several hash navigations, dispatching selection
  // gestures on `#app` must never leave the document holding more than one
  // `.lookup-panel`.
  //
  // Why this now holds against the real runtime: main.js installs the lookup
  // EXACTLY ONCE in boot() on the persistent `#app` element — not per render.
  // The dblclick/mouseup listeners are delegated on `#app` (which survives
  // every re-render; only its children are swapped) and resolve against the
  // loaded-once index, so one install captures selections on every rendered
  // page. `installLookup` lazily creates and reuses a SINGLE panel element, so
  // a new selection REPLACES the prior panel rather than stacking another.
  //
  // (History: an earlier revision installed the lookup at the end of EVERY
  // render. Because `#app` is persistent, those installs accumulated — a single
  // `mouseup` after N navigations woke N handlers and spawned up to N panels
  // (measured 5 after 5 renders), violating R8.4. The one-install-at-boot fix
  // in main.js removed that accumulation; this test now pins it against the
  // real `#app`.)
  // =========================================================================
  describe("at most one lookup panel across navigations (R8.4)", () => {
    it("after several navigations, selections on the booted #app never exceed one panel", async () => {
      // Drive the real runtime through several navigations so that, under the
      // OLD per-render install, listeners would have accumulated on #app. The
      // one-install-at-boot runtime keeps exactly one set of listeners regardless.
      await navigate("#/snn", "Spiking Neural Networks");
      await navigate("#/snn/neuron-models", "Neuron Models");
      await navigate("#/snn", "Spiking Neural Networks");
      await navigate("#/snn/neuron-models", "Neuron Models");
      await navigate("#/snn", "Spiking Neural Networks");

      // Stub the ambient selection so a raw gesture on #app resolves to a real
      // indexed term (the booted lookup queries the index boot built). We vary
      // the selected text across gestures; each resolved selection must REPLACE
      // the one reusable panel the single boot install owns.
      const view = document.defaultView;
      const fakeRect = { left: 5, top: 5, bottom: 20, right: 60, width: 55, height: 15 };
      const fakeSelection = {
        _text: "neuron",
        toString() {
          return this._text;
        },
        rangeCount: 1,
        getRangeAt() {
          return { getBoundingClientRect: () => fakeRect };
        },
      };
      const realGetSelection = view.getSelection;
      view.getSelection = () => fakeSelection;

      const Ev = window.Event ?? globalThis.Event;

      try {
        // Start from a clean slate so what we count is what THIS runtime's one
        // install produces, not residue from other test files' gestures.
        removeLookupPanels();

        // First gesture on the REAL booted #app → at most one panel appears.
        fakeSelection._text = "neuron";
        app.dispatchEvent(new Ev("mouseup"));
        expect(countInDoc(".lookup-panel") <= 1).toBe(true);

        // Several more selections of different real seed terms, each dispatched
        // on the persistent #app. Because the lookup is installed once and
        // reuses a single panel, every selection REPLACES the prior panel — the
        // count stays ≤1 no matter how many navigations preceded this.
        for (const term of ["spike", "threshold", "neuron", "spike"]) {
          fakeSelection._text = term;
          app.dispatchEvent(new Ev("mouseup"));
          expect(countInDoc(".lookup-panel") <= 1).toBe(true);
        }

        // The invariant after the whole sequence, against the real #app: at most
        // one panel in the document (R8.4).
        expect(countInDoc(".lookup-panel") <= 1).toBe(true);
      } finally {
        view.getSelection = realGetSelection;
        // Leave the shared document.body clean for other test files, whose own
        // R8.4 assertions query the whole document for `.lookup-panel`.
        removeLookupPanels();
      }
    });
  });

  // =========================================================================
  // R10.7 — no widget-instance leak across navigations. Boot destroys the prior
  // render's widgets before building the next DOM, so navigating into a widget
  // page, away, and back repeatedly must never leave more than one page's worth
  // of widgets live. The neuron-models seed page declares exactly ONE widget, so
  // the live count must never exceed 1, and every created instance that left the
  // screen must have been destroyed.
  // =========================================================================
  describe("no widget-instance leak across navigations (R10.7)", () => {
    it("destroys prior widgets on re-render — live instances never exceed one page", async () => {
      // Start on a page WITHOUT the widget so the destroy of any prior render's
      // widget has already run, THEN reset the counters from a clean baseline.
      await navigate("#/snn", "Spiking Neural Networks");
      resetWidgetStats(); // no widget is live on the SNN index
      expect(widgetStats.live).toBe(0);

      // Bounce into and out of the widget page several times.
      for (let i = 0; i < 3; i++) {
        await navigate("#/snn/neuron-models", "Neuron Models"); // page WITH one widget
        // Exactly one spy widget is live while the widget page is shown.
        expect(widgetStats.live).toBe(1);

        await navigate("#/snn", "Spiking Neural Networks"); // page WITHOUT the widget
        // Leaving the widget page destroyed its instance — nothing lingers.
        expect(widgetStats.live).toBe(0);
      }

      // Across every navigation, never more than one page's worth of widgets was
      // live at once (the neuron-models page declares exactly one widget).
      expect(widgetStats.maxLive).toBe(1);

      // And every widget ever created was eventually destroyed: no leak.
      expect(widgetStats.created > 0).toBe(true);
      expect(widgetStats.live).toBe(0);
      expect(widgetStats.destroyed).toBe(widgetStats.created);
    });
  });
});
