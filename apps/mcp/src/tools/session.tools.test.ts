import { describe, expect, it, vi } from "vitest";
import type { RuntimeClient } from "../runtime/runtime-client.types.js";
import { sessionTools } from "./session.tools.js";

describe("session.start MCP browser workspace contract", () => {
  it("uses the workspace selected in Rove when the caller does not choose one", async () => {
    const startSession = vi.fn().mockResolvedValue({});
    const runtime = { startSession } as unknown as RuntimeClient;
    const tool = sessionTools(runtime).find((candidate) => candidate.name === "session.start");
    if (tool === undefined) throw new Error("session.start tool missing");

    await tool.handler({ mode: "agent", startUrl: "https://example.com" });

    expect(startSession).toHaveBeenCalledWith({
      mode: "agent",
      startUrl: "https://example.com",
      browser: { mode: "workspace" },
    });
  });

  it("preserves an explicitly requested temporary browser identity", async () => {
    const startSession = vi.fn().mockResolvedValue({});
    const runtime = { startSession } as unknown as RuntimeClient;
    const tool = sessionTools(runtime).find((candidate) => candidate.name === "session.start");
    if (tool === undefined) throw new Error("session.start tool missing");

    await tool.handler({ mode: "agent", browser: { mode: "temporary" } });

    expect(startSession).toHaveBeenCalledWith({
      mode: "agent",
      browser: { mode: "temporary" },
    });
  });

  it("does not accept the removed task-supplied profile contract", async () => {
    const startSession = vi.fn().mockResolvedValue({});
    const runtime = { startSession } as unknown as RuntimeClient;
    const tool = sessionTools(runtime).find(
      (candidate) => candidate.name === "session.start",
    );
    if (tool === undefined) throw new Error("session.start tool missing");

    expect(() =>
      tool.handler({
        mode: "agent",
        profile: { mode: "persistent", name: "invented-clean-profile" },
      }),
    ).toThrowError();
    expect(startSession).not.toHaveBeenCalled();
  });
});
