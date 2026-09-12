# Phase 5 P5.0 App Server experiments and proposed contract lock

Date: 2026-09-07

Status: master accepted; P5.0 closed; P5.1 authorized but not started

## Master review — 2026-09-07

The master reviewer reproduced the schema comparison, deterministic fixture
campaign, isolated required-MCP boundary, and one signed-in lifecycle run.

Reproduction results:

- schema comparison exited successfully and reproduced the recorded digest;
- the fixture campaign exited successfully with its reported 79 assertions;
- the isolated required-MCP boundary reproduced the expected server identity,
  catalog, task mismatch, image/text content, and fail-closed startup;
- the signed-in lifecycle process exited successfully, but its own evidence
  reported `turn/interrupt` as `status: error`, JSON-RPC code `-32600`.

The last result contradicts this report's claim that live interruption passed.
The lifecycle harness records observations but does not assert its advertised
success criteria or fail the process when a required observation is false.

The fixture count is also not yet suitable as contract-lock evidence. Several
checks are tautologies or literal-state demonstrations rather than tests of a
shared contract or realistic prototype. Material examples include the
initialization-order, dynamic-tools, host-message, login-ownership, transport,
presentation, restart, and temporary-cleanup assertions. In addition:

- the E8 fixture uses a nested `browserIdentity` shape while the proposed task
  launch schema defines `browserIdentityMode` plus `resolvedWorkspaceId`;
- the E8 "agent mismatch is rejected" check does not invoke a rejection path;
- the E6 fixture writes `requiresFreshInspection` onto a record whose proposed
  schema has `additionalProperties: false` and does not define that field;
- the proposed JSON schemas are not loaded or validated by the fixture
  campaign;
- the cloud-boundary fixture searches serialized property names against a
  blacklist instead of validating an allowlisted transport envelope;
- the stored Rove catalog fixture is not automatically compared with the
  production `TOOL_CATALOG` source by the deterministic campaign.

The report correctly labels several required E3–E8 compositions as unverified,
but that means those experiments have not yet all been executed to the P5.0
assignment's evidence standard. They cannot simultaneously be counted as
completed contract gates.

Harness corrections are required before another master review:

1. make every live mode enforce required observations and exit nonzero on a
   failed invariant;
2. make interruption deterministic or bounded-retry and require both a
   successful RPC and terminal `interrupted` turn status;
3. replace tautologies with schema-backed negative and transition tests using
   the exact proposed contract shapes;
4. make the continuation schema and transition model agree;
5. validate a strict allowlisted local/cloud envelope;
6. compare the catalog fixture with production source automatically;
7. use portable executable resolution, guaranteed temporary-home cleanup, and
   phase progress diagnostics in the live harness;
8. implement credible isolated compositions for the still-unverified E3–E8
   requirements or narrow the P5.0 claim and explicitly defer them in the
   master plan.

Decision: **P5.0 remains open. P5.1 must not begin.**

## Correction run — 2026-09-07

The requested harness corrections are now implemented and ready for master
re-review. This does not self-accept P5.0 and does not authorize P5.1.

- all three live modes now evaluate explicit required-evidence predicates,
  print their verdicts, and exit nonzero when any predicate fails;
- the lifecycle harness retains RPC error text and requires both a successful
  interrupt RPC and terminal `turn.status = interrupted`; a bounded three-try
  probe uses `thread/shellCommand` to create an observable active turn;
- the corrected signed-in run passed interruption on attempt one with RPC
  `ok` and terminal `interrupted`;
- executable discovery now searches the configured explicit path or `PATH`,
  temporary Codex homes have asynchronous cleanup plus a process-exit fallback,
  and every live phase emits progress diagnostics to stderr;
- deterministic tests now import executable contract models instead of
  redeclaring them in the test runner, and they load the checked-in launch,
  continuation, and cloud-envelope schemas for positive and negative cases;
- the continuation transition and schema now share the exact
  `freshInspectionRequired` field and consumed-state constraint;
- cloud transport uses an `additionalProperties: false` allowlist at both
  envelope and payload levels; serialization selects only allowed payload
  fields, while direct sensitive/unknown inputs fail validation;
- the stored Rove catalog is parsed and compared in order with production
  `TOOL_CATALOG` on every fixture run;
