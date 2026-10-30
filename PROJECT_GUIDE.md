# Project Guide — Library of Alexandria

This is one of two governance documents. Read this one to understand how the
project is **organized** and how to **extend** it. Read `STYLE_GUIDE.md` to
understand how the site **looks**. Between the two, any future agent session can
open the repo, read two files, and contribute content or features that stay
consistent with everything already here.

If you only have time for one section, read **Philosophy** (so you don't fight
the architecture) and then the **"How to…"** section for whatever you're adding.

---

## 1. Goal and philosophy

Alexandria is a scalable, self-documenting learning library. Its design rests on
five principles — every rule below exists to serve one of them.

- **Static, no build step.** The site is plain `index.html`, CSS, and vanilla
  JavaScript loaded as native ES modules (`<script type="module">`). There is no
  bundler, transpiler, package manager, or server to run. You edit a file and
  reload the browser. Keep it that way: do not introduce a build tool, a
  dependency install, or a framework. (The one optional convenience — a trivial
  static file server for `file://` fetch limits — is covered in §8, and it is
  still not a build step.)
- **Content as data.** Pages are **JSON**, not markup. Authors write data; the
  shared renderer decides all HTML structure. This is why every page looks
  consistent and why you never hand-write `<div>`s for a page.
- **Decoupled systems.** The runtime is a set of small modules with clear
  seams: the **router** maps the URL hash to a topic node, the **content
  loader** fetches and caches JSON, the **renderer** turns page JSON into DOM,
  the **lookup system** resolves highlighted terms to definitions, and the
  **widget registry** mounts interactive lessons. Each can be reasoned about and
  changed on its own. Content never imports runtime code, and the renderer never
  inlines widget logic — it delegates to the registry.
- **Additive by construction.** Adding a topic, a term, or a widget is a
  **localized** operation. A new topic touches `topics.json` plus one new page
  file; a new term touches only `terms.json`; a new widget of an existing type
  touches only a page. Existing files keep working untouched.
- **Multi-agent maintainable.** Because there is no toolchain and the two
  governance docs capture the contract, any agent on any machine can extend the
  site correctly without hidden context. When you add something, prefer the
  additive path so the next agent inherits a stable base.

---

## 2. Directory layout

Where content, code, CSS, and governance material live:

