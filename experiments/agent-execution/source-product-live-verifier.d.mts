export type LiveJourney =
  "github" | "gmail_calendar" | "drive" | "maps" | "irs_pdf";

export interface LiveJourneyVerification {
  ok: boolean;
  violations: string[];
  marker: Record<string, unknown> | null;
  independentEvidence: {
    persistedPdfSignature?: string | null;
  };
}

export function liveResultMarkerInstruction(journey: LiveJourney): string;

export function verifyLiveJourney(input: {
  journey: LiveJourney;
  task: unknown;
  ledger?: import("./source-product-live-ledger.mjs").LiveSessionLedger;
}): LiveJourneyVerification;
