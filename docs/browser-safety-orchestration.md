# Browser safety orchestration

Rove is a user-authorized browser assistant. This layer keeps automation at a
human scale, separates browser perception from operational policy, hands
human-only steps back to the user when appropriate, and stops unsafe or
unresolved autonomous mutation. It is a safety boundary, not a promise that
sites will permit automation and not an anti-detection or CAPTCHA-solving
system.

## Perception, policy, and orchestration

F1 browser perception and F2 Runtime policy have separate responsibilities:

```text
Browser
  │
  ▼
F1 perception
  │  PagePerceptionAssessment
  │  PageStatePropositions
  ▼
F2 PageStatePolicy
  │  PagePolicyDecision
  ├──────────────► browser.inspect returns result
  │
  └──────────────► explicit orchestration boundary
                    session_start / post_action
                              │
                              ▼
                       possible control transition
```

The browser package answers what is happening on the page. It does not decide
who should own browser control.

Runtime policy answers what autonomous mutation is currently allowed. The
policy is pure and does not modify session state.

`PagePolicyOrchestrator` is the only page-policy component that may translate a
policy decision into an automatic ownership transition, and it is invoked only
at session-start and post-action boundaries.

MCP remains an adapter. It does not own page policy or control state.

## Inspection contract

Runtime-returned `browser.inspect` results expose:

- `metadata.pageState` — observational page-state perception;
- `metadata.pageStatePropositions` — bounded F1 propositions when available;
- `metadata.pagePolicy` — the Runtime's `PagePolicyDecision`.

Inspection is observational. Calling `browser.inspect` repeatedly cannot change
the session's `status`, `controller`, or `handoff`.

The policy dispositions mean:

| Disposition        | Operational meaning                                                                                                               |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `continue`         | The current inspected state authorizes mutation, subject to freshness, target, budget, and repeated-action checks.                |
| `wait_and_inspect` | Mutation is blocked while the page is unstable, unresolved, or insufficiently confident. No ownership transition occurs.          |
| `request_human`    | Human collaboration is appropriate. Automatic handoff is still performed only by the Runtime orchestrator at an allowed boundary. |
| `stop`             | Autonomous mutation must stop for the current state. No automatic handoff occurs.                                                 |

An MCP agent should interpret these semantics rather than follow a hard-coded
tool-call sequence.

## Page-state behavior

The authoritative F2 behavior is:

| Page state                | Policy             | Automatic ownership behavior                                    |
| ------------------------- | ------------------ | --------------------------------------------------------------- |
| `ready`                   | `continue`         | no transition                                                   |
| `loading` / unstable      | `wait_and_inspect` | no transition                                                   |
| `authentication_required` | `request_human`    | Agent/Companion may request handoff at orchestration boundaries |
| `human_verification`      | `request_human`    | Agent/Companion may request handoff at orchestration boundaries |
| `access_restricted`       | `stop`             | no automatic handoff                                            |
| `unknown_interstitial`    | `stop`             | no automatic handoff                                            |
| `error`                   | `stop`             | no automatic handoff                                            |

Capture Mode starts human-owned. Page policy remains visible, but authentication
or human verification does not convert an `active / human` Capture session into
`awaiting_human / null`.

`control.request_human` remains an explicit agent capability and is broader
than automatic policy. For example, an agent may explicitly request human
review of an unknown interstitial even though its automatic page policy is
`stop`.

## Mutation authorization and freshness

A successful inspection records both perception and the corresponding
`PagePolicyDecision`. Later autonomous mutation requires the recorded decision
to allow mutation and still requires the existing F1/runtime safety checks,
including:

- fresh page revision;
- fresh semantic page-state identity;
- valid revision-scoped target references;
- action budget;
- repeated-action protection.

Out-of-band navigation, semantic decision changes, or human-to-agent handback
therefore require a fresh inspection before mutation.

After human control returns, all page target references are invalidated before
agent ownership is restored.

## Responsible browsing boundary

Rove does not spoof browser fingerprints, conceal automation or developer
tooling, rotate proxies, solve CAPTCHAs, or bypass site access controls.

Authentication secrets, MFA responses, passkeys, CAPTCHA/security verification,
and other human-only steps remain human responsibilities.

A site restriction is authoritative. `access_restricted` stops autonomous
mutation, but the restriction itself is not treated as proof that control must
automatically transfer to a human.

## Deterministic regression coverage

The automated F2 acceptance surface includes:

| Scenario                                  | Expected result                                                                        |
| ----------------------------------------- | -------------------------------------------------------------------------------------- |
| Ready page                                | `continue`; mutation may proceed                                                       |
| Loading/unstable page                     | `wait_and_inspect`; no handoff                                                         |
| Authentication                            | `request_human`; Agent/Companion automatic requested handoff at orchestration boundary |
| Human verification                        | `request_human`; Agent/Companion automatic requested handoff at orchestration boundary |
| Explicit restriction / HTTP 403           | `stop`; agent ownership preserved                                                      |
| Unknown interstitial                      | `stop`; agent ownership preserved                                                      |
| HTTP 5xx/error state                      | `stop`; agent ownership preserved                                                      |
| Capture Mode                              | human ownership preserved for every page-policy state                                  |
| Repeated direct inspection                | policy returned; ownership unchanged                                                   |
| Explicit human request on stop-only state | `control.request_human` remains available                                              |
| Out-of-band revision change               | `INSPECTION_REQUIRED`                                                                  |
| Semantic fingerprint change               | `INSPECTION_REQUIRED`                                                                  |
| Return from human control                 | `INSPECTION_REQUIRED` until reinspection                                               |

F1 perception acceptance, privacy/freshness guarantees, runtime control tests,
and the whole-repository regression remain release gates.

## Release boundary

F2 establishes who may request an automatic ownership transition and why. It
does not introduce ownership epochs or concurrency fencing; that remains an F3
concern.

The intended architecture after F2 is deliberately small:

```text
one F1 perception path
        ↓
one PageStatePolicy evaluator
        ↓
one PagePolicyOrchestrator
```

No generic rules engine, workflow DSL, or policy implementation belongs in MCP
or the browser package.
