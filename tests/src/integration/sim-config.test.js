// tests/src/integration/sim-config.test.js
//
// Keeps the pages in step with the simulators. A `parameter-plot` widget whose
// `config.sim` is not a key of SIMS silently falls back to the generic sine
// curve, and a control whose `key` the simulator never reads moves nothing; both
// fail quietly in the browser, so they are checked here for every page under
// content/pages:
//
//   - every `config.sim` names a simulator in src/widgets/sims/index.js;
//   - every control key is read by that simulator. Reads are recorded through a
//     Proxy over the state, running the simulator at the defaults and once per
//     option of each select control (some keys are only read for one option).

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "../../harness.js";
import { SIMS } from "../../../src/widgets/sims/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const pagesDir = join(repoRoot, "content", "pages");

function jsonFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) jsonFiles(p, out);
    else if (name.endsWith(".json")) out.push(p);
  }
  return out;
}

/** Every widget spec with a `config.sim`, wherever it sits in a page. */
function simWidgets(value, out) {
  if (Array.isArray(value)) for (const v of value) simWidgets(v, out);
  else if (value && typeof value === "object") {
    if (value.type === "widget" && typeof value.widget?.config?.sim === "string") out.push(value.widget);
    for (const v of Object.values(value)) simWidgets(v, out);
  }
  return out;
}

const widgets = [];
for (const file of jsonFiles(pagesDir)) {
  const page = JSON.parse(readFileSync(file, "utf8"));
  for (const spec of simWidgets(page, [])) widgets.push({ file: relative(repoRoot, file), spec });
}

/** Keys the simulator reads from `state`, over the defaults and every select option. */
function keysRead(sim, spec) {
  const params = spec.params ?? [];
  const defaults = Object.fromEntries(params.map((p) => [p.key, p.default]));
  const states = [defaults];
  for (const p of params) {
    if (p.control !== "select") continue;
    for (const o of p.options ?? []) states.push({ ...defaults, [p.key]: typeof o === "object" ? o.value : o });
  }
  const read = new Set();
  for (const s of states) {
    const state = new Proxy(s, {
      get(target, key) {
        if (typeof key === "string") read.add(key);
        return target[key];
      },
    });
    sim(spec.config, state);
  }
  return read;
}

describe("content: parameter-plot simulators", () => {
  it("finds simulator widgets in the pages", () => {
    expect(widgets.length > 0).toBe(true);
  });

  it("every config.sim names a simulator in SIMS", () => {
    const unknown = widgets
      .filter(({ spec }) => !Object.hasOwn(SIMS, spec.config.sim))
      .map(({ file, spec }) => `${file}: ${spec.config.sim}`);
    expect(unknown).toEqual([]);
  });

  it("every control key is a parameter its simulator reads", () => {
    const unread = [];
    for (const { file, spec } of widgets) {
      const sim = SIMS[spec.config.sim];
      if (!sim) continue;
      const read = keysRead(sim, spec);
      for (const p of spec.params ?? []) {
        if (!read.has(p.key)) unread.push(`${file}: ${spec.config.sim} ignores "${p.key}"`);
      }
    }
    expect(unread).toEqual([]);
  });
});
