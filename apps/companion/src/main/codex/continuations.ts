import { createHash } from "node:crypto";

import type { CodexRpcPort, CodexThread, UserInput } from "./protocol.js";
import type { StateRepository } from "./persistence.js";
import {
  boundedIdentity,
  boundedOpaqueIdentity,
  exactKeys,
  requiredString,
  sha256Digest,
  strictRecord,
} from "./state-validation.js";

export interface ContinuationCommand {
  commandId: string;
  returnEventId: string;
  kind: "turn/start" | "turn/steer";
  dispatchStatus: "not_started" | "possibly_started" | "terminal";
  payload: {
    roveContinuationCommandId: string;
    authoredBy: "host";
    instruction: string;
  };
}
export interface FreshInspectionProof {
  inspectionId: string;
  sessionId: string;
  handoffId: string;
  generation: number;
  afterObservationSeq: number;
}
export interface PendingContinuation {
  roveTaskId: string;
  codexThreadId: string;
  originatingCodexTurnId: string;
  roveSessionId: string;
  handoffId?: string;
  /** Digest of the immutable completed request-human observation. Required for ID-based records. */
  observationFingerprint?: string;
  handoffGeneration: number;
  requestedInstruction: string;
  continuationPolicy: "resume_after_control_return" | "explicit_user_response";
  status: "pending" | "consumed" | "cancelled" | "superseded";
  freshInspectionRequired: boolean;
  returnControlOperationId?: string;
  freshInspection?: FreshInspectionProof;
  preHandoffObservationSeq?: number;
  returnEventId?: string;
  returnObservationSeq?: number;
  continuationCommand?: ContinuationCommand;
  consumedEventId?: string;
}
export type ContinuationIdentity = Pick<
  PendingContinuation,
  | "roveTaskId"
  | "codexThreadId"
  | "originatingCodexTurnId"
  | "roveSessionId"
  | "handoffId"
  | "handoffGeneration"
>;
export interface ContinuationState {
  records: Record<string, PendingContinuation>;
  returnEventFingerprints: Record<string, string>;
}
export interface TrustedReturnEvent extends ContinuationIdentity {
  eventId: string;
  observationSeq?: number;
}
interface ThreadTruth {
  activeTurnId?: string;
  commandTurns: Record<string, string>;
  terminalTurnIds: Set<string>;
}

