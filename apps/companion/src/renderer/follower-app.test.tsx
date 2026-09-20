import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { CustomerBrowserCollaboration } from "../main/codex/customer-task-collaboration.js";
import type { ProductTaskProjection } from "../main/codex/local-product-api.js";
import type { DesktopSurfaceSnapshot } from "../shared/desktop-api.js";
import { FollowerApp } from "./follower-app.js";

function snapshot(
  browser: CustomerBrowserCollaboration,
  canStop = true,
): DesktopSurfaceSnapshot {
  const task = {
    taskId: "task_follower",
    executionMode: "agent",
    roveSessionId: "session_follower",
    capabilities: { canStop },
    customerCollaboration: {
      taskId: "task_follower",
      browser,
      needsCustomerAction: browser.state === "takeover_required",
    },
  } as ProductTaskProjection;
  return {
    revision: 1,
    surface: {
      presentation: "expanded",
      browserContext: "windowed",
      activeHost: "browser_follower",
      returnPresentation: "chip",
      revision: 1,
    },
    companion: {
      session: {
        id: "session_follower",
        mode: "agent",
        status: "active",
        controller: "agent",
      },
      observationCount: 0,
      evidenceCount: 0,
    },
    notice: null,
    workspaces: { workspaces: [] },
    product: {
      attention: [],
      tasks: [task],
    },
    productError: null,
  } as unknown as DesktopSurfaceSnapshot;
}

function render(browser: CustomerBrowserCollaboration, canStop = true): string {
  return renderToStaticMarkup(
    <FollowerApp
      desktop={snapshot(browser, canStop)}
      connectionError={null}
      refresh={async () => undefined}
    />,
  );
}

describe("FollowerApp collaboration presentation", () => {
  it("shows canonical requested Take Over and independent Stop", () => {
    const html = render({
      state: "takeover_required",
      title: "Waiting for you",
      description: "Complete sign in.",
      canTakeOver: true,
      canReturnToRove: false,
      handoffGeneration: 8,
    });

    expect(html).toContain(">Take Over</button>");
    expect(html).toContain(">Stop</button>");
  });

  it("shows Return to Rove only when canonical handback is allowed", () => {
    const allowed = render({
      state: "human_control",
      title: "You're in control",
      description: "Complete the browser step.",
      canTakeOver: false,
      canReturnToRove: true,
    });
    const denied = render({
      state: "human_control",
      title: "You're in control",
      description: "Rove cannot change the browser.",
      canTakeOver: false,
      canReturnToRove: false,
    });

    expect(allowed).toContain(">Return to Rove</button>");
    expect(denied).not.toContain(">Return to Rove</button>");
  });

  it("shows checking without takeover, return, or Agent working", () => {
    const html = render({
      state: "checking_after_return",
      title: "Checking the page…",
      description: "Rove is checking the page before continuing.",
      canTakeOver: false,
      canReturnToRove: false,
    });

    expect(html).toContain("Checking the page…");
    expect(html).not.toContain(">Take Over</button>");
    expect(html).not.toContain(">Return to Rove</button>");
    expect(html).not.toContain("Agent working");
  });

  it("hides Stop when the exact Task capability denies it", () => {
    const html = render(
      {
        state: "agent_control",
        title: "Rove controls the browser",
        description: "Rove is working.",
        canTakeOver: false,
        canReturnToRove: false,
      },
      false,
    );

    expect(html).not.toContain(">Stop</button>");
  });
});
