import { describe, expect, it } from "vitest";
import { classifyPageState } from "./page-state-classifier.js";

describe("classifyPageState", () => {
  it.each([
    [{ readyState: "complete", text: "Normal page", targetCount: 2 }, "ready"],
    [{ readyState: "loading", text: "" }, "loading"],
    [{ readyState: "complete", text: "Sign in to continue" }, "authentication_required"],
    [{ readyState: "complete", rawHtml: "<iframe src='https://captcha.test/hcaptcha'></iframe>" }, "human_verification"],
    [{ readyState: "complete", text: "Access is temporarily restricted" }, "access_restricted"],
    [{ readyState: "complete", httpStatus: 429 }, "access_restricted"],
    [{ readyState: "complete", httpStatus: 503 }, "error"],
  ] as const)("classifies stable signals as %s", (signals, expected) => {
    expect(classifyPageState(signals).kind).toBe(expected);
  });

  it("keeps an empty but visually populated HTTP page ambiguous", () => {
    const result = classifyPageState({
      url: "https://example.test/challenge",
      readyState: "complete",
      text: "",
      rawHtml: `<html><body><canvas>${"x".repeat(250)}</canvas></body></html>`,
      targetCount: 0,
    });
    expect(result).toMatchObject({
      kind: "unknown_interstitial",
      confidence: "medium",
      recommendedAction: "request_human",
    });
  });

  it("does not guess ordinary security copy is a challenge", () => {
    expect(classifyPageState({ readyState: "complete", text: "Manage security settings" }).kind).toBe("ready");
  });

  it("does not let latent CAPTCHA bundle text override a visible login wall", () => {
    expect(classifyPageState({
      url: "https://example.test/login",
      title: "Sign in to Example",
      text: "Username Password Sign in",
      rawHtml: "<script>const captchaTelemetry = true</script>",
      readyState: "complete",
    }).kind).toBe("authentication_required");
  });

  it("does not report a successful HTTP status as a restriction signal", () => {
    expect(classifyPageState({
      httpStatus: 200,
      text: "Access is temporarily restricted",
      readyState: "complete",
    }).signals).not.toContain("http_status:200");
  });

  it("does not treat a passive CAPTCHA widget on a rich page as an active challenge", () => {
    expect(classifyPageState({
      url: "https://jobs.example.test",
      text: "780 remote jobs Search by category",
      targetCount: 30,
      frameUrls: ["https://www.google.com/recaptcha/api2/anchor"],
      rawHtml: "<iframe src='https://www.google.com/recaptcha/api2/anchor'></iframe>",
      readyState: "complete",
    }).kind).toBe("ready");
  });

  it("does not treat CAPTCHA expertise in a rich job description as an active challenge", () => {
    expect(classifyPageState({
      url: "https://jobs.example.test/python-developer",
      title: "Python Developer",
      text: `${"Role responsibilities and qualifications. ".repeat(20)} Familiarity with proxy management, CAPTCHA handling, and IP rotation strategies.`,
      targetCount: 25,
      readyState: "complete",
    }).kind).toBe("ready");
  });

  it("recognizes an explicit visible CAPTCHA instruction on a content-rich page", () => {
    expect(classifyPageState({
      text: `${"Account information. ".repeat(30)} Complete the CAPTCHA to continue.`,
      targetCount: 20,
      readyState: "complete",
    }).kind).toBe("human_verification");
  });
});
