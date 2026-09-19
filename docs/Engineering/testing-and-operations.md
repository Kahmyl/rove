# Testing and Operations

**Role:** Verification and operating requirements for the unfinished MVP. Passing a subset of checks is not a production release or proof of every target product behavior.

## Local checks

Use the repository's declared pnpm version and a supported Node environment. Install the frozen lockfile. Native modules must be built for the runtime executing the tests; Electron packaging requires its own ABI qualification rather than copying an arbitrary Node binary.

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
pnpm test
node --test experiments/agent-execution/*.test.mjs
node scripts/check-repository.mjs
```

Browser tests require the matching Playwright browser installation. Headed checks require a real desktop or an appropriate virtual display in CI. Do not claim a sandbox/container limitation proves a product defect; record the environment and reproduce with equivalent capabilities.

Meaningful existing command families include `agent:fixtures`, `agent:schema`, Codex component inspection/qualification/install/promotion, `test:recovery:contract`, `test:recovery:processes`, `test:attachments`, `browser:semantic-transactions`, `browser:capability-atlas`, and `browser:capabilities:integration`. Read script arguments before live use. Schema checks and candidate qualification require an explicitly selected Codex binary; live model and external-service exercises require explicit authorization and may consume allowance or change real accounts.

## Test layers

Unit/contract tests cover domain invariants, schema validation, context selection, operation correlation, and pure state reductions. Integration tests cover SQLite transactions, native module loading, private APIs, real local browser fixtures, attachment boundaries, and event routing. Process tests cover restarts, ownership, and unfinished operations. Packaged-application checks cover the actual binary/runtime/browser combination and operating-system permissions.

Retain existing negative cases and outcome assertions during naming cleanup. Do not delete a difficult test merely because it exposes current architectural coupling. Local fixtures and recorded input data belong under `tests/fixtures`; generated runs, screenshots, and videos belong under ignored `artifacts/`, not the documentation tree.

## Product acceptance matrix

| Scenario                | Required evidence                                                                                                                                                                                                 |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Non-browser task        | A response can begin without starting Chrome or acquiring a browser profile.                                                                                                                                      |
| Independent tasks       | View changes, streaming, attention, and resources stay associated with the correct tasks.                                                                                                                         |
| Model unavailable       | Known unavailability does not create false running/queued work; existing data remains readable.                                                                                                                   |
| Stop and redirect       | A stopped conversation accepts a new request, including a different objective.                                                                                                                                    |
| Archive and restore     | Confirmation is non-mutating until accepted; one local preference hides/restores history without Finish, cleanup, provider access, or loss of Workflow/Output links.                                              |
| Cleanup and uncertainty | Cleanup retry uses its exact intent; completed cleanup returns to conversation readiness; an uncertain operation retains its own identity until matching evidence and does not erase local history.               |
| Local startup reads     | Seeded Tasks, conversations, Workflows, and Outputs remain readable after Codex startup failure while model-assisted submission remains unavailable.                                                              |
| Workflow value          | Approved guidance changes relevant outcomes without leaking another workflow's context.                                                                                                                           |
| Workflow workspace      | Name-only creation enters Home immediately; associated tasks, stable Results, and exact attention are projected without unrelated-data leakage; Context remains optional and secondary.                           |
| Progressive interaction | Secondary composer commands remain keyboard accessible; exact conversational input replaces only its owning selected task's composer; Context is readable before focused editing and preserves revision behavior. |
| Portability             | Setup restores on another device while tasks/artifacts/secrets remain local; missing resources are explicit.                                                                                                      |
| Sync conflicts/deletion | Offline edits cannot silently overwrite or resurrect deleted setup; synchronization dispatches no actions.                                                                                                        |
| Browser groups          | Multiple task-owned groups, popups, shared resources, and human takeover behave correctly.                                                                                                                        |
| Perception/interactions | General control families pass across unrelated variations; incomplete structure triggers appropriate targeted/visual escalation rather than site-specific rules.                                                  |
| Capture/video           | Scope, actor attribution, start/stop, privacy, playable output, and failure handling are demonstrated.                                                                                                            |
| Findings to action      | Selected records, drafts, file choice, approval, and confirmed outcomes remain linked.                                                                                                                            |
| Interrupted side effect | Lost acknowledgement after dispatch does not lead to an automatic duplicate action.                                                                                                                               |
| Outcome reconciliation  | A dispatched but unverified consequential effect remains replay-fenced while bounded read-only reconciliation can later settle it from authoritative evidence or leave it genuinely unresolved.                   |
| Profile/model switch    | Rove data ownership remains correct; credentials and engine associations do not leak between accounts.                                                                                                            |

Current executable evidence for the browser-groups row covers one physical persistent host, distinct task page inventories and logical active pages, overlapping independent navigation, cross-task page denial, opener-derived popup ownership and event routing, release-time attribution races, manual-tab recovery, group-local release, verified final-host shutdown/retry, takeover presentation failure, sibling grounding invalidation on human return, and exclusive mutation admission for credential/consequential context operations. Page groups intentionally share cookies and authentication. Ordinary-navigation cookie changes, multi-step clipboard contention, and broader account-change coverage remain qualification gaps. Requested task-owned page recording has its own source-level lifecycle, privacy, failure, and real-browser WebM evidence; it does not qualify browser-window capture or packaged operating-system behavior.

## Adaptive browser qualification

Browser acceptance must demonstrate generalization rather than one successful site fixture. Keep deterministic fixtures centered on capability shapes and evidence limits, then supplement them with separately authorized live journeys across unrelated applications.

Required browser evidence includes:

- structured/semantic success when the current observation is complete;
- a known-truncated text or target observation causing a deliberate perception change rather than an unverifiable whole-page claim;
- targeted/scoped inspection and fresh inspection after asynchronous convergence;
- screenshot/visual escalation for controls or state that structure does not represent adequately;
- dynamic and virtualized list outcomes where the authoritative state may move or render outside the immediate successor view;
- a consequential mutation whose immediate receipt is unverified and is later settled through read-only reconciliation without a second dispatch;
- an effect proved from a different authoritative read surface than the commit surface;
- a genuinely unresolved effect where no permitted evidence can establish what happened;
- human takeover/return while reconciliation or further read-only investigation is pending;
- unchanged cross-task page ownership, approval binding, consequence fencing, and service restrictions throughout those scenarios.

Retain sanitized regressions for real failures such as the truncated-observation create-item case, but do not make a named website's selectors or UI structure the product contract. A live Google Drive, GitHub, LinkedIn, or other third-party journey is additional acceptance evidence only when explicitly authorized.

Measure correctness together with unnecessary actions, observation size, model/context usage, latency, and reconciliation depth. Adaptive behavior is not permission for uncontrolled wandering; reads and perception escalation remain bounded.

Current deterministic qualification reuses the structured-control, target/text truncation, delayed convergence, durable settlement, genuine-unresolved, popup/frame, and shared-host suites. Added generic fixtures cover recycled ARIA listbox/grid windows, an icon control with a hover-revealed menu and in-page dialog followed by DOM replacement, and a commit view whose authoritative proof appears on a separately opened history page. Assertions bound representative work to one mutation dispatch, bounded successor/reconciliation reads, explicit focused reads, explicit target truncation, and zero screenshots unless visual acquisition is the capability under test. Partial virtual windows must report incomplete canonical target evidence; an unrendered row is never proof of absence. Screenshot acquisition and authority are deterministic, while interpretation of arbitrary pixels remains a separately authorized image-capable model/live acceptance exercise.

## Fault injection and budgets

Inject interruption before acceptance, before dispatch, after possible external dispatch, before result persistence, during artifact finalization, and during control return. Verify recovery independently of the renderer. Duplicate/late events and stale approvals must not create new work.

Use bounded synthetic journeys to measure correctness, unnecessary actions, model usage, observation size, latency, and peak local resources. Establish measured budgets rather than inventing performance claims. Keep browser/navigation failures distinguishable from model/tool-selection failures. Fix general capabilities and retain regression variants.

## Development and operation

`pnpm dev:desktop` is the existing source-built entry point. Other runtime/MCP/control-plane commands remain development tools; their presence does not make cloud relay infrastructure a product prerequisite. The current executable behavior may still diverge from the target documents. Show missing functionality as implementation work, not as completed by documentation.

For an approved Codex component update, use `pnpm codex:component:inspect -- --source <absolute-codex-path>`, register the exact candidate identity and compiled schema binding without changing the selection, run `pnpm codex:component:qualify -- --source <absolute-codex-path> --component <id>`, install it with `pnpm codex:component:install -- --source <absolute-codex-path> --component <id>`, and explicitly select the coherent set with `pnpm codex:component:promote -- --component <id>`. Qualification emits the immutable receipt consumed by installation. Promotion refuses a missing or mismatched receipt, an unqualified or absent managed component, any unavailable retained-qualified rollback component, a missing compiled Runtime binding, schema metadata drift, a changed checked-in schema digest, or a changed generated-TypeScript aggregate. Its manifest replacement synchronizes the temporary file and containing directory around the rename. `pnpm codex:component:verify` proves the selected managed executable/helper pair is intact. The `--source` path is qualification/acquisition input only and is never read by normal desktop startup or package preparation.

The application uses a stable per-user product home, not the repository working directory, for user data. Never run cleanup or tests against a user's real profile by default. Managed child processes require verified ownership before reconnect or termination. Use temporary homes, fixture accounts, and scoped grants for automated tests.

## Backup, retention, and support evidence

The Settings surface exports a new device-local backup folder through a host-owned directory picker. The task, Workflow, and result ledger is captured with SQLite's online backup operation and checked with `integrity_check`; Runtime sessions, evidence, recordings, task attachments, bootstrap claims, and effect journals are copied from an explicit allowlist. The manifest hashes included files and records missing, changed-during-export, symlink, and unsupported-file states. Codex credential state, local capability signing keys, browser profiles/cookies, process state, and arbitrary task workspaces are excluded. The UI warns that task content and artifacts may still be sensitive and distinguishes backup from Workflow synchronization. Customer cancellation is a neutral no-op stating that no backup was created; only operational failure uses attention/error treatment.

Restore is not implemented. Do not replace active data until an importer validates format, profile ownership, compatibility, paths, entry types, and every checksum before an atomic cutover. [SQLite backup documentation](https://www.sqlite.org/backup.html) is the storage reference; a naive copy of a live database is not a tested recovery strategy.

User-visible deletion distinguishes task history, recordings, browser identity, workflow setup, and account connection. Do not automatically delete all local conversations when a workflow is removed remotely. Diagnostic exports require consent and redact credentials/content not needed for the issue.

## Dependency and packaging changes

Qualify dependency changes as a compatible set: Codex binary/schema, application, browser tooling/binary, runtime, and native modules. Use source and installed-package checks. A library update is not accepted simply because TypeScript compiles. Verify authentication, threads, tools, events, permissions, handoff, recording, recovery, and resource behavior.

The Codex component lifecycle is discover, qualify, install, then promote. Discovery reports candidates without trusting them. Qualification runs with an isolated temporary Codex home, regenerates upstream schemas, verifies Rove's required method/type surface and safe App Server lifecycle probes, and emits immutable evidence without changing the approved selection. Installation re-verifies and copies a qualified executable/helper pair plus its exact receipt into Rove's managed component store. Re-running qualification and installation upgrades a missing or exact preceding-format receipt in place only after both the new external evidence and existing binary bytes verify, so operators do not manually delete the managed component; any binary, receipt, schema, or provenance conflict remains a refusal. Promotion durably replaces the repository-owned executable/schema/validator/history selection only after verifying the target and every retained-qualified rollback set. Tests cover missing and changed managed files, missing and changed schemas, missing or mismatched receipts, generated-catalog drift, unapproved candidates, conflict-safe and idempotent installation, receipt-only migration and fault atomicity, successful selected-component resolution, package staging from the managed source, and rollback to a retained qualified component. Neither development startup nor package preparation may fall through to ChatGPT, an editor extension, or `PATH`.

Package metadata may require numeric versions, but Rove has no shipped product edition. Do not create versioned product documents or label pre-release work with milestone names. Git commits identify development changes; deployment/build identities and storage/protocol formats identify technical compatibility.

## Documentation and naming checks

`node scripts/check-repository.mjs` checks maintained document links, banned milestone/version-style product filenames, and explicit relative source imports. Run typecheck, build, and tests as well; a filename/link checker cannot establish runtime correctness. [Contributing](../../CONTRIBUTING.md) defines migration and naming discipline.

Maintain evidence with exact commands, environment, commit, outcome, and limitations. Do not copy old acceptance reports into current docs as though they qualify a changed product model. Historical reports remain in Git history; current documentation describes responsibilities and verification rather than a chronological phase diary.
