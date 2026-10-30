// src/widgets/registry.js
//
// Widget Registry (design.md — Component 5).
//
// Declarative, reusable interactive lessons. A page JSON declares a widget by
// `type` + `params`; the registry maps that `type` to a mount function and
// standardizes the mount/update/destroy lifecycle so every widget behaves the
// same. Widget type modules self-register at import time via `registerWidget`;
// the renderer's `widget` block calls `mountWidget` rather than inlining any
// widget logic.
//
// Responsibilities (design.md):
//   - Keep a `type -> mountFn` map; unknown types render a visible, non-fatal
//     placeholder and mount nothing.
//   - Standardize the mount/update/destroy lifecycle so every widget behaves
//     the same.
//
// Requirements:
//   10.1 registering a type stores its mount function, replacing any prior
//        mapping for the same type
//   10.2 mounting a registered type mounts into the container and returns a
//        WidgetInstance
//   10.3 mounting an unregistered type mounts nothing, returns no instance, and
//        surfaces an error indication naming the type while leaving the
//        container otherwise intact
//   10.7 the returned WidgetInstance exposes `update`/`destroy` so a re-render
//        can tear down a prior instance before mounting its replacement
//   15.3 an unregistered widget type shows a visible placeholder rather than
//        halting rendering

/**
 * The declarative spec for one widget, as it appears inside a page's `widget`
 * block (design.md — Model 4: WidgetSpec).
 *
 * @typedef {Object} WidgetSpec
 * @property {string} type         Registered widget type ("parameter-plot").
 * @property {string} [title]      Human-readable widget title.
 * @property {Array<Object>} [params] User-manipulable parameter controls.
 * @property {Object} [config]     Type-specific static config.
 */

/**
 * Context handed to a widget's mount function (design.md — Component 5).
 *
 * @typedef {Object} WidgetContext
 * @property {HTMLElement} container The element the widget renders into.
 * @property {WidgetSpec} spec       The widget block's declarative spec.
 * @property {(state: Object) => void} [onState] Optional state-change callback.
 */

/**
 * A mounted widget's public lifecycle (design.md — Component 5). The registry
 * guarantees every widget exposes exactly these two operations so callers can
 * drive and tear down any widget uniformly.
 *
 * @typedef {Object} WidgetInstance
 * @property {(partial: Object) => void} update Apply new parameter values.
 * @property {() => void} destroy Tear down listeners/animation.
 */

/**
 * A widget mount function: given a {@link WidgetContext}, build the widget's
 * DOM inside `ctx.container` and return a {@link WidgetInstance}.
 *
 * @callback WidgetMountFn
 * @param {WidgetContext} ctx
 * @returns {WidgetInstance}
 */

/**
 * The `type -> mountFn` map. Module-scoped so registrations made by importing a
 * widget type module (which calls `registerWidget` at import time) are visible
 * to every `mountWidget` caller.
 *
 * @type {Map<string, WidgetMountFn>}
 */
const registry = new Map();

/**
 * Register a widget type's mount function.
 *
 * Registering a `type` that is already registered REPLACES the prior mapping,
 * so the most recent registration for a given type wins (Requirement 10.1).
 * This keeps registration idempotent and lets a type module be imported more
 * than once without stacking handlers.
 *
 * @param {string} type The widget type key (e.g. "parameter-plot").
 * @param {WidgetMountFn} mountFn Builds the widget and returns its instance.
 * @returns {void}
 * @throws {TypeError} If `type` is not a non-empty string or `mountFn` is not a
 *   function — surfacing a registration bug early rather than at mount time.
 */
export function registerWidget(type, mountFn) {
  if (typeof type !== "string" || type.length === 0) {
    throw new TypeError("registerWidget: `type` must be a non-empty string.");
  }
  if (typeof mountFn !== "function") {
    throw new TypeError(
      `registerWidget: mount function for "${type}" must be a function.`,
    );
  }
  // A plain Map.set replaces any prior mapping for the same key (Req 10.1).
  registry.set(type, mountFn);
}

/**
 * Whether a widget type has a registered mount function.
 * @param {string} type
 * @returns {boolean}
 */
