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
// page content from JSON), 4.1 (content/terms/index.json is the authoritative
// Manifest of Glossary_Files), 4.3 (glossaries load through the shared cache).

/**
 * Canonical content paths. Kept here so the rest of the runtime refers to
 * content by intent ("topics", "terms") rather than hard-coding URLs.
 */
export const TOPICS_URL = "content/topics.json";

/**
 * The Manifest — `content/terms/index.json` — the authoritative list of every
 * Glossary_File as `{ scope, file }` entries. Because the site has no build
 * step and a browser cannot list folders, this file is what the loader fetches
 * at boot to learn which glossaries exist (Requirement 4.1, 1.4).
 */
export const MANIFEST_URL = "content/terms/index.json";

/**
 * One Glossary_File record in the Manifest.
 * @typedef {Object} ManifestEntry
 * @property {string} scope `/` or a route that resolves in `topics.json`.
 * @property {string} file  The Glossary_File path (obeys the Path_Rule).
 */

/**
 * The parsed Manifest: the authoritative list of Glossary_Files.
 * @typedef {Object} Manifest
 * @property {ManifestEntry[]} glossaries Every Glossary_File, by `{scope,file}`.
 */

/**
 * A term record. Its schema (`PROJECT_GUIDE §3.3`) is unchanged by this
 * feature. On disk a Glossary_File entry has NO `source` field; the loader may
 * attach one at runtime on a COPY it returns (Requirement 1.6).
 * @typedef {Object} TermEntry
 * @property {string} term
 * @property {string[]} [aliases]
 * @property {string} [acronym]
 * @property {string} definition
 * @property {string|null} pageRef
 * @property {SourceAnnotation} [source] Runtime-only; never written to disk.
 */

/**
 * The runtime-only annotation attached to each loaded definition, naming the
 * glossary it came from so the UI can show "from <Topic>". It is NEVER written
 * into any Glossary_File on disk (Requirement 1.6, 4.7).
 * @typedef {Object} SourceAnnotation
 * @property {string} route The Manifest `scope` the glossary applies to.
 * @property {string} title That route's title from `topics.json`, or
 *   `"General"` for the `/` scope.
 */

/**
 * A successfully loaded Glossary_File: its path, the scope it applies to (the
 * Manifest `scope`, equal to `source.route`), the shared Source_Annotation, and
 * its entries with that annotation attached.
 * @typedef {Object} LoadedGlossary
 * @property {string} file  The Glossary_File path that was loaded.
 * @property {string} scope The scope the glossary applies to (`source.route`).
 * @property {SourceAnnotation} source The annotation attached to every entry.
 * @property {TermEntry[]} entries The loaded entries, each carrying `source`.
 */

/**
 * A Glossary_File that failed to load. Carries the typed `ContentLoadError` so
 * the UI can render a non-fatal note without the batch rejecting (R4.8, R8.9).
 * @typedef {Object} GlossaryFailure
 * @property {string} file  The Glossary_File path that failed.
 * @property {string} scope The scope the glossary would have applied to.
 * @property {ContentLoadError} error The typed load error.
 */

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
    // Revalidate with the server on every load: a simple static server (the
    // README's `python -m http.server`) sends no Cache-Control, so a browser
    // may otherwise reuse a stale terms.json and miss newly added terms
    // (issue #47: an old copy without VGA resolved "VGA" to VSA).
    response = await fetch(url, { cache: "no-cache" });
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
 * Load the topic tree. `content/topics.json` is the root; it lists the shelves,
 * each kept in a file of its own under `content/topics/` and named by a
 * `{ "file": ... }` stub in the root's `children`. Those stubs are replaced by
 * the shelf nodes they name, so callers get one ordinary tree. Memoized: the
 * same assembled tree object is returned on every call, which keeps the
 * per-tree caches (page order, scope chains) valid.
 * @returns {Promise<import("./router.js").TopicNode>} The root topic tree.
 * @throws {ContentLoadError}
 */
export function loadTopics() {
  if (!assembledTopics) {
    assembledTopics = loadJson(TOPICS_URL)
      .then((root) => assembleTopics(root, loadJson))
      .catch((err) => {
        assembledTopics = null;
        throw err;
      });
  }
  return /** @type {Promise<any>} */ (assembledTopics);
}

/** @type {Promise<any>|null} */
let assembledTopics = null;

/**
 * Replace every `{ "file": ... }` stub among `root.children` with the node that
 * file holds. Pure apart from `load`; the parsed root is not mutated.
 * @param {any} root The parsed `content/topics.json`.
 * @param {(url: string) => Promise<any>} load Loads and parses one JSON file.
 * @returns {Promise<any>} The assembled tree.
 */
export async function assembleTopics(root, load) {
  if (!root || !Array.isArray(root.children)) return root;
  const children = await Promise.all(
    root.children.map((child) =>
      child && typeof child.file === "string" && child.slug === undefined
        ? load(child.file)
        : child,
    ),
  );
  return { ...root, children };
}

/** The redirects map: old route → new route (`content/redirects.json`). */
export const REDIRECTS_URL = "content/redirects.json";

/**
 * Load the redirects map. A missing or broken file yields an empty map, since
 * redirects only rescue old links and must never stop the library loading.
 * @returns {Promise<Record<string, string>>}
 */
