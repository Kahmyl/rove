const ID_PATTERNS = {
  evidence: /^ev_[a-f0-9]{32}$/,
  observation: /^(?:bobs|obs)_[a-f0-9]{32}$/,
  page: /^page_[A-Za-z0-9_-]+$/,
  receipt: /^rcpt_[a-f0-9]{32}$/,
};

const stoppedOutcome =
  /\b(?:journey|required (?:step|work)|download|directions|screenshot)\b[^\r\n.]{0,120}\b(?:blocked|failed|uncertain|unperformed|missing|not performed)\b|\b(?:blocked|failed)\b[^\r\n.]{0,120}\b(?:journey|required (?:step|work)|download|directions|screenshot)\b/i;

const markerSchemas = {
  github:
    '{"journey":"github","status":"passed","repositoryUrl":"https://github.com/...","issueUrl":"https://github.com/.../issues/1","repositoryPrivate":true,"issueNumber":1,"issueTitle":"[ROVE LIVE] Browser acceptance task","checklist":[true,false,false],"assignee":"...","label":"enhancement","historyReturned":true,"distinctPageIds":["page_...","page_..."],"durableObservationIds":["bobs_..."],"screenshotEvidenceIds":["ev_..."],"receiptIds":["rcpt_..."],"finalObservationId":"bobs_...","issueState":"open"}',
  gmail_calendar:
    '{"journey":"gmail_calendar","status":"passed","gmailUrl":"https://mail.google.com/...","calendarUrl":"https://calendar.google.com/...","requestedDuration":"30 minutes","schedulingPeriod":"tomorrow afternoon","emailEventTitle":"Rove acceptance review","note":"Created during Rove live acceptance.","created":true,"createdEventTitle":"Rove acceptance review","titleEdited":true,"eventTitle":"Rove live acceptance review","eventTime":"...","eventDescription":"Created during Rove live acceptance.","eventCount":1,"noGuests":true,"gmailReturnedOpen":true,"externalMutations":["calendar_event_create","calendar_event_title_edit"],"distinctPageIds":["page_...","page_..."],"durableObservationIds":["bobs_..."],"screenshotEvidenceIds":["ev_..."],"receiptIds":["rcpt_...","rcpt_..."],"finalObservationId":"bobs_..."}',
  drive:
    '{"journey":"drive","status":"passed","folderName":"Rove Browser Acceptance YYYYMMDD-HHMM","folderUrl":"https://drive.google.com/drive/folders/...","breadcrumb":"My Drive > Rove Browser Acceptance YYYYMMDD-HHMM > Archive","sourceFileName":"rove-live-acceptance.txt","fileName":"rove-live-acceptance-renamed.txt","fileCount":1,"organized":true,"historyReturned":true,"historyReturnUrl":"https://drive.google.com/drive/folders/...","distinctPageIds":["page_..."],"durableObservationIds":["bobs_..."],"screenshotEvidenceIds":["ev_..."],"receiptIds":["rcpt_..."],"finalObservationId":"bobs_...","downloadObservationIds":["obs_..."],"downloadEvidenceIds":["ev_..."],"actualFilename":"...","size":1,"mime":"...","externalMutations":["create_folder","upload","rename","create_archive","move","download"]}',
  maps: '{"journey":"maps","status":"passed","place":"Lekki Conservation Centre, Lagos","origin":"Murtala Muhammed International Airport","destination":"Lekki Conservation Centre","directionsShown":true,"transit":"selected","transitUnavailableObservationId":null,"routeOptions":[{"duration":"..."}],"routeObservationId":"bobs_...","placeScreenshotEvidenceId":"ev_...","routeScreenshotEvidenceId":"ev_...","distinctPageIds":["page_..."],"durableObservationIds":["bobs_..."],"screenshotEvidenceIds":["ev_...","ev_..."]}',
  irs_pdf:
    '{"journey":"irs_pdf","status":"passed","sourceUrl":"https://www.irs.gov/forms-pubs/about-form-w-4","pdfUrl":"https://www.irs.gov/...pdf","distinctPageIds":["page_...","page_..."],"backForwardVerified":true,"durableObservationIds":["bobs_..."],"screenshotEvidenceIds":["ev_...","ev_..."],"laterPageChanged":true,"receiptIds":["rcpt_..."],"downloadObservationIds":["obs_..."],"downloadEvidenceIds":["ev_..."],"actualFilename":"...pdf","size":1,"mime":"application/pdf","mimeBasis":"...","pdfIdentityEvidence":"...","pdfSignature":null}',
};

