import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { NATIVE_LIFECYCLE_COMMAND_TYPES } from "@rove/protocol";

import {
  PRODUCTION_LIFECYCLE_AUTHORITY,
  createProductionLifecycleRepositories,
  requiresRuntimeGenerationReconciliation,
} from "./execution-core.js";
import { MemoryStateRepository } from "./persistence.js";
import { PRODUCTION_LIFECYCLE_COMMAND_CLASS } from "./task-coordinator.js";

describe("production lifecycle authority architecture", () => {
  it("composes SQLite and live observations without lifecycle JSON repositories", async () => {
    expect(PRODUCTION_LIFECYCLE_AUTHORITY).toEqual({
      task: "sqlite",
      binding: "sqlite+live-observation",
      continuation: "sqlite+runtime-observation",
      attention: "sqlite+live-observation",
      projection: "sqlite",
      command: "sqlite",
    });
    const source = await readFile(
      fileURLToPath(new URL("./execution-core.ts", import.meta.url)),
      "utf8",
    );
    for (const forbidden of [
      "codex-task-contexts.v2.json",
      "codex-continuations.v2.json",
      "codex-attention.v1.json",
      "codex-conversations.v2.json",
    ])
      expect(source).not.toContain(forbidden);
    expect(
      Object.values(createProductionLifecycleRepositories()).every(
        (repository) => repository instanceof MemoryStateRepository,
      ),
    ).toBe(true);
  });

  it("classifies every native command in the exhaustive production executor", () => {
    expect(Object.keys(PRODUCTION_LIFECYCLE_COMMAND_CLASS).sort()).toEqual(
      [...NATIVE_LIFECYCLE_COMMAND_TYPES].sort(),
    );
    expect(NATIVE_LIFECYCLE_COMMAND_TYPES).toHaveLength(31);
  });

  it("reconciles Runtime generations from resource truth rather than Task termination", () => {
    expect(
      requiresRuntimeGenerationReconciliation({
        sessionId: "ses_active",
        status: "active",
        attachment: "attached",
        recovery: "not_needed",
      }),
    ).toBe(true);
    expect(
      requiresRuntimeGenerationReconciliation({
        sessionId: "ses_cleanup",
        status: "failed",
        attachment: "missing",
        recovery: "cleanup_required",
      }),
    ).toBe(true);
    expect(
      requiresRuntimeGenerationReconciliation({
        sessionId: "ses_settled",
        status: "completed",
        attachment: "missing",
        recovery: "not_needed",
      }),
    ).toBe(false);
    expect(
      requiresRuntimeGenerationReconciliation({
        status: "missing",
        attachment: "missing",
        recovery: "not_needed",
      }),
    ).toBe(false);
  });
});
