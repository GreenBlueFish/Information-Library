// src/renderer.js
//
// Renderer (design.md — Component 3).
//
// The only component that decides HTML structure, so every page in the Library
// of Alexandria looks like one coherent system regardless of which agent
// authored a given page (Requirements 3.2, 3.3, 14.1, 14.3). It turns resolved
// routes and page JSON into DOM using the shared CSS class contract documented
// at the top of `assets/css/alexandria.css`.
//
// This module (task 4.1) establishes three things:
//   - `renderPage(resolution, pageContent, mountEl)` — the standard page
//     template. The HTML shell (`index.html`) already provides the persistent
//     header, nav, and footer landmarks; this fills the main/app region with
//     either the Home_Page (home-card grid) or a resolved topic page (title,
//     intro, ordered body blocks).
//   - `renderNav(tree, activePath, mountEl)` — the breadcrumb (from the active
//     route's ancestor chain) plus the topic tree, rendered into the nav
//     landmark.
//   - `renderBlock(block, mountEl)` — the block DISPATCH: it routes each
//     content block to a per-type renderer by `block.type`. The individual
//     per-type renderers (prose/heading/list/code/callout) are task 4.2 and the
//     `widget` delegation to the Widget Registry is task 4.3; both plug into the
//     `BLOCK_RENDERERS` table below without touching the dispatch itself.
//
// Content text is always written with `textContent` (never `innerHTML`) so
// first-party JSON authored by maintainers cannot inject markup (Requirement
// 3.10; design.md Security Considerations).
//
// Requirements: 1.1 (Home_Page with title, mission, topic-card grid),
// 1.2 (one card per root child, title + optional summary), 1.3 (child
// subtopics shown within/beneath the card), 2.3 (breadcrumb from the ancestor
// chain), 3.2 (standard page template), 3.3 (render blocks in order).

import { mountWidget } from "./widgets/registry.js";
import { installHome } from "./home.js";

/**
 * @typedef {import("./router.js").TopicNode} TopicNode
 * @typedef {import("./router.js").RouteResolution} RouteResolution
 * @typedef {import("./widgets/registry.js").WidgetSpec} WidgetSpec
 * @typedef {import("./widgets/registry.js").WidgetInstance} WidgetInstance
 */

/**
 * One ordered unit of page body content (design.md — Model 2: ContentBlock).
 *
 * @typedef {Object} ContentBlock
 * @property {"prose"|"heading"|"list"|"code"|"callout"|"widget"} type The block
 *   kind, used by {@link renderBlock} to pick a per-type renderer.
 * @property {string} [text]   For prose/heading/callout.
 * @property {number} [level]  For heading (2..4).
 * @property {string[]} [items] For list.
 * @property {string} [lang]   For code (e.g. "javascript").
 * @property {string} [source] For code (the snippet).
 * @property {object} [widget] For widget blocks (a WidgetSpec).
 */

/**
 * The JSON document backing a single page (design.md — Model 2: PageContent).
 *
 * @typedef {Object} PageContent
 * @property {string} title
 * @property {string} [intro]
 * @property {ContentBlock[]} blocks
 */

// ---------------------------------------------------------------------------
// Small DOM helpers
//
// Kept local and dependency-free: the renderer is the single place that builds
// DOM, so these keep every builder below terse and consistent. `setText` always
// routes content through `textContent` to uphold Requirement 3.10.
// ---------------------------------------------------------------------------

/**
 * Create an element, optionally assigning a class and text content.
 *
 * @param {string} tag       The element tag name.
 * @param {string} [className] A space-separated class string to assign.
 * @param {string} [text]    Text content, set via `textContent` (never HTML).
 * @returns {HTMLElement}
 */
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * Remove every child of a mount element so a re-render starts from a clean
 * slate. Rendering the same route twice must yield the same DOM (design.md
 * Property 5: Idempotent render), so each entry point clears first.
 *
 * @param {HTMLElement} mountEl
 * @returns {void}
 */
function clear(mountEl) {
  mountEl.replaceChildren();
}

/**
 * Build the hash route for a topic node from its slug path. Centralized so the
 * nav links, breadcrumb links, and home-card links all produce the same shape
 * (`#/a/b/c`) the router parses.
 *
 * @param {string[]} segments Slug segments from the root down to the node.
 * @returns {string} A hash href, e.g. `#/snn/neuron-models` (or `#/` for home).
 */
function hrefForPath(segments) {
  if (!segments || segments.length === 0) return "#/";
  return `#/${segments.join("/")}`;
}

// ===========================================================================
// renderNav — breadcrumb + topic tree
// ===========================================================================

/**
 * Render the navigation region: the breadcrumb for the active route (built from
 * its ancestor chain) followed by the full topic tree (Requirements 2.3, and
 * the nav side of 1.x). The nav is re-rendered on every route change so the
 * active node and its ancestors reflect the current location.
 *
 * `activePath` is the resolved route's slug path (`resolution.path`); an empty
 * path means the Home_Page is active, so no crumb trail and no tree item is
 * marked current.
 *
 * @param {TopicNode} tree The root topic tree (its `children` are the topics).
 * @param {string[]} activePath Slug segments of the active route (may be empty).
 * @param {HTMLElement} mountEl The nav landmark to fill (e.g. `#nav`).
 * @returns {void}
 */