- E3–E8 now exercise imported isolated coordinator compositions and rejection
  paths. They remain clearly distinguished from later native Desktop,
  disposable-auth, and browser crash-injection qualification.

Correction evidence: 51/51 deterministic checks, one schema-manifest digest
comparison, read-only live mode passed, isolated required-MCP live mode passed,
and signed-in lifecycle live mode passed. The earlier failed interruption run
remains documented above as the defect that prompted these changes.

## Master re-review — 2026-09-07

The master reviewer independently reproduced the corrected schema comparison,
51/51 deterministic checks, isolated required-MCP boundary, host-authorized
read-only probe, and host-authorized signed-in lifecycle. The lifecycle now
fails closed on missing evidence and proved a successful interrupt RPC followed
by terminal `interrupted` status on the first bounded attempt. Those corrections
are accepted.

P5.0 is not yet accepted because the proposed product contracts and remaining
experiment coverage still have material gaps:

- the task-launch schema accepts `wrk_primary`, while the production protocol
  requires `^wrk_[a-f0-9-]{36}$`;
- a returned-control event starts a new turn whenever the originating turn is
  not active, including when a different turn is active; the safe transition is
  to wait or reconcile without consuming the continuation until the thread is
  idle;
- restored continuation records are not validated, and conflicting duplicate
  event or attention identities can silently overwrite or be treated as a
  harmless duplicate;
- the transport-substitution check compares the same function call with itself
  rather than exercising two transport implementations;
- the local schema validator implements an undocumented subset of Draft
  2020-12 and uses permissive `Date.parse` checking without a supported-keyword
  audit;
- E3-E8 still omit substantial required transition matrices from the Phase 5
  experiment plan, including interleaved attention sources, crash-cut cases,
  full surface/restart transitions, continuation reorder/cancel cases, actual
  transport substitution, and complete task-launch default/override/restart
  behavior.

The implementation task received a bounded second correction set for these
items. Decision: **P5.0 remains open. P5.1 must not begin.**

## Second correction run — 2026-09-07

The bounded second correction set is implemented and ready for another master
re-review. This handoff does not self-accept P5.0, and P5.1 has not begun.

- task launch now uses the production `browserWorkspaceIdSchema` pattern,
  `^wrk_[a-f0-9-]{36}$`; every positive fixture uses a canonical id and a
  negative case rejects the former `wrk_primary` value;
- continuation records validate before indexing and reject conflicting task
  identities. A Return event steers only the exact originating active turn,
  starts only on an idle thread, and returns `wait_for_idle` without consuming
  when a different turn is active. Consumed event ids are forbidden outside
  the consumed state;
- event and attention keys accept exact duplicate delivery idempotently but
  reject content-changing identity collisions;
- the schema harness explicitly supports and recursively audits only the
  keywords used by these contracts, rejects every unknown keyword or format,
  and validates RFC 3339 syntax plus calendar/time ranges. It is an audited
  contract subset, not a general-purpose Draft 2020-12 implementation;
- E3–E8 now execute the requested isolated matrices: interleaved dual-authority
  attention, five crash cuts, streaming/pending presentation and restart
  transitions, continuation timing/restart/reorder/cancel paths, two concrete
  LocalProductApi adapters, and complete launch default/override/failure/
  presentation/restart paths;
- the direct in-memory and JSON encode/decode LocalProductApi adapters receive
  the same three-event versioned sequence. The remote fixture has no browser,
  approval, credential, receipt, or consequential-outcome authority.

The deterministic result is 65/65 checks. These are executable contract
compositions; actual App Server server-request concurrency, native renderer and
Desktop restart, Runtime crash injection, disposable authentication, and real
browser-profile lifecycle remain later integration qualification as identified
below.

Second-correction verification passed schema-manifest comparison, fixture
campaign, lint, typecheck, build, full 125-file/769-test suite, changed-file
formatting, and `git diff --check`. The first full-test attempt was sandboxed
and failed only where loopback servers and Chromium were denied; the identical
host-authorized rerun passed 769/769. The already accepted live harness was not
changed or rerun for this bounded contract-model correction.

## Master second re-review — 2026-09-07

