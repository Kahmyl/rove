import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { FileEffectJournalStore } from "./filesystem-effect-journal.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

async function store() {
  const root = await mkdtemp(join(tmpdir(), "rove-effect-journal-test-"));
  roots.push(root);
  return new FileEffectJournalStore(root);
}

describe("FileEffectJournalStore", () => {
  it("persists a concrete task-result plan across restart before dispatch", async () => {
    const root = await mkdtemp(join(tmpdir(), "rove-effect-plan-test-"));
    roots.push(root);
    const journal = new FileEffectJournalStore(root);
    const consequenceKey = `task-result:result_plan:${"d".repeat(64)}`;
    const actionFingerprint = "e".repeat(64);
    const planBase = {
      schemaVersion: 1 as const,
      planId: `plan_${"a".repeat(32)}`,
      consequenceKey,
      materialDigest: "d".repeat(64),
      taskScope: "task-plan",
      browserWorkspaceScope: "workspace-plan",
      observationId: "obs-plan",
      pageId: "page-plan",
      pageRevision: 3,
      url: "https://example.test/compose",
      fields: [],
      attachments: [],
      commitAction: {
        kind: "click" as const,
        target: { pageId: "page-plan", revision: 3, ref: "send" },
      },
      expectedEffects: [{ kind: "url_changed" as const }],
      effect: "external_commit" as const,
      actionFingerprint,
      preparedAt: "2026-09-13T12:00:00.000Z",
    };
    const plan = {
      ...planBase,
      planDigest: createHash("sha256")
        .update(JSON.stringify(planBase))
        .digest("hex"),
    };
    const planned = await journal.prepare({
      taskScope: plan.taskScope,
      browserWorkspaceScope: plan.browserWorkspaceScope,
      consequenceKey,
      actionFingerprint,
      taskResultPlan: plan,
      state: "planned",
      ownershipGeneration: 1,
      cutoverEpoch: "cutover",
      preparedAt: plan.preparedAt,
      updatedAt: plan.preparedAt,
    });

    const recovered = await new FileEffectJournalStore(root).findById(
      planned.effectId,
    );
    expect(recovered).toMatchObject({
      state: "planned",
      taskResultPlan: { planId: plan.planId, actionFingerprint },
    });
    await expect(
      new FileEffectJournalStore(root).findPotentialConflicts(
        plan.browserWorkspaceScope,
      ),
    ).resolves.toEqual([]);
  });

  it("replaces a concrete plan only before the dispatch boundary", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "rove-effect-plan-replace-test-"),
    );
    roots.push(root);
    const journal = new FileEffectJournalStore(root);
    const consequenceKey = `task-result:result_replace:${"d".repeat(64)}`;
    const makePlan = (planId: string, actionFingerprint: string) => {
      const planBase = {
        schemaVersion: 1 as const,
        planId,
        consequenceKey,
        materialDigest: "d".repeat(64),
        taskScope: "task-plan-replace",
        browserWorkspaceScope: "workspace-plan-replace",
        observationId: "obs-plan-replace",
        pageId: "page-plan-replace",
        pageRevision: 3,
        url: "https://example.test/compose",
        fields: [],
        attachments: [],
        commitAction: {
          kind: "click" as const,
          target: { pageId: "page-plan-replace", revision: 3, ref: "send" },
        },
        expectedEffects: [{ kind: "url_changed" as const }],
        effect: "external_commit" as const,
        actionFingerprint,
        preparedAt: "2026-09-13T12:00:00.000Z",
      };
      return {
        ...planBase,
        planDigest: createHash("sha256")
          .update(JSON.stringify(planBase))
          .digest("hex"),
      };
    };
    const firstPlan = makePlan(`plan_${"a".repeat(32)}`, "a".repeat(64));
    let record = await journal.prepare({
      taskScope: firstPlan.taskScope,
      browserWorkspaceScope: firstPlan.browserWorkspaceScope,
      consequenceKey,
      actionFingerprint: firstPlan.actionFingerprint,
      taskResultPlan: firstPlan,
      state: "planned",
      ownershipGeneration: 1,
      cutoverEpoch: "cutover",
      preparedAt: firstPlan.preparedAt,
      updatedAt: firstPlan.preparedAt,
    });
    record = await journal.update(record.effectId, record.version, {
      state: "authorized",
      updatedAt: "2026-09-13T12:00:01.000Z",
    });

    const replacementPlan = makePlan(`plan_${"b".repeat(32)}`, "b".repeat(64));
    record = await journal.update(record.effectId, record.version, {
      state: "planned",
      updatedAt: "2026-09-13T12:00:02.000Z",
      actionFingerprint: replacementPlan.actionFingerprint,
      taskResultPlan: replacementPlan,
    });
    await expect(
      new FileEffectJournalStore(root).findById(record.effectId),
    ).resolves.toMatchObject({
      state: "planned",
      actionFingerprint: replacementPlan.actionFingerprint,
      taskResultPlan: { planId: replacementPlan.planId },
    });

    record = await journal.update(record.effectId, record.version, {
      state: "authorized",
      updatedAt: "2026-09-13T12:00:03.000Z",
    });
    record = await journal.update(record.effectId, record.version, {
      state: "prepared",
      updatedAt: "2026-09-13T12:00:04.000Z",
    });
    const latePlan = makePlan(
      `plan_${"c".repeat(32)}`,
      record.actionFingerprint,
    );
    await expect(
      journal.update(record.effectId, record.version, {
        state: "applied",
        updatedAt: "2026-09-13T12:00:05.000Z",
        actionFingerprint: latePlan.actionFingerprint,
        taskResultPlan: latePlan,
      }),
    ).rejects.toThrow("identity transition is invalid");
    await expect(
      journal.update(record.effectId, record.version, {
        state: "applied",
        updatedAt: "2026-09-13T12:00:05.000Z",
        taskResultPlan: undefined,
      }),
    ).rejects.toThrow("identity transition is invalid");
    await expect(journal.findById(record.effectId)).resolves.toEqual(record);
  });

  it("keeps registered authorization distinct from possible dispatch", async () => {
    const journal = await store();
    const authorized = await journal.prepare({
      taskScope: "boot_authorized",
      browserWorkspaceScope: "wrk_authorized",
      consequenceKey: "task-result:result_1:digest",
      actionFingerprint: "f".repeat(64),
      state: "authorized",
      ownershipGeneration: 1,
      cutoverEpoch: "cutover_1",
      preparedAt: "2026-09-13T12:00:00.000Z",
      updatedAt: "2026-09-13T12:00:00.000Z",
    });
    expect(await journal.findPotentialConflicts("wrk_authorized")).toEqual([]);
    const prepared = await journal.update(authorized.effectId, 1, {
      state: "prepared",
      updatedAt: "2026-09-13T12:00:01.000Z",
      observationId: "obs_dispatch_boundary",
    });
    expect(prepared.state).toBe("prepared");
    expect(await journal.findPotentialConflicts("wrk_authorized")).toEqual([
      prepared,
    ]);
  });

  it("creates prepared state exclusively and persists a versioned result", async () => {
    const journal = await store();
    const input = {
      taskScope: "boot_1",
      browserWorkspaceScope: "wrk_1",
      consequenceKey: "create_issue_1",
      actionFingerprint: "a".repeat(64),
      state: "prepared" as const,
      ownershipGeneration: 3,
      cutoverEpoch: "cutover_1",
      preparedAt: "2026-09-09T12:00:00.000Z",
      updatedAt: "2026-09-09T12:00:00.000Z",
    };
    const prepared = await journal.prepare(input);
    expect((await journal.prepare(input)).effectId).toBe(prepared.effectId);
    const applied = await journal.update(prepared.effectId, 1, {
      state: "applied",
      updatedAt: "2026-09-09T12:00:01.000Z",
      observationId: "obs_1",
    });
    expect(applied).toMatchObject({ version: 2, state: "applied" });
    await expect(
      journal.update(prepared.effectId, 1, {
        state: "unresolved",
        updatedAt: "2026-09-09T12:00:02.000Z",
      }),
    ).rejects.toThrow("version conflict");
    await expect(
      journal.update(applied.effectId, applied.version, {
        state: "prepared",
        updatedAt: "2026-09-09T12:00:03.000Z",
      }),
    ).rejects.toThrow("transition is invalid");
  });

  it("allows only one writer to advance an expected record version", async () => {
    const journal = await store();
    const prepared = await journal.prepare({
      taskScope: "task-concurrent",
      browserWorkspaceScope: "workspace-concurrent",
      consequenceKey: "operation-concurrent",
      actionFingerprint: "c".repeat(64),
      state: "prepared",
      ownershipGeneration: 1,
      cutoverEpoch: "cutover",
      preparedAt: "2026-09-09T12:00:00.000Z",
      updatedAt: "2026-09-09T12:00:00.000Z",
    });
    const updates = await Promise.allSettled([
      journal.update(prepared.effectId, 1, {
        state: "applied",
        updatedAt: "2026-09-09T12:00:01.000Z",
      }),
      journal.update(prepared.effectId, 1, {
        state: "unresolved",
        updatedAt: "2026-09-09T12:00:01.000Z",
      }),
    ]);
    expect(
      updates.filter((entry) => entry.status === "fulfilled"),
    ).toHaveLength(1);
    expect(updates.filter((entry) => entry.status === "rejected")).toHaveLength(
      1,
    );
  });

  it("ignores an interrupted writer temporary file and has no persistent lock", async () => {
    const root = await mkdtemp(join(tmpdir(), "rove-effect-journal-crash-"));
    roots.push(root);
    const journal = new FileEffectJournalStore(root);
    const prepared = await journal.prepare({
      taskScope: "task-crash",
      browserWorkspaceScope: "workspace-crash",
      consequenceKey: "operation-crash",
      actionFingerprint: "e".repeat(64),
      state: "prepared",
      ownershipGeneration: 1,
      cutoverEpoch: "cutover",
      preparedAt: "2026-09-09T12:00:00.000Z",
      updatedAt: "2026-09-09T12:00:00.000Z",
    });
    const recordDirectory = join(
      root,
      "effect-journal",
      "records",
      prepared.effectId,
    );
    await writeFile(join(recordDirectory, ".v2.json.crashed.tmp"), "{partial");

    const applied = await journal.update(prepared.effectId, prepared.version, {
      state: "applied",
      updatedAt: "2026-09-09T12:00:01.000Z",
    });

    expect(applied.version).toBe(2);
    expect(
      await journal.find("task-crash", "workspace-crash", "operation-crash"),
    ).toMatchObject({ version: 2, state: "applied" });
    expect(
      (await readdir(recordDirectory)).filter((name) => name.endsWith(".lock")),
    ).toEqual([]);
  });

  it("binds an explicit not-applied retry to the new ownership generation", async () => {
    const journal = await store();
    let record = await journal.prepare({
      taskScope: "task-retry",
      browserWorkspaceScope: "workspace-retry",
      consequenceKey: "operation-retry",
      actionFingerprint: "d".repeat(64),
      state: "prepared",
      ownershipGeneration: 1,
      cutoverEpoch: "cutover",
      preparedAt: "2026-09-09T12:00:00.000Z",
      updatedAt: "2026-09-09T12:00:00.000Z",
    });
    record = await journal.update(record.effectId, record.version, {
      state: "not_applied",
      updatedAt: "2026-09-09T12:00:01.000Z",
    });
    record = await journal.update(record.effectId, record.version, {
      state: "prepared",
      updatedAt: "2026-09-09T12:00:02.000Z",
      ownershipGeneration: 2,
    });
    expect(record.ownershipGeneration).toBe(2);
  });

  it("finds workspace uncertainty across task, origin metadata, and store replacement", async () => {
    const root = await mkdtemp(join(tmpdir(), "rove-effect-scope-"));
    roots.push(root);
    const first = new FileEffectJournalStore(root);
    const uncertaintyDomain = "f".repeat(64);
    const prepared = await first.prepare({
      taskScope: "task-a",
      browserWorkspaceScope: "workspace-scope",
      consequenceKey: "caller-key-a",
      actionFingerprint: "a".repeat(64),
      uncertaintyDomain,
      state: "prepared",
      ownershipGeneration: 1,
      cutoverEpoch: "cutover",
      preparedAt: "2026-09-09T12:00:00.000Z",
      updatedAt: "2026-09-09T12:00:00.000Z",
    });
    await first.update(prepared.effectId, prepared.version, {
      state: "unresolved",
      updatedAt: "2026-09-09T12:00:01.000Z",
    });
    const otherOrigin = await first.prepare({
      taskScope: "task-b",
      browserWorkspaceScope: "workspace-scope",
      consequenceKey: "caller-key-b",
      actionFingerprint: "b".repeat(64),
      uncertaintyDomain: "e".repeat(64),
      state: "prepared",
      ownershipGeneration: 2,
      cutoverEpoch: "cutover",
      preparedAt: "2026-09-09T12:00:02.000Z",
      updatedAt: "2026-09-09T12:00:02.000Z",
    });

    const replacement = new FileEffectJournalStore(root);
    expect(await replacement.findPotentialConflicts("workspace-scope")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskScope: "task-a",
          consequenceKey: "caller-key-a",
          state: "unresolved",
          uncertaintyDomain,
        }),
        expect.objectContaining({
          effectId: otherOrigin.effectId,
          taskScope: "task-b",
          state: "prepared",
          uncertaintyDomain: "e".repeat(64),
        }),
      ]),
    );
  });

  it("keeps unversioned, V1, and V2 development records conservatively conflicting", async () => {
    const journal = await store();
    const records = await Promise.all(
      ([undefined, 1, 2] as const).map(async (identityVersion, index) => {
        const prepared = await journal.prepare({
          taskScope: `task-legacy-${index}`,
          browserWorkspaceScope: "workspace-legacy-operation",
          consequenceKey: `legacy-key-${index}`,
          actionFingerprint: `${index + 1}`.repeat(64),
          ...(identityVersion === undefined
            ? {}
            : {
                affectedOperationFingerprint: "b".repeat(64),
                affectedOperationIdentityVersion: identityVersion,
              }),
          state: "prepared",
          ownershipGeneration: 1,
          cutoverEpoch: "cutover",
          preparedAt: "2026-09-09T12:00:00.000Z",
          updatedAt: "2026-09-09T12:00:00.000Z",
        });
        return journal.update(prepared.effectId, prepared.version, {
          state: "unresolved",
          updatedAt: "2026-09-09T12:00:01.000Z",
        });
      }),
    );

    await expect(
      journal.findPotentialConflicts("workspace-legacy-operation"),
    ).resolves.toEqual(expect.arrayContaining(records));
    await expect(
      journal.findPotentialConflicts("unrelated-workspace"),
    ).resolves.toEqual([]);
  });

  it("durably grants and consumes one trusted repetition without changing the unknown outcome", async () => {
    const journal = await store();
    let record = await journal.prepare({
      taskScope: "task-repeat",
      browserWorkspaceScope: "workspace-repeat",
      consequenceKey: "caller-key-a",
      actionFingerprint: "a".repeat(64),
      uncertaintyDomain: "b".repeat(64),
      state: "prepared",
      ownershipGeneration: 1,
      cutoverEpoch: "cutover",
      preparedAt: "2026-09-09T12:00:00.000Z",
      updatedAt: "2026-09-09T12:00:00.000Z",
    });
    record = await journal.update(record.effectId, record.version, {
      state: "unresolved",
      updatedAt: "2026-09-09T12:00:01.000Z",
    });
    record = await journal.authorizeRepeat(
      record.effectId,
      "effect_repeat_12345678-1234-4123-8123-123456789abc",
      "2026-09-09T12:00:02.000Z",
    );
    const attempts = await Promise.allSettled([
      journal.consumeRepeatAuthorization(
        record.effectId,
        record.version,
        "effect_attempt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        "2026-09-09T12:00:03.000Z",
      ),
      journal.consumeRepeatAuthorization(
        record.effectId,
        record.version,
        "effect_attempt_cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        "2026-09-09T12:00:03.000Z",
      ),
    ]);
    expect(
      attempts.filter((entry) => entry.status === "fulfilled"),
    ).toHaveLength(1);
    record = (await journal.findById(record.effectId))!;
    expect(record).toMatchObject({
      state: "unresolved",
      repeatAuthorization: {
        authorizationId: "effect_repeat_12345678-1234-4123-8123-123456789abc",
        consumedByAttemptId: expect.stringMatching(/^effect_attempt_/),
      },
    });
    const authorizedAttempt = await journal.prepare({
      taskScope: record.taskScope,
      browserWorkspaceScope: record.browserWorkspaceScope,
      consequenceKey: record.consequenceKey,
      actionFingerprint: record.actionFingerprint,
      attemptId: record.repeatAuthorization!.consumedByAttemptId!,
      state: "prepared",
      ownershipGeneration: 2,
      cutoverEpoch: "cutover",
      preparedAt: "2026-09-09T12:00:03.000Z",
      updatedAt: "2026-09-09T12:00:03.000Z",
    });
    expect(authorizedAttempt.effectId).not.toBe(record.effectId);
    expect(authorizedAttempt.attemptId).toBe(
      record.repeatAuthorization!.consumedByAttemptId,
    );
    await expect(
      journal.consumeRepeatAuthorization(
        record.effectId,
        record.version,
        "effect_attempt_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        "2026-09-09T12:00:04.000Z",
      ),
    ).rejects.toThrow("already consumed");
    await expect(
      journal.authorizeRepeat(
        record.effectId,
        "effect_repeat_12345678-1234-4123-8123-123456789abc",
        "2026-09-09T12:00:05.000Z",
      ),
    ).resolves.toEqual(record);
  });

  it("retains the pre-cutover cohort until explicit acknowledgement", async () => {
    const journal = await store();
    await journal.establishCutover("cutover_1", "2026-09-09T12:00:00.000Z", [
      "task:old",
      "workspace:old",
    ]);
    await journal.acknowledgeLegacyScope(
      "task:old",
      "2026-09-09T12:01:00.000Z",
    );
    expect(await journal.cutover()).toEqual(
      expect.objectContaining({
        legacyScopes: {
          "task:old": { acknowledgedAt: "2026-09-09T12:01:00.000Z" },
          "workspace:old": {},
        },
      }),
    );
  });

  it("merges concurrent cutover acknowledgements through version retries", async () => {
    const root = await mkdtemp(join(tmpdir(), "rove-effect-cutover-race-"));
    roots.push(root);
    const first = new FileEffectJournalStore(root);
    const second = new FileEffectJournalStore(root);
    await first.establishCutover("cutover_1", "2026-09-09T12:00:00.000Z", [
      "task:first",
      "task:second",
    ]);

    await Promise.all([
      first.acknowledgeLegacyScope("task:first", "2026-09-09T12:01:00.000Z"),
      second.acknowledgeLegacyScope("task:second", "2026-09-09T12:02:00.000Z"),
    ]);

    expect(await first.cutover()).toMatchObject({
      version: 3,
      legacyScopes: {
        "task:first": { acknowledgedAt: "2026-09-09T12:01:00.000Z" },
        "task:second": { acknowledgedAt: "2026-09-09T12:02:00.000Z" },
      },
    });
  });

  it("rejects acknowledgement before cutover initialization", async () => {
    const journal = await store();
    await expect(
      journal.acknowledgeLegacyScope(
        "task:missing",
        "2026-09-09T12:01:00.000Z",
      ),
    ).rejects.toThrow("cutover is not initialized");
  });

  it("rejects malformed durable records instead of guessing recovery state", async () => {
    const root = await mkdtemp(join(tmpdir(), "rove-effect-journal-invalid-"));
    roots.push(root);
    const journal = new FileEffectJournalStore(root);
    const records = join(root, "effect-journal", "records");
    await mkdir(records, { recursive: true });
    const prepared = await journal.prepare({
      taskScope: "task",
      browserWorkspaceScope: "workspace",
      consequenceKey: "operation",
      actionFingerprint: "b".repeat(64),
      state: "prepared",
      ownershipGeneration: 1,
      cutoverEpoch: "cutover",
      preparedAt: "2026-09-09T12:00:00.000Z",
      updatedAt: "2026-09-09T12:00:00.000Z",
    });
    await writeFile(
      join(records, `${prepared.effectId}.json`),
      JSON.stringify({
        schemaVersion: 1,
        effectId: prepared.effectId,
        version: 1,
        taskScope: "task",
        browserWorkspaceScope: "workspace",
        consequenceKey: "operation",
        actionFingerprint: "b".repeat(64),
        state: "prepared",
        ownershipGeneration: 1,
        cutoverEpoch: "cutover",
        preparedAt: "not-a-timestamp",
        updatedAt: "2026-09-09T12:00:00.000Z",
      }),
    );
    await expect(
      journal.find("task", "workspace", "operation"),
    ).rejects.toThrow("record is invalid");
  });
});