const record = (value: unknown) => strictRecord(value, "continuation state");
const string = requiredString;
function keyOf(value: ContinuationIdentity): string {
  if (value.handoffId !== undefined)
    return `handoff:${createHash("sha256")
      .update(
        JSON.stringify([
          value.roveTaskId,
          value.codexThreadId,
          value.originatingCodexTurnId,
          value.roveSessionId,
          value.handoffId,
        ]),
      )
      .digest("hex")}`;
  return [
    value.roveTaskId,
    value.codexThreadId,
    value.originatingCodexTurnId,
    value.roveSessionId,
    value.handoffId ?? value.handoffGeneration,
  ].join(":");
}
function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function immutableObservation(value: PendingContinuation) {
  return {
    roveTaskId: value.roveTaskId,
    codexThreadId: value.codexThreadId,
    originatingCodexTurnId: value.originatingCodexTurnId,
    roveSessionId: value.roveSessionId,
    ...(value.handoffId === undefined ? {} : { handoffId: value.handoffId }),
    handoffGeneration: value.handoffGeneration,
    requestedInstruction: value.requestedInstruction,
    continuationPolicy: value.continuationPolicy,
    ...(value.preHandoffObservationSeq === undefined
      ? {}
      : { preHandoffObservationSeq: value.preHandoffObservationSeq }),
  };
}
function withObservationFingerprint(
  value: PendingContinuation,
): PendingContinuation {
  if (
    value.handoffId === undefined ||
    value.observationFingerprint !== undefined
  )
    return value;
  return {
    ...value,
    observationFingerprint: fingerprint(immutableObservation(value)),
  };
}
function stableCommandId(key: string, eventId: string): string {
  return `continue_${createHash("sha256").update(`${key}:${eventId}`).digest("hex").slice(0, 24)}`;
}
export function validateContinuationRecord(
  value: unknown,
  allowLegacyObservationMigration = false,
): PendingContinuation {
  const item = record(value);
  exactKeys(
    item,
    [
      "roveTaskId",
      "codexThreadId",
      "originatingCodexTurnId",
      "roveSessionId",
      "handoffId",
      "observationFingerprint",
      "handoffGeneration",
      "requestedInstruction",
      "continuationPolicy",
      "status",
      "freshInspectionRequired",
      "returnControlOperationId",
      "freshInspection",
      "preHandoffObservationSeq",
      "returnEventId",
      "returnObservationSeq",
      "continuationCommand",
      "consumedEventId",
    ],
    "continuation record",
  );
  const generation = item.handoffGeneration;
  if (!Number.isInteger(generation) || Number(generation) <= 0)
    throw new Error("Invalid handoff generation.");
  const status = item.status;
  if (
    !["pending", "consumed", "cancelled", "superseded"].includes(String(status))
  )
    throw new Error("Invalid continuation status.");
  const policy = item.continuationPolicy;
  if (
    policy !== "resume_after_control_return" &&
    policy !== "explicit_user_response"
  )
    throw new Error("Invalid continuation policy.");
  if (typeof item.freshInspectionRequired !== "boolean")
    throw new Error("Invalid continuation inspection requirement.");
  const parsed: PendingContinuation = {
    roveTaskId: boundedIdentity(
      item.roveTaskId,
      "continuation task",
      /^task_[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/,
    ),
    codexThreadId: boundedOpaqueIdentity(
      item.codexThreadId,
      "continuation thread",
    ),
    originatingCodexTurnId: boundedOpaqueIdentity(
      item.originatingCodexTurnId,
      "continuation turn",
    ),
    roveSessionId: boundedIdentity(
      item.roveSessionId,
      "continuation session",
      /^ses_[A-Za-z0-9][A-Za-z0-9_-]*$/,
    ),
    ...(item.handoffId === undefined
      ? {}
      : {
          handoffId: boundedIdentity(
            item.handoffId,
            "continuation handoff",
            /^handoff_[A-Za-z0-9][A-Za-z0-9_-]*$/,
          ),
        }),
    handoffGeneration: Number(generation),
    requestedInstruction: string(
      item.requestedInstruction,
      "continuation instruction",
    ),
    continuationPolicy: policy,
    status: status as PendingContinuation["status"],
    freshInspectionRequired: item.freshInspectionRequired,
  };
  if (item.preHandoffObservationSeq !== undefined) {
    if (
      !Number.isInteger(item.preHandoffObservationSeq) ||
      Number(item.preHandoffObservationSeq) < 0
    )
      throw new Error("Invalid pre-handoff observation sequence.");
    parsed.preHandoffObservationSeq = Number(item.preHandoffObservationSeq);
  }
  if (item.returnControlOperationId !== undefined)
    parsed.returnControlOperationId = boundedIdentity(
      item.returnControlOperationId,
      "Return Control operation",
      /^intent_[a-f0-9-]{36}$/,
    );
  if (item.freshInspection !== undefined) {
    const proof = record(item.freshInspection);
    exactKeys(
      proof,
      [
        "inspectionId",
        "sessionId",
        "handoffId",
        "generation",
        "afterObservationSeq",
      ],
      "fresh inspection proof",
    );
    if (
      parsed.handoffId === undefined ||
      proof.sessionId !== parsed.roveSessionId ||
      proof.handoffId !== parsed.handoffId ||
      proof.generation !== parsed.handoffGeneration ||
      !Number.isInteger(proof.afterObservationSeq) ||
      Number(proof.afterObservationSeq) <=
        (parsed.preHandoffObservationSeq ?? -1)
    )
      throw new Error(
        "Fresh inspection proof does not match the continuation.",
      );
    parsed.freshInspection = {
      inspectionId: string(proof.inspectionId, "fresh inspection id"),
      sessionId: string(proof.sessionId, "fresh inspection session"),
      handoffId: string(proof.handoffId, "fresh inspection handoff"),
      generation: Number(proof.generation),
      afterObservationSeq: Number(proof.afterObservationSeq),
    };
  }
  if (item.observationFingerprint !== undefined)
    parsed.observationFingerprint = sha256Digest(
      item.observationFingerprint,
      "continuation observation fingerprint",
    );
  if (parsed.handoffId !== undefined) {
    const expected = fingerprint(immutableObservation(parsed));
    if (
      parsed.observationFingerprint === undefined &&
      allowLegacyObservationMigration
    )
      parsed.observationFingerprint = expected;
    else if (parsed.observationFingerprint !== expected)
      throw new Error("Continuation observation fingerprint mismatch.");
  } else if (parsed.observationFingerprint !== undefined) {
    throw new Error(
      "Legacy continuation cannot carry an observation fingerprint.",
    );
  }
  if (item.consumedEventId !== undefined)
    parsed.consumedEventId = string(item.consumedEventId, "consumed event");
  if (item.returnEventId !== undefined)
    parsed.returnEventId = string(item.returnEventId, "return event");
  if (item.returnObservationSeq !== undefined) {
    if (
      !Number.isInteger(item.returnObservationSeq) ||
      Number(item.returnObservationSeq) < 0
    )
      throw new Error("Invalid return observation sequence.");
    parsed.returnObservationSeq = Number(item.returnObservationSeq);
  }
  if (item.continuationCommand !== undefined) {
    const command = record(item.continuationCommand);
    const payload = record(command.payload);
    exactKeys(
      command,
      ["commandId", "returnEventId", "kind", "dispatchStatus", "payload"],
      "continuation command",
    );
    exactKeys(
      payload,
      ["roveContinuationCommandId", "authoredBy", "instruction"],
      "continuation payload",
    );
    if (
      !["turn/start", "turn/steer"].includes(String(command.kind)) ||
      !["not_started", "possibly_started", "terminal"].includes(
        String(command.dispatchStatus),
      ) ||
      payload.authoredBy !== "host"
    )
      throw new Error("Invalid continuation command.");
    parsed.continuationCommand = {
      commandId: string(command.commandId, "continuation command"),
      returnEventId: string(command.returnEventId, "return event"),
      kind: command.kind as ContinuationCommand["kind"],
      dispatchStatus:
        command.dispatchStatus as ContinuationCommand["dispatchStatus"],
      payload: {
        roveContinuationCommandId: string(
          payload.roveContinuationCommandId,
          "continuation payload id",
        ),
        authoredBy: "host",
        instruction: string(
          payload.instruction,
          "continuation payload instruction",
        ),
      },
    };
    if (
      parsed.continuationCommand.commandId !==
      parsed.continuationCommand.payload.roveContinuationCommandId
    )
      throw new Error("Continuation command identity mismatch.");
  }
  if (
    parsed.status === "consumed" &&
    (!parsed.consumedEventId ||
      parsed.continuationCommand?.dispatchStatus !== "terminal")
  )
    throw new Error("Invalid consumed continuation.");
  if (
    parsed.status === "pending" &&
    parsed.continuationPolicy === "resume_after_control_return" &&
    parsed.continuationCommand === undefined &&
    !parsed.freshInspectionRequired &&
    parsed.freshInspection === undefined &&
    parsed.returnEventId === undefined
  )
    throw new Error(
      "Pending automatic continuation requires fresh inspection.",
    );
  if (
    (parsed.status === "cancelled" || parsed.status === "superseded") &&
    parsed.continuationCommand?.dispatchStatus === "not_started"
  )
    throw new Error(
      "Cancelled continuation cannot retain a retryable command.",
    );
  if (parsed.status !== "consumed" && parsed.consumedEventId !== undefined)
    throw new Error("Only consumed continuations carry a consumed event.");
  if (parsed.returnEventId !== undefined && parsed.freshInspectionRequired)
    throw new Error("Return receipt cannot require another fresh inspection.");
  if (parsed.freshInspection !== undefined && parsed.freshInspectionRequired)
    throw new Error("Persisted fresh inspection proof cannot remain required.");
  if (
    parsed.returnObservationSeq !== undefined &&
    parsed.returnEventId === undefined
  )
    throw new Error("Return observation requires a return receipt.");
  return parsed;
}
export function prepareContinuationState(value: unknown): ContinuationState {
  const root = record(value);
  exactKeys(root, ["records", "returnEventFingerprints"], "continuation state");
  const records = record(root.records);
  const events = record(root.returnEventFingerprints ?? {});
  const parsed: ContinuationState = {
    records: {},
    returnEventFingerprints: {},
  };
  for (const [key, raw] of Object.entries(records)) {
    const item = validateContinuationRecord(raw, true);
    if (key !== keyOf(item))
      throw new Error("Continuation record key mismatch.");
    parsed.records[key] = item;
  }
  if (Object.keys(records).length > 256 || Object.keys(events).length > 2048)
    throw new Error("Continuation state bound exceeded.");
  for (const [key, raw] of Object.entries(events))
    parsed.returnEventFingerprints[string(key, "return event id")] =
      sha256Digest(raw, "return event fingerprint");
  return parsed;
}
function threadTruth(thread: CodexThread): ThreadTruth {
  const truth: ThreadTruth = { commandTurns: {}, terminalTurnIds: new Set() };
  for (const turn of thread.turns) {
    if (turn.status === "inProgress") {
      if (truth.activeTurnId !== undefined && truth.activeTurnId !== turn.id)
        throw new Error("Codex thread has conflicting active turns.");
      truth.activeTurnId = turn.id;
    } else truth.terminalTurnIds.add(turn.id);
    for (const item of turn.items) {
      if (
        item.type === "userMessage" &&
        typeof item.clientId === "string" &&
        item.clientId.startsWith("continue_")
      )
        truth.commandTurns[item.clientId] = turn.id;
    }
  }
  return truth;
}

export class DurableContinuationStore {
  private registrationChain: Promise<void> = Promise.resolve();
  constructor(
    private readonly repository: StateRepository<ContinuationState>,
  ) {}
  private async read(): Promise<
    { revision: number; value: ContinuationState } | undefined
  > {
    const snapshot = await this.repository.read();
    return snapshot === undefined
      ? undefined
      : {
          revision: snapshot.revision,
          value: prepareContinuationState(snapshot.value),
        };
  }
  private commit(revision: number, value: ContinuationState) {
    return this.repository.write(revision, prepareContinuationState(value));
  }
  async validate(): Promise<void> {
    await this.read();
  }
  async observationStatus(
    recordValue: PendingContinuation,
  ): Promise<"known" | "unknown"> {
    const incoming = validateContinuationRecord(
      withObservationFingerprint(recordValue),
    );
    const snapshot = await this.read();
    const existing = snapshot?.value.records[keyOf(incoming)];
    if (!existing) return "unknown";
    if (
      fingerprint(immutableObservation(existing)) !==
      fingerprint(immutableObservation(incoming))
    )
      throw new Error("Continuation identity collision.");
    return "known";
  }
  async observationIdentityStatus(
    identity: ContinuationIdentity & {
      requestedInstruction: string;
      continuationPolicy: PendingContinuation["continuationPolicy"];
    },
  ): Promise<"known" | "unknown"> {
    const snapshot = await this.read();
    const existing = snapshot?.value.records[keyOf(identity)];
    if (!existing) return "unknown";
    if (
      existing.handoffGeneration !== identity.handoffGeneration ||
      existing.requestedInstruction !== identity.requestedInstruction ||
      existing.continuationPolicy !== identity.continuationPolicy
    )
      throw new Error("Continuation identity collision.");
    return "known";
  }
  register(recordValue: PendingContinuation): Promise<boolean> {
    const operation = this.registrationChain.then(() =>
      this.registerUnlocked(recordValue),
    );
    this.registrationChain = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }
  private async registerUnlocked(
    recordValue: PendingContinuation,
  ): Promise<boolean> {
    const incoming = validateContinuationRecord(
      withObservationFingerprint(recordValue),
    );
    const snapshot = await this.read();
    const state = snapshot?.value ?? {
      records: {},
      returnEventFingerprints: {},
    };
    const key = keyOf(incoming);
    const existing = state.records[key];
    if (existing) {
      if (
        fingerprint(immutableObservation(existing)) !==
        fingerprint(immutableObservation(incoming))
      )
        throw new Error("Continuation identity collision.");
      return false;
    }
    await this.commit(snapshot?.revision ?? 0, {
      ...state,
      records: { ...state.records, [key]: incoming },
    });
    return true;
  }
  async pendingForTask(
    taskId: string,
  ): Promise<PendingContinuation | undefined> {
    const snapshot = await this.read();
    const matches = Object.values(snapshot?.value.records ?? {}).filter(
      (entry) => entry.roveTaskId === taskId && entry.status === "pending",
    );
    if (matches.length > 1)
      throw new Error("Multiple pending continuations for one task.");
    return matches[0];
  }
  async latestForTask(
    taskId: string,
  ): Promise<PendingContinuation | undefined> {
    const snapshot = await this.read();
    const matches = Object.values(snapshot?.value.records ?? {})
      .filter((entry) => entry.roveTaskId === taskId)
      .sort((left, right) => right.handoffGeneration - left.handoffGeneration);
    if (
      matches.length > 1 &&
      matches[0]!.handoffGeneration === matches[1]!.handoffGeneration
    )
      throw new Error("Continuation generation is ambiguous for one task.");
    return matches[0] === undefined ? undefined : structuredClone(matches[0]);
  }
  async pending(): Promise<PendingContinuation[]> {
    const snapshot = await this.read();
    return Object.values(snapshot?.value.records ?? {})
      .filter((entry) => entry.status === "pending")
      .map((entry) => structuredClone(entry));
  }
  async recordFreshInspection(
    identity: ContinuationIdentity,
    proof: FreshInspectionProof,
  ): Promise<void> {
    const snapshot = await this.read();
    if (!snapshot) throw new Error("Continuation state is unavailable.");
    const key = keyOf(identity);
    const pending = snapshot.value.records[key];
    if (!pending || pending.status !== "pending")
      throw new Error("Pending continuation is unavailable.");
    const next = validateContinuationRecord({
      ...pending,
      freshInspectionRequired: false,
      freshInspection: proof,
    });
    if (pending.freshInspection !== undefined) {
      if (
        fingerprint(pending.freshInspection) !==
        fingerprint(next.freshInspection)
      )
        throw new Error("Fresh inspection proof identity collision.");
      return;
    }
    await this.commit(snapshot.revision, {
      ...snapshot.value,
      records: { ...snapshot.value.records, [key]: next },
    });
  }
  async recordReturnControlIntent(
    identity: ContinuationIdentity,
    operationId: string,
  ): Promise<void> {
    const snapshot = await this.read();
    if (!snapshot) throw new Error("Continuation state is unavailable.");
    const key = keyOf(identity);
    const pending = snapshot.value.records[key];
    if (!pending || pending.status !== "pending")
      throw new Error("Pending continuation is unavailable.");
    const stable = boundedIdentity(
      operationId,
      "Return Control operation",
      /^intent_[a-f0-9-]{36}$/,
    );
    if (
      pending.returnControlOperationId !== undefined &&
      pending.returnControlOperationId !== stable
    )
      throw new Error("Return Control operation identity collision.");
    if (pending.returnControlOperationId === stable) return;
    await this.commit(snapshot.revision, {
      ...snapshot.value,
      records: {
        ...snapshot.value.records,
        [key]: { ...pending, returnControlOperationId: stable },
      },
    });
  }

  async recordReturnEvent(
    identity: ContinuationIdentity,
    event: { eventId: string; observationSeq?: number },
  ): Promise<void> {
    const snapshot = await this.read();
    if (!snapshot) throw new Error("Continuation state is unavailable.");
    const key = keyOf(identity);
    const pending = snapshot.value.records[key];
    if (!pending || pending.status !== "pending")
      throw new Error("Pending continuation is unavailable.");
    if (
      pending.freshInspectionRequired ||
      pending.freshInspection === undefined
    )
      throw new Error("Fresh post-return inspection is required.");
    if (
      event.observationSeq !== undefined &&
      pending.preHandoffObservationSeq !== undefined &&
      event.observationSeq <= pending.preHandoffObservationSeq
    )
      throw new Error("Stale Runtime return event.");
    if (pending.returnEventId !== undefined) {
      if (
        pending.returnEventId !== event.eventId ||
        pending.returnObservationSeq !== event.observationSeq
      )
        throw new Error("Return event identity collision.");
      return;
    }
    await this.commit(snapshot.revision, {
      records: {
        ...snapshot.value.records,
        [key]: {
          ...pending,
          returnEventId: event.eventId,
          ...(event.observationSeq === undefined
            ? {}
            : { returnObservationSeq: event.observationSeq }),
        },
      },
      returnEventFingerprints: {
        ...snapshot.value.returnEventFingerprints,
        [event.eventId]: fingerprint({ ...identity, ...event }),
      },
    });
  }

  async prepareContinuationCommand(
    identity: ContinuationIdentity,
    thread: CodexThread,
  ): Promise<void> {
    const snapshot = await this.read();
    if (!snapshot) throw new Error("Continuation state is unavailable.");
    const key = keyOf(identity);
    const pending = snapshot.value.records[key];
    if (!pending || pending.status !== "pending" || !pending.returnEventId)
      throw new Error("Returned continuation is unavailable.");
    const truth = threadTruth(thread);
    if (
      truth.activeTurnId &&
      truth.activeTurnId !== pending.originatingCodexTurnId
    )
      throw new Error("A different Codex turn is active.");
    const kind = truth.activeTurnId ? "turn/steer" : "turn/start";
    const commandId = stableCommandId(key, pending.returnEventId);
    const command: ContinuationCommand = {
      commandId,
      returnEventId: pending.returnEventId,
      kind,
      dispatchStatus: "not_started",
      payload: {
        roveContinuationCommandId: commandId,
        authoredBy: "host",
        instruction: pending.requestedInstruction,
      },
    };
    if (pending.continuationCommand) {
      if (fingerprint(pending.continuationCommand) !== fingerprint(command))
        throw new Error("Conflicting continuation command identity.");
      return;
    }
    await this.commit(snapshot.revision, {
      ...snapshot.value,
      records: {
        ...snapshot.value.records,
        [key]: { ...pending, continuationCommand: command },
      },
    });
  }

  async persistContinuationDispatchIntent(
    identity: ContinuationIdentity,
  ): Promise<void> {
    const snapshot = await this.read();
    if (!snapshot) throw new Error("Continuation state is unavailable.");
    const key = keyOf(identity);
    const pending = snapshot.value.records[key];
    const command = pending?.continuationCommand;
    if (!pending || !command)
      throw new Error("Continuation command is unavailable.");
    if (command.dispatchStatus !== "not_started") return;
    await this.commit(snapshot.revision, {
      ...snapshot.value,
      records: {
        ...snapshot.value.records,
        [key]: {
          ...pending,
          continuationCommand: {
            ...command,
            dispatchStatus: "possibly_started",
          },
        },
      },
    });
  }

  async dispatchPreparedContinuation(
    identity: ContinuationIdentity,
    rpc: CodexRpcPort,
  ): Promise<void> {
    const snapshot = await this.read();
    const pending = snapshot?.value.records[keyOf(identity)];
    const command = pending?.continuationCommand;
    if (!pending || !command || command.dispatchStatus !== "possibly_started")
      throw new Error("Prepared continuation dispatch is unavailable.");
    const input: UserInput[] = [
      { type: "text", text: command.payload.instruction, text_elements: [] },
    ];
    if (command.kind === "turn/steer")
      await rpc.request("turn/steer", {
        threadId: pending.codexThreadId,
        expectedTurnId: pending.originatingCodexTurnId,
        clientUserMessageId: command.commandId,
        input,
      });
    else
      await rpc.request("turn/start", {
        threadId: pending.codexThreadId,
        clientUserMessageId: command.commandId,
        input,
      });
  }
  async dispatchReturn(
    event: TrustedReturnEvent,
    thread: CodexThread,
    freshInspectionComplete: boolean,
    rpc: CodexRpcPort,
  ): Promise<"dispatched" | "pending" | "ignored"> {
    let snapshot = await this.read();
    if (!snapshot) return "ignored";
    const eventFingerprint = fingerprint(event);
    const previousEvent = snapshot.value.returnEventFingerprints[event.eventId];
    if (previousEvent !== undefined && previousEvent !== eventFingerprint)
      throw new Error("Return event identity collision.");
    const key = keyOf(event);
    let pending = snapshot.value.records[key];
    if (!pending || pending.status !== "pending") return "ignored";
    if (pending.continuationPolicy === "explicit_user_response")
      return "pending";
    if (pending.returnEventId === undefined) {
      if (!freshInspectionComplete && pending.freshInspection === undefined)
        throw new Error("Fresh post-return inspection is required.");
      if (
        event.observationSeq !== undefined &&
        pending.preHandoffObservationSeq !== undefined &&
        event.observationSeq <= pending.preHandoffObservationSeq
      )
        throw new Error("Stale Runtime return event.");
      pending = {
        ...pending,
        freshInspectionRequired: false,
        returnEventId: event.eventId,
        ...(event.observationSeq === undefined
          ? {}
          : { returnObservationSeq: event.observationSeq }),
      };
      snapshot = await this.commit(snapshot.revision, {
        records: { ...snapshot.value.records, [key]: pending },
        returnEventFingerprints: {
          ...snapshot.value.returnEventFingerprints,
          [event.eventId]: eventFingerprint,
        },
      });
    } else if (
      pending.returnEventId !== event.eventId ||
      pending.returnObservationSeq !== event.observationSeq
    ) {
      throw new Error("Return event identity collision.");
    }
    const truth = threadTruth(thread);
    if (
      truth.activeTurnId &&
      truth.activeTurnId !== pending.originatingCodexTurnId
    )
      return "pending";
    const kind =
      truth.activeTurnId === pending.originatingCodexTurnId
        ? "turn/steer"
        : "turn/start";
    const commandId =
      pending.continuationCommand?.commandId ??
      stableCommandId(key, event.eventId);
    const command: ContinuationCommand = pending.continuationCommand ?? {
      commandId,
      returnEventId: event.eventId,
      kind,
      dispatchStatus: "not_started",
      payload: {
        roveContinuationCommandId: commandId,
        authoredBy: "host",
        instruction: pending.requestedInstruction,
      },
    };
    if (command.returnEventId !== event.eventId || command.kind !== kind)
      throw new Error("Conflicting continuation dispatch.");
    if (command.dispatchStatus === "terminal") return "ignored";
    if (command.dispatchStatus === "possibly_started") return "pending";
    pending = {
      ...pending,
      continuationCommand: command,
    };
    snapshot = await this.commit(snapshot.revision, {
      records: { ...snapshot.value.records, [key]: pending },
      returnEventFingerprints: snapshot.value.returnEventFingerprints,
    });
    const possiblyStarted = {
      ...command,
      dispatchStatus: "possibly_started" as const,
    };
    pending = { ...pending, continuationCommand: possiblyStarted };
    await this.commit(snapshot.revision, {
      records: { ...snapshot.value.records, [key]: pending },
      returnEventFingerprints: snapshot.value.returnEventFingerprints,
    });
    const input: UserInput[] = [
      { type: "text", text: pending.requestedInstruction, text_elements: [] },
    ];
    if (kind === "turn/steer")
      await rpc.request("turn/steer", {
        threadId: pending.codexThreadId,
        expectedTurnId: pending.originatingCodexTurnId,
        clientUserMessageId: commandId,
        input,
      });
    else
      await rpc.request("turn/start", {
        threadId: pending.codexThreadId,
        clientUserMessageId: commandId,
        input,
      });
    return "dispatched";
  }
  async cancel(
    identity: ContinuationIdentity,
    status: "cancelled" | "superseded" = "cancelled",
  ): Promise<void> {
    const snapshot = await this.read();
    if (!snapshot) return;
    const key = keyOf(identity);
    const item = snapshot.value.records[key];
    if (!item) return;
    if (item.status === status) return;
    if (item.status !== "pending")
      throw new Error(`Continuation is ${item.status}.`);
    await this.commit(snapshot.revision, {
      ...snapshot.value,
      records: { ...snapshot.value.records, [key]: { ...item, status } },
    });
  }
  async reconcile(
    identity: ContinuationIdentity,
    thread: CodexThread,
  ): Promise<boolean> {
    const snapshot = await this.read();
    if (!snapshot) return false;
    const key = keyOf(identity);
    const item = snapshot.value.records[key];
    const command = item?.continuationCommand;
    if (!item || !command || command.dispatchStatus !== "possibly_started")
      return false;
    const truth = threadTruth(thread);
    const exactTurn = truth.commandTurns[command.commandId];
    if (!exactTurn || !truth.terminalTurnIds.has(exactTurn)) return false;
    if (item.status === "cancelled" || item.status === "superseded") {
      await this.commit(snapshot.revision, {
        ...snapshot.value,
        records: {
          ...snapshot.value.records,
          [key]: {
            ...item,
            continuationCommand: { ...command, dispatchStatus: "terminal" },
          },
        },
      });
      return false;
    }
    const next: PendingContinuation = {
      ...item,
      status: "consumed",
      consumedEventId: command.returnEventId,
      freshInspectionRequired: false,
      continuationCommand: { ...command, dispatchStatus: "terminal" },
    };
    await this.commit(snapshot.revision, {
      ...snapshot.value,
      records: { ...snapshot.value.records, [key]: next },
    });
    return true;
  }
}
