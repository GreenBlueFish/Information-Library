// Bookmarks (src/bookmarks.js): storage, matching, the page ribbons and the
// Bookmarks page.
import { describe, it, expect } from "../harness.js";
import { ensureDom } from "../dom.js";

const dom = await ensureDom();
globalThis.document = dom.document;
const bm = await import("../../src/bookmarks.js");

function fakeStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}
const refusing = {
  getItem() {
    throw new Error("denied");
  },
  setItem() {
    throw new Error("denied");
  },
};
const click = (b) => b.dispatchEvent(new dom.window.Event("click"));

function topicPage() {
  globalThis.document = dom.document;
  const app = dom.document.createElement("main");
  app.innerHTML =
    '<div class="page"><h1 class="page-title">Axioms</h1><p class="page-intro">Where probability starts.</p>' +
    '<div class="block block--heading"><h2>Sample spaces</h2></div>' +
    '<div class="block block--prose"><p>A sample space is the set of every outcome an experiment can have.</p></div>' +
    '<div class="block block--heading"><h3>Events</h3></div>' +
    '<div class="block block--prose"><p>An event is a subset of the sample space, a collection of outcomes.</p></div>' +
    "</div>";
  dom.document.body.appendChild(app);
  return app;
}
const ctx = { route: "probability/basics/axioms", pageTitle: "Axioms", trail: ["Probability", "Basics", "Axioms"] };

describe("bookmark storage", () => {
  it("adds, finds, updates and removes a section bookmark", () => {
    const s = fakeStorage();
    const b = bm.addBookmark({ route: "a/b", heading: "Events", snippet: "x", pageTitle: "B", trail: ["A", "B"] }, s, 1000);
    expect(bm.readBookmarks(s).length).toBe(1);
    expect(b.note).toBe("");
    expect(bm.findBookmark(bm.readBookmarks(s), "a/b", "  events ")?.id).toBe(b.id);
    expect(bm.findBookmark(bm.readBookmarks(s), "a/b", null)).toBe(null);
    bm.updateBookmark(b.id, { note: "revise this" }, s, 2000);
    expect(bm.readBookmarks(s)[0].note).toBe("revise this");
    expect(bm.readBookmarks(s)[0].updated).toBe(2000);
    expect(bm.removeBookmark(b.id, s)?.id).toBe(b.id);
    expect(bm.readBookmarks(s).length).toBe(0);
  });

  it("adding the same section twice keeps one bookmark", () => {
    const s = fakeStorage();
    const a = bm.addBookmark({ route: "a/b", heading: "Events" }, s);
    const b = bm.addBookmark({ route: "a/b", heading: "events" }, s);
    expect(a.id).toBe(b.id);
    expect(bm.readBookmarks(s).length).toBe(1);
  });

  it("a page bookmark and a section bookmark on one page are separate", () => {
    const s = fakeStorage();
    bm.addBookmark({ route: "a/b", heading: null }, s);
    bm.addBookmark({ route: "a/b", heading: "Events" }, s);
    expect(bm.readBookmarks(s).length).toBe(2);
  });

  it("survives refused or broken storage", () => {
    expect(bm.readBookmarks(refusing)).toEqual([]);
    expect(bm.writeBookmarks([], refusing)).toBe(false);
    expect(bm.readVisit(refusing)).toBe(null);
    expect(bm.recordVisit({ route: "a" }, refusing)).toBe(false);
    const s = fakeStorage();
    s.setItem(bm.STORAGE_KEY, "{not json");
    expect(bm.readBookmarks(s)).toEqual([]);
    s.setItem(bm.STORAGE_KEY, JSON.stringify([{ id: 3 }, { id: "ok", route: "x", note: 5 }]));
    const list = bm.readBookmarks(s);
    expect(list.length).toBe(1);
    expect(list[0].note).toBe("");
  });

  it("restores a removed bookmark (undo)", () => {
    const s = fakeStorage();
    const b = bm.addBookmark({ route: "a", heading: "H" }, s);
    const removed = bm.removeBookmark(b.id, s);
    bm.restoreBookmark(removed, s);
    expect(bm.readBookmarks(s)[0].id).toBe(b.id);
  });

  it("imports an export, keeping the newer copy of the same section", () => {
    const s = fakeStorage();
    const mine = bm.addBookmark({ route: "a", heading: "H", note: "old" }, s, 100);
    const n = bm.importBookmarks(
      {
        bookmarks: [
          { ...mine, id: "other", note: "new", updated: 500 },
          { id: "z", route: "b", heading: null, updated: 1 },
          { nonsense: true },
        ],
      },
      s,
    );
    expect(n).toBe(2);
    const list = bm.readBookmarks(s);
    expect(list.length).toBe(2);
    expect(list.find((b) => b.route === "a").note).toBe("new");
    expect(bm.importBookmarks([{ id: "z", route: "b", heading: null, updated: 0 }], s)).toBe(0);
  });

  it("saves and reads the last visit", () => {
    const s = fakeStorage();
    bm.recordVisit({ route: "p/q", pageTitle: "Q", trail: ["P", "Q"], heading: "Events", scrollY: 420 }, s, 9000);
    const v = bm.readVisit(s);
    expect(v.route).toBe("p/q");
    expect(v.heading).toBe("Events");
    expect(v.scrollY).toBe(420);
    expect(v.at).toBe(9000);
  });
});