```
/ (repo root)
├── index.html                   # Single-page shell: header, <nav id="nav">, <main id="app">,
│                                 #   footer; loads tokens.css then alexandria.css, then src/main.js.
├── package.json                 # Only { "type": "module", "private": true } — marks ES modules.
│                                 #   NOT a dependency manifest; there is nothing to install.
├── assets/
│   └── css/
│       ├── tokens.css           # Design tokens ONLY: colors, type scale, spacing (hex + scales).
│       └── alexandria.css       # Component + layout styles that CONSUME the tokens.
├── src/                         # Runtime — shared vanilla-JS ES modules (the "code" layer).
│   ├── main.js                  # Entry point: boot(), wire router→loader→renderer→lookup,
│   │                            #   import widget types so they self-register. (Added in the
│   │                            #   boot task; see §7 for the self-registration contract.)
│   ├── router.js                # Hash routing over the topic tree; parse/resolve/subscribe.
│   ├── content-loader.js        # fetch + parse + cache JSON; typed ContentLoadError.
│   ├── renderer.js              # Turn page JSON into DOM via shared templates; block dispatch.
│   ├── lookup/
│   │   ├── trie.js              # Token-level trie + shared normalize().
│   │   ├── search-index.js      # buildIndex(terms) + longest-match query().
│   │   ├── fuzzy.js             # Typo/plural fallback (bounded edit distance).
│   │   └── lookup-ui.js         # Selection capture + inline definition panel.
│   └── widgets/
│       ├── registry.js          # registerWidget(type, mountFn) + mountWidget(spec, container).
│       ├── plot.js              # Shared plotting primitive (makePlot) used by widget types.
│       ├── sims/                # Simulators parameter-plot runs via `config.sim` (§7.1):
│       │                        #   neurons, plasticity, coding, cortex, foundations; index.js names them.
│       ├── sim-kit.js           # Shared kit for simulation widgets: frame, controls, buttons,
│       │                        #   readout, SVG stage, seeded RNG, play/pause ticker (§7.3).
│       └── types/               # One module per widget type; each self-registers on import.
│           ├── parameter-plot.js
│           ├── lif-neuron.js     # The simulation types of §7.3 (computational cortical columns).
│           ├── stdp-explorer.js
│           ├── spike-raster.js
│           ├── sdr-overlap.js
│           ├── temporal-memory.js
│           └── column-voting.js
├── content/                     # The DATA layer — pure JSON, no presentation logic.
│   ├── topics.json              # The topic/subtopic tree (single manifest of topics).
│   ├── terms.json               # The lookup table (array of term entries).
│   └── pages/                   # One JSON file per page, foldered to mirror the tree.
│       ├── snn/                 # Spiking neural networks (index, encoding, neuron-filters,
│       │   ├── neuron-models/   #   neuron-models.json, learning-rules.json); children of
│       │   └── learning-rules/  #   neuron-models / learning-rules live in these folders.
│       ├── neuroscience/        # Cortical columns (+ cortical-columns/), dynamics, mushroom bodies, manifolds.
│       ├── foundations/         # NEF, semantic pointers, LMU.
│       ├── neuromorphic-hardware/  # Overview, Loihi, TrueNorth, SpiNNaker, FPGA.
│       ├── computational-cortical-columns/  # Learning path: biology → neuron models →
│       │                        #   plasticity → HTM → Thousand Brains → other models →
│       │                        #   building an SNN column → reading list (one folder per section).
│       ├── calculus/            # Template topic.
│       └── game-theory/         # Template topic.
├── STYLE_GUIDE.md               # Governance doc #1 — visual standards.
├── PROJECT_GUIDE.md             # Governance doc #2 — this file: organization + how to extend.
└── tests/                       # Dev-only, optional (see §9). Mirrors src/ under tests/src/.
```

Rules of thumb for *where things go*:

- **New knowledge → `content/`.** Topic structure in `topics.json`, page bodies
  in `content/pages/...`, glossary entries in `terms.json`. Never put page body
  markup in JS.
- **New behavior → `src/`.** A genuinely new interaction (e.g. a new widget
  type) is a module under `src/widgets/types/`. New cross-cutting runtime goes in
  the appropriate `src/` module. Keep the module seams intact.
- **New appearance → `assets/css/`.** Every color/type/spacing decision is a
  token in `tokens.css`; component styling lives in `alexandria.css`. Do not add
  per-page or inline styles. See `STYLE_GUIDE.md`.

---

## 3. JSON schemas

All four schemas below are the authoring contract. Field names and shapes must
match exactly — the runtime reads these verbatim.

### 3.1 `content/topics.json` — the topic tree (`TopicNode`)

A single root `TopicNode` whose `children` are the top-level topics. Nodes nest
to **arbitrary depth**.

Fields:

| Field      | Type         | Required | Rule |
|------------|--------------|----------|------|
| `slug`     | string       | yes      | URL-safe id, **unique among siblings**; must match `^[a-z0-9]+(-[a-z0-9]+)*$` (lowercase letters/digits, hyphen-separated). |
| `title`    | string       | yes      | Human-readable title shown in nav and home cards. |
| `summary`  | string       | no       | One-line description shown in nav / home cards. |
| `page`     | string       | see rule | Path (relative to repo root) to this node's page JSON. A **leaf** node (no `children`) **must** have a `page`; a pure grouping node may omit it. |
| `children` | TopicNode[]  | no       | Nested subtopics (recursive, any depth). |

Additional rules:
- The **full route** to a node is the join of ancestor slugs, e.g.
  `/snn/neuron-models/lif`.
- A node has `page`, `children`, or both. A leaf lacking a `page` is invalid and
  the router refuses to resolve it (and surfaces an error naming the node).
- The root node uses `slug: "root"` and carries only `summary` + `children`.

