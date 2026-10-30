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
  subtopic to open its page. The URL hash (e.g. `#/calculus/limits`) reflects
  where you are, so links and the back button work.
- **Look up a term.** Highlight any word or phrase on a page to see an inline
  definition. Matching is case-insensitive and tolerates plurals and small
  typos; when a term has its own page, the panel links to it.
- **Interactive lessons.** Some pages include widgets (e.g. a parameter plot)
  with controls you can adjust to see the result update live.

This export ships with the two template topics — **Calculus** and **Game
Theory** — as starting examples.

---

## Adding content

Everything is data-driven, so extending the library is a localized edit:

- **A new topic:** add a node to `content/topics.json` and create its page JSON
  under `content/pages/...`.
- **A new glossary term:** append one entry to `content/terms.json`.
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
