# Phase 4 Browser-Following Surface Qualification

## Decision

**ADOPT**

Date: 2026-09-05

Phase 4 delivers the compact native browser-following control surface while
preserving the existing full Companion, browser ownership, and interaction
authority boundaries.

This document was corrected after direct user acceptance testing on 2026-09-05.
The original qualification treated native fullscreen as an ineligible state
and recorded "fullscreen -> hidden" as a pass. That was the wrong product
requirement: Rove's control surface must remain immediately reachable in the
owned browser's fullscreen working context. The correction started from
`f0eb800f257396113dabcbf1115fa86402b34f9e` and does not rewrite the earlier
Phase 4 history.

A second direct-testing correction on the same date made the micro follower the
single collapsed presentation on every platform, moved its automatic anchor to
the browser's top-right interior, added main-process-validated semantic dragging,
and made exact native foreground-process arbitration part of the shared macOS,
Windows, and Linux/X11 design.

## Repository state qualified

The universal-micro correction was qualified on branch
`feature/browser-perception-interaction`, starting from committed HEAD
`bc7700566917fcfc534f0115b395b83a004c8790`. A recovery bundle and patch were
created under `/private/tmp` before modification. The final correction remains
a separate local commit in this branch's history.

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
request, and fail-closed behavior. Automatic placement is the browser's
top-right interior. A native user move may be retained anywhere inside a valid
display work area (and inside the owned fullscreen display while fullscreen);
the controller clamps it against authoritative Electron display topology.

No page UI injection, title-based browser discovery, durable PID authority,
platform-specific production geometry tracker, OCR, or alternate browser
interaction authority was introduced.

The existing 750 ms session monitor continues to own session discovery, tray
state, handoff attention, and Capture signals. The follower consumes
main-process session memory and never polls Runtime independently.

## Shared overlay and foreground policy

Because the micro follower now sits inside Chrome rather than beside it, the
surface uses floating level only for the lifetime of an eligible presentation.
Every reconciliation compares the Runtime's exact owned browser PID with the
native foreground window owner PID. Moving to another application, browser
window, or desktop hides the follower and immediately revokes elevation and
fullscreen-workspace visibility; returning to the owned browser requires a
fresh controller decision. Follower focus remains the sole exception so a user
can click, expand, and operate Rove without making it disappear.

The native PID source is shared through `get-windows`: NSWorkspace-backed on
macOS, Win32 on Windows, and `_NET_ACTIVE_WINDOW`/X11 on Linux. Linux Wayland is
unsupported by that authority and therefore fails closed instead of leaking a
global overlay.

## Surface product behavior

The follower uses the shared renderer with `surface=follower`. Windowed,
maximized, and fullscreen all default to the same deliberately small `64 x 56`
micro affordance and expand in place to `360 x 240`. The micro includes a
small, explicit expand icon; every other part of the micro surface starts a
semantic drag. In expanded mode, every non-action area is draggable while the
controls remain excluded. Renderer IPC requests only begin/update/end and
expand/collapse; it never sends coordinates. The main process samples the
native cursor, owns the legal display regions, validates/clamps movement, and
captures Electron's portable `move` event to retain user placement. On X11 a
non-focus-taking `dock` surface is repositioned while hidden and remapped once,
which keeps it above native fullscreen without reserving a desktop strut. The
controller requires
a fresh authoritative browser/display decision for every presentation
transition.

On macOS, the follower is created as Electron's documented `panel` window type,
which is capable of appearing above fullscreen applications. Its all-workspaces
behavior is explicitly disabled while not fullscreen. Only while the exact
Rove-owned browser reports authoritative CDP state `fullscreen`, the surface
enables `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true,
skipTransformProcessType: true })` and a floating level. Both are revoked on
fullscreen exit, browser loss, suppression, or disable. `panel` was necessary
in live testing: workspace visibility on a normal Electron window produced the
correct geometry but remained offscreen in the native Chrome Space.

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

