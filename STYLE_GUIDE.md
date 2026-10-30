# Alexandria — Style Guide

This is a governance document. It defines the visual system for the Library of
Alexandria so any future agent or contributor can extend the site and have it
stay coherent. Every number and name below mirrors the actual design tokens in
`assets/css/tokens.css` and the component class contract in
`assets/css/alexandria.css` — those two files are the source of truth, and this
guide documents them.

**The one rule:** all color, typography, and spacing decisions live in
`assets/css/tokens.css` as CSS custom properties on `:root`, and nowhere else.
`alexandria.css` consumes those tokens; it never hard-codes a hex color, a font
size, or a spacing value. To restyle the site, change a token — not a rule. When
you add a component, reference existing tokens by their role name rather than
inventing a new value.

---

## 1. Color scheme

A light, high-contrast reading theme. Tokens are named by role (`surface`,
`accent`, `link`) so components reference intent, not raw color. Body text
(`#1a2230`) on the page background (`#f7f8fa`) exceeds WCAG AA contrast.

### Page and surfaces

| Token | Hex | Role |
| --- | --- | --- |
| `--color-background` | `#f7f8fa` | Page canvas behind everything |
| `--color-surface` | `#ffffff` | Cards, panels, code blocks, raised areas |
| `--color-surface-alt` | `#eef1f6` | Subtle zebra / inset surface |
| `--color-border` | `#d6dbe3` | Hairlines, card and control borders |

### Text

| Token | Hex | Role |
| --- | --- | --- |
| `--color-text` | `#1a2230` | Primary body text |
| `--color-text-muted` | `#5a6577` | Secondary text, summaries, captions |
| `--color-text-inverse` | `#ffffff` | Text on accent / dark fills |
| `--color-heading` | `#0f1726` | Headings (slightly darker than body) |

### Accent (brand) and links

| Token | Hex | Role |
| --- | --- | --- |
| `--color-accent` | `#2f6fed` | Primary accent: active nav, focus, buttons |
| `--color-accent-hover` | `#1d57cc` | Accent hover / active state |
| `--color-accent-subtle` | `#e6efff` | Tinted accent background (active card/crumb) |
| `--color-link` | `#1d57cc` | Inline links |
| `--color-link-hover` | `#123c92` | Link hover |

### Callouts and status

| Token | Hex | Role |
| --- | --- | --- |
| `--color-callout-bg` | `#fff7e0` | Callout block background |
| `--color-callout-border` | `#e0b94d` | Callout left border / accent |
| `--color-error` | `#b00020` | Inline error text + border |
| `--color-error-bg` | `#fdecef` | Inline error block background |

### Code

| Token | Hex | Role |
| --- | --- | --- |
| `--color-code-bg` | `#f3f4f7` | Code block / inline code background |
| `--color-code-text` | `#243b53` | Code foreground |

### Widget controls

| Token | Hex | Role |
| --- | --- | --- |
| `--color-control-bg` | `#ffffff` | Control surface |
| `--color-control-border` | `#b9c2d0` | Control border (resting) |
| `--color-control-track` | `#d6dbe3` | Range slider track |
| `--color-control-thumb` | `#2f6fed` | Range slider thumb / toggle fill |
| `--color-control-focus` | `#2f6fed` | Focus ring color (controls + links) |

### Plot and data series

A categorical palette chosen for distinguishability on `--color-surface`. Series
tokens are applied through the `.plot-series--1` … `.plot-series--6` classes (see
§6, Widgets).

| Token | Hex | Role |
| --- | --- | --- |
| `--color-plot-bg` | `#ffffff` | Plot background |
| `--color-plot-axis` | `#5a6577` | Axis lines and labels |
| `--color-plot-grid` | `#e4e8ee` | Gridlines |
| `--color-series-1` | `#2f6fed` | Blue |
| `--color-series-2` | `#e5533c` | Vermilion |
| `--color-series-3` | `#2a9d5c` | Green |
| `--color-series-4` | `#b659d6` | Violet |
| `--color-series-5` | `#d9a000` | Amber |
| `--color-series-6` | `#1aa3b3` | Teal |

