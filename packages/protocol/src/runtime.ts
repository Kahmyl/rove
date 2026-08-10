import type {
  ActionResult,
  ClickRequest,
  ControlState,
  ControlTransferRequest,
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
} from "./types.js";

export const ROVE_RUNTIME = Symbol.for("ROVE_RUNTIME");

export interface RoveRuntime {
  startSession(request: StartSessionRequest): Promise<SessionSnapshot>;
  getSession(sessionId: string): Promise<SessionSnapshot>;
  endSession(sessionId: string): Promise<SessionSnapshot>;
  inspectBrowser(sessionId: string, options?: InspectOptions): Promise<PageInspection>;
  navigate(sessionId: string, request: NavigateRequest): Promise<ActionResult>;
  click(sessionId: string, request: ClickRequest): Promise<ActionResult>;
  type(sessionId: string, request: TypeRequest): Promise<ActionResult>;
  press(sessionId: string, request: PressRequest): Promise<ActionResult>;
  scroll(sessionId: string, request: ScrollOptions): Promise<ActionResult>;
  back(sessionId: string): Promise<ActionResult>;
  forward(sessionId: string): Promise<ActionResult>;
  pages(sessionId: string): Promise<PageSummary[]>;
  switchPage(sessionId: string, pageId: string): Promise<PageSummary>;
  closePage(sessionId: string, pageId: string): Promise<void>;
  captureScreenshot(sessionId: string, options?: ScreenshotOptions): Promise<Evidence>;
  transferControl(sessionId: string, request: ControlTransferRequest): Promise<ControlState>;
  getControl(sessionId: string): Promise<ControlState>;
  saveEvidence(sessionId: string, request: SaveEvidenceRequest): Promise<Evidence>;
  listEvidence(sessionId: string): Promise<Evidence[]>;
  readEvidence(sessionId: string, evidenceId: string): Promise<EvidenceReadResult>;
  getObservations(sessionId: string, query?: ObservationQuery): Promise<ObservationPage>;
}
