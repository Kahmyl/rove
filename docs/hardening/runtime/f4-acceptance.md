# F4 Acceptance

## Summary

F4 is engineering-complete for the verified local environment. Additional operating-system and browser certifications remain pending until those environments are actually run.

Final classification:

```text
F4 Engineering Complete; additional environment certifications pending.
```

## Recorded Environment

| Field | Value |
| --- | --- |
| Branch | `feat/browser-runtime-fidelity-and-compatibility` |
| Commit | `28fd407e0a700ccf4e52ba2673c017aa247c98c0` |
| Date | 2026-08-15 |
| OS / arch | Windows x64 |
| Node | v24.13.0 |
| Playwright | 1.62.1 |
| Browser distribution | Playwright Chromium |
| Browser version | 151.0.7922.34 |
| Mode | headless |
| Profile modes tested | temporary, Rove-managed persistent |
| Sandbox result | runtime-probed; `enabled`, `disabled`, or `unknown` depending on `chrome://sandbox` signal |

## Acceptance Table

| Criterion | Status | Evidence |
| --- | --- | --- |
| Explicit launch planning | PASS | `resolveBrowserLaunchPlan`, `browser:doctor` |
| Runtime capability object | PASS | protocol schema, runtime integration test |
| Runtime-derived browser version | PASS | `BrowserSession.capabilities.browserVersion` from launched browser |
| Temporary profile | PASS | `browser:compat`, engine test |
| Persistent profile | PASS | `browser:compat`, runtime tests |
| Persistent storage | PASS | compatibility fixture restart |
| Profile locking | PASS | Rove profile lock tests, `browser:compat` |
| Stale-lock behavior | PASS | profile lock tests |
| Existing Chrome profile policy | PASS | ADR and runtime contract mark unsupported |
| Managed downloads | PASS | `browser:compat`, managed download tests |
| Service workers | PASS | compatibility fixture |
| Cookies | PASS | persistent restart fixture |
| localStorage | PASS | persistent restart fixture |
| IndexedDB | PASS | persistent restart fixture |
| Tabs/popups | PASS | compatibility fixture |
| Dialog behavior | PASS | compatibility fixture |
| Frame plumbing | PASS | iframe inspection/runtime test |
| Sandbox status | PASS_WITH_LIMITATION | runtime probe reports `enabled`, `disabled`, or `unknown`; never inferred from launch args alone |
| 30-minute soak | PASS | 354 iterations, bounded memory |
| Resource cleanup | PASS | soak cleanup: session and fixture closed |
| F1/F4 boundary | PASS | ADR and runtime contract |
| Repository quality gates | PASS | lint, typecheck, test, build, doctor, compat, soak, diff-check |
| Windows Chromium headless | VERIFIED | actual run |
| Windows Chrome headed | UNVERIFIED | environment not run |
| macOS Chrome headed | UNVERIFIED | environment not run |
| macOS Chromium headed | UNVERIFIED | environment not run |
| Linux Chromium | UNVERIFIED | environment not run |
| Docker Chromium headless | UNVERIFIED | environment not run |

## Soak Evidence

```text
command: pnpm browser:soak
duration: 30 minutes
iterations: 354
memory: bounded; start RSS 150,454,272; end RSS 134,086,656; max RSS 165,666,816
session cleanup: passed
fixture cleanup: passed
```

This soak remains valid unless browser launch, shutdown, profile locking, download lifecycle, context shutdown, or cleanup behavior changes.

## Environment Certification

`VERIFIED` means the lane was actually run. `UNVERIFIED` means no claim is made because the environment was unavailable in this closure session.

| Environment | Status |
| --- | --- |
| Windows x64 + Playwright Chromium + headless | VERIFIED |
| Windows + Chrome + headed | UNVERIFIED |
| macOS + Chrome + headed + temporary | UNVERIFIED |
| macOS + Chrome + headed + persistent | UNVERIFIED |
| macOS + Chromium + headed + temporary | UNVERIFIED |
| macOS + Chromium + headless + temporary | UNVERIFIED |
| Linux + Chromium + headed | UNVERIFIED |
| Linux + Chromium + headless | UNVERIFIED |
| Docker + Chromium + headless | UNVERIFIED |

## Manual Fixtures

Manual acceptance fixtures live in:

```text
docs/hardening/runtime/manual-fixtures/
```

These fixtures are acceptance aids, not production runtime artifacts.
