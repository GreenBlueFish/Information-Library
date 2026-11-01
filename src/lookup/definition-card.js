// src/lookup/definition-card.js
//
// One term's definitions, shown one at a time with a control to cycle through
// them. Used by the inline lookup panel (`lookup-ui.js`) and by the home page's
// term results (`home.js`), so a term defined more than once in `terms.json`
// reads the same way in both places.
//
// The card fills a container the caller owns: the term heading (with its
// acronym when present), the definition, an "Open page" link when the
// definition has a `pageRef`, and, only when there is more than one
// definition, a "Previous" / "n of N" / "Next" control. Cycling wraps around
// and updates the same nodes in place, so a focused button keeps focus. All
// text is set with `textContent`, never parsed as HTML.

/**
 * @typedef {import("./search-index.js").Definition} Definition
 */

/**
 * Fill `container` with a cycling view of `definitions`.
 *
 * @param {Document} doc The document to create nodes in.
 * @param {HTMLElement} container The element to fill (its children are kept;
 *   the card's nodes are appended).
 * @param {Definition[]} definitions The definitions to show, first one first.
 * @param {Object} classes CSS class names for the parts.
 * @param {string} classes.term Term heading.
 * @param {string} classes.acronym Acronym span inside the heading.
 * @param {string} classes.definition Definition paragraph.
 * @param {string} classes.link "Open page" link.
 * @param {string} classes.cycle The cycle control's wrapper.
 * @param {string} classes.cycleButton Its Previous/Next buttons.
 * @param {string} classes.cycleCount Its "n of N" text.
 * @param {() => void} [onFollow] Called when the reader follows the link.
 * @returns {{show: (i: number) => void, current: () => number}} Show the
 *   definition at index `i` (wrapping), and read which one is shown.
 */
export function fillDefinitionCard(doc, container, definitions, classes, onFollow) {
  const defs = Array.isArray(definitions) ? definitions.filter(Boolean) : [];
  let index = 0;

  const termEl = doc.createElement("p");
  termEl.className = classes.term;
  container.appendChild(termEl);

  const defEl = doc.createElement("p");
  defEl.className = classes.definition;
  container.appendChild(defEl);

  const link = doc.createElement("a");
  link.className = classes.link;
  link.textContent = "Open page";
  if (onFollow) link.addEventListener("click", () => onFollow());

  /** @type {HTMLElement|null} */
  let cycle = null;
  /** @type {HTMLElement|null} */
  let count = null;
  if (defs.length > 1) {
    cycle = doc.createElement("div");
    cycle.className = classes.cycle;
    cycle.setAttribute("role", "group");
    cycle.setAttribute("aria-label", "Definitions");

    const prev = doc.createElement("button");
    prev.className = classes.cycleButton;
    prev.setAttribute("type", "button");
    prev.setAttribute("aria-label", "Previous definition");
    prev.textContent = "‹ Prev";
    prev.addEventListener("click", () => show(index - 1));

    count = doc.createElement("span");
    count.className = classes.cycleCount;
    count.setAttribute("aria-live", "polite");

    const next = doc.createElement("button");
    next.className = classes.cycleButton;
    next.setAttribute("type", "button");
    next.setAttribute("aria-label", "Next definition");
    next.textContent = "Next ›";
    next.addEventListener("click", () => show(index + 1));

    cycle.append(prev, count, next);
    container.appendChild(cycle);
  }

  /** @param {number} i */
  function show(i) {
    if (defs.length === 0) return;
    index = ((i % defs.length) + defs.length) % defs.length;
    const d = defs[index];

    termEl.textContent = d.term;
    if (d.acronym) {
      const acr = doc.createElement("span");
      acr.className = classes.acronym;
      acr.textContent = ` (${d.acronym})`;
      termEl.appendChild(acr);
    }

    defEl.textContent = d.definition;

    // The link is present only for a definition with a page, between the
    // definition and the cycle control.
    if (d.pageRef) {
      link.href = d.pageRef.startsWith("#") ? d.pageRef : `#${d.pageRef}`;
      if (link.parentNode !== container) container.insertBefore(link, cycle);
    } else {
      link.remove();
    }

    if (count) count.textContent = `${index + 1} of ${defs.length}`;
  }

  show(0);
  return { show, current: () => index };
}
