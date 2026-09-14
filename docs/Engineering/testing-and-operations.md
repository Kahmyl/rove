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
| Workflow value          | Approved guidance changes relevant outcomes without leaking another workflow's context.                                                                                                                           |
| Workflow workspace      | Name-only creation enters Home immediately; associated tasks, stable Results, and exact attention are projected without unrelated-data leakage; Context remains optional and secondary.                           |
| Progressive interaction | Secondary composer commands remain keyboard accessible; exact conversational input replaces only its owning selected task's composer; Context is readable before focused editing and preserves revision behavior. |
| Portability             | Setup restores on another device while tasks/artifacts/secrets remain local; missing resources are explicit.                                                                                                      |
| Sync conflicts/deletion | Offline edits cannot silently overwrite or resurrect deleted setup; synchronization dispatches no actions.                                                                                                        |
| Browser groups          | Multiple task-owned groups, popups, shared resources, and human takeover behave correctly.                                                                                                                        |
| Perception/interactions | General control families pass across variations, including icon-only and dynamic UI.                                                                                                                              |
| Capture/video           | Scope, actor attribution, start/stop, privacy, playable output, and failure handling are demonstrated.                                                                                                            |
| Findings to action      | Selected records, drafts, file choice, approval, and confirmed outcomes remain linked.                                                                                                                            |
| Interrupted side effect | Lost acknowledgement after dispatch does not lead to an automatic duplicate action.                                                                                                                               |
| Profile/model switch    | Rove data ownership remains correct; credentials and engine associations do not leak between accounts.                                                                                                            |

Current executable evidence for the browser-groups row covers one physical persistent host, distinct task page inventories and logical active pages, overlapping independent navigation, cross-task page denial, opener-derived popup ownership and event routing, release-time attribution races, manual-tab recovery, group-local release, verified final-host shutdown/retry, takeover presentation failure, sibling grounding invalidation on human return, and exclusive mutation admission for credential/consequential context operations. Page groups intentionally share cookies and authentication. Ordinary-navigation cookie changes, multi-step clipboard contention, and broader account-change coverage remain qualification gaps. Requested task-owned page recording has its own source-level lifecycle, privacy, failure, and real-browser WebM evidence; it does not qualify browser-window capture or packaged operating-system behavior.

## Fault injection and budgets

Inject interruption before acceptance, before dispatch, after possible external dispatch, before result persistence, during artifact finalization, and during control return. Verify recovery independently of the renderer. Duplicate/late events and stale approvals must not create new work.

Use bounded synthetic journeys to measure correctness, unnecessary actions, model usage, observation size, latency, and peak local resources. Establish measured budgets rather than inventing performance claims. Keep browser/navigation failures distinguishable from model/tool-selection failures. Fix general capabilities and retain regression variants.

## Development and operation

`pnpm dev:desktop` is the existing source-built entry point. Other runtime/MCP/control-plane commands remain development tools; their presence does not make cloud relay infrastructure a product prerequisite. The current executable behavior may still diverge from the target documents. Show missing functionality as implementation work, not as completed by documentation.

For an approved Codex component update, use `pnpm codex:component:inspect -- --source <absolute-codex-path>`, register the exact candidate identity without changing a selection, run `pnpm codex:component:qualify -- --source <absolute-codex-path> --component <id>`, install it with `pnpm codex:component:install -- --source <absolute-codex-path> --component <id>`, and explicitly select it with `pnpm codex:component:promote -- --component <id> --purpose development`, `packaging`, or `all`. Promotion refuses an unqualified or absent managed component. `pnpm codex:component:verify` proves the selected managed component is intact. The `--source` path is qualification/acquisition input only and is never read by normal desktop startup or package preparation.

The application uses a stable per-user product home, not the repository working directory, for user data. Never run cleanup or tests against a user's real profile by default. Managed child processes require verified ownership before reconnect or termination. Use temporary homes, fixture accounts, and scoped grants for automated tests.

## Backup, retention, and support evidence

The Settings surface exports a new device-local backup folder through a host-owned directory picker. The task, Workflow, and result ledger is captured with SQLite's online backup operation and checked with `integrity_check`; Runtime sessions, evidence, recordings, task attachments, bootstrap claims, and effect journals are copied from an explicit allowlist. The manifest hashes included files and records missing, changed-during-export, symlink, and unsupported-file states. Codex credential state, local capability signing keys, browser profiles/cookies, process state, and arbitrary task workspaces are excluded. The UI warns that task content and artifacts may still be sensitive and distinguishes backup from Workflow synchronization. Customer cancellation is a neutral no-op stating that no backup was created; only operational failure uses attention/error treatment.

Restore is not implemented. Do not replace active data until an importer validates format, profile ownership, compatibility, paths, entry types, and every checksum before an atomic cutover. [SQLite backup documentation](https://www.sqlite.org/backup.html) is the storage reference; a naive copy of a live database is not a tested recovery strategy.

User-visible deletion distinguishes task history, recordings, browser identity, workflow setup, and account connection. Do not automatically delete all local conversations when a workflow is removed remotely. Diagnostic exports require consent and redact credentials/content not needed for the issue.

## Dependency and packaging changes

Qualify dependency changes as a compatible set: Codex binary/schema, application, browser tooling/binary, runtime, and native modules. Use source and installed-package checks. A library update is not accepted simply because TypeScript compiles. Verify authentication, threads, tools, events, permissions, handoff, recording, recovery, and resource behavior.

The Codex component lifecycle is discover, qualify, install, then promote. Discovery reports candidates without trusting them. Qualification runs with an isolated temporary Codex home, regenerates upstream schemas, verifies Rove's required method/type surface and safe App Server lifecycle probes, and emits immutable evidence without changing the approved selection. Installation re-verifies and copies a qualified executable/helper pair into Rove's managed component store. Promotion changes the repository-owned selection explicitly. Tests must cover a missing managed component, changed executable or helper, unapproved candidate, successful selected-component resolution, package staging from the managed source, and rollback to a retained qualified component. Neither development startup nor package preparation may fall through to ChatGPT, an editor extension, or `PATH`.

Package metadata may require numeric versions, but Rove has no shipped product edition. Do not create versioned product documents or label pre-release work with milestone names. Git commits identify development changes; deployment/build identities and storage/protocol formats identify technical compatibility.

## Documentation and naming checks

`node scripts/check-repository.mjs` checks maintained document links, banned milestone/version-style product filenames, and explicit relative source imports. Run typecheck, build, and tests as well; a filename/link checker cannot establish runtime correctness. [Contributing](../../CONTRIBUTING.md) defines migration and naming discipline.

Maintain evidence with exact commands, environment, commit, outcome, and limitations. Do not copy old acceptance reports into current docs as though they qualify a changed product model. Historical reports remain in Git history; current documentation describes responsibilities and verification rather than a chronological phase diary.
