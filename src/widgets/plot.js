// src/widgets/plot.js
//
// Shared plotting primitive (design.md — Component 5 / "plot.js — the shared
// plotting primitive used by widgets"). Every parameter-driven visualization in
// Alexandria draws through this one module so plots look and behave the same
// across widget types.
//
// `makePlot(container)` returns a small handle — `{ draw(series), dispose() }`.
// `draw` renders one or more data series into `container`; `dispose` tears down
// everything the plot created. The renderer is SVG rather than canvas on
// purpose: SVG elements accept the project's documented, token-driven CSS
// classes directly, so the plot's colors, axes, and gridlines are controlled
// entirely from `assets/css/alexandria.css` (§10) and `tokens.css` — this
// module hard-codes no color, font, or spacing value, mirroring the stylesheet
// contract.
//
// Class contract consumed from alexandria.css §10 (all applied here):
//   .widget__plot         the container this primitive draws into (host styles)
//   .plot-grid            background gridlines   -> stroke var(--color-plot-grid)
//   .plot-axis            x/y axis lines         -> stroke var(--color-plot-axis)
//   .plot-axis-label      axis tick labels       -> fill  var(--color-plot-axis)
//   .plot-series--1..6    one per data series    -> stroke/fill var(--color-series-N)
//   .widget__legend       legend row             (rendered as a sibling <ul>)
//   .widget__legend-item  one legend entry
//   .widget__legend-swatch  color swatch; its series class carries the color
//
// Requirements:
//   10.5 — widgets render a live plot that updates from parameter state; this
//          primitive provides the shared, redrawable rendering surface.
//   12.6 — plot styling + categorical data-series colors come from tokens via
//          the documented classes (no hard-coded colors here).

/**
 * A single plottable data series.
 *
 * @typedef {Object} PlotSeries
 * @property {Array<{x:number, y:number}>} points  Ordered sample points. An
 *   empty array is allowed (the series contributes to the legend but draws no
 *   line). Non-finite x/y values are skipped so a simulation gap does not throw.
 * @property {string} [label]  Human label shown in the legend. When omitted the
 *   series is labeled positionally ("Series 1", "Series 2", …).
 */

/**
 * The handle returned by {@link makePlot}.
 *
 * @typedef {Object} PlotHandle
 * @property {(series: PlotSeries[], axes?: {xLabel?: string, yLabel?: string}) => void} draw
 *   Render (or re-render) the
 *   given series. Calling `draw` again fully replaces the previous drawing, so
 *   it is safe to call on every parameter change.
 * @property {() => void} dispose  Remove all DOM this plot created from the
 *   container and drop internal references. Idempotent.
 */

/** The SVG namespace — required because SVG elements are not in the HTML ns. */
const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * The plot's internal coordinate system. The SVG uses a fixed viewBox and
 * scales responsively to the container width via CSS (`.widget__plot svg`
 * sets `width:100%`), so these numbers are design units, not pixels.
 */
const VIEW = { width: 640, height: 360 };

/**
 * Inner drawing area margins (design units) leaving room for axis labels.
 */
const MARGIN = { top: 16, right: 16, bottom: 40, left: 60 };

/** Number of gridlines/ticks along each axis (including the axis itself). */
const TICKS = { x: 5, y: 5 };

/** How many categorical series colors the token palette defines (1..6). */
const SERIES_COLOR_COUNT = 6;

/**
 * Create a plotting surface inside `container`.
 *
 * The plot does not draw until {@link PlotHandle.draw} is called, so a widget
 * can create the handle up front and render once its initial parameter state is
 * known. `draw` is fully declarative: each call rebuilds the SVG from the
 * supplied series, which keeps re-rendering on parameter changes simple and
 * leak-free.
 *
 * @param {HTMLElement} container  The element to draw into — typically the
 *   widget's `.widget__plot` element. Must be a real DOM element.
 * @returns {PlotHandle}
 * @throws {TypeError} If `container` is not an element, or if the environment
 *   has no `document` (e.g. a non-DOM test runner).
 */
