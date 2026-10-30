// src/lookup/lookup-ui.js
//
// Inline definition panel — the user-facing half of the lookup system
// (design.md — Component 4 "Lookup System", the `installLookup(index, rootEl)`
// formal spec, and the "Lookup interaction" sequence diagram).
//
// `installLookup(index, rootEl)` wires a page up so that double-clicking a word
// or highlighting a phrase anywhere under `rootEl` resolves the selection
// against the Search_Index (`query` from `./search-index.js`) and shows the
// definition in ONE reusable panel positioned directly below the selection.
//
// The whole UI is driven by a single panel element that is created on demand
// and reused — never more than one panel exists at a time, and resolving a new
// selection replaces whatever the panel last showed (Requirement 8.4). The
// panel's visual appearance lives entirely in `assets/css/alexandria.css` §9
// (the `.lookup-panel*` classes); this module only builds structure, fills text
// via `textContent` (never `innerHTML`, so a definition can never inject
// markup), and positions the panel.
//
// Requirements:
//   8.1 — resolve a selection to a Term_Entry and show the definition inline,
//         below the user's selection.
//   8.2 — when the entry has a non-null `pageRef`, show a link that navigates
//         to the referenced page (as a hash route).
//   8.3 — when the entry has an `acronym`, show it alongside the canonical term.
//   8.4 — at most one panel at a time; a new selection replaces the prior panel.
//   8.5 — when the result is a fuzzy match, indicate it is an approximate match.
//   4.1 — normalize + query on a double-click or highlight (normalization is
//         done inside `query`; this module passes the raw selected text).
//   4.5 — a selection that normalizes to zero tokens shows no panel (`query`
//         returns null for it, and we also bail on an empty/collapsed string).
//   15.4 — no exact and no fuzzy match shows a brief "No definition found"
//         message that auto-dismisses (a minimal auto-dismiss lives here; the
//         full error-handling pass is task 10.2).

import { query } from "./search-index.js";

/**
 * @typedef {import("./search-index.js").SearchIndex} SearchIndex
 * @typedef {import("./search-index.js").LookupResult} LookupResult
 */

/** CSS classes the panel structure uses (documented in alexandria.css §9). */
const CLASS = {
  panel: "lookup-panel",
  empty: "lookup-panel--empty",
  term: "lookup-panel__term",
  acronym: "lookup-panel__acronym",
  definition: "lookup-panel__definition",
  link: "lookup-panel__link",
  fuzzy: "lookup-panel__fuzzy",
};

/** How long the "No definition found" message lingers before auto-dismiss. */
const EMPTY_PANEL_DISMISS_MS = 1800;

/** Gap (px) between the bottom of the selection and the top of the panel. */
const PANEL_GAP_PX = 6;

/**
 * Install the lookup interaction on a page region.
 *
 * Attaches `dblclick` and `mouseup` listeners to `rootEl` so that completing a
 * selection (a double-click selects a word; a drag selects a phrase) triggers a
 * lookup. A single reusable panel element is created lazily on the first
 * resolved selection and reused thereafter, so at most one panel is ever shown
 * (Requirement 8.4). A `mousedown` inside the panel is ignored so clicking the
 * panel's link does not immediately dismiss it.
 *
 * Preconditions: `index` is a built `SearchIndex`; `rootEl` is attached to the
 * DOM. Side effects: DOM listeners added to `rootEl` and `document`; one panel
 * element appended to `document.body` when first needed.
 *
 * @param {SearchIndex} index The index built by `buildIndex`.
 * @param {HTMLElement} rootEl The page region to capture selections within.
 * @returns {void}
 */