export function liveResultMarkerInstruction(journey) {
  const schema = markerSchemas[journey];
  if (!schema) throw new Error(`Unknown live journey ${journey}.`);
  return `Begin the final response with exactly one single-line machine result marker using this shape and real values: ROVE_LIVE_RESULT ${schema}. durableObservationIds must contain only ledger-backed IDs; mention ephemeral observations in prose, never in that field. receiptIds may include every actual receipt, but a download requires exactly one correlated applied dispatched download receipt. pdfSignature may be null or omitted because only the verifier may report persisted file bytes. An INVALID_INPUT/schema validation failure permits one mechanically corrected new request only when returned details prove the handler never ran and no effect was dispatched; never replay the identical malformed request. A safely completed read-only navigation/history operation with a wrong result permits at most one fresh-inspection-backed alternate read-only Rove route for that step. Set status to "blocked" or "failed" and include a reason instead of claiming passed when any required step or evidence is absent, uncertain, or unperformed.`;
}

function assertion(condition, message, violations) {
  if (!condition) violations.push(message);
}

function nonempty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function exactIds(value, pattern, minimum, name, violations) {
  assertion(Array.isArray(value), `${name}_not_array`, violations);
  if (!Array.isArray(value)) return [];
  assertion(value.length >= minimum, `${name}_count`, violations);
  assertion(
    new Set(value).size === value.length,
    `${name}_duplicates`,
    violations,
  );
  assertion(
    value.every((item) => typeof item === "string" && pattern.test(item)),
    `${name}_invalid`,
    violations,
  );
  return value;
}

function toolCount(task, suffix) {
  const canonicalTitle = suffix.startsWith("/") ? suffix.slice(1) : suffix;
  return Object.values(task?.conversation?.items ?? {}).filter(
    (item) =>
      item.kind === "tool" &&
      item.status === "completed" &&
      (item.title === canonicalTitle || item.title?.endsWith(suffix)),
  ).length;
}

function finalAssistantText(task) {
  const turnId = task?.conversation?.activeTurnId;
  const messages = Object.values(task?.conversation?.items ?? {}).filter(
    (item) =>
      item.kind === "assistant_message" &&
      item.status === "completed" &&
      (!turnId || item.turnId === turnId) &&
      nonempty(item.text),
  );
  return messages.at(-1)?.text ?? "";
}

function parseMarker(text, violations) {
  const matches = [...text.matchAll(/ROVE_LIVE_RESULT\s+([^\r\n]+)/g)];
  assertion(matches.length === 1, "marker_count", violations);
  assertion(
    text.startsWith("ROVE_LIVE_RESULT "),
    "marker_position",
    violations,
  );
  if (matches.length !== 1) return null;
  try {
    return JSON.parse(matches[0][1]);
  } catch {
    violations.push("marker_invalid_json");
    return null;
  }
}

function common(marker, journey, task, ledger, violations) {
  assertion(marker?.journey === journey, "journey_mismatch", violations);
  assertion(marker?.status === "passed", "journey_not_passed", violations);
  assertion(
    ledger?.sessionId === task?.roveSessionId,
    "ledger_session_mismatch",
    violations,
  );
  const pages = exactIds(
    marker?.distinctPageIds,
    ID_PATTERNS.page,
    1,
    "page_ids",
    violations,
  );
  assertion(
    marker?.observationIds === undefined,
    "ephemeral_observation_field",
    violations,
  );
  const observations = exactIds(
    marker?.durableObservationIds,
    ID_PATTERNS.observation,
    1,
    "observation_ids",
    violations,
  );
  const screenshots = exactIds(
    marker?.screenshotEvidenceIds,
    ID_PATTERNS.evidence,
    1,
    "screenshot_ids",
    violations,
  );
  assertion(
    pages.every((id) => ledger?.pageIds?.includes(id)),
    "page_id_not_in_ledger",
    violations,
  );
  assertion(
    toolCount(task, "/browser.inspect") >= 1,
    "missing_inspect_tool",
    violations,
  );
  assertion(
    toolCount(task, "/browser.screenshot") >= screenshots.length,
    "missing_screenshot_tools",
    violations,
  );
  assertion(
    observations.every((id) => ledger?.observationIds?.includes(id)),
    "observation_id_not_in_ledger",
    violations,
  );
  assertion(
    screenshots.every((id) => ledger?.screenshotEvidenceIds?.includes(id)),
    "screenshot_id_not_in_ledger",
    violations,
  );
  return { pages, observations, screenshots };
}

