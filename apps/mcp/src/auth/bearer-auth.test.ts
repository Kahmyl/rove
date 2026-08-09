import { describe, expect, it } from "vitest";
import { BearerTokenVerifier } from "./bearer-auth.js";

describe("BearerTokenVerifier", () => {
  const verifier = new BearerTokenVerifier("a-strong-local-secret-token");

  it.each([undefined, null, "", "Basic abc", "Bearer wrong"])("rejects %s", (header) => {
    expect(() => verifier.authenticate(header)).toThrow();
  });

  it("accepts the configured token", () => {
    expect(() => verifier.authenticate("Bearer a-strong-local-secret-token")).not.toThrow();
  });
});
