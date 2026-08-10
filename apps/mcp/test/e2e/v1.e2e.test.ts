import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server as HttpServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ROOT = fileURLToPath(
  new URL("../../../../", import.meta.url),
);

const RUNTIME_TOKEN =
  "m10-runtime-token-1234567890";

const MCP_TOKEN =
  "m10-streamable-http-token-1234567890";

type Inspection = {
  pageId: string;
  revision: number;
  url: string;
  title: string;
  text?: string;
  targets?: Array<{
    ref: string;
    kind: string;
    name?: string;
  }>;
};

let runtime: ChildProcess;
let runtimePort: number;
let fixture: HttpServer;
let fixtureUrl: string;
let roveHome: string;

beforeAll(async () => {
  roveHome = await mkdtemp(
    path.join(tmpdir(), "rove-m10-"),
  );

  const fixtureStarted =
    await startFixture();

  fixture = fixtureStarted.server;
  fixtureUrl = fixtureStarted.url;

  runtimePort = await availablePort();

  runtime = spawnNode(
    "apps/runtime/dist/main.js",
    {
      ROVE_HOME: roveHome,
      ROVE_RUNTIME_HOST: "127.0.0.1",
      ROVE_RUNTIME_PORT:
        String(runtimePort),
      ROVE_RUNTIME_TOKEN:
        RUNTIME_TOKEN,
      ROVE_BROWSER_HEADLESS: "true",
      ROVE_BROWSER: "chromium",
    },
  );

  await waitForHealth(
    `http://127.0.0.1:${runtimePort}/health`,
  );
}, 60_000);

afterAll(async () => {
  await stopProcess(runtime);

  await new Promise<void>((resolve) => {
    fixture.close(() => resolve());
  });

  await rm(
    roveHome,
    {
      recursive: true,
      force: true,
    },
  );
}, 60_000);

describe("M10 V1 process E2E", () => {
  it(
    "runs a complete agent task through real MCP stdio",
    async () => {
      const transport =
        new StdioClientTransport({
          command: process.execPath,
          args: [
            path.join(
              ROOT,
              "apps/mcp/dist/main.js",
            ),
          ],
          env: childEnv({
            ROVE_RUNTIME_URL:
              `http://127.0.0.1:${runtimePort}`,
            ROVE_RUNTIME_TOKEN:
              RUNTIME_TOKEN,
            ROVE_MCP_TRANSPORT:
              "stdio",
          }),
        });

      const client = new Client({
        name: "rove-m10-stdio",
        version: "1.0.0",
      });

      await client.connect(transport);

      try {
        await runAgentScenario(client);
      } finally {
        await client.close();
      }
    },
    60_000,
  );

  it(
    "runs the same task through authenticated Streamable HTTP",
    async () => {
      const port = await availablePort();

      const process = spawnNode(
        "apps/mcp/dist/main.js",
        {
          ROVE_RUNTIME_URL:
            `http://127.0.0.1:${runtimePort}`,
          ROVE_RUNTIME_TOKEN:
            RUNTIME_TOKEN,
          ROVE_MCP_TRANSPORT: "http",
          ROVE_MCP_HOST: "127.0.0.1",
          ROVE_MCP_PORT: String(port),
          ROVE_MCP_PATH: "/mcp",
          ROVE_MCP_TOKEN: MCP_TOKEN,
          ROVE_MCP_ALLOWED_HOSTS:
            `127.0.0.1:${port}`,
        },
      );

      await waitForHealth(
        `http://127.0.0.1:${port}/health`,
      );

      const transport =
        new StreamableHTTPClientTransport(
          new URL(
            `http://127.0.0.1:${port}/mcp`,
          ),
          {
            requestInit: {
              headers: {
                authorization:
                  `Bearer ${MCP_TOKEN}`,
              },
            },
          },
        );

      const client = new Client({
        name: "rove-m10-http",
        version: "1.0.0",
      });

      await client.connect(transport);

      try {
        await runAgentScenario(client);
      } finally {
        await client.close();
        await stopProcess(process);
      }
    },
    60_000,
  );
});

