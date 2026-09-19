import { createHash, randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { readFile } from "node:fs/promises";
import { setTimeout as wait } from "node:timers/promises";
import type { RoveConfig } from "@rove/config";
import {
  FileEffectJournalStore,
  type EffectJournalRecord,
  type EffectJournalStore,
} from "@rove/storage";
import {
  RoveError,
  browserRecoveryAdmissionRequestSchema,
  MAX_BROWSER_RECOVERY_ATTEMPTS_PER_OPERATION,
  type BrowserRecoveryAdmissionRequest,
  type ActionResult,
  type ClickRequest,
  type ControlStatus,
  type ControlMutationAuthority,
  type ControlWaitRequest,
  type ControlWaitResult,
  type Evidence,
  type EvidenceReadResult,
  type InspectOptions,
  type NavigateRequest,
  type ObservationPage,
  type ObservationQuery,
  type PageInspection,
  type PageSummary,
  type PressRequest,
  type RoveRuntime,
  type SaveEvidenceRequest,
  type ScreenshotOptions,
  type ScrollOptions,
  type Session,
  type SessionMode,
  type StartSessionRequest,
  type TypeRequest,
  type RequestHumanRequest,
  type RuntimeSessionInventory,
  MAX_GENERATED_FILE_BYTES,
  MAX_GRANTED_FILE_BYTES,
  fileArtifactMimeTypeSchema,
  fileArtifactNameSchema,
  requestHumanRequestSchema,
  controlWaitRequestSchema,
  verifiedInteractionRequestSchema,
  type ActionReceipt,
  type BrowserObservation,
  type BrowserActionProposal,
  type TargetResolution,
  type TargetResolutionRequest,
  type VerifiedInteractionRequest,
  startSessionRequestSchema,
  type BrowserProfileConfig,
  type BrowserWorkspace,
  type BrowserWorkspaceStatus,
  beginSemanticTransactionRequestSchema,
  advanceSemanticTransactionRequestSchema,
  verifySemanticTransactionRequestSchema,
  semanticTransactionReferenceSchema,
  transactionCommitEffect,
  type BeginSemanticTransactionRequest,
  type AdvanceSemanticTransactionRequest,
  type VerifySemanticTransactionRequest,
  type SemanticTransactionSnapshot,
  type SemanticTransactionAdvanceResult,
  type SemanticTransactionVerificationResult,
  type ExpectedEffect,
  type PrepareTaskResultActionRequest,
  type TaskResultActionPlan,
  type Recording,
  type StartRecordingRequest,
  type ConsequentialEffectReconciliationResult,
  type ReconcileConsequentialEffectRequest,
} from "@rove/protocol";
import {
  BrowserWorkspaceRegistry,
  RoveProfileLock,
  InteractionDispatchError,
  InteractionNotDispatchedError,
} from "@rove/browser";
import type {
  BrowserActivity,
  BrowserSession,
  FocusedPageTextRead,
} from "@rove/browser";
import { BrowserService } from "./browser/browser.service.js";
import { BrowserCommandCoordinator } from "./control/command-coordinator.js";
import {
  BrowserOwnershipFence,
  type BrowserOwnershipLease,
} from "./control/browser-ownership-fence.js";
import { ControlService } from "./control/control.service.js";
import { ControlWaitService } from "./control/control-wait.service.js";
import { OwnershipTransitionService } from "./control/ownership-transition.service.js";
import { EvidenceService } from "./evidence/evidence.service.js";
import { detectDownloadMimeType } from "./evidence/download-mime.js";
import { ObservationService } from "./observation/observation.service.js";
import { RecordingService } from "./recording/recording.service.js";
import { PagePolicyOrchestrator } from "./orchestration/page-policy-orchestrator.js";
import {
  InteractionPolicy,
  type PageInspectionPolicyRecord,
} from "./policy/interaction-policy.js";
import { SessionService } from "./session/session.service.js";
import { EFFECT_JOURNAL_STORE, ROVE_CONFIG } from "./tokens.js";
import {
  assessExpectedEffectEvidenceSuitability,
  classifyActionOutcome,
  createExpectedEffectVerificationBasis,
  interactionSignature,
  interactionTarget,
  interactionActionProposal,
  verifyExpectedEffects,
  verifyExpectedCurrentStates,
  verifyExpectedEffectsFromBasis,
  sameExpectedEffectVerificationBasis,
  type FocusedPageTextEvidence,
} from "./interaction/verified-interaction.js";
import { ConsequenceReplayFence } from "./interaction/consequence-replay-fence.js";
import { SemanticTransactionStore } from "./interaction/semantic-transaction-store.js";
import { RUNTIME_PROVENANCE } from "./runtime-provenance.js";

function normalizedIdentity(value: string | undefined): string {
  return (value ?? "").replace(/\s+/gu, " ").trim().toLowerCase();
}

async function readFocusedPageTextEvidence(
  browser: BrowserSession,
  observation: BrowserObservation,
  expectedEffects: ExpectedEffect[],
): Promise<Map<string, FocusedPageTextRead>> {
  if (
    observation.text !== undefined &&
    observation.metadata?.textTruncated !== true
  ) {
    return new Map();
  }

  const queries = new Set(
    expectedEffects.flatMap((effect) =>
      effect.kind === "text_present" || effect.kind === "text_absent"
        ? [effect.text]
        : [],
    ),
  );
  const evidence = new Map<string, FocusedPageTextRead>();
  for (const query of queries) {
    evidence.set(
      query,
      await browser.readPageText(observation.observationId, query),
    );
  }
  return evidence;
}

function taskResultPlanActionFingerprint(input: {
  action: PrepareTaskResultActionRequest["commitAction"];
  expectedEffects: PrepareTaskResultActionRequest["expectedEffects"];
  effect: PrepareTaskResultActionRequest["effect"];
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        action: input.action,
        expectedEffects: input.expectedEffects,
        effect: input.effect,
      }),
    )
    .digest("hex");
}

function exactTaskResultFiles(
  actual: readonly { name: string; size: number; sha256: string }[],
  expected: readonly { filename: string; size: number; sha256: string }[],
): boolean {
  const identities = (
    files: readonly { name: string; size: number; sha256: string }[],
  ) =>
    files
      .map((file) => `${file.name}\u0000${file.size}\u0000${file.sha256}`)
      .sort();
  return (
    JSON.stringify(identities(actual)) ===
    JSON.stringify(
      identities(
        expected.map((binding) => ({
          name: binding.filename,
          size: binding.size,
          sha256: binding.sha256,
        })),
      ),
    )
  );
}

const unavailableRecordingService = {
  start: async () => {
    throw new RoveError({
      code: "RECORDING_SCOPE_UNAVAILABLE",
      message: "Recording service is unavailable.",
    });
  },
  stop: async () => {
    throw new RoveError({
      code: "RECORDING_SCOPE_UNAVAILABLE",
      message: "Recording service is unavailable.",
    });
  },
  get: async () => {
    throw new RoveError({
      code: "RECORDING_SCOPE_UNAVAILABLE",
      message: "Recording service is unavailable.",
    });
  },
  list: async () => [],
  stopAll: async () => undefined,
  stopForPage: async () => undefined,
  stopBeforeSensitiveType: async () => undefined,
  interruptForPage: async () => undefined,
} as unknown as RecordingService;

function sameExpectedTarget(
  effect: ExpectedEffect,
  source: SemanticTransactionSnapshot["source"],
): boolean {
  if (!("target" in effect)) return false;
  return (
    normalizedIdentity(effect.target.name) ===
      normalizedIdentity(source.name) &&
    (effect.target.kind === undefined ||
      source.kind === undefined ||
      effect.target.kind === source.kind)
  );
}

function hasBoundedTransferCommitEvidence(
  transaction: SemanticTransactionSnapshot,
  request: AdvanceSemanticTransactionRequest,
): boolean {
  if (request.phase !== "commit") return true;

  return request.expectedEffects.some((effect) => {
    if (!sameExpectedTarget(effect, transaction.source)) return false;

    if (transaction.destination.verification === "within_scope") {
      return (
        effect.kind === "target_within_scope" &&
        effect.scope.kind === transaction.destination.scope.kind &&
        normalizedIdentity(effect.scope.label) ===
          normalizedIdentity(transaction.destination.scope.label)
      );
    }

    if (
      request.action.kind === "clipboard" &&
      request.action.operation === "paste"
    ) {
      return effect.kind === "target_present";
    }

    return (
      effect.kind === "target_absent" || effect.kind === "target_within_scope"
    );
  });
}

function hasIndependentDestinationContextEvidence(
  transaction: SemanticTransactionSnapshot,
  effects: ExpectedEffect[],
): boolean {
  return effects.some(
    (effect) =>
      !(
        effect.kind === "target_present" &&
        sameExpectedTarget(effect, transaction.source)
      ),
  );
}

function isTrustedClipboardPrepare(
  transaction: SemanticTransactionSnapshot,
  request: AdvanceSemanticTransactionRequest,
): boolean {
  return (
    request.phase === "prepare" &&
    transaction.mechanism === "keyboard" &&
    request.action.kind === "clipboard" &&
    request.action.target === undefined &&
    (request.action.operation === "copy" ||
      request.action.operation === "cut") &&
    request.expectedEffects.length === 0
  );
}

function observationHasSelectedSource(
  observation: BrowserObservation,
  transaction: SemanticTransactionSnapshot,
): boolean {
  return (
    observation.pageId === transaction.sourceAuthority.pageId &&
    (observation.targets ?? []).some(
      (target) =>
        normalizedIdentity(target.name) ===
          normalizedIdentity(transaction.source.name) &&
        (transaction.source.kind === undefined ||
          target.kind === transaction.source.kind) &&
        target.state?.selected === true,
    )
  );
}

const MAX_INLINE_SCREENSHOT_BYTES = 2 * 1024 * 1024;
const CONSEQUENTIAL_RECONCILIATION_DELAYS_MS = [
  250, 750, 1_500, 2_500,
] as const;

interface DownloadEffectSignal {
  state: "observed" | "contradicted" | "unresolved";
  filename?: string;
  observationId?: string;
  evidenceId?: string;
  code?: string;
}

interface DownloadEffectWaiter {
  resolve: (signal: DownloadEffectSignal) => void;
  timeout: ReturnType<typeof setTimeout>;
}

@Injectable()
export class RuntimeService implements RoveRuntime {
  private readonly consequenceReplayFence = new ConsequenceReplayFence();
  private readonly semanticTransactions = new SemanticTransactionStore();

  private readonly humanActivityQueues = new Map<string, Promise<void>>();
  private readonly browserEvidenceQueues = new Map<string, Promise<void>>();
  private readonly lastAgentActionAt = new Map<string, number>();
  private readonly bootstrapStarts = new Map<string, Promise<Session>>();
  private readonly downloadEffectWaiters = new Map<
    string,
    DownloadEffectWaiter
  >();
  private readonly browserWorkspaces: BrowserWorkspaceRegistry;
  private readonly interactionPolicy = new InteractionPolicy();
  private readonly ownershipTransitions: OwnershipTransitionService;
  private readonly pagePolicyOrchestrator: PagePolicyOrchestrator;
  private readonly effectJournalReady: Promise<void>;

  constructor(
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(ControlService) private readonly control: ControlService,
    @Inject(ControlWaitService)
    private readonly controlWait: ControlWaitService,
    @Inject(BrowserCommandCoordinator)
    private readonly coordinator: BrowserCommandCoordinator,
    @Inject(BrowserService) private readonly browser: BrowserService,
    @Inject(ObservationService)
    private readonly observations: ObservationService,
    @Inject(EvidenceService) private readonly evidence: EvidenceService,
    @Inject(ROVE_CONFIG) private readonly config: RoveConfig,
    @Inject(BrowserOwnershipFence)
    private readonly ownershipFence: BrowserOwnershipFence = new BrowserOwnershipFence(),
    @Inject(EFFECT_JOURNAL_STORE)
    private readonly effectJournal: EffectJournalStore = new FileEffectJournalStore(
      config.home,
    ),
    @Inject(RecordingService)
    private readonly recordings: RecordingService = unavailableRecordingService,
  ) {
    this.browserWorkspaces = new BrowserWorkspaceRegistry(this.config.home);
    this.effectJournalReady = this.initializeEffectJournalCutover();
    // Keep construction non-blocking without allowing an intentionally deferred
    // initialization failure to surface as an unhandled rejection. Operations
    // that depend on the journal still await the original rejecting promise.
    void this.effectJournalReady.catch(() => undefined);
    this.ownershipTransitions = new OwnershipTransitionService(
      this.sessions,
      this.control,
      this.controlWait,
      this.browser,
      this.observations,
      this.ownershipFence,
      this.interactionPolicy,
    );

    this.pagePolicyOrchestrator = new PagePolicyOrchestrator(
      this.ownershipTransitions,
    );
  }

  async listBrowserWorkspaces(): Promise<BrowserWorkspaceStatus> {
    return this.browserWorkspaces.status();
  }

  async createBrowserWorkspace(displayName: string): Promise<BrowserWorkspace> {
    // The cutover inventory must be durable before any post-cutover scope can
    // be created; otherwise a concurrent startup can misclassify fresh work
    // as historical uncertainty and can outlive the caller during shutdown.
    await this.effectJournalReady;
    return this.browserWorkspaces.create({
      displayName,
      browser: this.config.browser.preferredBrowser,
    });
  }

  async selectBrowserWorkspace(
    workspaceId: string,
  ): Promise<BrowserWorkspaceStatus> {
    await this.effectJournalReady;
    await this.browserWorkspaces.select(workspaceId);
    return this.browserWorkspaces.status();
  }

  async renameBrowserWorkspace(
    workspaceId: string,
    displayName: string,
  ): Promise<BrowserWorkspaceStatus> {
    await this.effectJournalReady;
    await this.browserWorkspaces.rename(workspaceId, displayName);
    return this.browserWorkspaces.status();
  }

  async deleteBrowserWorkspace(
    workspaceId: string,
  ): Promise<BrowserWorkspaceStatus> {
    await this.effectJournalReady;
    const inUse = (await this.sessions.list()).some(
      (session) =>
        session.workspace?.id === workspaceId &&
        session.status !== "completed" &&
        session.status !== "failed",
    );
    if (inUse || this.browser.hasWorkspace(workspaceId)) {
      throw new RoveError({
        code: "PROFILE_LOCKED",
        message:
          "Finish or reconcile the browser host using this profile before deleting it.",
      });
    }
    return this.browserWorkspaces.delete(workspaceId);
  }

