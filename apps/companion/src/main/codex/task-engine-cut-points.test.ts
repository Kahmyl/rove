import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  launchIntent,
  ProcessProductHarness,
  type ProductValue,
  task,
  taskId,
} from "./task-engine-process-harness.test-support.js";

const representatives = [
  { class: "repeatable_read", command: "read_codex_thread" },
  { class: "correlated_write", command: "start_or_steer_codex_turn" },
  { class: "uncertain_write", command: "lookup_or_start_runtime" },
] as const;

const cuts = [
  "before_event_commit",
  "after_commit_before_claim",
  "after_claim_before_dispatch",
  "after_external_acceptance_before_outcome",
  "after_terminal_change_before_observation",
  "after_outcome_commit_before_notification",
  "during_component_generation_replacement",
] as const;

const preCommandCuts = new Set([
  "before_event_commit",
  "after_commit_before_claim",
]);

function operationId(representative: number, cut: number, suffix = 0): string {
  const value = `${representative + 1}${cut + 1}${suffix + 1}`.padStart(8, "0");
  return `intent_${value}-1234-4123-8123-${value.padStart(12, "0")}`;
}

function lifecycle(value: ProductValue): ProductValue {
  return value.lifecycle as ProductValue;
}

function attention(value: ProductValue): ProductValue[] {
  return (value.attention as ProductValue[]) ?? [];
}

function consequentialCounts(actions: ProductValue) {
  const appServer = (actions.appServer as ProductValue[]).filter((action) =>
    [
      "thread/start",
      "turn/start",
      "turn/steer",
      "turn/interrupt",
      "thread/archive",
      "thread/unarchive",
    ].includes(String(action.method)),
  );
  return {
    appServer: appServer.reduce<Record<string, number>>((counts, action) => {
      const key = `${String(action.method)}:${String(action.correlation)}`;
      counts[key] = (counts[key] ?? 0) + 1;
      return counts;
    }, {}),
    runtime: (actions.runtime as ProductValue[]).reduce<Record<string, number>>(
      (counts, action) => {
        const key = `${String(action.method)}:${String(action.correlation)}`;
        counts[key] = (counts[key] ?? 0) + 1;
        return counts;
      },
      {},
    ),
  };
}

