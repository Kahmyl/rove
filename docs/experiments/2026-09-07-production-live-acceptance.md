# Production live acceptance: authority, workspaces, and unified surface

Date: 2026-09-07

Status: production gates exercised; core A–C architecture and all five live
journeys accepted

This run validated the production integration that followed the structural
experiments in `2026-09-07-boundary-workspace-surface.md`. All browser work was
performed through Rove's MCP surface and a Rove-owned Chrome workspace. No
coordinate interaction, direct site API, or ordinary Chrome profile was used.

## Architecture gates

### A — contextual action authority

The live run confirmed that grounded actions can proceed through page states
whose broad semantic classification is uncertain. Google Calendar event details
and the Google Drive rename dialog were both classified as unfamiliar
interstitials, but consequence-aware per-action authorization allowed the
freshly grounded, task-authorized edits. Controller, revision, target,
credential, budget, and outcome-reconciliation checks remained active.

The Runtime also reconciles delayed consequential navigation without replaying
the action. It re-inspects the browser on bounded delays and adopts a successor
observation when the expected navigation becomes visible.

### B — durable browser workspace

Workspace `wrk_6592ba60-fe03-4982-90c7-c8e7d179f1fb` retained both GitHub and
Google authentication across multiple clean Desktop and Runtime restarts. New
logical Rove sessions reused the selected workspace rather than creating a new
browser identity. This closes the live Google reuse gate from the experiment.

### C — unified companion surface

The compact, expanded, and full presentations now derive from one canonical
session model and presentation state machine. Native hosts remain platform
adapters; the coordinator presents exactly one active host. Automated state,
preload, IPC, host-transition, renderer, restart, and packaged Desktop checks
cover the production wiring. Native multi-monitor and operating-system Space
behavior remain release-candidate manual checks rather than protocol concerns.

## Live journeys

| Journey                                            | Result                       | Evidence                                                                                                                                                                                                                                                                                            |
| -------------------------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GitHub repository and issue lifecycle              | Pass                         | final observation `bobs_18a433d9d71c4b00be45eeeb00aa931c`; screenshot `ev_3c6cee8f68954838bdd09f370b0c4600`                                                                                                                                                                                         |
| Gmail to Google Calendar                           | Pass                         | final observation `bobs_1160d3a37db249b8aa30da1b368a398c`; screenshot `ev_ca614289710f49e0b17b53c8a3168c43`                                                                                                                                                                                         |
| Drive upload, rename, organize, download           | Pass after generic follow-on | upload `rcpt_e6bdb8ae5164468f9677637466ff0f5e`; rename `rcpt_6176189a0196497c96939af3f4b0da32`; move `rcpt_69742d2abc0743689815bad244676734`; destination `bobs_625043eaf46f46818e68a2ce77882060`; download `ev_6af5afb25cb849109421120f07d9f562`; screenshot `ev_54414525f5a147c0a8063e3faeb0f1fe` |
| Google Maps visual route                           | Pass                         | route observation `bobs_9d0e4419d3e34d709807170af9771ca0`; screenshot `ev_eeeecb22471a428f892e484f2f4f7530`                                                                                                                                                                                         |
| Research, PDF, tabs, history, download, and scroll | Pass                         | final scroll screenshots `ev_a4738c083d4b4fb4ac1dc3931ff50d01` and `ev_87f5022db1d64626b1525c8b68158ff5`; download `ev_883690173c77476b9cb0bb26b5b65362`                                                                                                                                            |

### GitHub

- Repository: <https://github.com/Kamil-Flint/rove-live-acceptance-11>
- Issue: <https://github.com/Kamil-Flint/rove-live-acceptance-11/issues/1>
- The repository is private.
- The issue has the exact requested title, assignee `Kamil-Flint`, and label
  `enhancement`.
- Its final checklist has only the first of three items checked.
- The final issue was reached by navigating to the repository main page and
  then using browser history.

### Gmail to Calendar

Rove found the planning email, verified that the intended event already
existed, avoided creating a duplicate, and renamed it to
`Rove live acceptance review`. The final event remained a 30-minute event at
3:00 PM with the requested description and no guests.

### Drive

Rove created the `Rove Live Acceptance` folder and its `Archive` child. A
production file-chooser bridge enabled grounded uploads through either direct
file inputs or visible controls that emit the browser file chooser. The live
upload and rename succeeded.

The first required move attempt did not apply. No site-specific exception was
added. A generic semantic-transaction investigation added staged drag,
multi-phase consequence fencing, and explicit visible-scope versus
remote-destination verification. The resumed live journey then moved the exact
renamed file into `Archive`, independently verified the exact destination URL,
breadcrumb, and file row, and downloaded it once into managed evidence. The
full diagnosis and follow-on evidence are recorded in
`2026-09-07-semantic-move-and-drag.md`.

### Maps and PDF

The Maps route from Murtala Muhammed International Airport to Lekki
Conservation Centre was perceived and captured with alternatives and traffic
context. The research journey opened BrowserAgent on arXiv, exercised tab and
history navigation, downloaded the PDF, and scrolled the embedded PDF from page
1 to page 2.

