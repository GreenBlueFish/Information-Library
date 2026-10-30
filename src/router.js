// src/router.js
//
// Router (design.md — Component 1).
//
// Maps the URL hash to a node in the topic tree and the page file that backs
// it, supporting arbitrary nesting depth. This is the only component that knows
// how a hash string becomes a position in the `topics.json` tree, so every
// other component (renderer, nav, breadcrumb) consumes a resolved route rather
// than parsing hashes itself.
//
// Responsibilities (design.md):
//   - Parse `#/a/b/c` into `["a","b","c"]`.
//   - Walk the topic tree to find the node and its ancestors (for breadcrumbs).
//   - Fall back to the home route when the hash is empty or unresolved.
//
// Requirements:
//   2.1 parse `#/a/b/c` into ordered slug segments
//   2.2 resolve a route to a node, its page file, and its ancestor chain
//   2.4 empty/unresolved hash falls back to the home route
//   2.5 subscribe to hash changes so navigation re-resolves without a reload
//   2.6 resolve a node at any depth by joining ancestor slugs
//   11.1 a new node resolves without editing existing nodes/pages (additive)
//   11.3 a leaf topic carries a `page` reference to its backing content
//   11.4 a leaf topic lacking a `page` is invalid — no route, surface an error
//   11.5 slug matches `^[a-z0-9]+(-[a-z0-9]+)*$` and is unique among siblings
//   11.6 a bad or duplicate slug is rejected — existing routes unchanged, error surfaced

/**
 * A single node in the topic tree (design.md — Model 1: TopicNode).
 *
 * @typedef {Object} TopicNode
 * @property {string} slug        URL-safe id, unique among siblings ("neuron-models").
 * @property {string} title       Human title ("Neuron Models").
 * @property {string} [summary]   One-line description shown in nav/home cards.
 * @property {string} [page]      Path to this node's page JSON (omit for pure groupings).
 * @property {TopicNode[]} [children] Nested subtopics (recursive, any depth).
 */

/**
 * The result of resolving a hash route against the topic tree.
 *
 * @typedef {Object} RouteResolution
 * @property {string[]} path      Slug segments, e.g. ["snn","neuron-models"].
 * @property {TopicNode} node     The resolved node from the topic tree.
 * @property {string} pageFile    Path to the page JSON for this node.
 * @property {TopicNode[]} crumbs Ancestor chain for breadcrumb rendering,
 *   root-first and ending with the resolved node itself.
 */

/**
 * A validation problem found while resolving a route. Surfaced (not thrown) so
 * the runtime can render a non-fatal error indication identifying the offender
 * while leaving every other route usable.
 *
 * @typedef {Object} RouteError
 * @property {"missing-page"|"bad-slug"|"duplicate-slug"} kind Why it is invalid.
 * @property {string} slug        The offending node's slug.
 * @property {string[]} path      Slug path to the offender (ancestors + offender).
 * @property {string} message     Friendly, human-readable description.
 */

/**
 * The slug pattern every TopicNode must satisfy (Requirement 11.5): lowercase
 * alphanumerics in dash-separated groups, with no leading/trailing/double dash.
 * @type {RegExp}
 */
export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * The home route resolution: an empty path with no node. Every empty or
 * unresolved hash falls back to this (Requirement 2.4). The renderer treats a
 * null `node`/`pageFile` as "show the Home_Page".
 * @type {RouteResolution}
 */
const HOME_ROUTE = Object.freeze({
  path: [],
  node: /** @type {any} */ (null),
  pageFile: /** @type {any} */ (null),
  crumbs: Object.freeze([]),
});

/**
 * Parse a URL hash into its ordered slug segments (Requirement 2.1).
 *
 * Accepts the shapes a browser actually produces: `""`, `"#"`, `"#/"`,
 * `"#/a/b/c"`, and tolerates a missing leading `#` or `/`, a trailing slash,
 * and empty segments from doubled slashes. Segments are URL-decoded so a hash
 * copied from the address bar round-trips.
 *
 * `parseHash("#/snn/neuron-models")` → `["snn","neuron-models"]`
 * `parseHash("")` → `[]` (home)
 *
 * @param {string} hash The `location.hash` value (or any hash-like string).
 * @returns {string[]} Ordered slug segments; empty array for the home route.
 */
export function parseHash(hash) {
  if (typeof hash !== "string") return [];

  // Drop a single leading '#', then a single leading '/', so "#/a/b" → "a/b".
  let s = hash;
  if (s.startsWith("#")) s = s.slice(1);
  if (s.startsWith("/")) s = s.slice(1);

  if (s === "") return [];

  return s
    .split("/")
    .map((seg) => decodeSegment(seg).trim())
    .filter((seg) => seg.length > 0);
}

/**
 * Decode a single hash segment, tolerating malformed percent-encoding by
 * falling back to the raw segment rather than throwing.
 * @param {string} seg
 * @returns {string}
 */
function decodeSegment(seg) {
  try {
    return decodeURIComponent(seg);
  } catch {
    return seg;
  }
}

/**
 * Resolve slug segments to a node in the topic tree (Requirements 2.2, 2.6).
 *
 * Walks the tree from the root's children, matching one slug segment per level,
 * so a node at any depth resolves by joining ancestor slugs into the full path.
 * Builds the ancestor chain (root-first, ending with the resolved node) for
 * breadcrumb rendering.
 *
 * Validation, performed only along the walked path so an unrelated bad node
 * never breaks a good route (Requirements 11.4, 11.6):
 *   - Every node on the path must have a slug matching {@link SLUG_PATTERN} and
 *     be unique among its siblings; a violation rejects the route.
 *   - The resolved target, if it is a leaf (no children), must carry a `page`;
 *     a leaf without one is invalid.
 *
 * On any violation this returns `null` and, when an `onError` sink is provided,
 * reports a {@link RouteError} identifying the offender — existing routes are
 * left unchanged because resolution is read-only.
 *
 * @param {TopicNode} tree The root topic tree (its `children` are the topics).
 * @param {string[]} segments Ordered slug segments from {@link parseHash}.
 * @param {(error: RouteError) => void} [onError] Optional sink for surfaced
 *   validation errors; called once per offending node encountered on the path.
 * @returns {RouteResolution | null} The resolution, or `null` when the segments
 *   do not resolve to a valid node.
 */
