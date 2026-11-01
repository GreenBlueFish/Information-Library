// tests/dom.test.js
//
// tests/dom.js: the test DOM lets a <select>'s value be set, as browsers do.

import { describe, it, expect } from "./harness.js";
import { ensureDom } from "./dom.js";

describe("tests/dom", () => {
  it("setting a select's value selects the matching option, or none", async () => {
    const { document } = await ensureDom();
    const select = document.createElement("select");
    for (const v of ["a", "b", "c"]) {
      const option = document.createElement("option");
      option.value = v;
      select.appendChild(option);
    }
    select.value = "b";
    expect(select.value).toBe("b");
    select.value = "c";
    expect(select.value).toBe("c");
    expect(select.querySelectorAll("option[selected]").length).toBe(1);
    select.value = "z";
    expect(select.value).toBe(undefined);
  });
});
