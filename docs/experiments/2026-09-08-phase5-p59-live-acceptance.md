# Phase 5 P5.9 native-product live acceptance execution

Date: 2026-09-08

Status: **partially executed; required authenticated native journeys are
blocked by the qualification environment. P5.9 is not accepted by this
report.**

## Outcome

The current darwin/arm64 product was rebuilt, staged, smoke-tested, launched as
the packaged native Rove application, and inspected through its actual
renderer/main-process/Runtime/App Server composition. The native product's
product-managed Codex home was logged out and no disposable qualification
account was available. The surface therefore disabled every task launch,
including Capture, with the visible explanation `Sign in to Codex before
starting.`

No attempt was made to copy credentials from the user's primary account, to
automate a primary-account login, or to reinterpret a separate signed-in App
Server probe as a signed-in native product. The primary GitHub mutation,
durable handoff/recovery journey, Phase 1–4 external journeys, and live account
and approval mutations were not started. No consequential external result is
uncertain.

## Product and build identity

| Property                      | Observed value                                                                      |
| ----------------------------- | ----------------------------------------------------------------------------------- |
| Native application            | Rove `0.1.0`, packaged darwin/arm64                                                 |
| Packaged application artifact | `release/artifacts/mac-arm64/Rove.app`                                              |
| `app.asar`                    | 23,430,520 bytes; staged 2026-09-08T06:30:07Z                                       |
| Bundled Codex                 | `codex-cli 0.153.4`                                                                 |
| Bundled Codex SHA-256         | `a30ec314bbd0e3721632234d07db7c99855db3b9f1e32dbe8c791947f07e7629`                  |
| Compatibility tuple           | macOS arm64, version `0.153.4`, manifest digest matched                             |
| Native account state          | Logged out                                                                          |
| Selected model / effort       | `gpt-6-astra` / `low`                                                               |
| Named workspace               | `P5.9 Qualification 20260908` / `wrk_1e34bdfc-f3cf-489c-851e-ab209fb19720`          |
| Reserved GitHub repository    | `rove-phase5-live-20260908t052750z`; generated at 2026-09-08T05:27:50Z; not created |
| Native task/session/thread    | None; launch was disabled before identity creation                                  |

The packaged smoke initially received sandbox `listen EPERM` on `127.0.0.1`.
The same command passed after granting only the required local process and
loopback permission. Packaging initially encountered sandbox DNS failures
while staging dependencies; it was stopped before completion and then passed
with the required package-network permission.

## Native-surface staging method

Native accessibility control was unavailable in this execution environment.
The acceptance fixture
`experiments/phase5-app-server/p59-native-surface.mjs` used Playwright's direct
Electron process pipe to operate only the packaged Rove application window by
accessible labels and roles. It opened no externally reachable or loopback
debugging port and did not attach to, inspect, or operate the managed task
browser. A normal second application launch was used to reveal the full window
because packaged Rove starts as a tray application.

The first fixture attempt waited 30 seconds for a window without performing
that tray reveal and returned exactly:

```text
electronApplication.firstWindow: Timeout 30000ms exceeded while waiting for event "window"
```

Read-only output showed the managed Runtime and trusted App Server core were
ready. After adding the normal second-instance reveal to the qualification
fixture, the window appeared. This is classified as a fixture staging error,
not a product failure or an external action failure.

## Gate results

| Gate                                  | Result                                          | Evidence                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A — clean native start                | Partial pass                                    | Current package and pinned Codex verified; native Runtime and App Server core reached ready; full Rove surface showed truthful logged-out account, seven visible model choices, six efforts for Astra, all three modes, explicit browser identity, and unavailable rate limits/token usage.                                                                                                          |
| B — uncoached Agent journey           | Blocked: qualification account                  | Start remained disabled before a task ID, session ID, or thread ID existed. Reserved repository was not created and no GitHub mutation was attempted.                                                                                                                                                                                                                                                |
| C — durable human return and recovery | Blocked: no native task                         | No live handoff could exist without a task. The accepted deterministic continuation and live App Server lifecycle baselines were rerun separately, but are not substituted for this native gate.                                                                                                                                                                                                     |
| D — mode and browser identity         | Partial pass / blocked                          | Agent, Companion, and Capture choices were visible. Capture explicitly said `No agent turn starts` but its Start button remained disabled while logged out. A fresh named workspace was created and exact selection persisted across clean packaged-app/Runtime/App Server restart. Temporary selection remained explicit and distinct, but no Temporary session/profile was launched or cleaned up. |
| E — Phase 1–4 non-regression          | Blocked: no authenticated native workspace/task | GitHub, Gmail/Calendar, Drive, Maps, and PDF/download journeys were not started. Older evidence was not counted as current acceptance.                                                                                                                                                                                                                                                               |
| F — account and approvals             | Blocked: no disposable account                  | Browser login, device-code completion, token refresh, logout, and real approval variants were not exercised. The user's primary account was not disturbed.                                                                                                                                                                                                                                           |
| G — automated/distribution baseline   | Pass                                            | Exact results are recorded below.                                                                                                                                                                                                                                                                                                                                                                    |

## Exact native inputs

The only desired outcome actually entered into Rove was:

```text
Open a blank browser session for manual research.
```

It was entered with Capture and the named qualification workspace. It contains
only ordinary user intent. It was not submitted because `Start Capture` was
disabled.

The primary Agent outcome was not entered because the prerequisite account
state was absent. The reserved name was recorded before any possible creation.
The planned prompt would have been ordinary outcome text only; it would not
have named Rove, MCP, a connector, plugin, browser tool, or implementation
instructions.

## Visible native state and screenshots

All screenshots are 2360 by 1538 pixels and contain no account identifier,
credential, cookie, token, local profile path, or private Runtime field.

| Artifact                                             | SHA-256                                                            | What it proves                                                                                                                     |
| ---------------------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `gate-a-logged-out-native-start.png`                 | `12c982b5f1534f3e8283dbcde0b423ee133a2e77e4fe4d43c27181ab60684fea` | Ready native surface; truthful logged-out account and unavailable usage; model/effort/mode selectors; no implicit browser identity |
| `gate-d-capture-blocked-without-codex-account.png`   | `1a4c8220bb7201085710f9eb6b889ae291b597dbd0392db63db83701046c9787` | Capture wording promises no agent turn, selected named workspace, and disabled launch with explicit account prerequisite           |
| `gate-d-named-workspace-selection-after-restart.png` | `27cdddd4f4744dbc6eb8448ea849b4dd4398a2485356d3464055e87b9f4aade0` | Exact named-workspace selection restored after clean restart                                                                       |
| `gate-d-temporary-explicit-selection.png`            | `020f67141404decda25b2ceda5303483d0b28cb8882cc5fac68073eaf660d22e` | Explicit Temporary selection remained distinct and was described as signed out                                                     |

The machine-readable artifact index is
`docs/experiments/artifacts/p5.9-live-acceptance/manifest.json`.

## Browser-path statement

No P5.9 native browser operation occurred because the product rejected launch
before creating a task or browser session. Consequently this report does not
claim that the primary journey used the production Rove path. The only browser
operations in the final automated baseline were the existing production
Runtime/MCP test and E2E paths. No ordinary Computer Use, coordinate action,
second browser controller, developer-console browser scripting, or direct site
API was used as a substitute.

## Final automated and distribution baseline

| Check                              | Exact result                                                                                                                                                                                                                                                       |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P5.0 schema/digest comparison      | Pass; Codex `0.153.4`, executable digest, 1,243 generated files / 4,623,543 bytes, aggregate schema digest `50cb262ffff7c4480e17f13a5667aeb5e3a411b2793a63327d03cc2d6cb6e5a5`, validator digest `625e426cc3fcd6e11b3f2e0aaa95ae03682738daba86e5e634ad59a2e0ea27d0` |
| P5.0 deterministic oracle          | 75/75 passed                                                                                                                                                                                                                                                       |
| Focused Phase 5 set                | 14 files, 94/94 passed                                                                                                                                                                                                                                             |
| Ordinary parallel repository suite | 139 files, 865/865 passed in 71.17 seconds                                                                                                                                                                                                                         |
| Authoritative single-worker suite  | 139 files, 865/865 passed in 211.05 seconds                                                                                                                                                                                                                        |
| External MCP E2E                   | 2/2 passed: real stdio and authenticated Streamable HTTP                                                                                                                                                                                                           |
| Typecheck                          | Passed across all typed workspaces                                                                                                                                                                                                                                 |
| Lint                               | Passed                                                                                                                                                                                                                                                             |
| Build                              | Passed during native package staging and again as the E2E prerequisite                                                                                                                                                                                             |
| Desktop staging                    | Passed; darwin/arm64 unpacked app rebuilt                                                                                                                                                                                                                          |
| Packaged native smoke              | Passed for managed Runtime, authenticated MCP, pinned Codex, and Desktop lifetime                                                                                                                                                                                  |
| Live read-only App Server          | Passed; separate existing ChatGPT account, nine models, rate limits and usage available, required Rove catalog present                                                                                                                                             |
| Live required-MCP boundary         | Passed; exact `rove` identity, 29-tool catalog, task-bound call, mismatch rejection, text/image content, unavailable-server failure                                                                                                                                |
| Live lifecycle/restart             | Passed; stream, steer, interrupt, read/list/resume, process restart without blind replay, archive cleanup                                                                                                                                                          |

