// tests/src/renderer.test.js
//
// Unit tests for the Renderer (src/renderer.js) — design Component 3,
// Requirements 3.3 (render each content block in array order and in the
// expected per-type structure), 3.4 (prose text via textContent), 3.7 (code
// source as a non-executed, labeled block), 3.10 (prose/code rendered as text
// so embedded markup is NOT interpreted as HTML), and 1.2 (one home card per
// root child, title + optional summary).
//
// DOM SETUP (no build step, no install)
// -------------------------------------
// renderer.js (and the Widget Registry it imports, src/widgets/registry.js)
// build DOM through the `document` global and read `node.ownerDocument`. Node
// has no `document`, and the harness runs under `node tests/run.js` with no
// package manager. Rather than pull a DOM over the network (which would make a
// pure-structure test depend on CDN access), we install a MINIMAL hand-rolled
// `document` stub that implements exactly the surface renderer.js and
// registry.js use: createElement, and on each element className / textContent /
// setAttribute / getAttribute / appendChild / replaceChildren / ownerDocument /
// children / childNodes / tagName. Content text set via `textContent` is stored
// as a literal string and NEVER parsed, which is precisely the behavior
// Requirements 3.4/3.7/3.10 assert (markup in text stays literal text, not a
// child element). The stub is assigned to `globalThis.document` BEFORE
// importing renderer.js so the module and its registry import both see it.
// This keeps the dev-only tests install-free and offline, consistent with the
// project's core constraint (plain static files, vanilla JS). See tests/README.md.

import { describe, it, expect } from "../harness.js";

// ---------------------------------------------------------------------------
// Minimal DOM stub — just enough for renderer.js + registry.js.
// ---------------------------------------------------------------------------

/** A tiny element node mirroring the small DOM surface the renderer touches. */
class StubElement {
  constructor(tagName, ownerDocument) {
    this.tagName = String(tagName).toUpperCase();
    this.ownerDocument = ownerDocument;
    this.className = "";
    /** @type {StubElement[]} */
    this.children = [];
    this._attributes = Object.create(null);
    this._text = "";
    // The new home card writes a normalized title to `data-title` via the
    // `dataset` API and toggles `hidden` on the children/status elements; mirror
    // just those two surfaces so the home builders run under this stub.
    this.dataset = Object.create(null);
    this.hidden = false;
  }

  // textContent: setting replaces all children with a single literal string;
  // it is stored verbatim and never parsed as markup (Req 3.4/3.7/3.10).
  get textContent() {
    if (this.children.length === 0) return this._text;
    return this.children.map((c) => c.textContent).join("");
  }
  set textContent(value) {
    this._text = value == null ? "" : String(value);
    this.children = [];
  }

  setAttribute(name, value) {
    this._attributes[name] = String(value);
  }
  getAttribute(name) {
    return name in this._attributes ? this._attributes[name] : null;
  }

  appendChild(child) {
    // Appending an element clears any literal text sibling, matching the DOM:
    // once there are element children, text is carried by the children.
    this._text = "";
    this.children.push(child);
    return child;
  }

  replaceChildren(...nodes) {
    this.children = [];
    this._text = "";
    for (const n of nodes) this.children.push(n);
  }

  // Convenience read-side helpers used by the assertions below.
  get childNodes() {
    return this.children;
  }
  querySelectorChildren(tag) {
    return this.children.filter((c) => c.tagName === String(tag).toUpperCase());
  }

