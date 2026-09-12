import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  liveResultMarkerInstruction,
  verifyLiveJourney,
} from "../../../../../experiments/agent-execution/source-product-live-verifier.mjs";

const ids = {
  evidence1: `ev_${"1".repeat(32)}`,
  evidence2: `ev_${"2".repeat(32)}`,
  observation: `bobs_${"3".repeat(32)}`,
  downloadObservation: `obs_${"4".repeat(32)}`,
  receipt: `rcpt_${"5".repeat(32)}`,
  evidence3: `ev_${"6".repeat(32)}`,
  observation2: `obs_${"7".repeat(32)}`,
  receipt2: `rcpt_${"8".repeat(32)}`,
  receipt3: `rcpt_${"9".repeat(32)}`,
  receipt4: `rcpt_${"b".repeat(32)}`,
  receipt5: `rcpt_${"c".repeat(32)}`,
  receipt6: `rcpt_${"d".repeat(32)}`,
  receipt7: `rcpt_${"e".repeat(32)}`,
};
const sessionId = `ses_${"a".repeat(32)}`;

function task(marker: Record<string, unknown>, text = "Journey completed.") {
  return {
    roveSessionId: sessionId,
    conversation: {
      activeTurnId: "turn_1",
      turnStatus: "completed",
      items: {
        inspect: {
          id: "inspect",
          turnId: "turn_1",
          kind: "tool",
          status: "completed",
          title: "rove/browser.inspect",
        },
        screenshot1: {
          id: "screenshot1",
          turnId: "turn_1",
          kind: "tool",
          status: "completed",
          title: "rove/browser.screenshot",
        },
        screenshot2: {
          id: "screenshot2",
          turnId: "turn_1",
          kind: "tool",
          status: "completed",
          title: "rove/browser.screenshot",
        },
        interact1: {
          id: "interact1",
          turnId: "turn_1",
          kind: "tool",
          status: "completed",
          title: "rove/browser.interact",
        },
        interact2: {
          id: "interact2",
          turnId: "turn_1",
          kind: "tool",
          status: "completed",
          title: "rove/browser.interact",
        },
        back: {
          id: "back",
          turnId: "turn_1",
          kind: "tool",
          status: "completed",
          title: "rove/browser.back",
        },
        forward: {
          id: "forward",
          turnId: "turn_1",
          kind: "tool",
          status: "completed",
          title: "rove/browser.forward",
        },
        openPage: {
          id: "openPage",
          turnId: "turn_1",
          kind: "tool",
          status: "completed",
          title: "rove/browser.open_page",
        },
        switchPage: {
          id: "switchPage",
          turnId: "turn_1",
          kind: "tool",
          status: "completed",
          title: "rove/browser.switch_page",
        },
        scroll: {
          id: "scroll",
          turnId: "turn_1",
          kind: "tool",
          status: "completed",
          title: "rove/browser.scroll",
        },
        evidenceList: {
          id: "evidenceList",
          turnId: "turn_1",
          kind: "tool",
          status: "completed",
          title: "rove/evidence.list",
        },
        final: {
          id: "final",
          turnId: "turn_1",
          kind: "assistant_message",
          status: "completed",
          text: `ROVE_LIVE_RESULT ${JSON.stringify(marker)}\n${text}`,
        },
      },
    },
  };
}

const baseLedger = {
  sessionId,
  pageIds: ["page_01", "page_02"],
  observationIds: [ids.observation, ids.downloadObservation],
  evidenceIds: [ids.evidence1, ids.evidence2],
  screenshotEvidenceIds: [ids.evidence1, ids.evidence2],
  receipts: [],
  downloads: [],
  downloadFileEvidence: [],
};