export function installLookup(index, rootEl) {
  if (!index || !rootEl || typeof rootEl.addEventListener !== "function") return;

  const doc = rootEl.ownerDocument || document;

  /**
   * The single reusable panel. Created on first use, then reused/replaced on
   * every subsequent selection — this is what guarantees "at most one panel".
   * @type {HTMLElement|null}
   */
  let panel = null;
  /** Timer id for auto-dismissing the "No definition found" message. */
  let dismissTimer = 0;
  /** True while a pointer press started inside the panel (don't dismiss). */
  let pressInPanel = false;

  /** Ensure the reusable panel exists and is attached; return it. */
  function ensurePanel() {
    if (panel && panel.isConnected) return panel;
    panel = doc.createElement("div");
    panel.className = CLASS.panel;
    // A pointer press that begins inside the panel must not be treated as a
    // click-away dismissal (so the pageRef link stays clickable).
    panel.addEventListener("mousedown", () => {
      pressInPanel = true;
    });
    doc.body.appendChild(panel);
    return panel;
  }

  /** Remove the panel from view (teardown of the single reusable element). */
  function hidePanel() {
    if (dismissTimer) {
      clearTimeout(dismissTimer);
      dismissTimer = 0;
    }
    if (panel && panel.isConnected) {
      panel.remove();
    }
  }

  /**
   * Position the (already-populated) panel directly below a selection rect, in
   * document coordinates. `getBoundingClientRect` is viewport-relative, so we
   * add the current scroll offsets to place an absolutely-positioned panel.
   *
   * @param {DOMRect} rect The selection's bounding rect (viewport coords).
   */
  function positionPanel(rect) {
    if (!panel) return;
    const scrollX = doc.defaultView ? doc.defaultView.scrollX : 0;
    const scrollY = doc.defaultView ? doc.defaultView.scrollY : 0;
    panel.style.left = `${rect.left + scrollX}px`;
    panel.style.top = `${rect.bottom + scrollY + PANEL_GAP_PX}px`;
  }

  /**
   * Fill the reusable panel with a resolved result (Requirements 8.1–8.3, 8.5).
   * Always rebuilds the panel's children from scratch so the prior contents are
   * fully replaced (Requirement 8.4). All text is set via `textContent`.
   *
   * @param {LookupResult} result
   */
  function renderResult(result) {
    const p = ensurePanel();
    p.classList.remove(CLASS.empty);
    p.replaceChildren();

    // Term heading, with the acronym alongside it when present (8.3).
    const termEl = doc.createElement("p");
    termEl.className = CLASS.term;
    termEl.textContent = result.term;
    if (result.acronym) {
      const acr = doc.createElement("span");
      acr.className = CLASS.acronym;
      acr.textContent = ` (${result.acronym})`;
      termEl.appendChild(acr);
    }
    p.appendChild(termEl);

    // Definition (8.1).
    const defEl = doc.createElement("p");
    defEl.className = CLASS.definition;
    defEl.textContent = result.definition;
    p.appendChild(defEl);

    // Page link when the entry points at a page (8.2). The route is a hash
    // address so navigation stays client-side and never reloads the shell.
    if (result.pageRef) {
      const link = doc.createElement("a");
      link.className = CLASS.link;
      link.href = toHashHref(result.pageRef);
      link.textContent = "Open page";
      // Dismiss the panel once the user follows the link.
      link.addEventListener("click", () => hidePanel());
      p.appendChild(link);
    }

    // Approximate-match indicator for fuzzy results (8.5).
    if (result.matchKind === "fuzzy") {
      const fuzzy = doc.createElement("span");
      fuzzy.className = CLASS.fuzzy;
      fuzzy.textContent = "Approximate match";
      p.appendChild(fuzzy);
    }
  }

  /**
   * Show the brief "No definition found" message that auto-dismisses
   * (Requirement 15.4). Reuses the same single panel element, flagged empty.
   */
  function renderEmpty() {
    const p = ensurePanel();
    p.classList.add(CLASS.empty);
    p.replaceChildren();

    const msg = doc.createElement("p");
    msg.className = CLASS.definition;
    msg.textContent = "No definition found";
    p.appendChild(msg);

    if (dismissTimer) clearTimeout(dismissTimer);
    const view = doc.defaultView || globalThis;
    dismissTimer = view.setTimeout(() => {
      dismissTimer = 0;
      hidePanel();
    }, EMPTY_PANEL_DISMISS_MS);
  }

  /**
   * Handle a completed selection: read the selected text, query the index, and
   * show (or hide) the single panel accordingly.
   */
  function handleSelection() {
    const selection = doc.defaultView
      ? doc.defaultView.getSelection()
      : typeof getSelection === "function"
      ? getSelection()
      : null;
    if (!selection) return;

    const text = selection.toString();
    // An empty/whitespace selection is "no selection": don't query, don't show
    // a panel (Requirement 4.5). `query` also returns null for zero tokens, but
    // bailing here avoids flashing an empty panel on a stray click.
    if (!text || text.trim() === "") {
      hidePanel();
      return;
    }

    // The selection must have a geometry to anchor the panel to.
    if (selection.rangeCount === 0) return;
    const rect = selection.getRangeAt(0).getBoundingClientRect();

    /** @type {LookupResult|null} */
    const result = query(index, text);
    if (result) {
      renderResult(result);
    } else {
      renderEmpty();
    }
    positionPanel(rect);
  }

  // A double-click selects a word; `mouseup` covers drag-highlighting a phrase.
  rootEl.addEventListener("dblclick", handleSelection);
  rootEl.addEventListener("mouseup", handleSelection);

  // Click-away: a press that starts outside the panel dismisses it. We decide
  // on `mousedown` (recorded on the panel) and act on the following `mouseup`,
  // so a selection drag that ends on `mouseup` is handled by `handleSelection`
  // and a plain click elsewhere falls through to dismissal here.
  doc.addEventListener("mouseup", () => {
    if (pressInPanel) {
      pressInPanel = false;
      return;
    }
  });
  doc.addEventListener("mousedown", (event) => {
    // If the press is outside the current panel, dismiss it. `handleSelection`
    // (on `mouseup`) will re-show a panel if the gesture turns out to be a new
    // selection, so this only clears a truly stale panel.
    if (panel && panel.isConnected && !panel.contains(event.target)) {
      // Defer so a double-click that re-selects still resolves first.
      hidePanel();
    }
  });
}

/**
 * Turn a `pageRef` route into a hash href the client router understands. A ref
 * that already carries a leading `#` is used as-is; otherwise it becomes
 * `#<ref>` so `/snn/neuron-models` navigates to `#/snn/neuron-models`.
 *
 * @param {string} pageRef The entry's route (e.g. "/snn" or "#/snn").
 * @returns {string} A hash href for an anchor's `href`.
 */
function toHashHref(pageRef) {
  if (pageRef.startsWith("#")) return pageRef;
  return `#${pageRef}`;
}
