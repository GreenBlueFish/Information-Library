// src/widgets/sim-kit.js
//
// Shared building blocks for the simulation widget types (the computational
// cortical columns lessons: lif-neuron, stdp-explorer, spike-raster,
// sdr-overlap, temporal-memory, column-voting). It sits beside `plot.js` as a
// second shared primitive so every simulation widget builds its frame,
// controls, buttons, and SVG the same way and behaves like `parameter-plot`:
//
//   - `buildFrame`         the `.widget` card + optional `.widget__title`
//   - `buildControlPanel`  a `.widget__controls` row from a Widget_Spec's
//                          `params`, with the same defaults/validation contract
//                          as parameter-plot (Req 10.4–10.6): defaults reflected
//                          on first paint, out-of-range values rejected (last
//                          valid value kept, `.widget__control--invalid` +
//                          `.widget__control-error` shown)
//   - `buildActions`       a `.widget__actions` row of `.widget__button`s
//   - `buildReadout`       a polite live `.widget__readout` status line
//   - `svgEl`              create an SVG element with attributes
//   - `makeRng`            a small seeded PRNG so simulations are reproducible
//                          (and testable) rather than depending on Math.random
//   - `makeTicker`         a play/pause interval loop that `destroy()` can stop
//
// Nothing here hard-codes a color, font, or spacing value: every visual comes
// from the token-driven classes in `assets/css/alexandria.css` (§10 widgets,
// §10b simulation widgets). Like `plot.js`, this module is not a widget type
// and registers nothing.

/** The SVG namespace — SVG elements are not in the HTML namespace. */
export const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * @typedef {Object} ParamControl
 * @property {string} key
 * @property {string} label
 * @property {"range"|"number"|"select"} control
 * @property {number} [min]
 * @property {number} [max]
 * @property {number} [step]
 * @property {string[]} [options]
 * @property {number|string} default
 */

/**
 * Build the outer `.widget` card and its optional title, appended to
 * `container`.
 *
 * @param {HTMLElement} container
 * @param {{ title?: string }} spec
 * @returns {{ doc: Document, root: HTMLElement }}
 */
export function buildFrame(container, spec) {
  const doc = container.ownerDocument ?? document;
  const root = doc.createElement("div");
  root.className = "widget";
  if (spec && typeof spec.title === "string" && spec.title.length > 0) {
    const title = doc.createElement("h3");
    title.className = "widget__title";
    title.textContent = spec.title;
    root.appendChild(title);
  }
  container.appendChild(root);
  return { doc, root };
}

/**
 * Initial parameter state from each control's declared `default`. Numeric
 * controls coerce to numbers; selects keep the string.
 *
 * @param {ParamControl[]} params
 * @returns {Object<string, number|string>}
 */
export function defaultsFrom(params) {
  /** @type {Object<string, number|string>} */
  const state = {};
  for (const param of Array.isArray(params) ? params : []) {
    if (!param || typeof param.key !== "string") continue;
    state[param.key] =
      param.control === "select" ? String(param.default) : toNumber(param.default);
  }
  return state;
}

/**
 * Validate a candidate value against a control's declared range/options.
 *
 * @param {ParamControl} param
 * @param {unknown} raw
 * @returns {{ ok: true, value: number|string } | { ok: false, message: string }}
 */
