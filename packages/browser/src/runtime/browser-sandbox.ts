import type { BrowserContext } from "playwright";

export type BrowserSandboxStatus = "enabled" | "disabled" | "unknown";

export interface BrowserSandboxVerification {
  status: BrowserSandboxStatus;
  method: "chrome_sandbox_page";
  details: string;
}

export async function verifyChromiumSandbox(
  context: BrowserContext,
): Promise<BrowserSandboxVerification> {
  if (process.platform === "win32") {
    return {
      status: "unknown",
      method: "chrome_sandbox_page",
      details:
        "chrome://sandbox is not inspectable in this Windows Chromium runtime.",
    };
  }

  const page = await context.newPage();

  try {
    await page.goto("chrome://sandbox", {
      waitUntil: "domcontentloaded",
      timeout: 5_000,
    });
    const text = await page.locator("body").innerText({ timeout: 5_000 });
    return parseChromiumSandboxPage(text);
  } catch (error) {
    return {
      status: "unknown",
      method: "chrome_sandbox_page",
      details:
        error instanceof Error
          ? `Unable to inspect chrome://sandbox: ${error.message}`
          : "Unable to inspect chrome://sandbox.",
    };
  } finally {
    await page.close().catch(() => undefined);
  }
}

export function parseChromiumSandboxPage(
  text: string,
): BrowserSandboxVerification {
  const normalized = text.toLowerCase();

  if (
    normalized.includes("no sandbox") ||
    normalized.includes("not adequately sandboxed") ||
    normalized.includes("sandbox is not enabled") ||
    normalized.includes("sandbox disabled")
  ) {
    return {
      status: "disabled",
      method: "chrome_sandbox_page",
      details: "chrome://sandbox reported a disabled or inadequate sandbox.",
    };
  }

  if (
    normalized.includes("sandbox status") &&
    (normalized.includes("suid sandbox") ||
      normalized.includes("namespace sandbox") ||
      normalized.includes("win32k lockdown") ||
      normalized.includes("appcontainer"))
  ) {
    return {
      status: "enabled",
      method: "chrome_sandbox_page",
      details: "chrome://sandbox exposed sandbox status signals.",
    };
  }

  return {
    status: "unknown",
    method: "chrome_sandbox_page",
    details: "chrome://sandbox did not contain a recognized sandbox status signal.",
  };
}