export function renderNav(tree, activePath, mountEl) {
  if (!mountEl) return;
  clear(mountEl);

  const path = Array.isArray(activePath) ? activePath : [];

  // Breadcrumb from the ancestor chain (Requirement 2.3). Shown only when a
  // route (not the home page) is active.
  const crumb = buildBreadcrumb(tree, path);
  if (crumb) mountEl.appendChild(crumb);

  // The topic tree itself: the root's children, recursively.
  if (tree && Array.isArray(tree.children) && tree.children.length > 0) {
    mountEl.appendChild(buildTree(tree.children, [], path));
  }
}

/**
 * Build the breadcrumb list (`ol.breadcrumb`) for the active route from the
 * ancestor chain implied by `activePath` (Requirement 2.3). A leading "Home"
 * crumb links back to the root; each subsequent crumb corresponds to one slug
 * segment, resolved against the tree for its human title. The final crumb (the
 * current page) is marked `aria-current="page"` and is not a link, matching the
 * CSS contract (`.breadcrumb__item[aria-current="page"]`).
 *
 * Returns `null` for the home route (empty path) — the home page shows no
 * breadcrumb.
 *
 * @param {TopicNode} tree Root topic tree, used to resolve crumb titles.
 * @param {string[]} activePath Slug segments of the active route.
 * @returns {HTMLElement|null}
 */
function buildBreadcrumb(tree, activePath) {
  if (!activePath || activePath.length === 0) return null;

  const list = el("ol", "breadcrumb");

  // Leading Home crumb.
  list.appendChild(crumbItem("Home", hrefForPath([]), false));

  // Walk the path, resolving each prefix to its node title where possible.
  let siblings = tree && Array.isArray(tree.children) ? tree.children : [];
  for (let i = 0; i < activePath.length; i++) {
    const slug = activePath[i];
    const node = siblings.find((child) => child && child.slug === slug);
    const title = node && node.title ? node.title : slug;
    const isCurrent = i === activePath.length - 1;
    const href = hrefForPath(activePath.slice(0, i + 1));
    list.appendChild(crumbItem(title, href, isCurrent));
    siblings = node && Array.isArray(node.children) ? node.children : [];
  }

  return list;
}

/**
 * Build a single breadcrumb item. The current-page crumb renders as plain text
 * with `aria-current="page"`; all others render as links.
 *
 * @param {string} label    Human title for the crumb.
 * @param {string} href     Hash href the crumb links to (ignored when current).
 * @param {boolean} isCurrent Whether this crumb is the active page.
 * @returns {HTMLElement}
 */
function crumbItem(label, href, isCurrent) {
  const item = el("li", "breadcrumb__item");
  if (isCurrent) {
    item.setAttribute("aria-current", "page");
    item.textContent = label;
  } else {
    const link = el("a", "breadcrumb__link", label);
    link.setAttribute("href", href);
    item.appendChild(link);
  }
  return item;
}

/**
 * Slug paths (joined with "/") of the nav-tree nodes the reader has expanded.
 * The nav is rebuilt on every route change, so the open/closed state lives here
 * at module level rather than in the DOM, and survives those re-renders.
 *
 * @type {Set<string>}
 */
const expandedNavNodes = new Set();

/**
 * Collapse every nav-tree node the reader has opened, back to the default
 * (top-level topics only, plus the active route's ancestors). For tests.
 *
 * @returns {void}
 */
export function resetNavExpansion() {
  expandedNavNodes.clear();
}

/**
 * Recursively build the topic tree list (`ul.nav-tree`) for a set of sibling
 * nodes. Each node renders a link (`.nav-tree__link`) whose href is the hash
 * route to that node; nodes with children recurse into a nested `<ul>`, which
 * the CSS indents one step per level. The link for the active route is marked
 * `aria-current="page"` so the CSS can highlight it.
 *
 * Subtopics start collapsed, so the nav opens showing only the top-level
 * topics. A node with children gets a disclosure button
 * (`button.nav-tree__toggle`, `aria-expanded` + `aria-controls`) that shows or
 * hides its nested list. A list is open when the reader expanded it (kept in
 * {@link expandedNavNodes}) or when it holds or is the active route, so the
 * current page is always visible in the tree along with what sits under it.
 *
 * @param {TopicNode[]} nodes The sibling nodes to render at this level.
 * @param {string[]} ancestorSlugs Slug path from the root down to (not
 *   including) these siblings.
 * @param {string[]} activePath Slug segments of the active route.
 * @returns {HTMLElement} A `ul.nav-tree` element.
 */