describe("bookmark helpers", () => {
  it("groups by shelf then topic, sorted by title", () => {
    const list = [
      { id: "1", route: "q/x/p", heading: "H", trail: ["Quantum", "Gates", "P"], pageTitle: "P", created: 1 },
      { id: "2", route: "a/y/p", heading: "H", trail: ["Analog", "Filters", "P"], pageTitle: "P", created: 1 },
      { id: "3", route: "q/a/p", heading: "H", trail: ["Quantum", "Bits", "P"], pageTitle: "P", created: 1 },
    ];
    const groups = bm.groupBookmarks(list);
    expect(groups.map((g) => g.shelf)).toEqual(["Analog", "Quantum"]);
    expect(groups[1].topics.map((t) => t.topic)).toEqual(["Bits", "Gates"]);
  });

  it("filters on heading, note, page and trail", () => {
    const b = { heading: "Events", note: "Exam on Friday", pageTitle: "Axioms", trail: ["Probability"], snippet: "" };
    expect(bm.matchesFilter(b, "friday")).toBe(true);
    expect(bm.matchesFilter(b, "PROBABILITY")).toBe(true);
    expect(bm.matchesFilter(b, "quantum")).toBe(false);
    expect(bm.matchesFilter(b, "  ")).toBe(true);
  });

  it("describes times in words", () => {
    const now = 10 * 86400000;
    expect(bm.timeAgo(now - 5000, now)).toBe("just now");
    expect(bm.timeAgo(now - 5 * 60000, now)).toBe("5 minutes ago");
    expect(bm.timeAgo(now - 3600000, now)).toBe("1 hour ago");
    expect(bm.timeAgo(now - 86400000, now)).toBe("yesterday");
    expect(bm.timeAgo(now - 3 * 86400000, now)).toBe("3 days ago");
  });

  it("finds a section by heading, then by snippet after a rename", () => {
    const app = topicPage();
    expect(bm.locateSection(app, "events")?.textContent).toBe("Events");
    const snip = bm.sectionSnippet(app.querySelectorAll("h2")[0]);
    expect(snip.startsWith("A sample space")).toBe(true);
    app.querySelector("h2").textContent = "The sample space";
    expect(bm.locateSection(app, "Sample spaces", snip)?.textContent).toBe("The sample space");
    expect(bm.locateSection(app, "Gone", "nothing like this text appears anywhere at all")).toBe(null);
    app.remove();
  });

  it("only takes a jump for the route it was asked for", () => {
    bm.requestJump({ route: "a", heading: "H" });
    expect(bm.takeJump("b")).toBe(null);
    expect(bm.takeJump("a")).toBe(null);
    bm.requestJump({ route: "a", heading: "H" });
    expect(bm.takeJump("a")?.heading).toBe("H");
  });

  it("flags a bookmark as moved when its section is gone", () => {
    const s = fakeStorage();
    const app = topicPage();
    const b = bm.addBookmark({ route: ctx.route, heading: "Removed section", snippet: "" }, s);
    const result = bm.applyJump(app, { route: ctx.route, heading: b.heading, bookmarkId: b.id }, s);
    expect(result).toBe("moved");
    expect(bm.readBookmarks(s)[0].moved).toBe(true);
    expect(app.querySelector(".bm-notice") !== null).toBe(true);
    app.remove();
  });
});

