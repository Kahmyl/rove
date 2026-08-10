import { describe, expect, it } from "vitest";
import { TOOL_CATALOG } from "./tool-catalog.js";

describe("TOOL_CATALOG", () => {
  it("exposes the locked M5/M6 tool names", () => {
    expect([...TOOL_CATALOG].sort()).toEqual(
      [
        "browser.back",
        "browser.click",
        "browser.forward",
        "browser.inspect",
        "browser.navigate",
        "browser.press",
        "browser.screenshot",
        "browser.scroll",
        "browser.type",
        "control.status",
        "evidence.list",
        "evidence.read",
        "evidence.save_record",
        "session.end",
        "session.observations",
        "session.start",
        "session.status",
      ].sort(),
    );
  });
});
