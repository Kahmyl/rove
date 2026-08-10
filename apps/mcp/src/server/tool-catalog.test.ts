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
        "control.request_human",
        "control.wait",
        "evidence.list",
        "evidence.read",
        "evidence.save_record",
        "session.end",
        "session.observations",
        "session.start",
        "session.status",
      ].sort(),
    );
    expect(TOOL_CATALOG).not.toContain("control.take_human");
    expect(TOOL_CATALOG).not.toContain("control.return_agent");
    expect(TOOL_CATALOG).not.toContain("control.transfer");
    expect(TOOL_CATALOG).not.toContain("control.set");
  });
});