function downloads(marker, task, ledger, violations) {
  const receipts = exactIds(
    marker?.receiptIds,
    ID_PATTERNS.receipt,
    1,
    "receipt_ids",
    violations,
  );
  const observations = exactIds(
    marker?.downloadObservationIds,
    ID_PATTERNS.observation,
    1,
    "download_observation_ids",
    violations,
  );
  const evidence = exactIds(
    marker?.downloadEvidenceIds,
    ID_PATTERNS.evidence,
    1,
    "download_evidence_ids",
    violations,
  );
  assertion(
    observations.length === 1,
    "download_observation_not_exactly_one",
    violations,
  );
  assertion(
    evidence.length === 1,
    "download_evidence_not_exactly_one",
    violations,
  );
  assertion(
    receipts.every((id) =>
      ledger?.receipts?.some((receipt) => receipt.id === id),
    ),
    "receipt_id_not_in_ledger",
    violations,
  );
  assertion(
    observations.every((id) =>
      ledger?.downloads?.some((item) => item.observationId === id),
    ),
    "download_observation_not_in_ledger",
    violations,
  );
  assertion(
    evidence.every((id) =>
      ledger?.downloadFileEvidence?.some((item) => item.evidenceId === id),
    ),
    "download_evidence_not_in_ledger",
    violations,
  );
  assertion(
    nonempty(marker?.actualFilename),
    "actual_filename_missing",
    violations,
  );
  assertion(
    Number.isInteger(marker?.size) && marker.size > 0,
    "download_size",
    violations,
  );
  assertion(nonempty(marker?.mime), "download_mime", violations);
  assertion(ledger?.downloads?.length === 1, "run_download_count", violations);
  assertion(
    ledger?.downloadFileEvidence?.length === 1,
    "run_download_file_count",
    violations,
  );
  const download = ledger?.downloads?.[0];
  const file = ledger?.downloadFileEvidence?.[0];
  const correlatedReceipts = (ledger?.receipts ?? []).filter(
    (receipt) =>
      receipts.includes(receipt.id) &&
      receipt.outcome === "applied" &&
      receipt.dispatched === true &&
      receipt.effects?.some(
        (effect) =>
          effect.kind === "download_completed" &&
          effect.state === "observed" &&
          effect.observationId === download?.observationId &&
          effect.evidenceId === download?.evidenceId,
      ),
  );
  assertion(
    correlatedReceipts.length === 1,
    "download_receipt_correlation",
    violations,
  );
  assertion(
    download?.evidenceId === file?.evidenceId,
    "download_file_correlation",
    violations,
  );
  assertion(
    marker?.actualFilename === download?.filename,
    "download_filename_mismatch",
    violations,
  );
  assertion(
    marker?.actualFilename === file?.filename,
    "file_filename_mismatch",
    violations,
  );
  assertion(
    marker?.size === download?.size && marker?.size === file?.size,
    "download_size_mismatch",
    violations,
  );
  assertion(
    marker?.mime === download?.mime && marker?.mime === file?.mime,
    "download_mime_mismatch",
    violations,
  );
  assertion(
    toolCount(task, "/browser.interact") >= 1,
    "missing_download_interact",
    violations,
  );
  assertion(
    toolCount(task, "/evidence.list") + toolCount(task, "/evidence.read") >= 1,
    "missing_evidence_tool",
    violations,
  );
}