  async startSession(request: StartSessionRequest): Promise<Session> {
    await this.effectJournalReady;
    const input = startSessionRequestSchema.parse(request);
    if (input.bootstrapId === undefined) return this.startSessionOnce(input);

    const pending = this.bootstrapStarts.get(input.bootstrapId);
    if (pending !== undefined) {
      await pending;
      return this.startSessionOnce(input);
    }

    const start = this.startSessionOnce(input);
    this.bootstrapStarts.set(input.bootstrapId, start);
    try {
      return await start;
    } finally {
      if (this.bootstrapStarts.get(input.bootstrapId) === start)
        this.bootstrapStarts.delete(input.bootstrapId);
    }
  }

  private async startSessionOnce(
    input: ReturnType<typeof startSessionRequestSchema.parse>,
  ): Promise<Session> {
    let workspace: BrowserWorkspace | undefined;
    let profile: BrowserProfileConfig = { mode: "temporary" };
    if (input.browser.mode === "workspace") {
      workspace = await this.browserWorkspaces.resolveForSession(
        "workspaceId" in input.browser ? input.browser.workspaceId : undefined,
      );
      profile = { mode: "persistent", name: workspace.id };
    }
    let session = await this.sessions.start(input, {
      profile,
      ...(workspace === undefined ? {} : { workspace }),
    });
    if (this.browser.has(session.id)) return session;
    this.ownershipFence.initialize(
      session.id,
      session.controller,
      session.ownershipGeneration ?? 1,
    );
    try {
      const browser = await this.browser.start(session.id, {
        headless: this.config.browser.headless,
        browser: workspace?.browser ?? this.config.browser.preferredBrowser,
        ...(this.config.browser.executablePath === undefined
          ? {}
          : {
              executablePath: this.config.browser.executablePath,
            }),
        profile: session.profile,
        ...(workspace === undefined
          ? {}
          : { profileUserDataDir: workspace.userDataDir }),
        ownership: {
          runtimeInstanceId: RUNTIME_PROVENANCE.runtimeInstanceId,
          sessionId: session.id,
        },
        timeouts: {
          launchMs: this.config.timeouts.launchMs,
          navigationMs: this.config.timeouts.navigationMs,
          actionMs: this.config.timeouts.actionMs,
          inspectMs: this.config.timeouts.inspectMs,
        },
      });
      browser.onActivity((activity) => {
        this.persistBrowserActivity(session.id, activity);
      });

      if (session.controller === "human") {
        await this.browser.beginHumanControl(session.id);
      }

      if (input.startUrl !== undefined) await browser.navigate(input.startUrl);
      const activePageId = (await browser.pages()).find(
        (page) => page.active,
      )?.id;
      let assessment: PageInspectionPolicyRecord | undefined;

      try {
        assessment = await this.assessBrowser(session.id, browser);
      } catch (error) {
        if (!(error instanceof RoveError) || error.code !== "PAGE_CHANGED") {
          throw error;
        }
      }

      session = await this.sessions.update({
        ...session,
        status: "active",
        ...(activePageId === undefined ? {} : { activePageId }),
        browserRuntime: browser.capabilities,
      });

      await this.observations.append(session.id, {
        actor: "system",
        type: "session_started",
        data: {
          mode: session.mode,
          controller: session.controller,
          browserIdentity:
            workspace === undefined
              ? { mode: "temporary" }
              : { mode: "workspace", workspaceId: workspace.id },
        },
      });

      if (assessment !== undefined) {
        await this.pagePolicyOrchestrator.orchestrate(
          session.id,
          assessment.policyDecision,
          assessment.pageState,
          "session_start",
        );
      }

      return this.sessions.get(session.id);
    } catch (error) {
      this.ownershipFence.clear(session.id);
      await this.browser.close(session.id).catch(() => undefined);
      const now = new Date().toISOString();
      await this.sessions.update({
        ...session,
        status: "failed",
        controller: null,
        endedAt: now,
        updatedAt: now,
      });
      const observation = await this.observations.append(session.id, {
        actor: "system",
        type: "session_failed",
        data: {},
      });
      await this.controlWait.publish(session.id, observation);
      throw error;
    }
  }

  getSession(sessionId: string): Promise<Session> {
    return this.sessions.get(sessionId);
  }

  async admitBrowserRecovery(
    sessionId: string,
    request: BrowserRecoveryAdmissionRequest,
  ): Promise<{ admittedAttempt: number; remainingAttempts: number }> {
    const input = browserRecoveryAdmissionRequestSchema.parse(request);
    return this.coordinator.execute(sessionId, async () => {
      const session = await this.sessions.get(sessionId);
      this.sessions.assertActive(session);
      if (input.consequentialOutcome === "unknown")
        throw new RoveError({
          code: "CONSEQUENTIAL_ACTION_UNRESOLVED",
          message:
            "An unknown consequential browser outcome cannot enter recovery.",
          retryable: false,
        });
      const admissions = [...(session.browserRecoveryAdmissions ?? [])];
      const existing = admissions.find(
        (entry) => entry.operationId === input.operationId,
      );
      if (existing && existing.kind !== input.kind)
        throw new RoveError({
          code: "ACTION_BUDGET_EXCEEDED",
          message: "Browser recovery operation identity changed meaning.",
          retryable: false,
        });
      if (
        existing &&
        existing.attempts >= MAX_BROWSER_RECOVERY_ATTEMPTS_PER_OPERATION
      )
        throw new RoveError({
          code: "ACTION_BUDGET_EXCEEDED",
          message:
            "Browser recovery stopped after two admitted attempts for this operation.",
          retryable: false,
          details: {
            operationId: input.operationId,
            attempts: existing.attempts,
          },
        });
      const now = new Date().toISOString();
      const attempts = (existing?.attempts ?? 0) + 1;
      const next = admissions.filter(
        (entry) => entry.operationId !== input.operationId,
      );
      next.push({
        operationId: input.operationId,
        kind: input.kind,
        attempts,
        updatedAt: now,
      });
      await this.sessions.update({
        ...session,
        browserRecoveryAdmissions: next,
        updatedAt: now,
      });
      return {
        admittedAttempt: attempts,
        remainingAttempts:
          MAX_BROWSER_RECOVERY_ATTEMPTS_PER_OPERATION - attempts,
      };
    });
  }

  async getBrowserHostIdentity(sessionId: string) {
    await this.sessions.get(sessionId);

    if (!this.browser.has(sessionId)) {
      return null;
    }

    return this.browser.hostIdentity(sessionId);
  }

  async getBrowserWindowState(sessionId: string) {
    await this.sessions.get(sessionId);

    if (!this.browser.has(sessionId)) {
      return null;
    }

    return this.browser.windowState(sessionId);
  }

  async showBrowser(
    sessionId: string,
    authority: ControlMutationAuthority,
  ): Promise<boolean> {
    return this.coordinator.execute(sessionId, async () => {
      await this.ownershipTransitions.assertExactControlAuthority(
        sessionId,
        authority,
      );
      return this.browser.show(sessionId);
    });
  }

  async listActiveSessions(mode?: SessionMode): Promise<Session[]> {
    return (await this.listSessionInventory(mode))
      .map((entry) => entry.session)
      .filter((session) =>
        ["starting", "active", "paused", "awaiting_human"].includes(
          session.status,
        ),
      );
  }

  async listSessionInventory(
    mode?: SessionMode,
  ): Promise<RuntimeSessionInventory[]> {
    const sessions = (await this.sessions.list()).filter(
      (session) => mode === undefined || session.mode === mode,
    );
    return Promise.all(
      sessions.map((session) => this.sessionInventory(session)),
    );
  }

  async recoverSession(sessionId: string): Promise<RuntimeSessionInventory> {
    return this.coordinator.execute(sessionId, async () => {
      let session = await this.sessions.get(sessionId);
      const before = await this.sessionInventory(session);
      if (before.attachment === "attached" || before.recovery === "not_needed")
        return before;
      if (["completed", "failed"].includes(session.status)) {
        await this.browser.close(sessionId);
        await this.releaseProfileLock(sessionId);
        this.ownershipFence.clear(sessionId);
        return this.sessionInventory(await this.sessions.get(sessionId));
      }
      if (
        session.profile.mode !== "persistent" ||
        session.workspace === undefined
      ) {
        session = await this.sessions.update({
          ...session,
          status: "failed",
          controller: null,
          endedAt: new Date().toISOString(),
        });
        return this.sessionInventory(session);
      }
      if (before.recovery !== "relaunchable") return before;
      this.ownershipFence.initialize(
        session.id,
        session.controller,
        session.ownershipGeneration ?? 1,
      );
      try {
        const browser = await this.browser.start(session.id, {
          headless: this.config.browser.headless,
          browser: session.workspace.browser,
          ...(this.config.browser.executablePath === undefined
            ? {}
            : { executablePath: this.config.browser.executablePath }),
          profile: session.profile,
          profileUserDataDir: session.workspace.userDataDir,
          ownership: {
            runtimeInstanceId: RUNTIME_PROVENANCE.runtimeInstanceId,
            sessionId: session.id,
          },
          timeouts: {
            launchMs: this.config.timeouts.launchMs,
            navigationMs: this.config.timeouts.navigationMs,
            actionMs: this.config.timeouts.actionMs,
            inspectMs: this.config.timeouts.inspectMs,
          },
        });
        browser.onActivity((activity) => {
          this.persistBrowserActivity(session.id, activity);
        });
        if (session.controller === "human") {
          await this.browser.beginHumanControl(session.id);
        }
        const activePageId = (await browser.pages()).find(
          (page) => page.active,
        )?.id;
        session = await this.sessions.update({
          ...session,
          ...(activePageId === undefined ? {} : { activePageId }),
          browserRuntime: browser.capabilities,
        });
        return this.sessionInventory(session);
      } catch (error) {
        this.ownershipFence.clear(session.id);
        await this.browser.close(session.id).catch(() => undefined);
        throw error;
      }
    });
  }

  private async sessionInventory(
    session: Session,
  ): Promise<RuntimeSessionInventory> {
    const attachment = this.browser.has(session.id) ? "attached" : "missing";
    const terminal = ["completed", "failed"].includes(session.status);
    const browserIdentity =
      session.workspace === undefined
        ? ({ mode: "temporary" } as const)
        : ({ mode: "workspace", workspaceId: session.workspace.id } as const);
    let profileOwnership: RuntimeSessionInventory["profileOwnership"] =
      "released";
    if (session.workspace !== undefined) {
      profileOwnership = this.browser.has(session.id)
        ? "owned"
        : this.browser.hasWorkspace(session.workspace.id)
          ? "claimable"
          : await RoveProfileLock.ownershipStatus(
              session.workspace.userDataDir,
              {
                runtimeInstanceId: RUNTIME_PROVENANCE.runtimeInstanceId,
                sessionId: session.id,
              },
            );
      if (terminal && profileOwnership === "claimable")
        profileOwnership = "released";
    }
    let recovery: RuntimeSessionInventory["recovery"];
    const cutover = await this.effectJournal.cutover();
    const legacyScopes = [
      `task:${session.bootstrapId ?? session.id}`,
      `workspace:${session.workspace?.id ?? session.id}`,
    ]
      .map((scope) => cutover?.legacyScopes[scope])
      .filter((entry) => entry !== undefined);
    const legacyEffects: NonNullable<RuntimeSessionInventory["legacyEffects"]> =
      legacyScopes.some((entry) => entry.acknowledgedAt === undefined)
        ? "acknowledgement_required"
        : legacyScopes.length > 0
          ? "acknowledged"
          : "not_applicable";
    let diagnostic: string | undefined;
    if (terminal) {
      recovery = "cleanup_required";
      diagnostic = "The persisted session is terminal.";
    } else if (
      attachment === "attached" &&
      (session.workspace === undefined || profileOwnership === "owned")
    ) {
      recovery = "not_needed";
    } else if (
      attachment === "missing" &&
      session.workspace !== undefined &&
      profileOwnership === "claimable"
    ) {
      recovery = "relaunchable";
      diagnostic = "The named browser workspace can be reattached.";
    } else if (attachment === "missing" && session.workspace === undefined) {
      recovery = "unrecoverable";
      diagnostic = "The Temporary browser attachment cannot be restored.";
    } else {
      recovery = "cleanup_required";
      diagnostic = "Browser attachment or profile ownership is conflicting.";
    }
    return {
      schemaVersion: 1,
      session,
      browserIdentity,
      attachment,
      recovery,
      profileOwnership,
      legacyEffects,
      ...(diagnostic === undefined ? {} : { diagnostic }),
    };
  }

  async endSession(sessionId: string): Promise<Session> {
    const session = await this.sessions.get(sessionId);
    if (
      !["completed", "failed"].includes(session.status) &&
      !this.ownershipFence.has(sessionId)
    )
      this.ownershipFence.initialize(
        sessionId,
        session.controller,
        session.ownershipGeneration ?? 1,
      );
    await this.recordings.stopAll(sessionId);
    return this.coordinator.execute(sessionId, () =>
      this.ownershipTransitions.endSession(sessionId, {
        flushHumanActivity: () => this.flushHumanActivity(sessionId),
        flushBrowserEvidence: () => this.flushBrowserEvidence(sessionId),
        clearRuntimeState: () => {
          this.lastAgentActionAt.delete(sessionId);
          this.consequenceReplayFence.clearSession(sessionId);
          this.semanticTransactions.clearSession(sessionId);
        },
        releaseProfileLock: () => this.releaseProfileLock(sessionId),
      }),
    );
  }

  async inspectBrowser(
    sessionId: string,
    options?: InspectOptions,
    signal?: AbortSignal,
  ): Promise<PageInspection> {
    await this.requireActive(sessionId);

    return this.ownershipFence.runAgentBrowserOperation(
      sessionId,
      async (lease) => {
        const inspection = await this.browser
          .get(sessionId)
          .inspect(options, signal);

        // A stale inspection must never enter InteractionPolicy.
        lease.assertCurrent();

        const assessment = this.interactionPolicy.recordInspection(
          sessionId,
          inspection,
        );

        lease.assertCurrent();

        return {
          ...inspection,
          sessionId,
          metadata: {
            ...(inspection.metadata ?? {}),
            pagePolicy: assessment.policyDecision,
          },
        };
      },
    );
  }

  resolveBrowserTarget(
    sessionId: string,
    request: TargetResolutionRequest,
  ): Promise<TargetResolution> {
    return this.ownershipFence.runAgentBrowserOperation(
      sessionId,
      async (lease) => {
        const result = await this.browser.get(sessionId).resolveTarget(request);

        lease.assertCurrent();

        return result;
      },
    );
  }