export async function loadRedirects() {
  try {
    const data = await loadJson(REDIRECTS_URL);
    return data && typeof data.redirects === "object" && data.redirects ? data.redirects : {};
  } catch {
    return {};
  }
}

/**
 * Where an old route now lives: the longest prefix of `segments` found in
 * `redirects` is swapped for its target, and the rest of the path kept. Returns
 * the new slug segments, or `null` when no prefix matches.
 * @param {Record<string, string>} redirects
 * @param {string[]} segments
 * @returns {string[]|null}
 */
export function redirectSegments(redirects, segments) {
  if (!redirects || !Array.isArray(segments)) return null;
  for (let i = segments.length; i > 0; i--) {
    const target = redirects["/" + segments.slice(0, i).join("/")];
    if (typeof target === "string") {
      const head = target.split("/").filter(Boolean);
      return head.concat(segments.slice(i));
    }
  }
  return null;
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
 * Load the Manifest from `content/terms/index.json` — the authoritative list of
 * every Glossary_File (Requirement 4.1). Fetched at boot; no Glossary_File is
 * fetched here. Memoized by URL via the existing `loadJson` cache.
 * @returns {Promise<Manifest>} The parsed Manifest.
 * @throws {ContentLoadError}
 */
export function loadManifest() {
  return /** @type {Promise<any>} */ (loadJson(MANIFEST_URL));
}

/**
 * Load one Glossary_File and return its entries with a runtime-only
 * Source_Annotation attached to each (Requirement 4.7). The on-disk schema has
 * no `source` field (Requirement 1.6), so this never mutates or re-writes the
 * JSON.
 *
 * Because `loadJson` memoizes the *parsed array* by URL (the same shared
 * reference is reused by every caller and across the session), attaching
 * `source` directly to those entries would corrupt the cached — and, by schema
 * contract, the on-disk — shape for everyone. Instead this returns a COPY
 * layer: a fresh array of shallow-copied entries, each carrying `source`. The
 * cached parsed array and its entries are left exactly as fetched.
 *
 * The caller (`main.js`) derives `source` from the Manifest `scope` and the
 * route's title in `topics.json` (`"General"` for `/`) and passes it in; the
 * loader does not read `topics.json` itself.
 *
 * @param {string} file The Glossary_File path (from a Manifest entry's `file`).
 * @param {SourceAnnotation} source The annotation to attach to every entry.
 * @returns {Promise<TermEntry[]>} The entries, each with `source` attached.
 * @throws {ContentLoadError} When the file is missing, blocked, or malformed.
 */
export async function loadGlossary(file, source) {
  const parsed = await loadJson(file);
  const entries = Array.isArray(parsed) ? parsed : [];
  // Copy layer: a new array of shallow-copied entries so `source` never lands
  // on the shared cached/on-disk objects (Requirement 1.6). `source` is frozen
  // and shared across the entries of one file — it is read-only metadata.
  const annotation = Object.freeze({ route: source.route, title: source.title });
  return entries.map((entry) => ({ ...entry, source: annotation }));
}

/**
 * Load several Glossary_Files in parallel, partitioning the outcomes into
 * successes and failures. Each entry is loaded via `loadGlossary`, and every
 * load is wrapped in `Promise.allSettled` so that one missing or malformed file
 * yields a `GlossaryFailure` while the rest still succeed — the batch itself
 * NEVER rejects (Requirements 4.8, 8.9, 8.10). This is what lets the lookup UI
 * degrade gracefully: `render()` builds its index from `results`, and the
 * Search_All flow shows the "Some topics couldn't be searched" note from
 * `failures`.
 *
 * The `scope` on each result/failure is taken from the entry's `source.route`
 * (the Manifest `scope`), so callers can correlate outcomes back to the chain.
 *
 * @param {Array<{ file: string, source: SourceAnnotation }>} entries The
 *   Glossary_Files to load, each with the Source_Annotation to attach.
 * @returns {Promise<{ results: LoadedGlossary[], failures: GlossaryFailure[] }>}
 *   Both the loaded glossaries and the typed failures; never rejects.
 */
export async function loadGlossaries(entries) {
  const settled = await Promise.allSettled(
    entries.map(({ file, source }) => loadGlossary(file, source))
  );

  /** @type {LoadedGlossary[]} */
  const results = [];
  /** @type {GlossaryFailure[]} */
  const failures = [];

  settled.forEach((outcome, i) => {
    const { file, source } = entries[i];
    if (outcome.status === "fulfilled") {
      results.push({ file, scope: source.route, source, entries: outcome.value });
    } else {
      const reason = outcome.reason;
      const error = reason instanceof ContentLoadError
        ? reason
        : new ContentLoadError({
            file,
            kind: "fetch",
            cause: reason instanceof Error ? reason : null,
          });
      failures.push({ file, scope: source.route, error });
    }
  });

  return { results, failures };
}

/**
 * Clear the memoization cache. Intended for tests and for an explicit "reload
 * content" affordance; not used on the normal navigation path.
 * @returns {void}
 */
export function clearContentCache() {
  cache.clear();
  assembledTopics = null;
}