function buildTree(nodes, ancestorSlugs, activePath) {
  const list = el("ul", "nav-tree");

  for (const node of nodes) {
    if (!node || typeof node.slug !== "string") continue;

    const slugPath = ancestorSlugs.concat(node.slug);
    const item = el("li", "nav-tree__item");
    const row = el("div", "nav-tree__row");
    item.appendChild(row);

    const link = el("a", "nav-tree__link", node.title ?? node.slug);
    link.setAttribute("href", hrefForPath(slugPath));
    if (isActivePath(slugPath, activePath)) {
      link.setAttribute("aria-current", "page");
    }

    if (Array.isArray(node.children) && node.children.length > 0) {
      const key = slugPath.join("/");
      const expanded =
        expandedNavNodes.has(key) ||
        isAncestorPath(slugPath, activePath) ||
        isActivePath(slugPath, activePath);
      const title = node.title ?? node.slug;
      const childrenId = `nav-tree-children-${slugPath.join("-")}`;

      const toggle = el("button", "nav-tree__toggle");
      toggle.setAttribute("type", "button");
      toggle.setAttribute("aria-controls", childrenId);
      toggle.setAttribute("aria-label", `Subtopics of ${title}`);
      row.appendChild(toggle);
      row.appendChild(link);

      const children = buildTree(node.children, slugPath, activePath);
      children.setAttribute("id", childrenId);
      item.appendChild(children);

      const setExpanded = (open) => {
        toggle.setAttribute("aria-expanded", open ? "true" : "false");
        children.hidden = !open;
      };
      setExpanded(expanded);

      toggle.addEventListener("click", () => {
        const open = toggle.getAttribute("aria-expanded") !== "true";
        if (open) expandedNavNodes.add(key);
        else expandedNavNodes.delete(key);
        setExpanded(open);
      });
    } else {
      row.appendChild(link);
    }

    list.appendChild(item);
  }

  return list;
}

/**
 * True when a node's slug path is a strict prefix of the active route path,
 * i.e. the node is an ancestor of the current page.
 *
 * @param {string[]} slugPath
 * @param {string[]} activePath
 * @returns {boolean}
 */
function isAncestorPath(slugPath, activePath) {
  if (!Array.isArray(activePath) || slugPath.length >= activePath.length) {
    return false;
  }
  return slugPath.every((slug, i) => slug === activePath[i]);
}

/**
 * True when a node's slug path is exactly the active route path.
 *
 * @param {string[]} slugPath
 * @param {string[]} activePath
 * @returns {boolean}
 */
function isActivePath(slugPath, activePath) {
  if (!Array.isArray(activePath) || slugPath.length !== activePath.length) {
    return false;
  }
  return slugPath.every((slug, i) => slug === activePath[i]);
}

// ===========================================================================
// renderPage — Home_Page or a resolved topic page
// ===========================================================================

/**
 * Render the main/app region for the current route (Requirements 3.2, 3.3).
 *
 * The standard page template is header → breadcrumb → nav → body → footer; the
 * HTML shell provides the persistent header, nav, and footer landmarks and
 * {@link renderNav} fills the breadcrumb + tree, so this entry point owns the
 * BODY: either the Home_Page (home-card grid) or a resolved topic page (title,
 * optional intro, and the ordered content blocks).
 *
 * A `null` resolution, or a resolution whose `node` is null, means the home
 * route — render the Home_Page (Requirement 1.1). Otherwise render the page
 * body from `pageContent`.
 *
 * @param {RouteResolution|null} resolution The resolved route, or null for home.
 * @param {PageContent|null} pageContent The loaded page JSON, or null for home.
 * @param {HTMLElement} mountEl The main/app landmark to fill (e.g. `#app`).
 * @returns {void}
 */
export function renderPage(resolution, pageContent, mountEl) {
  if (!mountEl) return;
  clear(mountEl);

  // A null resolution or a resolution with a null node is the Home_Page.
  const isHome = !resolution || !resolution.node;
  if (isHome) {
    mountEl.appendChild(renderHome(resolution));
    return;
  }

  mountEl.appendChild(renderTopicPage(resolution, pageContent));
}

// ---------------------------------------------------------------------------
// Home ordering helpers (home-topic-browse — design Components 4).
//
// `normalizeTitle` is the single normalization basis shared by home ordering
// and (in a later task) the home filter, so sorting and matching always agree
// on what a node's "title" is. `sortByTitle` is a pure presentation-step sort:
// it returns a sorted shallow copy and never mutates the input array or any
// node, so `content/topics.json` and the shared in-memory topic tree keep their
// authored order everywhere else (Requirement 3.3).
// ---------------------------------------------------------------------------

/**
 * Normalize a node's display title for case-insensitive ordering and matching:
 * the node's `title` (falling back to its `slug` when absent), trimmed of
 * leading/trailing whitespace and lowercased. This is the shared basis used by
 * both {@link sortByTitle} here and the home filter added later, so ordering
 * and matching never disagree about a node's title (Requirement 3.4).
 *
 * @param {TopicNode} node The topic node to read a title from.
 * @returns {string} The normalized title.
 */
export function normalizeTitle(node) {
  const raw = node && node.title != null ? node.title : node && node.slug;
  return (raw ?? "").trim().toLowerCase();
}