function driveMarker() {
  return {
    journey: "drive",
    status: "passed",
    folderName: "Rove Browser Acceptance 20260910-1200",
    folderUrl: "https://drive.google.com/drive/folders/freshAcceptanceFolder",
    breadcrumb: "My Drive > Rove Browser Acceptance 20260910-1200 > Archive",
    sourceFileName: "rove-live-acceptance.txt",
    fileName: "rove-live-acceptance-renamed.txt",
    fileCount: 1,
    organized: true,
    historyReturned: true,
    historyReturnUrl:
      "https://drive.google.com/drive/folders/freshAcceptanceFolder",
    distinctPageIds: ["page_01"],
    durableObservationIds: [ids.observation],
    screenshotEvidenceIds: [ids.evidence1],
    receiptIds: [
      ids.receipt,
      ids.receipt3,
      ids.receipt4,
      ids.receipt5,
      ids.receipt6,
      ids.receipt7,
    ],
    finalObservationId: ids.observation,
    downloadObservationIds: [ids.downloadObservation],
    downloadEvidenceIds: [ids.evidence2],
    actualFilename: "rove-live-acceptance-renamed.txt",
    size: 42,
    mime: "text/plain",
    externalMutations: [
      "create_folder",
      "upload",
      "rename",
      "create_archive",
      "move",
      "download",
    ],
  };
}

function downloadLedger() {
  return {
    ...baseLedger,
    receipts: [
      {
        id: ids.receipt,
        observationId: ids.observation2,
        outcome: "applied",
        dispatched: true,
        consequential: true,
        effects: [
          {
            kind: "download_completed",
            state: "observed",
            observationId: ids.downloadObservation,
            evidenceId: ids.evidence2,
          },
        ],
      },
      ...[
        ids.receipt3,
        ids.receipt4,
        ids.receipt5,
        ids.receipt6,
        ids.receipt7,
      ].map((id) => ({
        id,
        observationId: ids.observation,
        outcome: "applied",
        dispatched: true,
        consequential: true,
        effects: [],
      })),
    ],
    downloads: [
      {
        observationId: ids.downloadObservation,
        evidenceId: ids.evidence2,
        filename: "rove-live-acceptance-renamed.txt",
        size: 42,
        mime: "text/plain",
        mimeBasis: "extension",
      },
    ],
    downloadFileEvidence: [
      {
        evidenceId: ids.evidence2,
        filename: "rove-live-acceptance-renamed.txt",
        size: 42,
        mime: "text/plain",
        mimeBasis: "extension",
        contentSignature: null as string | null,
      },
    ],
  };
}

function gmailMarker(observationId: string) {
  return {
    journey: "gmail_calendar",
    status: "passed",
    gmailUrl: "https://mail.google.com/mail/u/0/#inbox",
    calendarUrl: "https://calendar.google.com/calendar/u/0/r",
    requestedDuration: "30 minutes",
    schedulingPeriod: "tomorrow afternoon",
    emailEventTitle: "Rove acceptance review",
    note: "Created during Rove live acceptance.",
    created: true,
    createdEventTitle: "Rove acceptance review",
    titleEdited: true,
    eventTitle: "Rove live acceptance review",
    eventTime: "2026-09-11 14:00",
    eventDescription: "Created during Rove live acceptance.",
    eventCount: 1,
    noGuests: true,
    gmailReturnedOpen: true,
    externalMutations: ["calendar_event_create", "calendar_event_title_edit"],
    distinctPageIds: ["page_01", "page_02"],
    durableObservationIds: [observationId],
    screenshotEvidenceIds: [ids.evidence1],
    receiptIds: [ids.receipt3, ids.receipt4],
    finalObservationId: observationId,
  };
}

function gmailLedger(observationId: string) {
  return {
    ...baseLedger,
    observationIds: [observationId],
    receipts: [ids.receipt3, ids.receipt4].map((id) => ({
      id,
      observationId,
      outcome: "applied",
      dispatched: true,
      consequential: true,
      effects: [],
    })),
  };
}

