// src/home.js
//
// Home behavior module (home-topic-browse — design Component 5). This is the
// behavior half of the Home_Page: `renderHome` in `src/renderer.js` builds the
// home DOM (the search control + a grid of collapsible topic cards) and then
// hands the freshly built `.home` element to `installHome(homeEl, tree)`, which
// attaches the live-filter and per-card expand/collapse listeners.
//
// It mirrors the `installLookup` pattern (`src/lookup/lookup-ui.js`): a small
// module that wires listeners onto an already-rendered region, owns no global
// state, and is safe to call once per render. Because the home DOM is rebuilt
// on every home render and this module only attaches listeners to the nodes it
// is handed, there is no listener accumulation across navigations — the old
// nodes (and their listeners) are discarded when `#app` is cleared.
//
// Every `querySelector` result is guarded so a degenerate home (missing search
// control, grid, or cards) still wires what exists and never throws (design.md
// Error Handling: "No DOM for behavior").
//
// Requirements:
//   1.3 — changing the Lookup_Query updates visible cards without a page reload
//         (the form's `submit` is prevented, and filtering runs on `input`).
//   2.3 — activating a toggle on a collapsed card reveals its subtopics.
//   2.4 — activating a toggle on an expanded card collapses its subtopics.
//   2.6 — the toggle exposes its expanded/collapsed state via `aria-expanded`.
//   2.7 — a toggle changes only its own card, leaving every other card's state
//         unchanged.
//
// The full live-filter logic lives in `applyFilter`: empty-query shows all and
// clears the status (R1.2, R1.7), non-empty queries keep a card visible IFF the
// normalized query is a substring of its title or a subtopic (R1.4, R1.5), the
// "No matching topics." status shows IFF nothing is visible (R1.6), and a card
// matched only via a subtopic is expanded with its matching children flagged
// `.home-card__child--match` (R2.8).

import { normalizeTitle } from "./renderer.js";
import { findTerms } from "./lookup/search-index.js";
import { fillDefinitionCard } from "./lookup/definition-card.js";

/**
 * @typedef {import("./renderer.js").TopicNode} TopicNode
 * @typedef {import("./content-loader.js").TermEntry} TermEntry
 */

/** CSS classes for one term result; the card parts match `definition-card.js`. */
const TERM_CLASS = {
  item: "home-term",
  term: "home-term__term",
  acronym: "home-term__acronym",
  definition: "home-term__definition",
  link: "home-term__link",
  cycle: "home-term__cycle",
  cycleButton: "home-term__cycle-button",
  cycleCount: "home-term__cycle-count",
};

/**
 * Wire behavior onto an already-built Home_Page element (Requirements 1.3, 2.3,
 * 2.4, 2.6, 2.7). Called by `renderHome` at the end of the build with the fresh
 * `.home` element and the root topic tree.
 *
 * What it wires:
 *   - prevents the `.home-search` form's `submit` so pressing Enter in the
 *     search field never reloads the page (R1.3);
 *   - one `click` listener per `.home-card__toggle` that flips that card's
 *     `aria-expanded` and toggles its children list's `hidden`, touching only
 *     that card (R2.3, R2.4, R2.6, R2.7);
 *   - one `input` listener on the `.home-search__input` that runs the live
 *     filter over the cards (R1.3) and lists the glossary terms the text
 *     names in the `.home-terms` section (issue #47).
 *
 * Every lookup is guarded: a home missing its search control, grid, or cards
 * still wires whatever is present and never throws (design.md Error Handling).
 *
 * @param {HTMLElement} homeEl The `.home` element built by `renderHome`.
 * @param {TopicNode|null} [tree] The root topic tree (reserved for the filter).
 * @param {TermEntry[]} [terms] The lookup table, searched for term results.
 * @returns {void}
 */
