#!/usr/bin/env node

import { createHash } from "node:crypto";
import process from "node:process";

import {
  canonicalRoveToolDefinitionsJsonWire,
  ROVE_TOOL_DEFINITIONS_SHA256,
} from "../../packages/protocol/dist/index.js";
import { toolDefinitions } from "../../apps/mcp/dist/server/register-tools.js";

const runtime = new Proxy({}, { get: () => async () => ({}) });
const definitions = toolDefinitions(runtime).map(
  ({ name, description, inputSchema }) => ({
    name,
    description,
    inputSchema,
  }),
);
const digest = (value) =>
  createHash("sha256")
    .update(canonicalRoveToolDefinitionsJsonWire(value))
    .digest("hex");
const inMemoryDigest = digest(definitions);
const jsonWireDigest = digest(JSON.parse(JSON.stringify(definitions)));
const status =
  inMemoryDigest === ROVE_TOOL_DEFINITIONS_SHA256 &&
  jsonWireDigest === ROVE_TOOL_DEFINITIONS_SHA256
    ? "pass"
    : "fail";

process.stdout.write(
  `${JSON.stringify(
    {
      status,
      toolCount: definitions.length,
      inMemoryDigest,
      jsonWireDigest,
      expectedDigest: ROVE_TOOL_DEFINITIONS_SHA256,
    },
    null,
    2,
  )}\n`,
);
if (status !== "pass") process.exitCode = 1;
