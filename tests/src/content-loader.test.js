// tests/src/content-loader.test.js
//
// Unit tests for the Content Loader (src/content-loader.js) — design Component 2,
// Requirements 1.5 (topics.json is the single manifest), 3.1 (load a node's page
// content from JSON), 9.1 (terms.json is the single source of truth).
//
// The loader is the only place that touches `fetch`, so these tests drive it by
// stubbing `globalThis.fetch`. They verify the two behaviors the task calls out:
//
//   1. Cache-by-URL: two loads of the same URL share one fetch and return the
//      very same parsed object (memoization makes repeated navigation cheap).
//   2. Missing/malformed files surface the typed `ContentLoadError`:
//        - a thrown fetch and a non-ok response → kind "fetch"
//        - invalid JSON → kind "parse"

import { describe, it, expect } from "../harness.js";
import {
  loadJson,
  loadTopics,
  loadTerms,
  clearContentCache,
  ContentLoadError,
  TOPICS_URL,
  TERMS_URL,
} from "../../src/content-loader.js";

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
  describe("cache-by-URL (Req 1.5, 3.1, 9.1)", () => {
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
          loadJson("content/terms.json"),
          loadJson("content/terms.json"),
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
        const terms = await loadTerms();
        expect(topics).toEqual({ url: TOPICS_URL });
        expect(terms).toEqual({ url: TERMS_URL });
        expect(globalThis.fetch.callCount()).toBe(2);
      } finally {
        restore();
      }
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
