// src/math.js — formulas in content text, rendered as MathML.
//
// Content text may hold TeX-style formulas: `$...$` inline, `$$...$$` on a line
// of their own (display). This module parses a small, well-defined subset of
// TeX (subscripts, superscripts, \frac, \sqrt, Greek letters, common symbols
// and functions, \text, accents, big operators) and builds native MathML with
// `createElementNS`, so every browser draws real subscripts and stacked
// fractions with no library, no build step and no `innerHTML`. A literal dollar
// sign is written `\$`.
//
//   appendRichText(node, text)  append text with its formulas to `node`
//   parseTex(tex)               parse one formula; throws TexError on bad input
//   splitMath(text)             split text into text / math pieces
//
// Anything outside the subset throws a TexError from parseTex; appendRichText
// then shows the formula's source in a `.math-error` span rather than failing
// the page, and tests/content check that no page contains such a formula.

const MATHML_NS = "http://www.w3.org/1998/Math/MathML";

export class TexError extends Error {}

// ---------------------------------------------------------------------------
// Symbol tables
// ---------------------------------------------------------------------------

/** Greek letters and other identifiers (rendered as <mi>). */
const IDENT = {
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ϵ", varepsilon: "ε",
  zeta: "ζ", eta: "η", theta: "θ", vartheta: "ϑ", iota: "ι", kappa: "κ",
  lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", pi: "π", rho: "ρ", sigma: "σ",
  tau: "τ", upsilon: "υ", phi: "ϕ", varphi: "φ", chi: "χ", psi: "ψ", omega: "ω",
  Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ", Pi: "Π",
  Sigma: "Σ", Upsilon: "Υ", Phi: "Φ", Psi: "Ψ", Omega: "Ω",
  ell: "ℓ", hbar: "ℏ", infty: "∞", partial: "∂", nabla: "∇", emptyset: "∅",
  Re: "ℜ", Im: "ℑ",
};
/** Greek capitals are upright in TeX. */
const UPRIGHT_IDENT = new Set(["Gamma", "Delta", "Theta", "Lambda", "Xi", "Pi", "Sigma",
  "Upsilon", "Phi", "Psi", "Omega", "infty", "emptyset"]);

/** Operators and relations (rendered as <mo>). */
const OPS = {
  cdot: "·", times: "×", div: "÷", pm: "±", mp: "∓", ast: "∗", star: "⋆", circ: "∘",
  bullet: "∙", approx: "≈", sim: "∼", simeq: "≃", cong: "≅", equiv: "≡", propto: "∝",
  ne: "≠", neq: "≠", le: "≤", leq: "≤", ge: "≥", geq: "≥", ll: "≪", gg: "≫",
  lt: "<", gt: ">", in: "∈", notin: "∉", subset: "⊂", subseteq: "⊆", cup: "∪", cap: "∩",
  to: "→", rightarrow: "→", leftarrow: "←", Rightarrow: "⇒", Leftarrow: "⇐",
  leftrightarrow: "↔", Leftrightarrow: "⇔", mapsto: "↦", uparrow: "↑", downarrow: "↓",
  parallel: "∥", perp: "⊥", angle: "∠", deg: "°", prime: "′", ldots: "…", cdots: "⋯",
  dots: "…", vdots: "⋮", forall: "∀", exists: "∃", neg: "¬", wedge: "∧", vee: "∨",
  oplus: "⊕", otimes: "⊗", langle: "⟨", rangle: "⟩", lfloor: "⌊", rfloor: "⌋",
  lceil: "⌈", rceil: "⌉", vert: "|", Vert: "‖", lbrace: "{", rbrace: "}",
  "{": "{", "}": "}", "|": "‖", "%": "%", "#": "#", "&": "&", "_": "_", "$": "$",
};

/** Big operators: limits go under/over in display style. */
const BIG_OPS = { sum: "∑", prod: "∏", int: "∫", iint: "∬", oint: "∮", bigcup: "⋃", bigcap: "⋂" };

