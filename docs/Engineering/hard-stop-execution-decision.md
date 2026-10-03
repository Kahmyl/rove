# Exact Local Execution Supervision

**Status:** Authorized and implemented for the base `rove_task` permission profile on 27 September 2026. Exact macOS process ownership, termination, observed exit and owner-crash recovery are qualified. Codex remains the authority for permission profiles, approval review and amendments. Elevated execution is a provider-contract blocker until Codex exposes supported exact grant consumption on the authoritative connection; packaged cross-platform qualification also remains open.

## Decision

Rove owns the control boundary for every local command that a Rove Task can start. Codex may decide that a command is useful and may supply its arguments, but it may not start an opaque local process outside this boundary. Rove assigns the execution identity before dispatch, persists its Task/thread/turn/tool-call ownership, applies the frozen Task permission policy, requests any required approval through the existing exact approval contract, and delegates the OS launch only to a managed execution component whose protocol provides exact termination and observed-exit evidence.

The customer meaning of **Stop** does not change. Rove may project **Stopped** only after every nonterminal execution owned by the stopped Task/turn/operation has an authoritative exit receipt. Codex `turn/interrupt` is still required to stop model work, but it is neither execution termination nor evidence of it.

This is a bounded local-command subsystem. It is not a general scheduler, remote execution platform, terminal manager, or replacement Task engine.

## Provider evidence and selected integration boundary

The former selected Codex App Server `0.154.0-alpha.6.2` and candidate `0.155.0-alpha.9.2` both report a turn interrupted while a yielded provider-owned command continues to its delayed completion sentinel. Rove therefore promoted exact `0.155.0-alpha.9.2`, SHA-256 `9280c0754e8f1f6b72f495d30c8c82a006dbc4995bf0492916fa0901f6bfd1f9`, only after qualifying a different execution boundary; provider `turn/interrupt` did not become termination authority.

Candidate App Server schemas add three useful supported boundaries:

- thread-scoped dynamic tools deliver exact `threadId`, `turnId`, `callId`, tool name and arguments before host execution;
- sandboxed `command/exec` accepts a client-supplied connection-scoped process identity and exact command/cwd/environment/sandbox inputs;
- `command/exec/terminate` targets that exact identity, while the original `command/exec` response is deferred until the process has actually exited and output delivery has drained.

A credential-free macOS arm64 process qualification against selected `0.155.0-alpha.9.2` proved the delegate primitive under the named `rove_task` permission profile: the App Server owner started outside the Task workspace, two distinct Rove-supplied identities ran concurrently in the Task workspace, and terminating one returned its final exit response with code 137, prevented its delayed child sentinel, and did not affect the unrelated execution, which exited 0 and wrote its sentinel. Killing the exact App Server owner also prevented a separately launched command tree's delayed sentinel, establishing the platform-specific whole-owner proof used during restart recovery. The retained rollback component `0.154.0-alpha.6.2` passed the same strengthened boundary qualification. The first nested attempt from an already restricted test sandbox caused both commands to exit 71 and is not represented as a pass; only permission-correct OS-boundary runs are qualification evidence.

Rove will use the dynamic-tool callback as the only model-to-local-command entry point and the managed App Server `command/exec` implementation as a replaceable OS execution delegate. The App Server remains a dependency; ownership comes from Rove assigning and durably binding the identity, controlling the connection generation, retaining the pending request, and refusing to settle termination until the original final response or a stronger whole-owner shutdown proof is observed.

The available candidate's standalone `exec-server` is not the local ownership boundary. A process-backed probe established that it requires a remote registration URL and environment identity even when asked to listen locally. Adding a remote control dependency solely to obtain local Stop authority would expand Rove's trust and availability surface without a product requirement.

The selected component is now `0.155.0-alpha.9.2`; its generated schemas and compatibility manifest are repository-bound, and component verification requires exact execution evidence. Production thread start registers only the Rove-owned `rove_exec` dynamic tool and disables provider local-execution routes. Resume relies on the provider-persisted dynamic-tool registry and keeps the same disabled feature set.

This cutover does not close the market-readiness blocker. Standalone `command/exec` accepts one named permission profile but does not expose the turn's existing approval reviewer or consume an exact, turn-scoped additional-permission grant. Base-profile commands therefore run with preserved sandboxing, while commands beyond that profile fail closed. Rove will not create a second approval/grant authority or derive an equivalent profile from approval text, active-profile projection, command failure, filesystem paths or model wording. A supported provider seam is required; packaged Windows and Linux process-tree behavior also remains unqualified.

## Authority model

An execution identity is an opaque random Rove identity, never an OS PID and never provider display metadata. Its immutable ownership tuple is:

| Field                                | Purpose                                                                          |
| ------------------------------------ | -------------------------------------------------------------------------------- |
| `executionId`                        | Rove primary identity assigned before external dispatch                          |
| `taskId`                             | owning durable Task                                                              |
| `taskOperationId`                    | accepted message/continuation operation whose turn may execute work              |
| `threadId` / `turnId` / `toolCallId` | exact provider request authority                                                 |
| `connectionGeneration`               | App Server transport generation that owns the process namespace                  |
| `delegateProcessId`                  | Rove-assigned connection-scoped `command/exec` identity                          |
| `commandDigest`                      | immutable digest of argv, cwd, bounded environment changes and execution options |
| `permissionProfile`                  | frozen Task policy and any exact approved amendment used for this dispatch       |

The tuple is unique. A repeated dynamic-tool call with the same exact tuple returns the existing outcome or remains attached to the existing execution; it never launches a second process. A different Task, turn, call, connection generation, command digest or permission generation cannot control it.

Current UI selection, newest Task/process, process name, an opaque provider item PID, thread-wide terminal cleanup and broad process killing are never authority.

## Durable lifecycle

Execution state is append-only evidence projected into one current row:

```text
requested -> dispatching -> running -> exit_observed
                    \         \-> termination_requested -> exit_observed
                     \-> dispatch_unknown
```

`requested` is durable before `command/exec` dispatch. `dispatching` is durable before the RPC leaves Rove. The first exact output notification records confirmed delegate acceptance as `running`; a command that produces no output may move directly from `dispatching` to its authoritative final response. `termination_requested` records Stop intent before the terminate RPC. `exit_observed` contains the final exit code, termination cause, output-finalization fact, timestamps and receipt digest. `dispatch_unknown` and lost-connection states are nonterminal customer uncertainty, never success.

Output is bounded and sequenced per execution. Once termination is requested, new output may be retained as diagnostic evidence but cannot authorize another action, complete a Task result, or reopen customer-active work. Final output is accepted only before the exact exit receipt's terminal sequence.

The execution ledger belongs beside the Task process ledger in the local SQLite Product authority. Persistence uses a schema migration, foreign-key/uniqueness constraints for the immutable tuple, bounded output metadata rather than unbounded transcript duplication, and atomic state transitions. Credentials, full inherited environments and approval secrets are not persisted.

## Stop protocol and races

One accepted Stop operation performs these responsibilities in order:

1. durably fence new turns, tool calls and queued promotion for the current accepted work;
2. snapshot the exact nonterminal executions owned by the Task and active turn;
3. persist termination intent for each execution;
4. issue exact delegate termination on its owning connection generation;
5. continue observing each original `command/exec` request until its final exit response and output drain;
6. interrupt the exact Codex turn and observe provider terminal truth;
7. settle the Stop operation only when both provider terminal truth and all owned execution exit receipts are durable;
8. retain the queue and allow an ordinary follow-up to create new work with new identities.

Natural exit racing Stop is success only when the final exit receipt wins before or after termination intent. A terminate acknowledgement without the final response is insufficient. An execution created concurrently from the same turn after the Stop fence is rejected and answered as failed without dispatch. Duplicate Stop is idempotent on the same operation identity. A stale Stop, wrong Task/turn/call, superseded connection generation or changed command digest is rejected without signalling anything.

## Restart and recovery

The App Server host is a managed process owner with a durable connection generation. A normal connection replacement or Desktop shutdown first terminates and settles executions owned by the current generation before closing the host. Rove does not infer exit merely from transport disconnection.

At startup Rove reconciles every nonterminal execution before accepting new work:

- an execution from the current live owner generation remains attached to its in-memory pending request and is not recovered by heuristic lookup;
- an execution from a prior generation is settled only through the qualified whole-owner-death invariant, with an `owner_shutdown` exit receipt bound to the original immutable authority tuple;
- owner-death proof is accepted only on platforms and package layouts where process-backed qualification establishes that all connection-scoped command trees die with that owner;
- if identity or containment cannot be proved, retain a bounded recovery blocker and never report Stopped.

Rove never sends a destructive signal to a persisted numeric PID alone. Process birth identity, executable/component digest, Rove instance nonce and the private owner channel must agree. Failure to prove ownership is a customer-visible inability to confirm termination, not permission to guess.

## Security and approval preservation

The execution boundary receives the frozen Task workspace, named `rove_task` permission profile, approval reviewer, bounded environment and explicit attachment/capability grants from authoritative Task launch state. Model-supplied cwd, paths, environment names or escalation wording are requests, not authority.

Commands already permitted by the frozen profile run in the same provider sandbox. A command requiring broader permission must enter the existing Task-bound approval flow before dispatch, with exact command/material, amendment, Task, turn, call and generation. Ask-for-approval and automatic-review modes retain their documented meanings. A declined, stale or structurally changed request cannot be retried through the execution tool or another capability. Consequential external actions continue to require their separate Rove authorization; shell approval never substitutes for it.

The selected App Server API does not yet preserve this approval behavior: standalone `command/exec` can select the frozen named profile, but cannot receive the turn's approval reviewer or an exact approved permission amendment. Provider shell tools remain disabled because leaving an opaque alternate launch path would violate exact Stop authority. Rove therefore fails closed outside the base profile and keeps STAB-12 open. Only a supported provider extension with the contract below can close this gate; Rove must not silently downgrade approval semantics, run unsandboxed, or manufacture a parallel grant.

