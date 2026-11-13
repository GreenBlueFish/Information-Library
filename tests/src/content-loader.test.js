// tests/src/content-loader.test.js
//
// Unit tests for the Content Loader (src/content-loader.js) — design Component 2,
// Requirements 1.5 (topics.json is the single manifest), 3.1 (load a node's page
// content from JSON), 4.1 (content/terms/index.json is the authoritative
// Manifest), 4.7 (a runtime-only Source_Annotation on each loaded definition),
// 4.8 (loadGlossaries returns successes AND failures), 4.9 (TERMS_URL/loadTerms
// are retired).
//
// The loader is the only place that touches `fetch`, so these tests drive it by
// stubbing `globalThis.fetch`. They verify:
//
//   1. Cache-by-URL: two loads of the same URL share one fetch and return the
//      very same parsed object (memoization makes repeated navigation cheap).
//   2. Missing/malformed files surface the typed `ContentLoadError`:
//        - a thrown fetch and a non-ok response → kind "fetch"
//        - invalid JSON → kind "parse"
//   3. loadManifest fetches the Manifest URL, memoized.
//   4. loadGlossary attaches a runtime-only `source` on a COPY, never mutating
//      the shared cached parsed array.
//   5. loadGlossaries partitions successes from failures via allSettled and
//      never rejects, even when a file fails to load.
//   6. The retired `TERMS_URL`/`loadTerms` names are no longer exported.

import { describe, it, expect } from "../harness.js";
import {
  loadJson,
  loadTopics,
  loadManifest,
  loadGlossary,
  loadGlossaries,
  clearContentCache,
  ContentLoadError,
  TOPICS_URL,
  MANIFEST_URL,
} from "../../src/content-loader.js";
// The whole module namespace, so we can assert the retired names are gone.
import * as contentLoader from "../../src/content-loader.js";

/** Remember the real fetch so each test can restore it and stay isolated. */
const realFetch = globalThis.fetch;

/**
 * Install a fetch stub for the duration of one test.
 * @param {(url: string) => Response | Promise<Response>} impl
 * @returns {() => void} a restore function
 */
function stubFetch(impl) {
  let calls = 0;
  globalThis.fetch = async (url) => {
    calls++;
    return impl(url);
  };
  globalThis.fetch.callCount = () => calls;
  return () => {
    globalThis.fetch = realFetch;
  };
}

