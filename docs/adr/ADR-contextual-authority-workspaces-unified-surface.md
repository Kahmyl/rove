# ADR: contextual action authority, durable workspaces, and one Rove surface

Date: 2026-09-07

Status: accepted and implemented

Production integration and live acceptance results are recorded in
`docs/experiments/2026-09-07-production-live-acceptance.md`.

## Context

Live acceptance demonstrated three architecture failures:

1. deterministic page classification had become a global prerequisite for all
   browser mutation, producing a classifier-and-patch loop;
2. logical sessions could select arbitrary profile names, allowing an agent to
   create a clean browser identity that appeared to have lost authentication;
3. the compact follower and full Companion derived and hosted product state as
   separate surfaces.

The experiments in
`docs/experiments/2026-09-07-boundary-workspace-surface.md` validated replacement
boundaries. Browser-shell replacement is not part of this decision. Rove keeps
using a Rove-owned external Chrome process.

## Decision 1: page perception is not mutation authority

F1 perception returns bounded browser facts, target facts, uncertainty, and
evidence. A page-state label remains useful for explanation and compatibility,
but it does not grant or revoke every action on the page.

Runtime authorizes each proposed action after normal controller and freshness
checks:

```text
fresh observation + exact target + proposed effect + task authority
                              |
                              v
                    ActionAuthorization
       allow | wait | confirm | human control | deny
```

### Invariants that remain deterministic

- active controller and ownership generation;
- current page id, revision, and semantic fingerprint;
- exact target identity, visibility, enabled state, and sensitivity;
- origin and workspace capability;
- action and repetition budgets;
- credential and human-verification boundaries;
- consequential replay fences and unknown-outcome reconciliation;
- durable receipts, evidence, and audit observations.

### Judgment delegated to the calling model

- interpreting unfamiliar dialogs and overlays;
- choosing among freshly grounded ordinary controls;
- deciding whether a reversible recovery advances the user's goal;
- selecting the next task step when several valid paths exist;
- requesting human help when facts are insufficient.

### Effect contract

Every consolidated interaction carries an effect class:

- `observe`;
- `recover`;
- `navigate`;
- `reversible_ui`;
- `edit_content`;
- `external_commit`;
- `irreversible`;
- `credential_entry`.

The agent declares intent, but Runtime derives a minimum effect from the verb
and grounded target. The effective consequence is the more restrictive of the
two. For example, a sensitive input is always `credential_entry`; upload is at
least `external_commit`; a declared consequential interaction cannot be
downgraded; and coordinate-based interaction cannot claim observational effect.

An unfamiliar or indeterminate interstitial is advisory. It must not block
freshly grounded Back, Escape, Close, page switching, or other reversible
recovery. Explicit, verifiable task commits may proceed unless a hard invariant
requires confirmation or human control.

`PagePolicyDecision.mutationAllowed` is deprecated. Runtime retains it for
internal orchestration and compatibility, but the MCP inspection projection no
longer returns it. Agent-facing target mutation is exposed only through the
consolidated action path, which makes the contextual decision after fresh
grounding.

## Decision 2: BrowserWorkspace owns durable identity

Browser identity is not a task session.

```text
BrowserWorkspace (months)
  `-- BrowserHost lease (process lifetime)
        `-- Rove task session (task lifetime)
              `-- observation/target authority (page revision lifetime)