async function runAgentScenario(
  client: Client,
): Promise<void> {
  const session =
    await callJson<{
      id: string;
      status: string;
    }>(
      client,
      "session.start",
      {
        mode: "agent",
        startUrl: fixtureUrl,
      },
    );

  const sessionId = session.id;
  let ended = false;

  try {
    expect(session.status).toBe("active");

    let inspection =
      await callJson<Inspection>(
        client,
        "browser.inspect",
        { sessionId },
      );

    expect(inspection.text).toContain(
      "Rove Search",
    );

    await callJson(
      client,
      "browser.type",
      {
        sessionId,
        target: target(
          inspection,
          "Search query",
        ),
        value: "rove",
      },
    );

    inspection =
      await callJson<Inspection>(
        client,
        "browser.inspect",
        { sessionId },
      );

    await callJson(
      client,
      "browser.click",
      {
        sessionId,
        target: target(
          inspection,
          "Search",
        ),
      },
    );

    inspection =
      await callJson<Inspection>(
        client,
        "browser.inspect",
        { sessionId },
      );

    expect(inspection.text).toContain(
      "Search results",
    );

    await callJson(
      client,
      "browser.click",
      {
        sessionId,
        target: target(
          inspection,
          "Rove result",
        ),
      },
    );

    inspection =
      await callJson<Inspection>(
        client,
        "browser.inspect",
        { sessionId },
      );

    expect(inspection.text).toContain(
      "Structured browser automation fixture record.",
    );

    await callJson(
      client,
      "evidence.save_record",
      {
        sessionId,
        label: "selected-result",
        record: {
          title: inspection.title,
          url: inspection.url,
        },
      },
    );

    await callJson(
      client,
      "browser.screenshot",
      {
        sessionId,
        mode: "viewport",
        label: "result-page",
      },
    );

    const evidence =
      await callJson<
        Array<{ type: string }>
      >(
        client,
        "evidence.list",
        { sessionId },
      );

    expect(
      evidence.some(
        (item) =>
          item.type === "record",
      ),
    ).toBe(true);

    expect(
      evidence.some(
        (item) =>
          item.type === "screenshot",
      ),
    ).toBe(true);

    const observations =
      await callJson<{
        observations: Array<{
          type: string;
        }>;
      }>(
        client,
        "session.observations",
        {
          sessionId,
          afterSeq: 0,
          limit: 500,
        },
      );

    const types =
      observations.observations.map(
        (item) => item.type,
      );

    expect(types).toContain(
      "record_saved",
    );

    expect(types).toContain(
      "screenshot_captured",
    );

    const completed =
      await callJson<{
        status: string;
        controller: unknown;
      }>(
        client,
        "session.end",
        { sessionId },
      );

    expect(completed.status).toBe(
      "completed",
    );

    expect(completed.controller).toBeNull();

    ended = true;
  } finally {
    if (!ended) {
      await callJson(
        client,
        "session.end",
        { sessionId },
      ).catch(() => undefined);
    }
  }
}

function target(
  inspection: Inspection,
  name: string,
): {
  pageId: string;
  revision: number;
  ref: string;
} {
  const item =
    inspection.targets?.find(
      (candidate) =>
        candidate.name === name,
    );

  if (item === undefined) {
    throw new Error(
      `Target not found: ${name}`,
    );
  }

  return {
    pageId: inspection.pageId,
    revision: inspection.revision,
    ref: item.ref,
  };
}

async function callJson<T = unknown>(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const result =
    await client.callTool({
      name,
      arguments: args,
    });

  const content = result.content[0];

  if (
    content === undefined ||
    content.type !== "text"
  ) {
    throw new Error(
      `Expected JSON text from ${name}.`,
    );
  }

  return JSON.parse(content.text) as T;
}