The signed-in read-only and lifecycle probes used their existing isolated
experimental App Server context. They demonstrate current protocol behavior
but do not authenticate the packaged native product and do not unblock Gates
B–F.

## Reproduction commands

```sh
pnpm package:desktop:dir
release/artifacts/mac-arm64/Rove.app/Contents/Resources/services/codex/codex --version
shasum -a 256 release/artifacts/mac-arm64/Rove.app/Contents/Resources/services/codex/codex
pnpm test:desktop:package
node experiments/phase5-app-server/p59-native-surface.mjs
pnpm phase5:p50:schema
pnpm phase5:p50:fixtures
pnpm phase5:p50:live
node experiments/phase5-app-server/live-app-server.mjs --mcp-boundary
node experiments/phase5-app-server/live-app-server.mjs --lifecycle
pnpm vitest run apps/companion/src/main/codex apps/companion/src/main/runtime-client.test.ts apps/companion/src/preload/api.test.ts apps/companion/src/renderer/product-surface-state.test.ts apps/companion/src/renderer/product-surface.test.tsx
pnpm vitest run --reporter=dot
pnpm vitest run --maxWorkers=1 --no-file-parallelism --reporter=dot
pnpm test:e2e
pnpm typecheck
pnpm lint
pnpm build
pnpm exec prettier --check experiments/phase5-app-server/p59-native-surface.mjs docs/experiments/2026-09-08-phase5-p59-live-acceptance.md docs/experiments/artifacts/p5.9-live-acceptance/manifest.json
git diff --check
```

## Master disposition required

The remaining gate requires an already-authorized disposable Codex
qualification account in the packaged product home and an authenticated
disposable named browser workspace. After those prerequisites exist, the
Master should reproduce Gates B–F from the native surface using fresh artifact
names. This run provides no basis to accept the unexecuted GitHub mutation,
handoff/return/restart, mode launch, Temporary cleanup, Phase 1–4 journeys, or
account/approval sub-gates.

No production code was changed. No repository commit, reset, clean, checkout,
merge, rebase, push, or pull request was performed. No P5.9 or Phase 5
acceptance is claimed.

Ready for independent Master review; not self-accepted.

## Login-surface correction — 2026-09-08

This correction is limited to the native Codex account login surface. It does
not reopen or self-accept the remaining P5.9 gates.

### Live diagnosis and correction

The independent Master observed the following in the packaged product:

- The first `Sign in in browser` activation started `account.login` and showed
  a continuation control, but did not immediately invoke the trusted external
  opener. The successful path therefore misleadingly required a second click.
- Using that continuation control did open the sign-in page. After completion
  and restart, the native product retained the authenticated account and showed
  plan and usage projections. This establishes that host login completion and
  persistence were working.
- A successful pending-login cancellation did not clear the renderer's fallback
  projection, leaving stale Continue/Cancel controls visible.

The renderer now retains the projection returned by `account.login` and invokes
the existing identity-only `openTrustedExternal({ purpose: "account_login",
loginId })` operation exactly once immediately for both browser and device-code
login. A failed open leaves the returned projection visible, shows the error in
the existing actionable alert, and retains Continue/Open verification as a
manual retry. Retry is user-triggered only; there is no loop. Successful cancel
clears only the matching renderer-local projection before refreshing host
state. All login operations disable their controls while in flight, preventing
duplicate activation.

### Deterministic renderer interaction evidence

`experiments/phase5-app-server/product-surface-visual.mjs` runs the built
production renderer in Chromium with a deterministic preload boundary. It now
asserts this exact call order and count:

1. `account.login` with `chatgpt`
2. one automatic trusted open for `login_browser`, deliberately failed
3. one user-triggered retry for `login_browser`
4. one `account.login.cancel` for `login_browser`
5. `account.login` with `deviceCode`
6. one automatic trusted open for `login_device`

The same interaction asserts that the failed open is visibly actionable, the
browser retry remains available, successful cancellation restores the initial
login choices, the projected device code `ABCD-EFGH` is visible, and the device
verification retry remains available. The generated
`full-onboarding.png`/manifest record these assertions. This is deterministic
renderer evidence, not a claim that a second live login was initiated.

### Safe signed-in packaged smoke

After rebuilding and staging the darwin/arm64 application, the native semantic
harness launched the packaged app, performed only a read-only surface snapshot
and screenshot, and closed it. The existing account remained signed in with
`plus` / `chatgpt`; Usage window and Token activity were visible. No sign-out,
new login, task launch, external navigation, or account mutation was performed.
The final process audit also found and terminated two exact stale harness-only
Node processes (`97885` and `98305`) left by the earlier P5.9 execution; neither
had a packaged Rove child. The harness now explicitly closes its stdin
interface after the `close` operation, and the final audit found no matching
qualification process.

| Artifact                                       | SHA-256                                                            | Evidence                                                                              |
| ---------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `login-correction-signed-in-after-package.png` | `7393b9fbc17749a4a91b164009ed6aef21823bf77dea511f765a5a336f8413ba` | Rebuilt packaged app preserved signed-in plan/usage state without an account mutation |

Rebuilt `app.asar`: 23,433,570 bytes, staged
2026-09-08T07:29:44Z, SHA-256
`e9c5047033110ff1ba2cba8f977b99c008d95aafb71a0f766536fd9b93f6a2dd`.
The bundled Codex remained `0.153.4` with SHA-256
`a30ec314bbd0e3721632234d07db7c99855db3b9f1e32dbe8c791947f07e7629`.

### Correction verification

| Check                                  | Result                                   |
| -------------------------------------- | ---------------------------------------- |
| Companion TypeScript check             | Passed                                   |
| Focused Phase 5 suite                  | 14 files, 94/94 passed                   |
| Built-renderer login interaction       | Passed exact six-operation sequence      |
| Authoritative single-worker full suite | 139 files, 865/865 passed in 216.36 s    |
| Phase 5 deterministic oracle           | 75/75 passed                             |
| Repository typecheck                   | Passed                                   |
| Repository lint                        | Passed                                   |
| Repository build                       | Passed during package staging            |
| Desktop darwin/arm64 staging           | Passed                                   |
| Packaged native smoke                  | Passed                                   |
| Signed-in native semantic smoke        | Passed read-only; account left signed in |
| Prettier / `git diff --check`          | Passed                                   |

Commands added or rerun for the correction:

```sh
pnpm --filter @rove/companion typecheck
pnpm vitest run apps/companion/src/main/codex apps/companion/src/main/runtime-client.test.ts apps/companion/src/preload/api.test.ts apps/companion/src/renderer/product-surface-state.test.ts apps/companion/src/renderer/product-surface.test.tsx
pnpm --filter @rove/companion build
node experiments/phase5-app-server/product-surface-visual.mjs
pnpm vitest run --maxWorkers=1 --no-file-parallelism --reporter=dot
pnpm phase5:p50:fixtures
pnpm typecheck
pnpm lint
pnpm package:desktop:dir
pnpm test:desktop:package
node experiments/phase5-app-server/p59-native-surface.mjs
pnpm exec prettier --check apps/companion/src/renderer/product-surface.tsx experiments/phase5-app-server/product-surface-visual.mjs docs/experiments/2026-09-08-phase5-p59-live-acceptance.md docs/experiments/artifacts/p5.9-live-acceptance/manifest.json
git diff --check
```

### Finding disposition and uncertainty

| Finding                                            | Disposition                                                        |
| -------------------------------------------------- | ------------------------------------------------------------------ |
| Initial browser login does not open externally     | Corrected; deterministic exact-count assertion passes              |
| Initial device-code login does not open externally | Corrected; projection/code/retry and exact-count assertion pass    |
| Cancel leaves stale renderer-local login           | Corrected; deterministic visible-state assertion passes            |
| External-open failure is silent or loops           | Corrected; actionable alert, retained retry, no automatic retry    |
| Authenticated state does not persist               | Not reproduced; live rebuilt package retained signed-in plan/usage |

Remaining uncertainty is deliberately narrow: the corrected initial external
open was not re-run against the live authenticated account, because doing so
would require disturbing or replacing that account state. Its ordering,
arguments, failure behavior, retry behavior, and counts are covered by the
deterministic production-renderer harness; signed-in persistence after rebuild
is separately observed live. No broader P5.9 acceptance is claimed. Ready for
independent Master review.

## Independent Master review of the initial partial execution — 2026-09-08

