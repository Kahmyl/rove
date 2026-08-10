import { createServer, type Server } from "node:http";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

type Inspection = {
  pageId: string;
  revision: number;
  text?: string;
  targets?: Array<{
    ref: string;
    name?: string;
  }>;
};

const fixture = await startFixture();

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["dist/main.js"],
  env: cleanEnvironment({
    ROVE_MCP_TRANSPORT: "stdio",
  }),
});

const client = new Client({
  name: "rove-m10-handoff-acceptance",
  version: "1.0.0",
});

await client.connect(transport);

let sessionId: string | undefined;

try {
  const session = await callJson<{
    id: string;
    status: string;
    controller: string;
  }>(
    client,
    "session.start",
    {
      mode: "companion",
      startUrl: fixture.url,
    },
  );

  sessionId = session.id;

  const before = await callJson<Inspection>(
    client,
    "browser.inspect",
    {
      sessionId,
    },
  );

  const staleTarget = target(
    before,
    "Agent Continue",
  );

  const requested = await callJson<{
    status: string;
    controller: null;
    observationSeq: number;
  }>(
    client,
    "control.request_human",
    {
      sessionId,
      reason:
        "M10 acceptance: complete the Human Action in the browser, then return control.",
    },
  );

  process.stdout.write(`
Scenario C is ready.

Session:
${sessionId}

In the Electron Companion:

1. Confirm the handoff reason is visible.
2. Press Take Control.
3. In the browser, press Human Action.
4. Return to Companion.
5. Press Return Control.

Waiting for human takeover...
`);

  const tookControl = await callJson<{
    event: string;
    observationSeq?: number;
  }>(
    client,
    "control.wait",
    {
      sessionId,
      afterSeq:
        requested.observationSeq,
      timeoutMs: 60000,
    },
  );

  if (
    tookControl.event !==
    "human_took_control"
  ) {
    throw new Error(
      `Expected human_took_control, received ${tookControl.event}.`,
    );
  }

  process.stdout.write(
    "Human control detected. Waiting for return to agent...\n",
  );

  const returned = await callJson<{
    event: string;
  }>(
    client,
    "control.wait",
    {
      sessionId,
      afterSeq:
        tookControl.observationSeq ?? 0,
      timeoutMs: 60000,
    },
  );

  if (
    returned.event !==
    "human_returned_control"
  ) {
    throw new Error(
      `Expected human_returned_control, received ${returned.event}.`,
    );
  }

  process.stdout.write(
    "Agent control restored.\n",
  );

  const fresh = await callJson<Inspection>(
    client,
    "browser.inspect",
    {
      sessionId,
    },
  );

  if (
    !fresh.text?.includes(
      "Human interaction complete",
    )
  ) {
    throw new Error(
      "Fresh inspection did not contain the human interaction result.",
    );
  }

  let staleRejected = false;

  try {
    await callJson(
      client,
      "browser.click",
      {
        sessionId,
        target: staleTarget,
      },
    );
  } catch {
    staleRejected = true;
  }

  if (!staleRejected) {
    throw new Error(
      "Pre-handoff target unexpectedly remained valid after control return.",
    );
  }

  await callJson(
    client,
    "browser.click",
    {
      sessionId,
      target: target(
        fresh,
        "Agent Continue",
      ),
    },
  );

  const finalInspection =
    await callJson<Inspection>(
      client,
      "browser.inspect",
      {
        sessionId,
      },
    );

  if (
    !finalInspection.text?.includes(
      "Agent continued successfully",
    )
  ) {
    throw new Error(
      "Agent did not continue successfully after human handoff.",
    );
  }

  await callJson(
    client,
    "session.end",
    {
      sessionId,
    },
  );

  sessionId = undefined;

  process.stdout.write(`
SCENARIO C: PASS

Verified:
- real MCP stdio agent session
- request-human reason visible to Companion
- Electron human takeover
- human browser interaction
- return to agent
- pre-handoff target invalidated
- fresh inspection succeeds
- agent continues successfully
`);
} finally {
  if (sessionId !== undefined) {
    await callJson(
      client,
      "session.end",
      {
        sessionId,
      },
    ).catch(() => undefined);
  }

  await client.close().catch(
    () => undefined,
  );

  await closeServer(fixture.server);
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

  const content =
    result.content[0];

  if (
    content === undefined ||
    content.type !== "text"
  ) {
    throw new Error(
      `Expected JSON text from ${name}.`,
    );
  }

  if (result.isError === true) {
    throw new Error(content.text);
  }

  return JSON.parse(
    content.text,
  ) as T;
}

function cleanEnvironment(
  extra: Record<string, string>,
): Record<string, string> {
  const env:
    Record<string, string> = {};

  for (
    const [key, value]
    of Object.entries(process.env)
  ) {
    if (
      value !== undefined &&
      !key.startsWith("ROVE_MCP_")
    ) {
      env[key] = value;
    }
  }

  return {
    ...env,
    ...extra,
  };
}

async function startFixture(): Promise<{
  server: Server;
  url: string;
}> {
  const server =
    createServer(
      (_request, response) => {
        response.setHeader(
          "content-type",
          "text/html; charset=utf-8",
        );

        response.end(`
          <!doctype html>
          <html>
            <head>
              <title>Rove M10 Handoff</title>
            </head>
            <body>
              <h1>M10 Human Handoff</h1>

              <p id="human-status">
                Waiting for human interaction
              </p>

              <button
                id="human-action"
                onclick="
                  document.getElementById('human-status').textContent =
                    'Human interaction complete'
                "
              >
                Human Action
              </button>

              <button
                id="agent-continue"
                onclick="
                  document.getElementById('agent-status').textContent =
                    'Agent continued successfully'
                "
              >
                Agent Continue
              </button>

              <p id="agent-status">
                Waiting for agent continuation
              </p>
            </body>
          </html>
        `);
      },
    );

  await new Promise<void>(
    (resolve, reject) => {
      server.once(
        "error",
        reject,
      );

      server.listen(
        0,
        "127.0.0.1",
        resolve,
      );
    },
  );

  const address =
    server.address();

  if (
    address === null ||
    typeof address === "string"
  ) {
    throw new Error(
      "Fixture server failed to bind.",
    );
  }

  return {
    server,
    url:
      `http://127.0.0.1:${address.port}`,
  };
}

async function closeServer(
  server: Server,
): Promise<void> {
  await new Promise<void>(
    (resolve) => {
      server.close(
        () => resolve(),
      );
    },
  );
}