```

A workspace has an opaque id, display name, Rove-owned Chrome data directory,
browser distribution, timestamps, and lease/recovery state.

### Rules

- The app creates, selects, resets, and deletes workspaces through user-visible
  administrative operations.
- Ordinary MCP tasks may select only an existing authorized workspace id.
- Omitted workspace id resolves to the app-selected workspace.
- Unknown ids fail and never create directories.
- Task completion releases its lease; it does not remove browser data.
- Clean app/browser restart reopens the same data directory.
- Existing profile locks and verified browser-host adoption remain mandatory.
- Site-selected cookie expiry is respected; Rove guarantees storage continuity,
  not indefinite third-party authentication.
- Ordinary Chrome's default profile remains unsupported.

### Migration

On the first workspace-aware release:

1. if a workspace catalog already exists, validate it before browser launch;
2. otherwise, if the legacy managed `default` profile exists, register it as
   the selected workspace without copying or clearing Chrome data;
3. retain other legacy managed profiles as unselected migration candidates;
4. remove `existing` and arbitrary persistent profile names from the ordinary
   `session.start` MCP schema;
5. make the protocol, MCP adapter, Runtime, README, and diagnostics use one
   identical default-selection rule.

Migration must be atomic and reversible at the catalog level. It must not move
or rewrite Chrome-owned storage.

## Decision 3: Rove has one logical surface

The product surface owns:

- canonical session semantics and available controls;
- `chip | expanded | full` presentation;
- browser `windowed | fullscreen` context;
- placement and return presentation;
- active native host and presentation revision.

The renderer uses one component tree and one session store. Presentation only
changes information density and layout. It never reinterprets controller state.

The main process may retain a compact panel host and a normal control-center
host for platform/fullscreen correctness, but `UnifiedSurfaceCoordinator`
ensures exactly one is visible. “Open Rove” becomes an `open_full` transition;
closing full returns to the previous compact presentation.

Separate polling loops and separate compact/full view-model derivation are
removed. The main process publishes one subscribed surface snapshot. Renderer
recovery reloads a host and reapplies that snapshot without resetting logical
state.

## Production slices

### P1 — action authority

1. Move action-effect and authorization contracts into `@rove/protocol`.
2. Add Runtime-derived minimum effects.
3. Route `browser.interact` through action authorization while preserving
   ownership, freshness, target, budget, and replay checks.
4. Allow deterministic recovery operations through non-ready semantic states.
5. Update inspection metadata to expose facts and recommendations rather than
   a global mutation instruction.
6. Remove ambiguous one-action MCP tools after consolidated interaction reaches
   parity. Runtime adapters may retain them as compatibility endpoints, but they
   are not part of the agent-facing catalog.

### P2 — browser workspaces

1. Promote the tested workspace registry into Runtime startup.
2. implement non-copying legacy-default migration;
3. add private app APIs for list/create/select and workspace status;
4. replace task-supplied profile names with workspace ids;
5. surface the selected workspace in Rove before a task starts;
6. run browser restart and live Google authentication acceptance.

### P3 — unified surface

1. Promote the canonical session view model and presentation state machine;
2. add native-host adapters around existing Companion and follower windows;
3. replace renderer query-based product branching with presentation props;
4. replace independent polling with one subscribed surface snapshot;
5. make Take Over, Return, Pause, Resume, Stop, and handoff copy identical
   across presentations;
6. rerun windowed, maximized, fullscreen, multi-monitor, focus, drag, crash, and
   restart acceptance.

## Release gates

Production rollout requires:

- zero unsafe allows in the frozen action-policy corpus;
- no regression in stale-target, controller fencing, budget, and unknown-outcome
  tests;
- no silent workspace creation or identity switching;
- persistent storage continuity across clean Runtime and browser restart;
- successful live Google login reuse in the selected workspace;
- exactly one visible Rove surface through every presentation transition;
- native fullscreen and focus behavior equal to or better than the current
  follower;
- full repository typecheck, lint, build, and tests;
- repeat of the GitHub and Gmail-to-Calendar live acceptance journeys.

## Consequences

Rove will have fewer categorical page-policy stops and more contextual action
decisions. Safety moves to enforceable invariants and consequence-aware gates,
not to an ever-growing taxonomy of web pages.

Browser identity becomes more visible and less flexible for ordinary task
callers. That is intentional: selecting identity is a user/product decision,
not an agent improvisation.

The companion code retains platform-specific native hosting, but users and
renderers see one Rove product surface.
