// src/bookmarks.js
//
// Bookmarks, kept in this browser's localStorage (like theme.js and resize.js).
//
//   • Section bookmarks: every h2..h4 on a page gets a ribbon button. Clicking
//     it bookmarks that section and opens a small editor for an optional note.
//     The page title (h1) gets one too, which bookmarks the page as a whole.
//   • Bookmarked sections get a marker in the margin, and a page with any
//     bookmarks lists them in a "Bookmarks on this page" box under its title.
//   • The Bookmarks page (#/bookmarks) lists them grouped by shelf and topic,
//     with jump, edit note, delete (with undo), a filter, and export/import so
//     the list can be carried to another browser by hand.
//   • "Continue where you left off": the last page read and the section in view
//     are saved as the reader scrolls, and shown at the top of the Bookmarks
//     page and the home page.
//
// A bookmark stores its route, the heading text and a short snippet of the
// text under it, not a position, so it survives edits to the page. If the
// heading is renamed, the snippet is tried; if neither is found the jump opens
// the page and the bookmark is flagged as moved.
//
// Every storage access is wrapped in try/catch: private mode can refuse it,
// and then bookmarks simply last for the visit.

export const STORAGE_KEY = "alexandria-bookmarks";
export const VISIT_KEY = "alexandria-last-visit";
export const CHANGE_EVENT = "alexandria-bookmarks-change";
export const NOTE_MAX = 1000;
const SNIPPET_MAX = 160;

/**
 * @typedef {Object} Bookmark
 * @property {string} id
 * @property {string} route        Slug path joined with "/", e.g. "probability/basics/axioms".
 * @property {string|null} heading Section heading text, or null for the whole page.
 * @property {string} snippet      Start of the text under the heading.
 * @property {string} note         The reader's note ("" when none).
 * @property {string} pageTitle
 * @property {string[]} trail      Titles from the shelf down to the page.
 * @property {number} created
 * @property {number} updated
 * @property {boolean} [moved]     The heading could not be found on the last jump.
 */

/**
 * @typedef {Object} Visit
 * @property {string} route
 * @property {string} pageTitle
 * @property {string[]} trail
 * @property {string|null} heading The section in view, or null near the top.
 * @property {number} scrollY
 * @property {number} at
 */

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

function defaultStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Collapse whitespace and lowercase, so headings match despite small edits in spacing or case. */
export function normalize(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

function isBookmark(b) {
  return b && typeof b === "object" && typeof b.id === "string" && typeof b.route === "string";
}

function clean(b) {
  return {
    id: b.id,
    route: b.route,
    heading: typeof b.heading === "string" && b.heading.trim() ? b.heading.trim() : null,
    snippet: typeof b.snippet === "string" ? b.snippet.slice(0, SNIPPET_MAX) : "",
    note: typeof b.note === "string" ? b.note.slice(0, NOTE_MAX) : "",
    pageTitle: typeof b.pageTitle === "string" ? b.pageTitle : b.route,
    trail: Array.isArray(b.trail) ? b.trail.filter((t) => typeof t === "string") : [],
    created: Number.isFinite(b.created) ? b.created : 0,
    updated: Number.isFinite(b.updated) ? b.updated : Number.isFinite(b.created) ? b.created : 0,
    ...(b.moved ? { moved: true } : {}),
  };
}

/** @returns {Bookmark[]} */
export function readBookmarks(storage = defaultStorage()) {
  try {
    const raw = storage ? storage.getItem(STORAGE_KEY) : null;
    const data = raw ? JSON.parse(raw) : [];
    return Array.isArray(data) ? data.filter(isBookmark).map(clean) : [];
  } catch {
    return [];
  }
}

/** @returns {boolean} whether the list was saved */
export function writeBookmarks(list, storage = defaultStorage()) {
  try {
    if (!storage) return false;
    storage.setItem(STORAGE_KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

function newId(now) {
  return now.toString(36) + Math.random().toString(36).slice(2, 8);
}

/** The bookmark for a route and heading (null heading = the whole page), if any. */
export function findBookmark(list, route, heading) {
  const key = heading == null ? null : normalize(heading);
  return (
    list.find((b) => b.route === route && (b.heading == null ? key === null : key !== null && normalize(b.heading) === key)) ??
    null
  );
}

/**
 * Add a bookmark, or return the existing one for the same route and heading.
 * @returns {Bookmark}
 */
export function addBookmark(fields, storage = defaultStorage(), now = Date.now()) {
  const list = readBookmarks(storage);
  const existing = findBookmark(list, fields.route, fields.heading ?? null);
  if (existing) return existing;
  const bookmark = clean({
    note: "",
    ...fields,
    id: newId(now),
    created: now,
    updated: now,
  });
  list.push(bookmark);
  writeBookmarks(list, storage);
  notify();
  return bookmark;
}

/** Change fields of a bookmark (its note, the moved flag). Returns the new bookmark or null. */
export function updateBookmark(id, patch, storage = defaultStorage(), now = Date.now()) {
  const list = readBookmarks(storage);
  const i = list.findIndex((b) => b.id === id);
  if (i === -1) return null;
  const next = { ...list[i], ...patch, updated: now };
  if (!patch.moved && "moved" in patch) delete next.moved;
  list[i] = clean(next);
  writeBookmarks(list, storage);
  notify();
  return list[i];
}

/** Remove a bookmark. Returns the removed bookmark (for undo) or null. */
export function removeBookmark(id, storage = defaultStorage()) {
  const list = readBookmarks(storage);
  const i = list.findIndex((b) => b.id === id);
  if (i === -1) return null;
  const [removed] = list.splice(i, 1);
  writeBookmarks(list, storage);
  notify();
  return removed;
}

/** Put a removed bookmark back (undo). */
export function restoreBookmark(bookmark, storage = defaultStorage()) {
  const list = readBookmarks(storage);
  if (!list.some((b) => b.id === bookmark.id)) list.push(clean(bookmark));
  writeBookmarks(list, storage);
  notify();
}

/**
 * Merge imported bookmarks into the saved ones. A bookmark for the same route
 * and heading as a saved one keeps whichever was updated last.
 * @returns {number} how many bookmarks were added or replaced
 */
export function importBookmarks(data, storage = defaultStorage()) {
  const incoming = (Array.isArray(data) ? data : Array.isArray(data?.bookmarks) ? data.bookmarks : [])
    .filter(isBookmark)
    .map(clean);
  const list = readBookmarks(storage);
  let changed = 0;
  for (const b of incoming) {
    let same = list.findIndex((x) => x.id === b.id);
    if (same === -1) same = list.indexOf(findBookmark(list, b.route, b.heading));
    if (same === -1) {
      list.push(b);
      changed++;
    } else if (b.updated > list[same].updated) {
      list[same] = b;
      changed++;
    }
  }
  if (changed) {
    writeBookmarks(list, storage);
    notify();
  }
  return changed;
}

/** @returns {Visit|null} */
export function readVisit(storage = defaultStorage()) {
  try {
    const raw = storage ? storage.getItem(VISIT_KEY) : null;
    const v = raw ? JSON.parse(raw) : null;
    if (!v || typeof v.route !== "string" || !v.route) return null;
    return {
      route: v.route,
      pageTitle: typeof v.pageTitle === "string" ? v.pageTitle : v.route,
      trail: Array.isArray(v.trail) ? v.trail.filter((t) => typeof t === "string") : [],
      heading: typeof v.heading === "string" && v.heading ? v.heading : null,
      scrollY: Number.isFinite(v.scrollY) && v.scrollY > 0 ? v.scrollY : 0,
      at: Number.isFinite(v.at) ? v.at : 0,
    };
  } catch {
    return null;
  }
}

export function recordVisit(visit, storage = defaultStorage(), now = Date.now()) {
  try {
    if (!storage || !visit || !visit.route) return false;
    storage.setItem(VISIT_KEY, JSON.stringify({ ...visit, at: now }));
    return true;
  } catch {
    return false;
  }
}

function notify() {
  try {
    if (typeof document !== "undefined" && typeof CustomEvent === "function") {
      document.dispatchEvent(new CustomEvent(CHANGE_EVENT));
    }
  } catch {
    // No event support: the header count catches up on the next render.
  }
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Group bookmarks by shelf (trail[0]) then topic (trail[1], or the page itself
 * for a shelf-level page). Shelves and topics are sorted by title; bookmarks
 * within a topic by page, then newest first.
 */
export function groupBookmarks(list) {
  const shelves = new Map();
  for (const b of list) {
    const shelf = b.trail[0] ?? b.pageTitle;
    const topic = b.trail[1] ?? b.pageTitle;
    if (!shelves.has(shelf)) shelves.set(shelf, new Map());
    const topics = shelves.get(shelf);
    if (!topics.has(topic)) topics.set(topic, []);
    topics.get(topic).push(b);
  }
  const byTitle = (a, b) => a.localeCompare(b, undefined, { sensitivity: "base" });
  return [...shelves.keys()].sort(byTitle).map((shelf) => ({
    shelf,
    topics: [...shelves.get(shelf).keys()].sort(byTitle).map((topic) => ({
      topic,
      items: shelves
        .get(shelf)
        .get(topic)
        .slice()
        .sort((a, b) => byTitle(a.pageTitle, b.pageTitle) || b.created - a.created),
    })),
  }));
}

/** Does a bookmark match a filter string (heading, note, page, trail or snippet)? */
export function matchesFilter(b, query) {
  const q = normalize(query);
  if (!q) return true;
  return normalize([b.heading ?? "", b.note, b.pageTitle, b.trail.join(" "), b.snippet].join(" ")).includes(q);
}

/** "just now", "5 minutes ago", "yesterday", "3 days ago", or a date. */
export function timeAgo(then, now = Date.now()) {
  const s = Math.max(0, Math.round((now - then) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return m === 1 ? "1 minute ago" : `${m} minutes ago`;
  const h = Math.round(m / 60);
  if (h < 24) return h === 1 ? "1 hour ago" : `${h} hours ago`;
  const d = Math.round(h / 24);
  if (d === 1) return "yesterday";
  if (d < 30) return `${d} days ago`;
  try {
    return "on " + new Date(then).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return `${d} days ago`;
  }
}

/** The trail of titles for a resolution: shelf down to the page. */
export function trailFor(resolution) {
  const crumbs = Array.isArray(resolution?.crumbs) ? resolution.crumbs : [];
  return crumbs.map((n) => (n && (n.title ?? n.slug)) || "").filter(Boolean);
}

// ---------------------------------------------------------------------------
// Headings on a rendered page
// ---------------------------------------------------------------------------

const SECTION_SELECTOR = ".block--heading > h2, .block--heading > h3, .block--heading > h4";

/** The section headings (h2..h4) of a rendered page, in order. */
export function sectionHeadings(root) {
  return root && typeof root.querySelectorAll === "function" ? [...root.querySelectorAll(SECTION_SELECTOR)] : [];
}

/** The first text under a heading: the next block's text, trimmed to a snippet. */
export function sectionSnippet(headingEl) {
  let block = headingEl?.parentElement?.nextElementSibling ?? null;
  for (let i = 0; block && i < 3; i++, block = block.nextElementSibling) {
    if (block.classList && block.classList.contains("block--heading")) break;
    const text = String(block.textContent ?? "").replace(/\s+/g, " ").trim();
    if (text) return text.length > SNIPPET_MAX ? text.slice(0, SNIPPET_MAX - 1).trimEnd() + "…" : text;
  }
  return "";
}

/**
 * Find a bookmark's section on a rendered page: by heading text, then by the
 * snippet. Returns the heading element, or null when it can't be found.
 */
export function locateSection(root, heading, snippet = "") {
  if (heading == null) return null;
  const headings = sectionHeadings(root);
  const key = normalize(heading);
  const byText = headings.find((h) => normalize(h.textContent) === key);
  if (byText) return byText;
  const snip = normalize(snippet).replace(/…$/, "");
  if (snip.length >= 20) {
    const bySnippet = headings.find((h) => {
      const s = normalize(sectionSnippet(h)).replace(/…$/, "");
      return s && (s.startsWith(snip.slice(0, 60)) || snip.startsWith(s.slice(0, 60)));
    });
    if (bySnippet) return bySnippet;
  }
  return null;
}

/** The section heading the reader is in: the last one above the top of the window. */
export function headingInView(root, offset = 96) {
  let current = null;
  for (const h of sectionHeadings(root)) {
    const top = typeof h.getBoundingClientRect === "function" ? h.getBoundingClientRect().top : Infinity;
    if (top <= offset) current = h;
    else break;
  }
  return current;
}

// ---------------------------------------------------------------------------
// Jumps: a bookmark or "continue" link asks the next render to scroll to a place
// ---------------------------------------------------------------------------

/** @type {{route: string, heading: string|null, snippet?: string, scrollY?: number, bookmarkId?: string, moved?: boolean}|null} */
let pendingJump = null;

export function requestJump(target) {
  pendingJump = target && typeof target.route === "string" ? { ...target } : null;
}

/** Take the pending jump if it is for this route (and clear it either way). */
export function takeJump(route) {
  const jump = pendingJump;
  pendingJump = null;
  return jump && jump.route === route ? jump : null;
}

/**
 * Scroll a freshly rendered page to a jump target. Returns "section", "scroll",
 * "moved" (the section wasn't found; the page shows a note) or "none".
 */
export function applyJump(root, jump, storage = defaultStorage()) {
  if (!jump) return "none";
  const win = typeof window !== "undefined" ? window : null;
  const target = locateSection(root, jump.heading, jump.snippet);
  if (target) {
    const go = () => {
      if (typeof target.scrollIntoView === "function") target.scrollIntoView({ block: "start" });
    };
    go();
    // Figures above the section may load after this and push it down; aim
    // again shortly unless the reader has scrolled away themselves.
    if (win && typeof win.setTimeout === "function") {
      const y = win.scrollY;
      win.setTimeout(() => {
        if (target.isConnected && Math.abs(win.scrollY - y) < 4) go();
      }, 450);
    }
    if (jump.bookmarkId && jump.moved) updateBookmark(jump.bookmarkId, { moved: false }, storage);
    flash(target);
    return "section";
  }
  if (jump.heading != null) {
    if (jump.bookmarkId && !jump.moved) updateBookmark(jump.bookmarkId, { moved: true }, storage);
    showNotice(root, `The section "${jump.heading}" has moved or been renamed, so this opens the page instead.`);
    return "moved";
  }
  if (jump.scrollY && win && typeof win.scrollTo === "function") {
    win.scrollTo({ top: jump.scrollY, left: 0, behavior: "instant" });
    return "scroll";
  }
  return "none";
}

function flash(headingEl) {
  const block = headingEl.parentElement;
  if (!block || !block.classList) return;
  block.classList.add("bm-flash");
  if (typeof setTimeout === "function") setTimeout(() => block.classList.remove("bm-flash"), 1600);
}

function showNotice(root, text) {
  const page = root.querySelector(".page") ?? root;
  const title = page.querySelector(".page-title");
  const note = make("p", "bm-notice", text);
  note.setAttribute("role", "status");
  if (title && title.parentElement === page) title.after(note);
  else page.prepend(note);
}

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

function make(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function button(className, text, label) {
  const b = make("button", className, text);
  b.setAttribute("type", "button");
  if (label) b.setAttribute("aria-label", label);
  return b;
}

const SVG_NS = "http://www.w3.org/2000/svg";

function ribbonIcon() {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", "M4 1.5h8a.5.5 0 0 1 .5.5v12.2a.3.3 0 0 1-.48.24L8 11.5l-4.02 2.94a.3.3 0 0 1-.48-.24V2a.5.5 0 0 1 .5-.5z");
  svg.appendChild(path);
  return svg;
}

/** Link to a bookmark or visit that scrolls to its place after the route renders. */
function jumpLink(className, text, target) {
  const a = make("a", className, text);
  a.setAttribute("href", "#/" + target.route);
  a.addEventListener("click", () => requestJump(target));
  return a;
}

// ---------------------------------------------------------------------------
// Ribbons and the note editor on a topic page
// ---------------------------------------------------------------------------

/**
 * Add bookmark ribbons to a rendered topic page: one on the page title (the
 * whole page) and one on each section heading.
 *
 * @param {HTMLElement} root The `#app` element holding the rendered `.page`.
 * @param {{route: string, pageTitle: string, trail: string[]}} ctx
 * @param {Storage|null} [storage]
 */
export function decoratePage(root, ctx, storage = defaultStorage()) {
  const page = root?.querySelector?.(".page");
  if (!page || !ctx || !ctx.route) return;

  const title = page.querySelector(".page-title");
  const targets = [];
  if (title) targets.push({ el: title, holder: title, heading: null });
  for (const h of sectionHeadings(page)) targets.push({ el: h, holder: h.parentElement, heading: h.textContent.trim() });

  const refresh = () => {
    const list = readBookmarks(storage);
    for (const t of targets) {
      const bm = findBookmark(list, ctx.route, t.heading);
      t.ribbon.setAttribute("aria-pressed", bm ? "true" : "false");
      t.ribbon.title = bm ? (bm.note ? `Bookmarked: ${bm.note}` : "Bookmarked. Click to add a note or remove") : t.heading == null ? "Bookmark this page" : "Bookmark this section";
      t.holder.classList.toggle("is-bookmarked", Boolean(bm));
    }
    renderOnPageList(page, ctx, list, targets);
  };

  for (const t of targets) {
    const label = t.heading == null ? `Bookmark the page ${ctx.pageTitle}` : `Bookmark the section ${t.heading}`;
    t.ribbon = button("bm-ribbon", null, label);
    t.ribbon.appendChild(ribbonIcon());
    t.el.classList.add("bm-has-ribbon");
    t.el.appendChild(t.ribbon);
    t.ribbon.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const open = page.querySelector(".bm-editor");
      const wasForThis = open && open.bmTarget === t;
      if (open) open.remove();
      if (wasForThis) return;
      let bm = findBookmark(readBookmarks(storage), ctx.route, t.heading);
      let justAdded = false;
      if (!bm) {
        bm = addBookmark(
          {
            route: ctx.route,
            heading: t.heading,
            snippet: t.heading == null ? String(page.querySelector(".page-intro")?.textContent ?? "").slice(0, SNIPPET_MAX) : sectionSnippet(t.el),
            pageTitle: ctx.pageTitle,
            trail: ctx.trail,
          },
          storage,
        );
        justAdded = true;
      }
      refresh();
      openEditor(t, bm, justAdded);
    });
  }

  function openEditor(t, bm, justAdded) {
    const editor = make("div", "bm-editor");
    editor.bmTarget = t;
    editor.setAttribute("role", "group");
    editor.setAttribute("aria-label", "Bookmark note");
    const status = make("p", "bm-editor__status", justAdded ? "Bookmarked. Add a note if you like." : "Bookmarked.");
    status.setAttribute("role", "status");
    const field = make("textarea", "bm-editor__note");
    field.setAttribute("rows", "2");
    field.setAttribute("maxlength", String(NOTE_MAX));
    field.setAttribute("placeholder", "Note (optional)");
    field.setAttribute("aria-label", "Note (optional)");
    field.value = bm.note;
    const actions = make("div", "bm-editor__actions");
    const save = button("bm-button bm-button--primary", "Save note");
    const remove = button("bm-button", "Remove bookmark");
    const close = button("bm-button bm-button--quiet", "Close");
    actions.append(save, remove, close);
    editor.append(status, field, actions);

    const done = () => {
      editor.remove();
      t.ribbon.focus?.();
    };
    save.addEventListener("click", () => {
      updateBookmark(bm.id, { note: field.value.trim() }, storage);
      refresh();
      done();
    });
    remove.addEventListener("click", () => {
      removeBookmark(bm.id, storage);
      refresh();
      done();
    });
    close.addEventListener("click", done);
    editor.addEventListener("keydown", (e) => {
      if (e.key === "Escape") done();
      else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) save.click();
    });

    t.holder.after(editor);
    field.focus?.();
  }

  refresh();
}

/** The "Bookmarks on this page" box under the title (absent when there are none). */
function renderOnPageList(page, ctx, list, targets) {
  page.querySelector(".bm-onpage")?.remove();
  const here = list.filter((b) => b.route === ctx.route);
  if (here.length === 0) return;
  const order = (b) => targets.findIndex((t) => (t.heading == null ? b.heading == null : b.heading != null && normalize(t.heading) === normalize(b.heading)));
  here.sort((a, b) => order(a) - order(b));

  const box = make("details", "bm-onpage");
  box.appendChild(make("summary", "bm-onpage__summary", here.length === 1 ? "1 bookmark on this page" : `${here.length} bookmarks on this page`));
  const ul = make("ul", "bm-onpage__list");
  for (const b of here) {
    const li = make("li", "bm-onpage__item");
    const go = button("bm-onpage__link", b.heading ?? "This page (whole page)");
    go.addEventListener("click", () => {
      const target = b.heading == null ? page.querySelector(".page-title") : locateSection(page, b.heading, b.snippet);
      if (target && typeof target.scrollIntoView === "function") target.scrollIntoView({ block: "start", behavior: "smooth" });
      if (target && b.heading != null) flash(target);
    });
    li.appendChild(go);
    if (b.note) li.appendChild(make("span", "bm-onpage__note", b.note));
    ul.appendChild(li);
  }
  box.appendChild(ul);
  const anchor = page.querySelector(".page-ref-note") ?? page.querySelector(".page-title");
  if (anchor && anchor.parentElement === page) anchor.after(box);
  else page.prepend(box);
}

// ---------------------------------------------------------------------------
// "Continue where you left off"
// ---------------------------------------------------------------------------

/**
 * The continue card for the last visit, or null when there is none.
 * @param {Visit|null} visit
 * @param {{compact?: boolean, now?: number}} [opts]
 */
export function renderContinueCard(visit, opts = {}) {
  if (!visit) return null;
  const now = opts.now ?? Date.now();
  const card = make("section", opts.compact ? "bm-continue bm-continue--compact" : "bm-continue");
  card.setAttribute("aria-label", "Continue where you left off");
  card.appendChild(make(opts.compact ? "p" : "h2", "bm-continue__label", "Continue where you left off"));
  const target = { route: visit.route, heading: visit.heading, scrollY: visit.scrollY };
  const link = jumpLink("bm-continue__link", visit.pageTitle, target);
  if (visit.heading) {
    link.appendChild(make("span", "bm-continue__section", ` › ${visit.heading}`));
  }
  card.appendChild(link);
  const where = visit.trail.slice(0, -1).join(" › ");
  card.appendChild(make("p", "bm-continue__meta", [where, `read ${timeAgo(visit.at, now)}`].filter(Boolean).join(" · ")));
  return card;
}

/** @type {{route: string, pageTitle: string, trail: string[], root: HTMLElement}|null} */
let current = null;
let trackerInstalled = false;
let trackerTimer = null;

/**
 * Say which page is on screen (or null for home, the Bookmarks page, errors),
 * so the visit tracker saves the right place. Saves the visit straight away.
 */
export function setCurrentPage(ctx, storage = defaultStorage()) {
  current = ctx && ctx.route ? ctx : null;
  if (current) saveVisitNow(storage);
}

function saveVisitNow(storage) {
  if (!current) return;
  const win = typeof window !== "undefined" ? window : null;
  const h = headingInView(current.root);
  recordVisit(
    {
      route: current.route,
      pageTitle: current.pageTitle,
      trail: current.trail,
      heading: h ? h.textContent.trim() : null,
      scrollY: win && Number.isFinite(win.scrollY) ? Math.round(win.scrollY) : 0,
    },
    storage,
  );
}

/** Save the reading place as the reader scrolls and when the tab is hidden or closed. Installs once. */
export function installVisitTracker(storage = defaultStorage()) {
  if (trackerInstalled || typeof window === "undefined" || typeof window.addEventListener !== "function") return;
  trackerInstalled = true;
  window.addEventListener(
    "scroll",
    () => {
      if (!current || trackerTimer) return;
      trackerTimer = setTimeout(() => {
        trackerTimer = null;
        saveVisitNow(storage);
      }, 500);
    },
    { passive: true },
  );
  window.addEventListener("pagehide", () => saveVisitNow(storage));
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") saveVisitNow(storage);
    });
  }
}

// ---------------------------------------------------------------------------
// Header link
// ---------------------------------------------------------------------------

/** Keep the header's Bookmarks link count current. */
export function installHeaderLink(link, storage = defaultStorage()) {
  if (!link) return;
  let count = link.querySelector(".bm-link__count");
  if (!count) {
    count = make("span", "bm-link__count");
    link.appendChild(count);
  }
  const update = () => {
    const n = readBookmarks(storage).length;
    count.textContent = n ? String(n) : "";
    count.hidden = n === 0;
    link.setAttribute("aria-label", n ? `Bookmarks (${n})` : "Bookmarks");
  };
  update();
  if (typeof document !== "undefined") document.addEventListener(CHANGE_EVENT, update);
  if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
    // Another tab changed the list.
    window.addEventListener("storage", (e) => {
      if (!e || e.key === STORAGE_KEY || e.key === null) update();
    });
  }
}

/** Mark the header link as the current page when the Bookmarks page is shown. */
export function markHeaderLink(link, active) {
  if (!link) return;
  if (active) link.setAttribute("aria-current", "page");
  else link.removeAttribute("aria-current");
}

// ---------------------------------------------------------------------------
// The Bookmarks page
// ---------------------------------------------------------------------------

/**
 * Render the Bookmarks page into `mountEl`.
 * @param {HTMLElement} mountEl
 * @param {{now?: number}} [opts]
 */
export function renderBookmarksPage(mountEl, opts = {}, storage = defaultStorage()) {
  if (!mountEl) return;
  const now = opts.now ?? Date.now();
  mountEl.replaceChildren();
  const page = make("div", "page bm-page");
  page.appendChild(make("h1", "page-title", "Bookmarks"));
  page.appendChild(
    make(
      "p",
      "page-intro",
      "Your bookmarks are saved in this browser. To bookmark a section, click the ribbon beside any heading (hover the heading to show it). Export them to move them to another browser or device.",
    ),
  );

  const card = renderContinueCard(readVisit(storage), { now });
  if (card) page.appendChild(card);

  const tools = make("div", "bm-tools");
  const filter = make("input", "bm-filter");
  filter.setAttribute("type", "search");
  filter.setAttribute("placeholder", "Filter bookmarks and notes");
  filter.setAttribute("aria-label", "Filter bookmarks and notes");
  const exportBtn = button("bm-button", "Export");
  const importBtn = button("bm-button", "Import");
  const file = make("input", "bm-import-file");
  file.setAttribute("type", "file");
  file.setAttribute("accept", "application/json,.json");
  file.hidden = true;
  const status = make("p", "bm-tools__status");
  status.setAttribute("role", "status");
  tools.append(filter, exportBtn, importBtn, file, status);
  page.appendChild(tools);

  const listEl = make("div", "bm-groups");
  page.appendChild(listEl);
  mountEl.appendChild(page);

  const draw = () => {
    listEl.replaceChildren();
    const list = readBookmarks(storage);
    exportBtn.disabled = list.length === 0;
    filter.hidden = list.length === 0;
    if (list.length === 0) {
      listEl.appendChild(
        make("p", "bm-empty", "No bookmarks yet. Open any page, hover a heading and click the ribbon to save that section here, with a note if you want one."),
      );
      return;
    }
    for (const group of groupBookmarks(list)) {
      const shelf = make("section", "bm-shelf");
      shelf.appendChild(make("h2", "bm-shelf__title", group.shelf));
      for (const topic of group.topics) {
        const block = make("div", "bm-topic");
        if (topic.topic !== group.shelf) block.appendChild(make("h3", "bm-topic__title", topic.topic));
        const ul = make("ul", "bm-list");
        for (const b of topic.items) ul.appendChild(renderItem(b));
        block.appendChild(ul);
        shelf.appendChild(block);
      }
      listEl.appendChild(shelf);
    }
    applyFilter();
  };

  function renderItem(b) {
    const li = make("li", "bm-item");
    li.bmBookmark = b;
    const head = make("div", "bm-item__head");
    const target = { route: b.route, heading: b.heading, snippet: b.snippet, bookmarkId: b.id, moved: Boolean(b.moved) };
    head.appendChild(jumpLink("bm-item__link", b.heading ?? b.pageTitle, target));
    if (b.heading) head.appendChild(make("span", "bm-item__page", `in ${b.pageTitle}`));
    else head.appendChild(make("span", "bm-item__page", "whole page"));
    li.appendChild(head);

    const note = make("p", "bm-item__note", b.note);
    note.hidden = !b.note;
    li.appendChild(note);
    if (b.snippet) li.appendChild(make("p", "bm-item__snippet", b.snippet));

    const meta = make("p", "bm-item__meta", `Saved ${timeAgo(b.created, now)}`);
    if (b.moved) meta.appendChild(make("span", "bm-item__moved", " · section moved, opens the page"));
    li.appendChild(meta);

    const actions = make("div", "bm-item__actions");
    const edit = button("bm-button bm-button--quiet", b.note ? "Edit note" : "Add note");
    const del = button("bm-button bm-button--quiet", "Delete");
    actions.append(edit, del);
    li.appendChild(actions);

    edit.addEventListener("click", () => {
      if (li.querySelector(".bm-editor")) return;
      const editor = make("div", "bm-editor");
      const field = make("textarea", "bm-editor__note");
      field.setAttribute("rows", "2");
      field.setAttribute("maxlength", String(NOTE_MAX));
      field.setAttribute("aria-label", "Note");
      field.setAttribute("placeholder", "Note (optional)");
      field.value = b.note;
      const row = make("div", "bm-editor__actions");
      const save = button("bm-button bm-button--primary", "Save");
      const cancel = button("bm-button bm-button--quiet", "Cancel");
      row.append(save, cancel);
      editor.append(field, row);
      actions.hidden = true;
      li.appendChild(editor);
      field.focus?.();
      const close = () => {
        editor.remove();
        actions.hidden = false;
        edit.focus?.();
      };
      save.addEventListener("click", () => {
        const next = updateBookmark(b.id, { note: field.value.trim() }, storage);
        if (next) {
          b.note = next.note;
          note.textContent = next.note;
          note.hidden = !next.note;
          edit.textContent = next.note ? "Edit note" : "Add note";
        }
        close();
      });
      cancel.addEventListener("click", close);
      editor.addEventListener("keydown", (e) => {
        if (e.key === "Escape") close();
        else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) save.click();
      });
    });

    del.addEventListener("click", () => {
      const removed = removeBookmark(b.id, storage);
      if (!removed) return;
      const undoRow = make("li", "bm-item bm-item--removed");
      undoRow.appendChild(make("span", null, `Removed "${b.heading ?? b.pageTitle}". `));
      const undo = button("bm-button bm-button--quiet", "Undo");
      undo.addEventListener("click", () => {
        restoreBookmark(removed, storage);
        draw();
      });
      undoRow.appendChild(undo);
      li.replaceWith(undoRow);
      undo.focus?.();
    });
    return li;
  }

  function applyFilter() {
    const q = filter.value;
    for (const shelf of listEl.querySelectorAll(".bm-shelf")) {
      let shelfShown = false;
      for (const topic of shelf.querySelectorAll(".bm-topic")) {
        let topicShown = false;
        for (const li of topic.querySelectorAll(".bm-item")) {
          if (!li.bmBookmark) continue;
          const show = matchesFilter(li.bmBookmark, q);
          li.hidden = !show;
          topicShown ||= show;
        }
        topic.hidden = !topicShown;
        shelfShown ||= topicShown;
      }
      shelf.hidden = !shelfShown;
    }
  }

  filter.addEventListener("input", applyFilter);

  exportBtn.addEventListener("click", () => {
    const data = JSON.stringify({ app: "library-of-alexandria", version: 1, exported: new Date(now).toISOString(), bookmarks: readBookmarks(storage) }, null, 2);
    try {
      const blob = new Blob([data], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = make("a");
      a.href = url;
      a.download = "alexandria-bookmarks.json";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      status.textContent = "Exported. Use Import on another browser to load the file.";
    } catch {
      status.textContent = "This browser couldn't make the file.";
    }
  });

  importBtn.addEventListener("click", () => file.click());
  file.addEventListener("change", async () => {
    const f = file.files && file.files[0];
    file.value = "";
    if (!f) return;
    try {
      const n = importBookmarks(JSON.parse(await f.text()), storage);
      status.textContent = n === 1 ? "Imported 1 bookmark." : `Imported ${n} bookmarks.`;
      draw();
    } catch {
      status.textContent = "That file isn't a bookmarks export.";
    }
  });

  draw();
}
