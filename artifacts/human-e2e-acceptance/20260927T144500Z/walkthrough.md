# Recorded end-to-end acceptance walkthrough — 27 September 2026

## Conclusion

**RECORDED E2E ACCEPTANCE: PARTIAL**

**HUMAN REVIEW: PENDING**

This run records readable, 1× human-paced presentation coverage plus real development and packaged-app persistence checks. It does not claim that deterministic renderer projections are live provider or native browser evidence. macOS denied Screen Recording permission, so the requested complete desktop-surface proof for native browser/follower handoff and the full launch interval is blocked on this host.

No new product correctness or authorization defect was observed. The incomplete items below are qualification gaps or already-known external/platform gates, so no new MR finding was opened.

## Environment and provenance

- Run root: `artifacts/human-e2e-acceptance/20260927T144500Z`
- Branch: `codex/stab14-market-release-qualification`
- Git SHA: `42952a2bce699cee299a2bca6315d95d6181b54f`
- App: `0.1.0`; Electron `37.10.3`; Playwright declaration `^1.54.2`
- Selected Codex component: `0.155.0-alpha.9.2` (SHA-256 `9280c0754e8f1f6b72f495d30c8c82a006dbc4995bf0492916fa0901f6bfd1f9`)
- Host: macOS 26.5.1 build 25F80, arm64
- Package: `release/artifacts/mac-arm64/Rove.app`, unsigned darwin/arm64
- Screen-recording preflight: denied (`CGPreflightScreenCaptureAccess() == false`)
- Playback: all delivered MOV files are 1×; presentation recordings are 1180×780 at 25 fps, Stage 4/package captures are 1180×780 at 5 fps.

## Evidence modes

- `deterministic_presentation`: production renderer with controlled projection state. It qualifies layout, readable transitions, focus, responsive containment, and presentation only.
- `development_app`: real development Electron main process and managed services against a temporary production-format persistent home.
- `packaged_app`: real packaged Electron main process, without package fixture injection.
- `native_application`: complete operating-system surface capture. This mode was blocked because the host denied Screen Recording permission.

## Stage conclusions

| Stage | Outcome | What is established | What is not established |
| --- | --- | --- | --- |
| Stage 1 — conversation | PARTIAL | 12 readable presentation transitions pass: task creation/send, work, semantic activity, queue/edit/steer, terminal and reading-position behavior, failures, uncertainty, and task switching. | The genuine 80 ms Stopping state is not human-readable and was not stretched; live process authority is not reclassified from presentation evidence. |
| Stage 2 — attention | PARTIAL | All seven families are visibly rendered, keyboard reachable and contained; command/file/conversational presentation and decision/task restoration flows pass. | Network and additional-permission live reachability are unavailable. MCP presentation passes here, but live reachability remains governed by STAB-09 rather than this deterministic recording. |
| Stage 3 — browser collaboration | PARTIAL | Seven deterministic handoff/ownership/revocation presentation transitions pass. | Native full-surface browser/follower and unrelated-app foreground proof is blocked by OS recording permission; this video is not claimed as native authority evidence. |
| Stage 4 — restart/recovery | PARTIAL | Real development app preserves conversation and task switching across restart of the same home, rejects stale attention, and retains narrow focus/Stop presentation after reconciliation. | Initial launch before renderer attachment and every requested live queue/attention/browser/failure family were not continuously captured. |
| Final composition | PARTIAL | Multi-task background attention, narrow keyboard presentation, and browser takeover/return composition are readable in deterministic mode. | Native browser control and a human-readable genuine Stopping interval remain unqualified. |
| Packaged composition | PARTIAL | Real package launch, persisted state, task switching, stale-attention rejection, reconciled Stop presentation, and narrow keyboard focus pass. | Live provider attention, live browser/follower, auth, outage, OS-permission recovery, signing/notarization, and non-macOS packaging remain open. |

## Transition index

