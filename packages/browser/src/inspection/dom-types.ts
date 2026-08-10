import type { TargetKind } from "@rove/protocol";

export interface DomCandidate {
  marker: string;
  tag: string;
  type?: string;
  role?: string;
  text: string;
  visible: boolean;
  disabled: boolean;
  contentEditable: boolean;
  tabIndex: number;

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
}

export interface SemanticCandidate extends DomCandidate {
  kind: TargetKind;
  name?: string;
  enabled: boolean;
}
