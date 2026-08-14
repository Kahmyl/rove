# Browser Runtime Contract

## Summary

This document defines the initial F4 browser runtime contract for Rove. It is the source of truth for what Rove intends to support, what is intentionally unsupported, and what must remain experimental until diagnostics and compatibility fixtures prove otherwise.

F4 is about browser runtime fidelity and compatibility. It is not about hiding automation, defeating bot-detection systems, bypassing access restrictions, solving CAPTCHAs, or making Rove indistinguishable from every possible Chrome installation.

## Contract Status

This is the initial compatibility specification. It freezes the contract Rove should measure against before browser launch behavior is refactored.

Feature statuses use this taxonomy:

- `SUPPORTED`: Rove intends to support this behavior and must have deterministic compatibility coverage before F4 is complete.
- `SUPPORTED WITH LIMITATIONS`: Rove intends to support this behavior only under documented constraints.
- `EXPERIMENTAL`: The behavior exists in the protocol, product surface, or implementation, but F4 has not proven it safe and predictable.
- `UNSUPPORTED`: Rove does not claim support for this behavior.

No status in this document is evidence by itself. `SUPPORTED` means the behavior belongs in the F4 acceptance matrix and must be verified before the work is considered complete.

## F4 Ownership

F4 owns:

- browser binary selection;
- browser launch policy;
- sandbox configuration;
- temporary browser contexts;
- Rove-managed persistent profiles;
- browser-profile lifecycle;
- profile locking;
- Chrome and Chromium compatibility;
- headed and headless behavior;
- browser and context lifecycle;
- cookies, localStorage, sessionStorage, IndexedDB, Cache Storage, and service workers;
- permissions;
- downloads;
- popups, tabs, and dialogs;
- browser crashes, unexpected browser closure, restart behavior, and long-running sessions;
- OS-specific browser behavior;
- browser diagnostics;
- browser capability reporting;
- deterministic browser compatibility testing.
- browser-runtime frame plumbing needed for iframe compatibility, including frame enumeration, frame-visible text, frame target registration, and frame-aware target resolution.

F4 does not own:

- page-state classification;
- CAPTCHA detection;
- interstitial interpretation;
- browser-perception evidence fusion;
- semantic target ranking, target labeling heuristics, or cross-source perception scoring;
- automatic handoff decisions;
- ownership fencing;
- MCP reasoning;
- agent planning.

F4 exposes browser facts and runtime capabilities. Other tracks decide what those facts mean.

Frame support boundary: F4 owns whether the browser runtime can see frames and route an already-inspected target back to the frame where it was discovered. F1 owns the quality and meaning of the semantic inspection results produced from those browser facts.

## Supported Runtime Classes

### Runtime A: Desktop Interactive

Primary real-user browser configuration.

Status: `SUPPORTED`

Contract:

- Browser distribution: system Google Chrome preferred; bundled Playwright Chromium fallback.
- Mode: headed.
- Sandbox: enabled where the desktop platform supports it.
- Profile: temporary or Rove-managed persistent.
- Platform: macOS, Linux, and Windows after platform validation.
- Human interaction: available.

Limitations:

- Windows remains `UNVERIFIED` until the deterministic compatibility suite runs on Windows.
- System Chrome support depends on Playwright being able to resolve and launch the installed Chrome channel.
- F4 does not guarantee that third-party sites will permit automation.

### Runtime B: Local Headless

Automation and local test configuration where no human takeover is expected.

Status: `SUPPORTED WITH LIMITATIONS`

Contract:

- Browser distribution: supported Chromium or Chrome configuration.
- Mode: headless.
- Sandbox: enabled where the platform/runtime permits.
- Profile: temporary or Rove-managed persistent.
- Human interaction: unavailable.

Limitations:

- Headless behavior may differ from headed behavior. Differences must be documented rather than hidden.
- Human handoff requires headed operation and is not a capability of this runtime class.

### Runtime C: Container

CI and server integration test configuration.

Status: `SUPPORTED WITH LIMITATIONS`

Contract:

- Browser distribution: Chromium.
- Mode: headless unless a container display environment is explicitly configured.
- Sandbox: enabled where container OS capabilities support it.
- Profile: temporary or Rove-managed persistent using an explicitly configured writable filesystem location.
- Human interaction: unavailable.

Limitations:

- Container browser setup must be documented separately in `docs/hardening/runtime/container-browser.md`.
- Desktop security defaults must not be weakened to satisfy Docker constraints.
- Container limitations are compatibility exceptions, not implicit desktop policy.

