export interface LiveSessionLedger {
  sessionId: string;
  pageIds: string[];
  observationIds: string[];
  evidenceIds: string[];
  screenshotEvidenceIds: string[];
  receipts: Array<{
    id: string;
    observationId: string;
    outcome: string;
    dispatched: boolean;
    consequential: boolean;
    effects: Array<{
      kind: string;
      state: string;
      observationId?: string;
      evidenceId?: string;
    }>;
  }>;
  downloads: Array<{
    observationId: string;
    evidenceId: string;
    filename: string;
    size: number;
    mime: string;
    mimeBasis?: string;
    correlation?: string;
  }>;
  downloadFileEvidence: Array<{
    evidenceId: string;
    filename: string;
    size: number;
    mime: string;
    mimeBasis?: string;
    contentSignature?: string | null;
  }>;
}

export function loadLiveSessionLedger(input: {
  productHome: string;
  sessionId: string;
}): Promise<LiveSessionLedger>;
