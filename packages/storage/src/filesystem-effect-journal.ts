import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, open, readFile, readdir, unlink } from "node:fs/promises";
import { basename, dirname } from "node:path";

import type {
  EffectJournalCutover,
  EffectJournalRecord,
  EffectJournalStore,
} from "./effect-journal.js";
import { pathWithin } from "./paths.js";

function key(...parts: readonly string[]): string {
  return createHash("sha256").update(parts.join("\0")).digest("hex");
}

async function syncDirectory(path: string): Promise<void> {
  const directory = await open(path, "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

async function publishExclusive(
  path: string,
  value: unknown,
): Promise<boolean> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${dirname(path)}/.${basename(path)}.${randomUUID()}.tmp`;
  const file = await open(temporary, "wx", 0o600);
  try {
    await file.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await file.sync();
  } finally {
    await file.close();
  }
  try {
    await link(temporary, path);
    await syncDirectory(dirname(path));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  } finally {
    await unlink(temporary).catch(() => undefined);
    await syncDirectory(dirname(path));
  }
}

async function versionFiles(
  directory: string,
): Promise<readonly { path: string; version: number }[]> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return entries
    .filter((entry) => entry.isFile())
    .flatMap((entry) => {
      const match = /^v([1-9][0-9]*)\.json$/.exec(entry.name);
      if (!match) return [];
      const version = Number(match[1]);
      return Number.isSafeInteger(version)
        ? [{ path: `${directory}/${entry.name}`, version }]
        : [];
    })
    .sort((left, right) => left.version - right.version);
}

function parseRecord(raw: string): EffectJournalRecord {
  const value = JSON.parse(raw) as Partial<EffectJournalRecord>;
  if (
    value.schemaVersion !== 1 ||
    !Number.isSafeInteger(value.version) ||
    value.version! < 1 ||
    typeof value.effectId !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.effectId) ||
    typeof value.taskScope !== "string" ||
    value.taskScope.length === 0 ||
    typeof value.browserWorkspaceScope !== "string" ||
    value.browserWorkspaceScope.length === 0 ||
    typeof value.consequenceKey !== "string" ||
    value.consequenceKey.length === 0 ||
    typeof value.actionFingerprint !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.actionFingerprint) ||
    (value.uncertaintyDomain !== undefined &&
      (typeof value.uncertaintyDomain !== "string" ||
        !/^[a-f0-9]{64}$/.test(value.uncertaintyDomain))) ||
    (value.affectedOperationFingerprint !== undefined &&
      (typeof value.affectedOperationFingerprint !== "string" ||
        !/^[a-f0-9]{64}$/.test(value.affectedOperationFingerprint))) ||
    (value.affectedOperationIdentityVersion !== undefined &&
      value.affectedOperationIdentityVersion !== 1 &&
      value.affectedOperationIdentityVersion !== 2) ||
    (value.affectedOperationIdentityVersion !== undefined &&
      value.affectedOperationFingerprint === undefined) ||
    (value.attemptId !== undefined &&
      (typeof value.attemptId !== "string" ||
        !/^effect_attempt_[a-f0-9-]{36}$/.test(value.attemptId))) ||
    ![
      "planned",
      "authorized",
      "prepared",
      "applied",
      "not_applied",
      "unresolved",
    ].includes(value.state ?? "") ||
    !Number.isSafeInteger(value.ownershipGeneration) ||
    value.ownershipGeneration! < 1 ||
    typeof value.cutoverEpoch !== "string" ||
    value.cutoverEpoch.length === 0 ||
    !validTimestamp(value.preparedAt) ||
    !validTimestamp(value.updatedAt) ||
    (value.observationId !== undefined &&
      (typeof value.observationId !== "string" ||
        value.observationId.length === 0)) ||
    (value.evidenceId !== undefined &&
      (typeof value.evidenceId !== "string" || value.evidenceId.length === 0))
  )
    throw new Error("Effect journal record is invalid.");
  if (
    value.taskResultPlan !== undefined &&
    (typeof value.taskResultPlan !== "object" ||
      value.taskResultPlan === null ||
      value.taskResultPlan.schemaVersion !== 1 ||
      typeof value.taskResultPlan.planId !== "string" ||
      !/^plan_[a-f0-9]{32}$/.test(value.taskResultPlan.planId) ||
      value.taskResultPlan.consequenceKey !== value.consequenceKey ||
      value.taskResultPlan.taskScope !== value.taskScope ||
      value.taskResultPlan.browserWorkspaceScope !==
        value.browserWorkspaceScope ||
      value.taskResultPlan.actionFingerprint !== value.actionFingerprint ||
      !/^[a-f0-9]{64}$/.test(value.taskResultPlan.materialDigest) ||
      !/^[a-f0-9]{64}$/.test(value.taskResultPlan.planDigest))
  )
    throw new Error("Effect journal task-result plan is invalid.");
  if (value.taskResultPlan) {
    const { planDigest, ...planBase } = value.taskResultPlan;
    if (
      createHash("sha256").update(JSON.stringify(planBase)).digest("hex") !==
      planDigest
    )
      throw new Error("Effect journal task-result plan digest is invalid.");
  }
  const authorization = value.repeatAuthorization;
  if (
    authorization !== undefined &&
    (typeof authorization !== "object" ||
      authorization === null ||
      Array.isArray(authorization) ||
      typeof authorization.authorizationId !== "string" ||
      !/^effect_repeat_[a-f0-9-]{36}$/.test(authorization.authorizationId) ||
      !validTimestamp(authorization.authorizedAt) ||
      (authorization.consumedByAttemptId !== undefined &&
        (typeof authorization.consumedByAttemptId !== "string" ||
          !/^effect_attempt_[a-f0-9-]{36}$/.test(
            authorization.consumedByAttemptId,
          ))) ||
      (authorization.consumedByConsequenceKey !== undefined &&
        (typeof authorization.consumedByConsequenceKey !== "string" ||
          authorization.consumedByConsequenceKey.length === 0)) ||
      (authorization.consumedByAttemptId !== undefined &&
        authorization.consumedByConsequenceKey !== undefined) ||
      (authorization.consumedAt !== undefined &&
        !validTimestamp(authorization.consumedAt)) ||
      (authorization.consumedByAttemptId === undefined &&
        authorization.consumedByConsequenceKey === undefined) !==
        (authorization.consumedAt === undefined))
  )
    throw new Error("Effect journal repeat authorization is invalid.");
  return value as EffectJournalRecord;
}

function validTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function validActionFingerprintTransition(
  previous: EffectJournalRecord,
  next: EffectJournalRecord,
): boolean {
  if (next.actionFingerprint === previous.actionFingerprint) return true;
  return validTaskResultPlanReplacement(previous, next);
}

function validTaskResultPlanReplacement(
  previous: EffectJournalRecord,
  next: EffectJournalRecord,
): boolean {
  const previousPlan = previous.taskResultPlan;
  const nextPlan = next.taskResultPlan;
  return (
    (previous.state === "planned" || previous.state === "authorized") &&
    next.state === "planned" &&
    nextPlan !== undefined &&
    (previousPlan === undefined || previousPlan.planId !== nextPlan.planId)
  );
}

function validTaskResultPlanTransition(
  previous: EffectJournalRecord,
  next: EffectJournalRecord,
): boolean {
  const previousPlan = previous.taskResultPlan;
  const nextPlan = next.taskResultPlan;
  if (previousPlan === undefined && nextPlan === undefined) return true;
  if (
    previousPlan !== undefined &&
    nextPlan !== undefined &&
    previousPlan.planId === nextPlan.planId &&
    previousPlan.planDigest === nextPlan.planDigest
  )
    return true;
  return validTaskResultPlanReplacement(previous, next);
}

function parseCutover(raw: string): EffectJournalCutover {
  const parsed = JSON.parse(raw) as Partial<EffectJournalCutover>;
  const value = {
    ...parsed,
    // The single-file prototype predated immutable cutover versions.
    version: parsed.version ?? 1,
  };
  if (
    value.schemaVersion !== 1 ||
    !Number.isSafeInteger(value.version) ||
    value.version < 1 ||
    typeof value.epoch !== "string" ||
    value.epoch.length === 0 ||
    !validTimestamp(value.createdAt) ||
    !value.legacyScopes ||
    typeof value.legacyScopes !== "object" ||
    Array.isArray(value.legacyScopes)
  )
    throw new Error("Effect journal cutover is invalid.");
  for (const [scope, entry] of Object.entries(value.legacyScopes)) {
    if (
      scope.length === 0 ||
      !entry ||
      typeof entry !== "object" ||
      Array.isArray(entry) ||
      (entry.acknowledgedAt !== undefined &&
        !validTimestamp(entry.acknowledgedAt))
    )
      throw new Error("Effect journal cutover is invalid.");
  }
  return value as EffectJournalCutover;
}

export class FileEffectJournalStore implements EffectJournalStore {
  constructor(private readonly home: string) {}

  private legacyRecordPath(effectId: string): string {
    return pathWithin(
      this.home,
      "effect-journal",
      "records",
      `${effectId}.json`,
    );
  }

  private recordDirectory(effectId: string): string {
    if (!/^[a-f0-9]{64}$/.test(effectId))
      throw new Error("Effect journal ID is invalid.");
    return pathWithin(this.home, "effect-journal", "records", effectId);
  }

  private recordVersionPath(effectId: string, version: number): string {
    return pathWithin(this.recordDirectory(effectId), `v${version}.json`);
  }

  private cutoverDirectory(): string {
    return pathWithin(this.home, "effect-journal", "cutover");
  }

  private cutoverVersionPath(version: number): string {
    return pathWithin(this.cutoverDirectory(), `v${version}.json`);
  }

  private async legacyRecord(
    effectId: string,
  ): Promise<EffectJournalRecord | null> {
    try {
      return parseRecord(
        await readFile(this.legacyRecordPath(effectId), "utf8"),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  private async readRecord(
    effectId: string,
  ): Promise<EffectJournalRecord | null> {
    const legacy = await this.legacyRecord(effectId);
    const files = await versionFiles(this.recordDirectory(effectId));
    let previous = legacy;
    let expectedVersion = legacy ? legacy.version + 1 : 1;
    for (const file of files) {
      if (file.version !== expectedVersion)
        throw new Error("Effect journal version sequence is invalid.");
      const record = parseRecord(await readFile(file.path, "utf8"));
      if (
        record.version !== file.version ||
        record.effectId !== effectId ||
        (previous &&
          (record.taskScope !== previous.taskScope ||
            record.browserWorkspaceScope !== previous.browserWorkspaceScope ||
            record.consequenceKey !== previous.consequenceKey ||
            !validActionFingerprintTransition(previous, record) ||
            !validTaskResultPlanTransition(previous, record) ||
            record.uncertaintyDomain !== previous.uncertaintyDomain ||
            record.affectedOperationFingerprint !==
              previous.affectedOperationFingerprint ||
            record.affectedOperationIdentityVersion !==
              previous.affectedOperationIdentityVersion ||
            record.attemptId !== previous.attemptId ||
            record.cutoverEpoch !== previous.cutoverEpoch))
      )
        throw new Error("Effect journal record chain is invalid.");
      previous = record;
      expectedVersion += 1;
    }
    return previous;
  }

  private async legacyCutover(): Promise<EffectJournalCutover | null> {
    try {
      return parseCutover(
        await readFile(
          pathWithin(this.home, "effect-journal", "cutover.json"),
          "utf8",
        ),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async prepare(
    input: Omit<EffectJournalRecord, "schemaVersion" | "version" | "effectId">,
  ): Promise<EffectJournalRecord> {
    if (
      input.state !== "planned" &&
      input.state !== "prepared" &&
      input.state !== "authorized"
    )
      throw new Error(
        "Effect journal must begin planned, authorized, or prepared.",
      );
    const effectId = key(
      input.taskScope,
      input.browserWorkspaceScope,
      input.consequenceKey,
      ...(input.attemptId === undefined ? [] : [input.attemptId]),
    );
    const record: EffectJournalRecord = {
      ...input,
      schemaVersion: 1,
      version: 1,
      effectId,
    };
    const existing = await this.readRecord(effectId);
    if (existing) {
      if (
        existing.actionFingerprint !== input.actionFingerprint ||
        existing.taskScope !== input.taskScope ||
        existing.browserWorkspaceScope !== input.browserWorkspaceScope ||
        existing.consequenceKey !== input.consequenceKey ||
        existing.attemptId !== input.attemptId
      )
        throw new Error("Effect journal identity collision.");
      return existing;
    }
    const created = await publishExclusive(
      this.recordVersionPath(effectId, 1),
      record,
    );
    if (!created) {
      const winner = await this.readRecord(effectId);
      if (
        !winner ||
        winner.actionFingerprint !== input.actionFingerprint ||
        winner.taskScope !== input.taskScope ||
        winner.browserWorkspaceScope !== input.browserWorkspaceScope ||
        winner.consequenceKey !== input.consequenceKey ||
        winner.attemptId !== input.attemptId
      )
        throw new Error("Effect journal identity collision.");
      return winner;
    }
    return record;
  }

  async update(
    effectId: string,
    expectedVersion: number,
    update: Pick<
      EffectJournalRecord,
      "state" | "updatedAt" | "observationId" | "evidenceId"
    > &
      Partial<
        Pick<EffectJournalRecord, "ownershipGeneration" | "actionFingerprint">
      > & {
        taskResultPlan?: EffectJournalRecord["taskResultPlan"] | undefined;
      },
  ): Promise<EffectJournalRecord> {
    const current = await this.readRecord(effectId);
    if (!current || current.version !== expectedVersion)
      throw new Error("Effect journal version conflict.");
    const allowed =
      (current.state === "planned" &&
        (update.state === "planned" || update.state === "authorized")) ||
      (current.state === "authorized" && update.state === "planned") ||
      (current.state === "authorized" && update.state === "prepared") ||
      (current.state === "prepared" &&
        ["applied", "not_applied", "unresolved"].includes(update.state)) ||
      (current.state === "not_applied" && update.state === "prepared");
    if (!allowed) throw new Error("Effect journal transition is invalid.");
    if (
      update.ownershipGeneration !== undefined &&
      (!Number.isSafeInteger(update.ownershipGeneration) ||
        update.ownershipGeneration < 1)
    )
      throw new Error("Effect journal ownership generation is invalid.");
    const { taskResultPlan: currentPlan, ...currentWithoutPlan } = current;
    const { taskResultPlan: updatedPlan, ...updateWithoutPlan } = update;
    const nextPlan = Object.prototype.hasOwnProperty.call(
      update,
      "taskResultPlan",
    )
      ? updatedPlan
      : currentPlan;
    const next: EffectJournalRecord = {
      ...currentWithoutPlan,
      ...updateWithoutPlan,
      ...(nextPlan === undefined ? {} : { taskResultPlan: nextPlan }),
      version: current.version + 1,
    };
    if (
      !validActionFingerprintTransition(current, next) ||
      !validTaskResultPlanTransition(current, next)
    )
      throw new Error("Effect journal identity transition is invalid.");
    const created = await publishExclusive(
      this.recordVersionPath(effectId, next.version),
      next,
    );
    if (!created) throw new Error("Effect journal version conflict.");
    return next;
  }

  async find(
    taskScope: string,
    browserWorkspaceScope: string,
    consequenceKey: string,
  ): Promise<EffectJournalRecord | null> {
    return this.readRecord(
      key(taskScope, browserWorkspaceScope, consequenceKey),
    );
  }

  async findById(effectId: string): Promise<EffectJournalRecord | null> {
    return this.readRecord(effectId);
  }

  async findPotentialConflicts(
    browserWorkspaceScope: string,
  ): Promise<EffectJournalRecord[]> {
    let entries;
    try {
      entries = await readdir(
        pathWithin(this.home, "effect-journal", "records"),
        { withFileTypes: true },
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const ids = new Set<string>();
    for (const entry of entries) {
      const candidate = entry.isDirectory()
        ? entry.name
        : entry.isFile() && entry.name.endsWith(".json")
          ? entry.name.slice(0, -".json".length)
          : "";
      if (/^[a-f0-9]{64}$/.test(candidate)) ids.add(candidate);
    }
    const records = await Promise.all(
      [...ids].sort().map((effectId) => this.readRecord(effectId)),
    );
    return records
      .filter((record): record is EffectJournalRecord => record !== null)
      .filter(
        (record) =>
          record.browserWorkspaceScope === browserWorkspaceScope &&
          (record.state === "prepared" || record.state === "unresolved"),
      );
  }

  async authorizeRepeat(
    effectId: string,
    authorizationId: string,
    authorizedAt: string,
  ): Promise<EffectJournalRecord> {
    if (!/^effect_repeat_[a-f0-9-]{36}$/.test(authorizationId))
      throw new Error("Effect repeat authorization identity is invalid.");
    if (!validTimestamp(authorizedAt))
      throw new Error("Effect repeat authorization time is invalid.");
    const current = await this.readRecord(effectId);
    if (!current) throw new Error("Effect journal record was not found.");
    if (current.state !== "prepared" && current.state !== "unresolved")
      throw new Error("Only uncertain effects can authorize repetition.");
    if (current.repeatAuthorization?.authorizationId === authorizationId)
      return current;
    if (
      current.repeatAuthorization &&
      current.repeatAuthorization.consumedAt === undefined
    )
      throw new Error("An effect repetition authorization is already pending.");
    const next: EffectJournalRecord = {
      ...current,
      version: current.version + 1,
      updatedAt: authorizedAt,
      repeatAuthorization: { authorizationId, authorizedAt },
    };
    const created = await publishExclusive(
      this.recordVersionPath(effectId, next.version),
      next,
    );
    if (!created) throw new Error("Effect journal version conflict.");
    return next;
  }

  async consumeRepeatAuthorization(
    effectId: string,
    expectedVersion: number,
    attemptId: string,
    consumedAt: string,
  ): Promise<EffectJournalRecord> {
    if (!validTimestamp(consumedAt))
      throw new Error("Effect repeat authorization time is invalid.");
    if (!/^effect_attempt_[a-f0-9-]{36}$/.test(attemptId))
      throw new Error("Effect attempt identity is invalid.");
    const current = await this.readRecord(effectId);
    if (!current || current.version !== expectedVersion)
      throw new Error("Effect journal version conflict.");
    const authorization = current.repeatAuthorization;
    if (!authorization)
      throw new Error("Effect repetition has not been authorized.");
    if (authorization.consumedAt !== undefined) {
      if (authorization.consumedByAttemptId === attemptId) return current;
      throw new Error("Effect repeat authorization was already consumed.");
    }
    const next: EffectJournalRecord = {
      ...current,
      version: current.version + 1,
      updatedAt: consumedAt,
      repeatAuthorization: {
        ...authorization,
        consumedByAttemptId: attemptId,
        consumedAt,
      },
    };
    const created = await publishExclusive(
      this.recordVersionPath(effectId, next.version),
      next,
    );
    if (!created) throw new Error("Effect journal version conflict.");
    return next;
  }

  async establishCutover(
    epoch: string,
    createdAt: string,
    legacyScopes: readonly string[],
  ): Promise<EffectJournalCutover> {
    const existing = await this.cutover();
    if (existing) return existing;
    const cutover: EffectJournalCutover = {
      schemaVersion: 1,
      version: 1,
      epoch,
      createdAt,
      legacyScopes: Object.fromEntries(
        legacyScopes.map((scope) => [scope, {}]),
      ),
    };
    const created = await publishExclusive(this.cutoverVersionPath(1), cutover);
    if (!created) return (await this.cutover())!;
    return cutover;
  }

  async cutover(): Promise<EffectJournalCutover | null> {
    const legacy = await this.legacyCutover();
    const files = await versionFiles(this.cutoverDirectory());
    let previous = legacy;
    let expectedVersion = legacy ? legacy.version + 1 : 1;
    for (const file of files) {
      if (file.version !== expectedVersion)
        throw new Error("Effect journal cutover sequence is invalid.");
      const cutover = parseCutover(await readFile(file.path, "utf8"));
      if (
        cutover.version !== file.version ||
        (previous &&
          (cutover.epoch !== previous.epoch ||
            cutover.createdAt !== previous.createdAt))
      )
        throw new Error("Effect journal cutover chain is invalid.");
      previous = cutover;
      expectedVersion += 1;
    }
    return previous;
  }

  async acknowledgeLegacyScope(scope: string, at: string): Promise<void> {
    if (!validTimestamp(at))
      throw new Error("Legacy effect acknowledgement time is invalid.");
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const cutover = await this.cutover();
      if (!cutover)
        throw new Error("Effect journal cutover is not initialized.");
      const legacyScope = cutover.legacyScopes[scope];
      if (!legacyScope || legacyScope.acknowledgedAt) return;
      const next: EffectJournalCutover = {
        ...cutover,
        version: cutover.version + 1,
        legacyScopes: {
          ...cutover.legacyScopes,
          [scope]: { acknowledgedAt: at },
        },
      };
      if (await publishExclusive(this.cutoverVersionPath(next.version), next))
        return;
    }
    throw new Error("Effect journal cutover version conflict.");
  }
}
