import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { Session } from "@rove/protocol";

import { CompanionRuntimeClient } from "./runtime-client.js";

const session: Session = {
  id: "ses_companion",
  mode: "companion",
  status: "active",
  controller: "agent",
  profile: {
    mode: "temporary",
  },
  createdAt: "2026-08-10T07:00:00.000Z",
  updatedAt: "2026-08-10T07:00:00.000Z",
};

function jsonResponse(
  value: unknown,
  status = 200,
): Response {
  return new Response(
    JSON.stringify(value),
    {
      status,
      headers: {
        "content-type": "application/json",
      },
    },
  );
}

describe("CompanionRuntimeClient", () => {
  it("discovers Companion Mode and returns live counts", async () => {
    const fetchImpl = vi.fn(
      async (
        input: string | URL | Request,
        init?: RequestInit,
      ) => {
        const url = String(input);

        const authorization =
          new Headers(
            init?.headers,
          ).get("authorization");

        expect(authorization).toBe(
          "Bearer runtime-secret-123456789012",
        );

        if (
          url.endsWith(
            "/sessions?mode=companion",
          )
        ) {
          return jsonResponse([session]);
        }

        if (
          url.includes("/observations?")
        ) {
          return jsonResponse({
            items: [
              {
                id: "obs_1",
                seq: 1,
                timestamp:
                  "2026-08-10T07:00:01.000Z",
                actor: "system",
                type: "session_started",
                data: {},
              },
              {
                id: "obs_2",
                seq: 2,
                timestamp:
                  "2026-08-10T07:00:02.000Z",
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

        throw new Error(
          `Unexpected request: ${url}`,
        );
      },
    ) as typeof fetch;

    const client =
      new CompanionRuntimeClient({
        baseUrl:
          "http://127.0.0.1:47820/",
        token:
          "runtime-secret-123456789012",
        fetchImpl,
      });

    await expect(
      client.getSnapshot(),
    ).resolves.toMatchObject({
      session: {
        id: "ses_companion",
        mode: "companion",
      },
      observationCount: 2,
      evidenceCount: 1,
    });
  });

  it("uses runtime control and finish endpoints", async () => {
    const requests: {
      url: string;
      method: string;
    }[] = [];

    let ended = false;

    const fetchImpl = vi.fn(
      async (
        input: string | URL | Request,
        init?: RequestInit,
      ) => {
        const url = String(input);
        const method =
          init?.method ?? "GET";

        requests.push({
          url,
          method,
        });

        if (
          url.endsWith(
            "/sessions?mode=companion",
          )
        ) {
          return jsonResponse(
            ended ? [] : [session],
          );
        }

        if (
          url.endsWith("/control/take") ||
          url.endsWith("/control/return")
        ) {
          return jsonResponse({
            sessionId: session.id,
            status: "active",
            controller: "human",
            updatedAt: session.updatedAt,
          });
        }

        if (url.endsWith("/end")) {
          ended = true;
          return jsonResponse({
            ...session,
            status: "completed",
            controller: null,
          });
        }

        if (
          url.includes("/observations?")
        ) {
          return jsonResponse({
            items: [],
          });
        }

        if (url.endsWith("/evidence")) {
          return jsonResponse([]);
        }

        throw new Error(
          `Unexpected request: ${url}`,
        );
      },
    ) as typeof fetch;

    const client =
      new CompanionRuntimeClient({
        baseUrl:
          "http://127.0.0.1:47820",
        fetchImpl,
      });

    await client.takeControl();
    await client.returnControl();
    await client.finishSession();

    expect(requests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          url: expect.stringContaining(
            "/control/take",
          ),
          method: "POST",
        }),
        expect.objectContaining({
          url: expect.stringContaining(
            "/control/return",
          ),
          method: "POST",
        }),
        expect.objectContaining({
          url: expect.stringContaining(
            "/end",
          ),
          method: "POST",
        }),
      ]),
    );
  });
});
