// tests/src/widgets/registry.test.js
//
// Unit tests for the Widget Registry (src/widgets/registry.js) — task 6.4.
//
// Covers the registry half of the task:
//   10.1 registering a type stores its mount function; a SECOND register for
//        the same type REPLACES the prior mapping (last registration wins).
//   10.2 mounting a REGISTERED type mounts into the container and returns a
//        WidgetInstance whose `update`/`destroy` actually work.
//   10.3 mounting an UNREGISTERED type renders a visible `.widget-placeholder`
//        naming the type, returns null, and leaves the container otherwise
//        intact (pre-existing children are untouched).
//
// DOM setup (no build step, no install):
//   The registry and the widgets it mounts build DOM through the `document`
//   global (`createElement`, `classList`, events, …). We reuse the suite's
//   shared `ensureDom()` helper (tests/dom.js), which installs a real DOM
//   (linkedom, loaded as an ES module from a CDN — see tests/README.md) on the
//   globals the modules read. Using a real DOM rather than a bespoke stub keeps
//   these assertions honest about real DOM semantics.

import { describe, it, expect } from "../../harness.js";
import { ensureDom } from "../../dom.js";
import {
  registerWidget,
  mountWidget,
  hasWidget,
  clearWidgetRegistry,
} from "../../../src/widgets/registry.js";

// Install the DOM once before any case runs; `ensureDom` is memoized.
const dom = await ensureDom();

describe("widgets/registry", () => {
  it("registerWidget stores a type -> mountFn mapping (10.1)", () => {
    clearWidgetRegistry();
    expect(hasWidget("demo")).toBe(false);

    registerWidget("demo", () => ({ update() {}, destroy() {} }));

    expect(hasWidget("demo")).toBe(true);
  });

  it("a second register for the same type REPLACES the prior mapping (10.1)", () => {
    clearWidgetRegistry();

    const calls = [];
    registerWidget("demo", () => {
      calls.push("first");
      return { update() {}, destroy() {} };
    });
    // Re-register the SAME type: the most recent registration must win, and the
    // old mount function must NOT be invoked (no stacking of handlers).
    registerWidget("demo", () => {
      calls.push("second");
      return { update() {}, destroy() {} };
    });

    const container = dom.freshMount();
    mountWidget({ type: "demo" }, container);

    expect(calls).toEqual(["second"]);
  });

  it("mountWidget on a registered type mounts into the container and returns a WidgetInstance (10.2)", () => {
    clearWidgetRegistry();

    let received = null;
    registerWidget("demo", (ctx) => {
      received = ctx;
      const el = ctx.container.ownerDocument.createElement("p");
      el.className = "demo-body";
      el.textContent = "mounted";
      ctx.container.appendChild(el);
      return { update() {}, destroy() {} };
    });

    const container = dom.freshMount();
    const spec = { type: "demo", title: "Demo" };
    const instance = mountWidget(spec, container);

    // An instance was returned (not null) with the lifecycle surface.
    expect(instance === null).toBe(false);
    expect(typeof instance.update).toBe("function");
    expect(typeof instance.destroy).toBe("function");

    // The mount function was handed a context carrying the container + spec.
    expect(received.container).toBe(container);
    expect(received.spec).toBe(spec);

    // The widget actually rendered into the container.
    expect(container.querySelector(".demo-body") === null).toBe(false);
    expect(container.querySelector(".demo-body").textContent).toBe("mounted");
  });

  it("mountWidget returns an instance whose update/destroy drive the mounted widget (10.2)", () => {
    clearWidgetRegistry();

    // A tiny stand-in widget whose update/destroy have observable effects, so
    // we assert the RETURNED instance is wired to this widget (not a stub).
    registerWidget("counter", (ctx) => {
      const out = ctx.container.ownerDocument.createElement("span");
      out.className = "count";
      out.textContent = "0";
      ctx.container.appendChild(out);
      let destroyed = false;
      return {
        update(partial) {
          if (destroyed) return;
          out.textContent = String(partial.value);
        },
        destroy() {
          destroyed = true;
          out.remove();
        },
      };
    });

    const container = dom.freshMount();
    const instance = mountWidget({ type: "counter" }, container);

    expect(container.querySelector(".count").textContent).toBe("0");

    // update() reaches the live widget.
    instance.update({ value: 42 });
    expect(container.querySelector(".count").textContent).toBe("42");

    // destroy() tears the widget down.
    instance.destroy();
    expect(container.querySelector(".count")).toBe(null);
  });

  it("mountWidget on an UNregistered type renders a visible placeholder naming the type, returns null, leaves the container intact (10.3)", () => {
    clearWidgetRegistry();

    const container = dom.freshMount();
    // Pre-existing content that must survive the placeholder path untouched.
    const prior = container.ownerDocument.createElement("p");
    prior.className = "pre-existing";
    prior.textContent = "keep me";
    container.appendChild(prior);

    const instance = mountWidget({ type: "nonexistent-widget" }, container);

    // No instance is returned for an unknown type.
    expect(instance).toBe(null);

    // A visible, non-fatal placeholder was appended, naming the offending type.
    const placeholder = container.querySelector(".widget-placeholder");
    expect(placeholder === null).toBe(false);
    expect(placeholder.textContent.includes("nonexistent-widget")).toBe(true);

    // The container is otherwise intact: the pre-existing child is still there.
    const kept = container.querySelector(".pre-existing");
    expect(kept === null).toBe(false);
    expect(kept.textContent).toBe("keep me");
  });

  it("mountWidget with a missing type still shows a non-fatal placeholder and returns null (10.3)", () => {
    clearWidgetRegistry();

    const container = dom.freshMount();
    const instance = mountWidget({}, container);

    expect(instance).toBe(null);
    const placeholder = container.querySelector(".widget-placeholder");
    expect(placeholder === null).toBe(false);
    // No real type to name, but the placeholder is still rendered visibly.
    expect(placeholder.textContent.length > 0).toBe(true);
  });
});