Example (abridged from the real manifest):

```json
{
  "slug": "root",
  "title": "Library of Alexandria",
  "summary": "Browse a tree of topics, highlight any term, explore interactive lessons.",
  "children": [
    {
      "slug": "snn",
      "title": "Spiking Neural Networks",
      "summary": "Neural networks whose neurons communicate via discrete spikes over time.",
      "page": "content/pages/snn/index.json",
      "children": [
        {
          "slug": "neuron-models",
          "title": "Neuron Models",
          "summary": "How individual spiking neurons integrate input and fire.",
          "page": "content/pages/snn/neuron-models.json",
          "children": [
            {
              "slug": "lif",
              "title": "Leaky Integrate-and-Fire",
              "page": "content/pages/snn/neuron-models/lif.json"
            }
          ]
        }
      ]
    }
  ]
}
```

### 3.2 Page content — `content/pages/**/<slug>.json` (`PageContent`)

Each page is one JSON document: a title, an optional intro paragraph, and an
ordered array of content blocks the renderer paints top to bottom.

`PageContent` fields:

| Field    | Type            | Required | Rule |
|----------|-----------------|----------|------|
| `title`  | string          | yes      | Page title (rendered as the page heading). |
| `intro`  | string          | no       | Lead paragraph shown under the title. |
| `blocks` | ContentBlock[]  | yes      | Body content, rendered in array order. |

A `ContentBlock` has a `type` and the fields that type uses. The renderer
renders prose and code as **text** (`textContent`), so embedded markup is shown
literally and never interpreted as HTML.

| `type`    | Fields it uses                 | Notes |
|-----------|--------------------------------|-------|
| `prose`   | `text`                         | A paragraph. |
| `heading` | `text`, `level` (2–4)          | A sub-heading at the given level (the page `title` is the H1). |
| `list`    | `items` (string[])             | A bulleted list. |
| `code`    | `lang`, `source`               | A non-executed, labeled code block. `source` is shown verbatim. |
| `callout` | `text`                         | A highlighted aside. |
| `widget`  | `widget` (a `Widget_Spec`, §3.4) | Delegated to the widget registry; see §7. |

An unknown `type` renders a visible placeholder rather than breaking the page.

Example:

```json
{
  "title": "Neuron Models",
  "intro": "A neuron model is the rule that turns incoming current into spikes.",
  "blocks": [
    { "type": "heading", "level": 2, "text": "Leaky Integrate-and-Fire (LIF)" },
    { "type": "prose", "text": "The LIF neuron treats the membrane as a leaky capacitor." },
    {
      "type": "code",
      "lang": "python",
      "source": "def lif_step(v, i_in):\n    return v + i_in, v >= 1.0"
    },
    {
      "type": "list",
      "items": [
        "Reach for LIF when you need speed and scale.",
        "Reach for Izhikevich when firing-pattern variety matters."
      ]
    },
    { "type": "callout", "text": "The plot is illustrative, not a bit-accurate simulation." }
  ]
}
```

### 3.3 `content/terms.json` — the lookup table (`TermEntry[]`)

A flat JSON **array** of term records. This is the single source of truth for
inline definitions; editors may append freely (the runtime indexes on load).

`TermEntry` fields:

| Field        | Type            | Required | Rule |
|--------------|-----------------|----------|------|
| `term`       | string          | yes      | Canonical display term (e.g. `"Neural Network"`); non-empty. |
| `aliases`    | string[]        | no       | Alternate spellings/plurals; each is indexed as another surface form. |
| `acronym`    | string          | no       | Short form (e.g. `"SNN"`). **Omit the field entirely** when there is no acronym — never store `""` or `null`. Indexed as an additional surface form. |
| `definition` | string          | yes      | The definition text shown in the panel. |
| `pageRef`    | string \| null  | yes      | A route to an Alexandria page explaining the term, or `null`. When non-null it **must resolve to a real route** in `topics.json`. |

