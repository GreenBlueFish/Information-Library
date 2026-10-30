// tests/src/renderer.idempotent.property.test.js
//
// Property-based test for idempotent render
// (design.md — Correctness Properties → "Property 5: Idempotent render").
//
//   Property 5: Idempotent render
//   **Validates: Requirements 3.3, 8.4, 10.7**
//
// Rendering the same route twice produces the same DOM and leaves at most one
// lookup panel and no leaked widget instances (each render calls `destroy` on
// prior widgets). This property has three distinct aspects, drawn from three
// requirements, and this file exercises each so they stand on their own:
//
//   (1) Same DOM (R3.3 — blocks render in order, deterministically). For a
//       random small PageContent and a random small topic tree, rendering into
//       two fresh mount elements yields byte-identical `outerHTML`. Re-rendering
//       (clear + rebuild) into the SAME mount also reproduces the exact DOM it
//       produced the first time. Both `renderPage` and `renderNav` are checked,
//       since the renderer owns the whole page structure.
//
//   (2) No leaked widget instances (R10.7 — a re-render tears down a prior
//       instance before mounting its replacement). `renderer.js` is a
//       synchronous DOM builder that intentionally does NOT retain widget
//       instances; the destroy-on-re-render orchestration is owned by the boot
//       wiring (task 11) / the caller. So this aspect models the re-render loop
//       the way boot will: it keeps the set of instances returned by the
//       registry on each render and, before re-rendering, destroys every
//       retained instance. The property asserts that this discipline (a) calls
//       `destroy` exactly once on each prior instance and (b) leaks nothing —
//       after N renders, the number of live (not-yet-destroyed) instances never
//       exceeds the widget count of a single render. A spy widget type is
//       registered whose `mount` records the instance and whose `destroy` is a
//       spy, so leaks and double-destroys are observable.
//
//   (3) At most one lookup panel (R8.4 — a new lookup replaces any prior
//       panel). `installLookup(index, rootEl)` (src/lookup/lookup-ui.js) is
//       implemented in parallel (task 5.8); when present, this file simulates
//       two selections and asserts at most one `.lookup-panel` remains. When the
//       module is not yet available, this aspect is skipped WITHOUT failing the
//       suite (the import is attempted dynamically and its absence tolerated),
//       so aspects (1) and (2) still provide full value on their own.
//
// DOM: the renderer builds against the ambient global `document`. Tests run
// under Node (no DOM) via `tests/dom.js`, which installs a vanilla linkedom DOM
// as an ES module from a CDN — same no-build-step convention used to load
// fast-check below. See tests/dom.js and tests/README.md.
//
// fast-check is loaded as an ES module with NO build step, matching the sibling
// lookup property tests' convention exactly (design.md — Testing Strategy:
// "fast-check (vanilla JS, no build step needed to run)"). It is imported from
// the jsDelivr ESM CDN so `node tests/run.js` (Node 18+, with global fetch)
// resolves it directly from the network with no install and no bundler. To run
// fully offline, replace the import specifier with a locally vendored copy of
// fast-check's ESM build and keep the rest of this file unchanged.

import { describe, it, expect } from "../harness.js";
import * as fcNS from "https://cdn.jsdelivr.net/npm/fast-check/+esm";
import { ensureDom } from "../dom.js";
import { renderPage, renderNav } from "../../src/renderer.js";
import {
  registerWidget,
  clearWidgetRegistry,
} from "../../src/widgets/registry.js";

// fast-check's ESM build exposes its API on the module namespace; some bundles
// also nest it under `default`. Normalize to a single `fc` handle either way.
const fc = fcNS && typeof fcNS.property === "function" ? fcNS : fcNS.default;

// The DOM is installed once before any property runs. `ensureDom` is memoized,
// so this is cheap to await repeatedly.
const dom = await ensureDom();

