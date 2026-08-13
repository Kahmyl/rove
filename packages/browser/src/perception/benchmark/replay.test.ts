import { describe, expect, it } from "vitest";

import {
  assertReplayPersistable,
  assertReplayShape,
  parsePerceptionReplay,
  sanitizeExternalUrl,
  type PerceptionReplayV1,
} from "./replay.js";

const propositions = {
  primaryContentAvailable: true,
  documentUnstable: false,
  authenticationRequired: false,
  humanVerificationPresented: false,
  accessRestricted: false,
  errorPresented: false,
  interstitialPresented: false,
} as const;

function replay(
  tier: PerceptionReplayV1["source"]["tier"],
  evidence: Record<string, unknown>,
): PerceptionReplayV1 {
  return {
    schemaVersion: "f1-perception-replay/v1",
    source: {
      tier,
      kind: tier === "A" ? "synthetic" : tier === "B" ? "provider" : "recorded",
    },
    caseId: "replay-test",
    capturedAt: "2026-01-01T00:00:00.000Z",
    description: "Replay validation fixture.",
    criticality: "standard",
    tags: ["test"],
    expected: {
      propositions: { ...propositions },
      primaryState: "ready",
      disposition: "continue",
    },
    evidence,
  };
}

describe("F1 perception replay format", () => {
  it("allows controlled synthetic raw evidence in Tier A", () => {
    const value = replay("A", {
      rawHtml: "<html><body>Synthetic</body></html>",
      text: "Synthetic text",
    });

    expect(() => assertReplayPersistable(value)).not.toThrow();
    expect(parsePerceptionReplay(JSON.stringify(value)).caseId).toBe(
      "replay-test",
    );
  });

  it("rejects source tier/kind mismatches so recorded evidence cannot claim Tier A", () => {
    const value = replay("A", {});
    value.source.kind = "recorded";

    expect(() => assertReplayPersistable(value)).toThrow(
      /source A\/recorded is invalid/i,
    );
  });

  it("rejects malformed expected labels and incomplete proposition sets", () => {
    const invalidState = structuredClone(replay("C", {})) as unknown as {
      expected: { primaryState: string };
    };
    invalidState.expected.primaryState = "not-a-state";

    expect(() => assertReplayShape(invalidState)).toThrow(
      /primary state is invalid/i,
    );

    const missingProposition = structuredClone(replay("C", {})) as unknown as {
      expected: { propositions: Record<string, unknown> };
    };
    delete missingProposition.expected.propositions.errorPresented;

    expect(() => assertReplayShape(missingProposition)).toThrow(
      /propositions do not match/i,
    );
  });

  it.each([
    ["rawHtml", "<html>external</html>"],
    ["rawHtmlSnippet", "<div>external</div>"],
    ["text", "full external body"],
    ["textExcerpt", "unsanitized external excerpt"],
    ["authorization", "Bearer secret"],
    ["authorizationHeader", "Bearer secret"],
    ["cookie", "session=secret"],
    ["cookieHeader", "session=secret"],
    ["requestHeaders", { authorization: "secret" }],
    ["password", "secret"],
    ["passwordValue", "secret"],
    ["otp", "123456"],
    ["localStorage", { authToken: "secret" }],
  ])("rejects external persisted %s evidence", (key, value) => {
    expect(() =>
      assertReplayPersistable(
        replay("C", {
          [key]: value,
        }),
      ),
    ).toThrow(/cannot persist/i);
  });

  it("rejects unsanitized external URL arrays as well as scalar URLs", () => {
    expect(() =>
      assertReplayPersistable(
        replay("C", {
          frameUrls: ["https://example.test/frame?q=secret"],
        }),
      ),
    ).toThrow(/not sanitized/i);

    expect(() =>
      assertReplayPersistable(
        replay("C", {
          documentUrl:
            "https://user:pass@example.test/private?q=secret#fragment",
        }),
      ),
    ).toThrow(/not sanitized/i);
  });

  it("rejects local file and data URLs in external persisted evidence", () => {
    expect(() =>
      assertReplayPersistable(
        replay("C", {
          documentUrl: "file:///Users/example/private.html",
        }),
      ),
    ).toThrow(/unsupported protocol/i);

    expect(() =>
      assertReplayPersistable(
        replay("C", {
          documentUrl: "data:text/html,private",
        }),
      ),
    ).toThrow(/unsupported protocol/i);
  });

  it("sanitizes credentials, query, fragment, and path by default", () => {
    expect(
      sanitizeExternalUrl(
        "https://user:pass@example.test/private/user/42?q=secret#fragment",
      ),
    ).toBe("https://example.test/");
  });

  it("rejects non-HTTP URLs passed to the external URL sanitizer", () => {
    expect(() =>
      sanitizeExternalUrl("file:///Users/example/private.html"),
    ).toThrow(/only HTTP\(S\)/i);
  });

  it("accepts explicitly sanitized structural external evidence", () => {
    const value = replay("C", {
      documentUrl: "https://example.test/public-path-class",
      frameUrls: ["https://example.test/frame-class", "about:blank"],
      resourceType: "document",
      method: "GET",
      status: 200,
      origin: "https://example.test",
      sanitizedTextExcerpt: "Public heading",
    });

    expect(() => assertReplayPersistable(value)).not.toThrow();
  });
});
