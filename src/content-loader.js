// src/content-loader.js
//
// Content Loader (design.md — Component 2).
//
// The single place that touches the "filesystem" (via `fetch`). It fetches and
// parses JSON content, memoizes parsed results by URL so repeated navigation is
// cheap, and surfaces a typed, friendly error when a file is missing or
// malformed. Later error-handling tasks (R15) consume `ContentLoadError` to
// render non-fatal inline error blocks — including the `file://` fetch-block
// case that links to the Project Guide's static-server tip.
//
// Requirements: 1.5 (topics.json is the single manifest), 3.1 (load a node's
// page content from JSON), 9.1 (terms.json is the single source of truth).

/**
 * Canonical content paths. Kept here so the rest of the runtime refers to
 * content by intent ("topics", "terms") rather than hard-coding URLs.
 */
export const TOPICS_URL = "content/topics.json";
export const TERMS_URL = "content/terms.json";

/**
 * A typed, friendly error for a content file that could not be fetched or
 * parsed. Carries the affected file path and whether the failure looks like a
 * browser blocking `fetch` under the `file://` protocol, so the error-handling
 * layer can name the file and, when relevant, link to the static-server tip.
 *
 * @property {string} file         The path/URL that failed to load.
 * @property {"fetch"|"parse"} kind Why it failed: network/fetch vs. JSON parse.
 * @property {boolean} isFileProtocolBlock True when the failure is consistent
 *   with a `file://` fetch block (see Requirement 15.5).
 * @property {Error|null} cause    The underlying error, when available.
 */
export class ContentLoadError extends Error {
  /**
   * @param {object} opts
   * @param {string} opts.file
   * @param {"fetch"|"parse"} opts.kind
   * @param {boolean} [opts.isFileProtocolBlock]
   * @param {Error|null} [opts.cause]
   * @param {string} [opts.message]
   */
  constructor({ file, kind, isFileProtocolBlock = false, cause = null, message }) {
    super(message ?? defaultMessage(file, kind, isFileProtocolBlock));
    this.name = "ContentLoadError";
    this.file = file;
    this.kind = kind;
    this.isFileProtocolBlock = isFileProtocolBlock;
    this.cause = cause;
  }
}

/**
 * Build a friendly, human-readable message for a load failure.
 * @param {string} file
 * @param {"fetch"|"parse"} kind
 * @param {boolean} isFileProtocolBlock
 * @returns {string}
 */
function defaultMessage(file, kind, isFileProtocolBlock) {
  if (isFileProtocolBlock) {
    return `Could not load "${file}": the browser blocked local file access. ` +
      `Serve this folder with a static server (see the Project Guide).`;
  }
  if (kind === "parse") {
    return `Could not parse "${file}": the file is not valid JSON.`;
  }
  return `Could not load "${file}": the file is missing or could not be fetched.`;
}

/**
 * Detect whether we are running under the `file://` protocol, where many
 * browsers block `fetch` of local resources. Guarded so the module is safe to
 * import in non-browser contexts (e.g. test runners without `location`).
 * @returns {boolean}
 */
function isFileProtocol() {
  return typeof location !== "undefined" && location.protocol === "file:";
}

/**
 * Memoization cache keyed by URL. Stores the in-flight/settled Promise so two
 * near-simultaneous loads of the same URL share one fetch, and a successful
 * result is reused on every later navigation. Failed loads are evicted so a
 * later navigation (after the file is fixed) re-fetches.
 * @type {Map<string, Promise<unknown>>}
 */
const cache = new Map();

/**
 * Fetch + parse a JSON file once per URL, memoized by URL.
 *
 * @param {string} url Path to the JSON file (relative to index.html).
 * @returns {Promise<unknown>} The parsed JSON value.
 * @throws {ContentLoadError} When the file is missing, blocked, or malformed.
 */
export function loadJson(url) {
  const existing = cache.get(url);
  if (existing) return existing;

  const pending = fetchAndParse(url).catch((err) => {
    // Do not cache failures: a later navigation should retry once the file is
    // added or fixed (cache is keyed by URL; see design Error Handling).
    cache.delete(url);
    throw err;
  });

  cache.set(url, pending);
  return pending;
}

/**
 * The actual fetch + parse, with failures normalized to ContentLoadError.
 * @param {string} url
 * @returns {Promise<unknown>}
 */
async function fetchAndParse(url) {
  let response;
  try {
    response = await fetch(url);
  } catch (cause) {
    // A thrown fetch (as opposed to a non-ok response) under file:// is the
    // classic local-access block; flag it so the UI can link to the tip.
    throw new ContentLoadError({
      file: url,
      kind: "fetch",
      isFileProtocolBlock: isFileProtocol(),
      cause: cause instanceof Error ? cause : null,
    });
  }

  if (!response.ok) {
    throw new ContentLoadError({
      file: url,
      kind: "fetch",
      isFileProtocolBlock: false,
      message: `Could not load "${url}": server responded ${response.status} ${response.statusText}.`,
    });
  }

  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch (cause) {
    throw new ContentLoadError({
      file: url,
      kind: "parse",
      cause: cause instanceof Error ? cause : null,
    });
  }
}

/**
 * Load the topic tree from `content/topics.json` — the single manifest of
 * topics (Requirement 1.5). Memoized by URL.
 * @returns {Promise<import("./router.js").TopicNode>} The root topic tree.
 * @throws {ContentLoadError}
 */
export function loadTopics() {
  return /** @type {Promise<any>} */ (loadJson(TOPICS_URL));
}

/**
 * Load a single page's content from its JSON file (Requirement 3.1).
 * Memoized by URL.
 * @param {string} pageFile Path to the page JSON (from a TopicNode's `page`).
 * @returns {Promise<object>} The parsed PageContent.
 * @throws {ContentLoadError}
 */
export function loadPage(pageFile) {
  return /** @type {Promise<any>} */ (loadJson(pageFile));
}

/**
 * Load the lookup table from `content/terms.json` — the single source of truth
 * for definitions (Requirement 9.1). Memoized by URL.
 * @returns {Promise<Array<object>>} The parsed array of TermEntry records.
 * @throws {ContentLoadError}
 */
export function loadTerms() {
  return /** @type {Promise<any>} */ (loadJson(TERMS_URL));
}

/**
 * Clear the memoization cache. Intended for tests and for an explicit "reload
 * content" affordance; not used on the normal navigation path.
 * @returns {void}
 */
export function clearContentCache() {
  cache.clear();
}