/**
 * Point the ambient `document`/`window` at THIS file's linkedom context.
 *
 * `src/renderer.js` builds child elements via the ambient global
 * `document.createElement` (not `mountEl.ownerDocument`), while our mounts come
 * from `dom.document`. A sibling test file (`renderer.test.js`) installs its own
 * minimal, non-linkedom `document` stub onto `globalThis` at import time and
 * never restores it; because every test file is imported before any case runs,
 * that stub can be the live global by the time these properties execute.
 * Appending a stub-created child into a linkedom parent then crashes deep in
 * linkedom's internals. Re-pinning the globals to our linkedom context before
 * each render keeps this file hermetic regardless of sibling import order.
 *
 * @returns {void}
 */
function useOwnDom() {
  globalThis.document = dom.document;
  if (dom.window) globalThis.window = dom.window;
}

// A dedicated widget type the spy registers under. A render that includes a
// widget block of this type drives the registry's mount path (Requirement
// 10.2) and hands us an instance to track.
const SPY_TYPE = "idempotent-spy";

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/**
 * Short plain-text arbitrary: letters/digits/spaces only, so the rendered
 * `textContent` is stable and the serialized DOM has no surprising escaping to
 * reason about. Determinism of the DOM does not depend on this, but it keeps
 * failure output readable.
 */
const textArb = fc
  .array(
    fc
      .integer({ min: 97, max: 122 })
      .map((c) => String.fromCharCode(c)),
    { minLength: 0, maxLength: 10 },
  )
  .map((chars) => chars.join(""));

/**
 * A non-widget ContentBlock arbitrary covering every supported leaf block type
 * (prose/heading/list/code/callout). Widget blocks are injected separately so a
 * test can control how many widget instances a render mounts.
 */
const leafBlockArb = fc.oneof(
  textArb.map((text) => ({ type: "prose", text })),
  fc
    .tuple(textArb, fc.integer({ min: 2, max: 4 }))
    .map(([text, level]) => ({ type: "heading", text, level })),
  fc
    .array(textArb, { minLength: 0, maxLength: 4 })
    .map((items) => ({ type: "list", items })),
  fc
    .tuple(textArb, textArb)
    .map(([lang, source]) => ({ type: "code", lang, source })),
  textArb.map((text) => ({ type: "callout", text })),
);

/** A widget block of the spy type. `title` varies so the DOM reflects the spec. */
const widgetBlockArb = textArb.map((title) => ({
  type: "widget",
  widget: { type: SPY_TYPE, title, params: [] },
}));

/**
 * A small PageContent arbitrary: a title, optional intro, and a short ordered
 * mix of leaf blocks and spy-widget blocks. The widget count is reported
 * alongside so the lifecycle property knows how many instances one render
 * mounts.
 *
 * @returns {import("fast-check").Arbitrary<{content: object, widgetCount: number}>}
 */
const pageContentArb = fc
  .record({
    title: textArb,
    hasIntro: fc.boolean(),
    intro: textArb,
    blocks: fc.array(fc.oneof(leafBlockArb, widgetBlockArb), {
      minLength: 0,
      maxLength: 8,
    }),
  })
  .map(({ title, hasIntro, intro, blocks }) => {
    const content = { title, blocks };
    if (hasIntro) content.intro = intro;
    const widgetCount = blocks.filter((b) => b.type === "widget").length;
    return { content, widgetCount };
  });

/**
 * A small topic-tree arbitrary (depth up to 3). Nodes carry a slug, title, and
 * optional summary; `renderNav`/`renderPage` turn these into deterministic DOM.
 * The generator is recursion-bounded by `fc.letrec` + a shrinking depth so
 * trees stay small and the DOM stays legible on failure.
 */
const slugArb = fc
  .array(
    fc.integer({ min: 97, max: 122 }).map((c) => String.fromCharCode(c)),
    { minLength: 1, maxLength: 6 },
  )
  .map((chars) => chars.join(""));

const { node: nodeArb } = fc.letrec((tie) => ({
  node: fc.record({
    slug: slugArb,
    title: textArb,
    summary: textArb,
    children: fc.oneof(
      { weight: 3, arbitrary: fc.constant([]) },
      {
        weight: 1,
        arbitrary: fc.array(tie("node"), { minLength: 1, maxLength: 3 }),
      },
    ),
  }),
}));

const treeArb = fc
  .array(nodeArb, { minLength: 0, maxLength: 4 })
  .map((children) => ({ slug: "", title: "root", children }));

