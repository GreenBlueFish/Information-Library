// src/widgets/types/parameter-plot.js
//
// The `parameter-plot` widget type (design.md — Component 5, "Example Usage").
//
// This is Alexandria's worked example of the declarative widget framework: a
// page JSON declares a `parameter-plot` widget with a `title`, a list of
// `params` (ParamControl) and a `config` object; this module builds a control
// panel from those params, keeps a parameter `state`, and draws a live plot of
// that state through the shared `makePlot` primitive. It is deliberately
// generic — the default `simulate` plots a family of curves driven by the
// current parameters so the widget is useful out of the box for any page that
// wants an interactive parameter explorer.
//
// Self-registration: importing this module calls `registerWidget` once, so the
// runtime's `main.js` only needs `import "./widgets/types/parameter-plot.js"`
// (design.md — Example Usage / Component 5). The renderer's `widget` block then
// mounts it through `mountWidget` like any other type.
//
// Lifecycle contract (design.md — Example Usage):
//   registerWidget("parameter-plot", (ctx) => {
//     const state = defaultsFrom(ctx.spec.params);
//     const plot  = makePlot(ctx.container);
//     function redraw() { plot.draw(simulate(ctx.spec.config, state)); }
//     redraw();
//     return {
//       update(partial) { Object.assign(state, partial); redraw(); },
//       destroy() { plot.dispose(); },
//     };
//   });
//
// Requirements:
//   10.4 reflect declared param defaults on first paint (within 100ms of the
//        mount call returning) — we initialize `state` from defaults and draw
//        once synchronously before returning the instance.
//   10.5 a control change to a value WITHIN the declared range applies the new
//        value and redraws the visualization to reflect current state.
//   10.6 a control change to a value OUTSIDE the declared range is rejected: we
//        retain the last valid value + the current visualization and surface an
//        error indication naming the invalid parameter (via the
//        `.widget__control--invalid` class + a `.widget__control-error` note).
//   10.7 the returned WidgetInstance exposes `update`/`destroy`; `destroy`
//        removes every listener this widget added AND calls the plot handle's
//        `dispose()` so no listener or animation surface leaks on re-render.

import { registerWidget } from "../registry.js";
import { makePlot } from "../plot.js";

/**
 * @typedef {import("../registry.js").WidgetContext} WidgetContext
 * @typedef {import("../registry.js").WidgetInstance} WidgetInstance
 * @typedef {import("../plot.js").PlotSeries} PlotSeries
 */

/**
 * One parameter control as declared in a widget's `params` (design.md —
 * Model 4: ParamControl).
 *
 * @typedef {Object} ParamControl
 * @property {string} key      Unique state field key for this control.
 * @property {string} label    Human-readable label shown above the control.
 * @property {"range"|"number"|"select"} control  Which input to render.
 * @property {number} [min]    Minimum allowed value (range/number).
 * @property {number} [max]    Maximum allowed value (range/number).
 * @property {number} [step]   Step granularity (range/number).
 * @property {number|string} default  Initial value reflected on first paint.
 * @property {string[]} [options]  Allowed values for a `select` control.
 */

/**
 * How many sample points to draw per series. Enough to render smooth curves at
 * the plot's design resolution without being wasteful.
 */
const SAMPLES = 120;

registerWidget("parameter-plot", (ctx) => mountParameterPlot(ctx));

/**
 * Build the parameter-plot widget inside `ctx.container` and return its
 * lifecycle handle.
 *
 * @param {WidgetContext} ctx
 * @returns {WidgetInstance}
 */