Use the series tokens in order (1 → 6). Six categories is the designed ceiling for
one plot; if a visualization needs more, reconsider the chart rather than adding a
seventh color.

---

## 2. Typography

### Font families

| Token | Stack | Used for |
| --- | --- | --- |
| `--font-sans` | `"Inter", "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif` | Body and headings |
| `--font-serif` | `"Iowan Old Style", "Palatino Linotype", "Georgia", serif` | Available for serif contexts |
| `--font-mono` | `"JetBrains Mono", "SFMono-Regular", "Consolas", "Menlo", "Liberation Mono", monospace` | Code, labels, placeholders |

Role aliases map the stacks onto uses: `--font-body-family` and
`--font-heading-family` both resolve to `--font-sans`; `--font-code-family`
resolves to `--font-mono`. Reference the role alias in components, not the raw
stack.

### Type scale

A ~1.25 (major third) modular scale anchored at 1rem body. The root font size is
set on `<html>` so the whole rem scale keys off it.

| Token | Value | Approx px | Used for |
| --- | --- | --- | --- |
| `--font-size-root` | `16px` | 16 | Set on `<html>`; `1rem == 16px` |
| `--font-size-h1` | `2.441rem` | ~39 | Page / hero title |
| `--font-size-h2` | `1.953rem` | ~31 | Section heading |
| `--font-size-h3` | `1.563rem` | ~25 | Subsection heading |
| `--font-size-h4` | `1.25rem` | ~20 | Minor heading |
| `--font-size-body` | `1rem` | 16 | Paragraph / default |
| `--font-size-small` | `0.8rem` | ~13 | Captions, breadcrumb, hint line |
| `--font-size-code` | `0.9375rem` | 15 | Code blocks and inline code |

Headings `h5` and `h6` reuse `--font-size-h4`.

### Line heights

| Token | Value | Used for |
| --- | --- | --- |
| `--line-height-body` | `1.6` | Comfortable prose reading |
| `--line-height-heading` | `1.2` | Tighter headings |
| `--line-height-code` | `1.5` | Code listings |

### Font weights

| Token | Value |
| --- | --- |
| `--font-weight-regular` | `400` |
| `--font-weight-medium` | `500` |
| `--font-weight-semibold` | `600` |
| `--font-weight-bold` | `700` |

Headings use `--font-weight-semibold`; the site title uses `--font-weight-bold`.

### Reading measure

Long text is capped so it stays legible.

| Token | Value | Used for |
| --- | --- | --- |
| `--measure` | `70ch` | Ideal body / prose column width |
| `--measure-wide` | `90ch` | Wide content (code blocks, plots, widgets) |

Prose, headings, lists, callouts, the page intro, and errors are capped at
`--measure`. Code blocks, widgets, and the widget placeholder use `--measure-wide`.

---

## 3. Spacing scale

A single rem-based scale. Layout gaps and padding map onto these steps —
components must not invent one-off spacing values.

| Token | Value | Approx px | Typical use |
| --- | --- | --- | --- |
| `--space-0` | `0` | 0 | Reset |
| `--space-1` | `0.25rem` | 4 | Tight inner padding, icon gaps, inline-code padding |
| `--space-2` | `0.5rem` | 8 | Compact gaps, control padding, list-item gap |
| `--space-3` | `0.75rem` | 12 | Small gaps, nav-link padding, pill padding |
| `--space-4` | `1rem` | 16 | Default block gap / padding, heading bottom margin |
| `--space-5` | `1.5rem` | 24 | Space between content blocks, card grid gap |
| `--space-6` | `2rem` | 32 | Section spacing, card padding |
| `--space-7` | `3rem` | 48 | Major layout regions, column gap |
| `--space-8` | `4rem` | 64 | Page top/bottom rhythm (footer top margin) |

How it maps in practice:

