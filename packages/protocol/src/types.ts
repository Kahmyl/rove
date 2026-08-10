import type { z } from "zod";
import type {
  actorSchema,
  browserProfileSchema,
  clickRequestSchema,
  controllerSchema,
  evidenceReadResultSchema,
  evidenceSchema,
  evidenceTypeSchema,
  inspectOptionsSchema,
  navigateRequestSchema,
  observationQuerySchema,
  observationSchema,
  pressRequestSchema,
  saveEvidenceRequestSchema,
  screenshotRequestSchema,
  sessionModeSchema,
  sessionSchema,
  sessionStatusSchema,
  scrollRequestSchema,
  startSessionRequestSchema,
  targetKindSchema,
  targetReferenceSchema,
  typeRequestSchema,
} from "./schemas.js";

export type SessionMode = z.infer<typeof sessionModeSchema>;
export type SessionStatus = z.infer<typeof sessionStatusSchema>;
export type Controller = z.infer<typeof controllerSchema>;
export type Actor = z.infer<typeof actorSchema>;
export type BrowserProfileConfig = z.infer<typeof browserProfileSchema>;
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
export type SaveEvidenceRequest = z.infer<typeof saveEvidenceRequestSchema>;
export type NavigateRequest = z.input<typeof navigateRequestSchema>;
export type ClickRequest = z.input<typeof clickRequestSchema>;
export type TypeRequest = z.input<typeof typeRequestSchema>;
export type PressRequest = z.input<typeof pressRequestSchema>;
export type ScrollOptions = z.input<typeof scrollRequestSchema>;
export type ScreenshotOptions = z.input<typeof screenshotRequestSchema>;
export type EvidenceReadResult = z.infer<typeof evidenceReadResultSchema>;

export interface ControlState {
  controller: Controller;
  reason?: string;
  since: string;
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
}

export interface ControlTransferRequest {
  actor: "agent" | "human";
  controller: Controller;
  reason?: string;
}
