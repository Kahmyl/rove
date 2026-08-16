import { describe, expect, it } from "vitest";

import {
  sanitizeEvidenceText,
  sanitizeEvidenceUrl,
} from "./browser-evidence.js";

describe("browser evidence sanitization", () => {
  it("drops credentials, query values, fragments, and secret assignments", () => {
    expect(
      sanitizeEvidenceUrl(
        "https://user:password@example.test/path?token=secret#private",
      ),
    ).toBe("https://example.test/path");

    const sanitized = sanitizeEvidenceText(
      "Authorization: Bearer abc.def cookie=session-value password=hunter2 at https://example.test/path?api_key=secret",
    );
    expect(sanitized).toContain("Authorization=[redacted]");
    expect(sanitized).toContain("cookie=[redacted]");
    expect(sanitized).toContain("password=[redacted]");
    expect(sanitized).toContain("https://example.test/path");
    expect(sanitized).not.toContain("abc.def");
    expect(sanitized).not.toContain("session-value");
    expect(sanitized).not.toContain("hunter2");
    expect(sanitized).not.toContain("api_key=secret");
  });

  it("bounds browser-controlled summaries", () => {
    expect(sanitizeEvidenceText("x".repeat(2_000))).toHaveLength(500);
  });
});