/**
 * Return a shallow copy of `nodes` sorted alphabetically and case-insensitively
 * by {@link normalizeTitle} (Requirements 3.1, 3.2, 3.4). The input array and
 * every node object are left untouched — ordering is a presentation step over a
 * copy, so the authored order of `content/topics.json` and the shared in-memory
 * tree is never modified (Requirement 3.3). `Array.prototype.sort` is specified
 * stable, so nodes whose titles are equal under case-insensitive comparison keep
 * their original relative order (Requirement 3.5).
 *
 * @param {TopicNode[]} nodes The nodes to order. A non-array yields `[]`.
 * @returns {TopicNode[]} A new, sorted array; the input is not mutated.
 */
export function sortByTitle(nodes) {
  if (!Array.isArray(nodes)) return [];
  const copy = [...nodes];
  copy.sort((a, b) =>
    normalizeTitle(a).localeCompare(normalizeTitle(b), undefined, {
      sensitivity: "base",
    }),
  );
  return copy;
}

/**
 * Build the Home_Page view: the site mission intro is carried by the shell
 * header, so the home body is the responsive grid of topic cards — one card per
 * root-level topic (Requirements 1.1, 1.2, 1.3). The root tree is read from the
 * resolution when present; a null resolution still renders a (possibly empty)
 * home container so the shell stays usable.
 *
 * The root topic tree is not carried on the home resolution (its `node` is
 * null), so the cards are built from the tree that {@link renderNav} already
 * received. To keep `renderPage` self-contained, the home grid is populated
 * from `resolution.tree` when a caller attaches it; otherwise the grid is left
 * empty and the nav tree remains the browse affordance. (The boot wiring in
 * task 11 passes the tree through; see design.md Example Usage.)
 *
 * @param {(RouteResolution & { tree?: TopicNode })|null} resolution
 * @returns {HTMLElement} A `.home` container.
 */
function renderHome(resolution) {
  const home = el("div", "home");

  // Root children: prefer a tree attached to the resolution; otherwise none.
  const tree = resolution && resolution.tree ? resolution.tree : null;
  // Order the root cards alphabetically as a presentation step over a shallow
  // copy; the authored tree order is never mutated (Requirements 3.1, 3.3).
  const roots = sortByTitle(tree && Array.isArray(tree.children) ? tree.children : []);

  // The Topic_Lookup search control sits above the grid (Requirement 1.1).
  home.appendChild(buildHomeSearch());

  const grid = el("ul", "home-grid");
  for (const node of roots) {
    const card = buildHomeCard(node, [node.slug]);
    if (card) grid.appendChild(card);
  }
  home.appendChild(grid);

  // Wire the home behavior (search filter + per-card expand/collapse) onto the
  // freshly built nodes before returning (home-topic-browse — Requirements 1.3,
  // 2.3, 2.4, 2.6, 2.7). Each render builds new nodes and attaches their own
  // listeners, so there is no listener accumulation across navigations.
  installHome(home, tree);

  return home;
}

/**
 * Build the Topic_Lookup search control for the Home_Page (Requirements 1.1,
 * 1.8). Emits a `<form class="home-search" role="search">` so pressing Enter
 * does not reload the page (its `submit` is prevented in `installHome`, a later
 * task) and so assistive tech exposes it as a search landmark. The control is a
 * labeled `<input type="search" class="home-search__input">`: it carries both a
 * visually-associated `<label for>` and an `aria-label` so it is reachable and
 * operable by keyboard with an accessible name (Requirement 1.8), and a
 * "Search topics…" placeholder as a usage hint.
 *
 * The form also holds a `<p class="home-search__status" role="status"
 * aria-live="polite" hidden>` region, used only to show the "no matching
 * topics" message (Requirement 1.6) and to announce it to assistive tech. It
 * starts empty and hidden; the live filter (a later task) fills and reveals it.
 *
 * All structure/classes only here — styling is a later task; this emits the
 * markup using the shared CSS class contract.
 *
 * @returns {HTMLElement} A `.home-search` form element.
 */
