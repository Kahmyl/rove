import type {
  ActionResult,
  ClickRequest,
  ControlStatus,
  ControlWaitRequest,
  ControlWaitResult,
  RequestHumanRequest,
  Evidence,
  EvidenceReadResult,
  InspectOptions,
  NavigateRequest,
  ObservationPage,
  ObservationQuery,
  PageInspection,
  PageSummary,
  PressRequest,
  SaveEvidenceRequest,
  ScreenshotOptions,
  SessionSnapshot,
  ScrollOptions,
  StartSessionRequest,
  TypeRequest,
  BrowserWorkspace,
  BrowserWorkspaceStatus,
  RuntimeSessionInventory,
} from "./types.js";
import type {
  AdvanceSemanticTransactionRequest,
  BeginSemanticTransactionRequest,
  SemanticTransactionAdvanceResult,
  SemanticTransactionSnapshot,
  SemanticTransactionVerificationResult,
  VerifySemanticTransactionRequest,
} from "./semantic-transaction.js";
import type {
  ActionReceipt,
  TargetResolution,
  TargetResolutionRequest,
  VerifiedInteractionRequest,
} from "./verified-interaction.js";

export const ROVE_RUNTIME = Symbol.for("ROVE_RUNTIME");

export interface RoveRuntime {
  listBrowserWorkspaces(): Promise<BrowserWorkspaceStatus>;
  createBrowserWorkspace(displayName: string): Promise<BrowserWorkspace>;
  selectBrowserWorkspace(workspaceId: string): Promise<BrowserWorkspaceStatus>;
  renameBrowserWorkspace(
    workspaceId: string,
    displayName: string,
  ): Promise<BrowserWorkspaceStatus>;
  deleteBrowserWorkspace(workspaceId: string): Promise<BrowserWorkspaceStatus>;
  startSession(request: StartSessionRequest): Promise<SessionSnapshot>;
  listSessionInventory(
    mode?: SessionSnapshot["mode"],
  ): Promise<RuntimeSessionInventory[]>;
  getSession(sessionId: string): Promise<SessionSnapshot>;
  recoverSession(sessionId: string): Promise<RuntimeSessionInventory>;
  endSession(sessionId: string): Promise<SessionSnapshot>;
  inspectBrowser(
    sessionId: string,
    options?: InspectOptions,
  ): Promise<PageInspection>;
  resolveBrowserTarget(
    sessionId: string,
    request: TargetResolutionRequest,
  ): Promise<TargetResolution>;
  interact(
    sessionId: string,
    request: VerifiedInteractionRequest,
  ): Promise<ActionReceipt>;
  beginSemanticTransaction(
    sessionId: string,
    request: BeginSemanticTransactionRequest,
  ): Promise<SemanticTransactionSnapshot>;
  advanceSemanticTransaction(
    sessionId: string,
    request: AdvanceSemanticTransactionRequest,
  ): Promise<SemanticTransactionAdvanceResult>;
  verifySemanticTransaction(
    sessionId: string,
    request: VerifySemanticTransactionRequest,
  ): Promise<SemanticTransactionVerificationResult>;
  getSemanticTransaction(
    sessionId: string,
    transactionId: string,
  ): Promise<SemanticTransactionSnapshot>;
  cancelSemanticTransaction(
    sessionId: string,
    transactionId: string,
  ): Promise<SemanticTransactionSnapshot>;
  navigate(sessionId: string, request: NavigateRequest): Promise<ActionResult>;
  openPage(sessionId: string, request: NavigateRequest): Promise<PageSummary>;
  click(sessionId: string, request: ClickRequest): Promise<ActionResult>;
  type(sessionId: string, request: TypeRequest): Promise<ActionResult>;
  press(sessionId: string, request: PressRequest): Promise<ActionResult>;
  scroll(sessionId: string, request: ScrollOptions): Promise<ActionResult>;
  back(sessionId: string): Promise<ActionResult>;
  forward(sessionId: string): Promise<ActionResult>;
  pages(sessionId: string): Promise<PageSummary[]>;
  switchPage(sessionId: string, pageId: string): Promise<PageSummary>;
  closePage(sessionId: string, pageId: string): Promise<void>;
  captureScreenshot(
    sessionId: string,
    options?: ScreenshotOptions,
  ): Promise<Evidence>;
  getControlStatus(sessionId: string): Promise<ControlStatus>;
  requestHuman(
    sessionId: string,
    request: RequestHumanRequest,
  ): Promise<ControlStatus>;
  takeHumanControl(sessionId: string): Promise<ControlStatus>;
  pauseAgentControl(sessionId: string): Promise<ControlStatus>;
  returnAgentControl(sessionId: string): Promise<ControlStatus>;
  waitForControl(
    sessionId: string,
    request?: ControlWaitRequest,
  ): Promise<ControlWaitResult>;
  saveEvidence(
    sessionId: string,
    request: SaveEvidenceRequest,
  ): Promise<Evidence>;
  listEvidence(sessionId: string): Promise<Evidence[]>;
  readEvidence(
    sessionId: string,
    evidenceId: string,
  ): Promise<EvidenceReadResult>;
  getObservations(
    sessionId: string,
    query?: ObservationQuery,
  ): Promise<ObservationPage>;
}