## Profile Modes

### Temporary Profile

Status: `SUPPORTED`

Rove launches an isolated browser context whose storage disappears when the session/context is destroyed.

F4 must verify:

- cookies do not leak between temporary sessions;
- localStorage does not leak between temporary sessions;
- sessionStorage does not leak between temporary sessions;
- IndexedDB does not leak between temporary sessions;
- Cache Storage does not leak between temporary sessions;
- service-worker registrations do not leak between temporary sessions;
- temporary profile directories owned by Rove are cleaned up after close.

### Rove-Managed Persistent Profile

Status: `SUPPORTED`

Rove owns persistent profiles below:

```text
.rove/profiles/<profile-name>/
```

Each persistent profile must have Rove metadata outside Chrome internals:

```text
profile.json
```

The metadata should describe Rove ownership and lifecycle, for example:

```json
{
  "name": "default",
  "createdAt": "2026-08-12T00:00:00.000Z",
  "lastUsedAt": "2026-08-12T00:00:00.000Z",
  "browserDistribution": "chrome"
}
```

F4 must verify persistence across browser restart for:

- cookies;
- localStorage;
- IndexedDB;
- service-worker registration and expected activation state;
- Cache Storage where applicable.

Rove must not manually edit Chrome internal preference files unless an experiment proves the need.

### Existing User Chrome Profile

Status: `UNSUPPORTED`

The protocol contains an `existing` profile mode, but ordinary user Chrome profiles are not supported for F4 production use.

Rove must not:

- copy or mutate Chrome's ordinary user profile behind the user's back;
- bypass Chrome profile locking;
- launch two writable browser instances against the same user-data directory;
- take over an already-running Chrome profile;
- copy credential databases as an implementation shortcut.

F4 records the current decision in `docs/hardening/runtime/existing-profile-decision.md`: ordinary user Chrome profiles are unsupported because they are not sufficiently safe or reliable to attach to, copy, mutate, or unlock implicitly.

A future workflow may support a dedicated Chrome profile that the user explicitly creates or selects for Rove, but that would require a separate design and consent path.

## Browser Binary Policy

| Dimension | Status | Contract |
| --- | --- | --- |
| System Google Chrome stable | `SUPPORTED WITH LIMITATIONS` | Preferred desktop distribution if launch, compatibility, persistence, and lifecycle behavior are verified. |
| Bundled Playwright Chromium | `SUPPORTED` | Fallback and primary deterministic test distribution. |
| Explicit executable path | `SUPPORTED WITH LIMITATIONS` | Advanced configuration. Diagnostics must report that the runtime was modified by caller-supplied browser selection. |
| Chrome beta/dev/canary channels | `EXPERIMENTAL` | No support claim until version/channel compatibility is measured. |
| Non-Chromium browsers | `UNSUPPORTED` | F4 only covers Chromium-family browser runtimes. |

Rove must capture at session startup:

- Playwright version;
- browser distribution;
- browser version;
- headed or headless mode;
- profile mode;
- sandbox status when knowable;
- whether custom launch arguments or executable paths were supplied.

Browser versions should be classified as:

- `tested`;
- `untested`;
- `known-incompatible`.

Rove should not reject newer browser versions solely because they differ from the tested matrix, but diagnostics must make the status visible.

## Launch Arguments Policy

Default contract:

```text
no custom Chromium arguments
```

Exceptions must be classified as:

- required by Rove;
- required by platform;
- required by controlled test environment;
- user supplied.

Every launch argument must have:

- a documented reason;
- a reproduction or compatibility/security requirement;
- test coverage or a diagnostic entry.

Rove must not maintain a list of browser-authenticity, stealth, or bot-detection bypass flags.

User-provided launch arguments are advanced configuration and must not silently alter Rove's compatibility guarantees. Diagnostics must report that the runtime was modified by custom browser arguments.

## Sandbox Policy

| Environment | Status | Contract |
| --- | --- | --- |
| Desktop macOS | `SUPPORTED WITH LIMITATIONS` | Sandbox expected where Chromium exposes and supports it. |
| Desktop Linux | `SUPPORTED WITH LIMITATIONS` | Sandbox expected where OS capabilities allow it. |
| Desktop Windows | `EXPERIMENTAL` | Must be validated before support is claimed. |
| Container Linux | `SUPPORTED WITH LIMITATIONS` | Sandbox expected where container configuration supports required OS capabilities. |

