export type BrowserActivityType =
  | "navigation_completed"
  | "url_changed"
  | "page_opened"
  | "page_title_changed"
  | "page_switched"
  | "dialog_opened"
  | "download_completed"
  | "download_failed"
  | "browser_evidence"
  | "interaction_click"
  | "form_submitted"
  | "scroll_milestone"
  | "selection_changed";

export interface BrowserActivity {
  type: BrowserActivityType;
  pageId: string;
  pageRevision?: number;
  timestamp: string;
  data: Record<string, unknown>;
}

export type BrowserActivityListener = (activity: BrowserActivity) => void;
