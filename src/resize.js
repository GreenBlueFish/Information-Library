// src/resize.js
//
// Size controls for figures and simulations. Each `.block--figure` and
// `.block--widget` on a page gets a small toolbar: smaller (−), larger (+),
// expand to fill the window (⤢) and reset (↺). The width is a `data-size`
// attribute (a percentage of the content column, styled in alexandria.css),
// so no inline styles. Each block's choice is remembered in localStorage,
// keyed by its page file and its position on the page, so it survives a
// reload. Expanding is for this visit only; Esc or the button closes it.

export const SIZES = [40, 55, 70, 85, 100];
export const STORAGE_KEY = "alexandria-sizes";

function readAll(storage) {
  try {
    const raw = storage ? storage.getItem(STORAGE_KEY) : null;
    const data = raw ? JSON.parse(raw) : {};
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

function writeOne(storage, key, size) {
  try {
    const all = readAll(storage);
    if (size === 100) delete all[key];
    else all[key] = size;
    storage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // Storage refused (private mode): the size still applies for this visit.
  }
}

/** The saved size for a key, or 100. */
export function savedSize(key, storage = globalThis.localStorage) {
  const v = readAll(storage)[key];
  return SIZES.includes(v) ? v : 100;
}

/** The next size up or down from `size`, clamped to SIZES. */
export function stepSize(size, dir) {
  const i = SIZES.indexOf(size);
  const at = i === -1 ? SIZES.length - 1 : i;
  return SIZES[Math.max(0, Math.min(SIZES.length - 1, at + dir))];
}

function button(doc, cls, text, label) {
  const b = doc.createElement("button");
  b.type = "button";
  b.className = `size-controls__button ${cls}`;
  b.textContent = text;
  b.setAttribute("aria-label", label);
  b.title = label;
  return b;
}

/** @type {HTMLElement|null} The block currently expanded, if any. */
let expanded = null;

function setExpanded(block, on) {
  if (expanded && expanded !== block) setExpanded(expanded, false);
  const btn = block.querySelector(":scope > .size-controls .size-controls__expand");
  if (on) {
    block.setAttribute("data-expanded", "true");
    expanded = block;
  } else {
    block.removeAttribute("data-expanded");
    if (expanded === block) expanded = null;
  }
  if (btn) {
    btn.textContent = on ? "✕" : "⤢";
    btn.setAttribute("aria-label", on ? "Close the full-window view" : "Fill the window");
    btn.title = btn.getAttribute("aria-label");
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  }
}

let escInstalled = false;
function installEsc(doc) {
  if (escInstalled || !doc || typeof doc.addEventListener !== "function") return;
  escInstalled = true;
  doc.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && expanded) setExpanded(expanded, false);
  });
}

/**
 * Give every figure and simulation inside `pageEl` its size controls.
 * @param {HTMLElement} pageEl The rendered `.page`.
 * @param {string} pageKey Identifies the page (its page file).
 * @param {Storage} [storage]
 */
export function installResizers(pageEl, pageKey, storage = globalThis.localStorage) {
  if (!pageEl || typeof pageEl.querySelectorAll !== "function") return;
  const doc = pageEl.ownerDocument;
  installEsc(doc);
  if (expanded && !expanded.isConnected) expanded = null;
  const blocks = [...pageEl.querySelectorAll(".block--figure, .block--widget")];
  blocks.forEach((block, i) => {
    const kind = block.classList.contains("block--figure") ? "figure" : "widget";
    const key = `${pageKey}#${i}`;
    const what = kind === "figure" ? "image" : "simulation";
    const apply = (size) => {
      if (size === 100) block.removeAttribute("data-size");
      else block.setAttribute("data-size", String(size));
      smaller.disabled = size === SIZES[0];
      larger.disabled = size === 100;
      reset.disabled = size === 100;
    };
    const bar = doc.createElement("div");
    bar.className = "size-controls";
    bar.setAttribute("role", "group");
    bar.setAttribute("aria-label", `Size of this ${what}`);
    const smaller = button(doc, "size-controls__smaller", "−", `Make this ${what} smaller`);
    const larger = button(doc, "size-controls__larger", "+", `Make this ${what} larger`);
    const expand = button(doc, "size-controls__expand", "⤢", "Fill the window");
    expand.setAttribute("aria-pressed", "false");
    const reset = button(doc, "size-controls__reset", "↺", "Reset to the normal size");
    let size = savedSize(key, storage);
    const set = (s) => { size = s; apply(s); writeOne(storage, key, s); };
    smaller.addEventListener("click", () => set(stepSize(size, -1)));
    larger.addEventListener("click", () => set(stepSize(size, +1)));
    reset.addEventListener("click", () => set(100));
    expand.addEventListener("click", () => setExpanded(block, block.getAttribute("data-expanded") !== "true"));
    bar.append(smaller, larger, expand, reset);
    block.insertBefore(bar, block.firstChild);
    apply(size);
  });
}
