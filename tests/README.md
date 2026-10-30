# Tests (dev-only)

These tests are **optional** and dev-only. The Alexandria site runs and is
extensible without them, and there is still **no build step** — the tests are
plain ES modules, just like the runtime.

## Running

The suite runs on any modern JavaScript runtime that provides the standard
`fetch`/`Response`/`Promise` globals. With Node.js (v18+, which ships a global
`fetch` and `Response`):

```sh
node tests/run.js
```

`tests/run.js` discovers every `*.test.js` file under `tests/` (recursively),
imports each one (which registers its cases via `tests/harness.js`), runs them,
prints a pass/fail summary, and exits non-zero if anything failed. A file that
cannot be imported (a missing module, an error at top level) counts as one
failing `imports` case under its name; the other files still run.

> No install, no package manager, no framework. If `node` is not available,
> any runtime with the standard web globals (e.g. Deno via
> `deno run -A tests/run.js`) works as well.

## Layout

```
tests/
├── harness.js                     # tiny describe/it/expect + run()
├── run.js                         # discovers and runs *.test.js, sets exit code
├── README.md                      # this file
└── src/                           # mirrors the src/ tree under test
    ├── content-loader.test.js     # unit tests for src/content-loader.js
    ├── router.test.js             # unit tests for src/router.js
    ├── renderer.test.js           # unit tests for src/renderer.js (uses a DOM stub)
    ├── lookup/                     # property tests for the lookup index
    └── widgets/                    # unit tests for the widget framework
        ├── registry.test.js        # unit tests for src/widgets/registry.js
        └── parameter-plot.test.js  # unit tests for src/widgets/types/parameter-plot.js
```

Test files mirror the `src/` path of the module they cover and use the
`.test.js` suffix.

### Running tests that need a DOM (no build step, no install)

`src/renderer.js` (and the Widget Registry it imports) build DOM through the
`document` global, but `node tests/run.js` has no `document`. Rather than fetch
a DOM over the network — which would make a pure-structure test depend on CDN
access — `renderer.test.js` installs a **minimal hand-rolled `document` stub**
on `globalThis.document` before importing the module under test. The stub
implements exactly the surface the renderer and registry use (`createElement`
plus, per element, `className` / `textContent` / `setAttribute` /
`getAttribute` / `appendChild` / `replaceChildren` / `ownerDocument` /
`children`). Text set via `textContent` is stored as a literal string and never
parsed, which is precisely the behavior Requirements 3.4/3.7/3.10 assert
(embedded markup stays literal text, not a parsed child element). This keeps the
dev-only tests install-free and offline, consistent with the project's no-build
constraint. If a future test needs richer DOM behavior, swap the stub for a DOM
loaded as an ES module (e.g. `linkedom` from the jsDelivr ESM CDN, matching the
fast-check convention above) — assign its `document` to `globalThis.document`
before importing the module under test.

### Widget tests reuse the shared `tests/dom.js` helper

The widget framework tests (`registry.test.js`, `parameter-plot.test.js`) are
the "richer DOM behavior" case noted above: the shared plotting primitive builds
**SVG** nodes via `createElementNS`, and `parameter-plot` relies on `classList`,
live `input` events (`addEventListener` + `dispatchEvent`),
`querySelector`/`querySelectorAll`, and real input `value`/`hidden` semantics —
more than the hand-rolled stub models. Faking all of that risks a stub that
quietly diverges from real DOM semantics and lets a test pass on wrong behavior,
so these tests reuse the suite's shared `tests/dom.js` helper, which installs a
**real** DOM — `linkedom`, loaded as an ES module from the jsDelivr ESM CDN
exactly like `fast-check` above (no build step, no install; see the fast-check
note below for how the HTTPS specifier is loaded from `tests/vendor/`).

A test awaits `ensureDom()` once at module scope and then uses `dom.freshMount()`
for a detached container per case:

```js
import { ensureDom } from "../../dom.js";
const dom = await ensureDom();
// … dom.freshMount() returns a fresh detached <div> to mount into.
```

## Writing a test

```js
import { describe, it, expect } from "../harness.js";
import { thing } from "../../src/thing.js";

describe("thing", () => {
  it("does the thing", () => {
    expect(thing(2)).toBe(4);
  });
});
```

Property-based tests (later tasks) use **fast-check**, loaded as an ES module
per the design's testing strategy.

### Loading fast-check (no build step)

Consistent with the no-build-step constraint, property tests import fast-check
as an ES module directly from the jsDelivr ESM CDN:

```js
import * as fc from "https://cdn.jsdelivr.net/npm/fast-check/+esm";
```

Node does not load `https://` specifiers on its own, so `scripts/hive-test.sh`
runs the suite with `--import ./tests/net/register.js`, whose hooks
(`tests/net/hooks.js`) load each such module from its committed copy in
`tests/vendor/` — fast-check, linkedom and everything they import. The suite
therefore runs offline, with no install, on the same library versions every
time. A module with no copy there is fetched over the network as a fallback.

To upgrade the copies (or after adding a new `https://` import), run
`node tests/net/vendor.js`: it finds every `https://` import in `tests/`,
downloads it and its imports, and replaces `tests/vendor/`. The test files keep
their CDN URLs unchanged.
