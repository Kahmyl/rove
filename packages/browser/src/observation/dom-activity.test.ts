import {
  describe,
  expect,
  it,
} from "vitest";

import {
  normalizeDomActivityPayload,
} from "./dom-activity.js";

describe("DOM activity minimization", () => {
  it("drops arbitrary fields and raw values", () => {
    const secret =
      "DO_NOT_PERSIST_THIS_VALUE";

    const click =
      normalizeDomActivityPayload({
        type: "interaction_click",
        tag: "button",
        role: "button",
        label: "Submit",
        value: secret,
        password: secret,
      });

    expect(click).toEqual({
      type: "interaction_click",
      data: {
        tag: "button",
        role: "button",
        label: "Submit",
      },
    });

    expect(
      JSON.stringify(click),
    ).not.toContain(secret);

    const selection =
      normalizeDomActivityPayload({
        type: "selection_changed",
        tag: "select",
        label: "sort",
        selectedIndex: 1,
        value: secret,
      });

    expect(selection).toEqual({
      type: "selection_changed",
      data: {
        tag: "select",
        label: "sort",
        selectedIndex: 1,
      },
    });

    expect(
      JSON.stringify(selection),
    ).not.toContain(secret);
  });

  it("accepts only fixed scroll milestones", () => {
    expect(
      normalizeDomActivityPayload({
        type: "scroll_milestone",
        percent: 50,
      }),
    ).toEqual({
      type: "scroll_milestone",
      data: {
        percent: 50,
      },
    });

    expect(
      normalizeDomActivityPayload({
        type: "scroll_milestone",
        percent: 51,
      }),
    ).toBeNull();
  });
});
