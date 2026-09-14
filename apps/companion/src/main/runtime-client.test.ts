import { describe, expect, it, vi } from "vitest";

import type { Session } from "@rove/protocol";

import { CompanionRuntimeClient } from "./runtime-client.js";

const session: Session = {
  id: "ses_companion",
  mode: "companion",
  status: "active",
  controller: "agent",
  ownershipGeneration: 1,
  profile: {
    mode: "temporary",
  },
  createdAt: "2026-08-10T07:00:00.000Z",
  updatedAt: "2026-08-10T07:00:00.000Z",
};

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}

describe("CompanionRuntimeClient", () => {
  it("keeps an older pending takeover visible when a newer task session starts", async () => {
    const awaiting = {
      ...session,
      id: "ses_task_a",
      mode: "agent" as const,
      status: "awaiting_human" as const,
      controller: null,
      updatedAt: "2026-08-10T07:00:00.000Z",
    };
    const newer = {
      ...session,
      id: "ses_task_b",
      updatedAt: "2026-08-10T08:00:00.000Z",
    };
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("?mode=agent")) return jsonResponse([awaiting, newer]);
      if (url.endsWith("?mode=companion") || url.endsWith("?mode=capture"))
        return jsonResponse([]);
      throw new Error(`Unexpected request: ${url}`);
    }) as typeof fetch;
    const client = new CompanionRuntimeClient({
      baseUrl: "http://127.0.0.1:47820",
      fetchImpl,
    });

    await expect(client.getActiveSession()).resolves.toMatchObject({
      id: "ses_task_a",
      status: "awaiting_human",
    });
  });

  it("reads exact consequential effect truth without authorizing or dispatching", async () => {
    const effect = {
      effectId: "a".repeat(64),
      state: "applied" as const,
      consequenceKey: "task-result:result_1:digest",
      evidenceId: "ev_applied",
    };
    const fetchImpl = vi.fn(async () => jsonResponse(effect)) as typeof fetch;
    const client = new CompanionRuntimeClient({
      baseUrl: "http://127.0.0.1:47820",
      fetchImpl,
    });

    await expect(
      client.consequentialEffect("ses_companion", effect.consequenceKey),
    ).resolves.toEqual(effect);
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://127.0.0.1:47820/sessions/ses_companion/effects/consequential?consequenceKey=task-result%3Aresult_1%3Adigest",
      expect.objectContaining({ headers: expect.any(Headers) }),
    );
  });

  it("registers a task-result material digest on the exact Runtime session", async () => {
    const requests: Array<{ url: string; method: string; body: unknown }> = [];
    const fetchImpl = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        requests.push({
          url: String(input),
          method: init?.method ?? "GET",
          body:
            typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
        });
        return jsonResponse({ state: "prepared" });
      },
    ) as typeof fetch;
    const client = new CompanionRuntimeClient({
      baseUrl: "http://127.0.0.1:47820",
      fetchImpl,
    });
    const digest = "d".repeat(64);
    const consequenceKey = `task-result:result_1:${digest}`;
    const planId = `plan_${"a".repeat(32)}`;

    await client.authorizeTaskResultAction(
      "ses_companion",
      consequenceKey,
      digest,
      planId,
    );
    expect(requests).toEqual([
      {
        url: "http://127.0.0.1:47820/sessions/ses_companion/effects/authorize-task-result",
        method: "POST",
        body: { consequenceKey, materialDigest: digest, planId },
      },
    ]);
  });

  it("uses a distinct trusted Runtime route for an explicit effect repetition", async () => {
    const requests: Array<{ url: string; method: string; body: unknown }> = [];
    const fetchImpl = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        requests.push({
          url: String(input),
          method: init?.method ?? "GET",
          body:
            typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
        });
        return jsonResponse({
          effectId: "a".repeat(64),
          authorizationId: "effect_repeat_12345678-1234-4123-8123-123456789abc",
          authorizedAt: "2026-09-10T12:00:00.000Z",
        });
      },
    ) as typeof fetch;
    const client = new CompanionRuntimeClient({
      baseUrl: "http://127.0.0.1:47820",
      fetchImpl,
    });

    await expect(
      client.authorizeEffectRepetition(
        "ses_companion",
        "a".repeat(64),
        "effect_repeat_12345678-1234-4123-8123-123456789abc",
      ),
    ).resolves.toMatchObject({ effectId: "a".repeat(64) });
    expect(requests).toEqual([
      {
        url: "http://127.0.0.1:47820/sessions/ses_companion/effects/authorize-repeat",
        method: "POST",
        body: {
          effectId: "a".repeat(64),
          authorizationId: "effect_repeat_12345678-1234-4123-8123-123456789abc",
        },
      },
    ]);
  });

  it("reads persisted inventory and requests exact-session recovery", async () => {
    const inventory = {
      schemaVersion: 1 as const,
      session,
      browserIdentity: { mode: "temporary" as const },
      attachment: "missing" as const,
      recovery: "unrecoverable" as const,
      profileOwnership: "released" as const,
    };
    const requests: Array<{ url: string; method: string }> = [];
    const fetchImpl = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const request = { url: String(input), method: init?.method ?? "GET" };
        requests.push(request);
        if (request.url.endsWith("/sessions/inventory"))
          return jsonResponse([inventory]);
        if (request.url.endsWith("/sessions/ses_companion/recover"))
          return jsonResponse(inventory);
        throw new Error(`Unexpected request: ${request.url}`);
      },
    ) as typeof fetch;
    const client = new CompanionRuntimeClient({
      baseUrl: "http://127.0.0.1:47820",
      fetchImpl,
    });

    await expect(client.listSessionInventory()).resolves.toEqual([inventory]);
    await expect(client.recoverSession("ses_companion")).resolves.toEqual(
      inventory,
    );
    expect(requests).toEqual([
      {
        url: "http://127.0.0.1:47820/sessions/inventory",
        method: "GET",
      },
      {
        url: "http://127.0.0.1:47820/sessions/ses_companion/recover",
        method: "POST",
      },
    ]);
  });

  it("lists, creates, and explicitly selects browser workspaces", async () => {
    const requests: Array<{ url: string; method: string; body?: unknown }> = [];
    const first = {
      id: "wrk_00000000-0000-0000-0000-000000000001",
      displayName: "Default",
      browser: "chrome",
      userDataDir: "/managed/default",
      storageLayout: "workspace",
      createdAt: "2026-09-01T00:00:00.000Z",
      lastUsedAt: "2026-09-01T00:00:00.000Z",
    } as const;
    const second = {
      ...first,
      id: "wrk_00000000-0000-0000-0000-000000000002",
      displayName: "Work",
    };
    const fetchImpl = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        requests.push({
          url,
          method,
          ...(typeof init?.body === "string"
            ? { body: JSON.parse(init.body) as unknown }
            : {}),
        });
        if (url.endsWith("/browser-workspaces") && method === "GET") {
          return jsonResponse({
            selectedWorkspaceId: first.id,
            workspaces: [first],
          });
        }
        if (url.endsWith("/browser-workspaces") && method === "POST") {
          return jsonResponse(second, 201);
        }
        if (url.endsWith(`/${second.id}/select`)) {
          return jsonResponse({
            selectedWorkspaceId: second.id,
            workspaces: [first, second],
          });
        }
        if (url.endsWith(`/${second.id}`) && method === "PATCH") {
          return jsonResponse({
            selectedWorkspaceId: second.id,
            workspaces: [first, { ...second, displayName: "Client" }],
          });
        }
        if (url.endsWith(`/${second.id}`) && method === "DELETE") {
          return jsonResponse({
            selectedWorkspaceId: first.id,
            workspaces: [first],
          });
        }
        throw new Error(`Unexpected request: ${url}`);
      },
    ) as typeof fetch;
    const client = new CompanionRuntimeClient({
      baseUrl: "http://127.0.0.1:47820",
      fetchImpl,
    });

    await expect(client.getBrowserWorkspaceStatus()).resolves.toMatchObject({
      selectedWorkspaceId: first.id,
    });
    await expect(client.createBrowserWorkspace("Work")).resolves.toMatchObject(
      second,
    );
    await expect(
      client.selectBrowserWorkspace(second.id),
    ).resolves.toMatchObject({
      selectedWorkspaceId: second.id,
    });
    await expect(
      client.renameBrowserWorkspace(second.id, "Client"),
    ).resolves.toMatchObject({ selectedWorkspaceId: second.id });
    await expect(
      client.deleteBrowserWorkspace(second.id),
    ).resolves.toMatchObject({ selectedWorkspaceId: first.id });
    expect(requests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: "POST",
          body: { displayName: "Work" },
        }),
        expect.objectContaining({
          method: "POST",
          url: expect.stringContaining("/select"),
        }),
        expect.objectContaining({
          method: "PATCH",
          body: { displayName: "Client" },
        }),
        expect.objectContaining({ method: "DELETE" }),
      ]),
    );
  });

  it("discovers Companion Mode and returns live counts", async () => {
    const fetchImpl = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);

        const authorization = new Headers(init?.headers).get("authorization");

        expect(authorization).toBe("Bearer runtime-secret-123456789012");

        if (url.endsWith("/sessions?mode=agent")) {
          return jsonResponse([]);
        }

        if (url.endsWith("/sessions?mode=companion")) {
          return jsonResponse([session]);
        }

        if (url.endsWith("/sessions?mode=capture")) {
          return jsonResponse([]);
        }

        if (url.includes("/observations?")) {
          return jsonResponse({
            items: [
              {
                id: "obs_1",
                seq: 1,
                timestamp: "2026-08-10T07:00:01.000Z",
                actor: "system",
                type: "session_started",
                data: {},
              },
              {
                id: "obs_2",
                seq: 2,
                timestamp: "2026-08-10T07:00:02.000Z",
                actor: "agent",
                type: "agent_clicked",
                data: {},
              },
            ],
            nextSeq: 2,
          });
        }

        if (url.endsWith("/evidence")) {
          return jsonResponse([
            {
              id: "ev_1",
            },
          ]);
        }

        throw new Error(`Unexpected request: ${url}`);
      },
    ) as typeof fetch;

    const client = new CompanionRuntimeClient({
      baseUrl: "http://127.0.0.1:47820/",
      token: "runtime-secret-123456789012",
      fetchImpl,
    });

    await expect(client.getSnapshot()).resolves.toMatchObject({
      session: {
        id: "ses_companion",
        mode: "companion",
      },
      observationCount: 2,
      evidenceCount: 1,
    });
  });

  it("discovers an active Capture Mode session", async () => {
    const capture: Session = {
      ...session,
      id: "ses_capture",
      mode: "capture",
      controller: "human",
      createdAt: "2026-08-10T08:00:00.000Z",
      updatedAt: "2026-08-10T08:00:00.000Z",
    };

    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);

      if (url.endsWith("/sessions?mode=agent")) {
        return jsonResponse([]);
      }

      if (url.endsWith("/sessions?mode=companion")) {
        return jsonResponse([session]);
      }

      if (url.endsWith("/sessions?mode=capture")) {
        return jsonResponse([capture]);
      }

      if (url.includes("/observations?")) {
        return jsonResponse({
          items: [],
        });
      }

      if (url.endsWith("/evidence")) {
        return jsonResponse([]);
      }

      throw new Error(`Unexpected request: ${url}`);
    }) as typeof fetch;

    const client = new CompanionRuntimeClient({
      baseUrl: "http://127.0.0.1:47820",
      fetchImpl,
    });

    await expect(client.getSnapshot()).resolves.toMatchObject({
      session: {
        id: "ses_capture",
        mode: "capture",
        controller: "human",
      },
    });
  });

  it("discovers an Agent Mode session that is waiting for human help", async () => {
    const agent: Session = {
      ...session,
      id: "ses_agent",
      mode: "agent",
      status: "awaiting_human",
      controller: null,
      handoff: {
        reason: "Sign in to your account, then return to Rove.",
        requestedAt: "2026-08-10T08:30:00.000Z",
      },
      createdAt: "2026-08-10T08:30:00.000Z",
      updatedAt: "2026-08-10T08:30:00.000Z",
    };

    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);

      if (url.endsWith("/sessions?mode=agent")) {
        return jsonResponse([agent]);
      }

      if (
        url.endsWith("/sessions?mode=companion") ||
        url.endsWith("/sessions?mode=capture")
      ) {
        return jsonResponse([]);
      }

      if (url.includes("/observations?")) {
        return jsonResponse({
          items: [],
        });
      }

      if (url.endsWith("/evidence")) {
        return jsonResponse([]);
      }

      throw new Error(`Unexpected request: ${url}`);
    }) as typeof fetch;

    const client = new CompanionRuntimeClient({
      baseUrl: "http://127.0.0.1:47820",
      fetchImpl,
    });

    await expect(client.getSnapshot()).resolves.toMatchObject({
      session: {
        id: "ses_agent",
        mode: "agent",
        status: "awaiting_human",
        controller: null,
      },
    });
  });

  it("uses exact-session Runtime control and finish endpoints", async () => {
    const requests: {
      url: string;
      method: string;
    }[] = [];

    let ended = false;

    const fetchImpl = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";

        requests.push({
          url,
          method,
        });

        if (url.endsWith("/sessions?mode=agent")) {
          return jsonResponse([]);
        }

        if (url.endsWith("/sessions?mode=companion")) {
          return jsonResponse(ended ? [] : [session]);
        }

        if (url.endsWith("/sessions?mode=capture")) {
          return jsonResponse([]);
        }

        if (
          url.endsWith("/control/take") ||
          url.endsWith("/control/pause") ||
          url.endsWith("/control/return")
        ) {
          return jsonResponse({
            sessionId: session.id,
            status: "active",
            controller: "human",
            updatedAt: session.updatedAt,
          });
        }

        if (url.endsWith(`/sessions/${session.id}`)) {
          return jsonResponse(session);
        }

        if (url.endsWith(`/sessions/${session.id}/browser/window`)) {
          return jsonResponse(null);
        }

        if (url.endsWith("/end")) {
          ended = true;
          return jsonResponse({
            ...session,
            status: "completed",
            controller: null,
          });
        }

        if (url.includes("/observations?")) {
          return jsonResponse({
            items: [],
          });
        }

        if (url.endsWith("/evidence")) {
          return jsonResponse([]);
        }

        throw new Error(`Unexpected request: ${url}`);
      },
    ) as typeof fetch;

    const client = new CompanionRuntimeClient({
      baseUrl: "http://127.0.0.1:47820",
      fetchImpl,
    });

    const authority = { ownershipGeneration: 1 };
    await client.takeControlForSession(session.id, authority);
    await client.pauseSessionForSession(session.id, authority);
    await client.returnControlForSession(session.id, authority);
    await client.endSession(session.id);

    expect(requests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          url: expect.stringContaining("/control/pause"),
          method: "POST",
        }),
        expect.objectContaining({
          url: expect.stringContaining("/control/take"),
          method: "POST",
        }),
        expect.objectContaining({
          url: expect.stringContaining("/control/return"),
          method: "POST",
        }),
        expect.objectContaining({
          url: expect.stringContaining("/end"),
          method: "POST",
        }),
      ]),
    );
  });

  it("returns control only for the supplied exact session identity", async () => {
    const requests: string[] = [];
    const fetchImpl = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        requests.push(`${init?.method ?? "GET"} ${url}`);
        if (url.endsWith("/sessions/ses_companion/control/return"))
          return jsonResponse({
            sessionId: "ses_companion",
            status: "active",
            controller: "agent",
            generation: 3,
            updatedAt: session.updatedAt,
          });
        if (url.endsWith("/sessions/ses_companion"))
          return jsonResponse(session);
        if (url.includes("/observations?")) return jsonResponse({ items: [] });
        if (url.endsWith("/evidence")) return jsonResponse([]);
        throw new Error(`Unexpected request: ${url}`);
      },
    ) as typeof fetch;
    const client = new CompanionRuntimeClient({
      baseUrl: "http://127.0.0.1:47820",
      fetchImpl,
    });
    await expect(
      client.returnControlForSession("ses_companion", {
        ownershipGeneration: 3,
      }),
    ).resolves.toMatchObject({ session: { id: "ses_companion" } });
    expect(requests.some((entry) => entry.includes("sessions?mode="))).toBe(
      false,
    );

    const mismatched = new CompanionRuntimeClient({
      baseUrl: "http://127.0.0.1:47820",
      fetchImpl: vi.fn(async () =>
        jsonResponse({
          sessionId: "ses_wrong",
          status: "active",
          controller: "agent",
          generation: 3,
          updatedAt: session.updatedAt,
        }),
      ) as typeof fetch,
    });
    await expect(
      mismatched.returnControlForSession("ses_companion", {
        ownershipGeneration: 3,
      }),
    ).rejects.toThrow(/mismatched control session/);
  });

  it("materializes user bytes with opaque task, grant, and session bindings", async () => {
    let captured: [string | URL | Request, RequestInit | undefined] | undefined;
    const fetchImpl = vi.fn(async (input, init) => {
      captured = [input, init];
      return jsonResponse({
        id: "ev_file",
        sessionId: "ses_companion",
        type: "file",
        label: "upload.txt",
        createdAt: "2026-09-08T00:00:00.000Z",
        metadata: {
          filename: "upload.txt",
          mimeType: "text/plain",
          sizeBytes: 7,
          sha256:
            "f16d05ec6b29248d2c61adb1e9263f78e4f7bace1b955014a2d17872cfe4064d",
          source: "user_file_grant",
          grantId: `grant_${"a".repeat(32)}`,
        },
      });
    }) as typeof fetch;
    const client = new CompanionRuntimeClient({
      baseUrl: "http://127.0.0.1:47820",
      token: "runtime-secret",
      fetchImpl,
    });
    await expect(
      client.materializeUserFile({
        taskId: "task_exact",
        sessionId: "ses_companion",
        grantId: `grant_${"a".repeat(32)}`,
        filename: "upload.txt",
        mimeType: "text/plain",
        bytes: Buffer.from("fixture"),
      }),
    ).resolves.toMatchObject({ id: "ev_file", sessionId: "ses_companion" });
    const [url, init] = captured!;
    expect(String(url)).toContain("/sessions/ses_companion/evidence/files");
    expect(init?.headers).toMatchObject({
      "x-rove-task-id": "task_exact",
      "x-rove-grant-id": `grant_${"a".repeat(32)}`,
      "x-rove-file-source": "user_file_grant",
    });
    expect(Buffer.from(init?.body as Uint8Array).toString()).toBe("fixture");
    expect(JSON.stringify(init?.headers)).not.toContain("/tmp");
  });
});