export function validateParam(param, raw) {
  const name =
    typeof param.label === "string" && param.label.length > 0 ? param.label : param.key;
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
 * Build a `.widget__controls` row for `params` and append it to `parent`.
 *
 * `onChange(state, key)` runs after every accepted change (user input or
 * `update`). Rejected values never reach `state`.
 *
 * @param {Document} doc
 * @param {HTMLElement} parent
 * @param {ParamControl[]} params
 * @param {(state: Object<string, number|string>, key: string) => void} onChange
 * @returns {{
 *   state: Object<string, number|string>,
 *   update: (partial: Object) => boolean,
 *   destroy: () => void,
 * }} `update` applies a partial (validated like user input) and returns
 *   whether anything changed; it does NOT call `onChange`, so the caller can
 *   redraw once.
 */
export function buildControlPanel(doc, parent, params, onChange) {
  const list = Array.isArray(params) ? params : [];
  const state = defaultsFrom(list);
  /** @type {Map<string, { param: ParamControl, field: HTMLElement, input: HTMLInputElement|HTMLSelectElement, error: HTMLElement }>} */
  const controls = new Map();
  /** @type {Array<{ el: HTMLElement, handler: EventListener }>} */
  const listeners = [];

  const row = doc.createElement("div");
  row.className = "widget__controls";

  for (const param of list) {
    if (!param || typeof param.key !== "string" || param.key.length === 0) continue;
    const built = buildControl(doc, param);
    controls.set(param.key, built);
    row.appendChild(built.field);
    const handler = () => {
      const result = validateParam(param, built.input.value);
      if (result.ok) {
        state[param.key] = result.value;
        clearError(built);
        onChange(state, param.key);
      } else {
        reject(built, result.message);
      }
    };
    built.input.addEventListener("input", handler);
    listeners.push({ el: built.input, handler });
  }
  if (controls.size > 0) parent.appendChild(row);

  function reject(built, message) {
    setInputValue(built.input, state[built.param.key]);
    built.field.classList.add("widget__control--invalid");
    built.error.textContent = message;
    built.error.hidden = false;
  }

  return {
    state,
    update(partial) {
      if (!partial || typeof partial !== "object") return false;
      let changed = false;
      for (const key of Object.keys(partial)) {
        const built = controls.get(key);
        if (!built) {
          state[key] = partial[key];
          changed = true;
          continue;
        }
        const result = validateParam(built.param, partial[key]);
        if (result.ok) {
          state[key] = result.value;
          setInputValue(built.input, result.value);
          clearError(built);
          changed = true;
        } else {
          reject(built, result.message);
        }
      }
      return changed;
    },
    destroy() {
      for (const { el, handler } of listeners) el.removeEventListener("input", handler);
      listeners.length = 0;
    },
  };
}

/**
 * Build a `.widget__actions` row of buttons and append it to `parent`.
 *
 * @param {Document} doc
 * @param {HTMLElement} parent
 * @param {Array<{ label: string, onClick: () => void, secondary?: boolean }>} defs
 * @returns {{ buttons: HTMLButtonElement[], destroy: () => void }}
 */
export function buildActions(doc, parent, defs) {
  const row = doc.createElement("div");
  row.className = "widget__actions";
  /** @type {HTMLButtonElement[]} */
  const buttons = [];
  /** @type {Array<{ el: HTMLElement, handler: EventListener }>} */
  const listeners = [];
  for (const def of defs) {
    const button = /** @type {HTMLButtonElement} */ (doc.createElement("button"));
    button.type = "button";
    button.className = def.secondary
      ? "widget__button widget__button--secondary"
      : "widget__button";
    button.textContent = def.label;
    const handler = () => def.onClick();
    button.addEventListener("click", handler);
    listeners.push({ el: button, handler });
    buttons.push(button);
    row.appendChild(button);
  }
  parent.appendChild(row);
  return {
    buttons,
    destroy() {
      for (const { el, handler } of listeners) el.removeEventListener("click", handler);
      listeners.length = 0;
    },
  };
}

/**
 * A polite live-region status line (`.widget__readout`) for numeric results
 * and step-by-step narration, appended to `parent`.
 *
 * @param {Document} doc
 * @param {HTMLElement} parent
 * @returns {HTMLElement}
 */
export function buildReadout(doc, parent) {
  const el = doc.createElement("p");
  el.className = "widget__readout";
  el.setAttribute("aria-live", "polite");
  parent.appendChild(el);
  return el;
}

/**
 * Create an SVG element in `doc` with the given attributes. `class` is set as
 * an attribute (SVG elements have no writable `className` string).
 *
 * @param {Document} doc
 * @param {string} name
 * @param {Object<string, string|number>} [attrs]
 * @returns {SVGElement}
 */
export function svgEl(doc, name, attrs = {}) {
  const el = /** @type {SVGElement} */ (doc.createElementNS(SVG_NS, name));
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, typeof v === "number" ? String(Math.round(v * 10) / 10) : String(v));
  }
  return el;
}