  // src/home.js (installHome, run by renderPage's home view) looks up its
  // controls with single-class selectors (".home-card", ".home-search__input")
  // and wires listeners on them. Support exactly that: a ".class" selector
  // matched against descendants (excluding self, as in the DOM), and a no-op
  // addEventListener since these tests assert structure, not interaction.
  querySelectorAll(selector) {
    const match = /^\.([\w-]+)$/.exec(String(selector).trim());
    if (!match) throw new Error(`StubElement: unsupported selector ${selector}`);
    const cls = match[1];
    /** @type {StubElement[]} */
    const out = [];
    const walk = (node) => {
      for (const child of node.children) {
        if (String(child.className).split(/\s+/).includes(cls)) out.push(child);
        walk(child);
      }
    };
    walk(this);
    return out;
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
  addEventListener() {}
}

/** The document stub: only createElement is needed by the code under test. */
const stubDocument = {
  createElement(tag) {
    return new StubElement(tag, stubDocument);
  },
};

// Install BEFORE importing renderer.js so the module (and the registry it
// imports) resolve `document` to our stub at evaluation time.
globalThis.document = /** @type {any} */ (stubDocument);

// Now import the module under test (static import is hoisted, but the global is
// only read when the functions run, so assigning above is sufficient; we import
// here to keep the dependency explicit).
const { renderPage, renderNav, renderBlock } = await import(
  "../../src/renderer.js"
);

// ---------------------------------------------------------------------------
// Small helpers for the assertions.
// ---------------------------------------------------------------------------

/** A fresh mount element for each test. */
function mount() {
  return stubDocument.createElement("div");
}

/** Depth-first search for the first descendant (incl. self) matching a predicate. */
function find(node, predicate) {
  if (!node) return null;
  if (predicate(node)) return node;
  for (const child of node.children || []) {
    const hit = find(child, predicate);
    if (hit) return hit;
  }
  return null;
}

/** Collect all descendants (incl. self) matching a predicate. */
function findAll(node, predicate, acc = []) {
  if (!node) return acc;
  if (predicate(node)) acc.push(node);
  for (const child of node.children || []) findAll(child, predicate, acc);
  return acc;
}

/** True when `node.className` contains the given class token. */
function hasClass(node, cls) {
  return (
    typeof node.className === "string" &&
    node.className.split(/\s+/).includes(cls)
  );
}

/** Find the first descendant element with the given tag name. */
function findTag(node, tag) {
  return find(node, (n) => n.tagName === String(tag).toUpperCase());
}

/** Find the first descendant element carrying the given class. */
function findClass(node, cls) {
  return find(node, (n) => hasClass(n, cls));
}

// ===========================================================================
// renderBlock — each block type renders the expected .block/.block--<type>
// structure (Requirement 3.3).
// ===========================================================================

describe("renderer", () => {
  describe("renderBlock structure per type (Req 3.3)", () => {
    it("prose → .block.block--prose wrapping a <p> with the text", () => {
      const m = mount();
      renderBlock({ type: "prose", text: "Hello world" }, m);

      const block = m.children[0];
      expect(hasClass(block, "block")).toBe(true);
      expect(hasClass(block, "block--prose")).toBe(true);

      const p = findTag(block, "p");
      expect(p.tagName).toBe("P");
      expect(p.textContent).toBe("Hello world");
    });

    it("heading → h2..h4 chosen by `level`", () => {
      const m2 = mount();
      renderBlock({ type: "heading", level: 2, text: "H2" }, m2);
      expect(findTag(m2.children[0], "h2").tagName).toBe("H2");

      const m3 = mount();
      renderBlock({ type: "heading", level: 3, text: "H3" }, m3);
      expect(findTag(m3.children[0], "h3").tagName).toBe("H3");

      const m4 = mount();
      renderBlock({ type: "heading", level: 4, text: "H4" }, m4);
      expect(findTag(m4.children[0], "h4").tagName).toBe("H4");

      // The container always carries .block.block--heading.
      expect(hasClass(m2.children[0], "block--heading")).toBe(true);
    });

    it("heading → out-of-range/missing level clamps into 2..4", () => {
      const low = mount();
      renderBlock({ type: "heading", level: 1, text: "too low" }, low);
      expect(findTag(low.children[0], "h2").tagName).toBe("H2");

      const high = mount();
      renderBlock({ type: "heading", level: 9, text: "too high" }, high);
      expect(findTag(high.children[0], "h4").tagName).toBe("H4");

      const none = mount();
      renderBlock({ type: "heading", text: "no level" }, none);
      expect(findTag(none.children[0], "h2").tagName).toBe("H2");
    });

    it("list → .block.block--list wrapping a <ul> of <li> items", () => {
      const m = mount();
      renderBlock({ type: "list", items: ["one", "two", "three"] }, m);

      const block = m.children[0];
      expect(hasClass(block, "block--list")).toBe(true);

      const ul = findTag(block, "ul");
      expect(ul.tagName).toBe("UL");
      const lis = ul.children.filter((c) => c.tagName === "LI");
      expect(lis.length).toBe(3);
      expect(lis.map((li) => li.textContent)).toEqual(["one", "two", "three"]);
    });

    it("code → .code-lang label + <pre><code> with the source", () => {
      const m = mount();
      renderBlock(
        { type: "code", lang: "javascript", source: "const x = 1;" },
        m,
      );

      const block = m.children[0];
      expect(hasClass(block, "block--code")).toBe(true);

      const label = findClass(block, "code-lang");
      expect(label.textContent).toBe("javascript");

      const pre = findTag(block, "pre");
      expect(pre.tagName).toBe("PRE");
      const code = findTag(pre, "code");
      expect(code.tagName).toBe("CODE");
      expect(code.textContent).toBe("const x = 1;");
    });

    it("callout → .block.block--callout wrapping a <p> with the text", () => {
      const m = mount();
      renderBlock({ type: "callout", text: "Note this." }, m);

      const block = m.children[0];
      expect(hasClass(block, "block--callout")).toBe(true);
      const p = findTag(block, "p");
      expect(p.tagName).toBe("P");
      expect(p.textContent).toBe("Note this.");
    });

    it("figure → <figure class=block--figure> with img src/alt and a figcaption", () => {
      const m = mount();
      renderBlock(
        { type: "figure", src: "assets/figures/x.svg", alt: "A diagram", caption: "<b>Cap</b>" },
        m,
      );
      const block = m.children[0];
      expect(block.tagName).toBe("FIGURE");
      expect(hasClass(block, "block--figure")).toBe(true);
      const img = findTag(block, "img");
      expect(img.getAttribute("src")).toBe("assets/figures/x.svg");
      expect(img.getAttribute("alt")).toBe("A diagram");
      const cap = findTag(block, "figcaption");
      expect(cap.textContent).toBe("<b>Cap</b>");
      expect(cap.children.length).toBe(0);
    });

    it("figure without a caption renders only the image", () => {
      const m = mount();
      renderBlock({ type: "figure", src: "a.png", alt: "Alt" }, m);
      expect(findTag(m.children[0], "figcaption")).toBe(null);
    });

    it("figure with no alt text or an unsafe src → placeholder, no image", () => {
      const bad = [
        { type: "figure", src: "assets/figures/x.svg" },
        { type: "figure", src: "assets/figures/x.svg", alt: "  " },
        { type: "figure", src: "javascript:alert(1)//.svg", alt: "x" },
        { type: "figure", src: "https://example.com/x.svg", alt: "x" },
        { type: "figure", src: "/etc/x.svg", alt: "x" },
        { type: "figure", src: "assets/../../x.svg", alt: "x" },
        { type: "figure", src: "assets/figures/x.html", alt: "x" },
      ];
      for (const b of bad) {
        const m = mount();
        renderBlock(b, m);
        expect(hasClass(m.children[0], "block--placeholder")).toBe(true);
        expect(findTag(m, "img")).toBe(null);
      }
    });

    it("unknown type → a visible non-fatal placeholder (Req 15.2)", () => {
      const m = mount();
      renderBlock({ type: "no-such-type" }, m);
      const block = m.children[0];
      expect(hasClass(block, "block--placeholder")).toBe(true);
      expect(block.textContent).toBe("Unsupported block: no-such-type");
    });
  });

  // =========================================================================
  // prose/code render content as TEXT, not HTML (Requirements 3.4, 3.7, 3.10).
  // Markup in the text must appear as a literal string, never as a child
  // element — i.e. textContent round-trips and no element child is created
  // from the "<script>...".
  // =========================================================================

  describe("prose/code render markup as literal text (Req 3.4, 3.7, 3.10)", () => {
    it("prose text with markup is set via textContent and stays literal", () => {
      const m = mount();
      const evil = '<script>alert("xss")</script>';
      renderBlock({ type: "prose", text: evil }, m);

      const p = findTag(m.children[0], "p");
      // The exact markup string is the paragraph's text…
      expect(p.textContent).toBe(evil);
      // …and it produced NO element child (no parsed <script> node anywhere).
      const scripts = findAll(m, (n) => n.tagName === "SCRIPT");
      expect(scripts.length).toBe(0);
      // The <p> has no element children at all — only literal text.
      expect(p.children.length).toBe(0);
    });

    it("code source with markup is set via textContent and stays literal", () => {
      const m = mount();
      const snippet = 'if (a < b && c > d) { html = "<b>x</b>"; }';
      renderBlock({ type: "code", lang: "js", source: snippet }, m);

      const code = findTag(m.children[0], "code");
      expect(code.textContent).toBe(snippet);
      // No <b> element was created from the embedded markup.
      const bolds = findAll(m, (n) => n.tagName === "B");
      expect(bolds.length).toBe(0);
      expect(code.children.length).toBe(0);
    });
  });

  // =========================================================================
  // renderNav — breadcrumb (ol.breadcrumb) from the active path + nav tree.
  // =========================================================================

  describe("renderNav breadcrumb + tree (Req 2.3)", () => {
    function navTree() {
      return {
        slug: "root",
        title: "Root",
        children: [
          {
            slug: "snn",
            title: "Spiking Neural Networks",
            children: [
              { slug: "neuron-models", title: "Neuron Models" },
            ],
          },
          { slug: "math", title: "Mathematics" },
        ],
      };
    }

    it("builds an ol.breadcrumb from the active path (Home + each segment)", () => {
      const m = mount();
      renderNav(navTree(), ["snn", "neuron-models"], m);

      const crumb = findClass(m, "breadcrumb");
      expect(crumb.tagName).toBe("OL");

      const items = crumb.children.filter((c) =>
        hasClass(c, "breadcrumb__item"),
      );
      // Home + snn + neuron-models.
      expect(items.length).toBe(3);

      // Leading crumb is the Home link.
      const homeLink = findClass(items[0], "breadcrumb__link");
      expect(homeLink.textContent).toBe("Home");
      expect(homeLink.getAttribute("href")).toBe("#/");

      // Middle crumb resolves its title from the tree and links to its prefix.
      const snnLink = findClass(items[1], "breadcrumb__link");
      expect(snnLink.textContent).toBe("Spiking Neural Networks");
      expect(snnLink.getAttribute("href")).toBe("#/snn");

      // Final crumb is the current page: plain text, aria-current, not a link.
      const current = items[2];
      expect(current.getAttribute("aria-current")).toBe("page");
      expect(current.textContent).toBe("Neuron Models");
      expect(findClass(current, "breadcrumb__link")).toBe(null);
    });

    it("renders no breadcrumb for the home route (empty path)", () => {
      const m = mount();
      renderNav(navTree(), [], m);
      expect(findClass(m, "breadcrumb")).toBe(null);
      // The topic tree itself is still rendered.
      expect(findClass(m, "nav-tree")).toBeTruthy();
    });

    it("renders the topic tree with a link per node and marks the active one", () => {
      const m = mount();
      renderNav(navTree(), ["snn"], m);

      const links = findAll(m, (n) => hasClass(n, "nav-tree__link"));
      const labels = links.map((l) => l.textContent);
      expect(labels.includes("Spiking Neural Networks")).toBe(true);
      expect(labels.includes("Neuron Models")).toBe(true);
      expect(labels.includes("Mathematics")).toBe(true);

      // The active node's link carries aria-current="page".
      const active = links.find(
        (l) => l.getAttribute("aria-current") === "page",
      );
      expect(active.textContent).toBe("Spiking Neural Networks");
      expect(active.getAttribute("href")).toBe("#/snn");
    });
  });

  // =========================================================================
  // renderPage home view — .home-grid with one .home-card per root child,
  // showing title + optional summary (Requirement 1.2).
  // =========================================================================

  describe("renderPage home view (Req 1.2)", () => {
    function homeResolution() {
      return {
        node: null,
        path: [],
        tree: {
          slug: "root",
          title: "Library of Alexandria",
          children: [
            {
              slug: "snn",
              title: "Spiking Neural Networks",
              summary: "Event-driven neural computation.",
            },
            {
              // No summary → card shows title only.
              slug: "math",
              title: "Mathematics",
            },
          ],
        },
      };
    }

    it("renders a .home-grid with one .home-card per root child", () => {
      const m = mount();
      renderPage(homeResolution(), null, m);

      const grid = findClass(m, "home-grid");
      expect(grid.tagName).toBe("UL");

      const cards = findAll(m, (n) => hasClass(n, "home-card"));
      expect(cards.length).toBe(2);
    });

    it("each card shows the node title and, when present, its summary", () => {
      const m = mount();
      renderPage(homeResolution(), null, m);

      // Cards are ordered alphabetically by title, so Mathematics precedes
      // Spiking Neural Networks regardless of authored order.
      const cards = findAll(m, (n) => hasClass(n, "home-card"));

      // The card is no longer an <a>: the route href and the title text now
      // live on the inner .home-card__link, not on the card element itself.
      const snn = cards.find(
        (c) =>
          findClass(c, "home-card__link").textContent ===
          "Spiking Neural Networks",
      );
      const snnLink = findClass(snn, "home-card__link");
      expect(snnLink.getAttribute("href")).toBe("#/snn");
      expect(snnLink.textContent).toBe("Spiking Neural Networks");
      // The card carries no href of its own anymore.
      expect(snn.getAttribute("href")).toBe(null);
      // Summary present → a .home-card__summary with the text.
      expect(findClass(snn, "home-card__summary").textContent).toBe(
        "Event-driven neural computation.",
      );

      // Second card: title only, no summary element.
      const math = cards.find(
        (c) => findClass(c, "home-card__link").textContent === "Mathematics",
      );
      expect(findClass(math, "home-card__link").textContent).toBe(
        "Mathematics",
      );
      expect(findClass(math, "home-card__link").getAttribute("href")).toBe(
        "#/math",
      );
      // Summary absent → no .home-card__summary element at all.
      expect(findClass(math, "home-card__summary")).toBe(null);
    });
  });
});
