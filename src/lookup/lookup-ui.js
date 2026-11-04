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
//   #47 — when the term has several definitions, the panel shows one at a
//         time with Previous / "n of N" / Next buttons to cycle through them.
//   #matches — the panel shows the closest term first; when other terms are
//         close too (see `matches.js`), ArrowDown / ArrowUp (or the ▼ / ▲
//         buttons) step to the next and previous closest match, and Escape
//         closes the panel.
//   4.1 — normalize + query on a double-click or highlight (normalization is
//         done inside `query`; this module passes the raw selected text).
//   4.5 — a selection that normalizes to zero tokens shows no panel (`query`
//         returns null for it, and we also bail on an empty/collapsed string).
//   15.4 — no exact and no fuzzy match shows a brief "No definition found"
//         message that auto-dismisses (a minimal auto-dismiss lives here; the
//         full error-handling pass is task 10.2).

import { findMatches, STOPWORDS } from "./matches.js";
import { normalize } from "./trie.js";
import { fillDefinitionCard } from "./definition-card.js";

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
  cycle: "lookup-panel__cycle",
  cycleButton: "lookup-panel__cycle-button",
  cycleCount: "lookup-panel__cycle-count",
  matches: "lookup-panel__matches",
  matchButton: "lookup-panel__match-button",
  matchCount: "lookup-panel__match-count",
  matchHint: "lookup-panel__match-hint",
};

/** What the panel says about a match that is not an exact one. */
const KIND_LABEL = {
  fuzzy: "Approximate match",
  within: "Term in your selection",
  contains: "Related term",
  prefix: "Related term",
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
  /** The ranked matches for the current selection, and which one is shown. */
  /** @type {import("./matches.js").Match[]} */
  let matches = [];
  let matchIndex = 0;

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
    matches = [];
    matchIndex = 0;
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
   * Fill the reusable panel with match `i` of the current matches
   * (Requirements 8.1–8.3, 8.5). Always rebuilds the panel's children from
   * scratch so the prior contents are fully replaced (Requirement 8.4). All
   * text is set via `textContent`.
   *
   * @param {number} i Which match to show (clamped to the list).
   */
  function renderMatch(i) {
    if (matches.length === 0) return;
    matchIndex = Math.max(0, Math.min(matches.length - 1, i));
    const match = matches[matchIndex];

    const p = ensurePanel();
    p.classList.remove(CLASS.empty);
    p.replaceChildren();

    // Term heading (with its acronym, 8.3), definition (8.1) and the page
    // link (8.2), plus a control to cycle through the term's other
    // definitions when it has more than one. Following the link dismisses
    // the panel.
    fillDefinitionCard(doc, p, match.definitions, CLASS, () => hidePanel());

    // Say how a match other than an exact one relates to the selection (8.5).
    const label = KIND_LABEL[match.matchKind];
    if (label) {
      const kind = doc.createElement("span");
      kind.className = CLASS.fuzzy;
      kind.textContent = label;
      p.appendChild(kind);
    }

    // Step through the other close matches: ▲ / "Match n of N" / ▼.
    if (matches.length > 1) {
      const nav = doc.createElement("div");
      nav.className = CLASS.matches;
      nav.setAttribute("role", "group");
      nav.setAttribute("aria-label", "Other matches");

      const up = doc.createElement("button");
      up.className = CLASS.matchButton;
      up.setAttribute("type", "button");
      up.setAttribute("aria-label", "Previous match (Up arrow)");
      up.textContent = "▲";
      if (matchIndex === 0) up.disabled = true;
      up.addEventListener("click", () => renderMatch(matchIndex - 1));

      const count = doc.createElement("span");
      count.className = CLASS.matchCount;
      count.setAttribute("aria-live", "polite");
      count.textContent = `Match ${matchIndex + 1} of ${matches.length}`;

      const down = doc.createElement("button");
      down.className = CLASS.matchButton;
      down.setAttribute("type", "button");
      down.setAttribute("aria-label", "Next match (Down arrow)");
      down.textContent = "▼";
      if (matchIndex === matches.length - 1) down.disabled = true;
      down.addEventListener("click", () => renderMatch(matchIndex + 1));

      const hint = doc.createElement("span");
      hint.className = CLASS.matchHint;
      hint.textContent = "↑ ↓ keys";

      nav.append(up, count, down, hint);
      p.appendChild(nav);
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

    matches = findMatches(index, text);
    if (matches.length > 0) {
      renderMatch(0);
    } else if (normalize(text).every((w) => STOPWORDS.has(w.replace(/[^\p{L}\p{N}']/gu, "")))) {
      // Ordinary words such as "the" are not terms: show nothing at all.
      hidePanel();
      return;
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

  // While the panel shows matches, the arrow keys step through them and
  // Escape closes it. Keys typed into a form field are left alone.
  doc.addEventListener("keydown", (event) => {
    if (!panel || !panel.isConnected || matches.length === 0) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const tag = event.target && event.target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if (event.key === "Escape") {
      hidePanel();
      return;
    }
    let step = 0;
    if (event.key === "ArrowDown") step = 1;
    else if (event.key === "ArrowUp") step = -1;
    if (step === 0 || matches.length < 2) return;
    event.preventDefault();
    renderMatch(matchIndex + step);
  });
}