Decision: **the submitted evidence is accepted as an accurate partial P5.9
execution, but P5.9 and Phase 5 remain open.** The authenticated native-product
journeys are still required.

The Master independently inspected all four screenshots, checked their SHA-256
values against the manifest, reviewed the Electron-pipe harness and renderer
launch gate, checked script syntax and formatting, and confirmed the report's
completed/blocked split. The screenshots visibly support the reported
logged-out account, model/effort choices, unavailable usage, three execution
modes, named-workspace restart persistence, explicit Temporary selection, and
disabled launch state.

The Capture launch state is consistent with the current Phase 5 architecture:
Capture starts no Codex turn, but still creates a Rove task and associated Codex
thread, so the product requires a signed-in Codex account before task creation.
This is not treated as a new product defect in this review.

A Master process audit found two `p59-native-surface.mjs` Node processes still
waiting on stdin after their Electron children had closed, despite the handoff
stating all qualification processes were stopped. The Master terminated only
those exact harness PIDs and confirmed they exited. No packaged Rove child or
external task browser was left running. This cleanup discrepancy does not
change the live-gate result, but the handoff statement is corrected here.

Required next condition: sign a qualification account into the packaged Rove
product and authenticate the named browser workspace for the permitted external
services. The same execution task can then resume Gates B–F with fresh artifact
names and return the completed evidence for another independent Master review.

## Hosted login success-page correction — 2026-09-08

Status: **implemented and verified for independent Master review; no broader
P5.9 acceptance is claimed.**

### Observed diagnosis

After successful browser authorization, the Master observed that Chrome showed
a stale local success destination which refused the connection. The corrected
packaged Rove application was nevertheless signed in as `plus` / `chatgpt` with
usage visible. The evidence therefore isolates the issue to completion-page
presentation and lifecycle rather than authentication completion or account
persistence. This report intentionally neither records nor reproduces the
callback URL or any of its query contents.

The pinned Codex App Server 0.153.4 generated schema permits
`useHostedLoginSuccessPage` and `appBrand` only on the `chatgpt` login branch.
The documented contract states that hosted success-page mode avoids the default
local success redirect when organization setup is not required. Rove now sends
this exact browser-login request:

```json
{
  "type": "chatgpt",
  "useHostedLoginSuccessPage": true,
  "appBrand": "chatgpt"
}
```

Device-code login remains exactly:

```json
{ "type": "chatgptDeviceCode" }
```

The reviewed TypeScript request map now represents the generated discriminated
union, while the checked-in generated schema and runtime validator remain
unchanged. The earlier accepted renderer automatic-open, retry, failure, and
cancel behavior was not refactored.

### Deterministic and live evidence split

- A deterministic service-boundary test captures both outbound requests and
  requires exact deep equality with the shapes above. It separately proves that
  device-code parameters have neither browser-only property.
- A generated-runtime-validator test accepts the hosted browser request and
  rejects the same browser-only fields on `chatgptDeviceCode`, preserving strict
  `additionalProperties: false` enforcement.
- The application was rebuilt and staged as darwin/arm64. The isolated packaged
  smoke passed after resolving the process collision described below.
- The native semantic harness then performed one read-only packaged-app snapshot
  and clean close. The existing account remained `plus` / `chatgpt`, and Usage
  window and Token activity remained visible. No login, logout, task launch,
  external navigation, screenshot replacement, or account mutation occurred.

Rebuilt `app.asar`: 23,437,167 bytes, staged
2026-09-08T07:51:56Z, SHA-256
`3fc8756b10c131647d0fb7ccd3d5d16b1c5be770483b63ce497cadb6c80a7ec6`.
The bundled Codex remained `0.153.4` with SHA-256
`a30ec314bbd0e3721632234d07db7c99855db3b9f1e32dbe8c791947f07e7629`.

### Verification results

| Check                                   | Exact result                             |
| --------------------------------------- | ---------------------------------------- |
| New exact-shape/validator tests         | 3 files, 35/35 passed                    |
| Focused Phase 5 suite                   | 14 files, 96/96 passed                   |
| Companion TypeScript check              | Passed                                   |
| Repository build / darwin-arm64 staging | Passed                                   |
| Isolated packaged Desktop smoke         | Passed after exact singleton cleanup     |
| Signed-in native semantic smoke         | Passed read-only; account left signed in |
| Native harness close                    | Exit 0 immediately after `close`         |

Commands:

```sh
pnpm --filter @rove/companion typecheck
pnpm vitest run apps/companion/src/main/codex/protocol-generated-runtime.test.ts apps/companion/src/main/codex/phase5-execution.test.ts apps/companion/src/main/codex/account-catalog-bounds.test.ts
pnpm vitest run apps/companion/src/main/codex apps/companion/src/main/runtime-client.test.ts apps/companion/src/preload/api.test.ts apps/companion/src/renderer/product-surface-state.test.ts apps/companion/src/renderer/product-surface.test.tsx
pnpm package:desktop:dir
pnpm test:desktop:package
node experiments/phase5-app-server/p59-native-surface.mjs
pnpm lint
pnpm exec prettier --check apps/companion/src/main/codex/account-catalog.ts apps/companion/src/main/codex/protocol.ts apps/companion/src/main/codex/phase5-execution.test.ts apps/companion/src/main/codex/protocol-generated-runtime.test.ts docs/experiments/2026-09-08-phase5-p59-live-acceptance.md docs/experiments/artifacts/p5.9-live-acceptance/manifest.json
git diff --check
```

The first two isolated package-smoke attempts exited during native startup
because the Master had intentionally left the exact rebuilt packaged Rove
singleton open. A read-only process audit resolved parent PID `9051` and its
managed Runtime child `9080`; only parent `9051` was sent a normal termination,
and both exited. The unchanged smoke then passed. No unrelated Rove, Codex, or
Chrome process was terminated.

Remaining uncertainty is narrow and intentional: Rove did not start another
live login merely to observe the hosted completion page, because that would
disturb the authenticated account. Exact request construction and strict branch
validation are deterministic evidence; the observed stale local completion
page is Master live evidence; retained signed-in account and usage are separate
read-only packaged evidence. The next independent live browser login can confirm
the hosted completion page without exposing or recording callback contents.

## Independent Master review of the login correction — 2026-09-08

Decision: **the bounded login-surface correction is accepted. P5.9 and Phase 5
remain open pending the external native-product journeys.**

The Master reviewed the renderer operations and deterministic interaction
harness, independently reran the 94-test focused Phase 5 suite and companion
typecheck, rebuilt the production renderer, and reran the exact interaction
sequence. The sequence passed with one automatic browser open, a visible failed
open, one explicit retry, cancellation cleanup, device-code projection, and one
automatic device verification-page open. The Master also reran the staged
darwin/arm64 package smoke successfully.

Artifact and package identities independently matched the recorded values:

- signed-in screenshot SHA-256:
  `7393b9fbc17749a4a91b164009ed6aef21823bf77dea511f765a5a336f8413ba`
- packaged `app.asar` SHA-256:
  `e9c5047033110ff1ba2cba8f977b99c008d95aafb71a0f766536fd9b93f6a2dd`
- bundled Codex SHA-256:
  `a30ec314bbd0e3721632234d07db7c99855db3b9f1e32dbe8c791947f07e7629`

Finally, the Master launched the corrected packaged app through the native
semantic harness and observed the persisted `plus` / `chatgpt` account, usage
window, model and effort catalogs, and the named qualification workspace. This
launch was read-only. The exact app and harness were closed, and a subsequent
process audit found no matching qualification process.

The earlier account prerequisite is therefore satisfied. The remaining P5.9
work is to execute Gates B–F through the native product, subject to the named
browser workspace retaining the required external-service sessions.

## Independent Master review of the hosted completion-page correction — 2026-09-08

Decision: **the hosted completion-page correction is accepted. P5.9 and Phase
5 remain open pending the external native-product journeys.**

The Master compared the browser and device-code request branches with the
pinned Codex App Server 0.153.4 schema and the official App Server account-login
contract. The browser request now selects the hosted success page and ChatGPT
branding, while the device-code request remains free of browser-only fields.
The generated runtime validator remains unchanged and closed to extra fields.

Independent verification passed:

- exact request-shape and generated-validator tests: 3 files, 35/35;
- companion TypeScript check;
- package and bundled-Codex digest comparison;
- `git diff --check`;
- clean staged darwin/arm64 package smoke.

The Master matched the rebuilt `app.asar` SHA-256
`3fc8756b10c131647d0fb7ccd3d5d16b1c5be770483b63ce497cadb6c80a7ec6`
and the unchanged bundled Codex SHA-256
`a30ec314bbd0e3721632234d07db7c99855db3b9f1e32dbe8c791947f07e7629`.

No second live login was started and the authenticated account was not altered.
The next independent login is the remaining live confirmation of the hosted
completion page; this does not block acceptance of the request-construction
correction itself.

## Gates B–F resumed execution — 2026-09-08

