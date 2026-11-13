// src/resize.js
//
// Size controls for figures and simulations. Each `.block--figure` and
// `.block--widget` on a page is wrapped in a full-width `.sizable` holding a
// toolbar and the block: smaller (−), larger (+), fill the window (⤢) and
// reset (↺). The toolbar sits at the top right of the full-width wrapper, so
// it stays put while the block under it changes size. A handle at the block's
// bottom-right corner resizes it by dragging. The width is the `--size`
// custom property (a percentage of the content column, with `data-sized` set
// below 100%), styled in alexandria.css; a resized block is centred. Each
// block's size is remembered in localStorage, keyed by its page file and its
// position on the page. Filling the window is for this visit only; ✕ or Esc
// closes it.
//
// Figures also get `--ratio` (the image's width / height) once the image has
// loaded, so the image box hugs the picture when its height is capped, and no
// band of figure background shows beside it.

export const SIZES = [25, 40, 55, 70, 85, 100];
export const MIN_SIZE = 20;
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
    if (size >= 100) delete all[key];
    else all[key] = size;
    storage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // Storage refused (private mode): the size still applies for this visit.
  }
}

/** Clamp a size to [MIN_SIZE, 100], whole percent. */
export function clampSize(size) {
  const n = Math.round(Number(size));
  if (!Number.isFinite(n)) return 100;
  return Math.max(MIN_SIZE, Math.min(100, n));
}

/** The saved size for a key, or 100. */
export function savedSize(key, storage = globalThis.localStorage) {
  const v = readAll(storage)[key];
  return typeof v === "number" ? clampSize(v) : 100;
}

/** The next step size above (dir +1) or below (dir -1) `size`. */
export function stepSize(size, dir) {
  if (dir > 0) return SIZES.find((s) => s > size) ?? 100;
  return [...SIZES].reverse().find((s) => s < size) ?? Math.min(size, SIZES[0]);
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

/** @type {HTMLElement|null} The wrapper currently filling the window, if any. */
let expanded = null;

function setExpanded(wrap, on) {
  if (on && expanded && expanded !== wrap) setExpanded(expanded, false);
  const btn = wrap.querySelector(":scope > .size-controls .size-controls__expand");
  if (on) {
    wrap.setAttribute("data-expanded", "true");
    expanded = wrap;
  } else {
    wrap.removeAttribute("data-expanded");
    if (expanded === wrap) expanded = null;
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

/** Give a figure's image its aspect ratio once it is known. */
function trackRatio(block) {
  const img = block.querySelector(".figure__image");
  if (!img) return;
  const set = () => {
    if (img.naturalWidth > 0 && img.naturalHeight > 0) {
      img.style.setProperty("--ratio", String(img.naturalWidth / img.naturalHeight));
    }
  };
  if (img.complete) set();
  img.addEventListener("load", set);
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
    if (kind === "figure") trackRatio(block);

    const wrap = doc.createElement("div");
    wrap.className = `sizable sizable--${kind}`;
    block.parentNode.insertBefore(wrap, block);

    const bar = doc.createElement("div");
    bar.className = "size-controls";
    bar.setAttribute("role", "group");
    bar.setAttribute("aria-label", `Size of this ${what}`);
    const smaller = button(doc, "size-controls__smaller", "−", `Make this ${what} smaller`);
    const larger = button(doc, "size-controls__larger", "+", `Make this ${what} larger`);
    const expand = button(doc, "size-controls__expand", "⤢", "Fill the window");
    expand.setAttribute("aria-pressed", "false");
    const reset = button(doc, "size-controls__reset", "↺", "Reset to the normal size");
    bar.append(smaller, larger, expand, reset);

    const handle = doc.createElement("div");
    handle.className = "size-handle";
    handle.setAttribute("aria-hidden", "true");
    handle.title = `Drag to resize this ${what}`;
    block.appendChild(handle);

    wrap.append(bar, block);

    let size = savedSize(key, storage);
    const apply = (s) => {
      if (s >= 100) {
        block.removeAttribute("data-sized");
        block.style.removeProperty("--size");
      } else {
        block.setAttribute("data-sized", "");
        block.style.setProperty("--size", `${s}%`);
      }
      smaller.disabled = s <= SIZES[0];
      larger.disabled = s >= 100;
      reset.disabled = s >= 100;
    };
    const set = (s, save = true) => {
      size = clampSize(s);
      apply(size);
      if (save) writeOne(storage, key, size);
    };
    smaller.addEventListener("click", () => set(stepSize(size, -1)));
    larger.addEventListener("click", () => set(stepSize(size, +1)));
    reset.addEventListener("click", () => set(100));
    expand.addEventListener("click", () => setExpanded(wrap, wrap.getAttribute("data-expanded") !== "true"));

    // Drag the corner: the block is centred, so it grows by twice the drag.
    handle.addEventListener("pointerdown", (e) => {
      if (wrap.getAttribute("data-expanded") === "true") return;
      const full = wrap.getBoundingClientRect().width;
      if (!(full > 0)) return;
      e.preventDefault();
      const startX = e.clientX;
      const startW = block.getBoundingClientRect().width;
      if (typeof handle.setPointerCapture === "function" && e.pointerId !== undefined) {
        try { handle.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
      }
      block.setAttribute("data-dragging", "");
      const move = (ev) => set(((startW + 2 * (ev.clientX - startX)) / full) * 100, false);
      const up = () => {
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", up);
        handle.removeEventListener("pointercancel", up);
        block.removeAttribute("data-dragging");
        writeOne(storage, key, size);
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", up);
      handle.addEventListener("pointercancel", up);
    });

    apply(size);
  });
}