  async beginSemanticTransaction(
    sessionId: string,
    request: BeginSemanticTransactionRequest,
  ): Promise<SemanticTransactionSnapshot> {
    const input = beginSemanticTransactionRequestSchema.parse(request);
    await this.requireActive(sessionId);

    const existing = this.semanticTransactions.existingFor(
      sessionId,
      input.consequenceKey,
    );
    if (existing !== undefined) {
      if (
        existing.kind !== input.kind ||
        existing.mechanism !== input.mechanism ||
        existing.sourceAuthority.pageId !== input.sourceTarget.pageId ||
        existing.sourceAuthority.revision !== input.sourceTarget.revision ||
        existing.sourceAuthority.ref !== input.sourceTarget.ref ||
        JSON.stringify(existing.destination) !==
          JSON.stringify(input.destination)
      ) {
        throw new RoveError({
          code: "TRANSACTION_CONFLICT",
          message:
            "The consequence key already identifies a different semantic transaction.",
        });
      }
      return existing;
    }

    this.consequenceReplayFence.assertAvailable(
      sessionId,
      input.consequenceKey,
    );

    const transaction = await this.ownershipFence.runAgentBrowserOperation(
      sessionId,
      async (lease) => {
        const observation = await this.browser
          .get(sessionId)
          .readObservation(input.observationId);
        lease.assertCurrent();
        if (
          input.sourceTarget.pageId !== observation.pageId ||
          input.sourceTarget.revision !== observation.revision
        ) {
          throw new RoveError({
            code: "TARGET_STALE",
            message:
              "The transaction source does not belong to the current observation revision.",
            retryable: true,
          });
        }
        const source = observation.targets?.find(
          (target) => target.ref === input.sourceTarget.ref,
        );
        if (source === undefined) {
          throw new RoveError({
            code: "TARGET_NOT_FOUND",
            message:
              "The transaction source is not present in the observation.",
          });
        }
        if (source.name === undefined) {
          throw new RoveError({
            code: "TARGET_NOT_INTERACTIVE",
            message:
              "The transaction source requires a stable accessible name for destination verification.",
          });
        }
        return this.semanticTransactions.begin(sessionId, input, {
          name: source.name,
          kind: source.kind,
        });
      },
    );

    try {
      await this.observations.append(sessionId, {
        actor: "agent",
        type: "semantic_transaction_begun",
        data: {
          transactionId: transaction.transactionId,
          kind: transaction.kind,
          mechanism: transaction.mechanism,
          source: transaction.source,
          destination: transaction.destination,
        },
        pageId: input.sourceTarget.pageId,
        pageRevision: input.sourceTarget.revision,
      });
      return transaction;
    } catch (error) {
      return this.semanticTransactions.recordDegradation(
        sessionId,
        transaction.transactionId,
        error instanceof RoveError ? error.code : "EVIDENCE_WRITE_FAILED",
      );
    }
  }

  async advanceSemanticTransaction(
    sessionId: string,
    request: AdvanceSemanticTransactionRequest,
  ): Promise<SemanticTransactionAdvanceResult> {
    const input = advanceSemanticTransactionRequestSchema.parse(request);
    await this.requireActive(sessionId);
    const transaction = this.semanticTransactions.acquireAdvance(
      sessionId,
      input.transactionId,
      input.observationId,
    );
    try {
      const commit = input.phase === "commit";
      if (!hasBoundedTransferCommitEvidence(transaction, input)) {
        throw new RoveError({
          code: "TRANSACTION_STATE_INVALID",
          message:
            "A transfer commit must verify the exact source target changed location, or appeared after an explicit paste; unrelated or pre-existing page text is not commit evidence.",
        });
      }
      const trustedClipboardPrepare = isTrustedClipboardPrepare(
        transaction,
        input,
      );
      if (trustedClipboardPrepare) {
        const sourceSelected =
          await this.ownershipFence.runAgentBrowserOperation(
            sessionId,
            async (lease) => {
              const observation = await this.browser
                .get(sessionId)
                .readObservation(input.observationId);
              lease.assertCurrent();
              return observationHasSelectedSource(observation, transaction);
            },
          );
        if (!sourceSelected) {
          throw new RoveError({
            code: "TRANSACTION_STATE_INVALID",
            message:
              "Trusted clipboard staging requires the exact transaction source to be selected in the supplied observation.",
          });
        }
      }
      const receipt = await this.interact(sessionId, {
        observationId: input.observationId,
        action: input.action,
        expectedEffects: input.expectedEffects,
        consequential: commit,
        ...(commit
          ? {
              consequenceKey: transaction.consequenceKey,
              effect: transactionCommitEffect(input.effect),
            }
          : input.effect === undefined
            ? {}
            : { effect: input.effect }),
      });
      let updated = this.semanticTransactions.recordStep(
        sessionId,
        input.transactionId,
        input.phase,
        receipt,
        { acceptCompletedPrepareDispatch: trustedClipboardPrepare },
      );
      try {
        await this.observations.append(sessionId, {
          actor: "agent",
          type: "semantic_transaction_advanced",
          data: {
            transactionId: updated.transactionId,
            phase: input.phase,
            receiptId: receipt.receiptId,
            outcome: receipt.outcome,
            status: updated.status,
          },
          ...(receipt.target === undefined
            ? {}
            : { pageId: receipt.target.pageId }),
          ...(receipt.currentRevision === undefined
            ? {}
            : { pageRevision: receipt.currentRevision }),
        });
      } catch (error) {
        updated = this.semanticTransactions.recordDegradation(
          sessionId,
          updated.transactionId,
          error instanceof RoveError ? error.code : "EVIDENCE_WRITE_FAILED",
        );
      }
      return { transaction: updated, receipt };
    } catch (error) {
      this.semanticTransactions.releaseAdvance(sessionId, input.transactionId);
      throw error;
    }
  }

  async verifySemanticTransaction(
    sessionId: string,
    request: VerifySemanticTransactionRequest,
  ): Promise<SemanticTransactionVerificationResult> {
    const input = verifySemanticTransactionRequestSchema.parse(request);
    await this.requireActive(sessionId);
    const transaction = this.semanticTransactions.get(
      sessionId,
      input.transactionId,
    );
    const retryingUnknownVerification =
      transaction.status === "uncertain" &&
      transaction.verification?.outcome === "unknown";
    if (transaction.status !== "committed" && !retryingUnknownVerification) {
      throw new RoveError({
        code: "TRANSACTION_STATE_INVALID",
        message: "Only a committed semantic transaction can be verified.",
      });
    }

    const verification = await this.ownershipFence.runAgentBrowserOperation(
      sessionId,
      async (lease) => {
        const browser = this.browser.get(sessionId);
        const observation = await browser.readObservation(input.observationId);
        lease.assertCurrent();

        if (
          transaction.destination.verification === "destination_observation" &&
          !hasIndependentDestinationContextEvidence(
            transaction,
            input.additionalExpectedEffects,
          )
        ) {
          throw new RoveError({
            code: "TRANSACTION_STATE_INVALID",
            message:
              "Remote destination verification requires at least one independent destination outcome, such as the exact destination URL or breadcrumb.",
          });
        }

        const requiredEffects: ExpectedEffect[] =
          transaction.destination.verification === "within_scope"
            ? [
                {
                  kind: "target_within_scope",
                  target: transaction.source,
                  scope: transaction.destination.scope,
                },
              ]
            : [
                {
                  kind: "target_present",
                  target: transaction.source,
                },
              ];
        const expectedEffects = [
          ...requiredEffects,
          ...input.additionalExpectedEffects,
        ];
        const focusedTextEvidence = await readFocusedPageTextEvidence(
          browser,
          observation,
          expectedEffects,
        );
        lease.assertCurrent();
        const effects = verifyExpectedCurrentStates(
          expectedEffects,
          observation,
          focusedTextEvidence,
        );
        const outcome = classifyActionOutcome(effects);
        const updated = this.semanticTransactions.recordVerification(
          sessionId,
          input.transactionId,
          input.observationId,
          outcome,
          effects,
        );
        return { transaction: updated, outcome, effects };
      },
    );

    try {
      await this.observations.append(sessionId, {
        actor: "agent",
        type: "semantic_transaction_verified",
        data: {
          transactionId: verification.transaction.transactionId,
          outcome: verification.outcome,
          status: verification.transaction.status,
          effects: verification.effects.map((effect) => ({
            kind: effect.effect.kind,
            state: effect.state,
          })),
        },
      });
    } catch (error) {
      verification.transaction = this.semanticTransactions.recordDegradation(
        sessionId,
        verification.transaction.transactionId,
        error instanceof RoveError ? error.code : "EVIDENCE_WRITE_FAILED",
      );
    }
    return verification;
  }

  async getSemanticTransaction(
    sessionId: string,
    transactionId: string,
  ): Promise<SemanticTransactionSnapshot> {
    await this.sessions.get(sessionId);
    return this.semanticTransactions.get(sessionId, transactionId);
  }

  async cancelSemanticTransaction(
    sessionId: string,
    transactionId: string,
  ): Promise<SemanticTransactionSnapshot> {
    semanticTransactionReferenceSchema.parse({ transactionId });
    await this.requireActive(sessionId);
    let transaction = this.semanticTransactions.cancel(
      sessionId,
      transactionId,
    );
    try {
      await this.observations.append(sessionId, {
        actor: "agent",
        type: "semantic_transaction_cancelled",
        data: { transactionId },
      });
    } catch (error) {
      transaction = this.semanticTransactions.recordDegradation(
        sessionId,
        transactionId,
        error instanceof RoveError ? error.code : "EVIDENCE_WRITE_FAILED",
      );
    }
    return transaction;
  }