export function makePlot(container) {
  if (typeof document === "undefined") {
    throw new TypeError("makePlot requires a DOM environment (no `document` found).");
  }
  if (!container || typeof container.appendChild !== "function") {
    throw new TypeError("makePlot(container): `container` must be a DOM element.");
  }

  /** Root group the plot owns inside `container`; null once disposed. */
  let svg = /** @type {SVGSVGElement | null} */ (null);
  /** Legend list the plot owns; null when there is nothing to show / disposed. */
  let legend = /** @type {HTMLUListElement | null} */ (null);
  let disposed = false;

  /**
   * Render the given series, replacing any previous drawing.
   * @param {PlotSeries[]} series
   */
  function draw(series, axes = {}) {
    if (disposed) return;
    const list = normalizeSeries(series);

    // Tear down the prior drawing so draw() is idempotent and leak-free.
    removeOwnedNodes();

    svg = buildSvg(list, axes);
    container.appendChild(svg);

    legend = buildLegend(list);
    if (legend) container.appendChild(legend);
  }

  /**
   * Remove everything this plot added to the container and release references.
   * Safe to call more than once.
   */
  function dispose() {
    disposed = true;
    removeOwnedNodes();
  }

  /** Detach the SVG + legend this instance created (if still attached). */
  function removeOwnedNodes() {
    if (svg && svg.parentNode === container) container.removeChild(svg);
    if (legend && legend.parentNode === container) container.removeChild(legend);
    svg = null;
    legend = null;
  }

  return { draw, dispose };
}

/**
 * Coerce arbitrary input into a clean array of series with finite points and a
 * resolved label, so the drawing code can assume well-formed data.
 * @param {PlotSeries[]} series
 * @returns {Array<{points: Array<{x:number,y:number}>, label: string}>}
 */
function normalizeSeries(series) {
  const arr = Array.isArray(series) ? series : [];
  return arr.map((s, i) => {
    const rawPoints = s && Array.isArray(s.points) ? s.points : [];
    const points = rawPoints
      .filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y))
      .map((p) => ({ x: p.x, y: p.y }));
    const label = s && typeof s.label === "string" && s.label.length > 0
      ? s.label
      : `Series ${i + 1}`;
    return { points, label };
  });
}

/**
 * The 1-based series color class index (1..SERIES_COLOR_COUNT), wrapping when a
 * plot has more series than the palette has colors.
 * @param {number} seriesIndex 0-based series index.
 * @returns {number}
 */
function seriesColorIndex(seriesIndex) {
  return (seriesIndex % SERIES_COLOR_COUNT) + 1;
}

/**
 * Build the SVG element containing grid, axes, labels, and series paths.
 * @param {Array<{points: Array<{x:number,y:number}>, label: string}>} list
 * @returns {SVGSVGElement}
 */