| Behavior                         | Result           | Evidence                                                                                                                           |
| -------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Startup/full Companion hidden    | Pass             | No native full window opened before intentional restore                                                                            |
| Exact owned-browser identity     | Pass             | Runtime exposed the launched Chrome PID; no title identity used                                                                    |
| Universal windowed micro         | Pass             | Browser `22,55,1200,849`; `64 x 56` follower inside top-right at `1148,65`                                                        |
| Windowed expand/collapse         | Pass             | Real click changed `64 x 56 @ 1148,65` to `360 x 240 @ 852,65`, preserving the right edge                                         |
| Native user positioning          | Pass             | Windowed follower remained at user position `500,400`; invalid `-1000,-1000` was main-process-clamped to work-area `0,33`          |
| Maximized overlay                | Pass             | Shared eligible-lifetime elevation keeps the micro above owned Chrome and is revoked on background                                 |
| Minimized                        | Pass             | CDP state `minimized`; follower hidden                                                                                             |
| Native fullscreen micro          | Pass             | CDP `fullscreen` at `0,121,1512,861`; top-right `64 x 56` panel onscreen at `1438,131` in the Chrome fullscreen Space              |
| Fullscreen expand/collapse       | Pass             | Real click focused micro without leaving the Space; expanded at `1142,131,360,240`; collapse preserved a moved right-edge anchor   |
| Fullscreen user positioning      | Pass             | Expanded controls remained at user position `500,500`, inside the authoritative fullscreen region                                 |
| Other app/Space suppression      | Pass             | Terminal foreground hid the follower and revoked layer `3 -> 0`; returning to owned Chrome restored only from a fresh decision    |
| Fullscreen exit recovery         | Pass             | CDP returned `normal`; normal `64 x 56` mode resumed from its separately validated windowed position, not stale fullscreen geometry |
| Repeated fullscreen transitions  | Pass             | Prior repeated native cycles plus this top-right/drag correction produced no stranded or globally leaked follower                 |
| Full Companion arbitration       | Pass             | Open Rove suppressed follower; close restored it after a fresh poll                                                                |
| Collapsed/expanded               | Pass             | Native bounds changed `64 x 56 -> 360 x 240 -> 64 x 56`                                                                            |
| Pause/resume                     | Pass             | Paused controller cleared; agent navigation rejected; Resume restored agent                                                        |
| Stop/browser loss                | Pass             | Session completed, owned Chrome exited, follower hidden                                                                            |
| New-PID reassociation            | Pass             | New session used a different exact owned PID, reset to micro, and tracked only the new process                                     |
| Tracking/display failure policy  | Pass (automated) | Missing, stale, invalid, zero-intersection, and ambiguous state hide fail-closed                                                   |
| Foreground/follower focus policy | Pass             | Exact foreground PID hid on Terminal; real micro click retained follower focus and expanded in the same fullscreen Space          |

The browser-not-foreground policy remains fail closed and exact browser
identity is unchanged. The follower-focus exception is covered by automated
tests and by the live real-click fullscreen expansion above.

## Linux qualification

An x86_64 Ubuntu 22.04 container under emulation ran the current unpacked Linux
desktop package with Xvfb, Openbox, system Google Chrome 152, real Electron, and
real Runtime. `xdotool` and `wmctrl` were used only as disposable qualification
instrumentation.

| Behavior                         | Result       | Evidence                                                                                                         |
| -------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------- |
| Linux x64 unpacked package       | Pass         | electron-builder produced `linux-unpacked`                                                                       |
| Packaged desktop/Runtime startup | Pass         | Packaged Electron launched its managed Runtime and resolved system Chrome                                        |
| Windowed micro                   | Pass         | Browser `10,10,1050,880`; top-right follower `986,20,64,56`                                                       |
| Micro drag and expand            | Pass         | Full-surface drag moved to `671,260`; explicit icon expanded in place to `375,260,360,240`                        |
| Expanded non-action drag         | Pass         | Background drag moved expanded controls to `725,400`; action buttons remained clickable                          |
| Maximized overlay                | Pass         | Shared controller/elevation policy retained the `64 x 56` micro above owned Chrome                               |
| Minimized hide                   | Pass         | CDP state `minimized`; follower absent from visible X11 windows                                                  |
| True F11 fullscreen micro        | Pass         | Chrome `_NET_WM_STATE_FULLSCREEN`; `64 x 56` dock visible at top-right                                           |
| Fullscreen micro drag            | Pass         | Main-owned cursor tracking moved micro to `788,460`; it remained visible above fullscreen                        |
| Fullscreen expand/collapse       | Pass         | Explicit icon expanded; non-action background dragged; collapse restored micro                                  |
| Other-app suppression/recovery   | Pass         | `xmessage` foreground made the dock `IsUnMapped`; owned Chrome restored `IsViewable`                             |
| Fullscreen exit recovery         | Pass         | F11 exit restored fresh automatic windowed position `986,20,64,56`                                               |
| Wayland live runtime             | Not executed | No Wayland compositor/session was available                                                                      |

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

Automated tests cover positive and negative display coordinates, top-right and
user-positioned selection, cross-display work-area constraints, display transitions, invalid
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
- full repository suite: 108 files and 635 tests passed;
- Companion production build: pass;
- macOS arm64 unpacked desktop package: pass;
- packaged macOS Runtime/MCP smoke test: pass;
- Windows x64 unpacked desktop package: pass (rebuilt after the fullscreen
  correction; static/package only);
- Linux x64 unpacked desktop package: pass (rebuilt after the fullscreen
  correction);
- Linux/X11 packaged live run: windowed, native fullscreen, micro/expanded
  dragging, foreground suppression, and fullscreen-exit recovery passed.

## External qualification gaps

The following require environments or hardware absent from the qualification
host:

- native Windows desktop live execution;
- Linux/Wayland desktop live execution;
- physical multi-monitor execution.

No unexecuted platform or hardware path is labeled as a pass.
