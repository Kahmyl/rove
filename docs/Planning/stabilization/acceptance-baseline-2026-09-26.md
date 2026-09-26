# Development-App Acceptance Baseline — 26 September 2026

**Candidate:** `f26f2f1e7ff3bf3ff4f674ebeb234daf5fedbd2d` (`main`)  
**Environment:** development Electron application using the normal persistent Rove product home  
**Purpose:** durable stabilization evidence summary. This document does not replace raw screenshots, recordings, SQLite state, or process logs.

## Stage disposition captured by the walkthrough

- **Stage 1 — conversation interaction and presentation:** human walkthrough completed. Findings already captured for remediation do not reopen that completed walkthrough.
- **Stage 2 — attention and approvals:** walkthrough closed with gaps. Three request families have confirmed defects; network, additional-permission, MCP form, and MCP trusted URL remain live-unqualified; 820×700 keyboard-only evidence is also missing.
- **Stage 3 — browser collaboration and control handoff:** walkthrough closed with blocking defects. Automatic browser launch passed. Requested Agent handoff and Companion voluntary takeover failed to reach usable control transfer.
- **Stage 4 — startup, restart and recovery:** walkthrough closed with blocking defects. Persistent restart reproduced unresolved Task recovery and a Runtime-request rejection storm.

Hard Stop remains a separate release-level provider blocker and is tracked by ROVE-STAB-12.

## Confirmed startup/recovery evidence

Observed:

- four visible Task History rows remained on **Checking State**;
- the selected Task retained readable history but no composer/safe controls;
- five of six open Task records retained `thread_history_reconstructible`;
- each affected Task recorded three startup reconciliation attempts followed by `unresolved`;
- a later successful Codex command observation did not clear an earlier history blocker;
- the Companion process logged three `400 INVALID_CONFIGURATION` responses followed by 120 `TypeError: fetch failed` failures while snapshot/session/observation requests continued;
- source inspection found historical handoff reconstruction passing Runtime `getControlStatus` without preserving object binding.

Evidence named in the acceptance report:

- `startup-checking-state.png` — SHA-256 `3c5327e73623411b0a537e165fcd2bbd6dd2a56be1cdc65594c2b75cf66fa8c0`
- `codex-startup-reference.mov` — SHA-256 `aba4b244669c389a72d4b4ac258cfa6170ef10c6a3ffddab06cf62010ec93309`
- `stage-4-runtime-rejection-storm.txt` — SHA-256 `80050b702252f30f3d1d26b4fc7270690011d24c3954cb8ee036cd5ea305d087`

The persistent acceptance home must not be cleared or rewritten before the recovery ticket has captured a safe copy or qualified the fix.

## Confirmed attention/approval evidence

Command approval:

- correctly bound **Needs Input** to the owning Task;
- showed the exact command/reason;
- exposed only **Approve**, with no refusal and no scope choice;
- after approval, showed the command result while the Task remained/returned Working with an advancing timer and Stop still present.

File-change approval:

- an initial "propose and wait" prompt did not qualify the tool approval path and is not classified as a renderer defect;
- an explicit immediate file-change-tool retry created the file while the visible task policy was **Always ask**, without Needs Input or approval controls.

Conversational user input:

- a requested bounded choice was emitted as ordinary assistant transcript content rather than the intended structured response surface;
- final-looking output also appeared while work remained active.

## Live qualification gaps, not presumed UI defects

- Manual network approval did not receive App Server `networkApprovalContext`; Always ask rendered generic Command approval instead.
- An auto-reviewed reserved-domain network request executed once and settled normally; this does not qualify the manual network surface.
- A dedicated additional filesystem-permission request could not be emitted in the live session.
- The production MCP adapter/renderer recognizes structured elicitation and trusted URL variants, but the bundled live MCP fixture cannot emit them.
- 820×700 keyboard-only attention presentation remains unevidenced.

## Confirmed browser/collaboration evidence

Passing behavior:

- the unmaterialized New Task correctly has no Browser panel;
- a direct browser-requiring prompt can materialize a Task and automatically launch the configured browser.

Confirmed failures:

- opening a Task without a profile produced raw `PROFILE_NOT_FOUND` IPC/runtime error text;
- creating/selecting the Rove profile after the existing Task did not make it available to that frozen Task; a fresh Task was required;
- foregrounding the attached browser caused the full Rove surface to become black while the compact follower remained visible;
- requested Agent handoff did not converge and produced unmatched `awaiting_human/controller:none` Runtime sessions;
- the owning Task could simultaneously show terminal-looking work, unfinished activity, Checking State, Stop, and Checking task state;
- orphan-session cleanup presentation leaked onto New Task and unrelated selected Tasks;
- Companion successfully launched/inspected an expected `about:blank` browser but the Task projection said **No browser attached** and offered no voluntary Take Over;
- manual Open Browser then failed with `Task has no exact live Runtime authority`.

## Preserved passing behavior

Do not regress these while correcting the defects:

- background attention remained bound to the owning Task and did not steal selection;
- returning to that Task restored the same request without duplication;
- one accepted command approval produced one visible operation/result;
- direct browser work submitted from unmaterialized New Task can create the Task and automatically launch the configured browser;
- New Task does not need a Browser panel before materialization;
- expected `about:blank` in the constrained Companion test is not a defect;
- auto-reviewed reserved-domain network work settling normally does not qualify or invalidate the manual network approval family;
- the ambiguous initial "propose file change and wait" attempt is not classified as an approval-rendering defect.

## Stop provider baseline

Prior live qualification established that the pinned Codex App Server can accept `turn/interrupt` and report the exact turn `interrupted` while a yielded local process continues to natural completion. The opaque provider process identifier is not OS PID authority and Rove does not use broad kills or PID guessing.

As of 26 September 2026:

- upstream openai/codex issue #42717 remains open;
- current upstream `ProcessEntry` still contains process/call/session data but no owning turn identifier;
- current releases include newer prereleases, but no release has been accepted by Rove as proving exact turn-owned process termination.

This is research evidence, not an instruction to upgrade the pinned provider.