- Consecutive content blocks are separated by `--space-5` (`.block + .block`).
- Home cards are padded with `--space-6`; the card grid gap is `--space-5`.
- The wide-screen nav/body column gap is `--space-7`.
- Headings carry a `--space-4` bottom margin; paragraphs the same.

### Layout primitives

Non color/type/spacing constants that are still centralized.

**Border radius**

| Token | Value | Used for |
| --- | --- | --- |
| `--radius-sm` | `4px` | Controls, inline code, small blocks |
| `--radius-md` | `8px` | Cards, panels, code blocks, widgets |
| `--radius-lg` | `12px` | Hero / large surfaces |
| `--radius-pill` | `999px` | Pills, round slider thumbs/toggles |

**Border widths**

| Token | Value | Used for |
| --- | --- | --- |
| `--border-width` | `1px` | Default hairlines and borders |
| `--border-width-thick` | `3px` | Callout / active accent edges |

**SVG strokes** (unitless SVG user units, so they scale with the plot)

| Token | Value | Used for |
| --- | --- | --- |
| `--stroke-width-plot` | `2` | Simulation traces and spikes |
| `--stroke-width-plot-thick` | `3` | Emphasized cell outlines (predicted, highlight) |
| `--stroke-dash-plot` | `6 4` | Dashed reference lines such as a threshold |

**Elevation (shadows)**

| Token | Value | Used for |
| --- | --- | --- |
| `--shadow-sm` | `0 1px 2px rgba(15,23,38,0.06)` | Resting cards, widgets |
| `--shadow-md` | `0 2px 8px rgba(15,23,38,0.1)` | Card hover |
| `--shadow-lg` | `0 8px 24px rgba(15,23,38,0.12)` | Lookup panel (floating) |

**Layout widths**

| Token | Value | Used for |
| --- | --- | --- |
| `--layout-max-width` | `1120px` | Outer page container (`body`) |
| `--layout-content-width` | `var(--measure)` | Reading column alias |
| `--nav-width` | `16rem` | Side navigation column (wide screens) |
| `--card-min-width` | `15rem` | Home-card grid min track + control min width |

---

## 4. Page template and home-page layout

### Standard page template

Every view is composed of the same landmarks, in this order, inside a centered
`body` (max width `--layout-max-width`, horizontal padding `--space-5`):

```
body
├── header.site-header     site title, mission line, lookup hint
├── nav#nav.site-nav        topic tree + breadcrumb (renderer-filled)
│     └── ol.breadcrumb      ancestor chain of the resolved route
├── main#app.app            home page OR a resolved page (renderer-filled)
│     ├── .home              home-page view
│     │     └── .home-grid   responsive grid of .home-card topic cards
│     └── .page             a resolved topic page
│           ├── .page-title / .page-intro
│           └── .block …     ordered content blocks
└── footer.site-footer      shared footer
```

Flow (narrow / default): header → breadcrumb → nav → body → footer, stacked in a
single column.

**Wide screens (`min-width: 60rem`):** `body` becomes a CSS grid with a
`--nav-width` left column and a flexible main column, using named grid areas:

```
"header header"
"nav    main"
"footer footer"
```

The column gap is `--space-7`. The nav becomes sticky (`top: --space-5`,
scrollable up to `calc(100vh - --space-7)`) so it stays in view on long pages. The
breadcrumb is placed in the `main` grid area so it reads above the body content.

### Site header (`header.site-header`)

- Bottom border `--border-width` in `--color-border`; block padding `--space-7`
  top, `--space-5` bottom; `--space-6` bottom margin.
- `.site-title` — `--font-size-h1`, `--font-weight-bold`, `--color-heading`;
  hover shifts to `--color-accent`.
- `.site-mission` — muted (`--color-text-muted`), `--font-size-h4`, capped at
  `--measure`.
