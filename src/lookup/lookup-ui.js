// src/lookup/lookup-ui.js
//
// Inline definition panel — the user-facing half of the lookup system
// (design.md — Components §4 "lookup-ui.js", the `installLookup(rootEl, options)`
// formal spec, and "The four runtime flows" Flow 3).
//
// `installLookup(rootEl, options)` wires a page up ONCE so that double-clicking
// a word or highlighting a phrase anywhere under `rootEl` resolves the
// selection against the current Scope_Chain's merged index and shows the
// definition in ONE reusable panel positioned directly below the selection.
//
// The panel is installed a single time on the persistent `#app` and returns an
// `{ update }` handle. `main.js` calls `update({ localIndex, loadGlobalIndex,
// scopeTitle })` on every route change: that only swaps the data the closure
// reads — no listener is ever re-attached, so at most one panel exists across
// navigations (R11.4, R11.6).
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
//   9.1/9.4 — zero local matches with a Search_All loader keeps the panel open
//         showing "No definition in <scopeTitle>" + the control and does NOT
//         auto-dismiss (`renderEmptyLocalWithSearchAll`).
//   9.2/9.3 — zero local matches with no loader (home, or a chain that covers
//         every glossary) shows the auto-dismissing empty message, gone after
//         EMPTY_PANEL_DISMISS_MS (`renderEmpty`).

import { findMatches, withoutShownDefinitions, MAX_MATCHES, STOPWORDS } from "./matches.js";
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
  source: "lookup-panel__source",
  searchAll: "lookup-panel__search-all",
  searchAllLoading: "lookup-panel__search-all--loading",
  searchAllDone: "lookup-panel__search-all--done",
  note: "lookup-panel__note",
  // A visually-muted live region that announces how many new definitions
  // Search_All surfaced (R8.7). `visually-hidden` keeps it off-screen but still
  // read by assistive tech; `lookup-panel__announce` is a hook for the panel.
  announce: "lookup-panel__announce visually-hidden",
  // One appended Search_All result row; focus moves to the first of these when
  // results arrive (R8.7).
  globalResult: "lookup-panel__global-result",
};

/** The idle label on the Search_All control (R7.1). */
const SEARCH_ALL_IDLE = "Search all";
/** The label while Search_All is loading (R7.6). */
const SEARCH_ALL_LOADING = "Searching all topics…";
/** The message when Search_All finds nothing outside the chain (R8.8). */
const SEARCH_ALL_EMPTY = "No other definitions found";
/** The note when some or all non-chain glossaries fail to load (R8.9, R8.10). */
const SEARCH_ALL_FAILED = "Some topics couldn't be searched";