Only a restricted environment allowlist reaches the delegate. Tokens, credential-store material, unrelated browser state and another Task's capability token are excluded. Logs store identities, transition names, durations, exit/termination classifications and redacted digests, not raw secrets or unlimited command output.

## Provider grant-consumption contract

The authority decision is final for this stage: Codex owns permission profiles, human/automatic review and approval amendments; Rove owns execution identity, supervision and cancellation. Rove will adopt elevated execution only when a supported provider protocol supplies all of the following:

1. **Provider-issued grant identity.** After the exact `item/permissions/requestApproval` decision, Codex returns or exposes an opaque grant identity or equivalent protocol object. It must represent the provider's exact granted profile and advertised `turn` or `session` scope; Rove cannot reconstruct it from the response body.
2. **Exact authority binding.** Consumption is validated by Codex on the same authenticated App Server owner connection and is bound to the provider connection generation, thread, turn, approval request/item identity, base permission profile, reviewer result, exact granted-profile digest and scope. Dispatch also binds the Rove dynamic-tool call and Rove execution/process identity so a different Task, call or command cannot substitute itself.
3. **Atomic dispatch semantics.** The supported execution request accepts that provider grant together with the exact argv, cwd, bounded environment, timeout and Rove process identity. Codex validates the requested operation against its grant before process creation and reports a typed rejection without side effects when any material differs or exceeds the grant.
4. **Replay rules.** An exact retry of the same Rove execution/tool-call identity returns or reattaches to the same provider execution; it never starts another process. Reuse by a different execution, command digest, Task, turn or connection is rejected. Any provider-supported multi-use `turn` or `session` grant remains provider-validated on every dispatch; Rove does not infer reuse authority from the scope label.
5. **Expiry and revocation.** A turn grant expires no later than terminal turn state, interruption, Stop fencing, connection loss or explicit provider revocation. A session grant expires no later than session/thread closure, account or reviewer-policy change, connection-owner replacement or explicit revocation. No grant silently survives App Server/Desktop restart unless the provider exposes a durable, authenticated reattachment protocol with the same exact bindings; absence of that protocol means fail closed.
6. **Observable rejection.** Declined, cancelled, expired, consumed, structurally changed, cross-authority and stale-generation grants produce distinguishable protocol failures. A generic shell failure, current active profile, UI selection or missing output is never grant evidence.

The retained `agent:provider-grant-boundary` harness currently proves the negative contract without credentials or a model turn: selected and rollback providers do not consume synthetic thread/turn/tool-call/grant binding fields as elevated authority. The current provider accepts unknown fields but still applies `rove_task`, so an attempted out-of-profile write is denied; this permissive parsing is explicitly not grant evidence. The ordinary base-profile control remains separately qualified. A promising provider version may be adopted for elevated execution only after the harness is extended to its supported protocol and process-backed runs prove both **Ask for approval** and **Approve for me**, exact grant consumption, decline/cancel, changed-material rejection, replay, scope expiry, connection replacement, restart and Stop/process-tree behavior. Schema presence or acceptance of extra fields is insufficient.

## Observability

Structured diagnostics include execution/Task/turn/call identities, connection and owner generations, state transition, dispatch/termination/exit latency, command and permission digests, output byte/truncation counts, delegate/component identity, recovery disposition and stale-authority rejection reason. Metrics distinguish natural exit, requested termination, forced owner shutdown, timeout, delegate loss, proof failure and policy rejection.

Every diagnostic lookup remains Task-scoped. Customer presentation uses bounded language: **Stopping** while proof is pending, **Stopped** only after proof, and **Unable to confirm stop** for exhausted recovery.

## Qualification gates

The implemented base-profile boundary is covered by automated and process-backed tests for:

- schema validation and uniqueness for every identity and receipt;
- exact Task/turn/call routing and rejection of stale, cross-Task and wrong-generation control;
- idempotent duplicate callback and duplicate Stop handling;
- natural-exit/Stop, spawn/Stop, terminate/exit, output/exit and reconnect races;
- one exact termination receipt and no delayed sentinel or late normal effect;
- child/grandchild process-tree termination with an unrelated Task process surviving;
- crash cuts before dispatch, after dispatch, after termination request, after delegate exit and before receipt commit;
- App Server/Desktop restart recovery without redispatch or optimistic settlement;
- queue retention and an ordinary follow-up starting new work;
- bounded output and redacted diagnostics;
- selected and retained-rollback component qualification and representative macOS process-backed behavior.

The release gate remains open for:

- permission-profile parity beyond the base profile, including human and automatic review, decline and stale-grant rejection;
- packaged application qualification and representative Windows and Linux process-tree behavior;
- a final full-repository qualification after the approval boundary is complete.

Synthetic renderer state, a provider `interrupted` turn, terminate acknowledgement, missing UI activity and a discarded late sentinel cannot satisfy these gates.