Rove must not silently disable sandboxing after launch failure. If a configured environment cannot satisfy the required sandbox policy, Rove must fail with a structured diagnostic explaining the mismatch.

## Feature Compatibility Matrix

| Feature | Status | Contract |
| --- | --- | --- |
| Browser binary selection | `SUPPORTED` | Resolve Chrome or Chromium deliberately and report requested vs resolved distribution. |
| Chrome channel | `SUPPORTED WITH LIMITATIONS` | Chrome stable is preferred for desktop only after compatibility measurement. |
| Chromium | `SUPPORTED` | Bundled Playwright Chromium is required for deterministic compatibility coverage. |
| Headed mode | `SUPPORTED` | Required for desktop interactive and human handoff. |
| Headless mode | `SUPPORTED WITH LIMITATIONS` | Required for local automation and CI, with documented differences from headed mode. |
| Temporary profile | `SUPPORTED` | Storage must be isolated and cleaned after session close. |
| Persistent profile | `SUPPORTED` | Rove-managed persistent state must survive restart as specified. |
| Existing profile | `EXPERIMENTAL` | Unsupported for ordinary Chrome profiles until the research gate resolves. |
| Cookies | `SUPPORTED` | Must isolate in temporary profiles and persist in persistent profiles. |
| localStorage | `SUPPORTED` | Must isolate in temporary profiles and persist in persistent profiles. |
| sessionStorage | `SUPPORTED WITH LIMITATIONS` | Must behave according to normal browser session semantics. |
| IndexedDB | `SUPPORTED` | Must isolate in temporary profiles and persist in persistent profiles. |
| Cache Storage | `SUPPORTED WITH LIMITATIONS` | Must be verified separately from service-worker registration. |
| Service workers | `SUPPORTED` | Must be allowed in normal runtimes and verified across reload and persistent restart. |
| Downloads | `SUPPORTED WITH LIMITATIONS` | Must use bounded Rove-managed directories and sanitized filenames. |
| Popups | `SUPPORTED` | Popup pages must be tracked as browser pages without breaking session lifecycle. |
| Tabs | `SUPPORTED` | Multiple tabs must be tracked with stable Rove page identities. |
| Dialogs | `SUPPORTED WITH LIMITATIONS` | Dialogs must not deadlock Rove indefinitely. User-significant dialogs must not be globally auto-accepted. |
| Permissions | `SUPPORTED WITH LIMITATIONS` | Default browser permission behavior. Future grants must be origin-scoped and explicit. |
| Clipboard | `SUPPORTED WITH LIMITATIONS` | Must not be silently elevated. Support depends on browser mode and permissions. |
| Geolocation | `SUPPORTED WITH LIMITATIONS` | Must not be silently granted. Explicit origin-scoped management may be added later. |
| Camera and microphone requests | `SUPPORTED WITH LIMITATIONS` | Must not be silently granted. Behavior must be reported through runtime fixtures. |
| File chooser | `SUPPORTED WITH LIMITATIONS` | Must be fixture-tested before external support claims expand. |
| Browser restart | `SUPPORTED` | Persistent profile state and profile locks must behave deterministically. |
| Browser crash | `SUPPORTED WITH LIMITATIONS` | Disconnect must transition to structured Rove behavior, and locks must eventually release safely. |
| Profile lock | `SUPPORTED` | One writable Rove browser process per persistent profile. |
| Network offline | `SUPPORTED WITH LIMITATIONS` | Must be tested for service-worker offline cached response behavior. |
| Proxy if configured | `EXPERIMENTAL` | Advanced configuration until compatibility and diagnostics are specified. |
| Multiple sessions | `SUPPORTED WITH LIMITATIONS` | Supported when profiles and runtime ownership remain isolated. Concurrent writable use of one persistent profile is not allowed. |

## Diagnostics Contract

`pnpm browser:doctor` must report browser-runtime facts without exposing secrets.

Diagnostics must distinguish:

- requested configuration;
- resolved configuration;
- verified runtime behavior.

At minimum, diagnostics should report:

- platform and architecture;
- Playwright version;
- requested browser;
- resolved browser;
- browser version;
- headed or headless;
- profile mode;
- profile directory for Rove-managed profiles without exposing secrets;
- sandbox status as enabled, disabled, or unknown;
- viewport;
- service-worker support;
- persistent storage verification when requested;
- downloads verification;
- custom executable path or launch arguments when supplied.

