# Library of Alexandria

A scalable, self-documenting learning library. It is a **static site** — plain
`index.html`, CSS, and vanilla JavaScript loaded as native ES modules. There is
**no build step, nothing to install, and no server code** to run.

---

## Opening it (important)

Do **not** double-click `index.html`. The library loads its content with
`fetch()` of local JSON files, and browsers block `fetch` under the `file://`
protocol — so opening the file directly shows the page frame with an error where
the content should be.

Instead, **serve the folder over HTTP** and open the printed URL. Pick whichever
you have:

- **Python** (pre-installed on most machines):
  ```sh
  python -m http.server 8000
  ```
  then open http://localhost:8000/

- **Node.js:**
  ```sh
  npx serve
  ```
  then open the URL it prints (usually http://localhost:3000/).

- **VS Code:** install the "Live Server" extension, right-click `index.html`,
  and choose **Open with Live Server**.

Run the command from **this folder** (the one containing `index.html`). Serving
is only a way to hand files to the browser — it is still not a build step;
nothing is compiled or installed.

---

## Using it

- **Browse topics.** The left navigation shows the topic tree; click a topic or
  subtopic to open its page. The URL hash (e.g. `#/math/calculus/limits`) reflects
  where you are, so links and the back button work.
- **Look up a term.** Highlight any word or phrase on a page to see an inline
  definition. Matching is case-insensitive and tolerates plurals and small
  typos; when a term has its own page, the panel links to it. If the first
  definition is not the term you meant, press **↓** (or the ▼ button) for the
  next closest match and **↑** to go back; **Esc** closes the panel. Ordinary
  words such as "the" show no definition.
- **Scoped definitions and "Search all".** On a topic page, the panel shows
  definitions from the glossaries closest to that page first — the current
  topic and its ancestors, up to the shared general glossary. If those nearby
  glossaries don't have what you meant, a **Search all** button appears as the
  last row; pressing it lazily searches every other topic's glossary in the
  library and adds any further definitions it finds, each labeled with the
  topic it came from (e.g. "from Calculus"). On the home page there is no
  "Search all" button — a lookup there searches every glossary directly.
- **Interactive lessons.** Some pages include widgets (e.g. a parameter plot)
  with controls you can adjust to see the result update live.

This export ships with the two template topics — **Calculus** and **Game
Theory** — as starting examples, and **Computational Cortical Columns**: a
learning path from the biology of the neocortical column through spiking
neuron models, plasticity, HTM and the Thousand Brains Theory to building an
SNN column, with interactive simulations (LIF neuron, STDP, k-WTA spiking
layer, SDR overlap, temporal memory, multi-column voting).

---

## Adding content

Everything is data-driven, so extending the library is a localized edit:

- **A new topic:** add a node to its shelf's file in `content/topics/` (e.g.
  `content/topics/electronics.json`) and create its page at
  `content/pages/<route>/index.json`, e.g. `content/pages/electronics/vhdl/index.json`
  for `#/electronics/vhdl`. A topic that belongs on no shelf yet gets a new
  shelf: a new file in `content/topics/` plus one `{ "file": ... }` line in
  `content/topics.json`.
- **A page that appears in a learning path:** don't copy it; add a node with
  `"ref": "/route/of/the/page"` to the path.
- **A page that moves:** add `"/old/route": "/new/route"` to
  `content/redirects.json` so old links keep working.
- **A new glossary term:** glossaries live one-per-topic under `content/terms/`,
  with paths mirroring topic routes — `/a/b/c` → `content/terms/a/b/c.json`, and
  the shared general glossary `/` → `content/terms/_root.json`. To add a term,
  add (or edit) the glossary file for its topic, then — only if that file is new
  — add one line to the manifest `content/terms/index.json` (`{ scope, file }`).
  A brand-new glossary is therefore exactly two edits: the file plus the manifest
  line. The term schema (`term`, `aliases`, `acronym`, `definition`, `pageRef`)
  is unchanged.
- **A new page block or widget:** edit that page's JSON.

Reload the browser and your change appears — no code changes needed. See
`PROJECT_GUIDE.md` for the full JSON schemas and step-by-step instructions, and
`STYLE_GUIDE.md` for the visual standards.

---

## Optional: tests

A dev-only test suite lives in `tests/` and is not needed to view or use the
site. If you have Node.js:

```sh
node tests/run.js
```

---

## License

The code and the original content are under the [MIT License](LICENSE).
Third-party images keep their own licenses; see
`assets/figures/*/CREDITS.md`.