  async interact(
    sessionId: string,
    request: VerifiedInteractionRequest,
  ): Promise<ActionReceipt> {
    const input = verifiedInteractionRequestSchema.parse(request);
    await this.effectJournalReady;
    const effectSession = await this.sessions.get(sessionId);
    const taskScope = effectSession.bootstrapId ?? effectSession.id;
    const browserWorkspaceScope =
      effectSession.workspace?.id ?? effectSession.id;
    let journalRecord: EffectJournalRecord | undefined;
    const journalExecution: {
      state:
        "not_started" | "definitely_not_dispatched" | "may_have_dispatched";
    } = { state: "not_started" };
    let journalFinalized = false;

    try {
      const { receipt } = await this.mutateValue(
        sessionId,
        async (lease) => {
          await this.paceAgentAction(sessionId);

          lease.assertCurrent();

          const downloadEffect = input.expectedEffects.find(
            (effect) => effect.kind === "download_completed",
          );
          const browser = this.browser.get(sessionId);

          const predecessor = await browser.readObservation(
            input.observationId,
          );

          lease.assertCurrent();

          const predecessorTextEvidence = await readFocusedPageTextEvidence(
            browser,
            predecessor,
            input.expectedEffects,
          );

          const verificationBasis = input.consequential
            ? createExpectedEffectVerificationBasis(
                input.expectedEffects,
                predecessor,
                predecessorTextEvidence,
              )
            : undefined;

          lease.assertCurrent();

          if (input.consequential) {
            const unsuitableEffects = assessExpectedEffectEvidenceSuitability(
              input.expectedEffects,
              predecessor,
            ).filter((issue) => {
              const effect = issue.effect;
              return (
                (effect.kind === "text_present" ||
                  effect.kind === "text_absent") &&
                predecessorTextEvidence.get(effect.text)?.state === "unknown"
              );
            });
            if (unsuitableEffects.length > 0) {
              throw new RoveError({
                code: "INSPECTION_REQUIRED",
                message:
                  "The selected expected-effect proof requires stronger read-only evidence before consequential dispatch.",
                retryable: true,
                details: {
                  reason: "expected_effect_evidence_incomplete",
                  mutationDispatched: false,
                  requiredAction: "gather_stronger_read_only_evidence",
                  unsuitableEffects,
                },
              });
            }
          }

          const beforePages = await browser.pages();

          lease.assertCurrent();

          if (input.consequential && input.consequenceKey !== undefined) {
            this.consequenceReplayFence.assertAvailable(
              sessionId,
              input.consequenceKey,
            );
          }

          const signature = interactionSignature(input.action);
          const proposal = interactionActionProposal(input, predecessor);

          await this.authorizeMutation(sessionId, signature, lease, proposal);

          lease.assertCurrent();

          if (input.consequential && input.consequenceKey !== undefined) {
            await this.assertLegacyScopeAcknowledged(
              taskScope,
              browserWorkspaceScope,
            );
            const registeredTaskResult = input.consequenceKey.startsWith(
              "task-result:",
            )
              ? await this.effectJournal.find(
                  taskScope,
                  browserWorkspaceScope,
                  input.consequenceKey,
                )
              : null;
            if (
              input.consequenceKey.startsWith("task-result:") &&
              (!input.authorizationDigest ||
                !input.authorizedPlanId ||
                !registeredTaskResult ||
                registeredTaskResult.state !== "authorized" ||
                registeredTaskResult.taskResultPlan?.planId !==
                  input.authorizedPlanId ||
                registeredTaskResult.taskResultPlan.materialDigest !==
                  input.authorizationDigest)
            )
              throw new RoveError({
                code: "ACTION_NOT_AUTHORIZED",
                message:
                  "This task-result action does not have matching user authorization.",
              });
            if (registeredTaskResult?.taskResultPlan) {
              const plan = registeredTaskResult.taskResultPlan;
              const fingerprint = taskResultPlanActionFingerprint({
                action: input.action,
                expectedEffects: input.expectedEffects,
                effect:
                  input.effect === "irreversible"
                    ? "irreversible"
                    : "external_commit",
              });
              const fieldsMatch = (
                await Promise.all(
                  plan.fields.map(async (binding) => {
                    const target = predecessor.targets?.find(
                      (candidate) => candidate.ref === binding.targetRef,
                    );
                    if (
                      target?.name !== binding.targetName ||
                      target.kind !== binding.targetKind ||
                      target.state?.value !== binding.value
                    )
                      return false;
                    const liveValue = await browser
                      .readTargetValue({
                        pageId: predecessor.pageId,
                        revision: predecessor.revision,
                        ref: binding.targetRef,
                      })
                      .catch(() => undefined);
                    return liveValue === binding.value;
                  }),
                )
              ).every(Boolean);
              const attachmentGroups = new Map<
                string,
                typeof plan.attachments
              >();
              for (const binding of plan.attachments) {
                attachmentGroups.set(binding.targetRef, [
                  ...(attachmentGroups.get(binding.targetRef) ?? []),
                  binding,
                ]);
              }
              const attachmentsMatch =
                input.action.kind !== "upload" &&
                (
                  await Promise.all(
                    [...attachmentGroups.entries()].map(
                      async ([targetRef, bindings]) => {
                        const target = predecessor.targets?.find(
                          (candidate) => candidate.ref === targetRef,
                        );
                        if (
                          !target ||
                          bindings.some(
                            (binding) =>
                              target.name !== binding.targetName ||
                              !binding.uploadEffectId ||
                              !binding.uploadPlanId,
                          )
                        )
                          return false;
                        const liveFiles = await browser
                          .readTargetFiles({
                            pageId: predecessor.pageId,
                            revision: predecessor.revision,
                            ref: targetRef,
                          })
                          .catch(() => []);
                        if (!exactTaskResultFiles(liveFiles, bindings))
                          return false;
                        return (
                          await Promise.all(
                            bindings.map(async (binding) => {
                              const upload = await this.effectJournal.findById(
                                binding.uploadEffectId!,
                              );
                              const uploadPlan = upload?.taskResultPlan;
                              return (
                                upload?.state === "applied" &&
                                uploadPlan !== undefined &&
                                uploadPlan.planId === binding.uploadPlanId &&
                                uploadPlan.attachments.some(
                                  (uploaded) =>
                                    uploaded.evidenceId ===
                                      binding.evidenceId &&
                                    uploaded.sha256 === binding.sha256 &&
                                    uploaded.size === binding.size,
                                )
                              );
                            }),
                          )
                        ).every(Boolean);
                      },
                    ),
                  )
                ).every(Boolean);
              let plannedUploadMatches = false;
              if (
                input.action.kind === "upload" &&
                plan.commitAction.kind === "upload"
              ) {
                const uploadAction = input.action;
                const uploadEvidenceIds = uploadAction.evidenceIds ?? [
                  uploadAction.evidenceId!,
                ];
                plannedUploadMatches =
                  uploadAction.target !== undefined &&
                  plan.attachments.length === uploadEvidenceIds.length &&
                  plan.attachments.every(
                    (binding) =>
                      binding.targetRef === uploadAction.target!.ref &&
                      uploadEvidenceIds.includes(binding.evidenceId),
                  );
              }
              if (
                fingerprint !== plan.actionFingerprint ||
                predecessor.pageId !== plan.pageId ||
                predecessor.revision !== plan.pageRevision ||
                predecessor.url !== plan.url ||
                !fieldsMatch ||
                (input.action.kind === "upload"
                  ? !plannedUploadMatches
                  : !attachmentsMatch)
              )
                throw new RoveError({
                  code: "ACTION_NOT_AUTHORIZED",
                  message:
                    "The concrete task-result action plan changed after authorization.",
                });
            }
            const conflicts = (
              await this.effectJournal.findPotentialConflicts(
                browserWorkspaceScope,
              )
            ).filter(
              (record) =>
                record.effectId !== registeredTaskResult?.effectId &&
                !(
                  record.consequenceKey.startsWith("task-result:") &&
                  record.consequenceKey !== input.consequenceKey
                ),
            );
            let authorizedAttemptId: string | undefined;
            if (conflicts.length > 0) {
              const authorizedRecord = conflicts.find(
                (record) =>
                  record.repeatAuthorization !== undefined &&
                  record.repeatAuthorization.consumedAt === undefined,
              );
              if (!authorizedRecord)
                throw new RoveError({
                  code: "CONSEQUENTIAL_ACTION_UNRESOLVED",
                  message:
                    "This browser workspace has an unresolved prior consequential outcome.",
                  retryable: false,
                  details: {
                    effectIds: conflicts.map((entry) => entry.effectId),
                  },
                });
              authorizedAttemptId = `effect_attempt_${randomUUID()}`;
              try {
                await this.effectJournal.consumeRepeatAuthorization(
                  authorizedRecord.effectId,
                  authorizedRecord.version,
                  authorizedAttemptId,
                  new Date().toISOString(),
                );
              } catch {
                throw new RoveError({
                  code: "CONSEQUENTIAL_ACTION_UNRESOLVED",
                  message:
                    "The one-use workspace authorization is no longer available.",
                  retryable: false,
                  details: {
                    effectIds: conflicts.map((entry) => entry.effectId),
                  },
                });
              }
            }
            const actionFingerprint = createHash("sha256")
              .update(JSON.stringify(input.action))
              .digest("hex");
            const existing =
              registeredTaskResult ??
              (authorizedAttemptId === undefined
                ? await this.effectJournal.find(
                    taskScope,
                    browserWorkspaceScope,
                    input.consequenceKey,
                  )
                : null);
            if (existing) {
              if (existing === registeredTaskResult) {
                journalRecord = await this.effectJournal.update(
                  existing.effectId,
                  existing.version,
                  {
                    state: "prepared",
                    updatedAt: new Date().toISOString(),
                    observationId: input.observationId,
                    ownershipGeneration: lease.token.generation,
                    verificationBasis: verificationBasis!,
                  },
                );
              } else if (
                existing.state === "not_applied" &&
                existing.actionFingerprint === actionFingerprint &&
                existing.verificationBasis !== undefined &&
                verificationBasis !== undefined &&
                sameExpectedEffectVerificationBasis(
                  existing.verificationBasis,
                  verificationBasis,
                )
              ) {
                journalRecord = await this.effectJournal.update(
                  existing.effectId,
                  existing.version,
                  {
                    state: "prepared",
                    updatedAt: new Date().toISOString(),
                    observationId: input.observationId,
                    ownershipGeneration: lease.token.generation,
                    verificationBasis: verificationBasis!,
                  },
                );
              } else if (existing.state === "not_applied") {
                throw new RoveError({
                  code: "ACTION_NOT_AUTHORIZED",
                  message:
                    "This consequence key is bound to a different immutable verification basis.",
                });
              } else {
                this.consequenceReplayFence.recordUnknown(
                  sessionId,
                  input.consequenceKey,
                );
                throw new RoveError({
                  code: "ACTION_OUTCOME_UNKNOWN",
                  message:
                    "This consequential operation already has durable effect history and cannot be automatically replayed.",
                });
              }
            }
            if (!journalRecord)
              journalRecord = await this.effectJournal.prepare({
                taskScope,
                browserWorkspaceScope,
                consequenceKey: input.consequenceKey,
                actionFingerprint,
                verificationBasis: verificationBasis!,
                ...(authorizedAttemptId === undefined
                  ? {}
                  : { attemptId: authorizedAttemptId }),
                state: "prepared",
                ownershipGeneration: lease.token.generation,
                cutoverEpoch: "phase5-effect-journal-v1",
                preparedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              });
          }

          let uploads;
          try {
            uploads =
              input.action.kind === "upload"
                ? await Promise.all(
                    (
                      input.action.evidenceIds ?? [input.action.evidenceId!]
                    ).map((evidenceId) =>
                      this.evidence.readFilePayload(sessionId, evidenceId),
                    ),
                  )
                : undefined;
          } catch (error) {
            if (journalRecord) {
              journalRecord = await this.effectJournal.update(
                journalRecord.effectId,
                journalRecord.version,
                {
                  state: "not_applied",
                  updatedAt: new Date().toISOString(),
                },
              );
              journalFinalized = true;
            }
            throw error;
          }

          lease.assertCurrent();

          const downloadBoundary =
            downloadEffect === undefined
              ? undefined
              : this.registerDownloadEffectBoundary();

          let result: ActionResult | undefined;

          let dispatched = false;

          let dispatchFailure: unknown;
          let dispatchFailureStage:
            InteractionDispatchError["stage"] | undefined;
          const degradations: NonNullable<ActionReceipt["degradations"]> = [];

          try {
            journalExecution.state = "may_have_dispatched";
            result = await browser.interact(input.action, {
              observationId: input.observationId,
              ...([
                "credential_entry",
                "external_commit",
                "irreversible",
              ].includes(proposal.effect)
                ? { coordinationScope: "browser_context" as const }
                : {}),
              ...(downloadBoundary === undefined
                ? {}
                : { activityBoundaryId: downloadBoundary.id }),
              ...(uploads === undefined
                ? {}
                : {
                    uploads,
                  }),
            });

            dispatched = true;
          } catch (error) {
            if (error instanceof InteractionNotDispatchedError) {
              journalExecution.state = "definitely_not_dispatched";
              downloadBoundary?.cancel();
              throw error.original;
            }
            if (!(error instanceof InteractionDispatchError)) {
              downloadBoundary?.cancel();
              throw error;
            }

            dispatched = true;
            result = error.result;
            dispatchFailure = error.original;
            dispatchFailureStage = error.stage;
            degradations.push({
              stage:
                error.stage === "post_action_synchronization"
                  ? "page_synchronization"
                  : "action_dispatch",
              code:
                error.original instanceof RoveError
                  ? error.original.code
                  : "ACTION_OUTCOME_UNKNOWN",
            });
          }

          const downloadSignal =
            downloadBoundary === undefined
              ? undefined
              : await downloadBoundary.result;

          try {
            lease.assertCurrent();
          } catch (error) {
            if (
              downloadBoundary !== undefined &&
              input.consequential &&
              input.consequenceKey !== undefined
            ) {
              this.consequenceReplayFence.recordUnknown(
                sessionId,
                input.consequenceKey,
              );
            }
            throw error;
          }

          let synchronizationFailed = false;

          try {
            await this.syncActivePage(sessionId, lease);
          } catch (error) {
            lease.assertCurrent();
            synchronizationFailed = true;
            degradations.push({
              stage: "page_synchronization",
              code:
                error instanceof RoveError
                  ? error.code
                  : "RUNTIME_PROTOCOL_ERROR",
            });
          }

          lease.assertCurrent();

          let successor: BrowserObservation | undefined;
          let successorTextEvidence: FocusedPageTextEvidence | undefined;

          if (!synchronizationFailed) {
            try {
              const presentedSuccessor = await browser.inspect();
              successor = await browser.readObservation(
                presentedSuccessor.observationId,
              );
              successorTextEvidence = await readFocusedPageTextEvidence(
                browser,
                successor,
                input.expectedEffects,
              );

              lease.assertCurrent();
            } catch (error) {
              lease.assertCurrent();
              degradations.push({
                stage: "successor_inspection",
                code:
                  error instanceof RoveError
                    ? error.code
                    : "RUNTIME_PROTOCOL_ERROR",
              });
            }
          }

          let afterPages: PageSummary[] | undefined;

          try {
            afterPages = await browser.pages();

            lease.assertCurrent();
          } catch (error) {
            lease.assertCurrent();
            degradations.push({
              stage: "page_inventory",
              code:
                error instanceof RoveError
                  ? error.code
                  : "RUNTIME_PROTOCOL_ERROR",
            });
          }

          let effects = verifyExpectedEffects(
            input.expectedEffects,
            predecessor,
            successor,
            result,
            beforePages,
            afterPages,
            predecessorTextEvidence,
            successorTextEvidence,
          );

          if (downloadEffect !== undefined && downloadSignal !== undefined) {
            effects = effects.map((verification) => {
              if (verification.effect !== downloadEffect) return verification;
              const filenameMatches =
                downloadEffect.filename === undefined ||
                downloadEffect.filename === downloadSignal.filename;
              return {
                effect: downloadEffect,
                state:
                  downloadSignal.state === "observed" && !filenameMatches
                    ? "contradicted"
                    : downloadSignal.state,
                ...(downloadSignal.observationId === undefined
                  ? {}
                  : { observationId: downloadSignal.observationId }),
                ...(downloadSignal.evidenceId === undefined
                  ? {}
                  : { evidenceId: downloadSignal.evidenceId }),
                ...(downloadSignal.code === undefined && filenameMatches
                  ? {}
                  : {
                      code: downloadSignal.code ?? "DOWNLOAD_FILENAME_MISMATCH",
                    }),
              };
            });
          }

          let outcome = classifyActionOutcome(effects);

          if (dispatchFailure !== undefined && successor === undefined) {
            outcome = "unknown";
          }

          // A click can finish before a client-rendered application commits its
          // asynchronous mutation or navigation. Do not turn that short
          // observation race into a false negative (and, for consequential
          // actions, a dangerous caller retry). Reconcile the already-dispatched
          // action against a few bounded successor observations; this never
          // redispatches the operation.
          if (
            dispatched &&
            input.expectedEffects.some(
              (effect) => effect.kind !== "download_completed",
            ) &&
            outcome !== "applied"
          ) {
            for (const delayMs of CONSEQUENTIAL_RECONCILIATION_DELAYS_MS) {
              await wait(delayMs);
              lease.assertCurrent();

              try {
                await this.syncActivePage(sessionId, lease);
                const presentedSuccessor = await browser.inspect();
                successor = await browser.readObservation(
                  presentedSuccessor.observationId,
                );
                successorTextEvidence = await readFocusedPageTextEvidence(
                  browser,
                  successor,
                  input.expectedEffects,
                );
                lease.assertCurrent();
                afterPages = await browser.pages();
                lease.assertCurrent();

                effects = verifyExpectedEffects(
                  input.expectedEffects,
                  predecessor,
                  successor,
                  result,
                  beforePages,
                  afterPages,
                  predecessorTextEvidence,
                  successorTextEvidence,
                );
                if (
                  downloadEffect !== undefined &&
                  downloadSignal !== undefined
                ) {
                  effects = effects.map((verification) =>
                    verification.effect.kind === "download_completed"
                      ? {
                          effect: downloadEffect,
                          state:
                            downloadSignal.state === "observed" &&
                            downloadEffect.filename !== undefined &&
                            downloadEffect.filename !== downloadSignal.filename
                              ? "contradicted"
                              : downloadSignal.state,
                          ...(downloadSignal.observationId === undefined
                            ? {}
                            : {
                                observationId: downloadSignal.observationId,
                              }),
                          ...(downloadSignal.evidenceId === undefined
                            ? {}
                            : { evidenceId: downloadSignal.evidenceId }),
                          ...(downloadSignal.code === undefined
                            ? downloadSignal.state === "observed" &&
                              downloadEffect.filename !== undefined &&
                              downloadEffect.filename !==
                                downloadSignal.filename
                              ? { code: "DOWNLOAD_FILENAME_MISMATCH" }
                              : {}
                            : { code: downloadSignal.code }),
                        }
                      : verification,
                  );
                }
                outcome = classifyActionOutcome(effects);

                if (outcome === "applied") break;
              } catch (error) {
                lease.assertCurrent();
                outcome = "unknown";

                if (
                  !degradations.some(
                    (item) => item.stage === "successor_inspection",
                  )
                ) {
                  degradations.push({
                    stage: "successor_inspection",
                    code:
                      error instanceof RoveError
                        ? error.code
                        : "RUNTIME_PROTOCOL_ERROR",
                  });
                }
              }
            }
          }

          const target = interactionTarget(input.action);
          const receiptUrl = successor?.url ?? result?.url;
          const receiptCurrentRevision =
            successor?.revision ?? result?.currentRevision;
          const receiptPageChanged =
            result?.pageChanged === true ||
            (successor !== undefined &&
              (successor.url !== predecessor.url ||
                successor.revision !== predecessor.revision));

          const receipt: ActionReceipt = {
            receiptId: `rcpt_${randomUUID().replaceAll("-", "")}`,
            sessionId,
            action: input.action.kind,
            dispatched,
            dispatchStatus:
              dispatchFailureStage === "dispatch" && outcome !== "applied"
                ? "uncertain"
                : "completed",
            outcome,
            consequential: input.consequential,
            ...(input.consequenceKey === undefined
              ? {}
              : {
                  consequenceKey: input.consequenceKey,
                }),
            predecessorObservationId: input.observationId,
            ...(successor === undefined
              ? {}
              : {
                  successorObservationId: successor.observationId,
                }),
            ...(target === undefined
              ? {}
              : {
                  target,
                }),
            effects,
            ...(result?.phases === undefined ? {} : { phases: result.phases }),
            degradations,
            ...(result?.pageChanged === undefined && successor === undefined
              ? {}
              : {
                  pageChanged: receiptPageChanged,
                }),
            ...(result?.previousRevision === undefined
              ? {}
              : {
                  previousRevision: result.previousRevision,
                }),
            ...(receiptCurrentRevision === undefined
              ? {}
              : {
                  currentRevision: receiptCurrentRevision,
                }),
            ...(receiptUrl === undefined
              ? {}
              : {
                  url: receiptUrl,
                }),
            ...(result?.openedPages === undefined
              ? {}
              : {
                  openedPages: result.openedPages,
                }),
          };

          if (
            input.consequential &&
            input.consequenceKey !== undefined &&
            outcome === "unknown"
          ) {
            this.consequenceReplayFence.recordUnknown(
              sessionId,
              input.consequenceKey,
            );
          }

          lease.assertCurrent();

          let receiptPersistenceFailed = false;
          await this.observations
            .append(sessionId, {
              actor: "agent",
              type: "agent_interaction_receipt",
              data: {
                receiptId: receipt.receiptId,
                action: receipt.action,
                dispatched: receipt.dispatched,
                outcome: receipt.outcome,
                consequential: receipt.consequential,
                ...(input.consequenceKey === undefined
                  ? {}
                  : { consequenceKey: input.consequenceKey }),
                ...(input.authorizationDigest === undefined
                  ? {}
                  : { authorizationDigest: input.authorizationDigest }),
                ...(input.authorizedPlanId === undefined
                  ? {}
                  : { authorizedPlanId: input.authorizedPlanId }),
                ...(input.action.kind === "upload"
                  ? {
                      uploadEvidenceIds: input.action.evidenceIds ?? [
                        input.action.evidenceId!,
                      ],
                    }
                  : {}),
                ...(target === undefined
                  ? {}
                  : {
                      targetRef: target.ref,
                      targetName: predecessor.targets?.find(
                        (candidate) => candidate.ref === target.ref,
                      )?.name,
                    }),
                ...(successor === undefined
                  ? {}
                  : {
                      successorObservationId: successor.observationId,
                    }),
                effects: effects.map((effect) => ({
                  kind: effect.effect.kind,
                  state: effect.state,
                  ...(effect.observationId === undefined
                    ? {}
                    : { observationId: effect.observationId }),
                  ...(effect.evidenceId === undefined
                    ? {}
                    : { evidenceId: effect.evidenceId }),
                  ...(effect.code === undefined ? {} : { code: effect.code }),
                })),
              },
              ...(result?.pageId === undefined
                ? target === undefined
                  ? {}
                  : {
                      pageId: target.pageId,
                    }
                : {
                    pageId: result.pageId,
                  }),
              ...(result?.currentRevision === undefined
                ? {}
                : {
                    pageRevision: result.currentRevision,
                  }),
            })
            .catch((error: unknown) => {
              receiptPersistenceFailed = true;
              degradations.push({
                stage: "receipt_persistence",
                code:
                  error instanceof RoveError
                    ? error.code
                    : "EVIDENCE_WRITE_FAILED",
              });
            });

          if (receiptPersistenceFailed) {
            outcome = "unknown";
            receipt.outcome = "unknown";
            receipt.dispatchStatus = "uncertain";
          }

          if (journalRecord) {
            const evidenceReference = effects.find(
              (effect) => effect.evidenceId !== undefined,
            );
            const observationReference = effects.find(
              (effect) => effect.observationId !== undefined,
            );
            const state = receiptPersistenceFailed
              ? "unresolved"
              : outcome === "applied"
                ? "applied"
                : outcome === "not_applied"
                  ? "not_applied"
                  : "unresolved";
            try {
              journalRecord = await this.effectJournal.update(
                journalRecord.effectId,
                journalRecord.version,
                {
                  state,
                  updatedAt: new Date().toISOString(),
                  ...(observationReference?.observationId
                    ? { observationId: observationReference.observationId }
                    : successor?.observationId
                      ? { observationId: successor.observationId }
                      : {}),
                  ...(evidenceReference?.evidenceId
                    ? { evidenceId: evidenceReference.evidenceId }
                    : {}),
                },
              );
              journalFinalized = true;
            } catch {
              this.consequenceReplayFence.recordUnknown(
                sessionId,
                input.consequenceKey!,
              );
              throw new RoveError({
                code: "ACTION_OUTCOME_UNKNOWN",
                message:
                  "The action may have completed, but its durable effect record could not be finalized.",
              });
            }
            if (state === "unresolved") {
              this.consequenceReplayFence.recordUnknown(
                sessionId,
                input.consequenceKey!,
              );
            }
          }

          lease.assertCurrent();

          let assessment: PageInspectionPolicyRecord | undefined;

          if (successor !== undefined) {
            try {
              assessment = this.interactionPolicy.recordInspection(
                sessionId,
                successor,
              );
            } catch (error) {
              degradations.push({
                stage: "page_policy",
                code:
                  error instanceof RoveError
                    ? error.code
                    : "RUNTIME_PROTOCOL_ERROR",
              });
            }
          }

          lease.assertCurrent();

          return {
            receipt,
            assessment,
          };
        },
        async ({ assessment }) => {
          if (assessment === undefined) {
            return;
          }

          await this.pagePolicyOrchestrator
            .orchestrate(
              sessionId,
              assessment.policyDecision,
              assessment.pageState,
              "post_action",
            )
            .catch((error: unknown) => {
              receipt.degradations?.push({
                stage: "page_policy",
                code:
                  error instanceof RoveError
                    ? error.code
                    : "RUNTIME_PROTOCOL_ERROR",
              });
            });
        },
      );

      return receipt;
    } catch (error) {
      if (journalRecord && !journalFinalized) {
        try {
          journalRecord = await this.effectJournal.update(
            journalRecord.effectId,
            journalRecord.version,
            {
              state:
                journalExecution.state === "may_have_dispatched"
                  ? "unresolved"
                  : "not_applied",
              updatedAt: new Date().toISOString(),
            },
          );
          journalFinalized = true;
          if (
            journalExecution.state === "may_have_dispatched" &&
            input.consequenceKey
          )
            this.consequenceReplayFence.recordUnknown(
              sessionId,
              input.consequenceKey,
            );
        } catch {
          if (input.consequenceKey)
            this.consequenceReplayFence.recordUnknown(
              sessionId,
              input.consequenceKey,
            );
          throw new RoveError({
            code: "ACTION_OUTCOME_UNKNOWN",
            message:
              "The action could not be completed with a durable effect record.",
          });
        }
      }
      throw error;
    }
  }