/** Upright function names (rendered as <mi mathvariant="normal">). */
const FUNCS = new Set(["sin", "cos", "tan", "sec", "csc", "cot", "sinh", "cosh", "tanh",
  "arcsin", "arccos", "arctan", "exp", "ln", "log", "lg", "max", "min", "sup", "inf",
  "lim", "det", "dim", "arg", "deg", "gcd", "Pr", "sgn"]);
/** Functions whose subscript sits underneath in display style. */
const LIMIT_FUNCS = new Set(["lim", "max", "min", "sup", "inf"]);

/** Accents: \hat{x} etc. become <mover accent="true">. */
const ACCENTS = { hat: "^", widehat: "^", bar: "¯", overline: "¯", tilde: "~", widetilde: "~",
  dot: "˙", ddot: "¨", vec: "→", check: "ˇ", breve: "˘" };

/** Spacing commands, in em. */
const SPACES = { ",": 0.1667, ":": 0.2222, ";": 0.2778, " ": 0.25, quad: 1, qquad: 2, "!": -0.1667 };

/** Font commands taking one argument. */
const FONTS = { mathrm: "normal", mathbf: "bold", mathit: "italic", mathcal: "script",
  mathbb: "double-struck", mathsf: "sans-serif", boldsymbol: "bold-italic", operatorname: "normal" };

/** Delimiters allowed after \left, \right and \big etc. */
const DELIMS = { "(": "(", ")": ")", "[": "[", "]": "]", "|": "|", ".": "",
  "\\{": "{", "\\}": "}", "\\langle": "⟨", "\\rangle": "⟩", "\\|": "‖", "\\vert": "|",
  "\\lfloor": "⌊", "\\rfloor": "⌋", "\\lceil": "⌈", "\\rceil": "⌉", "/": "/" };

const PLAIN_OPS = "+-=<>,;:!?()[]|/*'.";

// ---------------------------------------------------------------------------
// Parser: TeX string -> small tree of nodes
//   {t:"mi"|"mn"|"mo"|"mtext", v, variant?, stretchy?}
//   {t:"row", c:[...]}            {t:"frac", n, d}
//   {t:"sqrt", b, i?}             {t:"sup"|"sub"|"subsup", b, sub?, sup?, limits?}
//   {t:"accent", b, a}            {t:"space", w}
// ---------------------------------------------------------------------------

/**
 * Parse one TeX formula (no surrounding `$`) into a node tree.
 *
 * @param {string} tex
 * @returns {object} the root `row` node
 * @throws {TexError} on anything outside the supported subset
 */
export function parseTex(tex) {
  if (typeof tex !== "string") throw new TexError("formula is not a string");
  const p = { s: tex, i: 0 };
  const row = parseRow(p, null);
  if (p.i < p.s.length) throw new TexError(`unexpected "${p.s[p.i]}" at ${p.i}`);
  if (row.c.length === 0) throw new TexError("empty formula");
  return row;
}

function skipWs(p) {
  while (p.i < p.s.length && /\s/.test(p.s[p.i])) p.i++;
}

/** Parse atoms (with scripts) until `end` ("}" or "\\right") or end of input. */
function parseRow(p, end) {
  const c = [];
  for (;;) {
    skipWs(p);
    if (p.i >= p.s.length) {
      if (end) throw new TexError(`missing "${end === "}" ? "}" : "\\right"}"`);
      break;
    }
    if (end === "}" && p.s[p.i] === "}") break;
    if (end === "right" && p.s.startsWith("\\right", p.i)) break;
    if (p.s[p.i] === "}") throw new TexError(`unmatched "}" at ${p.i}`);
    if (p.s[p.i] === "^" || p.s[p.i] === "_") {
      // A script with nothing before it attaches to an empty base.
      c.push(parseScripts(p, { t: "row", c: [] }));
      continue;
    }
    const atom = parseAtom(p);
    if (atom === null) continue;
    c.push(parseScripts(p, atom));
  }
  return { t: "row", c };
}

