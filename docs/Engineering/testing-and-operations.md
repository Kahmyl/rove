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

Meaningful existing command families include `agent:fixtures`, `agent:schema`, `test:recovery:contract`, `test:recovery:processes`, `test:attachments`, `browser:semantic-transactions`, `browser:capability-atlas`, and `browser:capabilities:integration`. Read script arguments before live use. Schema checks use the selected Codex binary; live model and external-service exercises require explicit authorization and may consume allowance or change real accounts.

## Test layers

Unit/contract tests cover domain invariants, schema validation, context selection, operation correlation, and pure state reductions. Integration tests cover SQLite transactions, native module loading, private APIs, real local browser fixtures, attachment boundaries, and event routing. Process tests cover restarts, ownership, and unfinished operations. Packaged-application checks cover the actual binary/runtime/browser combination and operating-system permissions.

Retain existing negative cases and outcome assertions during naming cleanup. Do not delete a difficult test merely because it exposes current architectural coupling. Local fixtures and recorded input data belong under `tests/fixtures`; generated runs, screenshots, and videos belong under ignored `artifacts/`, not the documentation tree.

## Product acceptance matrix

| Scenario                | Required evidence                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------------------ |
| Non-browser task        | A response can begin without starting Chrome or acquiring a browser profile.                                 |
| Independent tasks       | View changes, streaming, attention, and resources stay associated with the correct tasks.                    |
| Model unavailable       | Known unavailability does not create false running/queued work; existing data remains readable.              |
| Stop and redirect       | A stopped conversation accepts a new request, including a different objective.                               |
| Workflow value          | Approved guidance changes relevant outcomes without leaking another workflow's context.                      |
| Portability             | Setup restores on another device while tasks/artifacts/secrets remain local; missing resources are explicit. |
| Sync conflicts/deletion | Offline edits cannot silently overwrite or resurrect deleted setup; synchronization dispatches no actions.   |
| Browser groups          | Multiple task-owned groups, popups, shared resources, and human takeover behave correctly.                   |
| Perception/interactions | General control families pass across variations, including icon-only and dynamic UI.                         |
| Capture/video           | Scope, actor attribution, start/stop, privacy, playable output, and failure handling are demonstrated.       |
| Findings to action      | Selected records, drafts, file choice, approval, and confirmed outcomes remain linked.                       |
| Interrupted side effect | Lost acknowledgement after dispatch does not lead to an automatic duplicate action.                          |
| Profile/model switch    | Rove data ownership remains correct; credentials and engine associations do not leak between accounts.       |

## Fault injection and budgets

Inject interruption before acceptance, before dispatch, after possible external dispatch, before result persistence, during artifact finalization, and during control return. Verify recovery independently of the renderer. Duplicate/late events and stale approvals must not create new work.

Use bounded synthetic journeys to measure correctness, unnecessary actions, model usage, observation size, latency, and peak local resources. Establish measured budgets rather than inventing performance claims. Keep browser/navigation failures distinguishable from model/tool-selection failures. Fix general capabilities and retain regression variants.

## Development and operation

`pnpm dev:desktop` is the existing source-built entry point. Other runtime/MCP/control-plane commands remain development tools; their presence does not make cloud relay infrastructure a product prerequisite. The current executable behavior may still diverge from the target documents. Show missing functionality as implementation work, not as completed by documentation.

The application uses a stable per-user product home, not the repository working directory, for user data. Never run cleanup or tests against a user's real profile by default. Managed child processes require verified ownership before reconnect or termination. Use temporary homes, fixture accounts, and scoped grants for automated tests.

## Backup, retention, and support evidence

Export a consistent database snapshot with an artifact manifest and explicit missing-file states. Exclude secrets by default. Validate imports before replacing active data. [SQLite backup documentation](https://www.sqlite.org/backup.html) is the storage reference; a naive copy of a live database is not a tested recovery strategy.

User-visible deletion distinguishes task history, recordings, browser identity, workflow setup, and account connection. Do not automatically delete all local conversations when a workflow is removed remotely. Diagnostic exports require consent and redact credentials/content not needed for the issue.

## Dependency and packaging changes

Qualify dependency changes as a compatible set: Codex binary/schema, application, browser tooling/binary, runtime, and native modules. Use source and installed-package checks. A library update is not accepted simply because TypeScript compiles. Verify authentication, threads, tools, events, permissions, handoff, recording, recovery, and resource behavior.

Package metadata may require numeric versions, but Rove has no shipped product edition. Do not create versioned product documents or label pre-release work with milestone names. Git commits identify development changes; deployment/build identities and storage/protocol formats identify technical compatibility.

## Documentation and naming checks

`node scripts/check-repository.mjs` checks maintained document links, banned milestone/version-style product filenames, and explicit relative source imports. Run typecheck, build, and tests as well; a filename/link checker cannot establish runtime correctness. [Contributing](../../CONTRIBUTING.md) defines migration and naming discipline.

Maintain evidence with exact commands, environment, commit, outcome, and limitations. Do not copy old acceptance reports into current docs as though they qualify a changed product model. Historical reports remain in Git history; current documentation describes responsibilities and verification rather than a chronological phase diary.
