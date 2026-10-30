// tests/src/error-handling.test.js
//
// Unit tests for the error-handling paths (task 10.3) — Requirement 15. These
// pin the "fail gracefully, name what went wrong" behaviors the design calls
// for, one reachable path per acceptance criterion:
//
//   15.1 — a content load failure renders a non-fatal inline `.block--error`
//          naming the affected file (renderError on a ContentLoadError).
//   15.5 — a `file://` fetch block additionally LINKS to the Project Guide's
//          static-server instructions (an <a> whose href is PROJECT_GUIDE.md).
//          Asserted alongside 15.1 since it is the same code path in
//          `renderError`, keyed off `error.isFileProtocolBlock`.
//   15.2 — an unknown block `type` renders a visible `.block--placeholder`
//          naming the type, rather than throwing (renderBlock).
//   15.3 — an unregistered widget `type` renders a `.widget-placeholder`
//          naming the type, returns null, and leaves the container otherwise
//          intact (mountWidget).
//   15.4 — a selection with no exact and no fuzzy match shows a brief
//          "No definition found" panel (`.lookup-panel--empty`) that then
//          auto-dismisses (installLookup → the empty-panel path).
//
// DOM setup (no build step, no install):
//   Every path here builds real DOM — renderError/renderBlock go through the
//   `document` global, mountWidget reads `container.ownerDocument`, and the
//   lookup UI appends its panel to `document.body` and schedules a timer. We
//   reuse the suite's shared `ensureDom()` helper (tests/dom.js), which installs
//   a real DOM (linkedom, loaded as an ES module — see tests/README.md) on the
//   globals the modules read, and `freshMount()` for a detached mount element.
//   Using a real DOM keeps these assertions honest about DOM semantics
//   (querySelector, isConnected, body appends).
//
// Driving the lookup no-match path headlessly:
//   linkedom does not implement the Selection API (`window.getSelection` is
//   undefined) or range geometry (`range.getBoundingClientRect` is undefined),
//   so a real highlight gesture cannot be simulated. The lookup UI reads its
//   selection via `doc.defaultView.getSelection()` and anchors the panel to
//   `selection.getRangeAt(0).getBoundingClientRect()`, and schedules the
//   auto-dismiss via `doc.defaultView.setTimeout`. We therefore install a
//   minimal fake `getSelection` (returning unmatched text + a stub range with a
//   rect) and capture `setTimeout`, then dispatch a real `mouseup` on the root.
//   That drives the module's OWN `handleSelection` → `query` (no match) →
//   empty-panel path exactly as a browser would, and lets us invoke the
//   captured dismiss callback deterministically instead of waiting on a clock.

import { describe, it, expect } from "../harness.js";
import { ensureDom } from "../dom.js";

import { renderError, renderBlock } from "../../src/renderer.js";
import { ContentLoadError } from "../../src/content-loader.js";
import { mountWidget, clearWidgetRegistry } from "../../src/widgets/registry.js";
import { installLookup } from "../../src/lookup/lookup-ui.js";
import { buildIndex } from "../../src/lookup/search-index.js";

// Install the DOM once before any case runs; `ensureDom` is memoized.
const dom = await ensureDom();

// The renderer and widget registry build DOM through the ambient `document`
// (and `renderError` uses `document.createTextNode`). Other test files in this
// shared Node process install their own minimal `document` stub on the global
// (e.g. renderer.test.js), and whichever file's top-level code ran last wins.
// To keep these cases deterministic regardless of file order, pin the ambient
// globals to this suite's real linkedom DOM right before each DOM-building
// case, and always build mount elements from that SAME document so a mount's
// children and parent come from one DOM implementation.
function useRealDom() {
  globalThis.document = dom.document;
  globalThis.window = dom.window;
  // A fresh mount element from the real DOM, attached to the body so that DOM
  // mutations run on a connected node (matching how boot renders into the live
  // app region, and avoiding detached-node quirks in the headless DOM).
  const mount = dom.document.createElement("div");
  dom.document.body.appendChild(mount);
  return mount;
}