function buildSvg(list, axes = {}) {
  const svg = /** @type {SVGSVGElement} */ (document.createElementNS(SVG_NS, "svg"));
  svg.setAttribute("viewBox", `0 0 ${VIEW.width} ${VIEW.height}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");

  const bounds = computeBounds(list);
  const area = {
    left: MARGIN.left,
    right: VIEW.width - MARGIN.right,
    top: MARGIN.top,
    bottom: VIEW.height - MARGIN.bottom,
  };

  /**
   * Map a data point into SVG coordinates (y is inverted: SVG grows downward).
   * @param {number} x @param {number} y
   * @returns {{x:number, y:number}}
   */
  const project = (x, y) => ({
    x: area.left + ((x - bounds.minX) / bounds.spanX) * (area.right - area.left),
    y: area.bottom - ((y - bounds.minY) / bounds.spanY) * (area.bottom - area.top),
  });

  svg.appendChild(buildGrid(area, bounds, project));
  svg.appendChild(buildAxes(area));
  svg.appendChild(buildAxisLabels(area, bounds));
  const titles = buildAxisTitles(area, axes);
  if (titles) svg.appendChild(titles);

  for (let i = 0; i < list.length; i++) {
    const node = buildSeriesPath(list[i].points, project, seriesColorIndex(i), list[i].label);
    if (node) svg.appendChild(node);
  }

  return svg;
}

/**
 * Compute the data bounds across all series, guaranteeing a non-zero span so a
 * flat or single-point series still draws on a sensible axis.
 * @param {Array<{points: Array<{x:number,y:number}>}>} list
 * @returns {{minX:number,maxX:number,minY:number,maxY:number,spanX:number,spanY:number}}
 */
function computeBounds(list) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const s of list) {
    for (const p of s.points) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
  }
  // Fall back to a unit box when there is no data at all.
  if (!Number.isFinite(minX)) { minX = 0; maxX = 1; minY = 0; maxY = 1; }

  let spanX = maxX - minX;
  let spanY = maxY - minY;
  if (spanX === 0) { minX -= 0.5; maxX += 0.5; spanX = maxX - minX; }
  if (spanY === 0) { minY -= 0.5; maxY += 0.5; spanY = maxY - minY; }
  return { minX, maxX, minY, maxY, spanX, spanY };
}

/**
 * Build the gridlines group. Styled by `.plot-grid` (stroke token).
 * @param {{left:number,right:number,top:number,bottom:number}} area
 * @param {{minX:number,maxX:number,minY:number,maxY:number}} bounds
 * @param {(x:number,y:number)=>{x:number,y:number}} project
 * @returns {SVGGElement}
 */
function buildGrid(area, bounds, project) {
  const g = document.createElementNS(SVG_NS, "g");
  g.setAttribute("class", "plot-grid");

  for (let i = 0; i < TICKS.x; i++) {
    const x = bounds.minX + ((bounds.maxX - bounds.minX) * i) / (TICKS.x - 1);
    const px = project(x, bounds.minY).x;
    g.appendChild(line(px, area.top, px, area.bottom));
  }
  for (let i = 0; i < TICKS.y; i++) {
    const y = bounds.minY + ((bounds.maxY - bounds.minY) * i) / (TICKS.y - 1);
    const py = project(bounds.minX, y).y;
    g.appendChild(line(area.left, py, area.right, py));
  }
  return g;
}

/**
 * Build the x and y axis lines. Styled by `.plot-axis` (stroke token).
 * @param {{left:number,right:number,top:number,bottom:number}} area
 * @returns {SVGGElement}
 */
function buildAxes(area) {
  const g = document.createElementNS(SVG_NS, "g");
  g.setAttribute("class", "plot-axis");
  // y axis (left) and x axis (bottom).
  g.appendChild(line(area.left, area.top, area.left, area.bottom));
  g.appendChild(line(area.left, area.bottom, area.right, area.bottom));
  return g;
}

/**
 * Build numeric tick labels along both axes. Styled by `.plot-axis-label`
 * (fill + font tokens).
 * @param {{left:number,right:number,top:number,bottom:number}} area
 * @param {{minX:number,maxX:number,minY:number,maxY:number}} bounds
 * @returns {SVGGElement}
 */
function buildAxisLabels(area, bounds) {
  const g = document.createElementNS(SVG_NS, "g");
  g.setAttribute("class", "plot-axis-label");

  for (let i = 0; i < TICKS.x; i++) {
    const t = i / (TICKS.x - 1);
    const value = bounds.minX + (bounds.maxX - bounds.minX) * t;
    const px = area.left + (area.right - area.left) * t;
    const label = text(formatTick(value), px, area.bottom + 16);
    label.setAttribute("text-anchor", "middle");
    g.appendChild(label);
  }
  for (let i = 0; i < TICKS.y; i++) {
    const t = i / (TICKS.y - 1);
    const value = bounds.minY + (bounds.maxY - bounds.minY) * t;
    const py = area.bottom - (area.bottom - area.top) * t;
    const label = text(formatTick(value), area.left - 6, py + 4);
    label.setAttribute("text-anchor", "end");
    g.appendChild(label);
  }
  return g;
}

/**
 * Build one series as an SVG `<path>` polyline tagged with its `.plot-series--N`
 * class so the stroke/fill color comes from the matching token. Returns null
 * for an empty series (nothing to stroke).
 * @param {Array<{x:number,y:number}>} points
 * @param {(x:number,y:number)=>{x:number,y:number}} project
 * @param {number} colorIndex 1-based series color index.
 * @param {string} label
 * @returns {SVGPathElement | null}
 */
/** Optional axis titles (e.g. "time (ms)"), in the same class as tick labels. */
function buildAxisTitles(area, axes) {
  const { xLabel, yLabel } = axes ?? {};
  if (typeof xLabel !== "string" && typeof yLabel !== "string") return null;
  const g = document.createElementNS(SVG_NS, "g");
  g.setAttribute("class", "plot-axis-label");
  if (typeof xLabel === "string" && xLabel) {
    const t = text(xLabel, (area.left + area.right) / 2, area.bottom + 34);
    t.setAttribute("text-anchor", "middle");
    g.appendChild(t);
  }
  if (typeof yLabel === "string" && yLabel) {
    const cy = (area.top + area.bottom) / 2;
    const t = text(yLabel, 10, cy);
    t.setAttribute("text-anchor", "middle");
    t.setAttribute("transform", `rotate(-90 10 ${round(cy)})`);
    g.appendChild(t);
  }
  return g;
}

function buildSeriesPath(points, project, colorIndex, label) {
  if (points.length === 0) return null;
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("class", `plot-series--${colorIndex}`);
  // Series paths are open polylines: the stroke color comes from the token via
  // the `.plot-series--N` class, but that class also sets `fill` (for point
  // markers/legend swatches). An inline style overrides the stylesheet `fill`
  // so the line is not flooded — a presentation attribute would lose to the
  // stylesheet rule, an inline style wins.
  path.style.fill = "none";
  path.setAttribute("stroke-width", "2");
  path.setAttribute("stroke-linejoin", "round");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("d", pointsToPath(points, project));

  const title = document.createElementNS(SVG_NS, "title");
  title.textContent = label;
  path.appendChild(title);
  return path;
}

/**
 * Turn projected points into an SVG path `d` string ("M x y L x y …").
 * @param {Array<{x:number,y:number}>} points
 * @param {(x:number,y:number)=>{x:number,y:number}} project
 * @returns {string}
 */
function pointsToPath(points, project) {
  return points
    .map((p, i) => {
      const { x, y } = project(p.x, p.y);
      return `${i === 0 ? "M" : "L"} ${round(x)} ${round(y)}`;
    })
    .join(" ");
}

/**
 * Build the legend as a `<ul.widget__legend>`; each item carries a color swatch
 * whose `.plot-series--N` class ties it to the matching series color. Returns
 * null when there are no series to describe.
 * @param {Array<{points: Array<{x:number,y:number}>, label: string}>} list
 * @returns {HTMLUListElement | null}
 */
function buildLegend(list) {
  if (list.length === 0) return null;
  const ul = document.createElement("ul");
  ul.className = "widget__legend";

  list.forEach((s, i) => {
    const li = document.createElement("li");
    li.className = "widget__legend-item";

    const swatch = document.createElement("span");
    // The swatch is an HTML element, so its visible color is a background, not
    // the SVG `fill`/`stroke` the `.plot-series--N` class sets. Paint it from
    // the SAME series color token so the legend and plot stay in sync without
    // hard-coding a color here (still fully token-driven).
    swatch.className = "widget__legend-swatch";
    swatch.style.backgroundColor = `var(--color-series-${seriesColorIndex(i)})`;
    swatch.setAttribute("aria-hidden", "true");

    const name = document.createElement("span");
    name.textContent = s.label;

    li.appendChild(swatch);
    li.appendChild(name);
    ul.appendChild(li);
  });

  return ul;
}

/* -------------------------------------------------------------------------- */
/* Small SVG element helpers                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Create an SVG `<line>` between two points.
 * @param {number} x1 @param {number} y1 @param {number} x2 @param {number} y2
 * @returns {SVGLineElement}
 */
function line(x1, y1, x2, y2) {
  const el = document.createElementNS(SVG_NS, "line");
  el.setAttribute("x1", String(round(x1)));
  el.setAttribute("y1", String(round(y1)));
  el.setAttribute("x2", String(round(x2)));
  el.setAttribute("y2", String(round(y2)));
  return el;
}

/**
 * Create an SVG `<text>` label at a position.
 * @param {string} content @param {number} x @param {number} y
 * @returns {SVGTextElement}
 */
function text(content, x, y) {
  const el = document.createElementNS(SVG_NS, "text");
  el.setAttribute("x", String(round(x)));
  el.setAttribute("y", String(round(y)));
  el.textContent = content;
  return el;
}

/**
 * Format an axis tick value compactly: integers stay integers, otherwise two
 * significant-ish decimals trimmed of trailing zeros.
 * @param {number} value
 * @returns {string}
 */
function formatTick(value) {
  if (Number.isInteger(value)) return String(value);
  const fixed = value.toFixed(2);
  return fixed.replace(/\.?0+$/, "");
}

/**
 * Round to one decimal to keep generated SVG attribute strings small.
 * @param {number} n
 * @returns {number}
 */
function round(n) {
  return Math.round(n * 10) / 10;
}