Status: **stopped at the first required product-path failure. Gates B–F remain
blocked; no approved external mutation was attempted.**

The user explicitly authorized the disposable GitHub, Calendar, and Drive
mutations described by the Master. Before any such journey, this execution
reconfirmed the exact native package, account, and workspace and submitted one
ordinary read-only desired outcome to determine whether the named workspace
retained GitHub and Google authentication:

```text
Check whether this browser workspace is currently signed in to GitHub, Gmail,
Google Calendar, and Google Drive. Do not change anything; report the signed-in
status of each service.
```

The named workspace was explicitly selected, the native account showed
`plus` / `chatgpt`, Usage window and Token activity were visible, Agent mode was
selected, and the desired outcome made no reference to Rove, MCP, connectors,
plugins, browser tools, or implementation instructions.

### Completed

- Reconfirmed packaged `app.asar` SHA-256
  `3fc8756b10c131647d0fb7ccd3d5d16b1c5be770483b63ce497cadb6c80a7ec6`
  and bundled Codex `0.153.4` SHA-256
  `a30ec314bbd0e3721632234d07db7c99855db3b9f1e32dbe8c791947f07e7629`.
- Reconfirmed the signed-in native account and exact named workspace
  `P5.9 Qualification 20260908` /
  `wrk_1e34bdfc-f3cf-489c-851e-ab209fb19720`.
- Reserved the timestamp-unique GitHub repository name
  `rove-phase5-live-20260908t080800z` before any possible GitHub submission.
  It was not submitted or created.
- Captured the visible native failure and closed the harness cleanly.

### Failed

The read-only authentication-probe task failed during native product bootstrap
with the exact visible error:

```text
Required exact Rove MCP readiness/auth/catalog gate failed.
```

The product log places the failure in the task coordinator's exact Rove MCP
inspection before Codex thread dispatch. The coordinator reached its known-safe
`runtime_bound` compensation point, ended the Runtime session, closed task
authority, and returned the error to the native surface. The surface returned
to the new-task form and showed no task-history entry. No managed task browser
was operated and no remote site was reached. This is a product MCP
readiness/auth/catalog failure, not a Runtime startup failure, remote-site
failure, or proof that any external service is signed in or signed out.

| Artifact                                         | SHA-256                                                            | Evidence                                                                                               |
| ------------------------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `gate-b-required-rove-mcp-readiness-blocker.png` | `63a942fdd2bc575d28ad7ee2d38ed404cd0a22afc18f06205e95d2e9f4331da0` | Signed-in native new-task surface after compensated bootstrap, with the exact visible MCP gate failure |

### Blocked

| Gate                   | Blocked result                                                                                                                                                                                                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| B — GitHub lifecycle   | The prerequisite authentication probe could not create a production-path browser session. Repository creation, issue creation/edit/assignment/labeling, verification, history, screenshot, and evidence capture were not attempted.                                                        |
| C — handoff/recovery   | No native task/thread/session survived bootstrap, so no safe browser handoff, timeout, continuation, or restart recovery could be exercised.                                                                                                                                               |
| D — modes/identity     | Companion, Capture, named-workspace restart task continuity, and Temporary session isolation require the same exact MCP bootstrap gate. They were not redundantly launched after the shared prerequisite failed.                                                                           |
| E — Phase 1–4 journeys | Gmail/Calendar, Drive, Maps, research, PDF, and download journeys could not reach a production managed browser. External-service authentication therefore remains unknown.                                                                                                                 |
| F — account/approvals  | The accepted deterministic login evidence and live signed-in persistence remain valid. No natural approval variant arose because no task launched. Browser/device-code completion and logout remain intentionally unexecuted against the primary account for lack of a disposable account. |

No repository, issue, calendar event, Drive file/folder, download, email, or
other external object was created, edited, deleted, or left uncertain. There
was therefore no external cleanup to perform and no consequential action to
reconcile or retry.

### Process and staging note

The first harness launch was redirected by Electron's singleton because the
Master had again left the exact packaged Rove instance open. A read-only process
audit resolved only that package (parent PID `15211`, managed Runtime child
`15230`). Parent `15211` received normal termination; both exited. The package
was then relaunched under the approved native-surface harness. No unrelated
Rove, Codex, Chrome, or external task-browser process was terminated or used.

No production file changed during this resumed execution, so the already
accepted login campaigns and automated/distribution suites were not rerun. The
only new repository artifacts are this report update, the manifest update, and
the blocker screenshot. A final process audit found no matching packaged Rove
or P5.9 harness process.

Remaining uncertainty: the exact failing MCP predicate—readiness,
authentication, server identity/version, bound session, catalog digest, or tool
name set—is intentionally collapsed by the product error and cannot be
distinguished from the renderer evidence. Resolving that product bootstrap
failure is required before Gates B–F can resume. This execution does not
self-accept P5.9 or Phase 5.

## MCP JSON-wire digest correction — 2026-09-08

Status: **implemented, packaged, and ready for independent Master review. No
native task or external journey was retried.**

### Root cause

The Master independently decomposed the failed preflight and proved that every
predicate except the definition digest matched: packaged MCP initialize
returned `rove` / `0.1.0`, tools/list returned the exact 29 names, and the
authenticated bound-session call succeeded. The mismatch was:

| Basis                                                 | SHA-256                                                            |
| ----------------------------------------------------- | ------------------------------------------------------------------ |
| Old pinned pre-serialization JavaScript-object digest | `7ea9e288845f04024c696011ccae7eafa54a5ee443a44629e03965d379856340` |
| Actual tools/list JSON-wire digest                    | `3c11ca83feff1552b9c1d125b87a799442359eb5d5fa35af4b05689c2218c35e` |
| JSON-round-tripped in-memory definitions              | `3c11ca83feff1552b9c1d125b87a799442359eb5d5fa35af4b05689c2218c35e` |

The in-memory tool definitions contain 45 optional description properties with
the JavaScript value `undefined`. The old canonicalizer converted those values
to the literal text `undefined` before hashing. JSON transport omits them, so
the pinned digest described no payload that the MCP server could emit.

### Correction

`canonicalRoveToolDefinitionsJsonWire` is now the single shared rule used by
the pinned catalog check, the stdio MCP probe, the App Server thread-status
comparison, deterministic tests, and process E2E. It first performs JSON
serialization/parsing to apply actual wire semantics, then sorts definitions by
name and object keys before hashing. The pinned value is now the verified wire
digest `3c11ca83feff1552b9c1d125b87a799442359eb5d5fa35af4b05689c2218c35e`.

No tool definition or construction path was changed. Consequently the emitted
JSON is structurally and byte-for-byte unchanged by this correction; only the
expected and computed digest basis changed. The deterministic checker proves
that the original in-memory collection and its JSON round-trip resolve to the
same pinned digest. A serialized description mutation still produces a
different digest.

The preflight continues to enforce readiness, authentication, exact server
name, exact server version, bound session, definition digest, and exact tool
name set. On failure it now reports only failed predicate labels, for example
`definition digest`, without printing compared values, capabilities, tokens,
Runtime credentials, or schemas. The renderer receives the concise actionable
prefix `Required Rove MCP preflight failed` plus those safe labels.

### Verification

| Check                                   | Exact result                                                                   |
| --------------------------------------- | ------------------------------------------------------------------------------ |
| Deterministic digest regeneration/check | Pass; 29 tools; in-memory, JSON-wire, and pinned digest all `3c11…c35e`        |
| Focused correction set                  | 4 files, 36/36 passed                                                          |
| Focused Phase 5 set                     | 14 files, 97/97 passed                                                         |
| MCP transport/catalog integration       | 2 files, 8/8 passed                                                            |
| Real process MCP E2E                    | 1 file, 2/2 passed; stdio initialize/tools-list digest plus authenticated HTTP |
| Repository typecheck                    | Passed                                                                         |
| Repository build                        | Passed                                                                         |
| darwin/arm64 staging                    | Passed                                                                         |
| Isolated packaged Desktop smoke         | Passed                                                                         |

Commands:

```sh
pnpm typecheck
pnpm vitest run apps/mcp/src/server/tool-catalog.test.ts apps/companion/src/main/codex/phase5-execution.test.ts apps/companion/src/main/codex/product-intent-ipc.test.ts apps/companion/src/main/host/hub-command-executor.test.ts
pnpm build
node experiments/phase5-app-server/check-rove-tool-definition-digest.mjs
pnpm test:e2e
pnpm vitest run apps/companion/src/main/codex apps/companion/src/main/runtime-client.test.ts apps/companion/src/preload/api.test.ts apps/companion/src/renderer/product-surface-state.test.ts apps/companion/src/renderer/product-surface.test.tsx
pnpm vitest run apps/mcp/src/control-transports.integration.test.ts apps/mcp/src/server/tool-catalog.test.ts
pnpm package:desktop:dir
pnpm test:desktop:package
pnpm lint
pnpm exec prettier --check packages/protocol/src/rove-tool-catalog.ts apps/companion/src/main/codex/rove-mcp-probe.ts apps/companion/src/main/codex/task-coordinator.ts apps/companion/src/main/codex/phase5-execution.test.ts apps/mcp/src/server/tool-catalog.test.ts apps/mcp/test/e2e/v1.e2e.test.ts experiments/phase5-app-server/check-rove-tool-definition-digest.mjs docs/experiments/2026-09-08-phase5-p59-live-acceptance.md docs/experiments/artifacts/p5.9-live-acceptance/manifest.json
git diff --check
```