  async reconcileConsequentialEffect(
    sessionId: string,
    input: ReconcileConsequentialEffectRequest,
  ): Promise<ConsequentialEffectReconciliationResult> {
    await this.effectJournalReady;
    const session = await this.sessions.get(sessionId);
    const taskScope = session.bootstrapId ?? session.id;
    const browserWorkspaceScope = session.workspace?.id ?? session.id;
    const record = await this.effectJournal.find(
      taskScope,
      browserWorkspaceScope,
      input.consequenceKey,
    );
    if (!record)
      throw new RoveError({
        code: "ACTION_NOT_AUTHORIZED",
        message:
          "No consequential effect with this key belongs to the task and browser workspace.",
      });
    if (record.state === "applied" || record.state === "not_applied") {
      this.consequenceReplayFence.clear(sessionId, input.consequenceKey);
      this.semanticTransactions.recordCommitSettlement(
        sessionId,
        input.consequenceKey,
        record.state,
      );
      return {
        effectId: record.effectId,
        consequenceKey: record.consequenceKey,
        state: record.state,
        version: record.version,
        ...(record.observationId
          ? { observationId: record.observationId }
          : {}),
        settled: false,
      };
    }
    if (record.state !== "unresolved")
      throw new RoveError({
        code: "ACTION_NOT_AUTHORIZED",
        message:
          "Only an unresolved or already terminal consequential effect can be reconciled.",
      });
    this.consequenceReplayFence.recordUnknown(sessionId, input.consequenceKey);
    if (!record.verificationBasis) {
      return {
        effectId: record.effectId,
        consequenceKey: record.consequenceKey,
        state: "unresolved",
        version: record.version,
        ...(record.observationId
          ? { observationId: record.observationId }
          : {}),
        settled: false,
      };
    }

    return this.ownershipFence.runAgentBrowserOperation(
      sessionId,
      async (lease) => {
        const browser = this.browser.get(sessionId);
        const observation = await browser.readObservation(input.observationId);
        lease.assertCurrent();
        const focusedTextEvidence = await readFocusedPageTextEvidence(
          browser,
          observation,
          record.verificationBasis!.effects.map(({ effect }) => effect),
        );
        lease.assertCurrent();
        const effects = verifyExpectedEffectsFromBasis(
          record.verificationBasis!,
          observation,
          focusedTextEvidence,
        );
        const outcome = classifyActionOutcome(effects);
        if (outcome === "unknown") {
          this.consequenceReplayFence.recordUnknown(
            sessionId,
            input.consequenceKey,
          );
          return {
            effectId: record.effectId,
            consequenceKey: record.consequenceKey,
            state: "unresolved" as const,
            version: record.version,
            observationId: observation.observationId,
            settled: false,
          };
        }
        const settled = await this.effectJournal.settleUnresolved(
          record.effectId,
          record.version,
          {
            state: outcome === "applied" ? "applied" : "not_applied",
            updatedAt: new Date().toISOString(),
            observationId: observation.observationId,
          },
        );
        this.consequenceReplayFence.clear(sessionId, input.consequenceKey);
        this.semanticTransactions.recordCommitSettlement(
          sessionId,
          input.consequenceKey,
          settled.state as "applied" | "not_applied",
        );
        return {
          effectId: settled.effectId,
          consequenceKey: settled.consequenceKey,
          state: settled.state as "applied" | "not_applied",
          version: settled.version,
          observationId: observation.observationId,
          settled: true,
        };
      },
    );
  }

  async acknowledgeLegacyEffectScope(sessionId: string): Promise<void> {
    await this.effectJournalReady;
    const session = await this.sessions.get(sessionId);
    const taskScope = session.bootstrapId ?? session.id;
    const browserScope = session.workspace?.id ?? session.id;
    const at = new Date().toISOString();
    await this.effectJournal.acknowledgeLegacyScope(`task:${taskScope}`, at);
    await this.effectJournal.acknowledgeLegacyScope(
      `workspace:${browserScope}`,
      at,
    );
  }

  async authorizeEffectRepetition(
    sessionId: string,
    effectId: string,
    authorizationId: string,
  ): Promise<EffectJournalRecord> {
    await this.effectJournalReady;
    const session = await this.sessions.get(sessionId);
    const taskScope = session.bootstrapId ?? session.id;
    const browserWorkspaceScope = session.workspace?.id ?? session.id;
    const record = await this.effectJournal.findById(effectId);
    if (
      !record ||
      record.taskScope !== taskScope ||
      record.browserWorkspaceScope !== browserWorkspaceScope
    )
      throw new RoveError({
        code: "ACTION_NOT_AUTHORIZED",
        message:
          "The effect does not belong to this task and browser workspace.",
      });
    return this.effectJournal.authorizeRepeat(
      effectId,
      authorizationId,
      new Date().toISOString(),
    );
  }