/**
 * Create a responsive SVG canvas (`viewBox` in design units) inside a
 * `.widget__plot` host appended to `parent`.
 *
 * @param {Document} doc
 * @param {HTMLElement} parent
 * @param {number} width  viewBox width (design units)
 * @param {number} height viewBox height (design units)
 * @param {string} label  accessible name for the drawing
 * @returns {{ host: HTMLElement, svg: SVGElement, clear: () => void }}
 */
export function buildStage(doc, parent, width, height, label) {
  const host = doc.createElement("div");
  host.className = "widget__plot";
  const svg = svgEl(doc, "svg", {
    viewBox: `0 0 ${width} ${height}`,
    role: "img",
    preserveAspectRatio: "xMidYMid meet",
    "aria-label": label,
  });
  host.appendChild(svg);
  parent.appendChild(host);
  return {
    host,
    svg,
    clear() {
      while (svg.firstChild) svg.removeChild(svg.firstChild);
    },
  };
}

/**
 * A small, fast, seeded PRNG (mulberry32). Same seed → same sequence, so a
 * simulation redraws identically for identical parameters and tests are
 * deterministic.
 *
 * @param {number} seed
 * @returns {() => number} uniform in [0, 1)
 */
export function makeRng(seed) {
  let a = (Math.floor(Number(seed) || 0) >>> 0) || 0x9e3779b9;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Standard-normal sample from a uniform RNG (Box–Muller).
 * @param {() => number} rng
 * @returns {number}
 */
export function gaussian(rng) {
  let u = 0;
  while (u === 0) u = rng();
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * A play/pause loop around `setInterval`. `stop()` (and so the widget's
 * `destroy()`) always clears the timer, so no loop outlives its widget.
 *
 * @param {() => void} tick
 * @param {number} intervalMs
 * @returns {{ start: () => void, stop: () => void, toggle: () => boolean, running: () => boolean }}
 */
export function makeTicker(tick, intervalMs) {
  /** @type {ReturnType<typeof setInterval> | null} */
  let timer = null;
  const api = {
    start() {
      if (timer === null) timer = setInterval(tick, intervalMs);
    },
    stop() {
      if (timer !== null) clearInterval(timer);
      timer = null;
    },
    toggle() {
      if (timer === null) api.start();
      else api.stop();
      return timer !== null;
    },
    running() {
      return timer !== null;
    },
  };
  return api;
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                  */
/* -------------------------------------------------------------------------- */

function buildControl(doc, param) {
  const field = doc.createElement("label");
  field.className = "widget__control";

  const labelText = doc.createElement("span");
  labelText.className = "widget__control-label";
  labelText.textContent =
    typeof param.label === "string" && param.label.length > 0 ? param.label : param.key;
  field.appendChild(labelText);

  let input;
  if (param.control === "select") {
    input = doc.createElement("select");
    for (const opt of Array.isArray(param.options) ? param.options : []) {
      const option = doc.createElement("option");
      option.value = String(opt);
      option.textContent = String(opt);
      input.appendChild(option);
    }
  } else {
    input = doc.createElement("input");
    input.type = param.control === "range" ? "range" : "number";
    if (Number.isFinite(param.min)) input.min = String(param.min);
    if (Number.isFinite(param.max)) input.max = String(param.max);
    if (Number.isFinite(param.step)) input.step = String(param.step);
  }
  setInputValue(input, param.default);
  field.appendChild(input);

  const error = doc.createElement("span");
  error.className = "widget__control-error";
  error.setAttribute("role", "alert");
  error.hidden = true;
  field.appendChild(error);

  return { param, field, input, error };
}

/**
 * Set a control's displayed value. A `<select>` is set by marking the matching
 * option selected (works in every DOM, including minimal test DOMs where
 * `select.value` is read-only); inputs take `value` directly.
 * @param {HTMLInputElement|HTMLSelectElement} input
 * @param {number|string} value
 */
function setInputValue(input, value) {
  const v = String(value);
  if (input.tagName === "SELECT") {
    for (const option of Array.from(input.querySelectorAll("option"))) {
      if (option.value === v) option.setAttribute("selected", "");
      else option.removeAttribute("selected");
      option.selected = option.value === v;
    }
    return;
  }
  input.value = v;
}

function clearError(built) {
  built.field.classList.remove("widget__control--invalid");
  built.error.textContent = "";
  built.error.hidden = true;
}

function toNumber(v) {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "") return Number(v);
  return NaN;
}
