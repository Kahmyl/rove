import {
  describe,
  expect,
  it,
} from "vitest";

import {
  redactAriaSnapshot,
} from "./aria-structure.js";

describe("redactAriaSnapshot", () => {
  it("removes live editable values and snapshot URLs", () => {
    const safe = redactAriaSnapshot(
      [
        '- region "Search"',
        '  - textbox "Query": private-query-value',
        '  - searchbox "Filter" [invalid]: private-filter-value',
        '  - link "Record":',
        '    - /url: https://example.test/private?token=secret',
      ].join("\n"),
    );

    expect(safe).toContain(
      'textbox "Query": [value omitted]',
    );

    expect(safe).toContain(
      'searchbox "Filter" [invalid]: [value omitted]',
    );

    expect(safe).toContain(
      "/url: [url omitted]",
    );

    expect(safe).not.toContain(
      "private-query-value",
    );

    expect(safe).not.toContain(
      "private-filter-value",
    );

    expect(safe).not.toContain(
      "token=secret",
    );
  });
});
