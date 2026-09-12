import { describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import type { StartSessionRequest } from "@rove/protocol";

import {
  scopeRuntimeClient,
  taskRuntimeScopeFromEnvironment,
} from "./task-scoped-runtime-client.js";
import { controlTools } from "../tools/control.tools.js";

describe("task-scoped Runtime client", () => {
  function capability(key: Buffer) {
    const payload = Buffer.from(
      JSON.stringify({
        taskId: "task_a",
        sessionId: "ses_1",
        executionMode: "agent",
        browserIdentity: { mode: "temporary" },
        nonce: "n",
      }),
    ).toString("base64url");
    return `rtcap_${payload}.${createHmac("sha256", key).update(payload).digest("base64url")}`;
  }

  it("creates and fences the Runtime session only when browser capability is requested", async () => {
    const bootstrapId = `boot_${"b".repeat(32)}`;
    const startSession = vi.fn(async (input: StartSessionRequest) => ({
      id: "ses_lazy",
      bootstrapId: input.bootstrapId,
    }));
    const getSession = vi.fn(async (id: string) => ({ id, bootstrapId }));
    const scoped = scopeRuntimeClient({ startSession, getSession } as never, {
      taskId: "task_lazy",
      bootstrapId,
      capability: "rtcap_lazy",
      executionMode: "agent",
    });

    expect(startSession).not.toHaveBeenCalled();
    await expect(scoped.getSession("ses_lazy")).rejects.toThrow(/mismatch/);
    await expect(scoped.startSession({ mode: "agent" })).resolves.toMatchObject(
      {
        id: "ses_lazy",
        bootstrapId,
      },
    );
    expect(startSession).toHaveBeenCalledWith({ mode: "agent", bootstrapId });
    await expect(scoped.getSession("ses_lazy")).resolves.toMatchObject({
      id: "ses_lazy",
    });
    await expect(scoped.getSession("ses_other")).rejects.toThrow(/mismatch/);
  });

  it("does not let an unbound bootstrap capability select a browser", async () => {
    const bootstrapId = `boot_${"c".repeat(32)}`;
    const startSession = vi.fn(async () => ({
      id: "ses_unbound",
      bootstrapId,
    }));
    const runtime = scopeRuntimeClient({ startSession } as never, {
      taskId: "task_unbound",
      bootstrapId,
      capability: "rtcap_unbound",
      executionMode: "agent",
    });

    for (const browser of [
      {
        mode: "workspace" as const,
        workspaceId: "wrk_00000000-0000-4000-8000-000000000001",
      },
      {
        mode: "workspace" as const,
        workspaceId: "wrk_00000000-0000-4000-8000-000000000002",
      },
      { mode: "temporary" as const },
    ])
      await expect(
        runtime.startSession({ mode: "agent", browser }),
      ).rejects.toThrow(/context/);

    expect(startSession).not.toHaveBeenCalled();
    await expect(
      runtime.startSession({ mode: "agent" }),
    ).resolves.toMatchObject({ id: "ses_unbound", bootstrapId });
    expect(startSession).toHaveBeenCalledOnce();
    expect(startSession).toHaveBeenCalledWith({ mode: "agent", bootstrapId });
  });

  it("fails closed on incomplete scope and fences every session method", async () => {
    expect(() =>
      taskRuntimeScopeFromEnvironment({ ROVE_TASK_ID: "task_a" }),
    ).toThrow(/Incomplete/);
    const getSession = vi.fn(async (id: string) => ({ id }));
    const runtime = scopeRuntimeClient({ getSession } as never, {
      taskId: "task_a",
      sessionId: "ses_1",
      capability: "rtcap_x",
      executionMode: "agent",
      browserIdentity: { mode: "temporary" },
    });
    await expect(runtime.getSession("ses_1")).resolves.toEqual({ id: "ses_1" });
    await expect(runtime.getSession("ses_other")).rejects.toThrow(/mismatch/);
    await expect(
      runtime.startSession({ mode: "agent", browser: { mode: "temporary" } }),
    ).resolves.toEqual({ id: "ses_1" });
    await expect(
      runtime.startSession({ mode: "capture", browser: { mode: "temporary" } }),
    ).rejects.toThrow(/context/);
  });

  it("maps omitted and selected-workspace starts only to the already-bound session", async () => {
    const getSession = vi.fn(async (id: string) => ({ id }));
    const navigate = vi.fn(async () => ({ ok: true }));
    const startSession = vi.fn();
    const runtime = scopeRuntimeClient(
      { getSession, navigate, startSession } as never,
      {
        taskId: "task_workspace",
        sessionId: "ses_workspace",
        capability: "rtcap_x",
        executionMode: "agent",
        browserIdentity: {
          mode: "workspace",
          workspaceId: "wrk_00000000-0000-4000-8000-000000000001",
        },
      },
    );

    for (const browser of [
      undefined,
      { mode: "workspace" as const },
      {
        mode: "workspace" as const,
        workspaceId: "wrk_00000000-0000-4000-8000-000000000001",
      },
    ])
      await expect(
        runtime.startSession({
          mode: "agent",
          ...(browser === undefined ? {} : { browser }),
        }),
      ).resolves.toEqual({ id: "ses_workspace" });

    await expect(
      runtime.startSession({
        mode: "agent",
        browser: { mode: "workspace" },
        startUrl: "https://example.com/start",
      }),
    ).resolves.toEqual({ id: "ses_workspace" });
    expect(navigate).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith("ses_workspace", {
      url: "https://example.com/start",
    });
    expect(getSession).toHaveBeenCalledTimes(4);
    expect(startSession).not.toHaveBeenCalled();
  });

  it("rejects workspace mismatch, wrong mode, malformed identity, and creation selectors", async () => {
    const getSession = vi.fn(async (id: string) => ({ id }));
    const runtime = scopeRuntimeClient({ getSession } as never, {
      taskId: "task_workspace",
      sessionId: "ses_workspace",
      capability: "rtcap_x",
      executionMode: "agent",
      browserIdentity: {
        mode: "workspace",
        workspaceId: "wrk_00000000-0000-4000-8000-000000000001",
      },
    });
    const rejected: unknown[] = [
      {
        mode: "agent",
        browser: {
          mode: "workspace",
          workspaceId: "wrk_00000000-0000-4000-8000-000000000002",
        },
      },
      { mode: "agent", browser: { mode: "temporary" } },
      { mode: "companion", browser: { mode: "workspace" } },
      { mode: "agent", browser: { mode: "workspace", workspaceId: 7 } },
      { mode: "agent", browser: { mode: "workspace", extra: true } },
      { mode: "agent", bootstrapId: "boot_another" },
      { mode: "agent", sessionId: "ses_other" },
    ];
    for (const input of rejected)
      await expect(runtime.startSession(input as never)).rejects.toThrow(
        /context/,
      );
    expect(getSession).not.toHaveBeenCalled();
  });

  it("preserves temporary-bound symmetry without accepting workspace defaults", async () => {
    const getSession = vi.fn(async (id: string) => ({ id }));
    const runtime = scopeRuntimeClient({ getSession } as never, {
      taskId: "task_temporary",
      sessionId: "ses_temporary",
      capability: "rtcap_x",
      executionMode: "agent",
      browserIdentity: { mode: "temporary" },
    });
    await expect(
      runtime.startSession({ mode: "agent", browser: { mode: "temporary" } }),
    ).resolves.toEqual({ id: "ses_temporary" });
    for (const input of [
      { mode: "agent" },
      { mode: "agent", browser: { mode: "workspace" } },
    ])
      await expect(runtime.startSession(input as never)).rejects.toThrow(
        /context/,
      );
    expect(getSession).toHaveBeenCalledOnce();
  });

  it("rejects forged capabilities and binds signed claims to every scope field", () => {
    const key = Buffer.alloc(32, 9);
    const environment = {
      ROVE_TASK_ID: "task_a",
      ROVE_TASK_SESSION_ID: "ses_1",
      ROVE_TASK_CAPABILITY: capability(key),
      ROVE_TASK_CAPABILITY_VERIFIER: key.toString("base64url"),
      ROVE_TASK_EXECUTION_MODE: "agent",
      ROVE_TASK_BROWSER_IDENTITY: JSON.stringify({ mode: "temporary" }),
    };
    expect(taskRuntimeScopeFromEnvironment(environment)).toMatchObject({
      taskId: "task_a",
      sessionId: "ses_1",
    });
    expect(() =>
      taskRuntimeScopeFromEnvironment({
        ...environment,
        ROVE_TASK_CAPABILITY:
          "rtcap_forged-without-signature-validation.invalid",
      }),
    ).toThrow(/signature|encoding/);
    expect(() =>
      taskRuntimeScopeFromEnvironment({
        ...environment,
        ROVE_TASK_SESSION_ID: "ses_other",
      }),
    ).toThrow(/scope mismatch/);
  });

  it("carries the authoritative request-human result through the task-scoped tool handler", async () => {
    const result = {
      sessionId: "ses_1",
      generation: 8,
      status: "awaiting_human" as const,
      controller: null,
      activeHandoffId: "handoff_exact",
      observationSeq: 40,
      updatedAt: "2026-09-08T00:00:00Z",
      handoff: {
        reason: "Sign in",
        requestedAt: "2026-09-08T00:00:00Z",
      },
    };
    const requestHuman = vi.fn(async () => result);
    const scoped = scopeRuntimeClient({ requestHuman } as never, {
      taskId: "task_a",
      sessionId: "ses_1",
      capability: "rtcap_x",
      executionMode: "agent",
      browserIdentity: { mode: "temporary" },
    });
    const tool = controlTools(scoped).find(
      (entry) => entry.name === "control.request_human",
    )!;
    await expect(
      tool.handler({
        sessionId: "ses_1",
        reason: "Sign in",
        instruction: "Inspect the signed-in page and continue.",
        continuationPolicy: "resume_after_control_return",
      }),
    ).resolves.toEqual(result);
    expect(requestHuman).toHaveBeenCalledWith("ses_1", "Sign in");
    await expect(
      tool.handler({
        sessionId: "ses_other",
        reason: "Sign in",
        instruction: "Continue.",
        continuationPolicy: "resume_after_control_return",
      }),
    ).rejects.toThrow(/session mismatch/);
  });
});