The PDF result required a generic embedded-document scroll improvement. Rove
now finds the dominant visible scroll surface across frames and open shadow
roots, while retaining targeted precise scrolling for smaller surfaces and a
semantic keyboard fallback.

## Final automated gates

- `pnpm typecheck`: pass across all typed workspace projects.
- `pnpm lint`: pass.
- `pnpm build`: pass, including the production Companion renderer.
- `pnpm test`: the final privileged run passed 125 test files and all 769
  tests.
- `pnpm test:e2e`: both stdio and authenticated Streamable HTTP task journeys
  passed after a clean build.
- `pnpm browser:compat`: pass for the platform capabilities and all three Rove
  Runtime probes. Expected harness limitations remain reported for destructive
  crash/disconnect probes, live WebSocket behavior, and native browser locking;
  Rove's own workspace lock is covered separately.
- `pnpm browser:doctor`: pass. Chromium sandbox introspection remains `unknown`
  on this macOS runtime because `chrome://sandbox` cannot be inspected through
  Playwright.
- freshly prepared packaged Desktop smoke: pass on darwin/arm64.

## Final pre-Phase 5 requalification

The complete matrix was repeated after the semantic-transfer and transport
changes. This is the Phase 5 entry evidence; earlier journey evidence above
remains useful history rather than a substitute for this final stack.

- GitHub repository/issue lifecycle passed again with final observation
  `bobs_ac90c5e3c9c34bc6b7bd82d638764bac` and screenshot
  `ev_50f87f95617e427691c9bbace25bbdbe`.
- Gmail-to-Calendar passed again with final observation
  `bobs_2c38a77220ea47e28a1481bd1624569f` and screenshot
  `ev_026da64d3bd646a1bfea552186629ada`.
- Drive reconciliation first proved the earlier move had applied and did not
  replay it. A clean unique file/folder run then passed with transaction
  `tx_ef622ccc32b94e0ca1562633b833427c`, applied commit receipt
  `rcpt_7a67888f22384f779402bc38ab903b4e`, and verification observation
  `bobs_0d3d6b251bfc4040bdb7851d0547c33e`. That observation deliberately had
  `targetsTruncated: true`, proving that Runtime verification uses retained
  canonical target authority rather than the presentation slice. The exact
  destination was
  <https://drive.google.com/drive/folders/12jhgOPxB6GuMWsCVaBY8z6rKaF68ns6q>;
  download evidence was `ev_796290845c6445228e7b30daaecff981`
  and the final screenshot was `ev_ff2cc420df39404a9c6a9e4bb1b6fd57`.
- Maps passed with King’s Cross as origin, The British Museum as destination,
  transit selected in `bobs_322f2996e2d04a34b8aecafae5441e2a`, a visible
  18-minute route, semantic mode-control receipt
  `rcpt_05645aff5cc4424491f3bd3db374239d`, and screenshot
  `ev_e3042040dc4e46ec804e49b1f2d3fdd8`.
- The final PDF gate used the official IRS Form W-4 source and a separate
  embedded-viewer tab. Semantic scrolling changed the visible page from 1 to 3. The one-shot download receipt
  `rcpt_9c72bf1134af48e69836d6e2e3d26b1f` was applied and produced managed
  evidence `ev_cc8e1903681240f8aebfbecd00726d66`: `fw4.pdf`, 208,845 bytes,
  `mimeType: application/pdf`, `mimeTypeBasis: content_signature`, detected
  extension `pdf`. Final screenshot
  `ev_575304f3287943e7a1b5505dfaa5b38b` shows page 3 of 5 after the verified
  source-to-PDF tab round trip.

The initial PDF attempt stopped on a non-retryable generic inspection error.
A separate read-only diagnostic session (`ses_de0752a9f12345d2ba21db6c21eb4476`)
repeated every inspection section and the combined all-sections request twice;
all passed, including all 94 targets. No perception patch was justified. An
arXiv PDF route then failed externally with `net::ERR_HTTP2_PING_FAILED`; the
equivalent official IRS journey isolated the product behavior from that remote
transport failure. Its first successful download revealed a narrow evidence
contract omission: managed downloads lacked MIME metadata. Runtime now records
content-signature detection first, filename-extension inference second, and an
explicit binary fallback basis. The final clean IRS run above proves that fix.

Result: all five Phase 1–4 live journeys pass on the final pre-Phase 5 stack.

## Residual diagnostic gaps

- Some exact input fills can produce an `unknown` receipt when the successor
  observation intentionally omits text-input values, even though the browser
  adapter verifies exact retained text before returning.
- Observation-bound screenshots can become stale on continuously animated map
  or calendar surfaces; an unbound screenshot remains available and was used
  only after the current visible state was independently verified.
- Remote destination moves require an explicit destination observation plus
  independent URL or breadcrumb context; a page-wide source absence or guessed
  container role is intentionally insufficient.

These are bounded follow-up items. They do not justify returning to a growing
site/page-state classifier or weakening controller, freshness, consequence, or
human-verification invariants.