Diagnostics must not reveal:

- cookies;
- tokens;
- localStorage values;
- IndexedDB values;
- credential databases;
- secret-bearing URLs;
- raw typed values.

## Compatibility Test Contract

`pnpm browser:compat` must run deterministic browser-runtime fixtures appropriate to the current machine.

The fixture suite must verify browser capabilities, not semantic page classification.

Required fixture categories:

- launch and close;
- navigation;
- cookies;
- localStorage;
- sessionStorage;
- IndexedDB;
- Cache Storage;
- service-worker registration and activation;
- service-worker persistent restart behavior;
- popup;
- multiple tabs;
- JavaScript `alert`, `confirm`, `prompt`, and `beforeunload`;
- download, duplicate filename, cancellation, large bounded download, and browser-close-during-download behavior;
- file chooser where supported;
- clipboard permissions where supported;
- geolocation permission behavior;
- notification permission behavior;
- camera and microphone request behavior;
- cross-origin iframe;
- same-origin iframe;
- WebSocket;
- history navigation;
- SPA navigation;
- large page;
- long-running timer;
- page crash where reproducible;
- browser disconnect simulation.

Compatibility results must use this taxonomy:

- `PASS`;
- `PASS_WITH_LIMITATION`;
- `FAIL_ROVE`;
- `SITE_RESTRICTION`;
- `UNSUPPORTED_CONFIGURATION`;
- `UNVERIFIED`.

## Baseline Requirement

Before modifying browser launch behavior, F4 must capture the current baseline in:

```text
docs/hardening/runtime/baseline-results.json
docs/hardening/runtime/baseline-analysis.md
```

The baseline must record, where available:

- launch success;
- sandbox state;
- browser version;
- profile persistence;
- storage persistence;
- service-worker behavior;
- popup behavior;
- download behavior;
- dialog behavior;
- browser shutdown;
- crash behavior.

Minimum baseline matrix:

- macOS, Chrome, headed, temporary;
- macOS, Chrome, headed, persistent;
- macOS, Chromium, headed, temporary;
- macOS, Chromium, headless, temporary;
- Linux, Chromium, headed where available;
- Linux, Chromium, headless;
- Docker, Chromium, headless;
- Windows when a validation environment is available.

## Security Contract

F4 must verify:

- sandbox configuration is intentional;
- temporary profiles do not leak state between sessions;
- persistent profiles are isolated by profile name;
- profile names cannot escape Rove's configured home through path traversal;
- profile locks cannot be trivially bypassed;
- downloads remain inside managed directories;
- browser diagnostics never reveal cookies or tokens;
- custom launch arguments are treated as advanced and untrusted configuration;
- no secret values appear in logs.

## Parallel Work Boundary

F4 must not modify these areas unless a minimal shared protocol change is explicitly coordinated:

- `packages/browser/src/inspection/`;
- `packages/browser/src/safety/page-state-classifier.ts`;
- `packages/browser/src/safety/page-state-classifier.test.ts`;
- future perception modules;
- `PageStateAssessment` semantics.

F4 should avoid rewriting `PlaywrightBrowserSession` unless required for browser launch, profile lifecycle, runtime diagnostics, or browser ownership.

## Definition Of Done

F4 is complete when:

- this runtime contract is implemented and kept current;
- the current runtime behavior has a frozen baseline;
- browser launch configuration contains no unexplained flags;
- sandbox behavior is deliberate and verified;
- temporary profiles are isolated;
- Rove-managed persistent profiles survive restart correctly;
- profile locking works;
- existing-profile support has an evidence-backed decision;
- Chrome and Chromium selection has an explicit policy;
- headed and headless differences are documented;
- cookies, localStorage, IndexedDB, Cache Storage, and service workers are tested;
- tabs and popups work;
- downloads behave safely;
- dialogs cannot deadlock Rove indefinitely;
- browser crash and disconnect behavior is structured Rove behavior;
- long-running sessions do not show unacceptable resource leakage;
- Docker has a separately documented runtime policy;
- compatibility results distinguish Rove failures from site restrictions;
- `pnpm browser:doctor` works;
- `pnpm browser:compat` works;
- the deterministic compatibility matrix passes;
- `docs/adr/ADR-browser-runtime-v2.md` is approved;
- lint, typecheck, test, and build pass;
- F1-owned code is not coupled into the F4 implementation.