function spawnNode(
  relativeEntry: string,
  extraEnv: Record<string, string>,
): ChildProcess {
  return spawn(
    process.execPath,
    [
      path.join(
        ROOT,
        relativeEntry,
      ),
    ],
    {
      cwd: ROOT,
      env: childEnv(extraEnv),
      stdio: [
        "ignore",
        "inherit",
        "inherit",
      ],
    },
  );
}

function childEnv(
  extra:
    Record<string, string>,
): Record<string, string> {
  const env:
    Record<string, string> = {};

  for (
    const [key, value]
    of Object.entries(process.env)
  ) {
    if (
      value !== undefined &&
      !key.startsWith("ROVE_")
    ) {
      env[key] = value;
    }
  }

  return {
    ...env,
    ...extra,
  };
}

async function stopProcess(
  process: ChildProcess | undefined,
): Promise<void> {
  if (
    process === undefined ||
    process.exitCode !== null
  ) {
    return;
  }

  process.kill("SIGTERM");

  await new Promise<void>((resolve) => {
    const timer = setTimeout(
      () => {
        if (
          process.exitCode === null
        ) {
          process.kill("SIGKILL");
        }

        resolve();
      },
      3_000,
    );

    process.once(
      "exit",
      () => {
        clearTimeout(timer);
        resolve();
      },
    );
  });
}

async function waitForHealth(
  url: string,
): Promise<void> {
  const deadline =
    Date.now() + 15_000;

  let lastResult =
    "no response";

  while (
    Date.now() < deadline
  ) {
    try {
      const response =
        await fetch(url);

      if (response.ok) {
        return;
      }

      const body =
        await response.text();

      lastResult =
        `${response.status} ${body}`;
    } catch (error) {
      lastResult =
        error instanceof Error
          ? error.message
          : String(error);
    }

    await delay(100);
  }

  throw new Error(
    `Timed out waiting for ${url}. Last result: ${lastResult}`,
  );
}

function delay(
  milliseconds: number,
): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function availablePort():
Promise<number> {
  const server = createServer();

  await new Promise<void>(
    (resolve, reject) => {
      server.once("error", reject);
      server.listen(
        0,
        "127.0.0.1",
        resolve,
      );
    },
  );

  const address = server.address();

  if (
    address === null ||
    typeof address === "string"
  ) {
    throw new Error(
      "Port probe failed.",
    );
  }

  const port = address.port;

  await new Promise<void>(
    (resolve) => {
      server.close(
        () => resolve(),
      );
    },
  );

  return port;
}

async function startFixture():
Promise<{
  server: HttpServer;
  url: string;
}> {
  const server =
    createServer(
      (request, response) => {
        const url = new URL(
          request.url ?? "/",
          "http://fixture",
        );

        response.setHeader(
          "content-type",
          "text/html; charset=utf-8",
        );

        if (
          url.pathname === "/results"
        ) {
          response.end(`
            <!doctype html>
            <title>Rove Results</title>
            <h1>Search results</h1>
            <a href="/result/rove">Rove result</a>
          `);
          return;
        }

        if (
          url.pathname ===
          "/result/rove"
        ) {
          response.end(`
            <!doctype html>
            <title>Rove Result</title>
            <h1>Rove Result</h1>
            <p>Structured browser automation fixture record.</p>
          `);
          return;
        }

        response.end(`
          <!doctype html>
          <title>Rove Search</title>
          <h1>Rove Search</h1>
          <form action="/results" method="get">
            <label>
              Search query
              <input
                name="q"
                aria-label="Search query"
              >
            </label>
            <button type="submit">Search</button>
          </form>
        `);
      },
    );

  await new Promise<void>(
    (resolve, reject) => {
      server.once("error", reject);
      server.listen(
        0,
        "127.0.0.1",
        resolve,
      );
    },
  );

  const address = server.address();

  if (
    address === null ||
    typeof address === "string"
  ) {
    throw new Error(
      "Fixture failed to bind.",
    );
  }

  return {
    server,
    url:
      `http://127.0.0.1:${address.port}`,
  };
}
