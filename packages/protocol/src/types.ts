import type { z } from "zod";
import type {
  actorSchema,
  browserHostIdentitySchema,
  browserSessionIdentitySchema,
  browserWorkspaceIdSchema,
  browserWorkspaceSchema,
  browserWorkspaceStatusSchema,
  browserWindowStateSchema,
  browserProfileSchema,
  browserRuntimeCapabilitiesSchema,
  browserRecoveryAdmissionRequestSchema,
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
  runtimeSessionInventorySchema,
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
import type {
  ActionPhaseRecord,
  BrowserInteractionRequest,
  PerceivedControl,
} from "./verified-interaction.js";

export type SessionMode = z.infer<typeof sessionModeSchema>;
export type SessionStatus = z.infer<typeof sessionStatusSchema>;
export type Controller = z.infer<typeof controllerSchema>;
export type HumanHandoff = z.infer<typeof humanHandoffSchema>;
export type Actor = z.infer<typeof actorSchema>;
export type BrowserHostIdentity = z.infer<typeof browserHostIdentitySchema>;
export type BrowserWindowState = z.infer<typeof browserWindowStateSchema>;
export type BrowserProfileConfig = z.infer<typeof browserProfileSchema>;
export type BrowserWorkspaceId = z.infer<typeof browserWorkspaceIdSchema>;
export type BrowserSessionIdentity = z.infer<
  typeof browserSessionIdentitySchema
>;
export type BrowserWorkspace = z.infer<typeof browserWorkspaceSchema>;
export type BrowserWorkspaceStatus = z.infer<
  typeof browserWorkspaceStatusSchema
>;
export type BrowserRuntimeCapabilities = z.infer<
  typeof browserRuntimeCapabilitiesSchema
>;
export type BrowserRecoveryAdmissionRequest = z.infer<
  typeof browserRecoveryAdmissionRequestSchema
>;
export type Session = z.infer<typeof sessionSchema>;
export type RuntimeSessionInventory = z.infer<
  typeof runtimeSessionInventorySchema
>;
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
  generation: number;
  status: SessionStatus;
  controller: Controller;
  handoff?: HumanHandoff;
  activeHandoffId?: string;
  activeHandoffGeneration?: number;
  lastReturnedHandoffId?: string;
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

export interface BrowserViewport extends Viewport {
  scrollX: number;
  scrollY: number;
  deviceScaleFactor: number;
}

export interface BrowserBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BrowserFrameReference {
  index: number;
  url: string;
  name?: string;
  main: boolean;
}

export interface BrowserTargetGeometry {
  bounds: BrowserBounds | null;
  inViewport: boolean;
  clipped: boolean;
  occluded: boolean;
}

export interface BrowserSemanticFrame extends BrowserFrameReference {
  snapshot: string;
  truncated: boolean;
}

export interface BrowserSemanticStructure {
  source: "playwright_aria_snapshot";
  frames: BrowserSemanticFrame[];
  truncated: boolean;
  characterLimit: number;
}

export interface BrowserObservationCapabilities {
  connection: "playwright" | "cdp";
  semanticHierarchy: boolean;
  targetGeometry: boolean;
  occlusion: boolean;
  frameProvenance: boolean;
  openShadowDom: boolean;
  screenshotModes: Array<"viewport" | "full-page" | "target" | "region">;
  capabilityAtlasVersion: string;
  interactionKinds: BrowserInteractionRequest["kind"][];
  semanticStates: Array<keyof PageTargetState>;
  humanBoundaries: Array<
    | "browser_permission"
    | "webauthn"
    | "payment"
    | "human_verification"
    | "closed_shadow_dom"
    | "browser_owned_ui"
  >;
}

export interface PageTargetState {
  checked?: boolean;
  selectedValues?: string[];
  value?: string;
  fileNames?: string[];
  files?: Array<{ name: string; size: number; sha256: string }>;
  focused?: boolean;
  expanded?: boolean;
  pressed?: boolean | "mixed";
  selected?: boolean;
  current?: boolean | string;
  busy?: boolean;
  invalid?: boolean | string;
  required?: boolean;
  readOnly?: boolean;
  open?: boolean;
  valueNow?: number;
  valueMin?: number;
  valueMax?: number;
  valueText?: string;
  orientation?: "horizontal" | "vertical";
  hasPopup?: boolean | string;
  controls?: string[];
  activeDescendant?: string;
}

export interface PageTarget {
  sessionId?: string;
  ref: string;
  kind: TargetKind;
  role?: string;
  name?: string;
  visible: boolean;
  enabled: boolean;
  sensitive?: boolean;
  frame?: BrowserFrameReference;
  shadowRootDepth?: number;
  geometry?: BrowserTargetGeometry;
  perceived?: PerceivedControl;
  state?: PageTargetState;
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

export interface BrowserObservation extends PageInspection {
  observationId: string;
  observedAt: string;
  mutationVersion: number;
  sessionId?: string;
  document: {
    url: string;
    revision: number;
  };
  viewport?: BrowserViewport;
  structure?: BrowserSemanticStructure;
  capabilities?: BrowserObservationCapabilities;
}

export type BrowserNavigationProvenance =
  "agent" | "human" | "browser" | "unknown";

/** Sanitized, bounded evidence for a main-document navigation. */
export interface BrowserNavigationEvidence {
  timestamp: string;
  pageId: string;
  frameId: string;
  mainFrame: boolean;
  navigationId: string;
  sourceUrl: string;
  destinationUrl: string;
  status?: number;
  redirectIndex: number;
  redirectedFromUrl?: string;
  failureReason?: string;
  provenance: BrowserNavigationProvenance;
}

export interface BrowserErrorEvidence {
  timestamp: string;
  pageId: string;
  kind: "page_error" | "console" | "request_failure";
  severity: "warning" | "error";
  summary: string;
  url?: string;
  resourceType?: string;
  frameId?: string;
  mainFrame?: boolean;
  detailHash?: string;
  originalSummaryLength?: number;
  urlPathHash?: string;
}

/** Evidence exposed by inspection; buffers are deliberately bounded. */
export interface BrowserEvidenceSnapshot {
  navigations: BrowserNavigationEvidence[];
  errors: BrowserErrorEvidence[];
  latestMainDocumentStatus?: number;
  truncation: {
    truncated: boolean;
    dropped: {
      navigationBuffer: number;
      errorBuffer: number;
      persistence: number;
    };
  };
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
  | "open_page"
  | "click"
  | "double_click"
  | "secondary_click"
  | "modified_click"
  | "type"
  | "press"
  | "scroll"
  | "back"
  | "forward"
  | "screenshot"
  | "switch_page"
  | "close_page"
  | "hover"
  | "focus"
  | "blur"
  | "clear"
  | "fill"
  | "type_sequential"
  | "select_text"
  | "select"
  | "check"
  | "uncheck"
  | "drag"
  | "upload"
  | "clipboard"
  | "precise_scroll"
  | "coordinate_click";

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
  phases?: ActionPhaseRecord[];
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
  ownership?: {
    runtimeInstanceId: string;
    sessionId: string;
  };
  timeouts?: {
    launchMs?: number;
    navigationMs?: number;
    actionMs?: number;
    inspectMs?: number;
  };
}