export function installHome(homeEl, tree, terms = []) {
  if (!homeEl) return;

  const input = homeEl.querySelector(".home-search__input");
  const status = homeEl.querySelector(".home-search__status");
  const cards = [...homeEl.querySelectorAll(".home-card")];
  const termResults = homeEl.querySelector(".home-terms");

  // Prevent the search form from submitting/reloading the page (R1.3). The
  // filter runs live on `input`, so a submit never needs to do anything.
  const form = homeEl.querySelector(".home-search");
  if (form) {
    form.addEventListener("submit", (event) => event.preventDefault());
  }

  // Per-card expand/collapse. One listener per toggle; each flips only its own
  // card's state (R2.3, R2.4, R2.6, R2.7). Cards without children have no
  // toggle, so they are simply skipped (R2.5 is enforced at build time).
  for (const card of cards) {
    const toggle = card.querySelector(".home-card__toggle");
    if (toggle) {
      toggle.addEventListener("click", () => toggleCard(card));
    }
  }

  // Live filter: re-run on every keystroke so the visible set updates without a
  // page reload (R1.3). Full match/status logic lives in `applyFilter`.
  if (input) {
    input.addEventListener("input", () => {
      applyFilter(input.value, cards, status);
      const termCount = showTermResults(input.value, terms, termResults);
      // No topic matched but some terms did: point at the term results rather
      // than saying the search found nothing (PR #52 review).
      if (status && !status.hidden && termCount > 0) {
        status.textContent = "No matching topics. Matching terms are listed below.";
      }
    });
  }
}

/**
 * Expand or collapse a single Topic_Card (Requirements 2.3, 2.4, 2.6, 2.7).
 * Flips the card's `.home-card__toggle` `aria-expanded` and toggles the `hidden`
 * attribute on that card's `.home-card__children` list, so the two stay in sync.
 * It reads and writes only elements inside the given `card`, so activating one
 * card's toggle never changes any other card's state (R2.7). Both lookups are
 * guarded: a card missing its toggle or children list is left untouched.
 *
 * @param {HTMLElement} card The `.home-card` list item to toggle.
 * @returns {void}
 */
export function toggleCard(card) {
  if (!card) return;

  const toggle = card.querySelector(".home-card__toggle");
  const children = card.querySelector(".home-card__children");
  if (!toggle || !children) return;

  const expanded = toggle.getAttribute("aria-expanded") === "true";
  const next = !expanded;
  toggle.setAttribute("aria-expanded", String(next));
  children.hidden = !next;
}

/**
 * Apply the live Topic_Lookup filter over the Home_Page cards (Requirements
 * 1.2, 1.4, 1.5, 1.6, 1.7, 2.8). The query is normalized (trimmed, lowercased)
 * the same way titles are via {@link normalizeTitle}, so matching and ordering
 * agree.
 *
 * - An empty or whitespace-only query shows every card, clears/hides the status
 *   region, and clears any lingering subtopic-match marks (R1.2, R1.7).
 * - Otherwise a card is visible when the normalized query is a substring of the
 *   card's `data-title` or of any of its child subtopics' `data-title`; every
 *   other card is hidden via the `hidden` attribute, so no node is removed and
 *   clearing the query restores the full set (R1.4, R1.5, R1.7).
 * - WHEN a card is visible only because a subtopic matched (not its own title),
 *   the card is expanded and each matching `<li>` is flagged with
 *   `.home-card__child--match` so the learner can see why it matched (R2.8);
 *   those marks are cleared on any card that no longer matches via subtopic.
 * - The `.home-search__status` region shows "No matching topics." if and only
 *   if no card is visible (R1.6).
 *
 * @param {string} query The raw Lookup_Query text.
 * @param {HTMLElement[]} cards The `.home-card` elements to filter.
 * @param {HTMLElement|null} [status] The `.home-search__status` region.
 * @returns {void}
 */
export function applyFilter(query, cards, status) {
  const list = Array.isArray(cards) ? cards : [];
  const q = (query ?? "").trim().toLowerCase();

  // Empty/whitespace query: show everything, clear any stale subtopic-match
  // marks, and hide the status (R1.2, R1.7). Manual expand state is left alone.
  if (q === "") {
    for (const card of list) {
      card.hidden = false;
      clearMatchMarks(card);
    }
    if (status) {
      status.textContent = "";
      status.hidden = true;
    }
    return;
  }

  let anyVisible = false;

  for (const card of list) {
    const titleHit = (card.dataset.title ?? "").includes(q);
    const subHits = [...card.querySelectorAll(".home-card__child")].filter((child) =>
      (child.dataset.title ?? "").includes(q),
    );

    const visible = titleHit || subHits.length > 0; // R1.4, R1.5
    card.hidden = !visible;
    if (visible) anyVisible = true;

    // R2.8 — the card matched only via a subtopic: reveal the reason it matched
    // by expanding it and flagging the matching children. Otherwise strip any
    // leftover marks (and never force-collapse a title hit — leave the learner's
    // manual expand state alone).
    if (visible && !titleHit && subHits.length > 0) {
      expandCard(card);
      clearMatchMarks(card);
      for (const li of subHits) addMatchMark(li);
    } else {
      clearMatchMarks(card);
    }
  }

  // R1.6 — the "No matching topics." status shows IFF nothing is visible.
  if (status) {
    status.hidden = anyVisible;
    status.textContent = anyVisible ? "" : "No matching topics.";
  }
}