describe("21 real process stop/restart interruption cases", () => {
  it("rejects command filters for pre-command cuts before starting a process", () => {
    for (const cutPoint of preCommandCuts)
      expect(
        () =>
          new ProcessProductHarness("unused", {
            cutPoint,
            cutCommand: "read_codex_thread",
          }),
      ).toThrow(
        `Cut point ${cutPoint} occurs before Task Engine command creation and cannot use a cutCommand filter.`,
      );

    expect(
      () =>
        new ProcessProductHarness("unused", {
          cutPoint: "after_claim_before_dispatch",
          cutCommand: "read_codex_thread",
        }),
    ).not.toThrow();
  });

  for (const [
    representativeIndex,
    representative,
  ] of representatives.entries()) {
    for (const [cutIndex, cut] of cuts.entries()) {
      it(`${representative.class}: ${cut}`, async () => {
        const home = await mkdtemp(join(tmpdir(), "rove-real-cut-"));
        const id = operationId(representativeIndex, cutIndex);
        const expectedTaskId = taskId(id);
        let current = new ProcessProductHarness(home, {
          ...(cut === "during_component_generation_replacement"
            ? {}
            : {
                cutPoint: cut,
                ...(preCommandCuts.has(cut)
                  ? {}
                  : { cutCommand: representative.command }),
              }),
        });
        try {
          await current.start();
          const workspace = await current.request({
            type: "workspace.create",
            displayName: `${representative.class}-${cut}`,
          });
          const workspaceId = String(
            (workspace.workspace as ProductValue | undefined)?.id ??
              workspace.id,
          );
          const launch = launchIntent(id, {
            browserIdentity: { mode: "workspace", workspaceId },
          });

          if (cut === "during_component_generation_replacement") {
            await current.request(launch);
            await current.until(
              (snapshot) =>
                task(snapshot, expectedTaskId).bootstrapStage === "complete",
            );
            // Component replacement is its own cut, not an accidental
            // interruption of the still-asynchronous initial dispatch.
            await current.untilResult(
              { type: "external.actions" },
              (actions) =>
                (actions.appServer as ProductValue[]).some(
                  (action) =>
                    action.method === "turn/start" && action.correlation === id,
                ) &&
                (actions.runtime as ProductValue[]).some(
                  (action) => action.method === "startSession",
                ),
            );
            if (representative.class === "uncertain_write")
              await current
                .request({ type: "runtime.kill.now" })
                .catch(() => ({}));
            else
              await current
                .request({ type: "appserver.kill.now" })
                .catch(() => ({}));
          } else {
            void current.request(launch).catch(() => ({}));
            const reached = await current.waitForCut();
            expect(reached.point).toBe(cut);
            if (
              !["before_event_commit", "after_commit_before_claim"].includes(
                cut,
              )
            )
              expect(reached.commandType).toBe(representative.command);
          }

          await current.stopAllHard();
          current = new ProcessProductHarness(home);
          await current.start();
          if (cut === "before_event_commit") await current.request(launch);
          const recovered = await current.until((snapshot) => {
            try {
              return ["ready", "failed"].includes(
                String(lifecycle(task(snapshot, expectedTaskId)).phase),
              );
            } catch {
              return false;
            }
          });
          expect(lifecycle(task(recovered, expectedTaskId)).phase).toBe(
            "ready",
          );

          const afterRecovery = await current.untilResult(
            { type: "external.actions" },
            (actions) =>
              (actions.appServer as ProductValue[]).some(
                (action) =>
                  action.method === "turn/start" && action.correlation === id,
              ) &&
              (actions.runtime as ProductValue[]).some(
                (action) => action.method === "startSession",
              ),
          );
          const appServerActions = afterRecovery.appServer as ProductValue[];
          const runtimeActions = afterRecovery.runtime as ProductValue[];
          expect(
            appServerActions.filter(
              (action) =>
                action.method === "turn/start" && action.correlation === id,
            ),
            JSON.stringify({ recovered, afterRecovery }, null, 2),
          ).toHaveLength(1);
          expect(
            runtimeActions.filter((action) => action.method === "startSession"),
          ).toHaveLength(1);
          if (representative.class === "repeatable_read")
            expect(
              appServerActions.filter(
                (action) => action.method === "thread/read",
              ).length,
            ).toBeGreaterThan(0);

          await current.request({
            type: "handoff.prepare",
            taskId: expectedTaskId,
          });
          const handedOff = await current.until((snapshot) =>
            attention(snapshot).some(
              (request) =>
                request.taskId === expectedTaskId &&
                request.kind === "control_handoff" &&
                request.status === "pending",
            ),
          );
          expect(attention(handedOff).length).toBeGreaterThan(0);

          await current.stopAllHard();
          current = new ProcessProductHarness(home);
          await current.start();
          const retained = await current.until((snapshot) =>
            attention(snapshot).some(
              (request) =>
                request.taskId === expectedTaskId &&
                request.kind === "control_handoff" &&
                request.status === "pending",
            ),
          );
          expect(attention(retained).length).toBeGreaterThan(0);

          await current.request({
            type: "task.finish",
            taskId: expectedTaskId,
            operationId: operationId(representativeIndex, cutIndex, 1),
          });
          await current.until(
            (snapshot) =>
              lifecycle(task(snapshot, expectedTaskId)).phase === "closed",
          );
          const beforeClosedRestart = consequentialCounts(
            await current.untilResult(
              { type: "external.actions" },
              (actions) =>
                (actions.appServer as ProductValue[]).some(
                  (action) => action.method === "thread/archive",
                ) &&
                (actions.runtime as ProductValue[]).some(
                  (action) => action.method === "endSession",
                ),
            ),
          );
          await current.stopAllHard();
          current = new ProcessProductHarness(home);
          await current.start();
          const closed = await current.until(
            (snapshot) =>
              lifecycle(task(snapshot, expectedTaskId)).phase === "closed",
          );
          expect(task(closed, expectedTaskId).availableActions).not.toContain(
            "message",
          );
          const afterClosedRestart = consequentialCounts(
            await current.request({ type: "external.actions" }),
          );
          expect(afterClosedRestart).toEqual(beforeClosedRestart);
        } finally {
          await current.stop().catch(() => undefined);
          await rm(home, { recursive: true, force: true });
        }
      }, 240_000);
    }
  }
});

export const REAL_INTERRUPTION_CASE_COUNT =
  representatives.length * cuts.length;