Matching is case- and whitespace-insensitive (done on a normalized form), so you
do not need to list case variants. Longest match wins: if both `"Neural"` and
`"Neural Network"` were terms, highlighting "neural network" resolves the longer
one.

Example (one entry with an acronym, one without):

```json
[
  {
    "term": "Spiking Neural Networks",
    "acronym": "SNN",
    "aliases": ["spiking neural network", "spiking neural net"],
    "definition": "Neural networks whose neurons communicate via discrete, time-stamped spikes.",
    "pageRef": "/snn"
  },
  {
    "term": "Neural Network",
    "aliases": ["neural networks", "neural net"],
    "definition": "A model of interconnected units that learns a mapping from inputs to outputs.",
    "pageRef": null
  }
]
```

The first entry carries an `acronym`; the second omits the field entirely
because it has none.

### 3.4 `Widget_Spec` — a widget block inside a page

A `widget` content block carries a `widget` object: the declarative spec the
registry mounts. No interaction code lives in the page.

`Widget_Spec` fields:

| Field    | Type             | Required | Rule |
|----------|------------------|----------|------|
| `type`   | string           | yes      | A **registered** widget type (e.g. `"parameter-plot"`). Unregistered → visible placeholder, nothing mounts. |
| `title`  | string           | no       | Human-readable widget title. |
| `params` | ParamControl[]   | yes      | The user-manipulable controls. |
| `config` | object           | no       | Type-specific static config (model choices, axis labels, ranges). |

A `ParamControl`:

| Field     | Type                              | Required | Rule |
|-----------|-----------------------------------|----------|------|
| `key`     | string                            | yes      | Unique within the widget; maps to a state field. |
| `label`   | string                            | yes      | Shown next to the control. |
| `control` | `"range"` \| `"number"` \| `"select"` | yes  | Control kind. |
| `min`     | number                            | for range/number | Lower bound. |
| `max`     | number                            | for range/number | Upper bound. |
| `step`    | number                            | for range/number | Step increment. |
| `options` | string[]                          | for select | Allowed choices. |
| `default` | number \| string                  | yes      | Initial value; must be inside the declared range/options. Reflected on first paint. |

A value changed outside its declared range/options is rejected: the widget
retains its last valid value and surfaces an error indication.

Example:

```json
{
  "type": "widget",
  "widget": {
    "type": "parameter-plot",
    "title": "Neuron response explorer",
    "params": [
      { "key": "amplitude", "label": "Input amplitude", "control": "range",
        "min": 0, "max": 5, "step": 0.1, "default": 1 },
      { "key": "model", "label": "Neuron model", "control": "select",
        "options": ["LIF", "Izhikevich"], "default": "LIF" }
    ],
    "config": { "models": ["LIF", "Izhikevich"], "xLabel": "time", "yLabel": "membrane potential" }
  }
}
```

---

## 4. How to add a topic or subtopic

Two localized edits — no existing file changes.

1. **Add a `TopicNode` to `content/topics.json`** at the right place in the tree
   (any depth). Give it a `slug` (matching `^[a-z0-9]+(-[a-z0-9]+)*$`, unique
   among its siblings), a `title`, an optional `summary`, and — if it is a page
   (a leaf, or any node you want to be viewable) — a `page` path. Add it to a
   parent's `children` array to nest it; add `children` to it to give it
   subtopics of its own.
2. **Create its page JSON** at the `page` path, under `content/pages/...`,
   following the §3.2 schema. Mirror the tree in the folder structure (e.g. a
   node at `/calculus/limits` → `content/pages/calculus/limits.json`).

Reload: the new route (the join of ancestor slugs, e.g. `#/calculus/limits`)
resolves and renders. Nothing else needs editing — no renderer or router code.

A pure grouping node (one that only organizes children and has no page of its
own) may omit `page`, but then it must have `children`. A leaf with no `page` is
invalid.

---

## 5. How to add a lookup term

**Append one `TermEntry` to `content/terms.json`** (§3.3) and reload. That is the
entire procedure — no page edits, no renderer edits. The index rebuilds from the
data at boot, and the new term resolves everywhere on every page.