/** After an atom, read any ^ and _ scripts. */
function parseScripts(p, base) {
  let sub = null;
  let sup = null;
  for (;;) {
    skipWs(p);
    const ch = p.s[p.i];
    if (ch === "^" || ch === "_") {
      p.i++;
      const arg = parseArg(p);
      if (ch === "^") {
        if (sup) throw new TexError("double superscript");
        sup = arg;
      } else {
        if (sub) throw new TexError("double subscript");
        sub = arg;
      }
    } else if (ch === "'" ) {
      // x' is x^{\prime}
      p.i++;
      if (sup) throw new TexError("double superscript");
      let primes = "′";
      while (p.s[p.i] === "'") { primes += "′"; p.i++; }
      sup = { t: "mo", v: primes };
    } else break;
  }
  if (!sub && !sup) return base;
  const limits = base.limits === true;
  if (sub && sup) return { t: "subsup", b: base, sub, sup, limits };
  if (sub) return { t: "sub", b: base, sub, limits };
  return { t: "sup", b: base, sup, limits };
}

/** One argument: a {group}, a single command, or a single character. */
function parseArg(p) {
  skipWs(p);
  if (p.i >= p.s.length) throw new TexError("missing argument");
  if (p.s[p.i] === "{") {
    p.i++;
    const row = parseRow(p, "}");
    p.i++;
    return row;
  }
  const ch = p.s[p.i];
  if (ch === "}" || ch === "^" || ch === "_") throw new TexError(`missing argument before "${ch}"`);
  if (/[0-9]/.test(ch)) { p.i++; return { t: "mn", v: ch }; }
  const atom = parseAtom(p);
  if (atom === null) throw new TexError("missing argument");
  return atom;
}