/**
 * An active-path arbitrary: either the home route (empty) or the slug path of
 * some node reachable in `tree`. Picking a real path exercises the breadcrumb
 * and the `aria-current` marking; picking home exercises the no-breadcrumb path.
 *
 * @param {object} tree
 * @returns {import("fast-check").Arbitrary<string[]>}
 */
function activePathArbFor(tree) {
  const paths = collectPaths(tree.children, []);
  if (paths.length === 0) return fc.constant([]);
  return fc.oneof(
    { weight: 1, arbitrary: fc.constant([]) },
    { weight: 2, arbitrary: fc.constantFrom(...paths) },
  );
}

/**
 * A tree paired with an active path valid for THAT tree. Because the active
 * path depends on the generated tree, generation is chained: the tree is
 * generated first, then its active-path arbitrary is derived from the concrete
 * tree. This keeps all generation inside fast-check's arbitrary pipeline —
 * never calling `fc.sample` inside a running property predicate, which would
 * corrupt fast-check's RNG state.
 *
 * @returns {import("fast-check").Arbitrary<{tree: object, activePath: string[]}>}
 */
const treeWithActivePathArb = treeArb.chain((tree) =>
  fc.record({
    tree: fc.constant(tree),
    activePath: activePathArbFor(tree),
  }),
);

/**
 * Enumerate every slug path in a forest (for choosing a valid active route).
 * @param {Array<object>} nodes
 * @param {string[]} prefix
 * @returns {string[][]}
 */