- `.lookup-hint` — a pill (`--radius-pill`) on `--color-surface-alt` with a
  border, `--font-size-small`, muted text ("highlight any term to see its
  meaning").

### Home page (`.home` / `.home-grid` / `.home-card`)

- `.home` is a vertical flex column with `--space-6` gaps.
- `.home-grid` is a responsive auto-fill grid:
  `repeat(auto-fill, minmax(var(--card-min-width), 1fr))`, gap `--space-5`. Cards
  reflow by viewport width with a minimum track of `--card-min-width` (15rem).
- `.home-card` — a `--color-surface` card with a `--color-border` border,
  `--radius-md`, `--space-6` padding, `--shadow-sm`. It is a flex column with
  `--space-2` gaps. On hover: accent border, `--shadow-md`, and a `-2px` lift
  (disabled under `prefers-reduced-motion`).
- `.home-card__title` — `--font-size-h3`, semibold, `--color-heading`.
- `.home-card__summary` — muted body text (shown only when a summary exists).
- `.home-card__children` — child subtopics listed beneath the card as a wrapping
  row of `.home-card__child` pills (`--color-accent-subtle` background,
  `--color-accent-hover` text, `--radius-pill`, `--font-size-small`).

### Resolved page (`.page`)

- `.page` is a vertical flex column.
- `.page-title` — `--font-size-h1`, `--space-3` bottom margin.
- `.page-intro` — optional lead paragraph: muted, `--font-size-h4`, body
  line-height, capped at `--measure`, `--space-6` bottom margin.
- Body is an ordered column of `.block` elements separated by `--space-5`.

---

## 5. Component appearance

Each content block the renderer emits carries the base class `.block` plus a type
modifier. The renderer applies these classes; pages never style themselves.

### Prose (`.block--prose`)

Capped at `--measure`. Inner `p` has no margin (block rhythm is handled by
`.block + .block`). Rendered via `textContent`, so embedded markup is shown as
text, not interpreted as HTML.

### Headings (`.block--heading`)

Capped at `--measure`. Uses the native heading element chosen by the block's
`level`, inheriting the shared heading type scale and `--color-heading`.

### Lists (`.block--list`)

Capped at `--measure`. `ul`/`ol` indented `--space-5`; list items spaced by
`--space-2`; markers tinted `--color-accent`.

### Inline code (`code`)

`--font-code-family`, `--font-size-code`, `--color-code-bg` background,
`--color-code-text` foreground, `--radius-sm`, small horizontal padding.

### Code blocks (`.block--code`)

Capped at `--measure-wide`. A `--color-code-bg` panel with a `--color-border`
border and `--radius-md`. A `.code-lang` label bar sits above the snippet
(`--color-surface-alt` background, bottom border, uppercase small muted mono
text) naming the language. The `pre` scrolls horizontally; code is non-executed
and preserves whitespace (`white-space: pre`).

### Callouts (`.block--callout`)

Capped at `--measure`. `--color-callout-bg` background with a `--border-width-thick`
left border in `--color-callout-border`, `--radius-sm`, padded `--space-4`/`--space-5`.

### Navigation (`nav#nav.site-nav`)

- `.nav-tree` is an unstyled nested list. Each nesting level indents `--space-4`
  with a `--color-border` left rule and `--space-3` left padding, so arbitrary
  depth reads as a clear hierarchy.
- `.nav-tree__link` — block link, `--space-2`/`--space-3` padding, `--radius-sm`.
  Hover: `--color-surface-alt` background. Active route (`aria-current="page"`):
  `--color-accent-subtle` fill, `--color-accent-hover` text, semibold, and a
  `--border-width-thick` accent left edge.
- Each node sits in a `.nav-tree__row` (flex). A node with subtopics leads with a
  `button.nav-tree__toggle` (`--space-6` square, no border, accent ▶ that turns
  to ▼ when `aria-expanded="true"`; hover `--color-surface-alt`). Subtopics start
  collapsed (`hidden`), so the nav opens on the top-level topics only; the active
  route's ancestors open on their own, and what the reader opens stays open across
  route changes. Leaf links indent by the toggle's width so titles line up.

### Breadcrumbs (`ol.breadcrumb`)

A wrapping flex row, `--space-2` gaps, `--font-size-small`, muted. Separators are
drawn with a `::before "/"` on each item after the first (`--color-border`), so
the renderer only emits the crumb items. `.breadcrumb__link` is an unadorned link
that underlines on hover; the current crumb (`aria-current="page"`) is plain text,
`--color-text`, medium weight.

### Lookup panel (`.lookup-panel`)

One reusable floating panel shown below the user's selection; positioned
absolutely by the lookup UI, styled here as a raised card: `--color-surface`,
`--color-border` border, `--radius-md`, `--shadow-lg`, `--space-4` padding,
`z-index: 100`. Width is capped at `min(var(--measure), 90vw)` so it never
overflows a small viewport. Parts:

- `.lookup-panel__term` — the canonical term, `--font-size-h4`, semibold.
- `.lookup-panel__acronym` — acronym shown alongside the term, muted, regular
  weight (e.g. "Spiking Neural Networks (SNN)").
- `.lookup-panel__definition` — the definition body text.
- `.lookup-panel__link` — link to the explaining page (shown when `pageRef` is
  non-null), `--space-3` top margin, small medium-weight.
- `.lookup-panel__fuzzy` — approximate-match indicator, muted small italic.
- `.lookup-panel--empty` — the "No definition found" state renders the definition
  text muted and italic, then auto-dismisses.

### Interactive widgets (`.block--widget` / `.widget`)

Capped at `--measure-wide`. A `--color-surface` card with border, `--radius-md`,
`--shadow-sm`, `--space-5` padding. A widget frames a title, a row of controls,
and a plot:

- `.widget__title` — `--font-size-h4`, `--color-heading`.
- `.widget__controls` — a wrapping flex row, `--space-4` gaps.
- `.widget__control` — a flex column (`--space-2` gap), min width
  `--card-min-width`, flexible. Holds a `.widget__control-label` (small, medium)
  and a control.

See §6 for control and plot standards.

### Non-fatal states

- `.block--error` — inline error naming the affected file (R15.1/15.5):
  `--color-error-bg` background, thick `--color-error` left border, error-colored
  text; links inside stay error-colored.
- `.block--placeholder` — unknown block type (R15.2): dashed `--color-border`
  border on `--color-surface-alt`, muted small mono text.
- `.widget-placeholder` — unregistered widget type (R10.3/15.3): capped at
  `--measure-wide`, dashed `--color-control-border` border, `--radius-md`, muted
  small mono text.

---

## 6. Interactive element standards

### Control sizing

- Selects and number inputs use `min-height: --control-height` (`2.25rem` /
  36px), padding `--space-2`/`--space-3`, `--color-control-bg` surface,
  `--color-control-border` border, `--radius-sm`, body font and size. Hover moves
  the border to `--color-accent`.
- Range sliders use `min-height: --control-min-target` (`44px`) to meet the
  accessible touch-target minimum. The track is `--space-2` tall
  (`--color-control-track`, pill radius); the thumb is `--space-4` square in
  `--color-control-thumb` with a `--color-surface` ring and pill radius, styled
  for both WebKit and Firefox.
- `--control-min-target` (44px) is the minimum interactive target. Keep any new
  clickable control at or above it.

### Focus states

One visible focus ring for every interactive element, keyboard-first.
`:focus-visible` draws an outline of `--focus-ring-width` (2px) in
`--focus-ring-color` (which resolves to `--color-control-focus`, `#2f6fed`) with
`--focus-ring-offset` (2px) and `--radius-sm`. A mouse click alone does not flash
the ring (`:focus:not(:focus-visible)` removes the default outline). Never remove
focus outlines without providing an equally visible replacement.

### Plot styling

- `.widget__plot` — `--color-plot-bg` background, `--color-border` border,
  `--radius-sm`. The canvas/SVG fills the width and scales height automatically.
- SVG structural parts use dedicated classes: `.plot-axis` (stroke
  `--color-plot-axis`), `.plot-grid` (stroke `--color-plot-grid`),
  `.plot-axis-label` (fill `--color-plot-axis`, body font, small).
- A `.widget__legend` row (small, muted) pairs `.widget__legend-item`s with
  `.widget__legend-swatch` color chips that reuse the series tokens so legend and
  plot stay in sync.

### Data-series color use

Each drawn series is tagged `.plot-series--N` for N in 1…6, mapping to
`--color-series-1` … `--color-series-6` (both `stroke` and `fill`). Assign series
in order starting at 1. The six-color categorical palette is the designed ceiling
for a single plot and is chosen for distinguishability on `--color-surface`.

### Out-of-range and error indication

When a control value falls outside its declared range (R10.6), the renderer adds
`.widget__control--invalid` to the control wrapper, turning the control border
`--color-error`, and shows a `.widget__control-error` message (error-colored,
small). The widget retains the last valid value and visualization.

### Simulation widgets (`alexandria.css` §10b)

The step/play simulation widgets (built on `src/widgets/sim-kit.js`) reuse the
widget card, controls, and `.widget__plot` host, and add:

- `.widget__actions` — wrapping row of buttons, `--space-3` gaps.
- `.widget__button` — `--control-min-target` tall, accent fill
  (`--color-accent`, hover `--color-accent-hover`) with `--color-text-inverse`
  text, `--radius-sm`. `.widget__button--secondary` is the outlined variant
  (`--color-control-bg`, `--color-control-border`). A toggle such as Play/Pause
  sets `aria-pressed="true"`, drawn with the `--color-accent-subtle` fill.
- `.widget__readout` — a polite live status line (small, muted, mono) for
  numbers and step narration.
- SVG parts inside `.widget__plot`: `.sim-label` (axis-colored small text),
  `.sim-trace` (unfilled `--stroke-width-plot` line; color from
  `.plot-series--N`), `.sim-spike`, `.sim-threshold` (`--stroke-dash-plot`
  dashed `--color-error` line).
- Cell states for grids of neurons/bits: `.sim-cell` (resting,
  `--color-surface-alt`), `--active` (series 1), `--predicted` (`--stroke-width-plot-thick` series-5
  outline on `--color-accent-subtle`), `--correct` (series 3), `--burst`
  (series 2), `--inhibitory` (series-2 outline), `--overlap` (series 4),
  `--highlight` (`--stroke-width-plot-thick` heading-colored outline).
- Bars: `.sim-bar` (series 1) and `.sim-bar--winner` (series 3).

Each state is also named in a legend or the readout, so color is never the
only signal.

### Accessible contrast

The palette is designed to meet WCAG AA for text: body `--color-text` (`#1a2230`)
on `--color-background` (`#f7f8fa`) and on `--color-surface` (`#ffffff`) both
exceed AA; link and accent colors (`--color-link` `#1d57cc`, `--color-accent`
`#2f6fed`) carry AA contrast on light surfaces. When adding a component, keep text
on its background at AA or better, do not rely on color alone to convey state
(pair it with a border, icon, or text, as the invalid-control and active-nav
styles do), and respect `prefers-reduced-motion` (the home-card hover transition
and smooth scroll both opt out under it).

### Screen-reader utility

`.visually-hidden` hides content visually while keeping it available to assistive
technology (skip targets, labels). Use it for accessible names that would be
redundant on screen.

---

## Extending the system

1. Add or reuse a token in `assets/css/tokens.css` — never hard-code a color,
   size, or spacing value in a component rule.
2. Add the component rule to `assets/css/alexandria.css`, referencing tokens by
   their role name.
3. Follow the established class patterns: `.block--<type>` for content blocks,
   BEM-style `.component__part` / `.component--modifier` for component internals.
4. Document any new token or component here so the next agent inherits it.

For how content, routing, and widgets are organized and extended, see
`PROJECT_GUIDE.md`.
