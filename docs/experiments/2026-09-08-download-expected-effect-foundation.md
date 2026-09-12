# Download expected-effect foundation

Date: 2026-09-08

## Question

Can one grounded action prove a managed download without treating page text,
an old file, or an unpersisted browser event as completion evidence?

## Internal trace

Before this correction, Playwright's `page.on("download")` handler saved the
file and emitted `download_completed`. Runtime then independently converted
that activity into file evidence and a durable observation. The verified
interaction path, however, knew only predecessor/successor page observations;
the public expected-effect union had no download member and there was no action
identity on browser activity. The capability atlas marked `io.download` as
pipeline-complete because governance checked inventory shape and mirrored only
the already-existing protocol union. It did not mechanically connect the
row's “origin action” acceptance sentence to a public effect or persistence
truth source.

The corrected path is:

1. Runtime parses one canonical `download_completed` effect, with an optional
   exact filename known before dispatch. More than one such effect, or its use
   with an interaction other than a grounded click, is rejected.
2. Runtime completes observation, replay-fence, authorization, upload, and
   ownership checks before registering a fresh `dlb_…` waiter immediately
   before the one browser dispatch. Any pre-dispatch rejection leaves no
   waiter or BrowserSession correlation window.
3. BrowserSession resolves the target before arming a bounded, single-use
   correlation window. For an anchor, the window combines the resolved URL,
   the boundary ID, and capture-phase evidence of exactly one trusted matching
   activation. The first download event consumes the window. A mismatched URL,
   zero/multiple matching activations, or an overlapping programmatic download
   is ambiguous and cannot satisfy the effect.
4. Managed file saving completes; Runtime writes the file evidence and then
   the `download_completed` observation.
5. Only after both writes succeed does Runtime resolve the waiter and attach
   the `obs_…` and `ev_…` IDs to the receipt effect.

An action-correlated `download_failed` observation contradicts the effect.
Filename mismatch also contradicts it while retaining the real evidence IDs.
Timeout, unavailable/ambiguous correlation, or persistence failure remain
unresolved and therefore produce outcome `unknown`; consequential requests
retain the normal replay fence. Arbitrary no-`href` buttons are explicitly
unresolved even when their artifact is preserved. No branch redispatches the
action.

## Correlation boundary research

Playwright's supported pattern is to begin waiting for the page `download`
event before the initiating click. Its `Download` object exposes the owning
page, download URL, suggested filename, path, and failure, but no initiating
DOM target or application action token. Chromium's CDP
`Browser.downloadWillBegin` / `Page.downloadWillBegin` similarly exposes a
GUID, frame ID, URL, and suggested filename; `Network.requestWillBeSent`
exposes an initiator but documents no stable join from that request to the
download GUID. Sources:
[Playwright downloads](https://playwright.dev/docs/downloads),
[Playwright Download API](https://playwright.dev/docs/next/api/class-download),
[CDP Browser domain](https://chromedevtools.github.io/devtools-protocol/tot/Browser/),
[CDP Page domain](https://chromedevtools.github.io/devtools-protocol/tot/Page/),
and [CDP Network domain](https://chromedevtools.github.io/devtools-protocol/tot/Network/).

Consequently Rove does not infer arbitrary button causality from timing,
filename, or page identity. Such cases return
`DOWNLOAD_CORRELATION_UNAVAILABLE`. The one bounded exception is Chromium's
built-in PDF viewer, qualified below from its exact target and document
identity.

## Local fixture experiment

The local fixture exposes immediate and delayed response bodies with distinct
server-provided filenames. Real Chromium tests exercise both through
`RuntimeService.interact` and assert exactly one file artifact, one observed
effect, and the same durable observation/evidence identifiers in the receipt.
A mismatch case proves the artifact can be honestly persisted while the
requested filename is contradicted. A timeout case first creates unrelated old
download evidence, then dispatches a click whose href is prevented under a new
boundary: the old artifact does not satisfy the waiter, the result is
unresolved, and a second consequential call with the same key is blocked before
dispatch. An adversarial overlap schedules a prior programmatic download of the
same URL during the next action's window; its untrusted second activation makes
the completion ambiguous rather than applied. Separate fixtures cover
action-correlated failure, generic no-href unresolved behavior, a
post-registration BrowserSession target-resolution rejection that proves
pre-dispatch waiter/window cleanup, single dispatch/artifact, ownership-generation
invalidation, protocol/MCP rejection, and BrowserSession correlation strategy.

## Real Chromium PDF viewer experiment

A headed Chromium session loaded the fixture's inline
`application/pdf` document through the production `PlaywrightBrowserSession`.
Inspection found the real Download target as a visible enabled `button` named
`Download`, inside Chromium's built-in
`chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html` frame at
shadow-root depth 3. The main document reported `application/pdf`. Clicking
that exact grounded target produced a managed download whose URL equaled the
current PDF URL and whose suggested/persisted filename was
`rove-fixture.pdf`.

The resulting production activity carried the action boundary,
`correlation: matched`, and
`correlationStrategy: chromium_pdf_viewer`; Runtime returned `applied` only
after persisting the PDF file evidence and observation. The implemented rule
requires all of the qualified identity signals (exact Download name, exact
built-in viewer frame, PDF main-document MIME, and completion URL equal to the
pre-dispatch PDF URL). It does not generalize to other no-href buttons.

These are local deterministic fixtures only. They do not rerun or claim the
external IRS/PDF acceptance gate.
