# Browser Runtime Baseline Analysis

## Summary

This baseline captures the current browser runtime behavior before F4 refactors browser launch policy, sandbox handling, profile ownership, or lifecycle management.

The available validation environment for this slice was:

```text
Windows x64
Node v24.13.0
Playwright 1.62.1
Playwright Chromium 151.0.7922.34
Headless
Temporary and persistent profile fixtures
```

The current-machine baseline passed the deterministic Chromium/headless checks that exist today, with one important limitation: native Chromium allowed a second writable launch against the same persistent profile directory. This confirms the F4 plan's requirement for explicit Rove-level profile locking.

## Captured Results

`browser:doctor` reported:

- launch: `PASS`;
- page creation: `PASS`;
- service workers: `PASS`;
- sandbox: `UNVERIFIED`;
- persistent storage: `UNVERIFIED` in doctor because the default doctor run used a temporary profile;
- downloads: `UNVERIFIED` in doctor.

`browser:compat` now reports:

- temporary launch and navigation: `PASS`;
- temporary storage isolation: `PASS`;
- service-worker registration: `PASS`;
- popup handling: `PASS`;
- dialog handling: `PASS`;
- download handling, cancellation, bounded large download, and browser-close-during-download: `PASS`;
- file chooser: `PASS`;
- permission defaults: `PASS`;
- Cache Storage: `PASS`;
- same-origin and cross-origin iframes: `PASS`;
- WebSocket API availability: `PASS_WITH_LIMITATION`;
- SPA history and long timer: `PASS`;
- large page: `PASS`;
- page crash observation: `PASS_WITH_LIMITATION` or `UNVERIFIED` depending on runtime reproducibility;
- browser disconnect: `PASS`;
- persistent profile restart: `PASS`;
- persistent profile native lock behavior: `PASS_WITH_LIMITATION`.

## What This Means

The current browser runtime can launch Playwright Chromium in headless mode on Windows and exercise normal browser capabilities through deterministic local fixtures.

Temporary browser contexts currently isolate:

- cookies;
- localStorage;
- IndexedDB.

Persistent browser profiles currently retain across restart:

- persistent cookies;
- localStorage;
- IndexedDB;
- service-worker registration state.

Dialogs can be observed and dismissed by the harness without deadlocking the runtime.

Popups can open and load as independent browser pages.

Downloads are saved through Rove-managed directories, including duplicate, cancellation, bounded large download, and context-close interruption coverage.

Default permissions are not silently granted for geolocation, notifications, clipboard-read, camera, or microphone in the measured runtime.

Cache Storage, iframes, SPA history, long timers, large pages, and browser disconnect behavior now have deterministic fixture coverage. WebSocket live-message exchange remains a harness limitation, but API availability is reported.

## Important Limitation

The persistent-profile native lock check produced:

```text
PASS_WITH_LIMITATION
```

The browser allowed two writable persistent contexts to launch against the same profile directory in this environment. Rove must not rely on Chrome or Playwright alone to protect persistent profile ownership.

Required F4 follow-up:

- implement Rove-level profile locking;
- enforce one writable Rove browser process per persistent profile;
- return a structured `PROFILE_LOCKED` error when a profile is already owned;
- release locks deterministically during clean shutdown and crash recovery.

## Unverified Required Matrix

These plan-required environments remain unverified:

- macOS + Chrome + headed + temporary;
- macOS + Chrome + headed + persistent;
- macOS + Chromium + headed + temporary;
- macOS + Chromium + headless + temporary;
- Linux + Chromium + headed where available;
- Linux + Chromium + headless;
- Docker + Chromium + headless;
- Windows + Chrome + headed.

They must stay marked as `UNVERIFIED` until measured.

## Current Gaps

The current baseline does not yet verify:

- sandbox state;
- headed/headless parity;
- Chrome stable behavior;
- Docker runtime behavior;
- OS-specific macOS or Linux behavior.

Page crash remains runtime-sensitive and may report `UNVERIFIED` where `chrome://crash` is not reproducible.

## Decision Pressure Created By This Baseline

This baseline supports the next F4 implementation priorities:

1. Add explicit Rove-managed profile ownership and metadata.
2. Implement Rove-level profile locking.
3. Extend diagnostics so `browser:doctor` can run persistent-profile verification directly.
4. Add sandbox verification rather than reporting sandbox state as unknown.
5. Add structured compatibility output suitable for accumulating cross-platform baseline results.