describe("ribbons on a page", () => {
  it("puts a ribbon on the title and each section heading", () => {
    const s = fakeStorage();
    const app = topicPage();
    bm.decoratePage(app, ctx, s);
    expect(app.querySelectorAll(".bm-ribbon").length).toBe(3);
    expect(app.querySelector(".page-title .bm-ribbon") !== null).toBe(true);
    expect(app.querySelector("h2").textContent).toBe("Sample spaces");
    app.remove();
  });

  it("bookmarks a section, saves a note, then removes it", () => {
    const s = fakeStorage();
    const app = topicPage();
    bm.decoratePage(app, ctx, s);
    const ribbon = app.querySelector("h3 .bm-ribbon");
    click(ribbon);
    let list = bm.readBookmarks(s);
    expect(list.length).toBe(1);
    expect(list[0].heading).toBe("Events");
    expect(list[0].snippet.startsWith("An event is")).toBe(true);
    expect(list[0].trail).toEqual(ctx.trail);
    expect(ribbon.getAttribute("aria-pressed")).toBe("true");
    expect(app.querySelector("h3").parentElement.classList.contains("is-bookmarked")).toBe(true);
    expect(app.querySelector(".bm-onpage") !== null).toBe(true);

    const editor = app.querySelector(".bm-editor");
    editor.querySelector("textarea").value = "  check the proof  ";
    click([...editor.querySelectorAll("button")].find((b) => b.textContent === "Save note"));
    expect(bm.readBookmarks(s)[0].note).toBe("check the proof");
    expect(app.querySelector(".bm-editor")).toBe(null);

    click(ribbon); // reopens the editor for the existing bookmark
    expect(bm.readBookmarks(s).length).toBe(1);
    const again = app.querySelector(".bm-editor");
    expect(again.querySelector("textarea").value).toBe("check the proof");
    click([...again.querySelectorAll("button")].find((b) => b.textContent === "Remove bookmark"));
    expect(bm.readBookmarks(s).length).toBe(0);
    expect(ribbon.getAttribute("aria-pressed")).toBe("false");
    expect(app.querySelector(".bm-onpage")).toBe(null);
    app.remove();
  });

  it("the title ribbon bookmarks the whole page", () => {
    const s = fakeStorage();
    const app = topicPage();
    bm.decoratePage(app, ctx, s);
    click(app.querySelector(".page-title .bm-ribbon"));
    const [b] = bm.readBookmarks(s);
    expect(b.heading).toBe(null);
    expect(b.pageTitle).toBe("Axioms");
    app.remove();
  });

  it("shows saved bookmarks when the page is opened again", () => {
    const s = fakeStorage();
    bm.addBookmark({ route: ctx.route, heading: "Sample spaces" }, s);
    const app = topicPage();
    bm.decoratePage(app, ctx, s);
    expect(app.querySelector("h2 .bm-ribbon").getAttribute("aria-pressed")).toBe("true");
    expect(app.querySelector("h3 .bm-ribbon").getAttribute("aria-pressed")).toBe("false");
    app.remove();
  });
});