The master reviewer independently reproduced the 65/65 deterministic campaign,
the exact schema-manifest comparison, and `git diff --check`. The previously
accepted live harness is unchanged. The canonical workspace id, idle-only
continuation, restored-record validation, collision handling, expanded matrices,
and local/cloud allowlist corrections are accepted.

P5.0 is not yet accepted because four contract-lock defects remain:

- `TaskLaunchAuthority.authorizeSessionStart` does not compare `roveTaskId`, so
  a different task with the same mode and workspace is authorized;
- `TaskLaunchAuthority.resolve` does not retain an active resolved launch, so
  the same task can be re-resolved from Agent to Capture while the contract says
  launch authority is immutable;
- a Return event is marked consumed before the selected `turn/start` or
  `turn/steer` command has a durable dispatch/outcome record, leaving a crash
  window that can produce zero continuation after restart;
- the claimed direct-memory transport also performs JSON encode/decode through
  the shared `clone` helper, while the schema audit accepts malformed keyword
  shapes and its purported strict RFC 3339 check accepts leap seconds at invalid
  dates and times.

The implementation task received a final bounded contract-lock correction set.
Decision: **P5.0 remains open. P5.1 must not begin.**

## Final bounded correction run — 2026-09-07

The four reproduced defects are corrected and ready for master re-review. This
handoff does not self-accept P5.0, and P5.1 has not begun.

Additional master stress testing rejected the initial 69-check version of this
correction: it persisted `possibly_started` after rather than before the wire
send, allowed cancelled outbox commands to retry, did not acquire workspace
leases, and had no concrete correlation field connecting a durable command id
to recovered Codex thread truth. The final revision below supersedes that
unreviewed intermediate result while preserving the finding here.

- `TaskLaunchAuthority` durably retains one active resolved launch per task.
  Exact re-resolution is idempotent; conflicting same-task resolution is
  rejected until an exact close releases the binding. Session authorization
  now verifies task identity as well as mode and workspace, and active bindings
  survive serialization/restart;
- a Return event now atomically records a stable host-authored continuation
  command in a durable outbox while the continuation remains pending. The host
  must durably commit `possibly_started` before sending on the wire. Restart
  reconciliation retries only definitely-not-started commands, awaits commands
  found through their correlation field in `thread/read`, fences uncertain
  possibly-started commands, and consumes the Return event only after terminal
  Codex truth;
- explicit-user-response continuations now validate thread identity before
  returning `pause`, while `wait_for_idle` still creates no outbox entry and
  leaves the record unconsumed;
- cancelling or superseding an undispatched command removes it; cancelling a
  possibly-started command retains a non-retryable reconciliation/interrupt
  fence. An undispatched steer converts to one same-id start when its origin
  becomes idle, while an undispatched start waits behind a new active turn;
- the direct LocalProductApi adapter uses `structuredClone` without wire
  encoding, while the fixture adapter explicitly performs JSON encoding and
  decoding. Per-adapter instrumentation proves which boundary ran, and both
  still deliver the same valid three-event sequence;
- the schema audit validates keyword shapes and values, including required
  arrays, property maps, enums, supported types, boolean
  `additionalProperties`, string bounds, numeric minimums, patterns, formats,
  and combinator containers. The deliberate date-time subset rejects all leap
  seconds rather than claiming calendar-aware leap-second validation.
- named-workspace resolution now atomically acquires a task lease. A second
  task fails until exact close releases the first task's lease, and the lease
  survives authority restart with the active launch.

The final deterministic result is 72/72 checks. Actual native persistence and
App Server/Runtime integration remain later qualification; the executable
models are contract oracles only.

Final-correction verification passed the schema-manifest comparison, fixture
campaign, lint, typecheck, build, changed-file formatting, and
`git diff --check`. A concurrent full-suite run passed 766/769 but three
browser-heavy cases exceeded their existing timeouts under contention; the
three affected files then passed serially at 52/52. The immediately preceding
clean host-authorized full run remains 125/125 files and 769/769 tests.

## Master final acceptance — 2026-09-07

The master reviewer independently reproduced the final 72/72 deterministic
campaign, exact schema-manifest comparison, the previously failing task-binding,
launch-immutability, workspace-lease, dispatch-fence, restart-correlation, and
schema-validation cases, plus lint, typecheck, build, changed-file formatting,
and `git diff --check`.

