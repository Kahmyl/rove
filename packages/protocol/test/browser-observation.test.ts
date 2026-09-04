import {
  describe,
  expect,
  it,
} from "vitest";

import {
  screenshotOptionsSchema,
} from "../src/index.js";

describe("browser screenshot protocol", () => {
  it("requires a target for target mode", () => {
    expect(() =>
      screenshotOptionsSchema.parse({
        mode: "target",
      }),
    ).toThrow();
  });

  it("requires a region for region mode", () => {
    expect(() =>
      screenshotOptionsSchema.parse({
        mode: "region",
      }),
    ).toThrow();

    expect(
      screenshotOptionsSchema.parse({
        mode: "region",
        observationId: "bobs_fixture",
        region: {
          x: 0,
          y: 0,
          width: 320,
          height: 200,
        },
      }),
    ).toMatchObject({
      mode: "region",
      observationId: "bobs_fixture",
    });
  });
});