describe("the Bookmarks page", () => {
  it("says how to start when there are none", () => {
    const s = fakeStorage();
    const mount = dom.document.createElement("div");
    bm.renderBookmarksPage(mount, {}, s);
    expect(mount.querySelector("h1").textContent).toBe("Bookmarks");
    expect(mount.querySelector(".bm-empty") !== null).toBe(true);
    expect(mount.querySelector(".bm-continue")).toBe(null);
  });

  it("shows continue, groups, notes, and deletes with undo", () => {
    const s = fakeStorage();
    bm.recordVisit({ route: "q/g/p", pageTitle: "Phase gates", trail: ["Quantum", "Gates", "Phase gates"], heading: "The T gate" }, s, 1000);
    bm.addBookmark({ route: ctx.route, heading: "Events", pageTitle: "Axioms", trail: ctx.trail, note: "exam" }, s, 1000);
    bm.addBookmark({ route: "q/g/p", heading: null, pageTitle: "Phase gates", trail: ["Quantum", "Gates", "Phase gates"] }, s, 1000);
    const mount = dom.document.createElement("div");
    bm.renderBookmarksPage(mount, { now: 2000 }, s);

    const cont = mount.querySelector(".bm-continue");
    expect(cont !== null).toBe(true);
    expect(cont.querySelector("a").getAttribute("href")).toBe("#/q/g/p");
    expect(cont.textContent.includes("The T gate")).toBe(true);

    expect([...mount.querySelectorAll(".bm-shelf__title")].map((h) => h.textContent)).toEqual(["Probability", "Quantum"]);
    const items = mount.querySelectorAll(".bm-item");
    expect(items.length).toBe(2);
    expect(items[0].querySelector(".bm-item__link").getAttribute("href")).toBe("#/" + ctx.route);
    expect(items[0].querySelector(".bm-item__note").textContent).toBe("exam");

    // Clicking a bookmark asks the next render to scroll to its section.
    click(items[0].querySelector(".bm-item__link"));
    expect(bm.takeJump(ctx.route)?.heading).toBe("Events");

    // Edit the note in place.
    click([...items[0].querySelectorAll("button")].find((b) => b.textContent === "Edit note"));
    items[0].querySelector(".bm-editor textarea").value = "exam friday";
    click([...items[0].querySelectorAll("button")].find((b) => b.textContent === "Save"));
    expect(bm.readBookmarks(s).find((b) => b.route === ctx.route).note).toBe("exam friday");

    // Delete, then undo.
    click([...items[0].querySelectorAll("button")].find((b) => b.textContent === "Delete"));
    expect(bm.readBookmarks(s).length).toBe(1);
    const undo = [...mount.querySelectorAll(".bm-item--removed button")][0];
    click(undo);
    expect(bm.readBookmarks(s).length).toBe(2);
    expect(mount.querySelectorAll(".bm-item").length).toBe(2);
  });

  it("filters the list", () => {
    const s = fakeStorage();
    bm.addBookmark({ route: "a/b/c", heading: "Events", pageTitle: "C", trail: ["A", "B", "C"], note: "friday" }, s);
    bm.addBookmark({ route: "x/y/z", heading: "Gates", pageTitle: "Z", trail: ["X", "Y", "Z"] }, s);
    const mount = dom.document.createElement("div");
    bm.renderBookmarksPage(mount, {}, s);
    const filter = mount.querySelector(".bm-filter");
    filter.value = "friday";
    filter.dispatchEvent(new dom.window.Event("input"));
    const shelves = [...mount.querySelectorAll(".bm-shelf")];
    expect(shelves.map((sh) => sh.hidden)).toEqual([false, true]);
  });

  it("the home continue card links to the last page", () => {
    const card = bm.renderContinueCard({ route: "a/b", pageTitle: "B", trail: ["A", "B"], heading: null, scrollY: 300, at: 0 }, { compact: true, now: 0 });
    expect(card.classList.contains("bm-continue--compact")).toBe(true);
    expect(card.querySelector("a").getAttribute("href")).toBe("#/a/b");
    expect(bm.renderContinueCard(null)).toBe(null);
  });
});