/** Build a minimal ok JSON Response (works in modern Node's global Response). */
function jsonResponse(value) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("content-loader", () => {
  describe("cache-by-URL (Req 1.5, 3.1)", () => {
    it("returns the same parsed object on repeated loads and fetches once", async () => {
      clearContentCache();
      const payload = { slug: "root", title: "Library of Alexandria" };
      const restore = stubFetch(() => jsonResponse(payload));
      try {
        const first = await loadJson("content/topics.json");
        const second = await loadJson("content/topics.json");

        // Same URL → identical cached parsed object (reference equality), not
        // just a deep-equal copy.
        expect(first).toBe(second);
        expect(first).toEqual(payload);
        // One underlying fetch for two loads of the same URL.
        expect(globalThis.fetch.callCount()).toBe(1);
      } finally {
        restore();
      }
    });

    it("shares a single in-flight fetch for concurrent loads of the same URL", async () => {
      clearContentCache();
      const restore = stubFetch(() => jsonResponse({ ok: true }));
      try {
        const [a, b] = await Promise.all([
          loadJson("content/terms/_root.json"),
          loadJson("content/terms/_root.json"),
        ]);
        expect(a).toBe(b);
        expect(globalThis.fetch.callCount()).toBe(1);
      } finally {
        restore();
      }
    });

    it("caches per URL: different URLs are fetched independently", async () => {
      clearContentCache();
      const restore = stubFetch((url) => jsonResponse({ url }));
      try {
        const topics = await loadTopics();
        const manifest = await loadManifest();
        expect(topics).toEqual({ url: TOPICS_URL });
        expect(manifest).toEqual({ url: MANIFEST_URL });
        expect(globalThis.fetch.callCount()).toBe(2);
      } finally {
        restore();
      }
    });
  });

  describe("loadManifest (Req 4.1)", () => {
    it("fetches the Manifest URL and parses it", async () => {
      clearContentCache();
      const manifest = {
        glossaries: [
          { scope: "/", file: "content/terms/_root.json" },
          { scope: "/analog-design", file: "content/terms/analog-design.json" },
        ],
      };
      let fetched;
      const restore = stubFetch((url) => {
        fetched = url;
        return jsonResponse(manifest);
      });
      try {
        const result = await loadManifest();
        expect(fetched).toBe(MANIFEST_URL);
        expect(MANIFEST_URL).toBe("content/terms/index.json");
        expect(result).toEqual(manifest);
      } finally {
        restore();
      }
    });

    it("memoizes: a second call reuses the cached parse without re-fetching", async () => {
      clearContentCache();
      const manifest = { glossaries: [] };
      const restore = stubFetch(() => jsonResponse(manifest));
      try {
        const first = await loadManifest();
        const second = await loadManifest();
        // Same cached parsed object, one fetch for both calls.
        expect(first).toBe(second);
        expect(globalThis.fetch.callCount()).toBe(1);
      } finally {
        restore();
      }
    });
  });

  describe("loadGlossary source annotation (Req 4.7, 1.6)", () => {
    it("attaches a runtime-only source {route, title} to every returned entry", async () => {
      clearContentCache();
      const onDisk = [
        { term: "MOSFET", definition: "A field-effect transistor.", pageRef: null },
        { term: "Cascode", definition: "A two-transistor stage.", pageRef: "/analog-design" },
      ];
      const restore = stubFetch(() => jsonResponse(onDisk));
      try {
        const source = { route: "/analog-design", title: "Analog Design" };
        const entries = await loadGlossary("content/terms/analog-design.json", source);

        expect(entries.length).toBe(2);
        for (const entry of entries) {
          expect(entry.source).toEqual(source);
          expect(entry.source.route).toBe("/analog-design");
          expect(entry.source.title).toBe("Analog Design");
        }
        // The underlying term data is carried through unchanged.
        expect(entries[0].term).toBe("MOSFET");
        expect(entries[1].pageRef).toBe("/analog-design");
      } finally {
        restore();
      }
    });

    it("returns a COPY: it never mutates the cached parsed array or its entries", async () => {
      clearContentCache();
      const onDisk = [
        { term: "Gain", definition: "Output over input.", pageRef: null },
      ];
      const restore = stubFetch(() => jsonResponse(onDisk));
      try {
        const file = "content/terms/analog-design.json";
        // Grab the shared cached parsed array directly through loadJson.
        const cached = await loadJson(file);
        const entries = await loadGlossary(file, { route: "/analog-design", title: "Analog Design" });

        // The returned entries carry `source`...
        expect(entries[0].source.route).toBe("/analog-design");
        // ...but the cached on-disk shape has NO `source` field (Req 1.6).
        expect(cached[0].source).toBe(undefined);
        // And the returned entry is a distinct object, not the cached one.
        expect(entries[0]).toEqual({
          term: "Gain",
          definition: "Output over input.",
          pageRef: null,
          source: { route: "/analog-design", title: "Analog Design" },
        });
        expect(Object.is(entries[0], cached[0])).toBe(false);
      } finally {
        restore();
      }
    });
  });

  describe("loadGlossaries successes and failures (Req 4.8)", () => {
    it("returns both results and failures without rejecting when a file fails", async () => {
      clearContentCache();
      const good = [{ term: "Noise", definition: "Random fluctuation.", pageRef: null }];
      const restore = stubFetch((url) => {
        if (url === "content/terms/analog-design.json") return jsonResponse(good);
        // A non-ok response → the loader throws a typed ContentLoadError.
        return new Response("not found", { status: 404, statusText: "Not Found" });
      });
      try {
        const { results, failures } = await loadGlossaries([
          { file: "content/terms/analog-design.json", source: { route: "/analog-design", title: "Analog Design" } },
          { file: "content/terms/missing.json", source: { route: "/missing", title: "Missing" } },
        ]);

        // One loaded glossary, carrying its scope, source, and annotated entries.
        expect(results.length).toBe(1);
        expect(results[0].file).toBe("content/terms/analog-design.json");
        expect(results[0].scope).toBe("/analog-design");
        expect(results[0].entries[0].term).toBe("Noise");
        expect(results[0].entries[0].source.route).toBe("/analog-design");

        // One typed failure, correlated back by file and scope.
        expect(failures.length).toBe(1);
        expect(failures[0].file).toBe("content/terms/missing.json");
        expect(failures[0].scope).toBe("/missing");
        expect(failures[0].error).toBeInstanceOf(ContentLoadError);
        expect(failures[0].error.kind).toBe("fetch");
      } finally {
        restore();
      }
    });

    it("never rejects even when every file fails to load", async () => {
      clearContentCache();
      const restore = stubFetch(() => {
        throw new TypeError("Failed to fetch");
      });
      try {
        // If loadGlossaries rejected, this await would throw and fail the test.
        const { results, failures } = await loadGlossaries([
          { file: "content/terms/a.json", source: { route: "/a", title: "A" } },
          { file: "content/terms/b.json", source: { route: "/b", title: "B" } },
        ]);
        expect(results.length).toBe(0);
        expect(failures.length).toBe(2);
        expect(failures[0].error).toBeInstanceOf(ContentLoadError);
        expect(failures[1].error).toBeInstanceOf(ContentLoadError);
      } finally {
        restore();
      }
    });

    it("returns all successes when every file loads", async () => {
      clearContentCache();
      const restore = stubFetch((url) => jsonResponse([{ term: url, definition: "d", pageRef: null }]));
      try {
        const { results, failures } = await loadGlossaries([
          { file: "content/terms/_root.json", source: { route: "/", title: "General" } },
          { file: "content/terms/analog-design.json", source: { route: "/analog-design", title: "Analog Design" } },
        ]);
        expect(results.length).toBe(2);
        expect(failures.length).toBe(0);
        expect(results[0].scope).toBe("/");
        expect(results[0].source.title).toBe("General");
        expect(results[1].scope).toBe("/analog-design");
      } finally {
        restore();
      }
    });
  });

  describe("retired exports (Req 4.9)", () => {
    it("no longer exports TERMS_URL or loadTerms", () => {
      expect(contentLoader.TERMS_URL).toBe(undefined);
      expect(contentLoader.loadTerms).toBe(undefined);
    });
  });

  describe("typed errors for missing/malformed files (Req 3.1)", () => {
    it("surfaces a ContentLoadError (kind 'fetch') when fetch throws (missing/blocked)", async () => {
      clearContentCache();
      const restore = stubFetch(() => {
        throw new TypeError("Failed to fetch");
      });
      try {
        const err = await expect(() => loadJson("content/missing.json")).toThrow(ContentLoadError);
        expect(err).toBeInstanceOf(ContentLoadError);
        expect(err.kind).toBe("fetch");
        expect(err.file).toBe("content/missing.json");
      } finally {
        restore();
      }
    });

    it("surfaces a ContentLoadError (kind 'fetch') on a non-ok response", async () => {
      clearContentCache();
      const restore = stubFetch(
        () => new Response("not found", { status: 404, statusText: "Not Found" })
      );
      try {
        const err = await expect(() => loadJson("content/gone.json")).toThrow(ContentLoadError);
        expect(err.kind).toBe("fetch");
        expect(err.file).toBe("content/gone.json");
      } finally {
        restore();
      }
    });

    it("surfaces a ContentLoadError (kind 'parse') on malformed JSON", async () => {
      clearContentCache();
      const restore = stubFetch(
        () => new Response("{ this is : not json", { status: 200 })
      );
      try {
        const err = await expect(() => loadJson("content/broken.json")).toThrow(ContentLoadError);
        expect(err.kind).toBe("parse");
        expect(err.file).toBe("content/broken.json");
      } finally {
        restore();
      }
    });

    it("does not cache failures: a later load re-fetches and can succeed", async () => {
      clearContentCache();
      let attempt = 0;
      const restore = stubFetch(() => {
        attempt++;
        if (attempt === 1) throw new TypeError("transient failure");
        return jsonResponse({ recovered: true });
      });
      try {
        await expect(() => loadJson("content/retry.json")).toThrow(ContentLoadError);
        // Failed loads are evicted, so the next navigation retries the fetch.
        const value = await loadJson("content/retry.json");
        expect(value).toEqual({ recovered: true });
        expect(globalThis.fetch.callCount()).toBe(2);
      } finally {
        restore();
      }
    });
  });
});
