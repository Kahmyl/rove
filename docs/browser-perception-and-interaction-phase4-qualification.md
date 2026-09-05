# Phase 4 Browser-Following Surface Qualification

## Decision

**ADOPT**

Date: 2026-09-05

Phase 4 delivers the compact native browser-following control surface while
preserving the existing full Companion, browser ownership, and interaction
authority boundaries.

## Repository state qualified

The work was qualified on branch `feature/browser-perception-interaction`,
starting from committed HEAD `43ac2cc5fc2998f944863a7083a82151a1b2c28c` and
the intentional Phase 4 handoff changes. The qualified implementation is commit
`5cb02afcd8ee00a5d5ae0a7b092585a39eb48790`. Recovery copies of both tracked
and untracked handoff state were created under `/private/tmp` before
modification.

No qualification credentials or disposable native helpers are part of the
repository.

## Final architecture

The production geometry path is:

```text
exact Rove-owned Chrome process
  -> loopback CDP Browser window state
  -> BrowserWindowState
  -> Electron screen display topology
  -> BrowserFollowController
  -> CompactFollowerSurface
```

CDP remains the browser bounds and state authority. Electron supplies only
display bounds and work areas. The controller retains its 100 ms reconciliation
interval, 500 ms freshness deadline, generation fencing, single in-flight
request, fail-closed behavior, and right/left/overlay placement priority.

No page UI injection, title-based browser discovery, durable PID authority,
platform-specific production geometry tracker, OCR, or alternate browser
interaction authority was introduced.

The existing 750 ms session monitor continues to own session discovery, tray
state, handoff attention, and Capture signals. The follower consumes
main-process session memory and never polls Runtime independently.

## Maximized-window remediation

Live inspection proved that maximized Chrome still returned valid CDP state and
that the controller computed the expected top-right overlay. The native
follower existed at the correct `240 x 96` bounds, but macOS placed it behind
the maximized Chrome window.

The compact surface now receives the controller's placement classification.
For overlay placement only, it performs a transient floating-level lift around
`showInactive`, then immediately removes always-on-top. Right and left
placement never request the lift. This kept the follower above maximized Chrome
without making it globally pinned or stealing browser document focus.

Observed maximized macOS result:

- browser: `x=0, y=33, width=1512, height=893`, state `maximized`;
- follower: `x=1262, y=43, width=240, height=96`;
- follower native z-order ahead of Chrome after the scoped lift;
- permanent always-on-top disabled.

## Surface product behavior

The follower uses the shared renderer with `surface=follower` and starts
collapsed at `240 x 96`. Expanded mode is `360 x 240`. Renderer IPC requests
only the semantic collapsed/expanded state; main process owns both legal sizes,
revokes the previous placement, and requires a fresh controller decision.

The renderer covers agent-working, human-required, human-controlling, paused,
and ready-for-review presentations. Available actions are Take Control, Return
Control or Resume, Pause, Stop, Open Rove, Expand, and Collapse according to
session state.

Full Companion visibility suppresses the follower. Closing or hiding the full
surface permits the follower to return only after a fresh controller decision.
Tray, activation, second-instance, Capture, and Open Rove retain the full
Companion as their intentional focus-taking surface.

## Pause and Stop semantics

Pause is a real ownership transition, not an alias for Take Control. Runtime
drains the current agent transition, clears agent control and handoff authority,
completes the ownership fence with no controller, and records the session as
`paused`. Agent browser mutation is rejected while paused. Resume uses the
existing return-to-agent transition, invalidates stale targets and inspection
state, and restores agent control behind the existing fencing rules.

Stop reuses the existing end-session authority. It marks the session completed,
clears the controller, terminates the owned browser, and hides the follower.

## macOS live qualification

The macOS run used real Runtime, Electron Companion, headed system Google
Chrome, and the exact Rove-owned Chrome PID from `/browser/host`.