| Stage | Step ID | Transition | Mode | Result | Timestamp | Video |
| --- | --- | --- | --- | --- | --- | --- |
| Stage 1 | stage-1-01 | New Task and Send | deterministic_presentation | PASS | 00:05–00:07 | stage-1-conversation-presentation.mov |
| Stage 1 | stage-1-02 | Working | deterministic_presentation | PASS | 00:09–00:11 | stage-1-conversation-presentation.mov |
| Stage 1 | stage-1-03 | Semantic activity | deterministic_presentation | PASS | 00:13–00:15 | stage-1-conversation-presentation.mov |
| Stage 1 | stage-1-04 | Queue | deterministic_presentation | PASS | 00:19–00:21 | stage-1-conversation-presentation.mov |
| Stage 1 | stage-1-05 | Queue controls | deterministic_presentation | PASS | 00:31–00:33 | stage-1-conversation-presentation.mov |
| Stage 1 | stage-1-06 | Steer | deterministic_presentation | PASS | 00:36–00:38 | stage-1-conversation-presentation.mov |
| Stage 1 | stage-1-07 | Stop transition | deterministic_presentation | UNQUALIFIED | 00:43–00:45 | stage-1-conversation-presentation.mov |
| Stage 1 | stage-1-08 | Terminal presentation | deterministic_presentation | PASS | 00:50–00:52 | stage-1-conversation-presentation.mov |
| Stage 1 | stage-1-09 | Reading position and Latest | deterministic_presentation | PASS | 00:59–01:01 | stage-1-conversation-presentation.mov |
| Stage 1 | stage-1-10 | Latest resumes follow | deterministic_presentation | PASS | 01:04–01:06 | stage-1-conversation-presentation.mov |
| Stage 1 | stage-1-11 | Ordinary failure | deterministic_presentation | PASS | 01:12–01:14 | stage-1-conversation-presentation.mov |
| Stage 1 | stage-1-12 | Consequential uncertainty | deterministic_presentation | PASS | 01:19–01:21 | stage-1-conversation-presentation.mov |
| Stage 1 | stage-1-13 | Multi-Task switching | deterministic_presentation | PASS | 01:26–01:28 | stage-1-conversation-presentation.mov |
| Stage 2 | stage-2-14 | Conversational structured input | deterministic_presentation | PASS | 00:09–00:11 | stage-2-attention-approvals.mov |
| Stage 2 | stage-2-15 | Command approval | deterministic_presentation | PASS | 00:16–00:18 | stage-2-attention-approvals.mov |
| Stage 2 | stage-2-16 | File-change approval | deterministic_presentation | PASS | 00:23–00:25 | stage-2-attention-approvals.mov |
| Stage 2 | stage-2-17 | Network approval | deterministic_presentation | UNQUALIFIED | 00:30–00:32 | stage-2-attention-approvals.mov |
| Stage 2 | stage-2-18 | Additional-permission approval | deterministic_presentation | UNQUALIFIED | 00:37–00:39 | stage-2-attention-approvals.mov |
| Stage 2 | stage-2-19 | MCP structured form | deterministic_presentation | PASS | 00:44–00:46 | stage-2-attention-approvals.mov |
| Stage 2 | stage-2-20 | MCP trusted URL | deterministic_presentation | PASS | 00:51–00:53 | stage-2-attention-approvals.mov |
| Stage 2 | stage-2-21 | Command decisions at normal width | deterministic_presentation | PASS | 00:59–01:01 | stage-2-attention-approvals.mov |
| Stage 2 | stage-2-22 | Exactly-once decision submission | deterministic_presentation | PASS | 01:04–01:06 | stage-2-attention-approvals.mov |
| Stage 2 | stage-2-23 | Background Needs Input | deterministic_presentation | PASS | 01:11–01:13 | stage-2-attention-approvals.mov |
| Stage 2 | stage-2-24 | Owning Task restoration | deterministic_presentation | PASS | 01:16–01:18 | stage-2-attention-approvals.mov |
| Stage 3 | stage-3-25 | Unmaterialized New Task | deterministic_presentation | PASS | 00:03–00:05 | stage-3-browser-collaboration.mov |
| Stage 3 | stage-3-26 | Requested Agent handoff | deterministic_presentation | PASS | 00:10–00:12 | stage-3-browser-collaboration.mov |
| Stage 3 | stage-3-27 | Human control | deterministic_presentation | PASS | 00:15–00:17 | stage-3-browser-collaboration.mov |
| Stage 3 | stage-3-28 | Return and Checking | deterministic_presentation | PASS | 00:20–00:22 | stage-3-browser-collaboration.mov |
| Stage 3 | stage-3-29 | Companion voluntary takeover | deterministic_presentation | PASS | 00:27–00:29 | stage-3-browser-collaboration.mov |
| Stage 3 | stage-3-30 | Companion human ownership | deterministic_presentation | PASS | 00:32–00:34 | stage-3-browser-collaboration.mov |
| Stage 3 | stage-3-31 | Authority leak check | deterministic_presentation | PASS | 00:39–00:41 | stage-3-browser-collaboration.mov |
| Composition | composition-32 | Two Tasks and background attention | deterministic_presentation | PASS | 00:07–00:09 | final-composition.mov |
| Composition | composition-33 | Narrow keyboard attention | deterministic_presentation | PASS | 00:14–00:16 | final-composition.mov |
| Composition | composition-34 | Stop composition | deterministic_presentation | UNQUALIFIED | 00:23–00:25 | final-composition.mov |
| Composition | composition-35 | Browser takeover composition | deterministic_presentation | PASS | 00:33–00:35 | final-composition.mov |
| Composition | composition-36 | Browser return composition | deterministic_presentation | PASS | 00:38–00:40 | final-composition.mov |
| Composition | composition-37 | Repeated narrow composition | deterministic_presentation | PASS | 00:42–00:44 | final-composition.mov |
| Stage 3 | stage-3-native-full-surface-capture | Native browser handoff, unrelated foreground application, companion/follower and authority revocation on the complete desktop surface | native_application | BLOCKED | not captured | none |
| Stage 4 | stage-4-pre-restart-persistence | Persisted conversation and task switching before restart | development_app | PASS | 00:00–00:24 | stage-4-pre.mov |
| Stage 4 | stage-4-restart-same-home | Relaunch against the same home and restore persisted task state without stale attention | development_app | PASS | 00:24–00:49 | stage-4-restart-recovery.mov |
| Stage 4 | stage-4-startup-hydration | Capture initial launch, hydration, loading, active work, waiting, browser authority, Stop, and failure recovery continuously | development_app | UNQUALIFIED | not captured | stage-4-restart-recovery.mov |
| Packaged | packaged-packaged-persistence | Launch the real packaged application with production-format state and preserve persisted conversation/task switching | packaged_app | PASS | 00:00–00:24 | packaged-composition.mov |
| Packaged | packaged-packaged-narrow-focus | Narrow-width keyboard focus and reconciled Stop presentation | packaged_app | PASS | 00:00–00:24 | packaged-composition.mov |
| Packaged | packaged-packaged-live-composition | Live provider attention, task-bound browser/follower, authentication, outage, and OS-permission recovery in the packaged application | packaged_app | UNQUALIFIED | not captured | packaged-composition.mov |

