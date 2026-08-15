import type { z } from "zod";
import type {
  actorSchema,
  browserProfileSchema,
  browserRuntimeCapabilitiesSchema,
  clickRequestSchema,
  controllerSchema,
  evidenceReadResultSchema,
  humanHandoffSchema,
  evidenceSchema,
  evidenceTypeSchema,
  inspectOptionsSchema,
  navigateRequestSchema,
  observationQuerySchema,
  observationSchema,
  pressRequestSchema,
  saveEvidenceRequestSchema,
  screenshotOptionsSchema,
  sessionModeSchema,
  sessionSchema,
  sessionStatusSchema,
  scrollOptionsSchema,
  startSessionRequestSchema,
  switchPageRequestSchema,
  requestHumanRequestSchema,
  controlWaitRequestSchema,
  targetKindSchema,
  targetReferenceSchema,
  typeRequestSchema,
} from "./schemas.js";
import type { RoveErrorCode } from "./errors.js";

export type SessionMode = z.infer<typeof sessionModeSchema>;
export type SessionStatus = z.infer<typeof sessionStatusSchema>;
export type Controller = z.infer<typeof controllerSchema>;
export type HumanHandoff = z.infer<typeof humanHandoffSchema>;
export type Actor = z.infer<typeof actorSchema>;
export type BrowserProfileConfig = z.infer<typeof browserProfileSchema>;
export type BrowserRuntimeCapabilities = z.infer<
  typeof browserRuntimeCapabilitiesSchema
>;
export type Session = z.infer<typeof sessionSchema>;
export type SessionSnapshot = Session;
export type StartSessionRequest = z.input<typeof startSessionRequestSchema>;
export type TargetKind = z.infer<typeof targetKindSchema>;
export type TargetReference = z.infer<typeof targetReferenceSchema>;
export type InspectOptions = z.infer<typeof inspectOptionsSchema>;
export type Observation = z.infer<typeof observationSchema>;
export type ObservationQuery = z.input<typeof observationQuerySchema>;
export type EvidenceType = z.infer<typeof evidenceTypeSchema>;
export type Evidence = z.infer<typeof evidenceSchema>;
export type EvidenceReadResult = z.infer<typeof evidenceReadResultSchema>;
export type SaveEvidenceRequest = z.infer<typeof saveEvidenceRequestSchema>;
export type NavigateRequest = z.input<typeof navigateRequestSchema>;
export type ClickRequest = z.input<typeof clickRequestSchema>;
export type TypeRequest = z.input<typeof typeRequestSchema>;
export type PressRequest = z.input<typeof pressRequestSchema>;
export type ScrollOptions = z.input<typeof scrollOptionsSchema>;
export type ScreenshotOptions = z.input<typeof screenshotOptionsSchema>;
export type SwitchPageRequest = z.input<typeof switchPageRequestSchema>;

export interface ControlStatus {
  sessionId: string;
  status: SessionStatus;
  controller: Controller;
  handoff?: HumanHandoff;
  updatedAt: string;
  observationSeq?: number;
}

export type RequestHumanRequest = z.infer<typeof requestHumanRequestSchema>;
export type ControlWaitRequest = z.infer<typeof controlWaitRequestSchema>;
export type ControlWaitEvent =
  | "human_requested"
  | "human_took_control"
  | "human_returned_control"
  | "session_completed"
  | "session_failed"
  | "timeout";
export interface ControlWaitResult {
  event: ControlWaitEvent;
  sessionId: string;
  controller: Controller;
  status: SessionStatus;
  observationSeq?: number;
  handoff?: HumanHandoff;
}

export interface Viewport {
  width: number;
  height: number;
}

export interface PageTarget {
  ref: string;
  kind: TargetKind;
  role?: string;
  name?: string;
  visible: boolean;
  enabled: boolean;
  sensitive?: boolean;
}

export interface PageInspection {
  pageId: string;
  revision: number;
  url: string;
  title: string;
  viewport?: Viewport;
  text?: string;
  targets?: PageTarget[];
  metadata?: Record<string, unknown>;
}

export type PageStateKind =
  | "ready"
  | "loading"
  | "authentication_required"
  | "human_verification"
  | "access_restricted"
  | "unknown_interstitial"
  | "error";

export type PageStateRecommendedAction =
  "continue" | "wait_and_inspect" | "request_human" | "stop";

/** Deterministic assessment attached to every browser inspection. */
/**
 * Production page-state perception.
 *
 * This contract answers only what F1 believes is happening in the browser.
 * Operational decisions belong to PagePolicyDecision.
 */
export interface PagePerceptionAssessment {
  kind: PageStateKind;
  confidence: "high" | "medium" | "low";
  signals: string[];
}

/**
 * @deprecated Frozen F1 research compatibility contract.
 *
 * Historical research artifacts still use recommendedAction and must remain
 * byte-for-byte unchanged. Production perception must use
 * PagePerceptionAssessment instead.
 */
export interface PageStateAssessment extends PagePerceptionAssessment {
  recommendedAction: PageStateRecommendedAction;
}

export type PageStateTruth = boolean | "indeterminate";

export interface PageStatePropositions {
  primaryContentAvailable: PageStateTruth;
  documentUnstable: PageStateTruth;
  authenticationRequired: PageStateTruth;
  humanVerificationPresented: PageStateTruth;
  accessRestricted: PageStateTruth;
  errorPresented: PageStateTruth;
  interstitialPresented: PageStateTruth;
}

export type PagePolicyDisposition =
  "continue" | "wait_and_inspect" | "request_human" | "stop";

export type PagePolicyReason =
  | "page_ready"
  | "page_unstable"
  | "insufficient_confidence"
  | "unresolved_page_state"
  | "authentication_required"
  | "human_verification_required"
  | "access_restricted"
  | "unknown_interstitial"
  | "page_error";

export interface PagePolicyDecision {
  disposition: PagePolicyDisposition;
  reason: PagePolicyReason;
  mutationAllowed: boolean;
  retryable: boolean;
  errorCode?: RoveErrorCode;
  message: string;
}

export interface PageStateIdentity {
  pageId: string;
  fingerprint: string;
}

export interface PolicyDecision {
  allowed: boolean;
  code?: RoveErrorCode;
  reason: string;
  retryable: boolean;
  pageState?: PageStateAssessment;
}

export interface PageSummary {
  id: string;
  url: string;
  title?: string;
  active: boolean;
  revision: number;
}

export type BrowserActionType =
  | "navigate"
  | "click"
  | "type"
  | "press"
  | "scroll"
  | "back"
  | "forward"
  | "screenshot"
  | "switch_page"
  | "close_page";

export interface ActionResult {
  ok: boolean;
  action: BrowserActionType;
  sessionId: string;
  pageId?: string;
  pageChanged: boolean;
  previousRevision?: number;
  currentRevision?: number;
  url?: string;
  openedPages?: PageSummary[];
  observationSeq?: number;
}

export interface ObservationPage {
  items: Observation[];
  nextSeq?: number;
}

export type EvidencePayload = string | Uint8Array | Record<string, unknown>;

export interface Artifact {
  mimeType: string;
  bytes: Uint8Array;
  metadata?: Record<string, unknown>;
}

export interface BrowserLaunchConfig {
  headless: boolean;
  browser: "chrome" | "chromium";
  profile: BrowserProfileConfig;
  viewport?: Viewport;
  executablePath?: string;
  launchArgs?: string[];
  profileUserDataDir?: string;
  timeouts?: {
    launchMs?: number;
    navigationMs?: number;
    actionMs?: number;
    inspectMs?: number;
  };
  interaction?: {
    typingDelayMs?: number;
  };
}
