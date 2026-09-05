import { describe, expect, it } from "vitest";

import { browserWindowStateSchema } from "./schemas.js";

describe("browserWindowStateSchema", () => {
  it("accepts live cross-platform Chromium window state", () => {
    expect(
      browserWindowStateSchema.parse({
        windowId: 123,
        pageId: "page_01",
        windowState: "normal",
        bounds: {
          left: 20,
          top: 40,
          width: 1200,
          height: 800,
        },
        documentFocused: true,
      }),
    ).toEqual({
      windowId: 123,
      pageId: "page_01",
      windowState: "normal",
      bounds: {
        left: 20,
        top: 40,
        width: 1200,
        height: 800,
      },
      documentFocused: true,
    });
  });

  it("rejects unusable identity, geometry, and state", () => {
    expect(() =>
      browserWindowStateSchema.parse({
        windowId: 0,
        pageId: "page_01",
        windowState: "normal",
        bounds: {
          left: 20,
          top: 40,
          width: 1200,
          height: 800,
        },
        documentFocused: true,
      }),
    ).toThrow();

    expect(() =>
      browserWindowStateSchema.parse({
        windowId: 123,
        pageId: "page_01",
        windowState: "normal",
        bounds: {
          left: 20,
          top: 40,
          width: 0,
          height: 800,
        },
        documentFocused: true,
      }),
    ).toThrow();

    expect(() =>
      browserWindowStateSchema.parse({
        windowId: 123,
        pageId: "page_01",
        windowState: "hidden",
        bounds: {
          left: 20,
          top: 40,
          width: 1200,
          height: 800,
        },
        documentFocused: true,
      }),
    ).toThrow();
  });
});
