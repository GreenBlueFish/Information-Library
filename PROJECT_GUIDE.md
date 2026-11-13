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
  The lookup system is **scoped to where the reader is.** Glossaries live under
  `content/terms/` as one file per topic, listed in a manifest
  (`content/terms/index.json`); the manifest — not any single file — is the
  authoritative list of glossaries. On a topic page the panel searches the
  current page's **scope chain** (the glossaries of the current route and its
  ancestors, nearest-first) and offers a lazy **"Search all"** control that
  reaches the rest of the library on demand. On the home page it searches every
  glossary. See §3.3 for the layout and §5 for adding a term.
- **Additive by construction.** Adding a topic, a term, or a widget is a
  **localized** operation. A new topic touches `topics.json` plus one new page
  file; a new term touches one glossary under `content/terms/` (adding its
  manifest line if the glossary is new); a new widget of an existing type
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
│   ├── css/
│   │   ├── tokens.css           # Design tokens ONLY: colors, type scale, spacing (hex + scales).
│   │   └── alexandria.css       # Component + layout styles that CONSUME the tokens.
│   └── figures/                 # Images for `figure` blocks (§3.2), foldered by topic slug,
│                                #   e.g. figures/communication-protocols/vga-line-timing.svg.
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
│   │   ├── matches.js           # Ranked matches for a selection (exact, then close terms).
│   │   └── lookup-ui.js         # Selection capture + inline definition panel (↑/↓ through matches).
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
│           ├── column-voting.js
│           └── vga-scanline.js   # VGA beam stepper (communication-protocols/vga, §7.4).
├── content/                     # The DATA layer — pure JSON, no presentation logic.
│   ├── topics.json              # The root of the topic tree: lists the shelves (§3.1).
│   ├── topics/                  # One file per shelf: brain.json, electronics.json,
│   │                            #   math.json, finance.json, games.json.
│   ├── redirects.json           # Old route → new route, so old links keep working (§3.1).
│   ├── terms/                   # The glossary folder: one Glossary_File per topic,
│   │   ├── index.json           #   paths mirroring routes (§3.3's Path_Rule).
│   │   │                        #   index.json is the Manifest: the authoritative list
│   │   │                        #   of glossaries ({ glossaries: [{ scope, file }] }).
│   │   ├── _root.json           # Terms shared across unrelated subjects (the `/` scope).
│   │   └── <shelf>/<topic>.json # One glossary per topic (array of term entries).
│   └── pages/                   # One folder per node, mirroring the routes; each holds
│       │                        #   that node's page as index.json (§6).
│       ├── brain/               # Brain & Neuromorphic: snn/, neuroscience/, foundations/,
│       │                        #   neuromorphic-hardware/, computational-cortical-columns/.
│       ├── electronics/         # analog-design/, ngspice/, communication-protocols/.
│       ├── math/                # calculus/, game-theory/ (starter topics).
│       ├── finance/             # investing/.
│       ├── games/               # poker/, racing/.
│       └── credits/             # The one Image Credits page (hidden from the nav).
├── STYLE_GUIDE.md               # Governance doc #1 — visual standards.
├── PROJECT_GUIDE.md             # Governance doc #2 — this file: organization + how to extend.
└── tests/                       # Dev-only, optional (see §9). Mirrors src/ under tests/src/.
```

Rules of thumb for *where things go*:

- **New knowledge → `content/`.** Topic structure in `topics.json`, page bodies
  in `content/pages/...`, glossary entries in the right Glossary_File under
  `content/terms/` (§3.3). Never put page body markup in JS.
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

A single root `TopicNode` whose `children` are the **shelves**: a few broad
groups (Brain & Neuromorphic, Electronics, Math, Finance, Games & Hobbies) whose
children are the topics. Nodes nest to **arbitrary depth** below them.

**Split per shelf.** `content/topics.json` holds only the root; each shelf is
kept in a file of its own under `content/topics/` and named in the root's
`children` by a stub `{ "file": "content/topics/<shelf>.json" }`. The loader
(`loadTopics()` in `src/content-loader.js`, `readTopicTree()` in
`scripts/topic-tree.js` for Node) swaps each stub for the node in that file, so
everything else sees one ordinary tree. A new shelf is one new file plus one
stub line.

Fields:

| Field      | Type         | Required | Rule |
|------------|--------------|----------|------|
| `slug`     | string       | yes      | URL-safe id, **unique among siblings**; must match `^[a-z0-9]+(-[a-z0-9]+)*$` (lowercase letters/digits, hyphen-separated). |
| `title`    | string       | yes      | Human-readable title shown in nav and home cards. |
| `summary`  | string       | no       | One-line description shown in nav / home cards. |
| `page`     | string       | see rule | Path (relative to repo root) to this node's page JSON. A **leaf** node (no `children`) **must** have a `page`; a pure grouping node may omit it. |
| `children` | TopicNode[]  | no       | Nested subtopics (recursive, any depth). |
| `shelf`    | boolean      | no       | `true` on a shelf (a root child). The home shows one section per shelf. |
| `ref`      | string       | no       | A **path step**: the route of another node whose page this node shows, used *instead of* `page` (e.g. `"/brain/snn/encoding"`). The target must have a `page` of its own (refs do not chain). |
| `hidden`   | boolean      | no       | Routable, but left out of the nav, the home and the page arrows (the Credits page, linked from the footer). |

Additional rules:
- The **full route** to a node is the join of ancestor slugs, shelf first, e.g.
  `/brain/snn/neuron-models/lif`.
- **Reference pages and learning paths.** Each concept has **one** page, in the
  topic it belongs to (LIF under Spiking Neural Networks, Temporal Memory under
  Neuroscience). A learning path such as Computational Cortical Columns is an
  ordered tree whose steps are either its own pages or `ref` nodes that borrow a
  reference page. A step keeps the path's breadcrumbs, sidebar and previous/next
  order, and the page shows a note naming the topic it lives in. Never copy a
  page into a path: add a `ref`.
- **Titles carry no numbers** ("Biology of the Neocortex", not "1. Biology of
  the Neocortex"): the order of `children` is the order, so a number would go
  stale the first time a step moves. Refer to other steps by title, not number.
- **Redirects.** When a page moves, add a line to `content/redirects.json`
  (`"/old/route": "/new/route"`). A route that no longer resolves is rewritten
  by its longest matching prefix there (so `/snn` → `/brain/snn` covers every
  page under it) and the address bar is corrected. Links inside the library
  should still point at the new route, not rely on a redirect (a test checks).
- A node has `page` (or `ref`), `children`, or both. A leaf lacking both `page`
  and `ref` is invalid and the router refuses to resolve it (and surfaces an
  error naming the node).
- The root node uses `slug: "root"` and carries `title`, `summary` and
  `children`: the shelf stubs, plus any hidden page such as Credits.
- The order of `children` is the reading order: the previous/next arrows at the
  foot of each page step through the tree in it, depth-first (a topic, then its
  subtopics, then its next sibling), the same order the sidebar lists them.
  Moving to another page (an arrow, a nav link or a card) opens it scrolled to
  its top (`render()` in `src/main.js`).

Example (abridged from the real files). `content/topics.json`:

```json
{
  "slug": "root",
  "title": "Library of Alexandria",
  "summary": "Browse a tree of topics, highlight any term, explore interactive lessons.",
  "children": [
    { "file": "content/topics/brain.json" },
    { "file": "content/topics/electronics.json" },
    { "slug": "credits", "title": "Image Credits", "hidden": true,
      "page": "content/pages/credits/index.json" }
  ]
}
```

`content/topics/brain.json`:

```json
{
  "slug": "brain",
  "title": "Brain & Neuromorphic",
  "shelf": true,
  "page": "content/pages/brain/index.json",
  "children": [
    {
      "slug": "snn",
      "title": "Spiking Neural Networks",
      "page": "content/pages/brain/snn/index.json",
      "children": [
        {
          "slug": "neuron-models",
          "title": "Neuron Models",
          "page": "content/pages/brain/snn/neuron-models/index.json",
          "children": [
            { "slug": "lif", "title": "Leaky Integrate-and-Fire",
              "page": "content/pages/brain/snn/neuron-models/lif/index.json" }
          ]
        }
      ]
    },
    {
      "slug": "computational-cortical-columns",
      "title": "Computational Cortical Columns",
      "page": "content/pages/brain/computational-cortical-columns/index.json",
      "children": [
        { "slug": "leaky-integrate-and-fire", "title": "Leaky Integrate-and-Fire",
          "ref": "/brain/snn/neuron-models/lif" }
      ]
    }
  ]
}
```

### 3.2 Page content — `content/pages/<route>/index.json` (`PageContent`)

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
| `figure`  | `src`, `alt`, `caption`        | An image. `src` is a repo-relative path to a file under `assets/figures/` (no scheme, no leading `/`, no `..`; `.svg`, `.png`, `.jpg`, `.gif` or `.webp`). `alt` is **required** text describing what the image shows; `caption` is optional and shown under it as text. A figure with a missing `alt` or an unsafe `src` renders a placeholder instead. |
| `widget`  | `widget` (a `Widget_Spec`, §3.4) | Delegated to the widget registry; see §7. |
| `problem` | `title` (optional), `text`, `hint` (optional string), `solution` (string or string[], one paragraph each), `answer` (optional short final result) | A practice question. The hint and solution are hidden in native `<details>` reveals ("Show hint", "Show solution") so the reader opens them only when ready. Used by the Analog Design topic. |
| `math`    | `tex`, `caption` (optional)    | A display formula on its own line: `tex` is TeX without `$` (see **Formulas** below). |

#### Formulas

Text in `prose`, `heading`, `list` items, `callout`, `problem` (text, hint,
solution, answer), figure and math captions, the page `intro`, and glossary
definitions may hold formulas in TeX: `$...$` inline, `$$...$$` for a display
formula inside a paragraph. `src/math.js` turns them into native MathML (real
subscripts, stacked fractions, roots) with no library. Write a literal dollar
sign as `\$`. `code` blocks are never touched.

- Subscripts and superscripts: `V_{GS}`, `g_m`, `r_o^2`, `e^{-t/\tau}`. A
  run of letters in a script (`V_{GS}`, `C_{ox}`) is drawn upright as a label.
- Fractions and roots: `\frac{g_m}{C_L}`, `\sqrt{LC}`, `\sqrt[3]{x}`; binomial
  coefficients `\binom{52}{2}`.
- Greek and symbols: `\mu`, `\omega`, `\Delta`, `\approx`, `\le`, `\cdot`,
  `\times`, `\propto`, `\to`, `\mid`, `\infty`, `\parallel` (for `R_1 \parallel R_2`).
- Functions: `\exp`, `\ln`, `\log`, `\sin`, `\max`, `\lim`; operators `\sum`,
  `\int`, `\prod` with limits; `\left( ... \right)` for tall brackets.
- Words and units: `\text{ mV}`, `\mathrm{GBW}`; spaces `\,` `\;` `\quad`.
- Accents: `\hat{x}`, `\bar{x}`, `\tilde{x}`, `\dot{x}`, `\vec{x}`.

Anything else (an unknown command, `\\` line breaks, unbalanced braces) shows
as red source text on the page, and `tests/src/math.test.js` fails, naming the
page. Put plain numbers with units in text ("50 uA" is fine as prose), but
write anything with a subscript, fraction or Greek letter as a formula.

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

### 3.3 `content/terms/` — the glossaries (`TermEntry[]` per file)

Inline definitions live in a **folder of glossaries**, not one file. Each
glossary is a flat JSON **array** of term records (a `Glossary_File`), and a
**Manifest** lists them all. There is no single source of truth file: the
Manifest is the authoritative list of glossaries, and the runtime indexes each
on load.

**The folder, the Path_Rule, and the Manifest.** Glossaries live under
`content/terms/`, one Glossary_File per topic, with the file path
mirroring the route:

- **Path_Rule.** The glossary for route `/a/b/c` is `content/terms/a/b/c.json`;
  the glossary for the root scope `/` is `content/terms/_root.json`. (Today the
  split is one file per topic — `content/terms/electronics/analog-design.json`,
  `content/terms/brain/snn.json`, … — plus `_root.json`, but the rule supports a
  glossary at any route depth.)
- **Manifest.** `content/terms/index.json` lists every Glossary_File as
  `{ scope, file }` entries under a `glossaries` array. Because the site has no
  build step and a browser cannot list a folder, this Manifest is what the
  runtime fetches at boot to learn which glossaries exist — it, not any single
  JSON file, is the authoritative list.

```json
{
  "glossaries": [
    { "scope": "/", "file": "content/terms/_root.json" },
    { "scope": "/brain/snn", "file": "content/terms/brain/snn.json" },
    { "scope": "/electronics/analog-design", "file": "content/terms/electronics/analog-design.json" }
  ]
}
```

**Where a term goes.** A term lives in the Glossary_File of the **narrowest
route whose subtree covers every page that uses it**. A term used only within
`/electronics/analog-design` pages belongs in `content/terms/electronics/analog-design.json`; a term
shared across unrelated subjects (used on pages in more than one top-level
topic) belongs in `content/terms/_root.json`. Store a term **at most once per
Glossary_File**; when one term has several genuinely different senses within one
glossary, give it multiple definitions under that one term rather than repeating
the term. When the *same surface word* means different things in different
topics, store each meaning as its own `TermEntry` in its own glossary.

`TermEntry` fields (unchanged — the schema is the same whichever glossary holds
the term):

| Field        | Type            | Required | Rule |
|--------------|-----------------|----------|------|
| `term`       | string          | yes      | Canonical display term (e.g. `"Neural Network"`); non-empty. |
| `aliases`    | string[]        | no       | Alternate spellings/plurals; each is indexed as another surface form. |
| `acronym`    | string          | no       | Short form (e.g. `"SNN"`). **Omit the field entirely** when there is no acronym — never store `""` or `null`. Indexed as an additional surface form. |
| `definition` | string          | yes      | The definition text shown in the panel. |
| `pageRef`    | string \| null  | yes      | A route to an Alexandria page explaining the term, or `null`. When non-null it **must resolve to a real route** in `topics.json`. |

**Shared pages.** On a page shared between a learning path and its reference
topic (a `ref` step, or the page steps borrow), the chain of the other route is
searched too, after the page's own chain, so a term from either topic's glossary
resolves locally.

`content/terms.json` is the older single-file glossary. The site no longer reads
it; only `scripts/score.js` does. Add new terms to the files under
`content/terms/`.

There is **no `source` field on disk.** The runtime attaches a `source`
annotation (the glossary's scope route and its title, e.g. "from Analog Design")
to each definition as it loads, so the panel can label where a term came from.
Never write `source` into a Glossary_File — it is runtime-only.

Matching is case- and whitespace-insensitive (done on a normalized form), so you
do not need to list case variants. Longest match wins: if both `"Neural"` and
`"Neural Network"` were terms, highlighting "neural network" resolves the longer
one.

Example of a Glossary_File (one entry with an acronym, one without):

```json
[
  {
    "term": "Spiking Neural Networks",
    "acronym": "SNN",
    "aliases": ["spiking neural network", "spiking neural net"],
    "definition": "Neural networks whose neurons communicate via discrete, time-stamped spikes.",
    "pageRef": "/brain/snn"
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

1. **Add a `TopicNode` to its shelf's file in `content/topics/`** at the right place in the tree
   (any depth). Give it a `slug` (matching `^[a-z0-9]+(-[a-z0-9]+)*$`, unique
   among its siblings), a `title`, an optional `summary`, and — if it is a page
   (a leaf, or any node you want to be viewable) — a `page` path. Add it to a
   parent's `children` array to nest it; add `children` to it to give it
   subtopics of its own.
2. **Create its page JSON** at the `page` path, under `content/pages/...`,
   following the §3.2 schema. The path is always the node's route plus
   `index.json` (e.g. a node at `/math/calculus/limits` →
   `content/pages/math/calculus/limits/index.json`).

Reload: the new route (the join of ancestor slugs, e.g. `#/math/calculus/limits`)
resolves and renders. Nothing else needs editing — no renderer or router code.

A pure grouping node (one that only organizes children and has no page of its
own) may omit `page`, but then it must have `children`. A leaf with no `page` is
invalid.

---

## 5. How to add a lookup term

**Append one `TermEntry` to the right Glossary_File under `content/terms/`**
(§3.3) and reload. Pick the glossary by the "where a term goes" rule: the
narrowest route whose subtree covers every page that uses the term, or
`_root.json` when it is shared across unrelated subjects. If that glossary does
not exist yet, create the file per the Path_Rule and add one `{ scope, file }`
line to the Manifest `content/terms/index.json`. That is the whole procedure —
no page edits, no renderer edits. The glossaries are indexed on load, and the
new term resolves on every page in its scope (the term's own topic and its
descendants), with "Search all" reaching it from elsewhere.

Guidance:
- List plural and common alternate spellings in `aliases`; matching is
  case/whitespace-insensitive and tolerates typos/plurals via the fuzzy
  fallback, so you don't need exhaustive variants.
- Add an `acronym` only when one exists; otherwise omit the field.
- If you set `pageRef`, make sure it points at a route that actually resolves in
  `topics.json`.
- Add adjective and verb forms the pages use as aliases ("thalamic" on
  Thalamus, "depolarised" on Depolarization) so a highlighted word lands on
  its term exactly. A word that is not a term still offers the terms that
  contain it ("pyramidal" → Pyramidal Neuron, …), which the reader steps
  through with ↑/↓ (`src/lookup/matches.js`).
- Don't give a common English word (such as "memory" or "rate") as an alias of
  one narrow term; the related-terms list already covers it.
- An acronym that is also an English word (IT, ON) only resolves when typed in
  capitals, so it does not fire on "it" or "on".

---

## 6. Conventions

- **Slugs:** `^[a-z0-9]+(-[a-z0-9]+)*$` — lowercase letters and digits,
  hyphen-separated words, unique among siblings. No spaces, underscores, or
  capitals.
- **Page files: one folder per node.** A node's page is always
  `content/pages/<route>/index.json` (e.g. `/brain/snn/neuron-models` →
  `content/pages/brain/snn/neuron-models/index.json`), so any node can grow
  children (in sub-folders beside its `index.json`) without its own file moving.
  The `page` path is relative to the repo root. A test
  (`tests/src/integration/shelves.test.js`) checks every node follows this.
- **Image credits** for outside images go on the one Credits page
  (`content/pages/credits/index.json`), under a heading for the topic, not on a
  page in the topic's own tree.
- **Content is data:** never write page HTML by hand. Express a page as blocks
  (§3.2); the renderer owns all structure.
- **Styling is centralized:** no inline or per-page styles. Colors, type, and
  spacing are tokens in `assets/css/tokens.css`; components are styled in
  `alexandria.css`. See `STYLE_GUIDE.md`.
- **Images:** add them as `figure` blocks (§3.2) with the file under
  `assets/figures/<topic-slug>/`. Prefer diagrams you draw yourself as SVG, so
  there is no licensing question and they match the site. An SVG loaded as an
  image cannot read the CSS tokens, so write the token hex values from
  `STYLE_GUIDE.md` §1 into the file and keep a white background. Every figure
  needs `alt` text that says what the picture shows, not just its title, and
  the prose around it should still make sense without it.
  `content/pages/communication-protocols/vga.json` has four examples.
- **Real images from elsewhere** (photographs, micrographs, historical
  drawings) are welcome when they are openly licensed: public domain, CC0 or
  CC BY / CC BY-SA, for example from Wikimedia Commons, whose API gives each
  file's licence and author. Resize them (about 900 px wide is plenty), end the
  caption with a credit such as "Image: Author, CC BY 4.0, via Wikimedia
  Commons (resized).", and add a row to `CREDITS.md` in the same folder with
  the licence, source link and what you changed. The caption's licence must
  match the row's, and readers see the full credits too: add the same details
  to the library's one Image Credits page, under the topic's heading
  (`content/pages/credits/index.json`, route `#/credits`).
  `assets/figures/computational-cortical-columns/CREDITS.md` is the example, and
  `tests/src/integration/cortical-columns-figures.test.js` checks all three.
  Images are capped at `--figure-max-height` so a tall one and its caption
  fit on one screen.
- **Where to copy a template from:** start a new page by copying an existing one
  with the blocks you need. `content/pages/brain/snn/index.json` is a good prose/list/
  callout template; `content/pages/brain/snn/neuron-models/index.json` additionally shows a
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
`content/pages/brain/snn/neuron-models/index.json` for a complete example.

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

### 7.4 The VGA scanline widget

`vga-scanline` (`src/widgets/types/vga-scanline.js`, example page
`communication-protocols/vga`) steps a beam through a VGA frame and draws the
frame to scale, the painted picture and the RGB/HSYNC/VSYNC waveforms. Its
`params` keys, in order, are `mode` (a select whose options must be names in
the module's exported `MODES`: `"640x480 at 60 Hz"`, `"800x600 at 60 Hz"`,
`"1024x768 at 60 Hz"`) and `step` (a select of `"1 pixel"`, `"8 pixels"`,
`"1 line"`, `"10 lines"`). It takes no `config`. Adding a mode is one entry in
`MODES` with its VESA DMT timing. `tests/src/integration/communication-protocols-content.test.js`
checks the page's keys and options.

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