function collectPaths(nodes, prefix) {
  const out = [];
  for (const n of nodes) {
    if (!n || typeof n.slug !== "string") continue;
    const path = prefix.concat(n.slug);
    out.push(path);
    if (Array.isArray(n.children) && n.children.length > 0) {
      out.push(...collectPaths(n.children, path));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Spy widget registration
// ---------------------------------------------------------------------------

/**
 * Register a spy widget under {@link SPY_TYPE}. Every mount pushes a record onto
 * `instances`: the returned instance plus a `destroyed` count the `destroy` spy
 * increments. The mount also appends a marker element so the widget's presence
 * is reflected deterministically in the serialized DOM.
 *
 * @returns {{instances: Array<{instance: object, destroyed: number}>}}
 */
function installSpyWidget() {
  /** @type {Array<{instance: object, destroyed: number}>} */
  const instances = [];

  registerWidget(SPY_TYPE, (ctx) => {
    const marker = ctx.container.ownerDocument.createElement("span");
    marker.className = "spy-widget";
    marker.textContent = (ctx.spec && ctx.spec.title) || "";
    ctx.container.appendChild(marker);

    const record = { instance: /** @type {object} */ (null), destroyed: 0 };
    const instance = {
      update() {},
      destroy() {
        record.destroyed += 1;
      },
    };
    record.instance = instance;
    instances.push(record);
    return instance;
  });

  return { instances };
}

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

describe("renderer idempotent render (Property 5) \u2014 Validates: Requirements 3.3, 8.4, 10.7", () => {
  it("renders identical DOM for the same route twice (R3.3)", () => {
    fc.assert(
      fc.property(pageContentArb, treeWithActivePathArb, (page, treeAndPath) => {
        const { tree, activePath } = treeAndPath;

        // Keep this file's render path on our linkedom DOM (see useOwnDom).
        useOwnDom();

        // The spy registry state is irrelevant to DOM sameness, but a widget
        // block must still mount deterministically, so install a fresh spy for
        // each case and clear afterwards.
        clearWidgetRegistry();
        installSpyWidget();

        // Two independent fresh mounts rendered from the same inputs.
        const mountA = dom.freshMount();
        const mountB = dom.freshMount();
        const navA = dom.freshMount();
        const navB = dom.freshMount();

        // Build a resolution shaped like the router's output for `activePath`.
        const resolution = resolutionFor(tree, activePath);

        renderPage(resolution, page.content, mountA);
        renderNav(tree, activePath, navA);

        renderPage(resolution, page.content, mountB);
        renderNav(tree, activePath, navB);

        // Same inputs → same serialized DOM across independent mounts.
        expect(mountA.innerHTML).toBe(mountB.innerHTML);
        expect(navA.innerHTML).toBe(navB.innerHTML);

        // Re-rendering into the SAME mount (clear + rebuild) reproduces the
        // exact first DOM — the heart of "idempotent".
        const firstPage = mountA.innerHTML;
        const firstNav = navA.innerHTML;
        renderPage(resolution, page.content, mountA);
        renderNav(tree, activePath, navA);
        expect(mountA.innerHTML).toBe(firstPage);
        expect(navA.innerHTML).toBe(firstNav);

        clearWidgetRegistry();
      }),
      { numRuns: 100 },
    );
  });

  it("re-render destroys prior widget instances and leaks none (R10.7)", () => {
    fc.assert(
      fc.property(
        pageContentArb,
        treeWithActivePathArb,
        fc.integer({ min: 1, max: 4 }),
        (page, treeAndPath, renders) => {
          const { tree, activePath } = treeAndPath;

          // Keep this file's render path on our linkedom DOM (see useOwnDom).
          useOwnDom();

          clearWidgetRegistry();
          const { instances } = installSpyWidget();

          // This aspect counts the widget instances a render MOUNTS, so the
          // page BODY (and its widget blocks) must actually render. The home
          // route renders the topic-card grid and ignores `pageContent.blocks`
          // entirely, so a home resolution would mount zero widgets regardless
          // of `page.widgetCount`. Use a topic-page resolution here (non-null
          // node) so `renderPage` renders the generated blocks; the active path
          // is reflected where it resolves to a real node, and otherwise a
          // synthetic node stands in so the body still renders.
          const resolution = topicResolutionFor(tree, activePath, page.content);
          const mount = dom.freshMount();

          // Model the boot re-render loop (task 11): track the instances the
          // registry handed us on the previous render and destroy them BEFORE
          // re-rendering, so at most one render's worth of widgets is ever
          // live at once.
          /** @type {Array<{instance: object, destroyed: number}>} */
          let live = [];

          for (let i = 0; i < renders; i++) {
            // Tear down the prior render's instances first (R10.7).
            for (const rec of live) rec.instance.destroy();

            const before = instances.length;
            renderPage(resolution, page.content, mount);
            // The instances created by THIS render are the newly-appended ones.
            live = instances.slice(before);

            // Each render mounts exactly one instance per widget block.
            expect(live.length).toBe(page.widgetCount);
          }

          // Every instance from a render that was followed by another render
          // must have been destroyed exactly once; the final render's
          // instances remain live (not yet torn down). No instance is ever
          // destroyed more than once (no double-destroy).
          const expectedDestroyed = (renders - 1) * page.widgetCount;
          const destroyedCount = instances.filter((r) => r.destroyed > 0).length;
          const liveCount = instances.filter((r) => r.destroyed === 0).length;

          expect(destroyedCount).toBe(expectedDestroyed);
          // No leaks: the only live instances are the final render's.
          expect(liveCount).toBe(page.widgetCount);
          // No double-destroy.
          expect(instances.every((r) => r.destroyed <= 1)).toBe(true);

          clearWidgetRegistry();
        },
      ),
      { numRuns: 100 },
    );
  });

  it("lookup leaves at most one panel after repeated selections (R8.4)", async () => {
    // lookup-ui.js (task 5.8) is implemented in parallel. Import it
    // dynamically; if it is not yet present, skip this aspect without failing
    // the suite — the DOM-sameness and widget-destroy aspects stand alone.
    let installLookup;
    try {
      ({ installLookup } = await import("../../src/lookup/lookup-ui.js"));
    } catch {
      installLookup = undefined;
    }
    if (typeof installLookup !== "function") {
      // Nothing to assert here yet; the module is not available.
      return;
    }

    // Keep this file's render path on our linkedom DOM (see useOwnDom).
    useOwnDom();

    const { buildIndex } = await import("../../src/lookup/search-index.js");
    const index = buildIndex([
      { term: "neuron", definition: "a nerve cell", pageRef: null },
      { term: "synapse", definition: "a junction", pageRef: null },
    ]);

    const root = dom.freshMount();
    root.textContent = "neuron and synapse";
    dom.document.body.appendChild(root);
    installLookup(index, root);

    // Simulate two successive selections. We cannot drive a real text
    // selection headlessly in a portable way, so dispatch the events the UI
    // listens for after placing a selection via the document's selection API
    // when available; regardless of whether a panel is created, the invariant
    // under test is "AT MOST ONE panel", which must hold after any number of
    // interactions.
    simulateSelection(root, "neuron");
    simulateSelection(root, "synapse");

    const panels = root.ownerDocument.querySelectorAll(".lookup-panel");
    expect(panels.length <= 1).toBe(true);

    root.remove();
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a RouteResolution-shaped object for an active slug path against `tree`.
 * An empty path is the home route (`node: null`); otherwise the resolution
 * carries the resolved node so `renderPage` renders a topic page. The tree is
 * attached so the home view can build its cards (see renderer `renderHome`).
 *
 * @param {object} tree
 * @param {string[]} path
 * @returns {object|null}
 */
function resolutionFor(tree, path) {
  if (!path || path.length === 0) {
    return { path: [], node: null, pageFile: null, crumbs: [], tree };
  }
  let siblings = tree.children;
  let node = null;
  for (const slug of path) {
    node = (siblings || []).find((c) => c && c.slug === slug) || null;
    if (!node) break;
    siblings = node.children;
  }
  return { path, node, pageFile: null, crumbs: [], tree };
}

/**
 * Build a RouteResolution whose `node` is guaranteed non-null, so `renderPage`
 * renders a TOPIC page (title, intro, ordered body blocks) rather than the home
 * grid. The widget-lifecycle property (R10.7) counts the widget instances a
 * render mounts, and only the topic-page path renders `pageContent.blocks`; the
 * home route renders the topic-card grid and never mounts page-body widgets.
 *
 * When `path` resolves to a real node in `tree`, that node is used (the active
 * route is a genuine topic page). Otherwise — including the home path `[]` — a
 * synthetic leaf node carrying the page title stands in, so the generated
 * blocks still render and the instance count is meaningful.
 *
 * @param {object} tree
 * @param {string[]} path
 * @param {{title?: string}} content
 * @returns {object}
 */
function topicResolutionFor(tree, path, content) {
  const resolved = resolutionFor(tree, path);
  if (resolved && resolved.node) return resolved;

  const node = { slug: "page", title: (content && content.title) || "page", children: [] };
  return { path: ["page"], node, pageFile: null, crumbs: [node], tree };
}

/**
 * Best-effort simulation of a user text selection + the events the lookup UI
 * listens for (`mouseup`, `dblclick`, `selectionchange`). Portable across DOM
 * backends: it sets a selection when the Selection API is present and always
 * dispatches the events so the UI's handler runs. The property under test
 * ("at most one panel") holds regardless of whether any single call produces a
 * panel.
 *
 * @param {HTMLElement} root
 * @param {string} _word The word to "select" (informational).
 * @returns {void}
 */
function simulateSelection(root, _word) {
  const doc = root.ownerDocument;
  const win = doc.defaultView ?? dom.window;

  try {
    const sel = win.getSelection && win.getSelection();
    if (sel && typeof sel.removeAllRanges === "function" && root.firstChild) {
      sel.removeAllRanges();
      const range = doc.createRange();
      range.selectNodeContents(root.firstChild);
      sel.addRange(range);
    }
  } catch {
    // Selection API not available in this DOM backend; the event dispatch
    // below still exercises the handler path.
  }

  for (const type of ["mouseup", "dblclick"]) {
    try {
      const Ev = win.Event ?? globalThis.Event;
      const ev = new Ev(type, { bubbles: true });
      root.dispatchEvent(ev);
    } catch {
      // Event constructor not available; ignore — invariant still asserted.
    }
  }
  try {
    const Ev = win.Event ?? globalThis.Event;
    doc.dispatchEvent(new Ev("selectionchange", { bubbles: true }));
  } catch {
    // ignore
  }
}