function mountParameterPlot(ctx) {
  const doc = ctx.container.ownerDocument ?? document;
  const spec = ctx.spec ?? {};
  const params = Array.isArray(spec.params) ? spec.params : [];
  const config = spec.config ?? {};

  // The parameter state, seeded from each control's declared default so the
  // first paint reflects the declared defaults (Req 10.4).
  const state = defaultsFrom(params);

  // Track which listeners we attach so `destroy` can detach exactly them —
  // nothing leaks across a re-render (Req 10.7).
  /** @type {Array<{ el: HTMLElement, type: string, handler: EventListener }>} */
  const listeners = [];

  // Per-control DOM handles, keyed by param key, so a rejected change can mark
  // the right control invalid and reset its input back to the last valid value.
  /** @type {Map<string, { field: HTMLElement, input: HTMLInputElement|HTMLSelectElement, error: HTMLElement }>} */
  const controls = new Map();

  // --- Build the widget frame (title + controls + plot host) ---------------
  const root = doc.createElement("div");
  root.className = "widget";

  if (typeof spec.title === "string" && spec.title.length > 0) {
    const title = doc.createElement("h3");
    title.className = "widget__title";
    title.textContent = spec.title;
    root.appendChild(title);
  }

  const controlsRow = doc.createElement("div");
  controlsRow.className = "widget__controls";
  for (const param of params) {
    const built = buildControl(doc, param);
    if (!built) continue;
    controls.set(param.key, built);
    controlsRow.appendChild(built.field);
    registerControlListener(param, built);
  }
  root.appendChild(controlsRow);

  const plotHost = doc.createElement("div");
  plotHost.className = "widget__plot";
  root.appendChild(plotHost);

  ctx.container.appendChild(root);

  // The shared plotting primitive draws into the plot host; it hard-codes no
  // color/styling (all token-driven) and is fully redrawable (Req 10.5, 12.6).
  const plot = makePlot(plotHost);

  /** Draw the plot from the CURRENT parameter state. */
  function redraw() {
    plot.draw(simulate(config, state, params));
  }

  // First paint: draw synchronously so the declared defaults are reflected
  // within 100ms of mount returning (Req 10.4).
  redraw();

  /**
   * Attach the change listener for one control. On a valid value we apply it to
   * state, clear any prior error, and redraw (Req 10.5). On an out-of-range
   * value we reject it: keep the last valid state/visualization and mark the
   * control invalid with a message naming the parameter (Req 10.6).
   *
   * @param {ParamControl} param
   * @param {{ field: HTMLElement, input: HTMLInputElement|HTMLSelectElement, error: HTMLElement }} built
   */
  function registerControlListener(param, built) {
    const handler = () => {
      const raw = built.input.value;
      const result = validate(param, raw);
      if (result.ok) {
        state[param.key] = result.value;
        clearError(built);
        redraw();
      } else {
        rejectChange(param, built, result.message);
      }
    };
    // `input` fires continuously for range/number (live) and on commit for
    // select; it covers every control type we render.
    built.input.addEventListener("input", handler);
    listeners.push({ el: built.input, type: "input", handler });
  }

  /**
   * Reject an out-of-range change: restore the input to the last valid value,
   * add the invalid class, and show an error naming the parameter (Req 10.6).
   * The plot is NOT redrawn, so the last valid visualization is retained.
   *
   * @param {ParamControl} param
   * @param {{ field: HTMLElement, input: HTMLInputElement|HTMLSelectElement, error: HTMLElement }} built
   * @param {string} message
   */
  function rejectChange(param, built, message) {
    built.input.value = String(state[param.key]);
    built.field.classList.add("widget__control--invalid");
    built.error.textContent = message;
    built.error.hidden = false;
  }

  return {
    /**
     * Apply new parameter values programmatically. Values are validated the
     * same way user changes are: in-range values are applied and the input is
     * synced; out-of-range values are rejected (state unchanged, error shown).
     * A redraw happens once at the end if anything changed (Req 10.5, 10.6).
     * @param {Object} partial
     */
    update(partial) {
      if (!partial || typeof partial !== "object") return;
      let changed = false;
      for (const key of Object.keys(partial)) {
        const built = controls.get(key);
        const param = params.find((p) => p.key === key);
        if (!param || !built) {
          // No such control: accept the raw value into state as-is.
          state[key] = partial[key];
          changed = true;
          continue;
        }
        const result = validate(param, partial[key]);
        if (result.ok) {
          state[key] = result.value;
          built.input.value = String(result.value);
          clearError(built);
          changed = true;
        } else {
          rejectChange(param, built, result.message);
        }
      }
      if (changed) redraw();
    },

    /**
     * Tear down the widget: detach every listener we added and dispose the plot
     * so its SVG/legend are removed and no rendering surface leaks. Leaves the
     * widget DOM for the caller to remove with the container (Req 10.7).
     */
    destroy() {
      for (const { el, type, handler } of listeners) {
        el.removeEventListener(type, handler);
      }
      listeners.length = 0;
      plot.dispose();
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Control construction                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Build one labeled control (`.widget__control`) with its input and a hidden
 * error slot, following the documented class contract in alexandria.css §10.
 *
 * @param {Document} doc
 * @param {ParamControl} param
 * @returns {{ field: HTMLElement, input: HTMLInputElement|HTMLSelectElement, error: HTMLElement } | null}
 */
function buildControl(doc, param) {
  if (!param || typeof param.key !== "string" || param.key.length === 0) {
    return null;
  }

  const field = doc.createElement("label");
  field.className = "widget__control";

  const labelText = doc.createElement("span");
  labelText.className = "widget__control-label";
  labelText.textContent =
    typeof param.label === "string" && param.label.length > 0
      ? param.label
      : param.key;
  field.appendChild(labelText);

  const input = buildInput(doc, param);
  field.appendChild(input);

  // Error slot — hidden until a rejected change surfaces a message (Req 10.6).
  const error = doc.createElement("span");
  error.className = "widget__control-error";
  error.setAttribute("role", "alert");
  error.hidden = true;
  field.appendChild(error);

  return { field, input, error };
}

/**
 * Build the input element for a control, seeded with the declared default.
 * Unknown control kinds fall back to a `number` input so a malformed spec still
 * renders something usable rather than throwing.
 *
 * @param {Document} doc
 * @param {ParamControl} param
 * @returns {HTMLInputElement|HTMLSelectElement}
 */
function buildInput(doc, param) {
  if (param.control === "select") {
    const select = doc.createElement("select");
    const options = Array.isArray(param.options) ? param.options : [];
    for (const opt of options) {
      const option = doc.createElement("option");
      option.value = String(opt);
      option.textContent = String(opt);
      select.appendChild(option);
    }
    select.value = String(param.default);
    return select;
  }

  const input = doc.createElement("input");
  input.type = param.control === "range" ? "range" : "number";
  if (Number.isFinite(param.min)) input.min = String(param.min);
  if (Number.isFinite(param.max)) input.max = String(param.max);
  if (Number.isFinite(param.step)) input.step = String(param.step);
  input.value = String(param.default);
  return input;
}

/* -------------------------------------------------------------------------- */
/* State + validation                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Build the initial parameter state from each control's declared `default`
 * (design.md — Example Usage `defaultsFrom`). Numeric controls coerce the
 * default to a number so downstream math is clean; selects keep the string.
 *
 * @param {ParamControl[]} params
 * @returns {Object<string, number|string>}
 */
function defaultsFrom(params) {
  /** @type {Object<string, number|string>} */
  const state = {};
  for (const param of params) {
    if (!param || typeof param.key !== "string") continue;
    state[param.key] =
      param.control === "select" ? String(param.default) : toNumber(param.default);
  }
  return state;
}

/**
 * Validate a candidate value for a control against its declared range/options.
 *
 * - range/number: must be a finite number within `[min, max]` (bounds applied
 *   only when declared). Out-of-range or non-numeric is rejected.
 * - select: must be one of the declared `options`.
 *
 * @param {ParamControl} param
 * @param {number|string} raw  The candidate value (string from an input, or a
 *   number/string from `update`).
 * @returns {{ ok: true, value: number|string } | { ok: false, message: string }}
 */
function validate(param, raw) {
  const name = typeof param.label === "string" && param.label.length > 0
    ? param.label
    : param.key;

  if (param.control === "select") {
    const options = Array.isArray(param.options) ? param.options.map(String) : [];
    const value = String(raw);
    if (!options.includes(value)) {
      return { ok: false, message: `${name}: "${value}" is not an allowed option.` };
    }
    return { ok: true, value };
  }

  const value = toNumber(raw);
  if (!Number.isFinite(value)) {
    return { ok: false, message: `${name}: "${raw}" is not a valid number.` };
  }
  if (Number.isFinite(param.min) && value < param.min) {
    return { ok: false, message: `${name}: must be at least ${param.min}.` };
  }
  if (Number.isFinite(param.max) && value > param.max) {
    return { ok: false, message: `${name}: must be at most ${param.max}.` };
  }
  return { ok: true, value };
}

/**
 * Clear a control's error indication after a valid change (Req 10.5/10.6).
 * @param {{ field: HTMLElement, error: HTMLElement }} built
 */
function clearError(built) {
  built.field.classList.remove("widget__control--invalid");
  built.error.textContent = "";
  built.error.hidden = true;
}

/**
 * Coerce a value to a number without surprises: numbers pass through, strings
 * are parsed, everything else becomes NaN (caught by validation).
 * @param {unknown} v
 * @returns {number}
 */
function toNumber(v) {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "") return Number(v);
  return NaN;
}

/* -------------------------------------------------------------------------- */
/* Simulation (generic worked example)                                        */
/* -------------------------------------------------------------------------- */

/**
 * Produce plot series from the widget's static `config` and current parameter
 * `state` (design.md — Example Usage `simulate`). Shape matches what
 * `plot.draw` expects: `PlotSeries[]` = `{ points: {x,y}[], label? }[]`.
 *
 * `parameter-plot` is a generic worked example, so the default simulation plots
 * a smooth curve `y = f(x)` over an x-range, shaped by whichever numeric
 * parameters the widget declares:
 *   - `amplitude` scales the curve's height (default 1),
 *   - `frequency` scales how many oscillations fit across the range (default 1),
 *   - `offset` shifts the curve vertically (default 0),
 *   - any other numeric params nudge the phase so every control visibly moves
 *     the plot.
 * When `config.series` lists labels (or `config.models` as in the SNN example
 * page), one curve is drawn per label, each phase-shifted so the series are
 * distinguishable.
 *
 * @param {Object} config  Widget static config.
 * @param {Object<string, number|string>} state  Current parameter state.
 * @param {ParamControl[]} params  Declared controls (used to find numeric keys).
 * @returns {PlotSeries[]}
 */
function simulate(config, state, params) {
  const amplitude = numericState(state, "amplitude", 1);
  const frequency = numericState(state, "frequency", 1);
  const offset = numericState(state, "offset", 0);

  // Phase accumulates every *other* numeric parameter so each extra control a
  // page declares still moves the plot (keeps the example genuinely reactive).
  let extraPhase = 0;
  for (const param of params ?? []) {
    if (!param || param.control === "select") continue;
    if (param.key === "amplitude" || param.key === "frequency" || param.key === "offset") {
      continue;
    }
    const v = numericState(state, param.key, 0);
    if (Number.isFinite(v)) extraPhase += v;
  }

  const labels = seriesLabels(config, state);
  const xMax = Math.PI * 2;

  return labels.map((label, index) => {
    const phase = extraPhase + (index * Math.PI) / Math.max(labels.length, 1);
    const points = [];
    for (let i = 0; i < SAMPLES; i++) {
      const x = (i / (SAMPLES - 1)) * xMax;
      const y = offset + amplitude * Math.sin(frequency * x + phase);
      points.push({ x, y });
    }
    return { points, label };
  });
}

/**
 * The series labels to draw. Prefer an explicit `config.series` list, then the
 * SNN example page's `config.models`, otherwise a single unlabeled curve. A
 * `select` parameter value, when present, is appended so changing the selected
 * model is reflected in the legend.
 *
 * @param {Object} config
 * @param {Object<string, number|string>} state
 * @returns {string[]}
 */
function seriesLabels(config, state) {
  const fromConfig =
    (Array.isArray(config.series) && config.series) ||
    (Array.isArray(config.models) && config.models) ||
    null;
  if (fromConfig && fromConfig.length > 0) {
    return fromConfig.map(String);
  }
  // Fall back to any selected value in state for a labeled single series.
  const selected = Object.values(state).find((v) => typeof v === "string");
  return [typeof selected === "string" ? selected : "f(x)"];
}

/**
 * Read a numeric field from state with a fallback when absent/non-numeric.
 * @param {Object<string, number|string>} state
 * @param {string} key
 * @param {number} fallback
 * @returns {number}
 */
function numericState(state, key, fallback) {
  const v = state[key];
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}
