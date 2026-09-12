import readline from "node:readline";
import process from "node:process";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const catalog = JSON.parse(
  await readFile(resolve(here, "fixtures/rove-tool-catalog.json"), "utf8"),
);
const boundTaskId = process.env.ROVE_TASK_ID;
const capability = process.env.ROVE_TASK_CAPABILITY;
const onePixelPng =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function send(message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
}

function toolResult(request) {
  if (!boundTaskId || !capability?.startsWith("rtcap_")) {
    return {
      isError: true,
      content: [{ type: "text", text: "task capability unavailable" }],
    };
  }
  if (
    request.params?.arguments?.roveTaskId &&
    request.params.arguments.roveTaskId !== boundTaskId
  ) {
    return {
      isError: true,
      content: [{ type: "text", text: "task binding mismatch" }],
    };
  }
  if (request.params?.name === "browser.screenshot") {
    return {
      content: [
        { type: "image", mimeType: "image/png", data: onePixelPng },
        {
          type: "text",
          text: JSON.stringify({
            evidenceId: "ev_fixture",
            roveTaskId: boundTaskId,
          }),
        },
      ],
    };
  }
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          roveTaskId: boundTaskId,
          roveSessionId: "ses_fixture",
        }),
      },
    ],
  };
}

readline.createInterface({ input: process.stdin }).on("line", (line) => {
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    send({ id: null, error: { code: -32700, message: "Parse error" } });
    return;
  }
  if (request.id === undefined) return;
  if (request.method === "initialize") {
    send({
      id: request.id,
      result: {
        protocolVersion: request.params?.protocolVersion ?? "2025-06-18",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: catalog.serverName, version: catalog.version },
      },
    });
    return;
  }
  if (request.method === "ping") {
    send({ id: request.id, result: {} });
    return;
  }
  if (request.method === "tools/list") {
    send({
      id: request.id,
      result: {
        tools: catalog.tools.map((name) => ({
          name,
          description: `P5.0 fixture for ${name}`,
          inputSchema: { type: "object", additionalProperties: true },
          annotations: {
            readOnlyHint: name === "session.status",
            destructiveHint: false,
            idempotentHint: name === "session.status",
            openWorldHint: false,
          },
        })),
      },
    });
    return;
  }
  if (request.method === "tools/call") {
    send({ id: request.id, result: toolResult(request) });
    return;
  }
  send({
    id: request.id,
    error: { code: -32601, message: "Method not found" },
  });
});