function verifyGithub(marker, facts, task, ledger, violations) {
  assertion(
    /^https:\/\/github\.com\/[^/]+\/[^/]+\/?$/.test(marker.repositoryUrl),
    "repository_url",
    violations,
  );
  assertion(
    /^https:\/\/github\.com\/[^/]+\/[^/]+\/issues\/1\/?$/.test(marker.issueUrl),
    "issue_url",
    violations,
  );
  assertion(
    marker.repositoryPrivate === true,
    "repository_not_private",
    violations,
  );
  assertion(marker.issueNumber === 1, "issue_number", violations);
  assertion(
    marker.issueTitle === "[ROVE LIVE] Browser acceptance task",
    "issue_title",
    violations,
  );
  assertion(
    JSON.stringify(marker.checklist) === JSON.stringify([true, false, false]),
    "checklist",
    violations,
  );
  assertion(nonempty(marker.assignee), "assignee", violations);
  assertion(marker.label === "enhancement", "label", violations);
  assertion(marker.historyReturned === true, "history", violations);
  assertion(facts.pages.length >= 2, "github_distinct_tabs", violations);
  const receipts = exactIds(
    marker.receiptIds,
    ID_PATTERNS.receipt,
    5,
    "receipt_ids",
    violations,
  );
  assertion(
    receipts.every((id) =>
      ledger?.receipts?.some((receipt) => receipt.id === id),
    ),
    "github_receipt_not_in_ledger",
    violations,
  );
  assertion(
    ID_PATTERNS.observation.test(marker.finalObservationId ?? ""),
    "final_observation",
    violations,
  );
  assertion(
    ledger?.observationIds?.includes(marker.finalObservationId),
    "final_observation_not_in_ledger",
    violations,
  );
  assertion(marker.issueState === "open", "issue_close_evidence", violations);
  assertion(
    toolCount(task, "/browser.back") >= 1,
    "github_history_tool",
    violations,
  );
  assertion(
    toolCount(task, "/browser.open_page") >= 1,
    "github_second_tab_tool",
    violations,
  );
}

function verifyGmailCalendar(marker, facts, task, ledger, violations) {
  assertion(
    /^https:\/\/mail\.google\.com\//.test(marker.gmailUrl),
    "gmail_url",
    violations,
  );
  assertion(
    /^https:\/\/calendar\.google\.com\//.test(marker.calendarUrl),
    "calendar_url",
    violations,
  );
  for (const field of [
    "requestedDuration",
    "schedulingPeriod",
    "emailEventTitle",
    "note",
    "eventTime",
  ])
    assertion(nonempty(marker[field]), `missing_${field}`, violations);
  assertion(
    marker.eventTitle === "Rove live acceptance review",
    "event_title",
    violations,
  );
  assertion(marker.created === true, "event_not_created", violations);
  assertion(
    marker.createdEventTitle === "Rove acceptance review",
    "created_event_title",
    violations,
  );
  assertion(marker.titleEdited === true, "event_title_not_edited", violations);
  assertion(marker.eventCount === 1, "event_count", violations);
  assertion(
    marker.eventDescription === "Created during Rove live acceptance.",
    "event_description",
    violations,
  );
  assertion(marker.noGuests === true, "event_guests", violations);
  assertion(
    JSON.stringify(marker.externalMutations) ===
      JSON.stringify(["calendar_event_create", "calendar_event_title_edit"]),
    "calendar_mutations",
    violations,
  );
  const receipts = exactIds(
    marker.receiptIds,
    ID_PATTERNS.receipt,
    2,
    "receipt_ids",
    violations,
  );
  assertion(
    receipts.every((id) =>
      ledger?.receipts?.some((receipt) => receipt.id === id),
    ),
    "calendar_receipt_not_in_ledger",
    violations,
  );
  assertion(
    receipts.filter((id) =>
      ledger?.receipts?.some(
        (receipt) =>
          receipt.id === id &&
          receipt.outcome === "applied" &&
          receipt.dispatched === true &&
          receipt.consequential === true,
      ),
    ).length >= 2,
    "calendar_mutation_receipts",
    violations,
  );
  assertion(
    ID_PATTERNS.observation.test(marker.finalObservationId ?? "") &&
      ledger?.observationIds?.includes(marker.finalObservationId),
    "calendar_final_observation",
    violations,
  );
  assertion(
    marker.gmailReturnedOpen === true,
    "gmail_not_returned",
    violations,
  );
  assertion(
    facts.pages.length >= 2,
    "gmail_calendar_distinct_tabs",
    violations,
  );
  assertion(
    toolCount(task, "/browser.open_page") >= 1,
    "calendar_second_tab_tool",
    violations,
  );
  assertion(
    toolCount(task, "/browser.switch_page") >= 1,
    "gmail_return_tool",
    violations,
  );
}

