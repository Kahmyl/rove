# ROVE-STAB-05 — Startup hydration and degraded-state UX

**Sprint:** Rove Market-Readiness Stabilization  
**Status:** Complete
**Dependencies:** STAB-03, STAB-04  
**Planning baseline:** `f26f2f1e7ff3bf3ff4f674ebeb234daf5fedbd2d`

This ticket is part of one stabilization sprint. It is not a separate sprint or release phase. Work must stay within this ticket's invariant, receive ticket-level verification, and be checkpointed before the next ticket begins.

## Continuity entry contract

A prior ticket handoff is **continuation state, not live repository truth**. Before acting, run `pnpm codex:context`, verify the intended checkout/branch/HEAD/worktree, compare it with [continuity-ledger.md](continuity-ledger.md), and reconcile any difference. Do not ask a new agent to rediscover settled evidence unless current repository/runtime facts contradict it.

### Required inherited state

This ticket begins from the final pushed STAB-04 stacked head after reconciling it with current repository truth. Consume both STAB-03 and STAB-04 exit handoffs, including their exact customer-safe states, retry/terminal semantics, diagnostic boundaries, and verification fixtures. No predecessor PR needs to be merged for this bounded stacked workflow.

The startup UI must render those proven states. It must not invent a third recovery model or conceal an unresolved provider state behind a loader.

STAB-03 specifically establishes `checking` only while a bounded attempt is active and `Task state unclear` after the attempt limit is exhausted. Persisted blocker authority is reconstructed independently of obsolete reason strings. Hydration must preserve that distinction and keep conversation history readable.

STAB-04 establishes one Runtime dependency circuit: permanent configuration failure probes every 30 seconds, transient failure backs off exponentially from 750 ms to 30 seconds, and a successful probe clears the state. The desktop snapshot preserves local Product truth and last Runtime-owned surface portions, while projecting at most one customer-safe browser-service warning. Hydration must render that contract; it must not expose low-level codes, restart aggressive polling, or wait for Runtime before showing local conversation history.

Use disposable fixture `/private/tmp/rove-stab04-process.9fBJvP` for invalid/unavailable Runtime startup when it remains present. Its invalid-catalog copy has SHA-256 `97f063da8cabce602f3115c4e1ee16f3eb5c0f532f37d4b07997c71485f0741d`. The preserved original acceptance home remains read-only.

At ticket start, reconcile current `main` with the continuity ledger and record the exact start SHA.

### Actual entry state

- exact stacked start SHA: `d642822d0a00516ff32fec86d2fdfd35e5cbf6b9`, the final pushed STAB-04 head;
- branch: `codex/stab05-startup-hydration`, clean at entry;
- STAB-04 implementation and handoff are pushed, while PR creation remains unavailable to the authenticated non-collaborator identity; no PR was created or merged;
- diagnosis starts from current Electron startup order and renderer snapshot handling. No live model, credentialed service, packaged app, or original acceptance home will be used.

### Read-only diagnosis

- `startDesktop()` awaits managed Runtime startup and the complete `CodexExecutionCore.start()` path—including account refresh and bounded provider reconciliation—before registering IPC or creating/presenting the full surface. A slow provider therefore delays even the neutral local window instead of allowing local history to hydrate independently.
- The renderer starts with `desktop === null`, but `ProductSurface` renders the complete empty task shell immediately. A coherent desktop envelope with `product === null` and no `productError` is also classified as `startup_failed`, so a normal in-progress local hydration can flash New Task / composer and “Codex couldn't start” before the first local Product snapshot.
- Once `LocalProductSnapshot` exists, current Task/customer projections already preserve STAB-03 per-Task unresolved state and STAB-04 bounded recovery warnings. The owning defect is startup composition and initial rendering, not another Task or Runtime state.

### Implemented contract

