import type { TargetKind } from "@rove/protocol";

export interface DomCandidate {
  marker: string;
  tag: string;
  type?: string;
  role?: string;
  /** Playwright-computed role when the DOM does not carry an explicit role. */
  semanticRole?: string;
  text: string;
  visible: boolean;
  disabled: boolean;
  contentEditable: boolean;
  tabIndex: number;
  shadowRootDepth?: number;

  ariaLabel?: string;
  ariaLabelledbyText?: string;
  labelText?: string;
  alt?: string;
  title?: string;
  placeholder?: string;
  buttonValue?: string;

  id?: string;
  testId?: string;
  attributes?: Record<string, string>;
  domPathHint?: string;
  provenance?: "primary_dom" | "accessibility_recovery";
}

export interface SemanticCandidate extends DomCandidate {
  kind: TargetKind;
  name?: string;
  enabled: boolean;
}