Rebuilt `app.asar`: 23,439,933 bytes, staged
2026-09-08T08:32:34Z, SHA-256
`23ddaa88a8a983c3627f423a8efa55cdf8fa6d8fda1e8089f3f1e051b8d235c3`.
Bundled Codex remains `0.153.4`, SHA-256
`a30ec314bbd0e3721632234d07db7c99855db3b9f1e32dbe8c791947f07e7629`.

No native Rove task, GitHub/Google action, managed task browser, or external
journey was launched. Remaining uncertainty is deliberately limited to a future
native task retry: deterministic and real MCP process boundaries now agree on
the digest, but the corrected packaged task bootstrap has not been exercised in
this correction turn. P5.9 and Phase 5 remain open.

## Post-digest native preflight retry — 2026-09-08

Status: **the corrected exact MCP preflight passed; Codex thread dispatch then
failed on a separate configuration-type defect. Gates B–F remain blocked and no
external service was reached.**

The Master accepted the JSON-wire digest correction and authorized one fresh
native authentication-status task. The packaged app was launched under the
native semantic harness with the signed-in `plus` / `chatgpt` account, Agent
mode, and named workspace `P5.9 Qualification 20260908`. The desired outcome
was ordinary product intent only:

```text
Check whether this browser workspace is currently signed in to GitHub, Gmail,
Google Calendar, and Google Drive. Do not change anything; report the signed-in
status of each service.
```

### Completed

- The task advanced beyond Runtime binding and the exact MCP
  readiness/authentication/identity/version/session/digest/tool-name inspection.
  This is direct native evidence that the JSON-wire digest correction resolves
  the prior preflight blocker.
- The native product persisted a task-history entry and attempted Codex thread
  creation.
- The native account and exact named workspace remained selected and visible.

### Failed

Codex App Server rejected thread creation with this visible product error:

```text
failed to load configuration: invalid type: string "", expected struct
ComputerUseMacosConfigToml in `computer_use.macos`
```

The production thread configuration currently supplies
`computer_use: { default_app_access: "deny", macos: null, windows: null }`.
Across the App Server configuration boundary, the `macos` null is interpreted
as an empty scalar rather than the structured value expected by Codex 0.153.4.
This failure is after the Rove MCP preflight but before a usable Codex thread,
turn, or managed task-browser journey.

| Artifact                                       | SHA-256                                                            | Evidence                                                                                            |
| ---------------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `gate-b-computer-use-macos-config-blocker.png` | `9e58f7fe48b7f1f106ffe5af9b14228c1fd5c4a8a7435d9a008b88379c3a0a6e` | Signed-in native product, persisted Agent task-history entry, and exact visible configuration error |

### Blocked

- GitHub/Gmail/Calendar/Drive authentication status remains unknown because no
  managed browser reached a remote site.
- The GitHub lifecycle, handoff/recovery, Companion/Capture/identity checks, all
  Phase 1–4 browser journeys, and naturally arising approvals remain blocked by
  the shared thread-creation configuration.
- No GitHub repository or issue, Calendar event, Drive artifact, email,
  download, or other external object was created, edited, deleted, or left
  uncertain.

The task was not retried. No direct API, ordinary Computer Use, coordinate
action, second browser controller, or substitute evidence path was used. The
packaged app and harness closed successfully, and the final process audit found
no matching qualification process.

Remaining uncertainty is now narrower than the prior failure: the corrected MCP
preflight is proven live, while thread creation is blocked specifically by the
`computer_use.macos` configuration representation. That product defect must be
corrected and independently reviewed before Gates B–F can resume. P5.9 and Phase
5 remain open.

## Computer-use optional-platform correction — 2026-09-08

Status: **implemented, verified, and packaged for independent Master review.
No native P5.9 task or external journey was retried.**

Official OpenAI configuration guidance defines `computer_use.macos` and
`computer_use.windows` as optional tables. Rove has no platform-specific app
rules in this task configuration, so the shared production config now emits
exactly:

```json
{
  "computer_use": {
    "default_app_access": "deny"
  }
}
```

The optional macOS and Windows keys are absent. They are not replaced with null,
empty strings, empty tables, or invented platform rules. The Browser policy,
Rove MCP configuration, default deny value, and all other thread parameters are
unchanged. Both `thread/start` and `thread/resume` derive their config from this
same production construction.

### Exact regression coverage

The focused coordinator test performs a complete start followed by resume,
captures both exact App Server RPC parameter objects, JSON-serializes each, and
asserts:

- `computer_use` equals only `{ "default_app_access": "deny" }`;
- neither `macos` nor `windows` is an own property after JSON serialization;
- neither optional key can regress to null or an empty scalar.

The existing bootstrap, MCP provenance, recovery, and thread identity checks
remain active around those captured calls.

### Production-equivalent text-only probe

The production host lifecycle probe used the rebuilt package's pinned Codex
0.153.4 binary and the same platformless default-deny Browser/computer-use
configuration. It did not create a Rove Runtime or browser session. It created a
Codex thread, sent only this harmless local text, observed completion, exercised
read/resume, and archived the thread in the normal path and `finally` cleanup:

```text
Reply exactly OK.
```

| Evidence                  | Result                                                                                  |
| ------------------------- | --------------------------------------------------------------------------------------- |
| Thread                    | `01a07ffd-7074-79e0-83bf-9d6e7f5e72ae`; read and resume succeeded; final state archived |
| Turn                      | `01a07ffd-71ef-7ef3-9734-76ee455218cd`; status `completed`                              |
| Computer-use projection   | default app access `deny`; macOS absent; Windows absent                                 |
| Browser/external activity | No Runtime session, browser launch, navigation, or external service contact             |

This proves Codex 0.153.4 accepts the corrected configuration and reaches a
usable text thread without using a managed task browser.

### Verification

| Check                                  | Exact result                                        |
| -------------------------------------- | --------------------------------------------------- |
| Focused start/resume/recovery tests    | 3 files, 34/34 passed                               |
| Focused Phase 5 set                    | 14 files, 98/98 passed                              |
| P5.0 deterministic oracle              | 75/75 passed                                        |
| P5.0 schema/digest guard               | Passed; Codex/schema/validator identities unchanged |
| Tool-definition JSON-wire digest guard | Passed; 29 tools, `3c11…c35e`                       |
| Production-equivalent text-only probe  | Passed; turn completed, thread archived             |
| Repository typecheck                   | Passed                                              |
| Repository build                       | Passed                                              |
| Authoritative full single-worker suite | 139 files, 869/869 passed in 267.30 seconds         |
| Repository lint                        | Passed                                              |
| darwin/arm64 package staging           | Passed                                              |
| Isolated packaged Desktop smoke        | Passed                                              |

Commands:

```sh
pnpm --filter @rove/companion typecheck
pnpm vitest run apps/companion/src/main/codex/phase5-execution.test.ts apps/companion/src/main/codex/product-recovery.test.ts apps/companion/src/main/codex/execution-core-startup-recovery.test.ts
pnpm build
env ROVE_CODEX_EXECUTABLE=release/artifacts/mac-arm64/Rove.app/Contents/Resources/services/codex/codex ROVE_LIFECYCLE_USE_EXISTING_AUTH=1 node experiments/phase5-app-server/production-host-lifecycle.mjs
pnpm phase5:p50:schema
pnpm phase5:p50:fixtures
node experiments/phase5-app-server/check-rove-tool-definition-digest.mjs
pnpm vitest run apps/companion/src/main/codex apps/companion/src/main/runtime-client.test.ts apps/companion/src/preload/api.test.ts apps/companion/src/renderer/product-surface-state.test.ts apps/companion/src/renderer/product-surface.test.tsx
pnpm vitest run --maxWorkers=1 --no-file-parallelism --reporter=dot
pnpm package:desktop:dir
pnpm test:desktop:package
pnpm lint
pnpm exec prettier --check apps/companion/src/main/codex/task-coordinator.ts apps/companion/src/main/codex/phase5-execution.test.ts experiments/phase5-app-server/production-host-lifecycle.mjs docs/experiments/2026-09-08-phase5-p59-live-acceptance.md docs/experiments/artifacts/p5.9-live-acceptance/manifest.json
git diff --check
```

