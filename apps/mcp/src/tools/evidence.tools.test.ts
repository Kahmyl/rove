import { describe, expect, it, vi } from "vitest";

import type { RuntimeClient } from "../runtime/runtime-client.types.js";
import { evidenceTools } from "./evidence.tools.js";

describe("file artifact MCP tools", () => {
  it("creates an agent-supplied file artifact without a path parameter", async () => {
    const runtime = {
      createFileArtifact: vi.fn(async () => ({
        id: "ev_generated",
        type: "file",
      })),
    } as unknown as RuntimeClient;
    const tools = new Map(
      evidenceTools(runtime).map((tool) => [tool.name, tool]),
    );
    const tool = tools.get("evidence.create_file")!;

    expect(tool.inputSchema).not.toHaveProperty("properties.path");
    await tool.handler({
      sessionId: "ses_123",
      filename: "acceptance.txt",
      content: "Rove acceptance",
    });

    expect(runtime.createFileArtifact).toHaveBeenCalledWith("ses_123", {
      filename: "acceptance.txt",
      mimeType: "text/plain",
      encoding: "utf8",
      content: "Rove acceptance",
    });
  });

  it("forwards a human-visible file grant request and cancellation signal", async () => {
    const runtime = {
      requestLocalFileGrant: vi.fn(async () => ({
        status: "cancelled",
        evidence: [],
      })),
    } as unknown as RuntimeClient;
    const tool = evidenceTools(runtime).find(
      (candidate) => candidate.name === "evidence.request_file_grant",
    )!;
    const controller = new AbortController();

    await tool.handler(
      {
        sessionId: "ses_123",
        reason: "Select the report requested for upload",
      },
      controller.signal,
    );

    expect(runtime.requestLocalFileGrant).toHaveBeenCalledWith(
      "ses_123",
      {
        reason: "Select the report requested for upload",
        allowMultiple: false,
      },
      controller.signal,
    );
  });
});