| Behavior                         | Result                        | Evidence                                                                                                                                 |
| -------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Startup/full Companion hidden    | Pass                          | No native full window opened before intentional restore                                                                                  |
| Exact owned-browser identity     | Pass                          | Runtime exposed the launched Chrome PID; no title identity used                                                                          |
| Normal right placement           | Pass                          | Browser `22,55,1200,851`; follower `1232,55,240,96`                                                                                      |
| Left placement                   | Pass                          | Browser moved to `x=600,width=800`; follower converged to `x=350`                                                                        |
| Move and resize convergence      | Pass                          | Fresh CDP bounds produced stable new placements without focus-taking show                                                                |
| Maximized overlay                | Pass                          | Scoped z-order remediation kept the `240 x 96` overlay visible                                                                           |
| Minimized                        | Pass                          | CDP state `minimized`; follower hidden                                                                                                   |
| Fullscreen                       | Pass                          | CDP state `fullscreen`; follower hidden fail-closed                                                                                      |
| Full Companion arbitration       | Pass                          | Open Rove suppressed follower; close restored it after a fresh poll                                                                      |
| Collapsed/expanded               | Pass                          | Native bounds changed `240 x 96 -> 360 x 240 -> 240 x 96`                                                                                |
| Pause/resume                     | Pass                          | Paused controller cleared; agent navigation rejected; Resume restored agent                                                              |
| Stop/browser loss                | Pass                          | Session completed, owned Chrome exited, follower hidden                                                                                  |
| New-PID reassociation            | Pass                          | New session used a different exact owned PID; follower tracked only the new process                                                      |
| Tracking/display failure policy  | Pass (automated)              | Missing, stale, invalid, zero-intersection, and ambiguous state hide fail-closed                                                         |
| Foreground/follower focus policy | Pass (automated); live caveat | Controller hides on `documentFocused=false` and exempts follower focus; synthetic native app activation did not make Chrome report false |

The live foreground caveat is recorded rather than overstated: on both macOS
and the Xvfb host, Chrome's `document.hasFocus()` remained true during a
qualification-only switch to another native application. The follower's
overlay lift was already removed, so it was not globally pinned, but an
explicit live `browser_not_foreground` hide transition was not observed. The
controller policy and follower-focus exception are covered by automated tests.

## Linux qualification

An x86_64 Ubuntu 22.04 container under emulation ran the current unpacked Linux
desktop package with Xvfb, Openbox, system Google Chrome 152, real Electron, and
real Runtime. `xdotool` and `wmctrl` were used only as disposable qualification
instrumentation.

| Behavior                         | Result       | Evidence                                                                  |
| -------------------------------- | ------------ | ------------------------------------------------------------------------- |
| Linux x64 unpacked package       | Pass         | electron-builder produced `linux-unpacked`                                |
| Packaged desktop/Runtime startup | Pass         | Packaged Electron launched its managed Runtime and resolved system Chrome |
| Normal right placement           | Pass         | Browser `10,10,1050,880`; follower `1070,10,240,96`                       |
| Move/resize right placement      | Pass         | Browser `200,80,900,650`; follower `1110,80,240,96`                       |
| Left fallback                    | Pass         | Browser `600,120,900,650`; follower `350,120,240,96`                      |
| Maximized overlay                | Pass         | Browser `0,0,1600,900`; follower `1350,10,240,96`                         |
| Minimized hide                   | Pass         | CDP state `minimized`; follower absent from visible X11 windows           |
| Fullscreen hide                  | Pass         | Native F11 produced CDP `fullscreen`; follower absent                     |
| Wayland live runtime             | Not executed | No Wayland compositor/session was available                               |

The container required a qualification-only relaxed Docker seccomp profile for
Chrome namespaces. Chrome reported its sandbox disabled in that emulated
container, so this run qualifies desktop/follower behavior, not Linux sandbox
hardening.

## Windows qualification

| Behavior                                 | Result       |
| ---------------------------------------- | ------------ |
| Common TypeScript/controller path        | Pass         |
| No Darwin-only dependency in common path | Pass         |
| Windows x64 unpacked package             | Pass         |
| Packaged resource/static resolution      | Pass         |
| Native Windows desktop live execution    | Not executed |

No Windows VM, Wine environment, UTM, QEMU Windows guest, Parallels, VMware, or
repository-supported remote Windows runner was available on the host. Windows
live behavior is therefore not claimed as a pass.

## Display topology

Automated tests cover positive and negative display coordinates, right/left and
overlay selection, work-area constraints, display transitions, invalid
geometry, zero intersection, and equal-intersection ambiguity.

The macOS host reported one physical display (`1512 x 982`, work area
`1512 x 895`). Physical multi-monitor behavior was not executed and is not
recorded as a pass.

## Packaging and regression results

The production Companion build includes both renderer modes, preload IPC, and
the semantic follower-size path. Desktop staging now verifies the deployed
browser package's actual module-resolution context, which is compatible with
pnpm's isolated deployed dependency layout.

Qualification results:

- TypeScript workspace typecheck: pass;
- repository lint: pass;
- full repository suite: 107 files, 611 tests passed;
- Companion production build: pass;
- macOS arm64 unpacked desktop package: pass;
- packaged macOS Runtime/MCP smoke test: pass;
- Windows x64 unpacked desktop package: pass (static/package only);
- Linux x64 unpacked desktop package: pass;
- Linux/X11 packaged live run: pass.

## External qualification gaps

The following require environments or hardware absent from the qualification
host:

- native Windows desktop live execution;
- Linux/Wayland desktop live execution;
- physical multi-monitor execution.

No unexecuted platform or hardware path is labeled as a pass.
