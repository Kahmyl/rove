import { describe, expect, it } from "vitest";
import { detectAccessRestriction } from "./access-restriction.js";

describe("detectAccessRestriction", () => {
  it("recognizes an explicit temporary access restriction", () => {
    expect(
      detectAccessRestriction({
        title: "Wellfound",
        text: "Access is temporarily restricted. We detected unusual activity from your device or network.",
      }),
    ).toMatchObject({ kind: "access_restricted" });
  });

  it("recognizes restriction copy in raw HTML fallback content", () => {
    expect(
      detectAccessRestriction({
        title: "Error | Wellfound",
        text: "<main><h1>Access is temporarily restricted</h1></main>",
      }),
    ).toMatchObject({ kind: "access_restricted" });
  });

  it("recognizes a human verification page", () => {
    expect(detectAccessRestriction({ text: "Please verify you are human to continue." })).toMatchObject({
      kind: "human_verification",
    });
  });

  it("does not classify ordinary access-related copy", () => {
    expect(detectAccessRestriction({ text: "Manage team access and security settings." })).toBeUndefined();
  });
});
