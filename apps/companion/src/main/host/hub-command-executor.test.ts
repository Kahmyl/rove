import { createHash } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { HubCommand, HubOperation } from "@rove/protocol";

import { executeHubCommand } from "./hub-command-executor.js";

const runtime = { baseUrl: "http://127.0.0.1:4500", token: "secret" };

function command(operation: HubOperation, payload: unknown): HubCommand {
  return {
    protocolVersion: 1,
    commandId: "command_1",
    deviceId: "device_1",
    operation,
    payload,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("semantic transaction hub routing", () => {
  it("routes begin, advance, verify, status, and cancel to the private Runtime API", async () => {
    const requests: Array<{ url: string; method: string; body?: unknown }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
        requests.push({
          url: String(input),
          method: String(init?.method),
          ...(init?.body === undefined
            ? {}
            : { body: JSON.parse(String(init.body)) as unknown }),
        });
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );

    const base = { sessionId: "session_1" };
    await executeHubCommand(
      command("browser.transaction_begin", {
        ...base,
        input: { observationId: "bobs_1", kind: "transfer" },
      }),
      runtime,
    );
    await executeHubCommand(
      command("browser.transaction_advance", {
        ...base,
        input: {
          transactionId: "tx_1",
          observationId: "bobs_2",
          phase: "commit",
        },
      }),
      runtime,
    );
    await executeHubCommand(
      command("browser.transaction_verify", {
        ...base,
        input: { transactionId: "tx_1", observationId: "bobs_3" },
      }),
      runtime,
    );
    await executeHubCommand(
      command("browser.transaction_status", {
        ...base,
        transactionId: "tx_1",
      }),
      runtime,
    );
    await executeHubCommand(
      command("browser.transaction_cancel", {
        ...base,
        transactionId: "tx_1",
      }),
      runtime,
    );

    expect(requests).toEqual([
      {
        url: "http://127.0.0.1:4500/sessions/session_1/browser/transactions",
        method: "POST",
        body: { observationId: "bobs_1", kind: "transfer" },
      },
      {
        url: "http://127.0.0.1:4500/sessions/session_1/browser/transactions/tx_1/advance",
        method: "POST",
        body: { observationId: "bobs_2", phase: "commit" },
      },
      {
        url: "http://127.0.0.1:4500/sessions/session_1/browser/transactions/tx_1/verify",
        method: "POST",
        body: { observationId: "bobs_3" },
      },
      {
        url: "http://127.0.0.1:4500/sessions/session_1/browser/transactions/tx_1",
        method: "GET",
      },
      {
        url: "http://127.0.0.1:4500/sessions/session_1/browser/transactions/tx_1/cancel",
        method: "POST",
      },
    ]);
  });
});

describe("file artifact hub routing", () => {
  it("materializes generated content as raw bytes in the local Runtime", async () => {
    let request: RequestInit | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: URL | RequestInfo, init?: RequestInit) => {
        request = init;
        return new Response(
          JSON.stringify({ id: "ev_generated", type: "file" }),
          { status: 201, headers: { "content-type": "application/json" } },
        );
      }),
    );

    const result = await executeHubCommand(
      command("evidence.create_file", {
        sessionId: "session_1",
        input: {
          filename: "acceptance.txt",
          content: "Rove acceptance",
        },
      }),
      runtime,
    );

    expect(result).toMatchObject({ id: "ev_generated", type: "file" });
    expect(Buffer.from(request!.body as Uint8Array).toString("utf8")).toBe(
      "Rove acceptance",
    );
    expect(new Headers(request!.headers).get("x-rove-file-source")).toBe(
      "agent_generated",
    );
  });

  it("materializes only Companion-selected file bytes under one opaque grant", async () => {
    const requests: RequestInit[] = [];
    const completeLocalFileGrant = vi.fn(async () => undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
        requests.push(init!);
        if (init?.method === "DELETE")
          return new Response(JSON.stringify({ deleted: 2 }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        const headers = new Headers(init?.headers);
        const bytes = new Uint8Array(init?.body as Uint8Array);
        const filename = Buffer.from(
          headers.get("x-rove-file-name")!,
          "base64url",
        ).toString("utf8");
        const grantId = headers.get("x-rove-grant-id")!;
        return new Response(
          JSON.stringify({
            id: `ev_${requests.length}`,
            sessionId: "session_1",
            type: "file",
            label: filename,
            createdAt: "2026-09-08T00:00:00.000Z",
            metadata: {
              filename,
              mimeType: headers.get("content-type"),
              sizeBytes: bytes.byteLength,
              sha256: createHash("sha256").update(bytes).digest("hex"),
              source: "user_file_grant",
              grantId,
            },
          }),
          { status: 201, headers: { "content-type": "application/json" } },
        );
      }),
    );

    const result = await executeHubCommand(
      command("evidence.request_file_grant", {
        sessionId: "session_1",
        input: { reason: "Select requested reports", allowMultiple: true },
      }),
      runtime,
      {
        requestLocalFileGrant: async () => [
          {
            filename: "one.txt",
            mimeType: "text/plain",
            bytes: new TextEncoder().encode("one"),
            attachmentId: `att_${"a".repeat(32)}`,
          },
          {
            filename: "two.txt",
            mimeType: "text/plain",
            bytes: new TextEncoder().encode("two"),
            attachmentId: `att_${"b".repeat(32)}`,
          },
        ],
        completeLocalFileGrant,
      },
    );

    expect(result).toMatchObject({
      status: "selected",
      evidence: [{ id: "ev_1" }, { id: "ev_2" }],
    });
    const grants = requests.map((request) =>
      new Headers(request.headers).get("x-rove-grant-id"),
    );
    expect(grants[0]).toMatch(/^grant_/u);
    expect(grants[1]).toBe(grants[0]);
    expect(completeLocalFileGrant).toHaveBeenCalledWith("session_1", [
      { attachmentId: `att_${"a".repeat(32)}`, evidenceId: "ev_1" },
      { attachmentId: `att_${"b".repeat(32)}`, evidenceId: "ev_2" },
    ]);
  });

  it("returns cancellation without creating an artifact", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(
      executeHubCommand(
        command("evidence.request_file_grant", {
          sessionId: "session_1",
          input: { reason: "Select a requested report" },
        }),
        runtime,
        { requestLocalFileGrant: async () => null },
      ),
    ).resolves.toEqual({ status: "cancelled", evidence: [] });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("compensates the whole grant when a later file upload fails", async () => {
    let uploads = 0;
    const cleanup = vi.fn();
    const failLocalFileGrant = vi.fn(async () => undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: URL | RequestInfo, init?: RequestInit) => {
        if (init?.method === "DELETE") {
          cleanup();
          return new Response(JSON.stringify({ deleted: 1 }), { status: 200 });
        }
        uploads += 1;
        if (uploads === 2)
          return new Response(JSON.stringify({ message: "failed" }), {
            status: 503,
          });
        const headers = new Headers(init?.headers);
        const bytes = new Uint8Array(init?.body as Uint8Array);
        const filename = Buffer.from(
          headers.get("x-rove-file-name")!,
          "base64url",
        ).toString("utf8");
        const grantId = headers.get("x-rove-grant-id")!;
        return new Response(
          JSON.stringify({
            id: "ev_first",
            sessionId: "session_1",
            type: "file",
            label: filename,
            metadata: {
              filename,
              mimeType: headers.get("content-type"),
              sizeBytes: bytes.byteLength,
              sha256: createHash("sha256").update(bytes).digest("hex"),
              source: "user_file_grant",
              grantId,
            },
          }),
          { status: 201 },
        );
      }),
    );
    const firstId = `att_${"a".repeat(32)}`;
    const secondId = `att_${"b".repeat(32)}`;
    const ids = [firstId, secondId];
    await expect(
      executeHubCommand(
        command("evidence.request_file_grant", {
          sessionId: "session_1",
          input: { reason: "Select two reports", allowMultiple: true },
        }),
        runtime,
        {
          requestLocalFileGrant: async () => [
            { ...textSelection("one.txt", "one"), attachmentId: firstId },
            { ...textSelection("two.txt", "two"), attachmentId: secondId },
          ],
          failLocalFileGrant,
        },
      ),
    ).rejects.toMatchObject({ retryable: true });
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(failLocalFileGrant).toHaveBeenCalledWith("session_1", ids);
  });

  it("marks durable reconciliation when partial-upload cleanup is uncertain", async () => {
    let uploads = 0;
    const attachmentId = `att_${"c".repeat(32)}`;
    const markLocalFileGrantReconciliation = vi.fn(async () => undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: URL | RequestInfo, init?: RequestInit) => {
        if (init?.method === "DELETE") throw new Error("cleanup uncertain");
        uploads += 1;
        if (uploads === 2)
          return new Response(JSON.stringify({ message: "failed" }), {
            status: 503,
          });
        const headers = new Headers(init?.headers);
        const bytes = new Uint8Array(init?.body as Uint8Array);
        const filename = Buffer.from(
          headers.get("x-rove-file-name")!,
          "base64url",
        ).toString("utf8");
        return new Response(
          JSON.stringify({
            id: "ev_partial",
            sessionId: "session_1",
            type: "file",
            label: filename,
            metadata: {
              filename,
              mimeType: "text/plain",
              sizeBytes: bytes.byteLength,
              sha256: createHash("sha256").update(bytes).digest("hex"),
              source: "user_file_grant",
              grantId: headers.get("x-rove-grant-id"),
            },
          }),
          { status: 201 },
        );
      }),
    );
    await expect(
      executeHubCommand(
        command("evidence.request_file_grant", {
          sessionId: "session_1",
          input: { reason: "Select two reports", allowMultiple: true },
        }),
        runtime,
        {
          requestLocalFileGrant: async () => [
            { ...textSelection("one.txt", "one"), attachmentId },
            {
              ...textSelection("two.txt", "two"),
              attachmentId: `att_${"d".repeat(32)}`,
            },
          ],
          markLocalFileGrantReconciliation,
        },
      ),
    ).rejects.toMatchObject({
      message: "File grant cleanup requires reconciliation.",
    });
    expect(markLocalFileGrantReconciliation).toHaveBeenCalledWith("session_1", [
      attachmentId,
      `att_${"d".repeat(32)}`,
    ]);
  });
});

function textSelection(filename: string, content: string) {
  return {
    filename,
    mimeType: "text/plain",
    bytes: new TextEncoder().encode(content),
  };
}