  async prepareTaskResultAction(
    sessionId: string,
    input: PrepareTaskResultActionRequest,
  ): Promise<TaskResultActionPlan> {
    await this.effectJournalReady;
    if (!input.consequenceKey.endsWith(`:${input.materialDigest}`))
      throw new RoveError({
        code: "INVALID_CONFIGURATION",
        message: "Task-result action material identity is invalid.",
      });
    if (
      new Set(input.fieldBindings.map((binding) => binding.field)).size !==
        input.fieldBindings.length ||
      new Set(input.fieldBindings.map((binding) => binding.targetRef)).size !==
        input.fieldBindings.length
    )
      throw new RoveError({
        code: "INVALID_CONFIGURATION",
        message:
          "Task-result action field bindings contain duplicate roles or controls.",
      });
    if (
      new Set(input.attachmentBindings.map((binding) => binding.evidenceId))
        .size !== input.attachmentBindings.length
    )
      throw new RoveError({
        code: "INVALID_CONFIGURATION",
        message: "Task-result action attachments contain duplicates.",
      });
    const session = await this.sessions.get(sessionId);
    const taskScope = session.bootstrapId ?? session.id;
    const browserWorkspaceScope = session.workspace?.id ?? session.id;
    const observation = await this.browser
      .get(sessionId)
      .readObservation(input.observationId);
    const boundTargetRefs = [
      ...input.fieldBindings.map((binding) => binding.targetRef),
      ...new Set(input.attachmentBindings.map((binding) => binding.targetRef)),
    ];
    const commitReference = interactionTarget(input.commitAction);
    if (commitReference && input.commitAction.kind !== "upload")
      boundTargetRefs.push(commitReference.ref);
    if (new Set(boundTargetRefs).size !== boundTargetRefs.length)
      throw new RoveError({
        code: "INVALID_CONFIGURATION",
        message: "Task-result action controls must be distinct.",
      });
    const fields = await Promise.all(
      input.fieldBindings.map(async (binding) => {
        const target = observation.targets?.find(
          (candidate) => candidate.ref === binding.targetRef,
        );
        if (
          !target ||
          !target.visible ||
          !target.enabled ||
          !target.perceived?.capabilities.includes("fill") ||
          typeof target.name !== "string" ||
          typeof target.state?.value !== "string"
        )
          throw new RoveError({
            code: "TARGET_NOT_FOUND",
            message:
              "A concrete task-result field binding is not visible with an exact value.",
          });
        const liveValue = await this.browser
          .get(sessionId)
          .readTargetValue({
            pageId: observation.pageId,
            revision: observation.revision,
            ref: binding.targetRef,
          })
          .catch(() => undefined);
        if (liveValue !== target.state.value)
          throw new RoveError({
            code: "ACTION_NOT_AUTHORIZED",
            message:
              "The live task-result field value does not match the inspected value.",
          });
        return {
          field: binding.field,
          targetRef: target.ref,
          targetName: target.name,
          targetKind: target.kind,
          value: target.state.value,
        };
      }),
    );
    const activity = await this.observations.list(sessionId, { limit: 1_000 });
    const attachments = await Promise.all(
      input.attachmentBindings.map(async (binding) => {
        const evidenceId = binding.evidenceId;
        const evidence = await this.evidence.metadata(sessionId, evidenceId);
        const filename =
          typeof evidence.metadata?.filename === "string"
            ? evidence.metadata.filename
            : evidence.label;
        const sha256 = evidence.metadata?.sha256;
        const size = evidence.metadata?.sizeBytes;
        if (
          evidence.type !== "file" ||
          typeof filename !== "string" ||
          typeof sha256 !== "string" ||
          !/^[a-f0-9]{64}$/.test(sha256) ||
          typeof size !== "number" ||
          !Number.isSafeInteger(size) ||
          size < 0
        )
          throw new RoveError({
            code: "INVALID_CONFIGURATION",
            message: "Task-result attachment evidence is invalid.",
          });
        const target = observation.targets?.find(
          (candidate) => candidate.ref === binding.targetRef,
        );
        if (
          !target ||
          !target.visible ||
          !target.enabled ||
          typeof target.name !== "string" ||
          (!target.perceived?.capabilities.includes("upload") &&
            !(
              input.commitAction.kind === "upload" &&
              input.commitAction.target?.ref === target.ref
            ))
        )
          throw new RoveError({
            code: "INVALID_CONFIGURATION",
            message:
              "Task-result attachment control is not a visible upload target.",
          });
        let uploadProvenance:
          | {
              uploadEffectId: string;
              uploadPlanId: string;
              uploadReceiptId: string;
            }
          | undefined;
        if (input.commitAction.kind !== "upload") {
          const uploadReceipt = activity.items.find((item) => {
            if (
              item.type !== "agent_interaction_receipt" ||
              typeof item.data !== "object" ||
              item.data === null ||
              Array.isArray(item.data)
            )
              return false;
            const data = item.data as Record<string, unknown>;
            return (
              data.action === "upload" &&
              data.outcome === "applied" &&
              data.targetName === target.name &&
              Array.isArray(data.uploadEvidenceIds) &&
              data.uploadEvidenceIds.includes(evidenceId) &&
              typeof data.consequenceKey === "string" &&
              data.consequenceKey.startsWith("task-result:") &&
              typeof data.authorizedPlanId === "string" &&
              typeof data.receiptId === "string"
            );
          });
          const receiptData = uploadReceipt?.data as
            Record<string, unknown> | undefined;
          const uploadRecord = receiptData
            ? await this.effectJournal.find(
                taskScope,
                browserWorkspaceScope,
                receiptData.consequenceKey as string,
              )
            : null;
          const uploadPlan = uploadRecord?.taskResultPlan;
          if (
            !uploadRecord ||
            uploadRecord.state !== "applied" ||
            !uploadPlan ||
            uploadPlan.planId !== receiptData?.authorizedPlanId
          )
            throw new RoveError({
              code: "ACTION_NOT_AUTHORIZED",
              message:
                "The attachment is not backed by a confirmed exact upload authorization.",
            });
          if (
            !uploadPlan.attachments.some(
              (uploaded) =>
                uploaded.evidenceId === evidenceId &&
                uploaded.sha256 === sha256 &&
                uploaded.size === size,
            )
          )
            throw new RoveError({
              code: "ACTION_NOT_AUTHORIZED",
              message:
                "The attachment is not backed by a confirmed exact upload authorization.",
            });
          uploadProvenance = {
            uploadEffectId: uploadRecord.effectId,
            uploadPlanId: uploadPlan.planId,
            uploadReceiptId: receiptData!.receiptId as string,
          };
        }
        return {
          evidenceId,
          filename,
          size,
          sha256,
          targetRef: target.ref,
          targetName: target.name,
          ...uploadProvenance,
        };
      }),
    );
    if (attachments.length > 0 && input.commitAction.kind !== "upload") {
      const attachmentGroups = new Map<string, typeof attachments>();
      for (const binding of attachments) {
        attachmentGroups.set(binding.targetRef, [
          ...(attachmentGroups.get(binding.targetRef) ?? []),
          binding,
        ]);
      }
      const exact = (
        await Promise.all(
          [...attachmentGroups.entries()].map(async ([targetRef, bindings]) =>
            exactTaskResultFiles(
              await this.browser
                .get(sessionId)
                .readTargetFiles({
                  pageId: observation.pageId,
                  revision: observation.revision,
                  ref: targetRef,
                })
                .catch(() => []),
              bindings,
            ),
          ),
        )
      ).every(Boolean);
      if (!exact)
        throw new RoveError({
          code: "ACTION_NOT_AUTHORIZED",
          message:
            "The complete live attachment set does not match the authorized evidence.",
        });
    }
    const commitTarget = commitReference
      ? observation.targets?.find(
          (candidate) => candidate.ref === commitReference.ref,
        )
      : undefined;
    if (
      commitReference &&
      (commitReference.pageId !== observation.pageId ||
        commitReference.revision !== observation.revision ||
        !commitTarget ||
        !commitTarget.visible ||
        !commitTarget.enabled)
    )
      throw new RoveError({
        code: "TARGET_NOT_FOUND",
        message: "The concrete task-result commit target is unavailable.",
      });
    if (attachments.length > 0 && input.commitAction.kind === "upload") {
      if (!commitReference)
        throw new RoveError({
          code: "INVALID_CONFIGURATION",
          message: "The exact attachment upload requires a target control.",
        });
      const uploadEvidenceIds = input.commitAction.evidenceIds ?? [
        input.commitAction.evidenceId!,
      ];
      if (
        uploadEvidenceIds.length !== attachments.length ||
        attachments.some(
          (binding) =>
            binding.targetRef !== commitReference.ref ||
            !uploadEvidenceIds.includes(binding.evidenceId),
        )
      )
        throw new RoveError({
          code: "INVALID_CONFIGURATION",
          message:
            "The exact upload action must match every authorized attachment and its upload control.",
        });
    }
    const actionFingerprint = taskResultPlanActionFingerprint({
      action: input.commitAction,
      expectedEffects: input.expectedEffects,
      effect: input.effect,
    });
    const preparedAt = new Date().toISOString();
    const planBase = {
      schemaVersion: 1 as const,
      planId: `plan_${randomUUID().replaceAll("-", "")}`,
      consequenceKey: input.consequenceKey,
      materialDigest: input.materialDigest,
      taskScope,
      browserWorkspaceScope,
      observationId: observation.observationId,
      pageId: observation.pageId,
      pageRevision: observation.revision,
      url: observation.url,
      fields,
      attachments,
      ...(commitTarget
        ? {
            commitTarget: {
              targetRef: commitTarget.ref,
              targetName: commitTarget.name ?? "",
              targetKind: commitTarget.kind,
              scopeLabels: (commitTarget.perceived?.scopes ?? []).flatMap(
                (scope) => (scope.label ? [scope.label] : []),
              ),
            },
          }
        : {}),
      commitAction: input.commitAction,
      expectedEffects: input.expectedEffects,
      effect: input.effect,
      actionFingerprint,
      preparedAt,
    };
    const plan: TaskResultActionPlan = {
      ...planBase,
      planDigest: createHash("sha256")
        .update(JSON.stringify(planBase))
        .digest("hex"),
    };
    const existing = await this.effectJournal.find(
      taskScope,
      browserWorkspaceScope,
      input.consequenceKey,
    );
    if (existing) {
      if (existing.state !== "planned" && existing.state !== "authorized")
        throw new RoveError({
          code: "ACTION_NOT_AUTHORIZED",
          message:
            "This task-result action already has dispatch authority or effect history.",
        });
      const replaced = await this.effectJournal.update(
        existing.effectId,
        existing.version,
        {
          state: "planned",
          updatedAt: preparedAt,
          observationId: observation.observationId,
          ownershipGeneration: session.ownershipGeneration ?? 1,
          actionFingerprint,
          taskResultPlan: plan,
        },
      );
      return replaced.taskResultPlan!;
    }
    const record = await this.effectJournal.prepare({
      taskScope,
      browserWorkspaceScope,
      consequenceKey: input.consequenceKey,
      actionFingerprint,
      taskResultPlan: plan,
      state: "planned",
      ownershipGeneration: session.ownershipGeneration ?? 1,
      cutoverEpoch: "phase5-effect-journal-v1",
      preparedAt,
      updatedAt: preparedAt,
    });
    return record.taskResultPlan!;
  }

  async authorizeTaskResultAction(
    sessionId: string,
    consequenceKey: string,
    materialDigest: string,
    planId: string,
  ): Promise<EffectJournalRecord> {
    await this.effectJournalReady;
    if (
      !/^task-result:[^:]{1,200}:[a-f0-9]{64}$/.test(consequenceKey) ||
      !/^[a-f0-9]{64}$/.test(materialDigest) ||
      !/^plan_[a-f0-9]{32}$/.test(planId) ||
      !consequenceKey.endsWith(`:${materialDigest}`)
    )
      throw new RoveError({
        code: "INVALID_CONFIGURATION",
        message: "Task-result action authorization is invalid.",
      });
    const session = await this.sessions.get(sessionId);
    const taskScope = session.bootstrapId ?? session.id;
    const browserWorkspaceScope = session.workspace?.id ?? session.id;
    const existing = await this.effectJournal.find(
      taskScope,
      browserWorkspaceScope,
      consequenceKey,
    );
    if (existing) {
      if (
        existing.taskResultPlan?.planId === planId &&
        existing.taskResultPlan.materialDigest === materialDigest &&
        existing.state === "authorized"
      )
        return existing;
      if (
        existing.taskResultPlan?.planId === planId &&
        existing.taskResultPlan.materialDigest === materialDigest &&
        existing.state === "planned"
      )
        return this.effectJournal.update(existing.effectId, existing.version, {
          state: "authorized",
          updatedAt: new Date().toISOString(),
        });
      throw new RoveError({
        code: "ACTION_NOT_AUTHORIZED",
        message:
          "This task-result action already has incompatible effect history.",
      });
    }
    throw new RoveError({
      code: "ACTION_NOT_AUTHORIZED",
      message: "A concrete task-result action plan must be prepared first.",
    });
  }

  async consequentialEffect(
    sessionId: string,
    consequenceKey: string,
  ): Promise<EffectJournalRecord | null> {
    await this.effectJournalReady;
    const session = await this.sessions.get(sessionId);
    const taskScope = session.bootstrapId ?? session.id;
    const browserWorkspaceScope = session.workspace?.id ?? session.id;
    return this.effectJournal.find(
      taskScope,
      browserWorkspaceScope,
      consequenceKey,
    );
  }

  private async initializeEffectJournalCutover(): Promise<void> {
    const existing = await this.effectJournal.cutover();
    if (existing) return;
    const [sessions, workspaceStatus] = await Promise.all([
      this.sessions.list(),
      this.browserWorkspaces.status(),
    ]);
    const scopes = sessions.flatMap((session) => [
      `task:${session.bootstrapId ?? session.id}`,
      `workspace:${session.workspace?.id ?? session.id}`,
    ]);
    scopes.push(
      ...workspaceStatus.workspaces.map(
        (workspace) => `workspace:${workspace.id}`,
      ),
    );
    await this.effectJournal.establishCutover(
      "phase5-effect-journal-v1",
      new Date().toISOString(),
      [...new Set(scopes)],
    );
  }

  private async assertLegacyScopeAcknowledged(
    taskScope: string,
    browserScope: string,
  ): Promise<void> {
    const cutover = await this.effectJournal.cutover();
    const blocked = [`task:${taskScope}`, `workspace:${browserScope}`].find(
      (scope) =>
        cutover?.legacyScopes[scope] !== undefined &&
        cutover.legacyScopes[scope]?.acknowledgedAt === undefined,
    );
    if (blocked)
      throw new RoveError({
        code: "ACTION_OUTCOME_UNKNOWN",
        message:
          "This pre-cutover task or browser workspace requires explicit acknowledgement before fresh consequential work.",
      });
  }

  navigate(sessionId: string, request: NavigateRequest): Promise<ActionResult> {
    return this.mutateAction(
      sessionId,
      `navigate:${request.url}`,
      () => this.browser.get(sessionId).navigate(request.url),
      (result) => ({
        type: "browser_navigated",
        data: {
          url: result.url,
          previousRevision: result.previousRevision,
          currentRevision: result.currentRevision,
        },
      }),
      {
        action: "navigate",
        effect: "navigate",
        explicitlyAuthorized: true,
        freshlyGrounded: true,
        outcomeCanBeVerified: true,
      },
    );
  }

  async openPage(
    sessionId: string,
    request: NavigateRequest,
  ): Promise<PageSummary> {
    const { page } = await this.mutateValue(
      sessionId,
      async (lease) => {
        await this.authorizeMutation(
          sessionId,
          `open_page:${request.url}`,
          lease,
          {
            action: "open_page",
            effect: "navigate",
            explicitlyAuthorized: true,
            freshlyGrounded: true,
            outcomeCanBeVerified: true,
          },
        );

        const page = await this.browser.get(sessionId).openPage(request.url);

        lease.assertCurrent();
        await this.syncActivePage(sessionId, lease);
        lease.assertCurrent();

        await this.observations.append(sessionId, {
          actor: "agent",
          type: "agent_page_opened",
          pageId: page.id,
          pageRevision: page.revision,
          data: { pageId: page.id, url: page.url },
        });

        lease.assertCurrent();
        const assessment = await this.assessBrowser(
          sessionId,
          this.browser.get(sessionId),
          lease,
        );

        return { page, assessment };
      },
      async ({ assessment }) => {
        await this.pagePolicyOrchestrator.orchestrate(
          sessionId,
          assessment.policyDecision,
          assessment.pageState,
          "post_action",
        );
      },
    );

    return page;
  }

  click(sessionId: string, request: ClickRequest): Promise<ActionResult> {
    return this.mutateAction(
      sessionId,
      `click:${request.target.ref}`,
      () => this.browser.get(sessionId).click(request.target),
      (result) => ({
        type: "agent_clicked",
        data: {
          targetRef: request.target.ref,
          pageChanged: result.pageChanged,
          url: result.url,
        },
      }),
    );
  }

  async type(sessionId: string, request: TypeRequest): Promise<ActionResult> {
    await this.recordings.stopBeforeSensitiveType(
      sessionId,
      request.target.pageId,
      request.target.ref,
    );
    return this.mutateAction(
      sessionId,
      `type:${request.target.ref}`,
      () => this.browser.get(sessionId).type(request.target, request.value),
      () => ({ type: "agent_typed", data: { targetRef: request.target.ref } }),
    );
  }

  press(sessionId: string, request: PressRequest): Promise<ActionResult> {
    return this.mutateAction(
      sessionId,
      `press:${request.target?.ref ?? "page"}:${request.key}`,
      () =>
        this.browser.get(sessionId).press(request.target ?? null, request.key),
      () => ({
        type: "agent_pressed",
        data: {
          ...(request.target === undefined
            ? {}
            : { targetRef: request.target.ref }),
          key: request.key,
        },
      }),
    );
  }