/**
 * Expand a single Topic_Card so its Subtopic_Entries are visible (Requirement
 * 2.8 reveal). Sets the card's `.home-card__toggle` `aria-expanded="true"` and
 * clears the `hidden` attribute on its `.home-card__children` list. Both lookups
 * are guarded, so a card without a toggle or children list is left untouched.
 *
 * Unlike {@link toggleCard}, this never collapses — it only ever expands — so a
 * subtopic match can reveal the card without disturbing a card the learner has
 * already expanded.
 *
 * @param {HTMLElement} card The `.home-card` to expand.
 * @returns {void}
 */
function expandCard(card) {
  if (!card) return;
  const toggle = card.querySelector(".home-card__toggle");
  if (toggle) toggle.setAttribute("aria-expanded", "true");
  const children = card.querySelector(".home-card__children");
  if (children) children.hidden = false;
}

/**
 * Add the `.home-card__child--match` modifier to a matching subtopic `<li>`
 * (Requirement 2.8). Prefers `classList` and falls back to safe `className`
 * string manipulation when `classList` is unavailable (e.g. a minimal DOM stub).
 *
 * @param {HTMLElement} li The `.home-card__child` list item to mark.
 * @returns {void}
 */
function addMatchMark(li) {
  if (!li) return;
  if (li.classList) {
    li.classList.add("home-card__child--match");
    return;
  }
  const classes = (li.className ?? "").split(/\s+/).filter(Boolean);
  if (!classes.includes("home-card__child--match")) {
    classes.push("home-card__child--match");
    li.className = classes.join(" ");
  }
}

/**
 * Remove the `.home-card__child--match` modifier from every subtopic `<li>` on
 * a card so stale marks never persist across queries (Requirement 2.8). Prefers
 * `classList` and falls back to safe `className` string manipulation.
 *
 * @param {HTMLElement} card The `.home-card` whose child marks to clear.
 * @returns {void}
 */
function clearMatchMarks(card) {
  if (!card) return;
  for (const li of card.querySelectorAll(".home-card__child")) {
    if (li.classList) {
      li.classList.remove("home-card__child--match");
    } else {
      const classes = (li.className ?? "")
        .split(/\s+/)
        .filter(Boolean)
        .filter((c) => c !== "home-card__child--match");
      li.className = classes.join(" ");
    }
  }
}

/**
 * List the glossary terms a search text names (issue #47): every entry in
 * `terms` whose term, alias or acronym contains the normalized text, best
 * matches first (see `findTerms`). Each result shows one definition at a time;
 * a term defined more than once gets Previous / "n of N" / Next buttons to
 * cycle through its definitions. The section is hidden when nothing matches or
 * the text is empty, and rebuilt from scratch on every call.
 *
 * @param {string} query The raw search text.
 * @param {TermEntry[]} terms The lookup table.
 * @param {HTMLElement|null} section The `.home-terms` section.
 * @returns {number} How many terms are listed (0 when nothing is shown).
 */
export function showTermResults(query, terms, section) {
  if (!section) return 0;
  const list = section.querySelector(".home-terms__list");
  if (!list) return 0;

  const results = findTerms(terms, query ?? "");
  list.replaceChildren();
  section.hidden = results.length === 0;

  const doc = section.ownerDocument;
  for (const result of results) {
    const item = doc.createElement("li");
    item.className = TERM_CLASS.item;
    fillDefinitionCard(doc, item, result.definitions, TERM_CLASS);
    list.appendChild(item);
  }
  return results.length;
}
