import { describe, expect, it, vi } from "vitest";

import {
  DurableContinuationStore,
  type ContinuationState,
  type PendingContinuation,
} from "./continuations.js";
import { MemoryStateRepository } from "./persistence.js";
import type { CodexRpcPort, CodexThread } from "./protocol.js";

const observed: PendingContinuation = {
  roveTaskId: "task_replay",
  codexThreadId: "thread_replay",
  originatingCodexTurnId: "turn_origin",
  roveSessionId: "ses_replay",
  handoffId: "handoff_replay",
  handoffGeneration: 8,
  requestedInstruction: "Continue from the returned page.",
  continuationPolicy: "resume_after_control_return",
  status: "pending",
  freshInspectionRequired: true,
  preHandoffObservationSeq: 20,
};

function thread(
  turns: CodexThread["turns"] = [],
  status: CodexThread["status"] = { type: "idle" },
): CodexThread {
  return {
    id: "thread_replay",
    extra: null,
    sessionId: "codex_replay",
    forkedFromId: null,
    parentThreadId: null,
    preview: "",
    ephemeral: false,
    section: null,
    sectionEnteredAt: null,
    projectId: null,
    historyMode: "paginated",
    modelProvider: "openai",
    model: null,
    reasoningEffort: null,
    createdAt: 1,
    updatedAt: 1,
    recencyAt: 1,
    cwd: "/work",
    cliVersion: "0.153.4",
    status,
    path: null,
    source: "appServer",
    canAcceptDirectInput: true,
    turns,
    threadSource: null,
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name: null,
  };
}

describe("immutable observed-handoff replay matrix", () => {
  it("persists fresh inspection independently before binding a return event", async () => {
    const repository = new MemoryStateRepository<ContinuationState>();
    const store = new DurableContinuationStore(repository);
    await store.register(observed);
    const proof = {
      inspectionId: "inspect:ses_replay:8:21",
      sessionId: "ses_replay",
      handoffId: "handoff_replay",
      generation: 8,
      afterObservationSeq: 21,
    };
    const operationId = "intent_11111111-1111-4111-8111-111111111111";
    await store.recordReturnControlIntent(observed, operationId);
    await store.recordReturnControlIntent(observed, operationId);
    await store.recordFreshInspection(observed, proof);
    await store.recordFreshInspection(observed, proof);
    expect(await store.pending()).toEqual([
      expect.objectContaining({
        freshInspectionRequired: false,
        returnControlOperationId: operationId,
        freshInspection: proof,
      }),
    ]);
    await expect(
      store.recordFreshInspection(observed, {
        ...proof,
        afterObservationSeq: 22,
      }),
    ).rejects.toThrow(/collision/);
    await expect(
      store.recordReturnControlIntent(
        observed,
        "intent_22222222-2222-4222-8222-222222222222",
      ),
    ).rejects.toThrow(/collision/);
  });

  for (const lifecycle of [
    "pending",
    "dispatch_recorded",
    "consumed",
    "cancelled",
    "superseded",
  ] as const) {
    it(`treats exact replay as a no-op after ${lifecycle}`, async () => {
      const store = new DurableContinuationStore(new MemoryStateRepository());
      expect(await store.register(observed)).toBe(true);
      const rpc = {
        request: vi.fn(async () => ({ turn: { id: "turn_continue" } })),
      } as unknown as CodexRpcPort;
      if (lifecycle === "cancelled" || lifecycle === "superseded")
        await store.cancel(observed, lifecycle);
      if (lifecycle === "dispatch_recorded" || lifecycle === "consumed") {
        await store.dispatchReturn(
          {
            ...observed,
            eventId: "runtime:return:ses_replay:handoff_replay",
            observationSeq: 21,
          },
          thread(),
          true,
          rpc,
        );
      }
      if (lifecycle === "consumed") {
        const commandId = (await store.pending())[0]!.continuationCommand!
          .commandId;
        await store.reconcile(
          observed,
          thread([
            {
              id: "turn_continue",
              status: "completed",
              error: null,
              startedAt: 1,
              completedAt: 2,
              durationMs: 1,
              itemsView: "full",
              items: [
                {
                  type: "userMessage",
                  id: "item_continue",
                  content: [
                    { type: "text", text: "Continue", text_elements: [] },
                  ],
                  clientId: commandId,
                },
              ],
            },
          ]),
        );
      }
      expect(await store.observationStatus(observed)).toBe("known");
      expect(await store.register(observed)).toBe(false);
      await expect(
        store.register({ ...observed, requestedInstruction: "Changed" }),
      ).rejects.toThrow(/identity collision/);
    });
  }

  it("keeps the explicit legacy generation-only migration path readable", async () => {
    const store = new DurableContinuationStore(new MemoryStateRepository());
    const legacy = { ...observed };
    delete legacy.handoffId;
    expect(await store.register(legacy)).toBe(true);
    expect(await store.register(legacy)).toBe(false);
    await expect(store.validate()).resolves.toBeUndefined();
  });

  it("migrates the pre-fingerprint handoff record on restore", async () => {
    const repository = new MemoryStateRepository<ContinuationState>();
    const writer = new DurableContinuationStore(repository);
    await writer.register(observed);
    const snapshot = await repository.read();
    const records = structuredClone(snapshot!.value.records);
    delete Object.values(records)[0]!.observationFingerprint;
    await repository.write(snapshot!.revision, {
      ...snapshot!.value,
      records,
    });
    const restored = new DurableContinuationStore(repository);
    await expect(restored.validate()).resolves.toBeUndefined();
    expect((await restored.pending())[0]!.observationFingerprint).toMatch(
      /^[a-f0-9]{64}$/,
    );
  });
});
