# F4 Acceptance Report

## Summary

F4 is implemented but acceptance remains environment-gated until the full required runtime matrix is measured. The current branch now records the implementation decisions, exposes a browser runtime capability object, runs raw browser-platform compatibility, and adds Rove-runtime compatibility coverage through the production browser session path.

## Current Verified Environment

- OS: Windows x64
- Browser: Playwright Chromium
- Mode: headless
- Profile coverage: temporary and Rove-managed persistent
- Manual connector coverage: downloads, dialogs, popups, persistent login, profile locking, permissions, iframes, SPA history/timers, large pages, file chooser, Cache Storage, service workers, PDF viewing, and real-site smoke testing

## Required Matrix Status

| Environment | Status |
| --- | --- |
| Windows + Chromium + headless | PASS |
| Windows + Chrome + headed | UNVERIFIED |
| macOS + Chrome + headed + temporary | UNVERIFIED |
| macOS + Chrome + headed + persistent | UNVERIFIED |
| macOS + Chromium + headed + temporary | UNVERIFIED |
| macOS + Chromium + headless + temporary | UNVERIFIED |
| Linux + Chromium + headed | UNVERIFIED |
| Linux + Chromium + headless | UNVERIFIED |
| Docker + Chromium + headless | UNVERIFIED |

Unverified entries must remain unclaimed until a compatibility report is produced in that environment.

## Compatibility Commands

Final closure should run and attach outputs for:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm browser:doctor
pnpm browser:compat
pnpm browser:soak
```

`pnpm browser:compat` now includes both browser-platform checks and Rove-runtime-path checks. `pnpm browser:soak` defaults to a 30-minute browser session and can be shortened with `--duration-ms=<ms>` for local smoke runs.

## Known Limitations

- Sandbox status remains `unknown` unless `browser:doctor` observes a recognized Chromium sandbox signal.
- WebSocket live-message exchange remains limited in the compatibility harness.
- Page crash behavior is reported as observed or unverified depending on whether `chrome://crash` is reproducible in the runtime.
- Clipboard write may be allowed after a user gesture; clipboard read must not be silently exposed.
- W3Schools Tryit download behavior did not expose Rove download evidence in real-site testing, while controlled native downloads did. Treat this as site-specific unless a general missed browser download event is reproduced.

## Manual Fixture Location

Manual test pages live under:

```text
docs/hardening/runtime/manual-fixtures/
```

They are for acceptance reproduction, not production runtime code.
