import type {
  ActionResult,
  ControlState,
  Evidence,
  EvidenceReadResult,
  InspectOptions,
  NavigateRequest,
  ObservationPage,
  ObservationQuery,
  PageInspection,
  PressRequest,
  ScreenshotOptions,
  SessionSnapshot,
  StartSessionRequest,
  TargetReference,
  TypeRequest,
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
  healthCheck(timeoutMs?: number): Promise<void>;
  startSession(input: StartSessionRequest): Promise<SessionSnapshot>;
  getSession(sessionId: string): Promise<SessionSnapshot>;
  endSession(sessionId: string): Promise<SessionSnapshot>;
  getObservations(sessionId: string, input: ObservationQuery): Promise<ObservationPage>;
  navigate(sessionId: string, input: NavigateRequest): Promise<ActionResult>;
  inspect(sessionId: string, input: InspectOptions): Promise<PageInspection>;
  click(sessionId: string, input: { target: TargetReference }): Promise<ActionResult>;
  type(sessionId: string, input: TypeRequest): Promise<ActionResult>;
  press(sessionId: string, input: PressRequest): Promise<ActionResult>;
  scroll(sessionId: string, input: ScrollInput): Promise<ActionResult>;
  back(sessionId: string): Promise<ActionResult>;
  forward(sessionId: string): Promise<ActionResult>;
  screenshot(sessionId: string, input: ScreenshotOptions): Promise<Evidence>;
  saveRecord(sessionId: string, input: SaveRecordInput): Promise<Evidence>;
  listEvidence(sessionId: string): Promise<Evidence[]>;
  readEvidence(sessionId: string, evidenceId: string): Promise<EvidenceReadResult>;
  getControl(sessionId: string): Promise<ControlState>;
}
