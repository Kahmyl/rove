import process from "node:process";
import readline from "node:readline";

const pendingElicitations = new Map();
let nextElicitation = 1;
let clientCapabilities = {};
let protocolVersion = "2025-11-25";

function send(message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
}

function toolResult(value) {
  return {
    content: [{ type: "text", text: JSON.stringify(value) }],
  };
}

function requestElicitation(toolRequest, mode) {
  const id = `fixture-elicitation-${nextElicitation++}`;
  pendingElicitations.set(id, { toolRequestId: toolRequest.id, mode });
  if (mode === "form") {
    send({
      id,
      method: "elicitation/create",
      params: {
        mode: "form",
        message: "Choose non-sensitive fixture preferences.",
        requestedSchema: {
          type: "object",
          properties: {
            project: {
              type: "string",
              title: "Project",
              description: "A non-sensitive fixture label.",
              minLength: 1,
              maxLength: 80,
            },
            urgency: {
              type: "string",
              title: "Urgency",
              enum: ["normal", "soon"],
              enumNames: ["Normal", "Soon"],
            },
            includeSummary: {
              type: "boolean",
              title: "Include summary",
              default: true,
            },
          },
          required: ["project", "urgency"],
        },
      },
    });
    return;
  }
  send({
    id,
    method: "elicitation/create",
    params: {
      mode: "url",
      elicitationId: "fixture-connect-account",
      message: "Open the fixture authorization page to continue.",
      url: "https://example.com/rove-fixture/connect?flow=fixture",
    },
  });
}

function completeElicitation(response) {
  const pending = pendingElicitations.get(String(response.id));
  if (!pending) return false;
  pendingElicitations.delete(String(response.id));
  if (response.error) {
    send({
      id: pending.toolRequestId,
      result: toolResult({
        mode: pending.mode,
        outcome: "client_error",
        code: response.error.code ?? null,
      }),
    });
    return true;
  }
  send({
    id: pending.toolRequestId,
    result: toolResult({
      mode: pending.mode,
      action: response.result?.action ?? "cancel",
      contentPresent: response.result?.content != null,
    }),
  });
  return true;
}

readline.createInterface({ input: process.stdin }).on("line", (line) => {
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    send({ id: null, error: { code: -32700, message: "Parse error" } });
    return;
  }
  if (request.method === undefined && completeElicitation(request)) return;
  if (request.id === undefined) return;
  if (request.method === "initialize") {
    protocolVersion = request.params?.protocolVersion ?? protocolVersion;
    clientCapabilities = request.params?.capabilities ?? {};
    send({
      id: request.id,
      result: {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: {
          name: "rove-attention-fixture",
          version: "0.1.0",
        },
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
        tools: [
          {
            name: "collect_preferences",
            description: "Request non-sensitive structured fixture input.",
            inputSchema: { type: "object", additionalProperties: false },
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
              idempotentHint: true,
              openWorldHint: false,
            },
          },
          {
            name: "connect_account",
            description: "Request consent for a fixture authorization URL.",
            inputSchema: { type: "object", additionalProperties: false },
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
              idempotentHint: true,
              openWorldHint: false,
            },
          },
        ],
      },
    });
    return;
  }
  if (request.method === "tools/call") {
    if (!clientCapabilities.elicitation) {
      send({
        id: request.id,
        result: {
          isError: true,
          content: [
            { type: "text", text: "client elicitation capability unavailable" },
          ],
        },
      });
      return;
    }
    if (request.params?.name === "collect_preferences") {
      requestElicitation(request, "form");
      return;
    }
    if (request.params?.name === "connect_account") {
      requestElicitation(request, "url");
      return;
    }
  }
  send({
    id: request.id,
    error: { code: -32601, message: "Method not found" },
  });
});