Guidance:
- List plural and common alternate spellings in `aliases`; matching is
  case/whitespace-insensitive and tolerates typos/plurals via the fuzzy
  fallback, so you don't need exhaustive variants.
- Add an `acronym` only when one exists; otherwise omit the field.
- If you set `pageRef`, make sure it points at a route that actually resolves in
  `topics.json`.

---

## 6. Conventions

- **Slugs:** `^[a-z0-9]+(-[a-z0-9]+)*$` — lowercase letters and digits,
  hyphen-separated words, unique among siblings. No spaces, underscores, or
  capitals.
- **Page files:** one JSON file per page, named for the node's slug, foldered to
  mirror the topic tree under `content/pages/` (e.g. `/snn/neuron-models` →
  `content/pages/snn/neuron-models.json`). The `page` path in `topics.json` is
  relative to the repo root (`content/pages/...`).
- **Content is data:** never write page HTML by hand. Express a page as blocks
  (§3.2); the renderer owns all structure.
- **Styling is centralized:** no inline or per-page styles. Colors, type, and
  spacing are tokens in `assets/css/tokens.css`; components are styled in
  `alexandria.css`. See `STYLE_GUIDE.md`.
- **Where to copy a template from:** start a new page by copying an existing one
  with the blocks you need. `content/pages/snn/index.json` is a good prose/list/
  callout template; `content/pages/snn/neuron-models.json` additionally shows a
  `code` block and a `parameter-plot` **widget** block. The `calculus/` and
  `game-theory/` folders are deliberately template topics to clone from.

---

## 7. How to add an interactive widget

There are two cases.

### 7.1 Use an existing, registered widget type

Add a `widget` content block to a page (§3.4) whose `type` is already
registered (e.g. `"parameter-plot"`). Declare its `params` and `config` in the
page JSON and reload — the renderer delegates the block to the registry, which
mounts it. No code changes. See the widget block in
`content/pages/snn/neuron-models.json` for a complete example.

A `parameter-plot` runs a real simulation when its `config.sim` names one of
the simulators listed in `src/widgets/sims/index.js` (e.g. `"lif"`,
`"izhikevich"`, `"stdp-window"`, `"temporal-memory"`, `"thousand-brains"`).
Each control's `key` is the simulator parameter it drives; read the simulator's
source for its keys and defaults, and any key you leave out keeps its default
(a `config` field of the same name overrides that default). `config.xLabel` and
`config.yLabel` title the axes. Without `config.sim` the widget draws its
generic example curves. Adding a simulator is one pure function
`(config, state) => PlotSeries[]` plus a line in `sims/index.js`, with a case
in `tests/src/widgets/sims.test.js`.

### 7.2 Register a new widget type

When no existing type fits, add a new module under `src/widgets/types/` that
calls `registerWidget(type, mountFn)`:

```js
// src/widgets/types/my-widget.js
import { registerWidget } from "../registry.js";
import { makePlot } from "../plot.js"; // optional: reuse the shared plot primitive

registerWidget("my-widget", (ctx) => {
  // ctx.container — the element to render into
  // ctx.spec      — the Widget_Spec from the page JSON (type, title, params, config)
  // ctx.onState   — optional state-change callback
  const state = /* read defaults from ctx.spec.params */ {};
  // …build controls + visualization inside ctx.container…
  return {
    update(partial) { Object.assign(state, partial); /* redraw */ },
    destroy() { /* stop animation loops, remove listeners */ },
  };
});
```

Contract for a widget module:
- Call `registerWidget(type, mountFn)` at **import time** so merely importing the
  module registers the type. Registering a `type` again **replaces** the prior
  mapping.
- `mountFn(ctx)` must return a `WidgetInstance` with `update(partial)` and
  `destroy()`. The renderer calls `destroy()` on the prior instance before
  re-mounting on re-render, so clean up every listener and animation loop there.
- Reflect the `params` defaults on first paint. Reject out-of-range control
  changes: keep the last valid value and surface an error indication.