/** True when `node.className` contains the given class token. */
function hasClass(node, cls) {
  return (
    node &&
    typeof node.className === "string" &&
    node.className.split(/\s+/).includes(cls)
  );
}

describe("error handling (Req 15)", () => {
  // =========================================================================
  // 15.1 / 15.5 — renderError produces a non-fatal inline error block naming
  // the affected file, and links to the Project Guide on a file:// block.
  // =========================================================================
  describe("renderError inline error block (15.1, 15.5)", () => {
    it("renders a .block.block--error naming the affected file (15.1)", () => {
      const mount = useRealDom();
      const error = new ContentLoadError({
        file: "content/pages/missing.json",
        kind: "fetch",
      });

      const block = renderError(error, mount);

      // A non-fatal inline block with the error class contract.
      expect(block).toBeTruthy();
      expect(hasClass(block, "block")).toBe(true);
      expect(hasClass(block, "block--error")).toBe(true);
      // It is appended to the mount (and nothing else is touched).
      expect(mount.children.length).toBe(1);
      expect(mount.children[0]).toBe(block);

      // The affected file is named in the block's text so a maintainer knows
      // which file to fix.
      expect(block.textContent.includes("content/pages/missing.json")).toBe(
        true,
      );
    });

    it("a file:// fetch block links to the Project Guide (15.5)", () => {
      const mount = useRealDom();
      const error = new ContentLoadError({
        file: "content/topics.json",
        kind: "fetch",
        isFileProtocolBlock: true,
      });

      const block = renderError(error, mount);

      expect(hasClass(block, "block--error")).toBe(true);
      // Still names the affected file.
      expect(block.textContent.includes("content/topics.json")).toBe(true);

      // And carries a link whose href references the Project Guide, since the
      // fix is to serve the folder rather than edit the file.
      const links = block.querySelectorAll("a");
      const guideLink = Array.from(links).find((a) =>
        (a.getAttribute("href") || "").includes("PROJECT_GUIDE.md"),
      );
      expect(guideLink).toBeTruthy();
    });

    it("the non-file:// error block has no Project Guide link (15.1)", () => {
      // The link is specific to the file:// case; an ordinary fetch/parse
      // failure names the file but does not surface the static-server tip.
      const mount = useRealDom();
      const error = new ContentLoadError({
        file: "content/pages/broken.json",
        kind: "parse",
      });

      const block = renderError(error, mount);
      const links = block.querySelectorAll("a");
      const guideLink = Array.from(links).find((a) =>
        (a.getAttribute("href") || "").includes("PROJECT_GUIDE.md"),
      );
      expect(guideLink).toBe(undefined);
    });
  });

  // =========================================================================
  // 15.2 — an unknown block type renders a visible placeholder naming the type
  // rather than halting rendering.
  // =========================================================================
  describe("unknown block type → placeholder (15.2)", () => {
    it("renderBlock of an unsupported type appends a naming placeholder", () => {
      const mount = useRealDom();

      // Must not throw on an unrecognized type.
      renderBlock({ type: "no-such-type" }, mount);

      expect(mount.children.length).toBe(1);
      const placeholder = mount.children[0];
      expect(hasClass(placeholder, "block")).toBe(true);
      expect(hasClass(placeholder, "block--placeholder")).toBe(true);
      // Names the offending type so the page JSON can be fixed.
      expect(placeholder.textContent).toBe("Unsupported block: no-such-type");
    });
  });

  // =========================================================================
  // 15.3 — an unregistered widget type renders a placeholder naming the type,
  // returns null, and leaves the container otherwise intact.
  // =========================================================================
  describe("unknown widget type → placeholder (15.3)", () => {
    it("mountWidget of an unregistered type returns null and names the type", () => {
      // A clean registry so "ghost" is definitely unregistered.
      clearWidgetRegistry();

      const container = dom.freshMount();
      // A pre-existing child the placeholder must not disturb (container stays
      // otherwise intact).
      const existing = dom.document.createElement("p");
      existing.textContent = "existing content";
      container.appendChild(existing);

      const instance = mountWidget({ type: "ghost" }, container);

      // No instance to drive or destroy for an unregistered type.
      expect(instance).toBe(null);

      // A visible placeholder naming the type was appended.
      const placeholder = container.querySelector(".widget-placeholder");
      expect(placeholder).toBeTruthy();
      expect(placeholder.textContent).toBe("Unsupported widget: ghost");

      // The pre-existing child is still present and untouched: the container is
      // otherwise intact (only the placeholder was added).
      expect(container.children.length).toBe(2);
      expect(container.children[0]).toBe(existing);
      expect(existing.textContent).toBe("existing content");
    });
  });

  // =========================================================================
  // 15.4 — a selection with no match shows a brief "No definition found" panel
  // that auto-dismisses.
  //
  // linkedom has no Selection API and no range geometry, so we install a
  // minimal fake selection (unmatched text + a stub range rect) and capture the
  // auto-dismiss timer, then dispatch a real `mouseup`. This drives the lookup
  // UI's own handler and the empty-panel path end to end; invoking the captured
  // timer callback exercises the auto-dismiss deterministically.
  // =========================================================================
  describe("lookup no-match → auto-dismissing empty panel (15.4)", () => {
    it("shows a .lookup-panel--empty 'No definition found' that auto-dismisses", () => {
      const { document, window } = dom;
      const view = document.defaultView;

      // A tiny index that deliberately does NOT contain the selected text, so
      // the exact walk misses and (the lazy, absent fuzzy fallback) yields no
      // candidate — the empty-panel path (15.4).
      const index = buildIndex([
        { term: "neuron", definition: "A single computational unit.", pageRef: null },
      ]);

      const root = document.createElement("div");
      root.textContent = "zzzznotaword appears here";
      document.body.appendChild(root);

      // --- Fake the selection the lookup UI reads (linkedom lacks it). -------
      const fakeRect = {
        left: 10, top: 20, bottom: 40, right: 60, width: 50, height: 20,
      };
      const fakeSelection = {
        toString() { return "zzzznotaword"; },
        rangeCount: 1,
        getRangeAt() {
          return { getBoundingClientRect() { return fakeRect; } };
        },
      };
      const realGetSelection = view.getSelection;
      view.getSelection = () => fakeSelection;

      // --- Capture the auto-dismiss timer so we can fire it deterministically.
      let captured = null;
      const realSetTimeout = view.setTimeout;
      const realClearTimeout = view.clearTimeout;
      view.setTimeout = (fn, ms) => {
        captured = { fn, ms };
        return 1;
      };
      view.clearTimeout = () => {};

      try {
        installLookup(index, root);

        // Complete a "selection": `mouseup` drives the module's handleSelection.
        root.dispatchEvent(new window.Event("mouseup"));

        // The single reusable panel is shown, flagged empty, with the message.
        const panel = document.body.querySelector(".lookup-panel");
        expect(panel).toBeTruthy();
        expect(hasClass(panel, "lookup-panel--empty")).toBe(true);
        expect(panel.textContent.includes("No definition found")).toBe(true);
        expect(panel.isConnected).toBe(true);

        // An auto-dismiss was scheduled (brief, bounded by the module's
        // dismiss constant), not left open indefinitely.
        expect(captured).toBeTruthy();
        expect(typeof captured.fn).toBe("function");
        expect(captured.ms > 0).toBe(true);

        // Firing the scheduled callback dismisses the panel (auto-dismiss).
        captured.fn();
        expect(document.body.querySelector(".lookup-panel")).toBe(null);
      } finally {
        // Restore the globals we patched so other tests are unaffected.
        view.getSelection = realGetSelection;
        view.setTimeout = realSetTimeout;
        view.clearTimeout = realClearTimeout;
        root.remove();
      }
    });
  });
});
