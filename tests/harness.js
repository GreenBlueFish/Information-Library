// tests/harness.js
//
// A tiny, dependency-free test harness that runs as native ES modules — no
// build step, no package manager, no test framework install. It mirrors the
// project's core constraint (plain static files, vanilla JS) so any agent
// session on any machine can run the dev-only tests with just Node:
//
//     node tests/run.js
//
// It exposes the small surface the specs need: `describe`/`it` to group and
// name cases, `expect(...)` with a handful of matchers, and `run()` which
// executes every registered case and reports a pass/fail summary (exiting
// non-zero on failure so CI or a human notices).

/** @typedef {{ name: string, fn: () => unknown }} TestCase */

/** @type {TestCase[]} */
const cases = [];
/** @type {string[]} */
const suiteStack = [];

/**
 * Group related tests under a label. Nesting is supported; labels are joined
 * with " › " so failures read as a path.
 * @param {string} label
 * @param {() => void} fn
 */
export function describe(label, fn) {
  suiteStack.push(label);
  try {
    fn();
  } finally {
    suiteStack.pop();
  }
}

/**
 * Register a single test case. The body may be sync or async; a thrown error
 * (or rejected promise) marks the case failed.
 * @param {string} name
 * @param {() => unknown} fn
 */
export function it(name, fn) {
  const full = [...suiteStack, name].join(" \u203A ");
  cases.push({ name: full, fn });
}

/**
 * Minimal assertion surface. Only the matchers the current tests need are
 * implemented; add more as tests require.
 * @param {unknown} actual
 */
export function expect(actual) {
  return {
    toBe(expected) {
      if (!Object.is(actual, expected)) {
        throw new AssertionError(`expected ${fmt(actual)} to be ${fmt(expected)}`);
      }
    },
    toEqual(expected) {
      if (!deepEqual(actual, expected)) {
        throw new AssertionError(`expected ${fmt(actual)} to deeply equal ${fmt(expected)}`);
      }
    },
    toBeTruthy() {
      if (!actual) throw new AssertionError(`expected ${fmt(actual)} to be truthy`);
    },
    toBeInstanceOf(ctor) {
      if (!(actual instanceof ctor)) {
        throw new AssertionError(`expected ${fmt(actual)} to be an instance of ${ctor.name}`);
      }
    },
    /** Assert the thunk `actual` throws, optionally matching a predicate/class. */
    async toThrow(matcher) {
      if (typeof actual !== "function") {
        throw new AssertionError("toThrow expects a function");
      }
      let threw = false;
      let error;
      try {
        await actual();
      } catch (e) {
        threw = true;
        error = e;
      }
      if (!threw) throw new AssertionError("expected function to throw, but it did not");
      if (matcher) assertMatch(error, matcher);
      return error;
    },
  };
}

/** Error type the harness recognizes as a clean assertion failure. */
export class AssertionError extends Error {
  constructor(message) {
    super(message);
    this.name = "AssertionError";
  }
}

/**
 * Run every registered case, printing a line per case and a final summary.
 * Returns the number of failures; `run.js` uses it for the process exit code.
 * @returns {Promise<number>}
 */
export async function run() {
  let passed = 0;
  const failures = [];
  for (const tc of cases) {
    try {
      await tc.fn();
      passed++;
      console.log(`  \u2713 ${tc.name}`);
    } catch (err) {
      failures.push({ name: tc.name, err });
      console.log(`  \u2717 ${tc.name}`);
    }
  }
  console.log("");
  if (failures.length) {
    console.log(`Failures (${failures.length}):`);
    for (const f of failures) {
      const msg = f.err instanceof Error ? f.err.stack ?? f.err.message : String(f.err);
      console.log(`\n  \u2717 ${f.name}\n    ${msg.split("\n").join("\n    ")}`);
    }
    console.log("");
  }
  console.log(`${passed} passed, ${failures.length} failed, ${cases.length} total`);
  return failures.length;
}

function assertMatch(error, matcher) {
  if (typeof matcher === "function") {
    // Treat as a constructor if it looks like one, else a predicate.
    const isClass = /^class\s/.test(Function.prototype.toString.call(matcher)) ||
      (matcher.prototype && matcher.prototype.constructor === matcher && matcher !== Object);
    if (isClass) {
      if (!(error instanceof matcher)) {
        throw new AssertionError(`expected thrown ${fmt(error)} to be instance of ${matcher.name}`);
      }
      return;
    }
    if (!matcher(error)) {
      throw new AssertionError(`thrown error did not satisfy matcher: ${fmt(error)}`);
    }
    return;
  }
  throw new AssertionError("unsupported toThrow matcher");
}

function deepEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  return ak.every((k) => deepEqual(a[k], b[k]));
}

function fmt(v) {
  if (typeof v === "string") return JSON.stringify(v);
  if (v instanceof Error) return `${v.name}(${JSON.stringify(v.message)})`;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