export function hasWidget(type) {
  return registry.has(type);
}

/**
 * Optional sink notified of every {@link WidgetInstance} a `mountWidget` call
 * creates. This is the single chokepoint the boot wiring (task 11) uses to
 * COLLECT the widgets mounted during one `renderPage` pass so it can call
 * `destroy()` on the prior render's instances before re-rendering
 * (Requirement 10.7) — without changing `renderPage`'s signature or inlining
 * any lifecycle bookkeeping into the renderer.
 *
 * `renderWidgetBlock` (renderer.js) builds DOM top-to-bottom and does not
 * retain instances; routing every created instance through this sink keeps the
 * renderer a pure DOM builder while giving boot exactly the instances it must
 * tear down. Defaults to `null` (no-op) so nothing collects on the test and
 * standalone paths — existing behavior is unchanged.
 *
 * @type {((instance: WidgetInstance) => void) | null}
 */
let mountSink = null;

/**
 * Set (or clear) the sink that {@link mountWidget} reports each newly mounted
 * {@link WidgetInstance} to. Boot sets a per-render collector before calling
 * `renderPage` and clears it afterward; passing `null` clears the sink.
 *
 * @param {((instance: WidgetInstance) => void) | null} sink The collector to
 *   notify on each mount, or `null` to stop collecting.
 * @returns {void}
 */
export function setMountSink(sink) {
  mountSink = typeof sink === "function" ? sink : null;
}

/**
 * Mount a widget declared by `spec` into `container`.
 *
 * When `spec.type` is registered, the matching mount function is invoked with a
 * {@link WidgetContext} and its {@link WidgetInstance} is returned
 * (Requirement 10.2). When `spec.type` is NOT registered, no widget is mounted:
 * a visible, non-fatal placeholder naming the unregistered type is appended to
 * `container` (Requirements 10.3, 15.3) and `null` is returned so the caller
 * knows there is no instance to drive or destroy. In the unregistered case the
 * container is otherwise left intact — only the placeholder is added, nothing
 * existing is removed.
 *
 * @param {WidgetSpec} spec The widget block's declarative spec.
 * @param {HTMLElement} container The element to mount into.
 * @param {{ onState?: (state: Object) => void }} [options] Optional hooks
 *   forwarded to the widget via its {@link WidgetContext}.
 * @returns {WidgetInstance | null} The mounted instance, or `null` when the
 *   type is unregistered (placeholder shown instead).
 */
export function mountWidget(spec, container, options = {}) {
  const type = spec && typeof spec.type === "string" ? spec.type : "";
  const mountFn = type ? registry.get(type) : undefined;

  if (!mountFn) {
    // Unknown type: non-fatal. Name the offending type, mount nothing, and
    // leave the container otherwise intact (Req 10.3, 15.3).
    renderPlaceholder(container, type);
    return null;
  }

  /** @type {WidgetContext} */
  const ctx = {
    container,
    spec,
    onState: options.onState,
  };
  const instance = mountFn(ctx);

  // Report the mounted instance to the per-render sink, if boot installed one,
  // so the boot wiring can destroy this render's widgets before re-rendering
  // (Requirement 10.7). The sink is a no-op on the test/standalone paths.
  if (mountSink && instance) {
    mountSink(instance);
  }

  return instance;
}

/**
 * Append a visible placeholder element naming an unsupported widget type. Uses
 * the `.widget-placeholder` class documented in `assets/css/alexandria.css` and
 * `textContent` so the (untrusted) type string is shown as text, never parsed
 * as HTML.
 *
 * @param {HTMLElement} container
 * @param {string} type The unregistered type (may be empty if the spec had none).
 * @returns {void}
 */
function renderPlaceholder(container, type) {
  const label = type || "(missing type)";
  const el = (container.ownerDocument ?? document).createElement("div");
  el.className = "widget-placeholder";
  el.setAttribute("role", "note");
  el.textContent = `Unsupported widget: ${label}`;
  container.appendChild(el);
}

/**
 * Remove all registered widget types. Intended for tests that need a clean
 * registry; not used on the normal runtime path.
 * @returns {void}
 */
export function clearWidgetRegistry() {
  registry.clear();
}