Rebuilt `app.asar`: 23,444,445 bytes, staged
2026-09-08T08:55:26Z, SHA-256
`88833b84b9902c2ab29a087750accacd0b16fd2ef60a73fe0d554e459cce322f`.
Bundled Codex remains `0.153.4`, SHA-256
`a30ec314bbd0e3721632234d07db7c99855db3b9f1e32dbe8c791947f07e7629`.

Remaining uncertainty is limited to the next independently authorized packaged
native task retry. The shared start/resume configuration and a real text-only
Codex lifecycle are proven, but this correction turn intentionally did not
launch a Rove task, browser session, or external journey. P5.9 and Phase 5
remain open.

### Independent Master review of the digest correction

Status: **accepted for resuming the P5.9 native preflight.** This accepts only
the bounded catalog-digest correction; P5.9 and Phase 5 remain open.

The Master inspected the shared JSON-wire canonicalizer, the packaged stdio
probe, the exact preflight predicates, the safe predicate-name-only diagnostic,
and the real-process regression. Independent reruns produced:

- deterministic digest checker: pass, 29 tools, with in-memory, serialized, and
  pinned digests all `3c11ca83feff1552b9c1d125b87a799442359eb5d5fa35af4b05689c2218c35e`;
- focused catalog/coordinator tests: 2 files, 30/30 passed;
- real MCP process E2E: 2/2 passed across stdio and authenticated HTTP;
- companion typecheck: passed;
- `git diff --check`: passed;
- staged darwin/arm64 package smoke: passed.

No external service was contacted and no native Rove task was launched during
this review. The next gate is a fresh packaged-app read-only authentication
preflight, followed by the approved external-service journeys only if that
preflight succeeds.

### Independent Master review of the optional-platform correction

Status: **accepted for a fresh packaged native preflight.** This accepts only
the thread-configuration correction; P5.9 and Phase 5 remain open.

The Master confirmed that the shared start/resume construction now emits only
`computer_use.default_app_access: "deny"`, with the optional macOS and Windows
tables absent after serialization. Independent verification produced:

- exact start/resume and recovery tests: 3 files, 34/34 passed;
- companion typecheck: passed;
- 29-tool JSON-wire digest guard: passed;
- production-equivalent Codex lifecycle: thread
  `01a08006-35ce-7a93-8653-23f1326d0d00`, turn
  `01a08006-37b6-7482-a8b9-97441fe2c7c9`, completed, read/resumed, and
  archived;
- staged darwin/arm64 package smoke: passed;
- rebuilt `app.asar`: 23,444,445 bytes, SHA-256
  `88833b84b9902c2ab29a087750accacd0b16fd2ef60a73fe0d554e459cce322f`;
- `git diff --check`: passed.

The lifecycle used only `Reply exactly OK.` and did not launch a Runtime
browser or contact an external service. The next required evidence is a fresh
native Rove authentication-status task through the packaged product.

## Post-platform native preflight retry — 2026-09-08

Status: **failed at managed-browser startup; downstream Gates B–F remain
blocked. P5.9 and Phase 5 remain open.**

The fresh packaged/native retry used the signed-in `plus/chatgpt` account and
the named workspace `P5.9 Qualification 20260908`
(`wrk_1e34bdfc-f3cf-489c-851e-ab209fb19720`). The exact read-only prompt was:

```text
Check whether this browser workspace is currently signed in to GitHub, Gmail, Google Calendar, and Google Drive. Do not change anything; report the signed-in status of each service.
```

The exact Rove MCP preflight passed, the Codex thread was created, and the
native task reached `WORKING`. It produced one Browser & Evidence observation
and zero evidence items. The task then completed with this product-level
outcome: `I couldn’t inspect the browser because the browser tooling failed to
start.` The service-status result was therefore:

| Service         | Result           |
| --------------- | ---------------- |
| GitHub          | Unable to verify |
| Gmail           | Unable to verify |
| Google Calendar | Unable to verify |
| Google Drive    | Unable to verify |

No remote service was reached. No repository, issue, Calendar event, Drive
artifact, email, download, or other external object was created, edited, or
deleted. No external mutation was attempted.

### Identity and cleanup reconciliation

| Native identity | Value                                       |
| --------------- | ------------------------------------------- |
| Rove task       | `task_803cc8ee-117c-41fb-97b6-9f68418f33f1` |
| Rove session    | `ses_9a7e1d9fd05e4b968a07058279c89348`      |
| Codex thread    | `01a08008-803c-7f53-88d5-9667b70d6d94`      |
| Codex turn      | `01a08008-979b-7a41-9222-5b633b27c2f4`      |

One normal Stop cleanup was attempted after the completed task. It failed with:

```text
Conflicting Codex event identity: codex:01a08008-803c-7f53-88d5-9667b70d6d94:01a08008-979b-7a41-9222-5b633b27c2f4:turn/started.
```

No blind Stop retry was performed. The packaged app and semantic harness then
closed normally, but the durable Rove session record remains `active`; local
session cleanup is therefore uncertain even though process cleanup was
verified. The final audit found no packaged Rove, qualification harness, Codex,
or qualification-owned Runtime process. It excluded PID 30163, Runtime instance
`runtime_f4cfddf76d2f4feaba073a2f75079fdf`, because that process started on
2026-09-07 at 15:17:40 +01:00 and predates this retry. This is a second product
failure to reconcile before another native journey.

### Native evidence

| Artifact                                   | Dimensions  | SHA-256                                                            |
| ------------------------------------------ | ----------- | ------------------------------------------------------------------ |
| `gate-b-browser-tooling-start-failure.png` | 2360 × 2124 | `cc41fba7d1f8e662d8ab79c0b0db1e572bdba98ecd2408dec02c7e58624206d1` |

The retry used only the packaged Rove Electron surface through the native
semantic harness. No ordinary Computer Use, coordinates, direct service API,
second browser controller, or substitute evidence path was used. Because
browser startup failed, the GitHub lifecycle, Calendar/Drive journeys,
handoff/recovery, Companion/Capture/identity checks, prior browser journeys,
and naturally arising approvals were not attempted. No production file was
changed and no test suite was rerun during this execution; only this report,
its manifest, and the failure screenshot were added or updated for independent
Master review.

## Browser-tooling and completed-turn Stop corrections — 2026-09-08

Status: **implemented, verified, rebuilt, and ready for independent Master
review. P5.9 was not retried or accepted.**

### Atomic packaged Codex component set

The reviewed Codex executable and its adjacent code-mode host are now validated
as one versioned component set before staging is cleared or mutated. Only those
two executables are copied into `services/codex`; both are staged with mode 0755. The existing compatibility manifest fields remain intact and an explicit
`codeModeHost` identity records filename, digest, byte size, platform, and
architecture.

| Component              | Bytes       | SHA-256                                                            | Identity                         |
| ---------------------- | ----------- | ------------------------------------------------------------------ | -------------------------------- |
| `codex`                | 220,585,024 | `a30ec314bbd0e3721632234d07db7c99855db3b9f1e32dbe8c791947f07e7629` | Codex 0.153.4, macOS arm64, 0755 |
| `codex-code-mode-host` | 62,768,576  | `fdd977821def000939dd48da48b39d581845470671135bd4642584eeb0762a6b` | Mach-O arm64, 0755               |

The helper identity was independently recomputed from the reviewed ChatGPT
resource, not copied from the defect report. Deterministic probes reject both a
missing helper and changed helper bytes. Packaged verification requires the
helper and compatibility metadata, recomputes both executable digests, checks
the helper size and executable bits, and runs a bounded `--help` probe before
starting any packaged service or Desktop process.

### Semantic completed-turn reconciliation

Conversation event fingerprints now cover only normalized reducer-relevant
semantics: event type; thread, turn, and item identities; terminal status;
projected item content/status; delta; and summary as applicable. Mutable raw App
Server transport snapshots are excluded.

The regression applies a live `turn/started` notification, reconciles a later
authoritative completed thread containing additional turn fields and a
completed item twice, and succeeds idempotently. The resulting projection is
terminal and authoritative. The same test then exercises Stop/close and proves
that the exact Runtime session is ended and the task context is removed from
both authority and persisted state. Existing completed-versus-failed collision
coverage remains strict, and a new check proves changed content under one
completed-item identity is still rejected.

### Packaged code-mode-host fixture-MCP proof

The upgraded production lifecycle used the rebuilt package's pinned Codex and
adjacent helper. With browser/computer access denied and web search disabled, it
performed exactly one harmless local fixture call:

```text
rove_lifecycle / session.status
```

| Evidence        | Exact result                                   |
| --------------- | ---------------------------------------------- |
| Thread          | `01a0801d-2295-7b21-b05e-4bf25c15b98a`         |
| Turn            | `01a0801d-23bc-7680-92bb-90794d42fc51`         |
| Terminal status | `completed`                                    |
| Fixture result  | `task_lifecycle` / `ses_fixture`               |
| Lifecycle       | Read, resume, unarchive, and archive succeeded |