  scroll(sessionId: string, request: ScrollOptions): Promise<ActionResult> {
    return this.mutateAction(
      sessionId,
      `scroll:${request.direction}:${request.amount ?? 600}`,
      () => this.browser.get(sessionId).scroll(request),
      () => ({
        type: "agent_scrolled",
        data: { direction: request.direction, amount: request.amount ?? 600 },
      }),
      {
        action: "scroll",
        effect: "reversible_ui",
        explicitlyAuthorized: true,
        freshlyGrounded: true,
        outcomeCanBeVerified: true,
      },
    );
  }

  back(sessionId: string): Promise<ActionResult> {
    return this.mutateAction(
      sessionId,
      "back",
      () => this.browser.get(sessionId).back(),
      () => ({ type: "browser_back", data: {} }),
      {
        action: "back",
        effect: "recover",
        explicitlyAuthorized: true,
        freshlyGrounded: true,
        outcomeCanBeVerified: true,
      },
    );
  }

  forward(sessionId: string): Promise<ActionResult> {
    return this.mutateAction(
      sessionId,
      "forward",
      () => this.browser.get(sessionId).forward(),
      () => ({ type: "browser_forward", data: {} }),
      {
        action: "forward",
        effect: "recover",
        explicitlyAuthorized: true,
        freshlyGrounded: true,
        outcomeCanBeVerified: true,
      },
    );
  }

  async pages(sessionId: string): Promise<PageSummary[]> {
    await this.requireActive(sessionId);

    return this.ownershipFence.runAgentBrowserOperation(
      sessionId,
      async (lease) => {
        const pages = await this.browser.get(sessionId).pages();
        lease.assertCurrent();
        return pages;
      },
    );
  }

  async switchPage(sessionId: string, pageId: string): Promise<PageSummary> {
    const { page } = await this.mutateValue(
      sessionId,
      async (lease) => {
        await this.authorizeMutation(
          sessionId,
          `switch_page:${pageId}`,
          lease,
          {
            action: "switch_page",
            effect: "recover",
            explicitlyAuthorized: true,
            freshlyGrounded: true,
            outcomeCanBeVerified: true,
          },
        );

        const page = await this.browser.get(sessionId).switchPage(pageId);

        lease.assertCurrent();

        await this.syncActivePage(sessionId, lease);

        lease.assertCurrent();

        await this.observations.append(sessionId, {
          actor: "agent",
          type: "page_switched",
          data: { pageId },
        });

        lease.assertCurrent();

        const assessment = await this.assessBrowser(
          sessionId,
          this.browser.get(sessionId),
          lease,
        );

        lease.assertCurrent();

        return {
          page,
          assessment,
        };
      },
      async ({ assessment }) => {
        await this.pagePolicyOrchestrator.orchestrate(
          sessionId,
          assessment.policyDecision,
          assessment.pageState,
          "post_action",
        );
      },
    );

    return page;
  }

  async closePage(sessionId: string, pageId: string): Promise<void> {
    await this.recordings.stopForPage(sessionId, pageId);
    await this.mutateValue(
      sessionId,
      async (lease) => {
        await this.authorizeMutation(sessionId, `close_page:${pageId}`, lease, {
          action: "close_page",
          effect: "recover",
          explicitlyAuthorized: true,
          freshlyGrounded: true,
          outcomeCanBeVerified: true,
        });

        await this.browser.get(sessionId).closePage(pageId);

        lease.assertCurrent();

        await this.syncActivePage(sessionId, lease);

        lease.assertCurrent();

        await this.observations.append(sessionId, {
          actor: "agent",
          type: "page_closed",
          data: { pageId },
        });

        lease.assertCurrent();

        const assessment = await this.assessBrowser(
          sessionId,
          this.browser.get(sessionId),
          lease,
        );

        lease.assertCurrent();

        return assessment;
      },
      async (assessment) => {
        await this.pagePolicyOrchestrator.orchestrate(
          sessionId,
          assessment.policyDecision,
          assessment.pageState,
          "post_action",
        );
      },
    );
  }

  startRecording(
    sessionId: string,
    request: StartRecordingRequest,
  ): Promise<Recording> {
    return this.recordings.start(sessionId, request);
  }

  stopRecording(sessionId: string, recordingId: string): Promise<Recording> {
    return this.recordings.stop(sessionId, recordingId);
  }

  getRecording(sessionId: string, recordingId: string): Promise<Recording> {
    return this.recordings.get(sessionId, recordingId);
  }

  listRecordings(sessionId: string): Promise<Recording[]> {
    return this.recordings.list(sessionId);
  }

  captureScreenshot(
    sessionId: string,
    options: ScreenshotOptions = {},
  ): Promise<Evidence> {
    return this.mutateValue(sessionId, async (lease) => {
      const artifact = await this.browser.get(sessionId).screenshot(options);

      lease.assertCurrent();

      const item = await this.evidence.saveScreenshot(
        sessionId,
        artifact,
        options,
      );

      lease.assertCurrent();

      await this.observations.append(sessionId, {
        actor: "agent",
        type: "screenshot_captured",
        data: {
          evidenceId: item.id,
          label: item.label,
          ...(typeof artifact.metadata?.observationId === "string"
            ? {
                observationId: artifact.metadata.observationId,
              }
            : {}),
        },
        ...(item.pageId === undefined
          ? {}
          : {
              pageId: item.pageId,
            }),
        ...(item.pageRevision === undefined
          ? {}
          : {
              pageRevision: item.pageRevision,
            }),
      });

      lease.assertCurrent();

      const mode = options.mode ?? "viewport";

      const inline =
        mode !== "full-page" &&
        artifact.bytes.byteLength <= MAX_INLINE_SCREENSHOT_BYTES;

      return {
        ...item,
        ...(inline
          ? {
              image: {
                mimeType: "image/png",
                data: Buffer.from(artifact.bytes).toString("base64"),
                byteLength: artifact.bytes.byteLength,
              },
            }
          : {
              imageOmitted: mode === "full-page" ? "full_page" : "size_limit",
            }),
      };
    });
  }

  async getControlStatus(sessionId: string): Promise<ControlStatus> {
    const [session, observations] = await Promise.all([
      this.sessions.get(sessionId),
      this.observations.list(sessionId, { limit: 1_000 }),
    ]);
    return this.toControlStatus(session, observations.items.at(-1)?.seq);
  }

  async requestHuman(
    sessionId: string,
    request: RequestHumanRequest,
  ): Promise<ControlStatus> {
    const input = requestHumanRequestSchema.parse(request);

    return this.coordinator.execute(sessionId, () =>
      this.ownershipTransitions.requestHuman(sessionId, input.reason),
    );
  }

  async takeHumanControl(
    sessionId: string,
    authority: ControlMutationAuthority,
  ): Promise<ControlStatus> {
    return this.coordinator.execute(sessionId, () =>
      this.ownershipTransitions.takeHuman(sessionId, authority),
    );
  }

  async pauseAgentControl(
    sessionId: string,
    authority: ControlMutationAuthority,
  ): Promise<ControlStatus> {
    return this.coordinator.execute(sessionId, () =>
      this.ownershipTransitions.pauseAgent(sessionId, authority),
    );
  }

  async returnAgentControl(
    sessionId: string,
    authority: ControlMutationAuthority,
  ): Promise<ControlStatus> {
    return this.coordinator.execute(sessionId, () =>
      this.ownershipTransitions.returnAgent(
        sessionId,
        () => this.flushHumanActivity(sessionId),
        authority,
      ),
    );
  }

  async waitForControl(
    sessionId: string,
    request: ControlWaitRequest = {},
    signal?: AbortSignal,
  ): Promise<ControlWaitResult> {
    const input = controlWaitRequestSchema.parse(request);
    return this.controlWait.wait(
      sessionId,
      input.afterSeq ?? 0,
      input.timeoutMs ?? Math.min(this.config.timeouts.controlWaitMs, 60_000),
      signal,
    );
  }

  async saveEvidence(
    sessionId: string,
    request: SaveEvidenceRequest,
  ): Promise<Evidence> {
    await this.sessions.get(sessionId);
    const item = await this.evidence.save(sessionId, request);
    await this.observations.append(sessionId, {
      actor: "agent",
      type: "record_saved",
      data: { evidenceId: item.id, type: item.type, label: item.label },
    });
    return item;
  }

  async materializeFileEvidence(
    sessionId: string,
    input: {
      filename: string;
      mimeType: string;
      bytes: Uint8Array;
      source: "agent_generated" | "user_file_grant";
      grantId?: string;
    },
  ): Promise<Evidence> {
    await this.sessions.get(sessionId);
    const filename = fileArtifactNameSchema.parse(input.filename);
    const mimeType = fileArtifactMimeTypeSchema.parse(input.mimeType);
    if (
      input.source === "user_file_grant" &&
      (input.grantId === undefined ||
        !/^grant_[a-f0-9]{32}$/u.test(input.grantId))
    ) {
      throw new RoveError({
        code: "INVALID_CONFIGURATION",
        message:
          "User-selected file evidence requires a valid opaque grant ID.",
      });
    }
    if (input.source === "agent_generated" && input.grantId !== undefined) {
      throw new RoveError({
        code: "INVALID_CONFIGURATION",
        message: "Agent-generated file evidence cannot claim a user grant.",
      });
    }
    const limit =
      input.source === "agent_generated"
        ? MAX_GENERATED_FILE_BYTES
        : MAX_GRANTED_FILE_BYTES;
    if (input.bytes.byteLength > limit) {
      throw new RoveError({
        code: "FILE_ARTIFACT_TOO_LARGE",
        message: `File artifact exceeds the ${limit} byte limit for ${input.source}.`,
        details: { limitBytes: limit, source: input.source },
      });
    }

    const normalized = { ...input, filename, mimeType };
    const item = await this.evidence.saveFileArtifact(sessionId, normalized);
    await this.observations.append(sessionId, {
      actor: input.source === "user_file_grant" ? "human" : "agent",
      type:
        input.source === "user_file_grant"
          ? "local_file_granted"
          : "file_artifact_created",
      data: {
        evidenceId: item.id,
        filename,
        mimeType,
        sizeBytes: input.bytes.byteLength,
        source: input.source,
        ...(input.grantId === undefined ? {} : { grantId: input.grantId }),
      },
    });
    return item;
  }

  async listEvidence(sessionId: string): Promise<Evidence[]> {
    await this.sessions.get(sessionId);
    return this.evidence.list(sessionId);
  }

  async deleteFileGrant(sessionId: string, grantId: string) {
    await this.sessions.get(sessionId);
    const deleted = await this.evidence.deleteGrant(sessionId, grantId);
    return { sessionId, grantId, deleted };
  }

  async readEvidence(
    sessionId: string,
    evidenceId: string,
  ): Promise<EvidenceReadResult> {
    await this.sessions.get(sessionId);
    return this.evidence.read(sessionId, evidenceId);
  }

  async getObservations(
    sessionId: string,
    query?: ObservationQuery,
  ): Promise<ObservationPage> {
    await this.sessions.get(sessionId);
    return this.observations.list(sessionId, query);
  }

  private async mutateAction(
    sessionId: string,
    signature: string,
    operation: () => Promise<ActionResult>,
    observation: (result: ActionResult) => {
      type: string;
      data: unknown;
    },
    proposal?: BrowserActionProposal,
  ): Promise<ActionResult> {
    const { result } = await this.mutateValue(
      sessionId,
      async (lease) => {
        await this.paceAgentAction(sessionId);

        lease.assertCurrent();

        await this.authorizeMutation(sessionId, signature, lease, proposal);

        let actionResult: ActionResult;

        try {
          actionResult = await operation();
        } catch (error) {
          if (!(error instanceof InteractionDispatchError)) {
            throw error;
          }

          throw new RoveError({
            code: "ACTION_OUTCOME_UNKNOWN",
            message:
              error.stage === "post_action_synchronization"
                ? "The browser action completed, but Rove could not finish post-action synchronization. Inspect before deciding whether any replay is safe."
                : "The browser action may have been dispatched. Inspect before deciding whether any replay is safe.",
            retryable: false,
            details: {
              dispatched: true,
              stage: error.stage,
              ...(error.result === undefined
                ? {}
                : { partialResult: error.result }),
            },
          });
        }

        const result = {
          ...actionResult,
          sessionId,
        };

        lease.assertCurrent();

        const event = observation(result);

        await this.observations.append(sessionId, {
          actor: "agent",
          type: event.type,
          data: event.data,
          ...(result.pageId === undefined ? {} : { pageId: result.pageId }),
          ...(result.currentRevision === undefined
            ? {}
            : {
                pageRevision: result.currentRevision,
              }),
        });

        lease.assertCurrent();

        await this.syncActivePage(sessionId, lease);

        lease.assertCurrent();

        let assessment: PageInspectionPolicyRecord | undefined;

        try {
          assessment = await this.assessBrowser(
            sessionId,
            this.browser.get(sessionId),
            lease,
          );
        } catch (error) {
          lease.assertCurrent();

          if (!(error instanceof RoveError) || error.code !== "PAGE_CHANGED") {
            throw error;
          }
        }

        lease.assertCurrent();

        return {
          result,
          assessment,
        };
      },
      async ({ assessment }) => {
        if (assessment === undefined) {
          return;
        }

        // IMPORTANT:
        // mutateValue releases the browser ownership lease before
        // invoking this callback. Automatic F2 handoff can therefore
        // drain safely instead of waiting on its own action lease.
        await this.pagePolicyOrchestrator.orchestrate(
          sessionId,
          assessment.policyDecision,
          assessment.pageState,
          "post_action",
        );
      },
    );

    return result;
  }

  private async paceAgentAction(sessionId: string): Promise<void> {
    if (this.config.browser.headless) return;
    const interval = this.config.browser.minimumActionIntervalMs;
    const last = this.lastAgentActionAt.get(sessionId) ?? 0;
    const remaining = interval - (Date.now() - last);
    if (remaining > 0)
      await new Promise<void>((resolveDelay) =>
        setTimeout(resolveDelay, remaining),
      );
    this.lastAgentActionAt.set(sessionId, Date.now());
  }

