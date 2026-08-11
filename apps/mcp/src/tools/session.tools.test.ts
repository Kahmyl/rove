import { describe, expect, it, vi } from "vitest";
import type { RuntimeClient } from "../runtime/runtime-client.types.js";
import { sessionTools } from "./session.tools.js";

describe("session.start MCP defaults", () => {
  it("uses a managed persistent profile when the caller does not choose one", async () => {
    const startSession = vi.fn().mockResolvedValue({});
    const runtime = { startSession } as unknown as RuntimeClient;
    const tool = sessionTools(runtime).find((candidate) => candidate.name === "session.start");
    if (tool === undefined) throw new Error("session.start tool missing");

    await tool.handler({ mode: "agent", startUrl: "https://example.com" });

    expect(startSession).toHaveBeenCalledWith({
      mode: "agent",
      startUrl: "https://example.com",
      profile: { mode: "persistent", name: "default" },
    });
  });

  it("preserves an explicitly requested temporary profile", async () => {
    const startSession = vi.fn().mockResolvedValue({});
    const runtime = { startSession } as unknown as RuntimeClient;
    const tool = sessionTools(runtime).find((candidate) => candidate.name === "session.start");
    if (tool === undefined) throw new Error("session.start tool missing");

    await tool.handler({ mode: "agent", profile: { mode: "temporary" } });

    expect(startSession).toHaveBeenCalledWith({
      mode: "agent",
      profile: { mode: "temporary" },
    });
  });
});