**Import it so it self-registers.** A type module only registers when something
imports it. The runtime entry (`src/main.js`) imports the built-in types for
their side effect:

```js
import "./widgets/types/parameter-plot.js"; // self-registers with the registry
```

Add an equivalent side-effect import for your new type in `main.js` (alongside
the existing one) so it is registered before any page tries to mount it.

### 7.3 The simulation widget types (computational cortical columns)

Six interactive simulations back the Computational Cortical Columns topic. They
are built on the shared kit `src/widgets/sim-kit.js`, which gives every
simulation the same frame, `params`-driven control panel (same defaults and
out-of-range rejection contract as `parameter-plot`), `.widget__actions`
buttons, `.widget__readout` status line, SVG stage in `.widget__plot`, a seeded
RNG (`makeRng`) so a given seed always redraws identically, and a play/pause
`makeTicker` that `destroy()` stops. Each type module exports its pure model
functions (no DOM) so tests can check the science, and is styled only by the
§10b classes in `alexandria.css` (see `STYLE_GUIDE.md`).

Pages must use exactly these parameter `key`s, in this order, with the ranges
used on the existing pages (copy a block from the page listed); titles and
defaults within range may change. `tests/src/integration/cortical-columns-content.test.js`
enforces the keys.

| Type | Example page | `params` keys | `config` |
|------|--------------|---------------|----------|
| `lif-neuron` | `spiking-neuron-models/leaky-integrate-and-fire` | `current`, `tau`, `threshold`, `refractory`, `noise`, `input` | `duration`, `dt`, `vRest`, `vReset`, `resistance`, `showFI` |
| `stdp-explorer` | `plasticity-and-learning/stdp` | `aPlus`, `aMinus`, `tauPlus`, `tauMinus`, `deltaT`, `rule` | `pairings`, `w0`, `wMax` |
| `spike-raster` | `plasticity-and-learning/inhibition-and-k-wta` | `inhibition`, `k`, `inhibitoryGain`, `inputRate`, `seed` | `excitatory`, `inhibitory`, `inputs`, `patterns`, `patternMs`, `dt` |
| `sdr-overlap` | `plasticity-and-learning/sparse-distributed-representations` | `n`, `w`, `theta`, `noise`, `seed` | (none) |
| `temporal-memory` | `htm/temporal-memory` | `sequences`, `cellsPerColumn`, `activationThreshold`, `seed` | `columnsPerSymbol`, `maxNewSynapses`, `permanenceIncrement`, `permanenceDecrement`, `connectedPermanence`, `initialPermanence` |
| `column-voting` | `thousand-brains/column-voting` | `columns`, `voting`, `object`, `noise`, `seed` | `objects`, `locations`, `features` |

Every `config` field is optional; a missing field falls back to the value on
the example page. To add another simulation type, follow §7.2 and build it on
`sim-kit.js` the same way.

---

## 8. Optional: serving over a static server (the `file://` tip)

The site is designed to open straight from disk, but page content is loaded via
`fetch` of local JSON, and **some browsers block `fetch` under the `file://`
protocol** for security. If you open `index.html` directly and see an error
block where a page should be, that block is the renderer telling you the browser
blocked local file access — and it links here.

The fix is to serve the folder with any trivial static server (from the repo
root):

```sh
python -m http.server 8000
# then open http://localhost:8000/
```

Any equivalent works (`npx serve`, a VS Code live-server extension, etc.). This
is purely a way to hand files to the browser — **still no build step**, nothing
is compiled or installed into the site.

---

## 9. Optional: the dev-only test suite

`tests/` holds an optional, dev-only test suite. It is **not** required to view
or extend the site, and it uses no build step either (plain ES modules). Run it
with:

```sh
node tests/run.js
```

`tests/run.js` discovers every `*.test.js` under `tests/` (which mirrors the
`src/` tree under `tests/src/`), runs them, and exits non-zero on failure. Unit
tests cover the loader, router, renderer, and widgets; property tests cover the
lookup system. See `tests/README.md` for details, including how DOM-dependent
tests and `fast-check` are loaded without an install.