- Desktop IPC and the native surface are registered and presented before awaited Codex/provider startup. Provider reconciliation can no longer prevent the local window from opening.
- `desktop === null` and a coherent product-null/error-null envelope render one centered neutral hydration surface. The empty composer, Worked/Checking status, and startup-failure recovery do not render before coherent local truth exists.
- Initial IPC failure replaces the loader with one bounded, customer-safe retry action; it does not reveal raw host diagnostics or spin indefinitely.
- The established STAB-04 Runtime messages are the only recovery warnings admitted to the global browser-service banner. Internal recovery diagnostics remain hidden, conversation history stays readable, and the owning STAB-03 Task still renders `Task state unclear` independently.
- No persistence schema, migration, provider protocol, Runtime retry interval, Task identity, or recovery authority changed.

### Verification result

- The required renderer regressions failed first; the focused suite then passed 3 files / 67 tests.
- `node experiments/agent-execution/startup-hydration-qualification.mjs` passed two real built Electron launches over one disposable persisted local snapshot: healthy and permanently degraded Runtime presentation. Both observed neutral hydration, readable persisted conversation, Task-owned unresolved state, and an unrelated interactive Task; only the degraded launch rendered the bounded browser-service warning. The fixture was deleted after the run and used no credentials, installed Codex component, model, or external service.
- `pnpm check:repository` passed (708 files, 1,303 relative imports, 107 local document links); `pnpm lint`, `pnpm typecheck`, `pnpm build`, full `pnpm test` (202 files / 1,723 tests), and `pnpm test:experiments` (24 tests) passed.
- Packaged-application and human acceptance remain unqualified. The preserved original acceptance home and the STAB-04 process fixture were not mutated.

**Implementation checkpoint:** `a98882d69af44d4b30dbaedc9254d2cc9e7a146e` (`Hydrate local tasks before provider startup`).

**Durable handoff checkpoint:** `35fb6d33ed5312a4ce60ac9dd9dc9da295b31737` (`Record STAB-05 startup hydration handoff`), pushed to `origin/codex/stab05-startup-hydration`.

**PR state:** stacked PR creation against `codex/stab04-runtime-failure-containment` was attempted and failed because the authenticated GitHub account is not a collaborator. No PR was created or merged. This external tooling boundary does not block STAB-06.

## Invariant

Startup hides only incoherent pre-snapshot composition. Once coherent local state exists, the conversation is readable while provider reconciliation proceeds independently and boundedly.

## Owns

MR-006 plus customer presentation of the repaired STAB-03/04 states.

## Acceptance criteria

- Neutral centered initial hydration until first coherent local snapshot.
- No indefinite loader waiting for provider reconciliation.
- Persisted conversation appears after local hydration.
- Per-Task recovery is shown on the owning Task.
- Unrelated Tasks remain interactive.
- Degraded Runtime/provider state is bounded and customer-safe.
- No flash of contradictory Worked/Checking/composer states during first hydration.

## Verification

Renderer state tests → Electron cold start → persisted restart with healthy provider → persisted restart with unavailable/invalid Runtime.

Checkpoint before downstream market acceptance.

## Continuity exit / handoff contract

This ticket is **not complete** merely because its implementation and tests pass. Before changing its status to Complete, make the resulting engineering state durable for the next ticket.

Update [continuity-ledger.md](continuity-ledger.md) with:

- exact ticket start SHA and final ticket commit/PR/merge SHA;
- MR findings closed, narrowed, superseded, or newly discovered;
- confirmed root cause(s) and important hypotheses disproved;
- invariant actually established by the implementation;
- exact production/schema/persistence/contract files changed;
- migration, compatibility, provider-version, or fixture consequences;
- focused verification and affected-subsystem verification with exact commands/results;
- real-boundary/E2E evidence, including paths/hashes where material;
- failures, flakiness, and anything not qualified;
- preserved reproduction state and whether it remains valid;
- residual blockers/open questions;
- direct downstream tickets whose assumptions or entry contracts changed;
- the exact next stop point and next verification gate.

Then update every directly dependent ticket's **Continuity entry contract** when the new evidence changes what that ticket must inherit. The next ticket must be able to continue from repository-owned state without reconstructing this investigation from chat history.