/** How "Also defined in"/"from" results read above a Search_All result. */
const GLOBAL_LABEL = {
  /** A term that is new (not shown in Local_Results). */
  from: (title) => `from ${title}`,
  /** A term already shown locally, carrying only new definitions. */
  also: (title) => `Also defined in ${title}`,
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
 * The data the lookup closure reads for each selection. `update()` swaps these
 * values without touching any listener (Flow 3; R11.4).
 *
 * @typedef {Object} InstallOptions
 * @property {SearchIndex} localIndex The merged Scope_Chain index (R6.1).
 * @property {(null | ((selectionText: string) => Promise<{matches: import("./matches.js").Match[], failures: boolean}>))} [loadGlobalIndex]
 *   Loader for Search_All; `null` means no Search_All control (R7.7, R10.1).
 *   When non-null, the panel renders the Search_All row (idle/loading/results/
 *   empty/failure) as its last row (R7, R8).
 * @property {string} [scopeTitle] Current Top_Level_Topic title shown in the
 *   empty-local message "No definition in <scopeTitle>" (R9.1).
 */

/**
 * Install the lookup interaction ONCE on a persistent page region.
 *
 * Attaches `dblclick`/`mouseup` listeners to `rootEl` (and click-away/keyboard
 * listeners to `document`) so that completing a selection (a double-click
 * selects a word; a drag selects a phrase) triggers a lookup. A single reusable
 * panel element is created lazily on the first resolved selection and reused
 * thereafter, so at most one panel is ever shown (R8.4). A `mousedown` inside
 * the panel is ignored so clicking the panel's link does not immediately
 * dismiss it.
 *
 * Listeners are attached exactly once here. The returned `update(next)` only
 * stores the new `localIndex`/`loadGlobalIndex`/`scopeTitle` in the closure;
 * the next selection reads the updated data (R11.4). It never re-attaches a
 * listener.
 *
 * Preconditions: `rootEl` is attached to the DOM; `options.localIndex` is a
 * built `SearchIndex`. Side effects: DOM listeners added to `rootEl` and
 * `document`; one panel element appended to `document.body` when first needed.
 *
 * @param {HTMLElement} rootEl The persistent region to capture selections within.
 * @param {InstallOptions} options Initial lookup data.
 * @returns {{ update(next: InstallOptions): void }} Handle to re-point the data.
 */
export function installLookup(rootEl, options) {
  if (!rootEl || typeof rootEl.addEventListener !== "function") {
    // Nothing to install on; a no-op handle keeps callers simple.
    return { update() {} };
  }

  const doc = rootEl.ownerDocument || document;

  // The data the closure reads for each selection. Swapped by `update()`; never
  // read before a selection, so a missing initial `options` is tolerated.
  /** @type {SearchIndex|null} */
  let localIndex = options?.localIndex ?? null;
  /** @type {InstallOptions["loadGlobalIndex"]} */
  let loadGlobalIndex = options?.loadGlobalIndex ?? null;
  /** @type {string} */
  let scopeTitle = typeof options?.scopeTitle === "string" ? options.scopeTitle : "";

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

  /**
   * Per-selection Search_All state. Rebuilt from scratch on every selection so
   * results never carry over between lookups (R6.6).
   *
   * - `idle`    the button is shown and can run Search_All.
   * - `loading` Search_All is in flight; the button is disabled.
   * - `results` Search_All returned result rows (appended below the card).
   * - `done`    Search_All returned nothing new ("No other definitions found").
   * - `failed`  every non-chain glossary failed ("Some topics couldn't be
   *             searched"); no results.
   *
   * `searchAllResults` are the shaped global matches (deduped, ranked, capped).
   * `searchAllFailures` records a partial failure so a `results` state can also
   * show the "Some topics couldn't be searched" note (R8.9).
   */
  /** @type {"idle"|"loading"|"results"|"done"|"failed"} */
  let searchAllState = "idle";
  /** @type {import("./matches.js").Match[]} */
  let searchAllResults = [];
  /** Labels parallel to `searchAllResults`: "from <Topic>" / "Also defined in <Topic>". */
  /** @type {string[]} */
  let searchAllLabels = [];
  let searchAllFailures = false;
  /** Guards against re-entrant Search_All runs for the same selection. */
  let searchAllToken = 0;
  /** The raw selected text of the current lookup, passed to `loadGlobalIndex`. */
  let lastSelectionText = "";
  /**
   * The persistent `aria-live` region. Created once with the panel and kept
   * across `replaceChildren()` re-renders by re-appending it as the panel's
   * last child each render, so an assigned announcement survives the rebuild
   * (R8.7).
   * @type {HTMLElement|null}
   */
  let liveRegion = null;
  /**
   * One-shot announcement text set when Search_All results arrive; the next
   * render writes it into `liveRegion`. Cleared after it is written so a later
   * re-render (e.g. cycling matches) does not re-announce.
   * @type {string}
   */
  let pendingAnnouncement = "";
  /**
   * When true, the next render moves focus to the first appended Search_All
   * result row (R8.7). Cleared once focus has moved.
   */
  let pendingFocusFirstResult = false;
  /**
   * The idle Search_All `<button>` of the current render, so ArrowDown / the ▼
   * control from the last local match can move focus onto it (R7.3). Null when
   * the row is not an interactive button (loading / results / done / failed, or
   * no global loader).
   * @type {HTMLButtonElement|null}
   */
  let searchAllButton = null;

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
    // The live region lives alongside the panel's rebuilt content: it is a
    // single element, re-appended as the last child on every render so its
    // announcement is not lost to `replaceChildren()` (R8.7).
    liveRegion = doc.createElement("span");
    liveRegion.className = CLASS.announce;
    liveRegion.setAttribute("aria-live", "polite");
    liveRegion.setAttribute("role", "status");
    doc.body.appendChild(panel);
    return panel;
  }

  /**
   * Re-attach the persistent live region as the panel's last child (every
   * render replaces the panel's children, which would otherwise drop it) and
   * flush any one-shot Search_All announcement into it (R8.7).
   */
  function attachLiveRegion() {
    if (!panel || !liveRegion) return;
    panel.appendChild(liveRegion);
    if (pendingAnnouncement) {
      liveRegion.textContent = pendingAnnouncement;
      pendingAnnouncement = "";
    }
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
    resetSearchAll();
  }

  /** Clear all per-selection Search_All state (R6.6). */
  function resetSearchAll() {
    searchAllState = "idle";
    searchAllResults = [];
    searchAllLabels = [];
    searchAllFailures = false;
    searchAllToken++;
    pendingAnnouncement = "";
    pendingFocusFirstResult = false;
    if (liveRegion) liveRegion.textContent = "";
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
    if (matches.length === 0) {
      // No local match to show, but Search_All may need re-rendering (e.g. its
      // state advanced from loading to results). Re-draw the zero-local panel.
      if (loadGlobalIndex) renderEmptyLocalWithSearchAll();
      return;
    }
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

    // The Search_All control (or the results/notes it resolves to) is the
    // last row and is counted in the "n of N" total — so the nav total below
    // reflects the button/results too (R7.5).
    const extraRows = searchAllRowCount();
    const total = matches.length + extraRows;

    // Step through the other close matches: ▲ / "Match n of N" / ▼. The nav is
    // shown whenever there is more than one row to move between — that now
    // includes the Search_All row, so a lone local match with a Search_All
    // control still gets the counter.
    if (total > 1) {
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
      count.textContent = `Match ${matchIndex + 1} of ${total}`;

      const down = doc.createElement("button");
      down.className = CLASS.matchButton;
      down.setAttribute("type", "button");
      down.setAttribute("aria-label", "Next match (Down arrow)");
      down.textContent = "▼";
      // The ▼ control is disabled only at the very last row; with a Search_All
      // row present there is always somewhere below the last local match to go.
      if (matchIndex === matches.length - 1 && extraRows === 0) down.disabled = true;
      down.addEventListener("click", () => {
        // From the last local match, the ▼ control moves focus onto the
        // Search_All button (mirroring ArrowDown, R7.3) instead of cycling.
        // Otherwise it steps to the next local match.
        if (matchIndex === matches.length - 1 && searchAllButton) {
          searchAllButton.focus();
          return;
        }
        renderMatch(matchIndex + 1);
      });

      const hint = doc.createElement("span");
      hint.className = CLASS.matchHint;
      hint.textContent = "↑ ↓ keys";

      nav.append(up, count, down, hint);
      p.appendChild(nav);
    }

    // Append the Search_All row (button / results / notes) as the panel's last
    // row when a global loader is available for this route (R7.1, R7.7).
    renderSearchAllRow(p);

    // Keep the live region as the panel's last child and flush any pending
    // Search_All announcement (R8.7). Must come after `replaceChildren()`.
    attachLiveRegion();
  }

  /**
   * How many rows the Search_All region currently contributes to the "n of N"
   * count. Zero when there is no global loader (home / chain covers all).
   *   - idle/loading : the single button row.
   *   - results      : one row per appended global result.
   *   - done/failed  : the single non-interactive note row.
   */
  function searchAllRowCount() {
    if (!loadGlobalIndex) return 0;
    if (searchAllState === "results") return searchAllResults.length;
    return 1;
  }

  /**
   * Render the Search_All row at the end of panel `p`. Does nothing when there
   * is no global loader for this route (R7.7, R10.1). Which structure is built
   * depends on `searchAllState`:
   *
   *   idle     → a `<button class="lookup-panel__search-all">` "Search all"
   *   loading  → the same button, disabled, "Searching all topics…"
   *   results  → the shaped global matches as appended Definition_Cards, each
   *              carrying its "from <Topic>" / "Also defined in <Topic>" label,
   *              plus the "Some topics couldn't be searched" note on a partial
   *              failure (R8.9)
   *   done     → a non-interactive "No other definitions found" row (R8.8)
   *   failed   → a non-interactive "Some topics couldn't be searched" note
   *              (R8.10)
   *
   * Focus movement, the `aria-live` announcement, and ArrowDown wiring onto the
   * row are task 8.3; this builds the structure those will drive.
   *
   * @param {HTMLElement} p The panel element to append into.
   */
  function renderSearchAllRow(p) {
    // Each render rebuilds the row from scratch, so the button reference from a
    // prior render is stale; clear it and re-capture below if this render draws
    // the idle button.
    searchAllButton = null;
    if (!loadGlobalIndex) return;

    if (searchAllState === "idle" || searchAllState === "loading") {
      const button = doc.createElement("button");
      button.className = CLASS.searchAll;
      button.setAttribute("type", "button");
      if (searchAllState === "loading") {
        button.classList.add(CLASS.searchAllLoading);
        button.textContent = SEARCH_ALL_LOADING;
        button.disabled = true;
        button.setAttribute("aria-disabled", "true");
      } else {
        button.textContent = SEARCH_ALL_IDLE;
        // Enter / Space on a focused `<button>` fire a native `click`, so a
        // single click handler covers both the pointer click and the keyboard
        // activation the design calls out (R7.4).
        button.addEventListener("click", () => {
          runSearchAll();
        });
        // Expose the idle button so ArrowDown / the ▼ control from the last
        // local match can move focus onto it (R7.3).
        searchAllButton = button;
      }
      p.appendChild(button);
      return;
    }

    if (searchAllState === "results") {
      // Append one Definition_Card per shaped global result, each with its
      // source label as the first line of the row (R8.2, R8.4).
      /** @type {HTMLElement|null} */
      let firstResultRow = null;
      searchAllResults.forEach((match, i) => {
        const row = doc.createElement("div");
        row.classList.add(CLASS.globalResult);
        // Make each result row programmatically focusable so focus can land on
        // the first new result when Search_All resolves (R8.7). `-1` keeps it
        // out of the sequential Tab order while still `focus()`-able.
        row.setAttribute("tabindex", "-1");
        if (i === 0) firstResultRow = row;

        // The row-level label is the authoritative "from <Topic>" / "Also
        // defined in <Topic>" text for this result (R8.2, R8.4); task 8.3 moves
        // focus to the first such row.
        const label = doc.createElement("p");
        label.className = CLASS.source;
        label.textContent = searchAllLabels[i] ?? "";
        row.appendChild(label);

        // Build the card without its own per-definition source line so the row
        // label is not duplicated (for an "Also defined in" row the card's own
        // "from <Topic>" line would also contradict the row label). Stripping
        // `source` from the card's definitions makes the card omit that line.
        const defsNoSource = match.definitions.map((d) => {
          const { source: _drop, ...rest } = d;
          return rest;
        });
        fillDefinitionCard(doc, row, defsNoSource, CLASS, () => hidePanel());
        p.appendChild(row);
      });
      if (searchAllFailures) {
        p.appendChild(makeNote(SEARCH_ALL_FAILED));
      }
      // When Search_All has just resolved, move focus to the first new result
      // row (R8.7). Deferred flags are cleared so a later re-render (cycling
      // local matches) does not yank focus again.
      if (pendingFocusFirstResult && firstResultRow) {
        pendingFocusFirstResult = false;
        firstResultRow.focus();
      }
      return;
    }

    if (searchAllState === "done") {
      const done = doc.createElement("p");
      done.className = CLASS.searchAllDone;
      done.textContent = SEARCH_ALL_EMPTY;
      p.appendChild(done);
      return;
    }

    if (searchAllState === "failed") {
      p.appendChild(makeNote(SEARCH_ALL_FAILED));
      return;
    }
  }

  /** A muted "Some topics couldn't be searched" note row. */
  function makeNote(text) {
    const note = doc.createElement("p");
    note.className = CLASS.note;
    note.textContent = text;
    return note;
  }

  /**
   * The definitions already visible in Local_Results, collected from the
   * current matches so Search_All can drop any `(term, definition)` already
   * shown (R8.4, R8.5).
   *
   * @returns {import("./search-index.js").Definition[]}
   */
  function shownLocalDefinitions() {
    const out = [];
    for (const m of matches) {
      if (m && Array.isArray(m.definitions)) out.push(...m.definitions);
    }
    return out;
  }

  /**
   * The set of term keys shown in Local_Results, used to decide whether a
   * surviving global term reads "from <Topic>" (new term) or "Also defined in
   * <Topic>" (term already shown locally, carrying new definitions) (R8.2,
   * R8.4).
   *
   * @returns {Set<string>}
   */
  function shownLocalTermKeys() {
    const keys = new Set();
    for (const d of shownLocalDefinitions()) {
      const t = normalize(typeof d?.term === "string" ? d.term : "").join(" ");
      if (t) keys.add(t);
    }
    return keys;
  }

  /**
   * Shape the raw global matches into the rows the panel appends (R8.2–R8.6):
   *   - drop every definition already shown locally (`withoutShownDefinitions`);
   *   - split each surviving match into one row per source topic so each row
   *     carries a single "from <Topic>" / "Also defined in <Topic>" label;
   *   - dedupe identical `(term, definition)` to one row, keeping the first in
   *     scope-exclusion order (the order `loadGlobalIndex` returns them in);
   *   - order by Find_Matches rank, then Scope_Title ascending;
   *   - cap the NEW rows at `MAX_MATCHES` (the local cap is untouched).
   *
   * @param {import("./matches.js").Match[]} globalMatches
   * @returns {{ results: import("./matches.js").Match[], labels: string[] }}
   */
  function shapeGlobalResults(globalMatches) {
    const filtered = withoutShownDefinitions(globalMatches, shownLocalDefinitions());
    const localTerms = shownLocalTermKeys();

    // Build one row per (term, Scope_Title), preserving the input order as the
    // scope-exclusion order; `rank` is the match's position in the global
    // result list so equal-rank rows fall back to Scope_Title ascending.
    /** @type {Map<string, {match: import("./matches.js").Match, title: string, rank: number, already: boolean}>} */
    const rows = new Map();
    /** @type {Set<string>} */
    const seenPairs = new Set();

    filtered.forEach((match, rank) => {
      const termKey = normalize(typeof match.term === "string" ? match.term : "").join(" ");
      const already = localTerms.has(termKey);
      // Group this match's surviving definitions by their source topic so each
      // topic becomes its own labeled row.
      /** @type {Map<string, {title: string, defs: import("./search-index.js").Definition[]}>} */
      const byTopic = new Map();
      for (const d of match.definitions) {
        const pairKey = `${termKey}\u0000${(typeof d?.definition === "string" ? d.definition : "")
          .trim()
          .toLowerCase()}`;
        // Dedupe identical (term, definition): keep the first in scope-exclusion
        // order (first glossary that produced it).
        if (seenPairs.has(pairKey)) continue;
        seenPairs.add(pairKey);
        const title = d?.source?.title ?? "";
        const bucket = byTopic.get(title);
        if (bucket) bucket.defs.push(d);
        else byTopic.set(title, { title, defs: [d] });
      }
      for (const { title, defs } of byTopic.values()) {
        if (defs.length === 0) continue;
        const rowKey = `${termKey}\u0000${title}`;
        if (rows.has(rowKey)) {
          rows.get(rowKey).match.definitions.push(...defs);
          continue;
        }
        rows.set(rowKey, {
          match: { term: match.term, matchKind: match.matchKind, definitions: defs },
          title,
          rank,
          already,
        });
      }
    });

    // Order by Find_Matches rank, then Scope_Title ascending (R8.2).
    const ordered = [...rows.values()].sort(
      (a, b) => a.rank - b.rank || a.title.localeCompare(b.title),
    );

    // Cap the NEW rows at MAX_MATCHES without touching the local cap (R8.6).
    const capped = ordered.slice(0, MAX_MATCHES);
    const results = capped.map((r) => r.match);
    const labels = capped.map((r) =>
      r.already ? GLOBAL_LABEL.also(r.title) : GLOBAL_LABEL.from(r.title),
    );
    return { results, labels };
  }

  /**
   * Run Search_All for the current selection: go to the loading state, call
   * `loadGlobalIndex(text)`, then resolve to results / empty / partial-failure
   * / all-failed. Never throws into the page — a rejected loader is treated as
   * all-failed (R8.9, R8.10). Focus move + `aria-live` announcement are task
   * 8.3; this leaves the panel in the right state and re-renders.
   */
  function runSearchAll() {
    if (!loadGlobalIndex || searchAllState !== "idle") return;
    const text = lastSelectionText;
    const token = ++searchAllToken;

    searchAllState = "loading";
    renderMatch(matchIndex);

    Promise.resolve()
      .then(() => loadGlobalIndex(text))
      .then(
        (outcome) => {
          // A stale run (the selection changed, or Search_All was reset) is
          // dropped silently.
          if (token !== searchAllToken) return;
          const globalMatches = Array.isArray(outcome?.matches) ? outcome.matches : [];
          const failures = outcome?.failures === true;
          const { results, labels } = shapeGlobalResults(globalMatches);

          if (results.length > 0) {
            searchAllResults = results;
            searchAllLabels = labels;
            searchAllFailures = failures;
            searchAllState = "results";
            // Request the focus move + count announcement the next render
            // performs: focus lands on the first new result row, and the live
            // region announces N = the number of new rows retained (R8.7).
            const n = results.length;
            pendingFocusFirstResult = true;
            pendingAnnouncement =
              n === 1 ? "1 more definition found" : `${n} more definitions found`;
          } else if (failures) {
            // Nothing loaded (all failed, or the ones that did had nothing new
            // yet still reported a failure): show the all-failed note (R8.10).
            searchAllState = "failed";
          } else {
            // Loaded cleanly but found nothing new (R8.8).
            searchAllState = "done";
          }
          renderMatch(matchIndex);
        },
        () => {
          // A rejected loader is treated as all-failed; never propagated (R8.9,
          // R8.10).
          if (token !== searchAllToken) return;
          searchAllState = "failed";
          renderMatch(matchIndex);
        },
      );
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
   * Zero local matches but a non-null `loadGlobalIndex`: keep the panel open
   * with "No definition in <scopeTitle>" and the Search_All control, and do NOT
   * auto-dismiss (R9.1, R9.4). No dismiss timer is armed. The Search_All row is
   * appended as the panel's last row by `renderSearchAllRow`, so it also drives
   * the loading/results/empty/failure states on this zero-local panel.
   */
  function renderEmptyLocalWithSearchAll() {
    // Cancel any pending auto-dismiss from a prior empty panel.
    if (dismissTimer) {
      clearTimeout(dismissTimer);
      dismissTimer = 0;
    }
    const p = ensurePanel();
    p.classList.add(CLASS.empty);
    p.replaceChildren();

    const where = scopeTitle ? `No definition in ${scopeTitle}` : "No definition found";
    const msg = doc.createElement("p");
    msg.className = CLASS.definition;
    msg.textContent = where;
    p.appendChild(msg);

    renderSearchAllRow(p);

    // Keep the live region as the panel's last child and flush any pending
    // Search_All announcement (R8.7).
    attachLiveRegion();
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

    // No data to resolve against yet (installed before the first `update`).
    if (!localIndex) {
      hidePanel();
      return;
    }

    // The selection must have a geometry to anchor the panel to.
    if (selection.rangeCount === 0) return;
    const rect = selection.getRangeAt(0).getBoundingClientRect();

    // A new selection rebuilds the panel from scratch; prior Search_All results
    // never carry over (R6.6).
    resetSearchAll();
    lastSelectionText = text;

    matches = findMatches(localIndex, text);
    if (matches.length > 0) {
      renderMatch(0);
    } else if (normalize(text).every((w) => STOPWORDS.has(w.replace(/[^\p{L}\p{N}']/gu, "")))) {
      // Ordinary words such as "the" are not terms: show nothing at all, and no
      // Search_All button (R6.5).
      hidePanel();
      return;
    } else if (loadGlobalIndex) {
      // Zero local matches but there is somewhere else to look (the Scope_Chain
      // does not cover every Glossary_File): keep the panel open with the
      // "No definition in <scopeTitle>" message and the Search_All control, and
      // do NOT auto-dismiss (R9.1, R9.4).
      renderEmptyLocalWithSearchAll();
    } else {
      // Zero local matches and nowhere else to look — the home page (no
      // Search_All, R10.1) or a Scope_Chain that already covers every
      // Glossary_File: show the auto-dismissing empty message, gone after
      // EMPTY_PANEL_DISMISS_MS (R9.2, R9.3).
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
    if (step === 0) return;

    // ArrowDown from the LAST local match moves focus onto the Search_All
    // button rather than cycling, so the control is keyboard-reachable from the
    // results (R7.3). The ▼ control wires the same move on click (below). When
    // there is no button (no loader, or Search_All already resolved) this falls
    // through to ordinary cycling.
    if (step === 1 && matchIndex === matches.length - 1 && searchAllButton) {
      event.preventDefault();
      searchAllButton.focus();
      return;
    }

    if (matches.length < 2) return;
    event.preventDefault();
    renderMatch(matchIndex + step);
  });

  /**
   * Re-point the lookup data without re-installing anything. Stores the new
   * `localIndex`/`loadGlobalIndex`/`scopeTitle`; the next selection reads them
   * (R11.4). No listener is attached and nothing is re-rendered here — a stale
   * panel from the previous route is left for the next selection or click-away
   * to replace/dismiss.
   *
   * @param {InstallOptions} next
   */
  function update(next) {
    if (!next) return;
    if (next.localIndex !== undefined) localIndex = next.localIndex;
    if (next.loadGlobalIndex !== undefined) loadGlobalIndex = next.loadGlobalIndex;
    if (typeof next.scopeTitle === "string") scopeTitle = next.scopeTitle;
  }

  return { update };
}