/** Read the text of a {group} literally (for \text). */
function readBraced(p) {
  skipWs(p);
  if (p.s[p.i] !== "{") throw new TexError("expected { after \\text");
  let depth = 0;
  const start = p.i + 1;
  for (; p.i < p.s.length; p.i++) {
    if (p.s[p.i] === "\\") { p.i++; continue; }
    if (p.s[p.i] === "{") depth++;
    else if (p.s[p.i] === "}" && --depth === 0) {
      const v = p.s.slice(start, p.i).replace(/\\([{}$%&#_ ])/g, "$1");
      p.i++;
      return v;
    }
  }
  throw new TexError('missing "}"');
}

function readDelim(p) {
  skipWs(p);
  for (const k of Object.keys(DELIMS).sort((a, b) => b.length - a.length)) {
    if (p.s.startsWith(k, p.i)) {
      // A command delimiter must not run on into letters (\langlex).
      if (k.startsWith("\\") && /[A-Za-z]/.test(k[k.length - 1]) && /[A-Za-z]/.test(p.s[p.i + k.length] ?? "")) continue;
      p.i += k.length;
      return DELIMS[k];
    }
  }
  throw new TexError(`bad delimiter at ${p.i}`);
}

/** Parse one atom, or return null for something that produces nothing. */
function parseAtom(p) {
  const s = p.s;
  const ch = s[p.i];

  if (ch === "{") {
    p.i++;
    const row = parseRow(p, "}");
    p.i++;
    return row;
  }
  if (/[0-9.]/.test(ch) && (ch !== "." || /[0-9]/.test(s[p.i + 1] ?? ""))) {
    const m = /^[0-9]*\.?[0-9]+|^[0-9]+/.exec(s.slice(p.i));
    p.i += m[0].length;
    return { t: "mn", v: m[0] };
  }
  if (/[A-Za-z]/.test(ch)) {
    p.i++;
    return { t: "mi", v: ch };
  }
  if (ch === "\\") return parseCommand(p);
  if (ch === "&" || ch === "#" || ch === "%" || ch === "$" || ch === "~") {
    if (ch === "~") { p.i++; return { t: "space", w: 0.25 }; }
    throw new TexError(`"${ch}" must be written \\${ch}`);
  }
  if (PLAIN_OPS.includes(ch)) {
    p.i++;
    if (ch === "-") return { t: "mo", v: "−" };
    if (ch === "*") return { t: "mo", v: "∗" };
    return { t: "mo", v: ch, stretchy: "()[]|/".includes(ch) ? false : undefined };
  }
  // Any other character (Unicode letters such as α, symbols such as ≈) passes
  // through: letters as identifiers, the rest as operators.
  const cp = String.fromCodePoint(s.codePointAt(p.i));
  p.i += cp.length;
  if (/\p{L}/u.test(cp)) return { t: "mi", v: cp };
  if (/\p{N}/u.test(cp)) return { t: "mn", v: cp };
  return { t: "mo", v: cp };
}

function parseCommand(p) {
  const s = p.s;
  p.i++; // the backslash
  if (p.i >= s.length) throw new TexError("lone backslash");
  let name;
  if (/[A-Za-z]/.test(s[p.i])) {
    const m = /^[A-Za-z]+/.exec(s.slice(p.i));
    name = m[0];
  } else {
    name = s[p.i];
  }
  p.i += name.length;

  if (name in SPACES) return { t: "space", w: SPACES[name] };
  if (name === "\\") throw new TexError("line breaks (\\\\) are not supported; use separate formulas");
  if (name in IDENT) return { t: "mi", v: IDENT[name], variant: UPRIGHT_IDENT.has(name) ? "normal" : undefined };
  if (name in OPS) return { t: "mo", v: OPS[name] };
  if (name in BIG_OPS) return { t: "mo", v: BIG_OPS[name], big: true, limits: name !== "int" && name !== "iint" && name !== "oint" };
  if (FUNCS.has(name)) return { t: "mi", v: name, variant: "normal", fn: true, limits: LIMIT_FUNCS.has(name) };

  switch (name) {
    case "frac": case "dfrac": case "tfrac": {
      const n = parseArg(p);
      const d = parseArg(p);
      return { t: "frac", n, d };
    }
    case "sqrt": {
      skipWs(p);
      let index = null;
      if (s[p.i] === "[") {
        const close = s.indexOf("]", p.i);
        if (close < 0) throw new TexError('missing "]" in \\sqrt');
        index = parseTex(s.slice(p.i + 1, close));
        p.i = close + 1;
      }
      return { t: "sqrt", b: parseArg(p), i: index };
    }
    case "text": case "textrm": case "mbox": case "textit": case "textbf":
      return { t: "mtext", v: readBraced(p), variant: name === "textit" ? "italic" : name === "textbf" ? "bold" : undefined };
    case "left": {
      const open = readDelim(p);
      const inner = parseRow(p, "right");
      p.i += "\\right".length;
      const close = readDelim(p);
      return { t: "fenced", open, close, b: inner };
    }
    case "right":
      throw new TexError("\\right without \\left");
    case "big": case "Big": case "bigg": case "Bigg": case "bigl": case "bigr": case "Bigl": case "Bigr": {
      const d = readDelim(p);
      return { t: "mo", v: d, size: { big: 1.2, bigl: 1.2, bigr: 1.2, Big: 1.6, Bigl: 1.6, Bigr: 1.6, bigg: 2.0, Bigg: 2.4 }[name] };
    }
    case "underbrace": case "overbrace": {
      const b = parseArg(p);
      return { t: "accent", b, a: name === "underbrace" ? "⏟" : "⏞", under: name === "underbrace" };
    }
    default:
      break;
  }
  if (name in ACCENTS) return { t: "accent", b: parseArg(p), a: ACCENTS[name] };
  if (name in FONTS) {
    const arg = parseArg(p);
    return { t: "font", b: arg, variant: FONTS[name], op: name === "operatorname" };
  }
  throw new TexError(`unknown command \\${name}`);
}

// ---------------------------------------------------------------------------
// Builder: node tree -> MathML elements
// ---------------------------------------------------------------------------

function mml(doc, tag, children, attrs) {
  const e = doc.createElementNS(MATHML_NS, tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) e.setAttribute(k, String(v));
  if (typeof children === "string") e.textContent = children;
  else if (children) for (const ch of children) e.appendChild(ch);
  return e;
}

/** Merge runs of upright letters (from \mathrm{GS}) into one <mi>. */
function build(doc, n, variant) {
  switch (n.t) {
    case "mi": {
      const v = n.variant ?? variant;
      // A single letter is italic by default in MathML; multi-letter names are
      // upright. Say "normal" only when it differs from that default.
      return mml(doc, "mi", n.v, { mathvariant: v === "normal" && [...n.v].length === 1 ? "normal" : v && v !== "normal" ? v : undefined });
    }
    case "mn": return mml(doc, "mn", n.v, variant && variant !== "normal" ? { mathvariant: variant } : undefined);
    case "mo": {
      const attrs = {};
      if (n.stretchy === false) attrs.stretchy = "false";
      if (n.big) attrs.largeop = "true";
      if (n.size) { attrs.minsize = `${n.size}em`; attrs.maxsize = `${n.size}em`; }
      if (n.big && n.limits) attrs.movablelimits = "true";
      return mml(doc, "mo", n.v, attrs);
    }
    case "mtext": return mml(doc, "mtext", n.v, n.variant ? { mathvariant: n.variant } : undefined);
    case "space": return mml(doc, "mspace", null, { width: `${n.w}em` });
    case "row": return buildRow(doc, n.c, variant);
    case "font": {
      if (n.op) {
        const text = flatText(n.b);
        if (text !== null) return mml(doc, "mi", text, [...text].length === 1 ? { mathvariant: "normal" } : undefined);
      }
      return build(doc, n.b, n.variant);
    }
    case "frac": return mml(doc, "mfrac", [build(doc, n.n, variant), build(doc, n.d, variant)]);
    case "sqrt":
      return n.i
        ? mml(doc, "mroot", [build(doc, n.b, variant), build(doc, n.i, variant)])
        : mml(doc, "msqrt", [build(doc, n.b, variant)]);
    case "accent":
      return n.under
        ? mml(doc, "munder", [build(doc, n.b, variant), mml(doc, "mo", n.a, { stretchy: "true" })], { accentunder: "true" })
        : mml(doc, "mover", [build(doc, n.b, variant), mml(doc, "mo", n.a, { stretchy: "true" })], { accent: "true" });
    case "fenced": {
      const kids = [];
      if (n.open) kids.push(mml(doc, "mo", n.open, { fence: "true", stretchy: "true" }));
      kids.push(build(doc, n.b, variant));
      if (n.close) kids.push(mml(doc, "mo", n.close, { fence: "true", stretchy: "true" }));
      return mml(doc, "mrow", kids);
    }
    case "sub": case "sup": case "subsup": {
      const base = build(doc, n.b, variant);
      // Limits go under/over only for display formulas; big operators carry
      // movablelimits, which MathML itself turns into scripts inline.
      const under = n.limits && (displayMode || n.b.big === true);
      const script = (x) => buildScript(doc, x, variant);
      if (n.t === "sub") return mml(doc, under ? "munder" : "msub", [base, script(n.sub)]);
      if (n.t === "sup") return mml(doc, under ? "mover" : "msup", [base, script(n.sup)]);
      return mml(doc, under ? "munderover" : "msubsup", [base, script(n.sub), script(n.sup)]);
    }
    default:
      throw new TexError(`internal: unknown node ${n.t}`);
  }
}

/** Set while building, so scripts know whether the formula is display. */
let displayMode = false;

/**
 * Build a sub- or superscript. A run of two or more plain letters in a script
 * is a label, not a product (V_{GS}, C_{ox}, r_{max}), so it is drawn upright
 * as one name, as engineering texts print it. A single letter stays italic.
 */
function buildScript(doc, n, variant) {
  if (variant === undefined && n.t === "row") return buildRow(doc, n.c, variant, true);
  return build(doc, n, variant);
}

/** The plain letters of a node, or null if it holds anything else. */
function flatText(n) {
  if (n.t === "mi" || n.t === "mn") return n.v;
  if (n.t === "row") {
    let out = "";
    for (const c of n.c) {
      const t = flatText(c);
      if (t === null) return null;
      out += t;
    }
    return out;
  }
  return null;
}

function buildRow(doc, nodes, variant, label = false) {
  const kids = [];
  const plain = (x) => x && x.t === "mi" && !x.variant && /^[A-Za-z]$/.test(x.v);
  for (let k = 0; k < nodes.length; k++) {
    const n = nodes[k];
    // Upright letter runs (\mathrm{GS}, or a font's letters) form one name;
    // so do runs of 2+ letters in a script label.
    if (plain(n) && (variant === "normal" || (label && plain(nodes[k + 1])))) {
      let v = n.v;
      while (plain(nodes[k + 1])) v += nodes[++k].v;
      kids.push(mml(doc, "mi", v, v.length === 1 ? { mathvariant: "normal" } : undefined));
      continue;
    }
    kids.push(build(doc, n, variant));
    // A function name followed by its argument gets an invisible apply.
    if (n.t === "mi" && n.fn && k + 1 < nodes.length) kids.push(mml(doc, "mo", "⁡"));
  }
  return kids.length === 1 ? kids[0] : mml(doc, "mrow", kids);
}

/**
 * Build a `<math>` element for one formula.
 *
 * @param {Document} doc
 * @param {string} tex
 * @param {boolean} display  true for a display (block) formula
 * @returns {Element}
 * @throws {TexError}
 */
export function texToMathML(doc, tex, display) {
  const tree = parseTex(tex);
  displayMode = Boolean(display);
  let body;
  try {
    body = build(doc, tree);
  } finally {
    displayMode = false;
  }
  const math = mml(doc, "math", [body], display ? { display: "block" } : undefined);
  math.setAttribute("class", display ? "math math--display" : "math");
  // The source, for copy-paste and screen readers that lack MathML support.
  math.setAttribute("alttext", tex);
  return math;
}

// ---------------------------------------------------------------------------
// Text with formulas
// ---------------------------------------------------------------------------

/**
 * Split text into pieces: `{text}` and `{tex, display}`. `\$` is a literal
 * dollar sign. An unclosed `$` is left as text.
 *
 * @param {string} text
 * @returns {Array<{text: string} | {tex: string, display: boolean}>}
 */
export function splitMath(text) {
  const out = [];
  let buf = "";
  let i = 0;
  const s = String(text);
  while (i < s.length) {
    const ch = s[i];
    if (ch === "\\" && s[i + 1] === "$") { buf += "$"; i += 2; continue; }
    if (ch === "$") {
      const display = s[i + 1] === "$";
      const open = display ? 2 : 1;
      const close = findClose(s, i + open, display);
      if (close < 0) { buf += s.slice(i); break; }
      if (buf) out.push({ text: buf });
      buf = "";
      out.push({ tex: s.slice(i + open, close).trim(), display });
      i = close + open;
      continue;
    }
    buf += ch;
    i++;
  }
  if (buf) out.push({ text: buf });
  return out;
}

function findClose(s, from, display) {
  for (let j = from; j < s.length; j++) {
    if (s[j] === "\\") { j++; continue; }
    if (s[j] === "$") {
      if (!display) return j;
      if (s[j + 1] === "$") return j;
    }
  }
  return -1;
}

/** True when text holds at least one formula. */
export function hasMath(text) {
  return typeof text === "string" && splitMath(text).some((p) => "tex" in p);
}

/**
 * Append `text` to `node`: plain parts as text nodes, formulas as MathML. A
 * formula that does not parse is shown as its source in a `.math-error` span.
 * Never parses HTML.
 *
 * @param {Element} node
 * @param {string} text
 * @returns {Element} node
 */
export function appendRichText(node, text) {
  const parts = splitMath(text);
  // Text with no formula is set exactly as before, as one text value.
  if (!parts.some((p) => "tex" in p)) {
    const plain = parts.map((p) => p.text).join("");
    if (!node.firstChild) node.textContent = plain;
    else node.appendChild(node.ownerDocument.createTextNode(plain));
    return node;
  }
  const doc = node.ownerDocument;
  for (const part of parts) {
    if ("text" in part) {
      node.appendChild(doc.createTextNode(part.text));
      continue;
    }
    try {
      node.appendChild(texToMathML(doc, part.tex, part.display));
    } catch (err) {
      if (!(err instanceof TexError)) throw err;
      const span = doc.createElement("span");
      span.className = "math-error";
      span.setAttribute("title", err.message);
      span.textContent = part.tex;
      node.appendChild(span);
    }
  }
  return node;
}

/**
 * The text a reader would see, with each formula's source in place of the
 * MathML (for search indexing and plain-text uses).
 *
 * @param {string} text
 * @returns {string}
 */
export function plainText(text) {
  return splitMath(text).map((p) => ("text" in p ? p.text : p.tex)).join("");
}
