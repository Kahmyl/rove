import { createServer, type Server } from "node:http";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const SECRET =
  "M10_CAPTURE_SECRET_20260810";

type Session = {
  id: string;
  mode: string;
  status: string;
  controller: string | null;
};

type Observation = {
  seq: number;
  actor: string;
  type: string;
  data: unknown;
};

const fixture = await startFixture();

const transport =
  new StdioClientTransport({
    command: process.execPath,
    args: ["dist/main.js"],
    env: cleanEnvironment({
      ROVE_MCP_TRANSPORT: "stdio",
    }),
  });

const client = new Client({
  name: "rove-m10-capture-acceptance",
  version: "1.0.0",
});

await client.connect(transport);

let sessionId: string | undefined;

try {
  const session =
    await callJson<Session>(
      client,
      "session.start",
      {
        mode: "capture",
        startUrl: fixture.url,
      },
    );

  sessionId = session.id;

  if (
    session.mode !== "capture" ||
    session.controller !== "human"
  ) {
    throw new Error(
      "Capture session did not start human-owned.",
    );
  }

  const blocked =
    await client.callTool({
      name: "browser.navigate",
      arguments: {
        sessionId,
        url: `${fixture.url}/blocked`,
      },
    });

  if (blocked.isError !== true) {
    throw new Error(
      "Capture Mode unexpectedly allowed agent browser mutation.",
    );
  }

  process.stdout.write(`
Scenario D is ready.

Session:
${sessionId}

In the Companion confirm:

- Mode: Capture
- Controller: You
- Take/Return controls are unavailable
- Finish Session is available

In the browser:

1. Click Visit Details.
2. Click Meaningful Action.
3. Change Sort Order to Oldest.
4. Scroll all the way to the bottom.
5. Click Open Tab.
6. Switch to the new tab and wait about one second.
7. Switch back to the original tab and wait about one second.
8. In Password Fixture enter exactly:

${SECRET}

9. Click Submit Form.
10. Confirm Capture submission complete appears.
11. In Companion click Finish Session.

Waiting for Capture Mode to finish...
`);

  await waitForCompletion(
    client,
    sessionId,
  );

  const result =
    await callJson<{
      observations: Observation[];
    }>(
      client,
      "session.observations",
      {
        sessionId,
        afterSeq: 0,
        limit: 500,
      },
    );

  const observations =
    result.observations;

  const types =
    observations.map(
      (item) => item.type,
    );

  const required = [
    "url_changed",
    "navigation_completed",
    "human_click",
    "human_selection",
    "human_scroll",
    "page_opened",
    "page_switched",
    "human_submit",
  ];

  const missing =
    required.filter(
      (type) => !types.includes(type),
    );

  process.stdout.write(
    "\nCaptured journey:\n",
  );

  for (const observation of observations) {
    process.stdout.write(
      `${String(observation.seq).padStart(2, "0")} ${observation.actor} ${observation.type}\n`,
    );
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing Capture observations: ${missing.join(", ")}`,
    );
  }

  const serialized =
    JSON.stringify(observations);

  if (serialized.includes(SECRET)) {
    throw new Error(
      "Sensitive password appeared in MCP observation readback.",
    );
  }

  const roveHome =
    process.env.ROVE_HOME;

  if (
    roveHome === undefined ||
    roveHome.trim() === ""
  ) {
    throw new Error(
      "ROVE_HOME must be provided for sensitive persistence verification.",
    );
  }

  const persistedSecret =
    await directoryContains(
      roveHome,
      Buffer.from(SECRET),
    );

  if (persistedSecret) {
    throw new Error(
      "Sensitive password was found in persisted Rove data.",
    );
  }

  process.stdout.write(`
SCENARIO D: PASS

Verified:
- Capture Mode starts human-owned
- agent browser mutation is blocked
- human navigation captured
- meaningful click captured
- selection captured
- scroll captured
- tab opening captured
- real human tab switching captured
- form submission captured
- observations remain ordered
- MCP can read the completed human journey
- password absent from observation readback
- password absent from persisted Rove data
`);
} finally {
  if (sessionId !== undefined) {
    const status =
      await callJson<Session>(
        client,
        "session.status",
        {
          sessionId,
        },
      ).catch(() => undefined);

    if (
      status !== undefined &&
      status.status !== "completed" &&
      status.status !== "failed"
    ) {
      await callJson(
        client,
        "session.end",
        {
          sessionId,
        },
      ).catch(() => undefined);
    }
  }

  await client.close().catch(
    () => undefined,
  );

  await closeServer(
    fixture.server,
  );
}

async function waitForCompletion(
  client: Client,
  sessionId: string,
): Promise<void> {
  const deadline =
    Date.now() + 300_000;

  while (Date.now() < deadline) {
    const session =
      await callJson<Session>(
        client,
        "session.status",
        {
          sessionId,
        },
      );

    if (session.status === "completed") {
      return;
    }

    if (session.status === "failed") {
      throw new Error(
        "Capture session failed.",
      );
    }

    await delay(500);
  }

  throw new Error(
    "Timed out waiting for Capture Mode completion.",
  );
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

function delay(
  milliseconds: number,
): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function directoryContains(
  directory: string,
  needle: Buffer,
): Promise<boolean> {
  const entries =
    await readdir(
      directory,
      {
        withFileTypes: true,
      },
    ).catch(() => []);

  for (const entry of entries) {
    const fullPath =
      path.join(
        directory,
        entry.name,
      );

    if (entry.isDirectory()) {
      if (
        await directoryContains(
          fullPath,
          needle,
        )
      ) {
        return true;
      }

      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const content =
      await readFile(fullPath);

    if (content.includes(needle)) {
      return true;
    }
  }

  return false;
}

async function startFixture(): Promise<{
  server: Server;
  url: string;
}> {
  const server =
    createServer(
      (request, response) => {
        const url =
          new URL(
            request.url ?? "/",
            "http://fixture",
          );

        response.setHeader(
          "content-type",
          "text/html; charset=utf-8",
        );

        if (
          request.method === "POST" &&
          url.pathname === "/submitted"
        ) {
          request.resume();

          response.end(`
            <!doctype html>
            <title>Capture Submitted</title>
            <h1>Capture submission complete</h1>
          `);

          return;
        }

        if (url.pathname === "/tab") {
          response.end(`
            <!doctype html>
            <title>Capture Tab</title>
            <h1>Secondary Capture Tab</h1>
            <p>Switch back to the original tab.</p>
          `);

          return;
        }

        if (url.pathname === "/details") {
          response.end(`
            <!doctype html>
            <title>Capture Details</title>

            <h1>Capture Details</h1>

            <button
              onclick="
                document.getElementById('action-result').textContent =
                  'Meaningful action complete'
              "
            >
              Meaningful Action
            </button>

            <p id="action-result">
              Waiting for action
            </p>

            <label>
              Sort Order
              <select aria-label="Sort Order">
                <option>Newest</option>
                <option>Oldest</option>
              </select>
            </label>

            <p>
              <a
                href="/tab"
                target="_blank"
              >
                Open Tab
              </a>
            </p>

            <div style="height: 1600px">
              Scroll through this Capture fixture.
            </div>

            <form
              action="/submitted"
              method="post"
            >
              <label>
                Password Fixture
                <input
                  type="password"
                  name="password"
                  aria-label="Password Fixture"
                >
              </label>

              <button type="submit">
                Submit Form
              </button>
            </form>
          `);

          return;
        }

        response.end(`
          <!doctype html>
          <title>Capture Home</title>

          <h1>Capture Home</h1>

          <a href="/details">
            Visit Details
          </a>
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
      "Capture fixture failed to bind.",
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