  private async authorizeMutation(
    sessionId: string,
    signature: string,
    lease: BrowserOwnershipLease,
    proposal?: BrowserActionProposal,
  ): Promise<void> {
    try {
      lease.assertCurrent();

      const browser = this.browser.get(sessionId);

      const identity = await browser.pageStateIdentity();

      lease.assertCurrent();

      const pages = await browser.pages();

      lease.assertCurrent();

      const activePage = pages.find((page) => page.active);

      const currentRevision =
        activePage?.id === identity.pageId ? activePage.revision : undefined;

      this.interactionPolicy.requireFreshInspectionRevision(
        sessionId,
        identity.pageId,
        currentRevision,
      );

      if (proposal === undefined) {
        this.interactionPolicy.authorizeMutation(
          sessionId,
          signature,
          Date.now(),
          identity,
        );
      } else {
        this.interactionPolicy.authorizeAction(
          sessionId,
          signature,
          proposal,
          Date.now(),
          identity,
        );
      }

      lease.assertCurrent();
    } catch (error) {
      if (error instanceof RoveError && error.code !== "CONTROL_NOT_OWNED") {
        // If ownership changed while authorization was being derived,
        // prefer the ownership failure and do not emit a stale policy
        // rejection.
        lease.assertCurrent();

        await this.observations.append(sessionId, {
          actor: "system",
          type: "policy_action_rejected",
          data: {
            action: signature.split(":", 1)[0],
            code: error.code,
            retryable: error.retryable,
            ...(error.details === undefined
              ? {}
              : {
                  details: error.details,
                }),
          },
        });

        lease.assertCurrent();
      }

      throw error;
    }
  }

  private async assessBrowser(
    sessionId: string,
    browser: {
      inspect(options?: InspectOptions): Promise<PageInspection>;
    },
    lease?: BrowserOwnershipLease,
  ): Promise<PageInspectionPolicyRecord> {
    const inspection = await browser.inspect({
      includeText: false,
      includeTargets: false,
      includeViewport: false,
      includeStructure: false,
    });

    lease?.assertCurrent();

    const assessment = this.interactionPolicy.recordInspection(
      sessionId,
      inspection,
    );

    lease?.assertCurrent();

    return assessment;
  }

  private enqueueHumanActivity(
    sessionId: string,
    activity: BrowserActivity,
  ): void {
    const previous =
      this.humanActivityQueues.get(sessionId) ?? Promise.resolve();

    const next = previous
      .then(() => this.persistHumanActivity(sessionId, activity))
      .catch(() => undefined)
      .finally(() => {
        if (this.humanActivityQueues.get(sessionId) === next) {
          this.humanActivityQueues.delete(sessionId);
        }
      });

    this.humanActivityQueues.set(sessionId, next);
  }

  private async persistHumanActivity(
    sessionId: string,
    activity: BrowserActivity,
  ): Promise<void> {
    const session = await this.sessions.get(sessionId).catch(() => null);

    if (
      session === null ||
      session.status !== "active" ||
      session.controller !== "human"
    ) {
      return;
    }

    const observationType = this.humanObservationType(activity.type);

    await this.observations.append(sessionId, {
      actor: "human",
      type: observationType,
      data: activity.data,
      pageId: activity.pageId,
      ...(activity.pageRevision === undefined
        ? {}
        : {
            pageRevision: activity.pageRevision,
          }),
    });
  }

  private async flushHumanActivity(sessionId: string): Promise<void> {
    await this.humanActivityQueues.get(sessionId);
  }

  private enqueueDownloadEvidence(
    sessionId: string,
    activity: BrowserActivity,
  ): void {
    const previous =
      this.humanActivityQueues.get(sessionId) ?? Promise.resolve();

    const next = previous
      .then(async () => {
        try {
          const signal = await this.persistDownloadEvidence(
            sessionId,
            activity,
          );
          this.resolveDownloadEffectBoundary(activity, signal);
        } catch {
          this.resolveDownloadEffectBoundary(activity, {
            state: "unresolved",
            code: "DOWNLOAD_PERSISTENCE_FAILED",
          });
        }
      })
      .finally(() => {
        if (this.humanActivityQueues.get(sessionId) === next) {
          this.humanActivityQueues.delete(sessionId);
        }
      });

    this.humanActivityQueues.set(sessionId, next);
  }

  private async persistDownloadEvidence(
    sessionId: string,
    activity: BrowserActivity,
  ): Promise<DownloadEffectSignal> {
    const data = activity.data as Record<string, unknown>;
    const path = typeof data.path === "string" ? data.path : undefined;
    const filename =
      typeof data.filename === "string" ? data.filename : "download";

    if (path === undefined) {
      const observation = await this.observations.append(sessionId, {
        actor: "browser",
        type: "download_failed",
        data: {
          reason: "Managed download completed without a saved path.",
          filename,
        },
        pageId: activity.pageId,
        ...(activity.pageRevision === undefined
          ? {}
          : { pageRevision: activity.pageRevision }),
      });
      return {
        state: "contradicted",
        filename,
        observationId: observation.id,
        code: "DOWNLOAD_FAILED",
      };
    }

    const bytes = await readFile(path);
    const mime = await detectDownloadMimeType(bytes, filename);
    const item = await this.evidence.savePayload(
      sessionId,
      {
        type: "file",
        label: filename,
        pageId: activity.pageId,
        ...(activity.pageRevision === undefined
          ? {}
          : { pageRevision: activity.pageRevision }),
        ...(typeof data.url === "string" ? { url: data.url } : {}),
        metadata: {
          filename,
          managedPath: path,
          directory: data.directory,
          sizeBytes: data.sizeBytes,
          suggestedFilename: data.suggestedFilename,
          mimeType: mime.mimeType,
          mimeTypeBasis: mime.basis,
          ...(mime.detectedExtension === undefined
            ? {}
            : { detectedExtension: mime.detectedExtension }),
          ...(typeof data.downloadUrl === "string"
            ? { downloadUrl: data.downloadUrl }
            : {}),
          source: "browser_download",
        },
      },
      bytes,
    );

    const observation = await this.observations.append(sessionId, {
      actor: "browser",
      type: "download_completed",
      data: {
        evidenceId: item.id,
        filename,
        sizeBytes:
          typeof data.sizeBytes === "number"
            ? data.sizeBytes
            : bytes.byteLength,
        mimeType: mime.mimeType,
        mimeTypeBasis: mime.basis,
        managedPath: path,
        ...(typeof data.downloadUrl === "string"
          ? { downloadUrl: data.downloadUrl }
          : {}),
        ...(data.correlation === "matched" || data.correlation === "ambiguous"
          ? { correlation: data.correlation }
          : {}),
        ...(data.correlationStrategy === "trusted_anchor" ||
        data.correlationStrategy === "chromium_pdf_viewer" ||
        data.correlationStrategy === "trusted_action_download"
          ? { correlationStrategy: data.correlationStrategy }
          : {}),
      },
      pageId: activity.pageId,
      ...(activity.pageRevision === undefined
        ? {}
        : { pageRevision: activity.pageRevision }),
    });
    await this.controlWait.publish(sessionId, observation);
    return {
      state: "observed",
      filename,
      observationId: observation.id,
      evidenceId: item.id,
    };
  }

  private persistBrowserActivity(
    sessionId: string,
    activity: BrowserActivity,
  ): void {
    if (activity.type === "page_closed")
      void this.recordings
        .interruptForPage(sessionId, activity.pageId)
        .catch(() => undefined);
    if (activity.type === "browser_evidence") {
      this.enqueueBrowserEvidence(sessionId, activity);
      return;
    }

    if (activity.type === "download_completed") {
      this.enqueueDownloadEvidence(sessionId, activity);
      return;
    }

    if (activity.type === "download_failed") {
      void this.observations
        .append(sessionId, {
          actor: "browser",
          type: "download_failed",
          data: activity.data,
          pageId: activity.pageId,
          ...(activity.pageRevision === undefined
            ? {}
            : {
                pageRevision: activity.pageRevision,
              }),
        })
        .then((observation) => {
          this.resolveDownloadEffectBoundary(activity, {
            state: "contradicted",
            observationId: observation.id,
            ...(typeof activity.data.suggestedFilename === "string"
              ? { filename: activity.data.suggestedFilename }
              : {}),
            code: "DOWNLOAD_FAILED",
          });
        })
        .catch(() => {
          this.resolveDownloadEffectBoundary(activity, {
            state: "unresolved",
            code: "DOWNLOAD_PERSISTENCE_FAILED",
          });
        });
      return;
    }

    if (activity.type === "download_correlation_unavailable") {
      void this.observations
        .append(sessionId, {
          actor: "browser",
          type: "download_correlation_unavailable",
          data: activity.data,
          pageId: activity.pageId,
          ...(activity.pageRevision === undefined
            ? {}
            : { pageRevision: activity.pageRevision }),
        })
        .then((observation) => {
          this.resolveDownloadEffectBoundary(activity, {
            state: "unresolved",
            observationId: observation.id,
            code: "DOWNLOAD_CORRELATION_UNAVAILABLE",
          });
        })
        .catch(() => {
          this.resolveDownloadEffectBoundary(activity, {
            state: "unresolved",
            code: "DOWNLOAD_PERSISTENCE_FAILED",
          });
        });
      return;
    }

    this.enqueueHumanActivity(sessionId, activity);
  }

  private registerDownloadEffectBoundary(): {
    id: string;
    result: Promise<DownloadEffectSignal>;
    cancel: () => void;
  } {
    const id = `dlb_${randomUUID().replaceAll("-", "")}`;
    let resolveResult!: (signal: DownloadEffectSignal) => void;
    const result = new Promise<DownloadEffectSignal>((resolvePromise) => {
      resolveResult = resolvePromise;
    });
    const timeout = setTimeout(() => {
      this.downloadEffectWaiters.delete(id);
      resolveResult({ state: "unresolved", code: "DOWNLOAD_TIMEOUT" });
    }, this.config.timeouts.actionMs);
    this.downloadEffectWaiters.set(id, {
      resolve: resolveResult,
      timeout,
    });
    return {
      id,
      result,
      cancel: () => {
        const waiter = this.downloadEffectWaiters.get(id);
        if (waiter === undefined) return;
        clearTimeout(waiter.timeout);
        this.downloadEffectWaiters.delete(id);
        waiter.resolve({ state: "unresolved", code: "DOWNLOAD_CANCELLED" });
      },
    };
  }

  private resolveDownloadEffectBoundary(
    activity: BrowserActivity,
    signal: DownloadEffectSignal,
  ): void {
    const boundaryId = activity.data.actionBoundaryId;
    if (typeof boundaryId !== "string") return;
    const waiter = this.downloadEffectWaiters.get(boundaryId);
    if (waiter === undefined) return;
    if (activity.data.correlation === "ambiguous") {
      signal = {
        state: "unresolved",
        code: "DOWNLOAD_CORRELATION_AMBIGUOUS",
      };
    }
    clearTimeout(waiter.timeout);
    this.downloadEffectWaiters.delete(boundaryId);
    waiter.resolve(signal);
  }

  private enqueueBrowserEvidence(
    sessionId: string,
    activity: BrowserActivity,
  ): void {
    const previous =
      this.browserEvidenceQueues.get(sessionId) ?? Promise.resolve();
    const evidence = activity.data.evidence as Record<string, unknown>;
    const next = previous
      .then(() =>
        this.evidence.savePayload(
          sessionId,
          {
            type: "record",
            label: "browser_evidence",
            pageId: activity.pageId,
            ...(activity.pageRevision === undefined
              ? {}
              : { pageRevision: activity.pageRevision }),
            ...(typeof evidence.destinationUrl === "string"
              ? { url: evidence.destinationUrl }
              : typeof evidence.url === "string"
                ? { url: evidence.url }
                : {}),
            metadata: {
              source: "browser_evidence",
              kind:
                typeof evidence.kind === "string"
                  ? evidence.kind
                  : "navigation",
            },
          },
          activity.data,
        ),
      )
      .then(() => undefined)
      .catch(() => undefined)
      .finally(() => {
        if (this.browserEvidenceQueues.get(sessionId) === next) {
          this.browserEvidenceQueues.delete(sessionId);
        }
      });
    this.browserEvidenceQueues.set(sessionId, next);
  }

  private async flushBrowserEvidence(sessionId: string): Promise<void> {
    await this.browserEvidenceQueues.get(sessionId);
  }

  private async releaseProfileLock(sessionId: string): Promise<void> {
    // BrowserService releases a live host lease only after its final page
    // group detaches. Recovery still removes a verifiably stale lease when no
    // in-process host owns the workspace.
    const session = await this.sessions.get(sessionId);
    if (
      session.workspace !== undefined &&
      !this.browser.hasWorkspace(session.workspace.id)
    ) {
      await RoveProfileLock.releaseClaimable(session.workspace.userDataDir, {
        runtimeInstanceId: RUNTIME_PROVENANCE.runtimeInstanceId,
        sessionId,
      });
    }
  }

  private humanObservationType(type: BrowserActivity["type"]): string {
    switch (type) {
      case "interaction_click":
        return "human_click";
      case "form_submitted":
        return "human_submit";
      case "scroll_milestone":
        return "human_scroll";
      case "selection_changed":
        return "human_selection";
      default:
        return type;
    }
  }

  private async mutateValue<T>(
    sessionId: string,
    operation: (lease: BrowserOwnershipLease) => Promise<T>,
    afterOperation?: (result: T) => Promise<void>,
  ): Promise<T> {
    return this.coordinator.execute(sessionId, async () => {
      const session = await this.requireActive(sessionId);

      this.control.assertCanMutate(session, "agent");

      const result = await this.ownershipFence.runAgentBrowserOperation(
        sessionId,
        operation,
      );

      // runAgentBrowserOperation has released the ownership lease
      // before control reaches this callback.
      if (afterOperation !== undefined) {
        await afterOperation(result);
      }

      return result;
    });
  }

  private async syncActivePage(
    sessionId: string,
    lease: BrowserOwnershipLease,
  ): Promise<void> {
    const pages = await this.browser.get(sessionId).pages();

    lease.assertCurrent();

    const activePageId = pages.find((page) => page.active)?.id;

    const session = await this.sessions.get(sessionId);

    lease.assertCurrent();

    if (activePageId !== undefined && activePageId !== session.activePageId) {
      await this.sessions.update({
        ...session,
        activePageId,
      });

      lease.assertCurrent();
    }
  }

  private async requireActive(sessionId: string): Promise<Session> {
    const session = await this.sessions.get(sessionId);
    this.sessions.assertActive(session);
    return session;
  }

  private toControlStatus(
    session: Session,
    observationSeq?: number,
  ): ControlStatus {
    return {
      sessionId: session.id,
      generation: this.ownershipFence.has(session.id)
        ? this.ownershipFence.generation(session.id)
        : (session.ownershipGeneration ?? 1),
      status: session.status,
      controller: session.controller,
      updatedAt: session.updatedAt,
      ...(session.handoff === undefined ? {} : { handoff: session.handoff }),
      ...(session.activeHandoffId === undefined
        ? {}
        : { activeHandoffId: session.activeHandoffId }),
      ...(session.activeHandoffGeneration === undefined
        ? {}
        : { activeHandoffGeneration: session.activeHandoffGeneration }),
      ...(session.lastReturnedHandoffId === undefined
        ? {}
        : { lastReturnedHandoffId: session.lastReturnedHandoffId }),
      ...(observationSeq === undefined ? {} : { observationSeq }),
    };
  }
}
