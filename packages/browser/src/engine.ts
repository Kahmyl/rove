import type {
  ActionResult,
  Artifact,
  BrowserLaunchConfig,
  InspectOptions,
  PageInspection,
  PageSummary,
  ScreenshotOptions,
  ScrollOptions,
  TargetReference,
} from "@rove/protocol";
import type { BrowserActivityListener } from "./observation/browser-activity.js";

export interface BrowserSession {
  readonly id: string;
  onActivity(listener: BrowserActivityListener): () => void;
  inspect(options?: InspectOptions): Promise<PageInspection>;
  navigate(url: string): Promise<ActionResult>;
  click(target: TargetReference): Promise<ActionResult>;
  type(target: TargetReference, value: string): Promise<ActionResult>;
  press(target: TargetReference | null, key: string): Promise<ActionResult>;
  scroll(options: ScrollOptions): Promise<ActionResult>;
  back(): Promise<ActionResult>;
  forward(): Promise<ActionResult>;
  screenshot(options?: ScreenshotOptions): Promise<Artifact>;
  pages(): Promise<PageSummary[]>;
  switchPage(pageId: string): Promise<PageSummary>;
  closePage(pageId: string): Promise<void>;
  invalidateTargets(): Promise<void>;
  invalidateAllTargets(): Promise<number>;
  close(): Promise<void>;
}

export interface BrowserEngine {
  start(config: BrowserLaunchConfig): Promise<BrowserSession>;
}

export const BROWSER_ENGINE = Symbol.for("BROWSER_ENGINE");
