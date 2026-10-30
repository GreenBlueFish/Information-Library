// tests/dom.js
//
// A tiny, dependency-free DOM bootstrap for the dev-only test suite — no build
// step, no package manager. The runtime renderer (`src/renderer.js`) and the
// lookup UI (`src/lookup/lookup-ui.js`) build DOM against the standard global
// `document` (`document.createElement`, `el.replaceChildren`, selection APIs),
// so a test that exercises them needs a DOM in environments (like Node) that
// do not ship one.
//
// Consistent with the no-build-step constraint and the way the property tests
// already load fast-check, this imports linkedom — a vanilla, spec-shaped DOM
// implementation — as an ES module directly from the esm.sh CDN, pinned:
//
//     const { parseHTML } = await import("https://esm.sh/linkedom@0.16.11");
//
// scripts/hive-test.sh loads that specifier through tests/net/hooks.js, which
// reads the committed copy in tests/vendor/, so this runs offline with no
// install and no bundler (see tests/README.md).
//
// If the host already provides a DOM (e.g. a browser, or a runtime with a
// global `document`), that DOM is used as-is and linkedom is never imported.

/**
 * A DOM context: the `document`/`window` the renderer builds into, plus a
 * helper to get a fresh, detached mount element for a single render.
 *
 * @typedef {Object} DomContext
 * @property {Document} document
 * @property {object} window
 * @property {() => HTMLElement} freshMount Create a new detached `<div>` in this
 *   document, suitable as a `mountEl` for `renderPage`/`renderNav`.
 */

/** @type {Promise<DomContext> | null} */
let domPromise = null;

/**
 * Ensure a global `document`/`window` exist and return a {@link DomContext}.
 *
 * Idempotent and memoized: the first call installs the globals (importing
 * linkedom only if the host has no `document`), and subsequent calls resolve to
 * the same context. Installing the globals — rather than only returning a local
 * document — lets modules that reference the ambient `document` (as the
 * renderer does) work unchanged under Node.
 *
 * @returns {Promise<DomContext>}
 */
export function ensureDom() {
  if (domPromise) return domPromise;

  domPromise = (async () => {
    // Prefer a DOM the host already provides (browser, or a runtime that set a
    // global document). Only reach for linkedom when there is none.
    if (typeof globalThis.document !== "undefined" && globalThis.document) {
      const doc = globalThis.document;
      const win = globalThis.window ?? globalThis;
      return makeContext(doc, win);
    }

    // Pin an exact linkedom version. A floating `linkedom/+esm` currently
    // resolves to a release whose transitive CSSOM dependency ships an ESM
    // bundle that fails to load under Node's network-import loader, which would
    // break every DOM-using test. esm.sh bundles the (working) transitive deps
    // for this pinned version; its copy lives in tests/vendor/esm.sh/.
    const { parseHTML } = await import("https://esm.sh/linkedom@0.16.11");

    // A minimal, valid document shell. The runtime's HTML lives in index.html;
    // tests render into detached mount elements, so an empty body is enough.
    const { document, window } = parseHTML(
      "<!doctype html><html><head></head><body></body></html>",
    );

    // Install the ambient globals the renderer and lookup UI read from. Guard
    // each so we never clobber a real browser global.
    if (typeof globalThis.document === "undefined") {
      globalThis.document = document;
    }
    if (typeof globalThis.window === "undefined") {
      globalThis.window = window;
    }
    // A handful of DOM classes/APIs modules may reference by bare name.
    for (const key of [
      "Node",
      "Element",
      "HTMLElement",
      "Event",
      "CustomEvent",
      "getComputedStyle",
    ]) {
      if (typeof globalThis[key] === "undefined" && window[key] !== undefined) {
        globalThis[key] = window[key];
      }
    }

    return makeContext(document, window);
  })();

  return domPromise;
}

/**
 * Build a {@link DomContext} around a document/window pair.
 * @param {Document} document
 * @param {object} window
 * @returns {DomContext}
 */
function makeContext(document, window) {
  return {
    document,
    window,
    freshMount() {
      return document.createElement("div");
    },
  };
}