function mapsMarker(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    journey: "maps",
    status: "passed",
    place: "Lekki Conservation Centre, Lagos",
    origin: "Murtala Muhammed International Airport",
    destination: "Lekki Conservation Centre",
    directionsShown: true,
    transit: "selected",
    transitUnavailableObservationId: null,
    routeOptions: [{ duration: "2 hr 12 min" }],
    routeObservationId: ids.observation,
    placeScreenshotEvidenceId: ids.evidence1,
    routeScreenshotEvidenceId: ids.evidence2,
    distinctPageIds: ["page_01"],
    durableObservationIds: [ids.observation],
    screenshotEvidenceIds: [ids.evidence1, ids.evidence2],
    ...overrides,
  };
}

describe("source product live journey verifier", () => {
  it("rejects a completed turn whose final response reports a stop", () => {
    const result = verifyLiveJourney({
      journey: "maps",
      task: task(
        {
          journey: "maps",
          status: "blocked",
          reason: "screenshot stale",
          distinctPageIds: ["page_01"],
          durableObservationIds: [ids.observation],
          screenshotEvidenceIds: [],
        },
        "The required journey was blocked before directions.",
      ),
      ledger: baseLedger,
    });

    expect(result.ok).toBe(false);
    expect(result.violations).toContain("journey_not_passed");
    expect(result.violations).toContain("final_reports_stop");
  });

  it("rejects a completed turn with incomplete evidence", () => {
    const result = verifyLiveJourney({
      journey: "drive",
      task: task({
        journey: "drive",
        status: "passed",
        folderUrl:
          "https://drive.google.com/drive/folders/12jhgOPxB6GuMWsCVaBY8z6rKaF68ns6q",
        breadcrumb: "My Drive > Rove Live Regression Gate 20260907 B",
        fileName: "rove-live-regression-gate-20260907-b.txt",
        fileCount: 1,
        historyReturned: true,
        historyReturnUrl:
          "https://drive.google.com/drive/folders/12jhgOPxB6GuMWsCVaBY8z6rKaF68ns6q",
        distinctPageIds: ["page_01"],
        durableObservationIds: [ids.observation],
        screenshotEvidenceIds: [ids.evidence1],
        receiptIds: [],
        downloadObservationIds: [],
        downloadEvidenceIds: [],
        actualFilename: "",
        size: 0,
        mime: "",
        externalMutations: ["download"],
      }),
      ledger: baseLedger,
    });

    expect(result.ok).toBe(false);
    expect(result.violations).toContain("receipt_ids_count");
    expect(result.violations).toContain("actual_filename_missing");
  });

  it("accepts a completed Maps journey with canonical counts and complete evidence", () => {
    const result = verifyLiveJourney({
      journey: "maps",
      task: task(
        mapsMarker(),
        "Directions and both screenshots are complete. I did not save or share the place.",
      ),
      ledger: baseLedger,
    });

    expect(result).toMatchObject({ ok: true, violations: [] });
  });

  it("rejects well-shaped observation and screenshot IDs absent from the run ledger", () => {
    const result = verifyLiveJourney({
      journey: "maps",
      task: task(
        mapsMarker({
          routeObservationId: ids.observation2,
          routeScreenshotEvidenceId: ids.evidence3,
          durableObservationIds: [ids.observation2],
          screenshotEvidenceIds: [ids.evidence1, ids.evidence3],
        }),
      ),
      ledger: baseLedger,
    });

    expect(result.ok).toBe(false);
    expect(result.violations).toContain("observation_id_not_in_ledger");
    expect(result.violations).toContain("screenshot_id_not_in_ledger");
  });

  it("rejects a download whose receipt effect does not correlate its observation and evidence", () => {
    const ledger = downloadLedger();
    ledger.receipts[0]!.effects[0]!.evidenceId = ids.evidence3;
    const result = verifyLiveJourney({
      journey: "drive",
      task: task(driveMarker()),
      ledger,
    });

    expect(result.ok).toBe(false);
    expect(result.violations).toContain("download_receipt_correlation");
  });

  it("rejects a run with two persisted managed downloads", () => {
    const ledger = downloadLedger();
    ledger.downloads.push({
      observationId: ids.observation2,
      evidenceId: ids.evidence3,
      filename: "duplicate.txt",
      size: 9,
      mime: "text/plain",
      mimeBasis: "extension",
    });
    ledger.downloadFileEvidence.push({
      evidenceId: ids.evidence3,
      filename: "duplicate.txt",
      size: 9,
      mime: "text/plain",
      mimeBasis: "extension",
      contentSignature: null,
    });
    const result = verifyLiveJourney({
      journey: "drive",
      task: task(driveMarker()),
      ledger,
    });

    expect(result.ok).toBe(false);
    expect(result.violations).toContain("run_download_count");
    expect(result.violations).toContain("run_download_file_count");
  });

  it("accepts extra ordinary receipts when exactly one receipt correlates the download", () => {
    const ledger = downloadLedger();
    ledger.receipts.unshift({
      id: ids.receipt2,
      observationId: ids.observation,
      outcome: "unknown",
      dispatched: false,
      consequential: false,
      effects: [],
    });
    const marker = driveMarker();
    marker.receiptIds.unshift(ids.receipt2);

    expect(
      verifyLiveJourney({ journey: "drive", task: task(marker), ledger }),
    ).toMatchObject({ ok: true, violations: [] });
  });

  it("rejects ephemeral observation IDs in the durable marker field", () => {
    const marker = driveMarker();
    marker.durableObservationIds = [`bobs_${"9".repeat(32)}`];
    const result = verifyLiveJourney({
      journey: "drive",
      task: task(marker),
      ledger: downloadLedger(),
    });

    expect(result.ok).toBe(false);
    expect(result.violations).toContain("observation_id_not_in_ledger");
  });

  it("rejects the deprecated observationIds marker field", () => {
    const marker = { ...driveMarker(), observationIds: [ids.observation] };
    const result = verifyLiveJourney({
      journey: "drive",
      task: task(marker),
      ledger: downloadLedger(),
    });

    expect(result.ok).toBe(false);
    expect(result.violations).toContain("ephemeral_observation_field");
  });

  it("requires Drive history to return to the exact folder rather than about:blank", () => {
    const marker = driveMarker();
    marker.historyReturnUrl = "about:blank";
    const result = verifyLiveJourney({
      journey: "drive",
      task: task(marker),
      ledger: downloadLedger(),
    });

    expect(result.ok).toBe(false);
    expect(result.violations).toContain("drive_history_url");
  });

  it("accepts the bounded Gmail success fixture with only its durable observation", () => {
    const gmailObservation = `bobs_${"a".repeat(32)}`;
    const marker = gmailMarker(gmailObservation);
    const ledger = gmailLedger(gmailObservation);

    expect(
      verifyLiveJourney({
        journey: "gmail_calendar",
        task: task(marker, "Ephemeral observations were used but not claimed."),
        ledger,
      }),
    ).toMatchObject({ ok: true, violations: [] });
  });

  it("accepts canonical short Rove tool titles from the production projection", () => {
    const gmailObservation = `bobs_${"b".repeat(32)}`;
    const marker = gmailMarker(gmailObservation);
    const projected = task(marker);
    for (const item of Object.values(projected.conversation.items)) {
      if (
        item.kind === "tool" &&
        "title" in item &&
        typeof item.title === "string"
      )
        item.title = item.title.replace(/^rove\//, "");
    }

    expect(
      verifyLiveJourney({
        journey: "gmail_calendar",
        task: projected,
        ledger: gmailLedger(gmailObservation),
      }),
    ).toMatchObject({ ok: true, violations: [] });
  });

  it("rejects a read-only existing Calendar event as a substitute for creation and edit", () => {
    const gmailObservation = `bobs_${"c".repeat(32)}`;
    const marker = {
      ...gmailMarker(gmailObservation),
      created: false,
      titleEdited: false,
      externalMutations: [],
      receiptIds: [],
    };
    const result = verifyLiveJourney({
      journey: "gmail_calendar",
      task: task(marker),
      ledger: { ...baseLedger, observationIds: [gmailObservation] },
    });
    expect(result.ok).toBe(false);
    expect(result.violations).toEqual(
      expect.arrayContaining([
        "event_not_created",
        "event_title_not_edited",
        "calendar_mutations",
        "calendar_mutation_receipts",
      ]),
    );
  });

  it("offline-rejects the retained read-only Gmail artifact under the corrected requirement", () => {
    const artifact = JSON.parse(
      readFileSync(
        resolve(
          import.meta.dirname,
          "../../../../../tests/fixtures/agent-execution/gmail-calendar-outcome.json",
        ),
        "utf8",
      ),
    );
    const messages = artifact.evidence.assistantMessages as Array<{
      id: string;
      turnId: string;
      text: string;
    }>;
    const tools = artifact.evidence.toolCalls as Array<{
      id: string;
      turnId: string;
      status: string;
      title: string;
    }>;
    const final = messages.at(-1)!;
    const items = Object.fromEntries([
      ...tools.map((entry) => [entry.id, { ...entry, kind: "tool" as const }]),
      ...messages.map((entry) => [
        entry.id,
        { ...entry, kind: "assistant_message" as const, status: "completed" },
      ]),
    ]);
    const result = verifyLiveJourney({
      journey: "gmail_calendar",
      task: {
        roveSessionId: artifact.liveLedger.sessionId,
        conversation: {
          activeTurnId: final.turnId,
          turnStatus: "completed",
          items,
        },
      },
      ledger: artifact.liveLedger,
    });
    expect(result.ok).toBe(false);
    expect(result.violations).toEqual(
      expect.arrayContaining([
        "event_not_created",
        "event_title_not_edited",
        "calendar_mutations",
      ]),
    );
  });

  it("accepts nullable IRS marker signature only with a persisted PDF signature", () => {
    const marker = {
      journey: "irs_pdf",
      status: "passed",
      sourceUrl: "https://www.irs.gov/forms-pubs/about-form-w-4",
      pdfUrl: "https://www.irs.gov/pub/irs-pdf/fw4.pdf",
      distinctPageIds: ["page_01", "page_02"],
      backForwardVerified: true,
      durableObservationIds: [ids.observation],
      screenshotEvidenceIds: [ids.evidence1, ids.evidence2],
      laterPageChanged: true,
      receiptIds: [ids.receipt],
      downloadObservationIds: [ids.downloadObservation],
      downloadEvidenceIds: [ids.evidence2],
      actualFilename: "fw4 (2).pdf",
      size: 208845,
      mime: "application/pdf",
      mimeBasis: "content_signature",
      pdfIdentityEvidence: "W-4 PDF title and URL",
      pdfSignature: null,
    };
    const ledger = downloadLedger();
    ledger.downloads[0] = {
      ...ledger.downloads[0]!,
      filename: "fw4 (2).pdf",
      size: 208845,
      mime: "application/pdf",
      mimeBasis: "content_signature",
    };
    ledger.downloadFileEvidence[0] = {
      ...ledger.downloadFileEvidence[0]!,
      filename: "fw4 (2).pdf",
      size: 208845,
      mime: "application/pdf",
      mimeBasis: "content_signature",
      contentSignature: "%PDF-1.7",
    };

    const result = verifyLiveJourney({
      journey: "irs_pdf",
      task: task(marker),
      ledger,
    });
    expect(result).toMatchObject({
      ok: true,
      violations: [],
      independentEvidence: { persistedPdfSignature: "%PDF-1.7" },
    });

    ledger.downloadFileEvidence[0]!.contentSignature = null;
    expect(
      verifyLiveJourney({ journey: "irs_pdf", task: task(marker), ledger })
        .violations,
    ).toContain("irs_persisted_pdf_signature");
  });

  it("enforces marker position and explicit unavailable-transit evidence", () => {
    const marker = mapsMarker({
      transit: "unavailable",
      transitUnavailableObservationId: null,
    });
    const candidate = task(marker);
    candidate.conversation.items.final.text = `Preface\n${candidate.conversation.items.final.text}`;
    const result = verifyLiveJourney({
      journey: "maps",
      task: candidate,
      ledger: baseLedger,
    });

    expect(result.ok).toBe(false);
    expect(result.violations).toContain("marker_position");
    expect(result.violations).toContain("maps_transit_unavailable_evidence");

    const duplicate = task(marker);
    duplicate.conversation.items.final.text += `\nROVE_LIVE_RESULT ${JSON.stringify(marker)}`;
    const duplicateResult = verifyLiveJourney({
      journey: "maps",
      task: duplicate,
      ledger: baseLedger,
    });
    expect(duplicateResult.ok).toBe(false);
    expect(duplicateResult.violations).toContain("marker_count");
  });

  it("rejects Maps navigation-only traces without a semantic interaction", () => {
    const candidate = task(mapsMarker());
    for (const item of Object.values(candidate.conversation.items)) {
      if (
        item.kind === "tool" &&
        "title" in item &&
        item.title === "rove/browser.interact"
      )
        item.title = "rove/browser.navigate";
    }
    const result = verifyLiveJourney({
      journey: "maps",
      task: candidate,
      ledger: baseLedger,
    });
    expect(result.ok).toBe(false);
    expect(result.violations).toContain("maps_semantic_interaction");
  });

  it("publishes an explicit marker contract for every live journey", () => {
    for (const journey of [
      "github",
      "gmail_calendar",
      "drive",
      "maps",
      "irs_pdf",
    ] as const) {
      expect(liveResultMarkerInstruction(journey)).toContain(
        `"journey":"${journey}"`,
      );
      expect(liveResultMarkerInstruction(journey)).toContain(
        '"durableObservationIds"',
      );
      expect(liveResultMarkerInstruction(journey)).not.toContain(
        '"observationIds"',
      );
    }
  });

  it("keeps every Drive live outcome on the canonical fresh upload-organize-download fixture", () => {
    for (const filename of [
      "source-product-drive-live.mjs",
      "source-product-drive-live-retry.mjs",
      "source-product-drive-live-retry2.mjs",
    ]) {
      const source = readFileSync(
        resolve(
          import.meta.dirname,
          "../../../../../experiments/agent-execution",
          filename,
        ),
        "utf8",
      );
      expect(source).toContain(
        "Omit the optional download_completed filename because this journey is discovering and reporting the actual collision-safe saved filename.",
      );
      expect(source).toContain("Rove Browser Acceptance");
      expect(source).toContain("rove-live-acceptance.txt");
      expect(source).toContain("rove-live-acceptance-renamed.txt");
      expect(source).toMatch(/create Archive|Create a subfolder named Archive/);
      expect(source).toContain("drive-attachment-consent");
      expect(source).toContain(
        "Use that name only to identify the remote source file.",
      );
      expect(source).toContain(
        "Obtain the actual local saved filename from durable evidence",
      );
      expect(source).toContain(
        "Never retry because of a collision suffix or an uncertain dispatch.",
      );
      expect(source).toContain(
        "call Rove browser.navigate with https://drive.google.com/drive/my-drive",
      );
      expect(source).toContain(
        "Then call browser.back and require it to return to the exact",
      );
      expect(source).not.toMatch(
        /download_completed[^\n]{0,160}filename\s*[:=]\s*["']/,
      );
      expect(source).not.toContain("Rove Live Regression Gate 20260907 B");
    }
  });

  it("keeps the Gmail fixture on create-then-edit rather than read-only reuse", () => {
    const source = readFileSync(
      resolve(
        import.meta.dirname,
        "../../../../../experiments/agent-execution/source-product-gmail-calendar-live.mjs",
      ),
      "utf8",
    );
    expect(source).toContain("Create exactly one 30-minute event");
    expect(source).toContain("change only its title");
    expect(source).toContain("A pre-existing event is not a substitute");
    expect(source).not.toContain("Do not create, edit, delete");
  });
});
