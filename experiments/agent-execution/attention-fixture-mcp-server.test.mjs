import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { dirname, resolve } from "node:path";
import process from "node:process";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import test from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = resolve(here, "attention-fixture-mcp-server.mjs");

test("attention fixture emits real MCP form and URL elicitation requests", async () => {
  const child = spawn(process.execPath, [fixture], {
    stdio: ["pipe", "pipe", "inherit"],
  });
  const messages = [];
  const waiters = [];
  readline.createInterface({ input: child.stdout }).on("line", (line) => {
    const message = JSON.parse(line);
    messages.push(message);
    for (const waiter of [...waiters]) {
      if (waiter.predicate(message)) {
        waiters.splice(waiters.indexOf(waiter), 1);
        waiter.resolve(message);
      }
    }
  });
  const send = (message) =>
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
  const waitFor = (predicate) => {
    const existing = messages.find(predicate);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolveWait) =>
      waiters.push({ predicate, resolve: resolveWait }),
    );
  };
  try {
    send({
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: { elicitation: { form: {}, url: {} } },
        clientInfo: { name: "fixture-test", version: "0.1.0" },
      },
    });
    await waitFor((message) => message.id === 1);
    send({
      id: 2,
      method: "tools/call",
      params: { name: "collect_preferences", arguments: {} },
    });
    const form = await waitFor(
      (message) =>
        message.method === "elicitation/create" &&
        message.params?.mode === "form",
    );
    assert.equal(form.params.requestedSchema.properties.project.type, "string");
    send({
      id: form.id,
      result: {
        action: "accept",
        content: { project: "Rove fixture", urgency: "normal" },
      },
    });
    const formResult = await waitFor((message) => message.id === 2);
    assert.match(formResult.result.content[0].text, /"action":"accept"/);

    send({
      id: 3,
      method: "tools/call",
      params: { name: "connect_account", arguments: {} },
    });
    const url = await waitFor(
      (message) =>
        message.method === "elicitation/create" &&
        message.params?.mode === "url",
    );
    assert.equal(url.params.elicitationId, "fixture-connect-account");
    assert.match(url.params.url, /^https:\/\//);
    send({ id: url.id, result: { action: "cancel", content: null } });
    const urlResult = await waitFor((message) => message.id === 3);
    assert.match(urlResult.result.content[0].text, /"action":"cancel"/);
  } finally {
    child.stdin.end();
    await once(child, "exit");
  }
});