export function resolveRoute(tree, segments, onError) {
  const report = typeof onError === "function" ? onError : () => {};

  // An empty/absent path, or an absent tree, is the home route (Req 2.4).
  if (!tree || !Array.isArray(segments) || segments.length === 0) {
    return HOME_ROUTE;
  }

  /** @type {TopicNode[]} */
  const crumbs = [];
  let siblings = Array.isArray(tree.children) ? tree.children : [];
  /** @type {TopicNode | null} */
  let current = null;

  for (let depth = 0; depth < segments.length; depth++) {
    const wanted = segments[depth];
    const pathSoFar = segments.slice(0, depth + 1);

    // Validate the sibling set we are about to search. A bad or duplicate slug
    // among these siblings rejects the route and names the offender (Req 11.6),
    // without mutating anything (existing routes stay intact).
    if (!validateSiblings(siblings, segments.slice(0, depth), report)) {
      return null;
    }

    const match = siblings.find((child) => child && child.slug === wanted);
    if (!match) {
      // No child with this slug at this depth — the route does not resolve.
      return null;
    }

    crumbs.push(match);
    current = match;
    siblings = Array.isArray(match.children) ? match.children : [];

    // Guard against a resolved segment whose own slug is malformed even though
    // a caller handed us matching text (defensive; validateSiblings covers the
    // normal path). pathSoFar names the offender for the error indication.
    if (!SLUG_PATTERN.test(match.slug)) {
      report({
        kind: "bad-slug",
        slug: match.slug,
        path: pathSoFar,
        message: `Invalid slug "${match.slug}" at /${pathSoFar.join("/")}: ` +
          `slugs must match ${SLUG_PATTERN}.`,
      });
      return null;
    }
  }

  // `current` is non-null here because segments.length >= 1 and we returned on
  // any non-match above.
  const node = /** @type {TopicNode} */ (current);

  // A leaf topic (no children) must carry a `page` reference (Req 11.3/11.4).
  const isLeaf = !Array.isArray(node.children) || node.children.length === 0;
  if (isLeaf && !node.page) {
    report({
      kind: "missing-page",
      slug: node.slug,
      path: segments.slice(),
      message: `Topic "${node.slug}" at /${segments.join("/")} is a leaf but ` +
        `has no "page"; it cannot be rendered.`,
    });
    return null;
  }

  // A non-leaf grouping without its own page is still a valid route target; the
  // renderer shows its children. Only resolve `pageFile` when a page exists.
  return {
    path: segments.slice(),
    node,
    pageFile: node.page ?? /** @type {any} */ (null),
    crumbs,
  };
}

/**
 * Validate a set of sibling nodes for slug pattern and uniqueness (Req 11.5),
 * surfacing a {@link RouteError} for each offender (Req 11.6). Returns `false`
 * as soon as an offender is found so the route is rejected; existing nodes are
 * never mutated.
 *
 * @param {TopicNode[]} siblings The sibling set being searched at one depth.
 * @param {string[]} ancestorPath Slug path to the parent (for error reporting).
 * @param {(error: RouteError) => void} report Error sink.
 * @returns {boolean} `true` when every sibling slug is valid and unique.
 */
function validateSiblings(siblings, ancestorPath, report) {
  const seen = new Set();
  let ok = true;

  for (const child of siblings) {
    const slug = child ? child.slug : undefined;
    const offenderPath = ancestorPath.concat(slug ?? "");

    if (typeof slug !== "string" || !SLUG_PATTERN.test(slug)) {
      report({
        kind: "bad-slug",
        slug: /** @type {any} */ (slug),
        path: offenderPath,
        message: `Invalid slug "${slug}" under /${ancestorPath.join("/") || ""}: ` +
          `slugs must match ${SLUG_PATTERN}.`,
      });
      ok = false;
      continue;
    }

    if (seen.has(slug)) {
      report({
        kind: "duplicate-slug",
        slug,
        path: offenderPath,
        message: `Duplicate slug "${slug}" under /${ancestorPath.join("/") || ""}: ` +
          `slugs must be unique among siblings.`,
      });
      ok = false;
      continue;
    }
    seen.add(slug);
  }

  return ok;
}

/**
 * Subscribe to hash-driven route changes (Requirement 2.5).
 *
 * Registers `handler` for the window's `hashchange` event so the runtime can
 * re-resolve and re-render without a full page reload. The handler is invoked
 * with the current slug segments (already parsed via {@link parseHash}) for
 * convenience. Returns an unsubscribe function for teardown (useful in tests
 * and for teardown symmetry with the widget lifecycle).
 *
 * @param {(segments: string[]) => void} handler Called on every hash change.
 * @returns {() => void} Unsubscribe function that detaches the listener.
 */
export function onRouteChange(handler) {
  if (typeof window === "undefined") {
    // Non-browser context (e.g. a test runner without a DOM): nothing to wire.
    return () => {};
  }

  const listener = () => {
    handler(parseHash(window.location.hash));
  };

  window.addEventListener("hashchange", listener);
  return () => window.removeEventListener("hashchange", listener);
}