The already accepted live lifecycle and required-MCP evidence is unchanged. The
protocol assumptions remain consistent with the official Codex App Server
documentation: JSONL stdio is the stable default transport, initialization is
mandatory before other requests, thread and turn identity is explicit, and a
required MCP server fails thread startup rather than silently degrading.

The remaining native persistence, renderer/Desktop, Runtime crash-injection,
interactive authentication, packaging, and live-acceptance work is explicitly
assigned to later Phase 5 production and qualification gates; it is not
misrepresented as completed by these contract oracles.

Decision: **P5.0 is accepted and closed. P5.1 is authorized but has not begun.**

## Scope and evidence standard

This report records the P5.0 gate only. The experiment harness lives under
`experiments/phase5-app-server/` and is not imported by any production package.
It combines three kinds of evidence and labels them separately:

1. generated evidence from the installed Codex executable;
2. live protocol observations against that executable;
3. deterministic fixture contracts for product components that do not exist
   until later Phase 5 slices.

A passing fixture assertion is not represented as a live Desktop pass. Native
renderer/Desktop restart, real OAuth reauthentication, and the complete native
task product remain qualification work for P5.1–P5.9.

The current official reference is the
[Codex App Server documentation](https://developers.openai.com/codex/app-server).
It confirms version-specific schema generation, JSONL stdio, the mandatory
initialize handshake, required MCP failure behavior, thread/session identity,
dynamic model discovery, typed server requests, and experimental dynamic tools.

## Reproduction

```bash
pnpm phase5:p50:schema
pnpm phase5:p50:fixtures
pnpm phase5:p50:live
node experiments/phase5-app-server/live-app-server.mjs --mcp-boundary
node experiments/phase5-app-server/live-app-server.mjs --lifecycle
```

The first four commands are read-only or use isolated temporary state. The
lifecycle command uses the signed-in App Server data root, creates one dedicated
experiment thread, and archives that thread after the run. The harness never
prints tokens, account identifiers, raw transcripts, or Codex-home paths.

## Protocol baseline and drift evidence

Installed executable:

```text
PATH entry: /Users/habibkamil/.local/bin/codex
resolves to: /Applications/ChatGPT.app/Contents/Resources/codex
version: codex-cli 0.153.4
platform: macos/arm64
executable SHA-256: a30ec314bbd0e3721632234d07db7c99855db3b9f1e32dbe8c791947f07e7629
```

Generated with:

```text
codex app-server generate-ts --experimental --out <temporary>/ts
codex app-server generate-json-schema --experimental --out <temporary>/json
```

Evidence:

```text
files: 1,243
logical bytes: 4,623,543
aggregate relative-path/content digest:
  50cb262ffff7c4480e17f13a5667aeb5e3a411b2793a63327d03cc2d6cb6e5a5
legacy JSON bundle:
  b06f77062369d481a59cc70720c12b89cb9dd49c385863923262102d3ad6c978
v2 JSON bundle:
  e5f798fd1343c539f01fedea0e8a84a43c080fcca4615c80eb04a5edab4f7d0a
ClientRequest.ts:
  83418e6f3f8100fa59b0324afaaf45c8d258db3dd42a10769d9c337c93b910f2
ServerRequest.ts:
  1c5837adbfbdd005f387478ba87840808d1353b47b82dcf63739a78bb1c8d3be
```

The complete reproducible manifest is
`experiments/phase5-app-server/fixtures/schema-manifest.json`. The generated
tree is 1,243 files, so the experiment does not copy it into a production
package. P5.1 should check in only the reviewed bindings it compiles against or
a deliberately generated protocol package, while retaining this whole-bundle
digest gate.

### Drift from planning assumptions

- The version matches the planned `0.153.4` baseline.
- PATH does not identify a Rove-pinned binary; it points into the mutable
  ChatGPT application bundle. That is acceptable development evidence and is
  not a production resolution contract.
- The generated schema contains substantially more experimental surface than
  Phase 5 needs, including process, filesystem, plugin, app, remote-control,
  project, and environment APIs. Production must use an explicit allowlist,
  not expose the generated `ClientRequest` union wholesale.
- `InitializeParams.capabilities` is an explicit generated field. The P5.0
  client sent `experimentalApi: true` only for experiments. Production should
  default it to false and opt into no experimental method unless separately
  accepted.
- `turn/steer` includes mandatory `expectedTurnId`, directly supporting the
  proposed stale-active-turn rejection contract.
- `mcpServerStatus/list` reports a per-thread runtime status separately from
  auth status, and `authenticationRequired` is a distinct connection state.

## E1 — protocol lifecycle and drift

Result: live core lifecycle passed; adversarial response-correlation rules
passed in the isolated client fixture.

Observed live:

- request before initialize rejected with JSON-RPC `-32600`, `Not initialized`;
- initialize/initialized completed and identified App Server `0.153.4`;
- malformed JSON produced a parse diagnostic and did not terminate the server;
- redacted account read succeeded for a ChatGPT account;
- model discovery returned nine account-visible entries, two hidden;
- rate-limit and usage reads were available for the signed-in account;
- a dedicated thread started, listed, read, resumed, archived, unarchived, and
  was archived finally;
- one ordinary turn completed with 1,830 observed agent-message delta events
  across the lifecycle campaign;
- steering with the exact active turn id succeeded;
- interrupting a separate active turn succeeded;
- process restart followed by `thread/read` recovered the thread as
  `notLoaded`; the harness did not replay a turn.

Fixture client rules additionally reject malformed input, duplicate response
ids, and unknown response ids, and classify outstanding requests at process
loss as transport-uncertain.

Remaining qualification: deliberately kill the real App Server before its
request response and at several exact stream boundaries with the P5.1 host's
restart/backoff implementation. The P5.0 probe establishes protocol behavior,
not the not-yet-built supervisor.

## E2 — required Rove MCP boundary

Result: standard required MCP passed with an isolated stdio fixture; the
currently configured live Rove server identity/catalog also matched.

- exact configured server name: `rove`;
- exact MCP `serverInfo.name`: `rove`;
- expected catalog: 29/29 names matched
  `apps/mcp/src/server/tool-catalog.ts`;
- per-thread startup state: `connected`;
- startup status notifications observed: 2;
- task-bound call succeeded;
- the same call with another `roveTaskId` was rejected;
- screenshot result retained `image` plus `text` evidence content;
- a nonexistent required server failed `thread/start` visibly with `-32603`;
- no alternate Rove, Computer Use, or browser authority exists in the fixture;
- dynamic tools remain rejected as the production path because the generated
  field and call flow are experimental and duplicate MCP schema/dispatch.

The signed-in global App Server configuration also reported `rove`,
`serverInfo.name = rove`, and 29 matching tools. Production must not inherit
that user's global configuration; it must generate a Rove-owned task-scoped
configuration.

Remaining qualification: real OAuth reauthentication for an MCP server was not
forced because doing so would alter an existing account connection. P5.4 must
exercise `authenticationRequired` with a disposable OAuth fixture or test
tenant.

## E3 — approvals and handoff concurrency

Result: proposed identity and attention-queue contract passed 5/5 executable
assertions; live native integration remains unimplemented.

The fixture stores Codex attention under JSON-RPC request id plus
thread/turn/item identity and Rove attention under session plus ownership
generation. Command, file, network, permission, MCP elicitation, and user-input
requests are interleaved with independent Take Over, Pause, and Return events
while retaining exact identity. A cross-authority, stale, or identity-colliding
resolution fails. Turn cancellation clears turn-scoped Codex requests without
consuming task-scoped Rove attention.

Production direction: one ordered projection may render both, but response
dispatch stays in separate typed handlers. P5.5 must reproduce the fixture with
actual App Server server requests and Runtime control transitions.

## E4 — crash and outcome reconciliation

Result: 3/3 recovery-policy checks spanning five crash-cut compositions passed;
App Server process restart/read passed live. Browser mutation crash injection
remains a later integration gate.

The fixture covers failure before response, mid-stream, during approval,
during an ordinary Rove action, after consequential dispatch, and after a
receipt exists but before Codex observes it. Only a request proved not started
is replay-eligible. Any possibly dispatched browser mutation is reconciled from
fresh Runtime observation/receipt and is never blindly replayed.

Production direction: the App Server host returns `transport_uncertain` for
outstanding requests, the task coordinator reconciles thread truth, and the
existing Runtime receipt/consequence fence remains the only authority for
external browser outcome.

## E5 — unified-surface continuity

Result: 2/2 P5.0 projection compositions passed. Existing Phase 1–4 unified-surface
tests remain the production baseline; a conversation-aware native surface does
not exist yet.

Chip, expanded, full, close/reopen, renderer reprojection, and fullscreen
context preserve task, session, controller, thread, and approval identities.
The fixture always chooses exactly one active native host.

Production direction: extend the existing main-process unified surface store
with Codex projection state. Do not add a conversation-specific renderer store
or polling loop. Actual renderer, Desktop, fullscreen, and pending-attention
restart scenarios are P5.6/P5.7 gates.

## E6 — durable human-return continuation

Result: 10/10 continuation compositions passed; durable production persistence and
live Codex/Runtime composition remain unimplemented.

Covered fixture cases:

- return before or after bounded wait transport completion;
- active originating turn selects steer;
- idle thread selects exactly one continuation turn;
- a different active turn selects wait without consuming the continuation;
- duplicate event, stale generation, and mismatched session reject;
- cancellation rejects;
- explicit-user-response policy stays paused;
- serialized state preserves identity across renderer, App Server, and Desktop
  restart;
- consumed continuation requires fresh browser inspection;
- a durable stable-id outbox survives before-dispatch, accepted-before-local-
  acknowledgement, and terminal-outcome crash cuts without zero or duplicate
  continuation;
- continuation is host-authored and cannot appear as a user message.

Production direction: persist the proposed record before surfacing human
attention, consume the Runtime event transactionally by unique event id and
generation, then reconcile thread state before choosing steer versus turn.

## E7 — account, catalog, usage, and local/cloud seam

Result: signed-in and isolated logged-out App Server states passed live; 9/9
projection/trust-boundary fixtures passed. Interactive login/logout mutation
was not performed on the user's account.

Live evidence:

- signed-in account, plan, rate limits, usage, hidden models, and supported
  effort sets were discoverable;
- isolated Codex home reported logged out;
- rate-limit and usage reads failed visibly while logged out;
- the logged-out catalog differed from the signed-in catalog (11 versus 9
  entries and different hidden/default details), proving it cannot be hard
  coded.

Fixture evidence covers browser-login completion, device-code ownership,
refresh without token projection, logout projection, rate-limit replacement,
catalog replacement, unavailable usage, unsupported effort rejection, and
equivalent logical envelopes across direct-memory and JSON encode/decode
fixture transports.
Only explicitly allowlisted envelope and payload fields serialize; direct
unknown or sensitive fields are rejected by the schema.

Production direction: account tokens stay exclusively in the App Server data
root. The local/cloud boundary carries redacted task metadata and ordered
events only. Actual browser-login, device-code completion, refresh, and logout
must be run with a disposable qualification account in P5.2/P5.7.

## E8 — task launch mode and browser identity

Result: 11/11 launch-contract compositions plus 23/23 direct schema and
schema-audit cases passed.
Existing workspace/runtime
tests provide lower-level production evidence; the native pre-Codex composer
does not exist yet.

All six Agent/Companion/Capture × named-workspace/Temporary combinations
resolved. Capture begins human-controlled; Agent and Companion begin
agent-controlled. Missing selection, missing workspace, lease contention, and
agent mismatch reject without fallback. One-time override leaves remembered
defaults unchanged. Serialization/restart and presentation changes preserve the
resolved launch. Temporary cleanup is explicit.

Production direction: resolve and persist the task launch before the first
Codex turn, bind it into the opaque task capability, and reject mismatched
`session.start`. Real persistent-auth continuity and temporary directory
cleanup remain P5.6/P5.7 end-to-end gates even though their lower-level browser
contracts passed before P5.0.

## Deterministic pass/fail counts

`pnpm phase5:p50:fixtures`:

| Experiment |   Pass |  Fail |
| ---------- | -----: | ----: |
| Schemas    |     23 |     0 |
| E1         |      5 |     0 |
| E2         |      4 |     0 |
| E3         |      5 |     0 |
| E4         |      3 |     0 |
| E5         |      2 |     0 |
| E6         |     10 |     0 |
| E7         |      9 |     0 |
| E8         |     11 |     0 |
| **Total**  | **72** | **0** |

`pnpm phase5:p50:schema`: 1 manifest comparison passed, 0 failed.

Live observations and self-verification outcomes are recorded in
`fixtures/live-results-2026-09-07.json`; they are not added to the deterministic
check count. Every live command now fails its process on a required false
observation.

### Repository and compatibility verification

| Command                                          | Result                                               |
| ------------------------------------------------ | ---------------------------------------------------- |
| `pnpm typecheck`                                 | pass, 8 typed workspace projects                     |
| `pnpm lint`                                      | pass, 0 findings                                     |
| `pnpm build`                                     | pass, 8 built workspace projects                     |
| `pnpm test` / final JSON reporter run            | pass, 125 test files, 769/769 tests                  |
| targeted continuity/workspace/control/replay run | pass, 5 files, 37/37 tests                           |
| serial browser timing recheck                    | pass, 4 files, 119/119 tests                         |
| `pnpm test:e2e`                                  | pass, 1 file, 2/2 stdio and authenticated HTTP tests |
| `pnpm browser:compat`                            | pass, 19 passes and 4 documented limitations         |
| `pnpm browser:doctor`                            | pass; sandbox introspection remains `unknown`        |
| changed-file Prettier check                      | pass                                                 |
| `git diff --check`                               | pass                                                 |

One broad JSON-reporter attempt overlapped an earlier still-running broad test
process and reported 761/769 with eight browser timeout failures. The four
affected files then passed serially at 119/119, and a clean non-overlapping full
run passed 769/769. No affected file is part of the P5.0 experiment changes.

Desktop packaging was not rebuilt: P5.0 adds no packaged production component,
and a package smoke here would only requalify the unchanged Phase 1–4 package.
Packaged App Server resolution is a mandatory P5.1/P5.7 gate.

## Proposed production contract decisions

### Compatibility

Adopt `contracts/compatibility-manifest.json` with exact allowed tuples:
version, platform, architecture, executable digest, generated-schema digest,
and required handshake/capabilities. Do not accept a semver range based on one
observed version. A new Codex build requires regeneration, reviewed diff, and
the full contract campaign.

### Task launch

Adopt `contracts/task-launch.schema.json`. Resolve both user-visible axes before
browser work, retain the active launch by task, and freeze it until exact close.
Exact redelivery is idempotent; conflicting same-task resolution and cross-task
session authorization fail closed. The MCP capability carries the resolved
values but cannot change them. Named-workspace resolution atomically acquires a
task lease which only the exact active launch can release.

### Durable continuation

Adopt `contracts/durable-continuation.schema.json`. Persist exact task, thread,
originating turn, session, handoff ID, generation, pre-handoff observation
sequence, and explicit policy. Bind those immutable observation fields with a
SHA-256 fingerprint: exact replay remains a no-op regardless of mutable
lifecycle state, while changed immutable input is a collision. Atomically
persist the exact Return event ID and observation sequence before checking
whether the Codex thread is eligible, then persist one stable continuation
command and commit its
`possibly_started` state before the wire send, then consume the authoritative
Return event only after terminal Codex truth. Carry the command id in the
host-authored payload so `thread/read` can reconcile it. On restart, retry only
a definitely-not-started command and fence a possibly-started command until
thread truth resolves it. Steer the exact originating turn, start on an idle
thread, or remain pending while a different turn is active. Invalidate targets
and inspect the browser freshly before continued work.

### 2026-09-08 continuation contract symmetry extension

The accepted P5.0 lock has been extended—not reopened—to keep its executable
oracle symmetric with the P5.6/P5.7 production record. The durable-continuation
schema and contract model now carry `handoffId`, `observationFingerprint`,
`preHandoffObservationSeq`, `returnEventId`, and `returnObservationSeq`, and
validate the same pending, dispatch-recorded, consumed, cancelled, and
superseded shapes used by production.

An exact observation fingerprint replays as a no-op in every lifecycle state;
immutable drift rejects. Generation-only legacy records without a handoff ID
or fingerprint remain explicitly readable. Production restore can migrate a
pre-fingerprint handoff record in memory, while newly canonical persisted
handoff records require the fingerprint. The deterministic oracle now passes
75/75 checks.

### Local/cloud trust boundary

Adopt `contracts/local-cloud-boundary.json`. Codex credentials, browser cookies,
local files, raw capabilities, approvals, receipts, and consequential-outcome
authority remain device-only. The cloud can relay signed user intent and
redacted ordered events but cannot execute or declare success.

## Assumption disposition

### Passed

- `0.153.4` generates deterministic TypeScript and JSON schema bundles.
- stdio is newline-delimited and requires initialize/initialized.
- account, models, efforts, rate limits, and usage are discoverable.
- thread/session/turn identities are returned and usable for lifecycle calls.
- expected-turn steering and exact-turn interruption work.
- a required standard MCP server can fail thread start closed.
- exact Rove identity/catalog and normal image content survive the MCP/App
  Server boundary.
- process restart permits truth-based thread reconciliation without replay.

### Failed or disproved

- PATH resolution is not a sufficient production compatibility lock; the
  current path is a symlink into a mutable ChatGPT application bundle.
- One observed CLI version does not justify a compatible version range. The
  manifest must allow exact reviewed tuples initially.
- The model catalog cannot be hard coded or inferred only from the plan/account
  name; authenticated and logged-out catalogs differed during the same run.
- The whole generated experimental API must not become Rove's production RPC
  surface; it includes many excluded capabilities.
- An MCP catalog count alone is insufficient. Exact names and server info must
  match before the first task turn.

### Unverified

- real MCP OAuth reauthentication-required completion;
- browser and device-code login completion, token refresh, and logout with a
  disposable account;
- actual concurrent command/file/network/permission/elicitation/user-input
  requests alongside Runtime takeover;
- every crash injection during live browser dispatch and receipt persistence;
- conversation-aware renderer/Desktop/fullscreen restart continuity;
- durable continuation composed with a real timed-out `control.wait`;
- all native launch combinations through the future composer;
- packaged binary resolution and packaged Desktop smoke for P5.1 artifacts;
- Windows, Linux/Wayland, and physical multi-monitor P5 behavior.

## P5.1 component inventory

P5.1 and later production slices will need:

1. `CodexExecutableResolver` with packaged/development resolution policy;
2. `CodexCompatibilityGate` backed by exact manifest tuples;
3. reviewed generated-protocol package or bindings subset;
4. `CodexAppServerHost` for stdio supervision, stderr diagnostics, bounded
   restart/backoff, and shutdown;
5. `CodexRpcClient` for handshake, ids, timeouts, typed responses,
   notifications, server requests, and uncertain transport loss;
6. `CodexConversationStore` with idempotent terminal-event precedence;
7. `RoveTaskContextAuthority` and durable task/thread/session associations;
8. generated required-MCP configuration and task capability issuer;
9. exact Rove MCP readiness/catalog verifier and competing-browser exclusion;
10. separate Codex approval and Rove-control responders plus unified attention
    projection;
11. durable continuation event store/consumer;
12. versioned `LocalProductApi` command/event seam;
13. redacted account/model/usage projection;
14. combined main-process product store reused by every presentation;
15. crash-injection, protocol-drift, packaging, and disposable-auth
    qualification harnesses.

Successful experiment implementations must be rewritten into these cohesive
production boundaries. The isolated models in `contract-models.mjs` are
executable contract oracles, not code to copy into application directories.

## Review risks and required reproduction

The master reviewer should reproduce schema verification, the 72 deterministic
assertions, the isolated required-MCP run, and at least one signed-in lifecycle
run. The signed-in run requires host access to the Codex data root; under the
repository sandbox it fails before protocol startup because SQLite state cannot
initialize.

The most material remaining risk is that P5.0 isolated contract compositions may reveal
integration mistakes only when P5.1–P5.7 compose real persistence, UI, Runtime,
and server-request timing. Therefore this evidence is a contract lock proposal,
not a claim that the future product paths already pass.

Explicit stop point: P5.0 experiment fixtures, evidence, and proposed contracts
only. No P5.1 production implementation was begun.
