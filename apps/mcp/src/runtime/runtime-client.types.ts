import type {
  ActionResult,
  ControlStatus,
  ControlWaitRequest,
  ControlWaitResult,
  Evidence,
  EvidenceReadResult,
  GeneratedFileArtifactRequest,
  InspectOptions,
  NavigateRequest,
  ObservationPage,
  ObservationQuery,
  PageInspection,
  PageSummary,
  PressRequest,
  ScreenshotOptions,
  SessionSnapshot,
  StartSessionRequest,
  TargetReference,
  TypeRequest,
  ActionReceipt,
  TargetResolution,
  TargetResolutionRequest,
  VerifiedInteractionRequest,
  AdvanceSemanticTransactionRequest,
  BeginSemanticTransactionRequest,
  SemanticTransactionAdvanceResult,
  SemanticTransactionSnapshot,
  SemanticTransactionVerificationResult,
  VerifySemanticTransactionRequest,
  LocalFileGrantRequest,
  LocalFileGrantResult,
  PrepareTaskResultActionRequest,
  TaskResultActionPlan,
} from "@rove/protocol";

export interface ScrollInput {
  direction: "up" | "down" | "left" | "right";
  amount?: number;
}

export interface SaveRecordInput {
  label: string;
  record: Record<string, unknown>;
}

export interface RuntimeClient {
  healthCheck(timeoutMs?: number): Promise<unknown>;
  startSession(input: StartSessionRequest): Promise<SessionSnapshot>;
  getSession(sessionId: string): Promise<SessionSnapshot>;
  endSession(sessionId: string): Promise<SessionSnapshot>;
  getObservations(
    sessionId: string,
    input: ObservationQuery,
  ): Promise<ObservationPage>;
  navigate(sessionId: string, input: NavigateRequest): Promise<ActionResult>;
  openPage(sessionId: string, input: NavigateRequest): Promise<PageSummary>;
  pages(sessionId: string): Promise<PageSummary[]>;
  switchPage(sessionId: string, pageId: string): Promise<PageSummary>;
  closePage(sessionId: string, pageId: string): Promise<void>;
  inspect(sessionId: string, input: InspectOptions): Promise<PageInspection>;
  resolveTarget(
    sessionId: string,
    input: TargetResolutionRequest,
  ): Promise<TargetResolution>;
  interact(
    sessionId: string,
    input: VerifiedInteractionRequest,
  ): Promise<ActionReceipt>;
  prepareTaskResultAction(
    sessionId: string,
    input: PrepareTaskResultActionRequest,
  ): Promise<TaskResultActionPlan>;
  consequentialEffect(
    sessionId: string,
    consequenceKey: string,
  ): Promise<{
    effectId: string;
    state: string;
    consequenceKey: string;
    taskResultPlan?: TaskResultActionPlan;
  } | null>;
  beginSemanticTransaction(
    sessionId: string,
    input: BeginSemanticTransactionRequest,
  ): Promise<SemanticTransactionSnapshot>;
  advanceSemanticTransaction(
    sessionId: string,
    input: AdvanceSemanticTransactionRequest,
  ): Promise<SemanticTransactionAdvanceResult>;
  verifySemanticTransaction(
    sessionId: string,
    input: VerifySemanticTransactionRequest,
  ): Promise<SemanticTransactionVerificationResult>;
  getSemanticTransaction(
    sessionId: string,
    transactionId: string,
  ): Promise<SemanticTransactionSnapshot>;
  cancelSemanticTransaction(
    sessionId: string,
    transactionId: string,
  ): Promise<SemanticTransactionSnapshot>;
  click(
    sessionId: string,
    input: { target: TargetReference },
  ): Promise<ActionResult>;
  type(sessionId: string, input: TypeRequest): Promise<ActionResult>;
  press(sessionId: string, input: PressRequest): Promise<ActionResult>;
  scroll(sessionId: string, input: ScrollInput): Promise<ActionResult>;
  back(sessionId: string): Promise<ActionResult>;
  forward(sessionId: string): Promise<ActionResult>;
  screenshot(sessionId: string, input: ScreenshotOptions): Promise<Evidence>;
  createFileArtifact(
    sessionId: string,
    input: GeneratedFileArtifactRequest,
  ): Promise<Evidence>;
  requestLocalFileGrant(
    sessionId: string,
    input: LocalFileGrantRequest,
    signal?: AbortSignal,
  ): Promise<LocalFileGrantResult>;
  saveRecord(sessionId: string, input: SaveRecordInput): Promise<Evidence>;
  listEvidence(sessionId: string): Promise<Evidence[]>;
  readEvidence(
    sessionId: string,
    evidenceId: string,
  ): Promise<EvidenceReadResult>;
  getControlStatus(sessionId: string): Promise<ControlStatus>;
  requestHuman(sessionId: string, reason: string): Promise<ControlStatus>;
  waitForControl(
    sessionId: string,
    input: ControlWaitRequest,
    signal?: AbortSignal,
  ): Promise<ControlWaitResult>;
}