function buildHomeSearch() {
  const form = el("form", "home-search");
  form.setAttribute("role", "search");

  const inputId = "home-search-input";

  const label = el("label", "home-search__label", "Search topics");
  label.setAttribute("for", inputId);

  const input = el("input", "home-search__input");
  input.setAttribute("type", "search");
  input.setAttribute("id", inputId);
  input.setAttribute("aria-label", "Search topics");
  input.setAttribute("placeholder", "Search topics…");

  const status = el("p", "home-search__status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.hidden = true;

  form.appendChild(label);
  form.appendChild(input);
  form.appendChild(status);

  return form;
}

/**
 * Build one topic card for the home grid (Requirements 2.1, 2.2, 2.5, 3.2, 4.3,
 * 4.5). The card is a container (`<li class="home-card">`), not a single
 * anchor, so it can hold both a navigable title link and an expand/collapse
 * toggle without nesting interactive controls inside an anchor (invalid HTML).
 *
 * Structure:
 *   li.home-card           data-title = normalizeTitle(node) (for the filter)
 *     a.home-card__link     href = hrefForPath(slugPath) → title (R4.5)
 *     p.home-card__summary? when a summary is present
 *     when node has children:
 *       button.home-card__toggle aria-expanded="false" aria-controls=<id>
 *       ul.home-card__children id=<id> hidden   (collapsed by default)
 *         li.home-card__child  data-title = normalizeTitle(child)   (sorted)
 *
 * Subtopics render collapsed via the `hidden` attribute on the children list
 * plus `aria-expanded="false"` on the toggle (R2.1); the toggle appears only
 * when the node has children (R2.2, R2.5). Children are ordered alphabetically
 * as a presentation step over a shallow copy (R3.2). All title and subtopic
 * text is written with `textContent` via `el()` so content is never parsed as
 * HTML (R4.3). `data-title` carries the normalized title/child-title so the
 * home filter shares one normalization basis and never reparses display text.
 *
 * @param {TopicNode} node The root-level topic node.
 * @param {string[]} slugPath Slug path from the root to this node.
 * @returns {HTMLElement|null} A `.home-card` list item, or null for a bad node.
 */
function buildHomeCard(node, slugPath) {
  if (!node || typeof node.slug !== "string") return null;

  const card = el("li", "home-card");
  card.dataset.title = normalizeTitle(node);

  const link = el("a", "home-card__link", node.title ?? node.slug);
  link.setAttribute("href", hrefForPath(slugPath));
  card.appendChild(link);

  if (node.summary) {
    card.appendChild(el("p", "home-card__summary", node.summary));
  }

  if (Array.isArray(node.children) && node.children.length > 0) {
    // A stable id for this card's children list, used to wire the toggle's
    // `aria-controls` to the list. Derived from the slug path so it is unique
    // within one render.
    const childrenId = `home-card-children-${slugPath.join("-")}`;

    const toggle = el("button", "home-card__toggle");
    toggle.setAttribute("type", "button");
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-controls", childrenId);
    card.appendChild(toggle);

    const children = el("ul", "home-card__children");
    children.setAttribute("id", childrenId);
    children.hidden = true;
    for (const child of sortByTitle(node.children)) {
      if (!child || typeof child.slug !== "string") continue;
      const childItem = el(
        "li",
        "home-card__child",
        child.title ?? child.slug,
      );
      childItem.dataset.title = normalizeTitle(child);
      children.appendChild(childItem);
    }
    card.appendChild(children);
  }

  return card;
}

/**
 * Build a resolved topic page body: the page title, an optional intro lead
 * paragraph, and the ordered content blocks (Requirement 3.3 — blocks render in
 * array order). When `pageContent` is absent (e.g. a non-leaf grouping with no
 * page of its own, or a not-yet-loaded page), the node title from the
 * resolution still renders so the page is never blank.
 *
 * @param {RouteResolution} resolution
 * @param {PageContent|null} pageContent
 * @returns {HTMLElement} A `.page` container.
 */
function renderTopicPage(resolution, pageContent) {
  const page = el("div", "page");

  const title =
    (pageContent && pageContent.title) ||
    (resolution.node && resolution.node.title) ||
    "";
  page.appendChild(el("h1", "page-title", title));

  if (pageContent && pageContent.intro) {
    page.appendChild(el("p", "page-intro", pageContent.intro));
  }

  const blocks =
    pageContent && Array.isArray(pageContent.blocks) ? pageContent.blocks : [];
  for (const block of blocks) {
    renderBlock(block, page);
  }

  const pager = buildPager(resolution.tree, resolution.path);
  if (pager) page.appendChild(pager);

  return page;
}

/**
 * The topics just before and after `activePath` when the tree is read in the
 * sidebar's order (depth-first, each node before its subtopics), so stepping
 * "next" from a topic walks into its first subtopic, then on through the tree.
 *
 * @param {TopicNode} tree The root topic tree.
 * @param {string[]} activePath Slug segments of the current page.
 * @returns {{prev: {node: TopicNode, path: string[]}|null,
 *   next: {node: TopicNode, path: string[]}|null}}
 */
export function pageNeighbours(tree, activePath) {
  const order = pageOrder(tree);
  const i = order.findIndex((entry) => isActivePath(entry.path, activePath));
  if (i === -1) return { prev: null, next: null };
  return { prev: order[i - 1] ?? null, next: order[i + 1] ?? null };
}

/** @type {WeakMap<object, {node: TopicNode, path: string[]}[]>} */
const pageOrderCache = new WeakMap();

/**
 * Every topic in the sidebar's depth-first order, built once per tree object
 * and cached, so each render doesn't re-walk the whole tree. The tree is
 * treated as immutable once loaded; a changed tree must be a new object.
 *
 * @param {TopicNode|undefined} tree The root topic tree.
 * @returns {{node: TopicNode, path: string[]}[]}
 */
function pageOrder(tree) {
  if (!tree || typeof tree !== "object") return [];
  const cached = pageOrderCache.get(tree);
  if (cached) return cached;

  /** @type {{node: TopicNode, path: string[]}[]} */
  const order = [];
  const walk = (nodes, ancestors) => {
    if (!Array.isArray(nodes)) return;
    for (const node of nodes) {
      if (!node || typeof node.slug !== "string") continue;
      const path = ancestors.concat(node.slug);
      order.push({ node, path });
      walk(node.children, path);
    }
  };
  walk(tree.children, []);
  pageOrderCache.set(tree, order);
  return order;
}

/**
 * Build the previous/next arrows at the foot of a topic page
 * (`nav.page-pager`), or `null` when there is no tree or the page has no
 * neighbour on either side. The first page gets only "next", the last only
 * "previous".
 *
 * @param {TopicNode|undefined} tree The root topic tree (`resolution.tree`).
 * @param {string[]} activePath Slug segments of the current page.
 * @returns {HTMLElement|null}
 */
function buildPager(tree, activePath) {
  if (!tree || !Array.isArray(activePath)) return null;
  const { prev, next } = pageNeighbours(tree, activePath);
  if (!prev && !next) return null;

  const pager = el("nav", "page-pager");
  pager.setAttribute("aria-label", "Previous and next pages");
  if (prev) pager.appendChild(pagerLink(prev, "prev"));
  if (next) pager.appendChild(pagerLink(next, "next"));
  return pager;
}

/**
 * One pager link: an arrow, a small "Previous"/"Next" label, and the
 * neighbouring topic's title.
 *
 * @param {{node: TopicNode, path: string[]}} entry The neighbouring topic.
 * @param {"prev"|"next"} direction Which side of the pager it sits on.
 * @returns {HTMLElement}
 */
function pagerLink(entry, direction) {
  const link = el("a", `page-pager__link page-pager__link--${direction}`);
  link.setAttribute("href", hrefForPath(entry.path));
  link.setAttribute("rel", direction);
  const arrow = el("span", "page-pager__arrow", direction === "prev" ? "←" : "→");
  arrow.setAttribute("aria-hidden", "true");
  const label = el(
    "span",
    "page-pager__label",
    direction === "prev" ? "Previous" : "Next",
  );
  const title = el("span", "page-pager__title", entry.node.title ?? entry.node.slug);
  link.append(arrow, label, title);
  return link;
}

// ===========================================================================
// renderBlock — dispatch by block.type
// ===========================================================================

/**
 * Dispatch table from a content block `type` to its per-type renderer. This is
 * the single extension point for block kinds: task 4.2 implements the
 * prose/heading/list/code/callout renderers and task 4.3 implements the widget
 * delegation, each by filling in its entry here. The dispatch in
 * {@link renderBlock} itself never changes as block kinds are added.
 *
 * Each renderer has the signature `(block, mountEl) => void` and is responsible
 * for appending exactly one `.block` element (plus its `.block--<type>`
 * modifier) to `mountEl`.
 *
 * NOTE: the per-type renderers below are intentionally minimal placeholders for
 * task 4.1 — they establish the dispatch contract and emit the correct block
 * container so the structure is in place. Task 4.2 replaces their bodies with
 * the full prose/heading/list/code/callout rendering, and task 4.3 replaces the
 * `widget` entry with real Widget Registry delegation. Behavior for unknown
 * types (the placeholder) is already correct and is shared by both tasks.
 *
 * @type {Record<string, (block: ContentBlock, mountEl: HTMLElement) => void>}
 */
const BLOCK_RENDERERS = {
  prose: renderProseBlock,
  heading: renderHeadingBlock,
  list: renderListBlock,
  code: renderCodeBlock,
  callout: renderCalloutBlock,
  widget: renderWidgetBlock,
};

/**
 * Render a single content block by dispatching on its `type` (Requirement 3.3).
 * An unrecognized or missing type renders a visible, non-fatal placeholder
 * rather than throwing, so one bad block never halts the rest of the page
 * (Requirement 15.2; wired fully in task 10). This dispatch is stable: new
 * block kinds are added by extending {@link BLOCK_RENDERERS}, not by editing
 * this function.
 *
 * @param {ContentBlock} block The block to render.
 * @param {HTMLElement} mountEl The container to append the rendered block to.
 * @returns {void}
 */
export function renderBlock(block, mountEl) {
  if (!mountEl) return;

  const type = block && typeof block.type === "string" ? block.type : undefined;
  const renderer = type ? BLOCK_RENDERERS[type] : undefined;

  if (!renderer) {
    mountEl.appendChild(renderUnknownBlock(type));
    return;
  }

  renderer(block, mountEl);
}

// ---------------------------------------------------------------------------
// Per-type block renderers.
//
// Task 4.1 scope: establish the dispatch and emit the correct `.block` /
// `.block--<type>` container for each type so the page structure is in place.
// Task 4.2 fills in the full content rendering (textContent for prose/code,
// heading levels, list items, code language label); task 4.3 replaces the
// `widget` stub with Widget Registry delegation. All content text goes through
// `textContent` (Requirement 3.10) — these stubs already honor that.
// ---------------------------------------------------------------------------

/**
 * Create the shared block container with the `.block` base class and a
 * `.block--<type>` modifier, matching the CSS content-block contract.
 *
 * @param {string} type The block type (used for the modifier class).
 * @returns {HTMLElement}
 */
function blockContainer(type) {
  return el("div", `block block--${type}`);
}

/**
 * Render a `prose` block. Task 4.2 renders `block.text` as a paragraph via
 * `textContent` (Requirements 3.4, 3.10).
 *
 * @param {ContentBlock} block
 * @param {HTMLElement} mountEl
 * @returns {void}
 */
function renderProseBlock(block, mountEl) {
  const container = blockContainer("prose");
  // Extension point (task 4.2): render block.text as a <p> via textContent.
  if (block && typeof block.text === "string") {
    container.appendChild(el("p", undefined, block.text));
  }
  mountEl.appendChild(container);
}

/**
 * Render a `heading` block: `block.text` at the heading level given by
 * `block.level`, written via `textContent` (Requirement 3.5; 3.10 — text, not
 * HTML). `level` is validated and clamped to the 2..4 range the page template
 * allows (the page `<h1>` is owned by {@link renderTopicPage}, so body headings
 * start at `h2`); a missing or out-of-range level defaults to `h2`. A heading
 * with no text still emits the (empty) container so block order is preserved.
 *
 * @param {ContentBlock} block
 * @param {HTMLElement} mountEl
 * @returns {void}
 */
function renderHeadingBlock(block, mountEl) {
  const container = blockContainer("heading");
  if (block && typeof block.text === "string") {
    const level = clampHeadingLevel(block.level);
    container.appendChild(el(`h${level}`, undefined, block.text));
  }
  mountEl.appendChild(container);
}

/**
 * Clamp a heading `level` to the 2..4 range the page template permits. Any
 * non-integer, missing, or out-of-range value falls back to `2` so a bad
 * `level` never produces an invalid tag (e.g. `h0`/`h7`).
 *
 * @param {unknown} level
 * @returns {2|3|4}
 */
function clampHeadingLevel(level) {
  const n = typeof level === "number" ? Math.trunc(level) : NaN;
  if (n <= 2 || Number.isNaN(n)) return 2;
  if (n >= 4) return 4;
  return /** @type {3} */ (n);
}

/**
 * Render a `list` block: `block.items` as a `<ul>` of `<li>` entries, each item
 * written via `textContent` (Requirements 3.6; 3.10 — text, not HTML).
 * Non-string items are skipped so one malformed entry does not break the list;
 * a missing or empty `items` array yields an empty list container.
 *
 * @param {ContentBlock} block
 * @param {HTMLElement} mountEl
 * @returns {void}
 */
function renderListBlock(block, mountEl) {
  const container = blockContainer("list");
  const list = el("ul");
  const items = block && Array.isArray(block.items) ? block.items : [];
  for (const item of items) {
    if (typeof item !== "string") continue;
    list.appendChild(el("li", undefined, item));
  }
  container.appendChild(list);
  mountEl.appendChild(container);
}

/**
 * Render a `code` block: a `.code-lang` label naming `block.lang` followed by a
 * `<pre><code>` whose `block.source` is written via `textContent` so the
 * snippet is displayed literally and is never parsed or executed as HTML
 * (Requirements 3.7, 3.10; design.md Security Considerations). The language
 * label is omitted when `block.lang` is absent; an absent `source` yields an
 * empty code element. Using `<pre><code>` with `textContent` means angle
 * brackets and markup in the source render as plain text.
 *
 * @param {ContentBlock} block
 * @param {HTMLElement} mountEl
 * @returns {void}
 */
function renderCodeBlock(block, mountEl) {
  const container = blockContainer("code");

  if (block && typeof block.lang === "string" && block.lang.length > 0) {
    container.appendChild(el("span", "code-lang", block.lang));
  }

  const pre = el("pre");
  const source = block && typeof block.source === "string" ? block.source : "";
  pre.appendChild(el("code", undefined, source));
  container.appendChild(pre);

  mountEl.appendChild(container);
}

/**
 * Render a `callout` block: `block.text` as a callout paragraph, written via
 * `textContent` (Requirements 3.8; 3.10 — text, not HTML). A callout with no
 * text still emits the (empty) container so block order is preserved.
 *
 * @param {ContentBlock} block
 * @param {HTMLElement} mountEl
 * @returns {void}
 */
function renderCalloutBlock(block, mountEl) {
  const container = blockContainer("callout");
  if (block && typeof block.text === "string") {
    container.appendChild(el("p", undefined, block.text));
  }
  mountEl.appendChild(container);
}

/**
 * Render a `widget` block (Requirement 3.9). The renderer owns only the block
 * STRUCTURE — the `.block .block--widget` container — and then DELEGATES the
 * block's `widget` spec (a {@link WidgetSpec}) to the Widget Registry via
 * `mountWidget(spec, container)`. No widget logic is inlined here: the registry
 * (task 6) looks up `spec.type`, mounts the matching widget into `container`,
 * and renders its own visible placeholder when the type is unregistered.
 *
 * `mountWidget` returns a {@link WidgetInstance} for a registered type or `null`
 * when the type is unregistered (placeholder shown instead). This synchronous
 * DOM builder intentionally does not retain that instance: `renderPage` /
 * `renderBlock` build DOM top-to-bottom and do not own the widget lifecycle.
 * Tearing down the prior instance on re-render (calling `destroy` before
 * mounting a replacement — Requirement 10.7) is owned by the boot wiring in
 * task 11, which drives mounting/unmounting at the page level.
 *
 * @param {ContentBlock} block
 * @param {HTMLElement} mountEl
 * @returns {void}
 */
function renderWidgetBlock(block, mountEl) {
  const container = blockContainer("widget");
  if (block && block.widget) {
    // Delegate to the Widget Registry; it mounts into `container` or renders
    // its own placeholder for an unregistered type. Instance lifecycle
    // (destroy on re-render) is owned by boot (task 11); we only mount here.
    mountWidget(/** @type {WidgetSpec} */ (block.widget), container);
  }
  mountEl.appendChild(container);
}

/**
 * Render a non-fatal placeholder for a content block whose `type` the renderer
 * does not recognize (Requirement 15.2). Names the offending type so a
 * maintainer can fix the page JSON, and never throws.
 *
 * @param {string|undefined} type The unrecognized block type.
 * @returns {HTMLElement}
 */
function renderUnknownBlock(type) {
  const label = type ? `Unsupported block: ${type}` : "Unsupported block";
  return el("div", "block block--placeholder", label);
}

// ===========================================================================
// renderError — non-fatal inline error block for content load failures
// ===========================================================================

/**
 * @typedef {import("./content-loader.js").ContentLoadError} ContentLoadError
 */

/** Path to the Project Guide (relative to index.html). */
const PROJECT_GUIDE_URL = "PROJECT_GUIDE.md";

/**
 * Render a non-fatal inline error block for a content load failure and append
 * it to the app region (Requirements 15.1, 15.5).
 *
 * This is the error-to-DOM mapping for a {@link ContentLoadError} thrown by the
 * Content Loader (`loadPage` / `loadTopics`): a missing or malformed page JSON
 * or `topics.json` surfaces as a `.block .block--error` naming the affected
 * file so a maintainer knows which file to fix (R15.1). When the failure is a
 * `file://` fetch block (`error.isFileProtocolBlock === true`), the block also
 * includes a LINK to the Project Guide's static-server instructions, since the
 * fix is to serve the folder rather than to edit the file (R15.5).
 *
 * The block is "non-fatal" by construction: it is just one element appended to
 * the app/main region. The shell (header, nav, footer) and navigation are not
 * touched, so they remain usable. Boot (task 11) wraps the `loadPage` /
 * `loadTopics` calls in try/catch and, on a caught `ContentLoadError`, calls
 * this to render the error into the app region while leaving the nav rendered
 * from the already-loaded tree intact. Exported so boot (task 11) and the
 * error-handling unit tests (task 10.3) can use it.
 *
 * All text is written via `textContent` (never `innerHTML`) per Requirement
 * 3.10 and the Security Considerations in design.md; the file path originates
 * from first-party content but is still treated as text.
 *
 * @param {ContentLoadError|Error} error The caught content load failure. The
 *   file name is read from `error.file` when present; `error.message` is used
 *   as the human-readable explanation, falling back to a generic message.
 * @param {HTMLElement} mountEl The app/main region to append the error to.
 * @returns {HTMLElement|null} The appended `.block--error` element, or `null`
 *   when `mountEl` is absent.
 */
export function renderError(error, mountEl) {
  if (!mountEl) return null;

  const block = el("div", "block block--error");

  // Name the affected file so a maintainer knows what to fix (R15.1). The file
  // path is first-party but is still written as text, never HTML.
  const file =
    error && typeof error.file === "string" && error.file.length > 0
      ? error.file
      : null;

  const message =
    error && typeof error.message === "string" && error.message.length > 0
      ? error.message
      : file
        ? `Could not load "${file}".`
        : "Could not load content.";

  block.appendChild(el("p", "block--error__message", message));

  if (file) {
    block.appendChild(el("p", "block--error__file", `File: ${file}`));
  }

  // file:// fetch block: link to the Project Guide's static-server tip (R15.5).
  // The fix here is to serve the folder, not to edit the file, so surface the
  // instructions directly as a link.
  if (error && error.isFileProtocolBlock === true) {
    const hint = el("p", "block--error__hint");
    hint.appendChild(
      document.createTextNode("Local file access was blocked. See the "),
    );
    const link = el(
      "a",
      "block--error__link",
      "Project Guide's static-server instructions",
    );
    link.setAttribute("href", PROJECT_GUIDE_URL);
    hint.appendChild(link);
    hint.appendChild(
      document.createTextNode(" to serve this folder over a static server."),
    );
    block.appendChild(hint);
  }

  mountEl.appendChild(block);
  return block;
}