function verifyDrive(marker, task, ledger, violations) {
  assertion(
    /^https:\/\/drive\.google\.com\/drive\/folders\/[A-Za-z0-9_-]+\/?$/.test(
      marker.folderUrl,
    ),
    "drive_folder_url",
    violations,
  );
  assertion(
    /^Rove Live Acceptance P5\.9 \d{8}-\d{4}$/.test(marker.folderName),
    "drive_folder_name",
    violations,
  );
  assertion(
    marker.breadcrumb === `My Drive > ${marker.folderName} > Archive`,
    "drive_breadcrumb",
    violations,
  );
  assertion(
    marker.sourceFileName === "rove-live-acceptance.txt",
    "drive_source_filename",
    violations,
  );
  assertion(
    marker.fileName === "rove-live-acceptance-renamed.txt",
    "drive_filename",
    violations,
  );
  assertion(marker.fileCount === 1, "drive_file_count", violations);
  assertion(marker.organized === true, "drive_not_organized", violations);
  assertion(marker.historyReturned === true, "drive_history", violations);
  assertion(
    marker.historyReturnUrl === marker.folderUrl,
    "drive_history_url",
    violations,
  );
  assertion(
    JSON.stringify(marker.externalMutations) ===
      JSON.stringify([
        "create_folder",
        "upload",
        "rename",
        "create_archive",
        "move",
        "download",
      ]),
    "drive_mutations",
    violations,
  );
  const receipts = exactIds(
    marker.receiptIds,
    ID_PATTERNS.receipt,
    6,
    "drive_receipt_ids",
    violations,
  );
  assertion(
    receipts.every((id) =>
      ledger?.receipts?.some((receipt) => receipt.id === id),
    ),
    "drive_receipt_not_in_ledger",
    violations,
  );
  assertion(
    receipts.filter((id) =>
      ledger?.receipts?.some(
        (receipt) =>
          receipt.id === id &&
          receipt.outcome === "applied" &&
          receipt.dispatched === true &&
          receipt.consequential === true,
      ),
    ).length >= 6,
    "drive_mutation_receipts",
    violations,
  );
  assertion(
    ID_PATTERNS.observation.test(marker.finalObservationId ?? "") &&
      ledger?.observationIds?.includes(marker.finalObservationId),
    "drive_final_observation",
    violations,
  );
  downloads(marker, task, ledger, violations);
  assertion(
    toolCount(task, "/browser.back") >= 1,
    "drive_history_tool",
    violations,
  );
}

function verifyMaps(marker, facts, task, ledger, violations) {
  assertion(
    marker.place === "Lekki Conservation Centre, Lagos",
    "maps_place",
    violations,
  );
  assertion(
    marker.origin === "Murtala Muhammed International Airport",
    "maps_origin",
    violations,
  );
  assertion(
    marker.destination === "Lekki Conservation Centre",
    "maps_destination",
    violations,
  );
  assertion(marker.directionsShown === true, "maps_directions", violations);
  assertion(
    ["selected", "unavailable"].includes(marker.transit),
    "maps_transit",
    violations,
  );
  if (marker.transit === "unavailable")
    assertion(
      ID_PATTERNS.observation.test(
        marker.transitUnavailableObservationId ?? "",
      ) &&
        ledger?.observationIds?.includes(
          marker.transitUnavailableObservationId,
        ),
      "maps_transit_unavailable_evidence",
      violations,
    );
  assertion(
    Array.isArray(marker.routeOptions) && marker.routeOptions.length > 0,
    "maps_routes",
    violations,
  );
  assertion(
    marker.routeOptions?.every((route) => nonempty(route?.duration)),
    "maps_route_durations",
    violations,
  );
  assertion(facts.screenshots.length >= 2, "maps_screenshot_count", violations);
  assertion(
    ID_PATTERNS.observation.test(marker.routeObservationId ?? "") &&
      ledger?.observationIds?.includes(marker.routeObservationId),
    "maps_route_observation",
    violations,
  );
  assertion(
    facts.screenshots.includes(marker.placeScreenshotEvidenceId) &&
      facts.screenshots.includes(marker.routeScreenshotEvidenceId) &&
      marker.placeScreenshotEvidenceId !== marker.routeScreenshotEvidenceId,
    "maps_screenshot_roles",
    violations,
  );
  assertion(
    toolCount(task, "/browser.interact") >= 1,
    "maps_semantic_interaction",
    violations,
  );
}

