import type {
  ActionResult,
  ClickRequest,
  ControlState,
  ControlTransferRequest,
  Evidence,
  InspectOptions,
  NavigateRequest,
  ObservationPage,
  ObservationQuery,
  PageInspection,
  SaveEvidenceRequest,
  SessionSnapshot,
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
  transferControl(sessionId: string, request: ControlTransferRequest): Promise<ControlState>;
  saveEvidence(sessionId: string, request: SaveEvidenceRequest): Promise<Evidence>;
  getObservations(sessionId: string, query?: ObservationQuery): Promise<ObservationPage>;
}
