import { describe, expect, it } from "vitest";

import { browserHostIdentitySchema } from "./schemas.js";

describe("browserHostIdentitySchema", () => {
  it("accepts an exact positive owned-process identity", () => {
    expect(
      browserHostIdentitySchema.parse({
        kind: "owned_process",
        processId: 4321,
      }),
    ).toEqual({
      kind: "owned_process",
      processId: 4321,
    });
  });

  it("rejects non-positive process identifiers", () => {
    expect(() =>
      browserHostIdentitySchema.parse({
        kind: "owned_process",
        processId: 0,
      }),
    ).toThrow();
  });
});