## Human review order

1. `full-walkthrough.mov` — chronological Stages 1–4, 04:33 total.
2. `final-composition.mov` — deterministic multi-feature composition.
3. `packaged-composition.mov` — real packaged-app persistence/focus composition.
4. Contact sheets under `screenshots/` for fast visual comparison.
5. `manifest.json` for per-step expected/observed/result/provenance; `SHA256SUMS` for integrity.

Reviewers must preserve the evidence-mode boundary. A `PASS` in deterministic presentation means the recorded UI behavior passed; it is not permission to label provider reachability, process ownership, native browser authority, or operating-system integration as passed.

## Machine verification completed with this run

- `pnpm customer-journey:conversation-task`: PASS, 28 screenshots.
- `pnpm surface:native-foreground`: PASS, including unrelated-foreground revocation and owned-browser recovery.
- `pnpm surface:packaged-critical`: PASS with live attention and browser/follower correctly reported as not exercised.
- `pnpm agent:command-exec-stop`: PASS for exact Stop/final exit, unrelated-process survival, and owner-crash suppression; elevated execution remained fail-closed.
- `pnpm agent:attention-boundary`: PASS; direct MCP calls remained accurately characterized as auto-declined without an application-client request.
- `pnpm test:recovery:processes`: PASS with zero stale child processes, ports, profile locks, browser attachments, or nonterminal Runtime sessions.
- `pnpm check:repository`: PASS (722 files, 1,318 relative imports, 113 local document links).
- `pnpm test:release`: PASS (203 files, 1,737 tests in 122.01 seconds).

The initial sandboxed attempts to launch Electron and bind process-harness loopback ports failed with host-policy errors. The unchanged commands passed when rerun with the required host permissions; those first attempts are environmental diagnostics, not product failures.

## Residual release gates

- Grant macOS Screen Recording permission and rerun native full-surface Stage 3 plus continuous launch/recovery capture.
- Run live packaged provider-attention and task-bound browser/follower composition with explicitly authorized credentials and external effects.
- Preserve STAB-09’s provider-family reachability matrix: unavailable request families remain unqualified.
- Complete authentication, outage, OS-permission, signing/notarization, native ABI, and representative Windows/Linux package evidence.
- Obtain independent human review of these recordings; automation did not self-certify human acceptance.