No Rove Runtime browser was started and no external service was contacted by
this lifecycle. The local fixture declares only `session.status` read-only and
non-destructive so the `approvalPolicy: never` lifecycle can execute the safe
probe without an interactive approval or mutation bypass.

### Verification

| Check                                       | Exact result                       |
| ------------------------------------------- | ---------------------------------- |
| Missing/changed-helper deterministic probes | Passed                             |
| Focused conversation and Stop tests         | 2 files, 50/50 passed              |
| P5.0 deterministic oracle                   | 75/75 passed                       |
| P5.0 schema/digest guard                    | Passed; reviewed identities stable |
| Tool-definition JSON-wire digest guard      | Passed; 29 tools, `3c11…c35e`      |
| Packaged fixture-MCP lifecycle              | Passed; exact fixed identities     |
| Authoritative full single-worker suite      | 139 files, 871/871 passed          |
| Repository typecheck                        | Passed                             |
| Repository build                            | Passed                             |
| Repository lint                             | Passed                             |
| darwin/arm64 staging                        | Passed                             |
| Isolated packaged Desktop smoke             | Passed                             |

Rebuilt `app.asar`: 23,453,340 bytes, staged
2026-09-08T08:22:11Z, SHA-256
`a3375469b44ad9b5c6970b3d9056e595ee9a2fea71dae78f96921b953e5ec9`.

No P5.9 native task or external journey was launched in this correction set.
The final process audit found no correction-owned packaging, fixture MCP,
Codex lifecycle, packaged Rove, or helper process. It excluded the pre-existing
Runtime PID 30163 and ChatGPT-owned code-mode-host PID 87493 because both began
on 2026-09-07 and predate this correction.

The next step is independent Master review of both bounded fixes before any new
native preflight. P5.9 and Phase 5 remain open.

## Persisted legacy-fingerprint cleanup gate and correction — 2026-09-08

Status: **native cleanup stopped before Stop; bounded legacy migration
implemented, verified, and rebuilt for independent Master review. No fresh
native task or external journey was started.**

### Failed native cleanup gate

The rebuilt packaged product was launched only far enough to restore historical
task state. Account and named-workspace projections remained available, but the
target task still surfaced this exact startup recovery failure:

```text
task_803cc8ee-117c-41fb-97b6-9f68418f33f1: Conflicting Codex event identity: codex:01a08008-803c-7f53-88d5-9667b70d6d94:01a08008-979b-7a41-9222-5b633b27c2f4:turn/started.
```

This established that the first semantic-fingerprint correction did not
migrate pre-correction persisted digests. The inspection-only product launches
were closed normally. Stop was not issued, the fresh authentication preflight
was not started, no remote service was reached, and no external mutation or
object creation occurred.

### Exact legacy form and bounded migration

The persisted conversation file remains schema version 2, but its event
fingerprints predate semantic fingerprinting and have no per-event version. The
legacy digest was SHA-256 over the App Server method plus the complete mutable
raw transport parameters. Exact recovered historical entries include:

| Semantic identity   | Legacy SHA-256                                                     |
| ------------------- | ------------------------------------------------------------------ |
| `turn/started`      | `4306e689848bd05512178a586c70132222e4da6c163fc1bf1b14356157a9fecf` |
| final item complete | `1d777cb38d70e999d5f4ea7129de97713825ec04bf1d364ebb471daf51672d11` |
| `turn/completed`    | `d7532265b36ac7869599cec59478d67c1af22ca4892e03fb3691988705555934` |

Conversation state now carries a bounded per-event
`eventFingerprintVersions` map. Absence means the legacy raw-transport form;
new and migrated semantic entries are explicitly version 2. Migration is
available only inside authoritative `thread/read` reconciliation and only for
`turn_started`, `item_completed`, and `turn_terminal` identities that already
exist in legacy state.

The authoritative upgrade requires an existing bound thread and known turn.
Completed items must exactly equal the stored normalized projected item, and a
terminal turn must exactly equal the stored terminal status. Only that event's
fingerprint is replaced and marked v2; unrelated fingerprints are retained.
Ordinary reducer application never accepts the mismatch. This preserves strict
collision rejection outside the bounded legacy migration.

### Exact restart and Stop regression

The deterministic fixture uses the historical task, Runtime session, Codex
thread, turn, final item, and the three exact legacy digests above. It proves:

- first restart upgrades the authoritative entries to v2;
- a second restart is idempotent;
- normal Stop ends exactly Runtime session
  `ses_9a7e1d9fd05e4b968a07058279c89348`;
- Stop removes the task context from in-memory authority and persisted state;
- changed completed-item content still conflicts;
- completed-versus-failed terminal status still conflicts.

Unbound authoritative events retain the pre-existing bounded pending-event
behavior, preserving cold-start recovery before association binding.

### Verification

| Check                                  | Exact result                  |
| -------------------------------------- | ----------------------------- |
| Focused historical restart/Stop set    | 3 files, 55/55 passed         |
| Full relevant Codex suite              | 10 files, 82/82 passed        |
| Companion typecheck                    | Passed                        |
| Repository build                       | Passed                        |
| Repository lint                        | Passed                        |
| P5.0 deterministic oracle              | 75/75 passed                  |
| P5.0 schema/digest guard               | Passed                        |
| Tool-definition JSON-wire digest guard | Passed; 29 tools, `3c11…c35e` |
| darwin/arm64 staging                   | Passed                        |
| Isolated packaged Desktop smoke        | Passed                        |

The first packaged smoke attempt stopped before service startup because the
unsigned helper's initial `--help` execution exceeded five seconds. Digest,
size, and executable-mode validation had already passed. The bounded behavior
timeout was widened to 15 seconds for macOS first-launch verification; the
single rerun passed. No package identity check was relaxed.

Rebuilt `app.asar`: 23,472,423 bytes, staged
2026-09-08T08:51:12Z, SHA-256
`c1262f61fa8392388ce4f9a6bf55aff05c360440e483f81c4d709c620aa355b8`.
The staged Codex and code-mode-host digests remain exactly `a30e…7629` and
`fdd9…2a6b`.

No native preflight or external journey was retried after this correction.
The final process audit found no inspection-launch, package-smoke, packaged
Rove, Codex, or fixture process from this turn. Pre-existing Runtime PID 30163
was again excluded because it began on 2026-09-07 and predates this work.

P5.9 and Phase 5 remain open pending independent Master review.

## Post-migration native cleanup retry — 2026-09-08

Status: **legacy reconciliation passed in the packaged product, but normal Stop
was unavailable; cleanup remains non-authoritative and all downstream gates are
blocked.**

The Master-approved rebuilt package was launched through the native semantic
harness. Startup no longer reported the historical `turn/started` fingerprint
collision. The exact target history row was selected by its unique visible
read-only prompt and completed outcome, without coordinates or a second browser
controller. The product displayed the completed conversation and classified it
as:

```text
Historical task · read-only
```

The product exposed no Stop control for this task. Because the normal product
Stop path was unavailable, Stop was not issued and no internal or direct API
substitute was used.

Read-only reconciliation of current persisted state after closing the product
showed:

| State                            | Exact result                           |
| -------------------------------- | -------------------------------------- |
| Conversation revision            | 99                                     |
| Projected turn                   | `completed`                            |
| Historical start fingerprint     | version 2                              |
| Final completed-item fingerprint | version 2                              |
| Historical terminal fingerprint  | version 2                              |
| Task-context revision            | 15                                     |
| Target task context              | Present; bootstrap stage `complete`    |
| Runtime session                  | `ses_9a7e1d9fd05e4b968a07058279c89348` |
| Runtime status/controller        | `active` / `agent`                     |
| Runtime `endedAt`                | Absent                                 |

This proves the persisted fingerprint migration applied successfully, but the
required cleanup outcome did not: the target context remains present and the
durable Runtime session remains active while the product treats the task as
historical. Cleanup is therefore uncertain.

Per the gate rule, the exact fresh authentication preflight was not started and
no GitHub, Gmail, Calendar, Drive, Maps, research, PDF, handoff, Companion,
Capture, named-workspace, or Temporary journey was attempted. No remote service
was reached and no external object or mutation was created.

Both inspection-only packaged launches closed normally. The final process audit
found no qualification-owned packaged Rove, Codex, harness, or Runtime process;
pre-existing Runtime PID 30163 was excluded because it predates this retry.
P5.9 and Phase 5 remain open for independent Master review.

### Independent Master review of persisted-state migration

Status: **accepted for one fresh native cleanup and read-only preflight.** This
accepts only the bounded persisted-state migration; P5.9 and Phase 5 remain
open.

The Master inspected the per-event version map, the authoritative-reconciliation
boundary, the exact historical fixture, and the retained conflict checks.
Independent reruns produced:

- exact historical restart/Stop set: 3 files, 55/55 passed;
- additional cold-start recovery test: 1/1 passed;
- companion typecheck: passed;
- 29-tool JSON-wire digest guard: passed;
- staged darwin/arm64 package smoke: passed;
- rebuilt `app.asar`: 23,472,423 bytes, SHA-256
  `c1262f61fa8392388ce4f9a6bf55aff05c360440e483f81c4d709c620aa355b8`;
