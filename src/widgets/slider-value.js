// src/widgets/slider-value.js
//
// A number beside every slider, so the reader can see the value they are
// setting. Both control builders (sim-kit.js and the parameter-plot widget)
// call `attachValueReadout` for each range control. The readout is an
// `<output>` appended to the control's label; CSS puts it on the label's row,
// at the right. It follows the slider as it moves, and builders call
// `refreshValueReadout` after setting a slider's value in code (reset, update).
//
// The number is shown with as many decimals as the slider's step has, so a
// step of 0.05 shows 1.25 and a step of 5 shows 90.

/** Decimals in a step: 0.05 → 2, 0.0005 → 4, 5 → 0. Missing/"any" → 2. */
export function decimalsFor(step) {
  const s = Number(step);
  if (!Number.isFinite(s) || s <= 0) return 2;
  const text = String(step).toLowerCase();
  const exp = text.match(/e-(\d+)$/);
  if (exp) return Math.min(10, Number(exp[1]));
  const dot = text.indexOf(".");
  return dot === -1 ? 0 : Math.min(10, text.length - dot - 1);
}

/** Format a slider value for display at the step's precision. */
export function formatValue(value, step) {
  const v = Number(value);
  if (!Number.isFinite(v)) return String(value ?? "");
  const text = v.toFixed(decimalsFor(step));
  // Avoid "-0" / "-0.00" when a value rounds to zero.
  return /^-0(\.0+)?$/.test(text) ? text.slice(1) : text.replace(/^-/, "−");
}

/**
 * Add a value readout to a range control. Does nothing for other controls.
 * @param {Document} doc
 * @param {HTMLElement} field The `.widget__control` label.
 * @param {HTMLInputElement|HTMLSelectElement} input
 * @param {{control?: string, step?: number}} param
 * @returns {HTMLOutputElement|null}
 */
export function attachValueReadout(doc, field, input, param) {
  if (!field || !input || !param || param.control !== "range") return null;
  const out = doc.createElement("output");
  out.className = "widget__control-value";
  // The slider already reports its value to assistive technology.
  out.setAttribute("aria-hidden", "true");
  const show = () => {
    out.textContent = formatValue(input.value, param.step);
  };
  input.addEventListener("input", show);
  input.addEventListener("change", show);
  readouts.set(input, show);
  field.classList.add("widget__control--range");
  field.appendChild(out);
  show();
  return out;
}

/** @type {WeakMap<object, () => void>} */
const readouts = new WeakMap();

/** Update a slider's readout after its value was set in code. */
export function refreshValueReadout(input) {
  const show = input ? readouts.get(input) : undefined;
  if (show) show();
}