function verifyIrsPdf(marker, facts, task, ledger, violations, evidence) {
  assertion(
    marker.sourceUrl === "https://www.irs.gov/forms-pubs/about-form-w-4",
    "irs_source_url",
    violations,
  );
  assertion(
    /^https:\/\/(?:www\.)?irs\.gov\/.*\.pdf(?:[?#].*)?$/i.test(marker.pdfUrl),
    "irs_pdf_url",
    violations,
  );
  assertion(facts.pages.length >= 2, "irs_distinct_tabs", violations);
  assertion(marker.backForwardVerified === true, "irs_history", violations);
  assertion(facts.screenshots.length >= 2, "irs_screenshot_count", violations);
  assertion(marker.laterPageChanged === true, "irs_later_page", violations);
  downloads(marker, task, ledger, violations);
  assertion(
    /\.pdf$/i.test(marker.actualFilename ?? ""),
    "irs_actual_filename",
    violations,
  );
  assertion(
    /pdf/i.test(marker.mime ?? "") || /pdf/i.test(marker.mimeBasis ?? ""),
    "irs_mime_basis",
    violations,
  );
  assertion(
    nonempty(marker.pdfIdentityEvidence),
    "irs_pdf_identity",
    violations,
  );
  assertion(
    marker.mimeBasis === ledger?.downloads?.[0]?.mimeBasis &&
      marker.mimeBasis === ledger?.downloadFileEvidence?.[0]?.mimeBasis,
    "irs_mime_basis_mismatch",
    violations,
  );
  if (marker.pdfSignature !== undefined && marker.pdfSignature !== null)
    assertion(
      /^%PDF-\d(?:\.\d)?$/.test(marker.pdfSignature),
      "irs_pdf_signature",
      violations,
    );
  const persistedPdfSignature =
    ledger?.downloadFileEvidence?.[0]?.contentSignature ?? null;
  assertion(
    /^%PDF-\d(?:\.\d)?$/.test(persistedPdfSignature ?? ""),
    "irs_persisted_pdf_signature",
    violations,
  );
  evidence.persistedPdfSignature = persistedPdfSignature;
  assertion(toolCount(task, "/browser.back") >= 1, "irs_back_tool", violations);
  assertion(
    toolCount(task, "/browser.forward") >= 1,
    "irs_forward_tool",
    violations,
  );
  assertion(
    toolCount(task, "/browser.open_page") >= 1,
    "irs_second_tab_tool",
    violations,
  );
  assertion(
    toolCount(task, "/browser.scroll") >= 1,
    "irs_scroll_tool",
    violations,
  );
}

export function verifyLiveJourney({ journey, task, ledger }) {
  const violations = [];
  const independentEvidence = {};
  assertion(
    task?.conversation?.turnStatus === "completed",
    "turn_not_completed",
    violations,
  );
  const text = finalAssistantText(task);
  assertion(nonempty(text), "final_assistant_missing", violations);
  const marker = parseMarker(text, violations);
  const prose = text.replace(/ROVE_LIVE_RESULT\s+[^\r\n]+/g, "");
  assertion(!stoppedOutcome.test(prose), "final_reports_stop", violations);
  if (marker) {
    const facts = common(marker, journey, task, ledger, violations);
    if (journey === "github")
      verifyGithub(marker, facts, task, ledger, violations);
    else if (journey === "gmail_calendar")
      verifyGmailCalendar(marker, facts, task, ledger, violations);
    else if (journey === "drive") verifyDrive(marker, task, ledger, violations);
    else if (journey === "maps")
      verifyMaps(marker, facts, task, ledger, violations);
    else if (journey === "irs_pdf")
      verifyIrsPdf(
        marker,
        facts,
        task,
        ledger,
        violations,
        independentEvidence,
      );
    else violations.push("unknown_journey");
  }
  return {
    ok: violations.length === 0,
    violations,
    marker,
    independentEvidence,
  };
}
