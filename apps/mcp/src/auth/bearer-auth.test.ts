import { describe, expect, it } from "vitest";
import { BearerTokenVerifier } from "./bearer-auth.js";

describe("BearerTokenVerifier", () => {
  const token = "a-strong-local-secret-token";
  const verifier = new BearerTokenVerifier(token);

  it.each([undefined, null, "", "Basic abc", "Bearer wrong", `Bearer ${"b".repeat(27)}`, `${token} Bearer`])("rejects %s", (header) => {
    expect(() => verifier.authenticate(header)).toThrow();
  });

  it("accepts the configured token", () => {
    expect(() => verifier.authenticate("Bearer a-strong-local-secret-token")).not.toThrow();
  });
});
