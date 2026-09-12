import {
  access,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { importLegacyTaskState } from "./legacy-task-import.js";
import { SqliteTaskStore } from "./sqlite-task-store.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("legacy lifecycle state import", () => {
  it("atomically converts an active task, bindings, continuation, and attention", async () => {
    const stateDirectory = await mkdtemp(join(tmpdir(), "rove-import-active-"));
    directories.push(stateDirectory);
    const taskId = "task_aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
    const sessionId = `ses_${"a".repeat(32)}`;
    const threadId = "thread_active";
    const turnId = "turn_active";
    const handoffId = `handoff_${"b".repeat(32)}`;
    const bootstrapId = `boot_${"a".repeat(32)}`;
    const continuation = {
      roveTaskId: taskId,
      codexThreadId: threadId,
      originatingCodexTurnId: turnId,
      roveSessionId: sessionId,
      handoffId,
      handoffGeneration: 2,
      requestedInstruction: "Inspect and continue.",
      continuationPolicy: "resume_after_control_return",
      status: "pending",
      freshInspectionRequired: true,
      preHandoffObservationSeq: 4,
    };
    const continuationKey = `handoff:${createHash("sha256")
      .update(JSON.stringify([taskId, threadId, turnId, sessionId, handoffId]))
      .digest("hex")}`;
    await writeFile(
      join(stateDirectory, "codex-task-contexts.v2.json"),
      JSON.stringify({
        schemaVersion: 6,
        revision: 3,
        value: {
          contexts: {
            [taskId]: {
              roveTaskId: taskId,
              executionMode: "agent",
              browserIdentity: { mode: "temporary" },
              selectionSource: "user_selected",
              selectedAt: "2026-09-09T10:00:00.000Z",
              policy: {
                cwd: "/work",
                approvalPolicy: "on-request",
                approvalsReviewer: "user",
                sandbox: "workspace-write",
              },
              bootstrap: {
                attemptId: bootstrapId,
                threadSource: `rove:${taskId}:${bootstrapId}`,
                stage: "complete",
              },
              roveSessionId: sessionId,
              codexThreadId: threadId,
              codexSessionId: "codex_session_active",
              capabilityFingerprint: "a".repeat(64),
              lifecycle: { schemaVersion: 1, desiredState: "open" },
            },
          },
        },
      }),
    );
    await writeFile(
      join(stateDirectory, "codex-continuations.v2.json"),
      JSON.stringify({
        schemaVersion: 2,
        revision: 2,
        value: {
          records: { [continuationKey]: continuation },
          returnEventFingerprints: {},
        },
      }),
    );
    await writeFile(
      join(stateDirectory, "codex-attention.v1.json"),
      JSON.stringify({
        schemaVersion: 1,
        revision: 1,
        value: {
          sequence: 1,
          entries: [
            {
              authority: "rove_control",
              kind: "control_handoff",
              requestId: `control:${sessionId}:${handoffId}`,
              taskId,
              threadId,
              turnId,
              generation: 2,
              payload: { handoffId },
              status: "pending",
              sequence: 1,
            },
          ],
        },
      }),
    );
    const store = new SqliteTaskStore({
      path: join(stateDirectory, "task-process.v1.sqlite3"),
    });
    await expect(
      importLegacyTaskState({ stateDirectory, store }),
    ).resolves.toMatchObject({ imported: true });
    await expect(store.taskState(taskId)).resolves.toMatchObject({
      taskId,
      launchConfiguration: { roveTaskId: taskId },
      durableData: {
        schemaVersion: 1,
        continuation: {
          schemaVersion: 1,
          roveTaskId: taskId,
          handoffId,
        },
        attentions: [
          {
            schemaVersion: 1,
            taskId,
            requestId: `control:${sessionId}:${handoffId}`,
          },
        ],
        codexSessionId: "codex_session_active",
      },
    });
    await store.close();
  });

  it("backs up validated sources read-only and records an idempotent digest", async () => {
    const stateDirectory = await mkdtemp(join(tmpdir(), "rove-import-"));
    directories.push(stateDirectory);
    const original = `${JSON.stringify({
      schemaVersion: 6,
      revision: 9,
      value: { contexts: {} },
    })}\n`;
    const source = join(stateDirectory, "codex-task-contexts.v2.json");
    await writeFile(source, original, { mode: 0o600 });
    const store = new SqliteTaskStore({
      path: join(stateDirectory, "task-process.v1.sqlite3"),
    });

    const first = await importLegacyTaskState({
      stateDirectory,
      store,
      now: () => new Date("2026-09-09T13:14:15.000Z"),
    });
    expect(first.imported).toBe(true);
    const backup = join(first.backupPath!, "codex-task-contexts.v2.json");
    expect(await readFile(backup, "utf8")).toBe(original);
    expect((await stat(backup)).mode & 0o777).toBe(0o400);
    await expect(access(source, constants.R_OK)).resolves.toBeUndefined();

    await writeFile(source, "{ malformed after successful migration", {
      mode: 0o600,
    });
    const second = await importLegacyTaskState({ stateDirectory, store });
    expect(second).toEqual({ imported: false });
    await store.close();
  });

  it("does not create a backup or database import for invalid state", async () => {
    const stateDirectory = await mkdtemp(join(tmpdir(), "rove-import-"));
    directories.push(stateDirectory);
    await writeFile(
      join(stateDirectory, "codex-attention.v1.json"),
      JSON.stringify({ schemaVersion: 1, revision: -1, value: {} }),
    );
    const store = new SqliteTaskStore({
      path: join(stateDirectory, "task-process.v1.sqlite3"),
    });
    await expect(
      importLegacyTaskState({ stateDirectory, store }),
    ).rejects.toThrow("invalid envelope");
    await expect(
      access(join(stateDirectory, "task-process-backups")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(store.states()).resolves.toEqual([]);
    await store.close();
  });
});
