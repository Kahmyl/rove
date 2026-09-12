# Phase 5 P5.9 native-product live acceptance plan

Date: 2026-09-08

Status: **Native lifecycle L0, L1, and L2 are accepted. Local external-service
execution is authorized. Packaging is the final release gate after local live
acceptance; no package is produced during journey iteration. No live result is
claimed by this plan.**

The first local-live execution exposed cwd-dependent Desktop state and an
unmatched Runtime session. After the canonical-home and visible cleanup
correction, Gate 1 reran with a clean lifecycle and stopped only because Rove's
isolated Codex account is logged out. See the
[local-live acceptance report](2026-09-08-phase5-p59-local-live-acceptance.md).

P5.9 is the final Phase 5 gate. It validates the accepted local Rove product as
a user experiences it. The operator starts in the native Rove surface, chooses
the visible product settings, and enters only a desired outcome. The test prompt
must not tell Codex to use Rove, MCP, a connector, a plugin, or a browser tool.

## Required lifecycle prerequisite

The first native cleanup attempt exposed a split between persisted task/session
state, the Runtime's in-process browser inventory, and renderer controls. P5.9
external-service gates are therefore paused behind the
[native lifecycle convergence contract](2026-09-08-phase5-p59-native-lifecycle-convergence.md).
The Master Engineering Agent must independently accept its L0 executable
contract, L1 production integration, and L2 local recovery qualification before
Gate 1 below resumes. The journeys then run against local production-equivalent
processes. The app is packaged only after those journeys are accepted.

## Fixed product boundary

- Rove Desktop is the product surface and device execution plane.
- Codex App Server supplies account, model, usage, conversation, and turn
  truth.
- Rove Runtime owns the browser workspace, interaction, control handoff, and
  evidence.
- Typed local IPC and `LocalProductApi` remain the product boundary.
- No cloud service, remote product transport, or second browser-control surface
  is introduced for acceptance.
- Coordinate interaction, direct site APIs, and ordinary Computer Use are not
  substitutes for a failed Rove path.

## Execution gates

### Gate 1 — clean native start

1. Build and stage the current Desktop application and pinned compatible Codex
   executable without producing a distributable package.
2. Start the local production-equivalent native Rove application.
3. Verify visible account state, model catalog, reasoning-effort choices, usage
   availability, execution-mode choices, and browser-identity choices.
4. Record the exact application build, Codex version/digest, workspace ID, and
   starting account state without recording credentials.

### Gate 2 — uncoached Agent journey

1. Select Agent mode and a named persistent browser workspace.
2. Select an available model and supported reasoning effort.
3. Enter only the desired user outcome for a fresh consequential browser task.
4. Verify progress, browser state, any attention request, and the final result
   from authoritative Rove/App Server projections.
5. Independently inspect the saved external result and capture final viewport
   evidence.

The primary journey should use a disposable GitHub repository and issue because
it exercises structured text entry, metadata selection, editing, history, and
saved-result verification in one bounded flow. The repository name must be
unique for the run and recorded before creation.

### Gate 3 — human return and durable recovery

1. Exercise a real Rove browser handoff whose wait is allowed to time out.
2. Complete the human step, use Return Control in the native surface, and prove
   one continuation occurs only after a fresh browser inspection.
3. Restart the Desktop/App Server/Runtime boundary while a recoverable task is
   present.
4. Prove the exact task, conversation, browser identity, and pending or terminal
   state are recovered from authoritative state without replaying the external
   action.

### Gate 4 — mode and browser-identity semantics

Run bounded live checks for:

- Companion mode beginning with human browser control and preserving the same
  task when control changes;
- Capture mode creating a human-owned browser session without starting a Codex
  turn;
- named-workspace authentication continuity after a clean restart;
- Temporary browser isolation and cleanup, with no silent fallback to the named
  workspace.

### Gate 5 — Phase 1–4 non-regression journeys

Repeat the final production journeys through the native Rove product where the
available authenticated workspace permits it:

1. GitHub repository and issue lifecycle;
2. Gmail to Google Calendar;
3. Google Drive upload, rename, organize, and download;
4. visual-heavy Google Maps route selection;
5. research, multi-tab navigation, browser history, embedded PDF scrolling, and
   managed download.

Each journey uses a fresh disposable artifact or a read-only target, verifies
the external result, and records observations, action records, downloads,
screenshots, URLs, and artifact identities as applicable. Existing Phase 1–4
evidence is baseline history, not a substitute for this run.

### Gate 6 — account and approval qualification

Using a disposable qualification account where necessary, exercise browser
login, device-code login, token refresh, logout, and real App Server approval
variants. Re-authentication must be visible, secrets must remain outside the
renderer projection, and no approval may be inferred from UI timing or task
prose.

If a disposable account or required authenticated browser session is
unavailable, record that exact environmental blocker separately. Do not weaken
the gate or mutate the user's primary account to manufacture coverage.

## Stop and evidence rules

- Stop a journey at the first required-step failure or uncertain consequential
  outcome. Do not retry an external mutation unless authoritative reconciliation
  proves it did not apply.
- Distinguish product failure, connector/runtime failure, remote-site failure,
  and unavailable authentication.
- Never convert visible browser behavior alone into a pass when the action call
  reports an uncertain result; reconcile first.
- A final report must list every completed step, skipped gate, exact failure,
  final URL or artifact identity, checklist or saved state, relevant observation
  and action identifiers, download evidence, and final screenshots.

## Acceptance decision

Phase 5 closes only after the Master Engineering Agent independently reviews
the live evidence and the final automated baseline. An execution task may
prepare the report and evidence, but it does not accept its own work.