- staged Codex and code-mode-host digests: exact reviewed values;
- manifest parse and `git diff --check`: passed.

No native Rove task or external-service action was launched during this review.
The next gate is one normal product Stop for the historical completed task,
followed by a fresh packaged read-only authentication preflight only if cleanup
is authoritative.

### Independent Master disposition of the cleanup retry

Status: **blocked before external-service execution.** The Master accepts the
successful persisted-state migration but does not accept cleanup, P5.9, or
Phase 5.

The packaged product now restores the completed conversation without the prior
event-identity error. However, it classifies that task as `Historical task ·
read-only` and provides no normal Stop action while the product-owned task
context remains present and Runtime session
`ses_9a7e1d9fd05e4b968a07058279c89348` remains `active` with no `endedAt`.
The required cleanup outcome is therefore not authoritative. No fresh task,
authentication preflight, remote-service access, or external mutation occurred.

The next production correction must make terminal task classification and
session/context lifecycle consistent through a normal product path. The live
journeys must not resume until that correction is independently reviewed.

## External live-journey recovery and oracle correction — 2026-09-09

Status: **bounded correction implemented locally; external gates have not been
rerun and remain unaccepted pending independent Master review.**

Fresh source-built product evidence isolated two instruction and acceptance
semantics defects rather than a managed-browser transport failure:

- Drive session `ses_41e7b2e1ca434dbaba23430ac04c20b1` and Maps session
  `ses_a718bf14a3564d659407b079346712ed` both reached ready HTTP-200 pages
  through Rove. Each `browser.screenshot` returned retryable
  `OBSERVATION_STALE` before any external mutation. The product-created task
  stopped because browser-route policy v1 made every rejected Rove operation a
  terminal boundary, overriding the user's permitted one-time fresh read-only
  retry.
- IRS/PDF session `ses_06bdfebc46c74daa88a62acb6af2c325` completed source
  navigation, separate tabs, Back/Forward, two screenshots, PDF scrolling, one
  viewer download, evidence read, and clean Finish/Archive. Receipt
  `rcpt_be293d3c5ceb45a98cf862751e591438` correlated observation
  `obs_567eb36c06eb4432860dc99aa0ade511` and file evidence
  `ev_1af06d280e21495e8d2e746185ecdc55`. The persistent Chrome workspace saved
  `fw4 (1).pdf`; the task had predeclared `fw4.pdf` in `download_completed`, so
  the exact-name condition correctly reconciled as contradicted. The download
  engine itself completed exactly once.
- The external harnesses treated a completed Codex turn as journey success.
  Maps consequently wrote `status:"completed"` even though its final answer
  reported that directions and the second screenshot were not performed.

The bounded correction replaces route policy v1 with v2. A rejected operation
now receives at most one fresh inspect/re-ground/retry sequence only when Rove
explicitly reports `retryable:true`, the operation is read-only or conclusively
pre-dispatch, no consequential effect may have dispatched, and no human or
terminal page boundary applies. Screenshot retry binds to the new observation.
Unknown or uncertain consequential actions remain non-replayable, and the
exclusive Rove MCP browser route and human-only boundaries remain unchanged.

Agent-facing `download_completed` guidance now requires omitting the optional
filename when the task is discovering or reporting the actual saved filename.
It reserves exact filename matching for an explicit predeclared saved-name
requirement. Collision-safe browser suffixes are valid when the filename is
omitted; the actual name comes from durable evidence. An exact-name mismatch
remains `not_applied` and cannot authorize a second download.

The GitHub, Gmail→Calendar, Drive, Maps, and IRS/PDF source-product harnesses
now append a journey-specific machine result contract and share one fail-closed
verifier. The verifier combines that marker with canonical task turn state,
completed Rove tool-call identities, distinct page/observation/evidence IDs,
and Runtime observation/evidence counts where exposed. A completed turn that
reports a stop, or lacks required journey evidence, is a failed harness result.
Drive and IRS require exactly one correlated download receipt, observation, and
file-evidence identity, and IRS records the actual collision-safe filename
without preasserting `fw4.pdf`.

No external journey was rerun during this correction. No GitHub, Gmail,
Calendar, Drive, Maps, or IRS state was mutated. These live gates, P5.9, and
Phase 5 remain open until the Master independently reviews the implementation
and performs fresh bounded reruns.

### Independent review correction: catalog consistency and durable live ledger

Master review found two remaining acceptance blockers. The `browser.inspect`
tool description still retained blanket rejected-operation stop wording that
conflicted with route policy v2, and the first shared live verifier could accept
invented, well-shaped identifiers when aggregate Runtime counts were already
high enough.

The browser catalog is now internally consistent: inspection describes the
same single explicitly-retryable, read-only or conclusively pre-dispatch
freshness recovery as route policy v2, while human-only conditions, terminal
page conditions, instability, and consequential uncertainty remain terminal.
A catalog-wide regression assertion rejects the old blanket rejection wording
from every production `browser.*` tool description.

The external harnesses now load a read-only acceptance ledger from only the
terminal task's persisted Runtime session, keyed by its exact
`roveSessionId`. The loader reads observations and evidence metadata after the
task completes; it never connects to or operates the external browser. The
normalized ledger distinguishes screenshot evidence, managed file evidence,
`download_completed` observations, and agent interaction receipts with their
verified effects. Reported IDs must be ledger members. Drive and IRS/PDF must
have exactly one run-owned download observation and one browser-download file
evidence item, correlated through one applied receipt effect, with matching
actual filename, size, and MIME metadata. PDF MIME basis and persisted content
signature are also reconciled when present. Maps `transit:"unavailable"`
requires a ledger-backed observation ID.

The verifier also requires the single machine marker to be the first line of
the final response, preventing product-projection truncation from hiding it.
Deterministic coverage now rejects invented IDs, mismatched receipt/download
correlation, two persisted downloads, misplaced markers, and unsupported
transit-unavailable claims, while retaining the completed-turn stop and
incomplete-evidence cases.

No external journey was rerun for this review correction. The live gates remain
unaccepted pending independent Master review and fresh bounded execution.

### Post-discovery correction: bounded route recovery and durable evidence

Follow-up inspection of the 2026-09-09 source-product artifacts found four
contract gaps. Gmail had completed successfully but its marker mixed ephemeral
turn observations with the durable ledger. IRS/PDF had also completed, with an
ordinary receipt plus the one applied download receipt and a persisted
`%PDF-1.7` signature that the agent could not see. Drive's SPA transition to My
Drive replaced history, so `browser.back` reached `about:blank`. Maps sent its
grounded target outside `action`, producing pre-handler `INVALID_INPUT` with
`retryable:false` even though no effect dispatched.

Route policy v3 now distinguishes these cases without weakening consequential
boundaries. Freshness recovery remains bounded. An exact schema-validation path
may authorize one mechanically corrected _new_ request only when the result
proves the handler never ran and nothing dispatched; the identical malformed
request is forbidden. A safely completed read-only navigation/history operation
that reaches the wrong nonconsequential result may use one freshly inspected
alternate read-only Rove route. All recovery forms share one attempt budget per
step. Unknown dispatch, consequential uncertainty, authentication, verification,
access, and terminal boundaries still stop.

The published `browser.interact` contract now includes the exact nesting example
`action:{kind:"fill",target:{pageId,revision,ref},value:"..."}`. Drive harnesses
explicitly navigate to `https://drive.google.com/drive/my-drive`, then exercise
`browser.back` and require the exact folder URL; a marker claiming
`about:blank` fails verification.

Live markers now use `durableObservationIds`, accept only ledger-backed IDs, and
leave ephemeral IDs to prose. `receiptIds` may include every actual receipt, but
the verifier requires exactly one marker-listed, applied, dispatched receipt
whose observed download effect correlates the one persisted download and file
evidence. `pdfSignature` may be null or omitted; the verifier independently
requires the persisted file signature to match `%PDF-*` and surfaces that value
as independent evidence. Deterministic copies of the Gmail and IRS success
shapes, the Drive failure, receipt multiplicity, ephemeral-ID rejection, nested
target schema, corrected-request boundary, and alternate-route budget are
covered by regression tests.

Local deterministic verification after the correction: focused route/catalog/
verifier suites 113/113; P5.0 fixtures 75/75; full suite 1059/1059; Codex schema
evidence matches CLI `0.153.4` and aggregate SHA-256
`50cb262ffff7c4480e17f13a5667aeb5e3a411b2793a63327d03cc2d6cb6e5a5`;
typecheck, lint, build, Prettier, and `git diff --check` pass. The production
Rove tool-definition digest is now
`467ca60852e7532c04171307422bf3f546b09fab03fd28d08b211c459a4f5a34`.

No external journey or package command was run. This correction and all live
gates remain unaccepted pending independent Master review.
