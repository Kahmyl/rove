# Boundary, workspace, and unified-surface experiments

Date: 2026-09-07

Status: completed; all three structural experiment gates passed

This experiment programme was started after live GitHub and Google acceptance
runs exposed a repeated pattern of page-classifier patching, accidental browser
identity changes, and divergent companion surfaces. Browser-shell replacement
was explicitly removed from scope. Rove-owned external Chrome remains the
browser baseline.

## Baseline

Before adding experimental candidates, 89 focused tests passed across:

- page-state and interaction policy;
- persistent profile metadata, locking, and browser-host recovery;
- compact and full companion state/surface behavior.

The working tree already contained browser lifecycle and page-semantics work
from the interrupted acceptance investigation. The experiment did not revert
or reinterpret those changes.

## Experiment A: policy boundary

### Question

Can Rove keep deterministic mechanical safety while allowing the calling model
to recover from or act through page states that Rove cannot classify completely?

### Candidate

`ActionAuthorizationPolicy` evaluates one proposed action using:

- freshly grounded authority;
- the action's effect rather than only its browser verb;
- explicit task authority;
- whether a consequential outcome can be reconciled;
- hard facts such as document instability, authentication, human verification,
  restriction, and error presentation.

Page classification is evidence. It is not a page-wide mutation switch.

### Result

The fixed ten-case comparison corpus produced:

| Metric | Current page-wide policy | Candidate action policy |
| --- | ---: | ---: |
| Safe cases allowed to progress | 1 / 5 | 5 / 5 |
| Unsafe cases allowed | not used as candidate gate | 0 / 5 |

The candidate allowed freshly grounded recovery from unfamiliar overlays,
loading pages, error pages, restrictions, and verification pages. It allowed an
explicit, verifiable task commit through an unfamiliar interstitial. It still
blocked unstable commits, credential entry, human verification interaction,
unrequested external commits, unverifiable commits, and irreversible actions.

Ten experiment tests passed.

### Limitation

The corpus is deterministic and synthetic. It establishes the responsibility
boundary, not live-site generalization. The production contract must not trust
an agent-supplied effect classification by itself; Runtime must derive a minimum
effect from the operation and target facts and combine it with the agent's
declared intent.

### Decision

Adopt the action-level boundary. Do not continue extending
`unknown_interstitial` as a complete vocabulary of site behavior.

## Experiment B: durable browser workspace

### Question

Can browser identity outlive logical Rove sessions without allowing a task to
invent or silently create a clean profile?

### Candidate

`BrowserWorkspaceRegistry` introduces opaque `wrk_*` identities. Workspace
creation and selection are distinct administrative operations. A task can only
resolve an existing selected/authorized workspace. Unknown ids fail with
`PROFILE_NOT_FOUND` and create no directories.

### Result

The experiment demonstrated:

- selected identity survives registry/runtime reconstruction;
- explicit selection is required to switch identity;
- resolving an unknown identity never creates it;
- workspace catalog data is separate from Chrome data;
- the existing profile lease rejects a second writer;
- real persistent Chromium preserves local storage and a persistent cookie
  across browser close and relaunch using the same workspace directory.

Seven experiment tests passed.

The first browser restart probe intentionally revealed that a session-only
cookie expires on browser close. The probe was corrected to use a persistent
cookie, matching the mechanism on which long-lived account sessions depend.
This distinction must remain explicit in acceptance documentation: Rove can
preserve browser storage, but cannot override expiry chosen by a site.

### Limitation

The automated restart probe uses a local origin and Chromium. A live Google
account acceptance run remains necessary after production integration to prove
that the selected Rove-owned Chrome workspace is consistently reused.

### Decision

Adopt first-class browser workspaces. Remove arbitrary named-profile creation
from ordinary task/session tools.

## Experiment C: unified companion surface

### Question

Can chip, expanded controls, and the full application behave as one logical
product even if native fullscreen behavior still requires two Electron window
hosts?

### Candidate

Two independent concerns were prototyped:

1. `UnifiedSurfaceStateMachine` owns `chip | expanded | full`, browser context,
   return presentation, active host, and monotonic presentation revision.
2. `toUnifiedSessionViewModel` derives session meaning and available authority
   once for every presentation.

`UnifiedSurfaceCoordinator` hides the inactive native host before presenting
the active host.

### Result

The experiment demonstrated:

- chip → expanded → full → expanded continuity;
- fullscreen changes host context without creating another product mode;
- exactly one native host remains visible through transitions;
- idempotent presentation events do not churn state;
- no-session, working, takeover, handoff, human control, pause, capture, and
  terminal states derive from one canonical semantic model;
- the human handoff instruction survives presentation transitions.

Thirteen experiment tests passed.

### Limitation

The host experiment uses deterministic fakes and does not replace the existing
Electron wiring yet. Native focus, fullscreen Space behavior, drag placement,
and renderer crash recovery remain production-integration acceptance gates.

### Decision

Adopt one logical surface and canonical session model. Retain multiple native
hosts only as platform adapters when required.

## Combined decision

Experiments A, B, and C passed their structural gates and are compatible:

```text
User-selected BrowserWorkspace
              |
              v
Logical task session and controller lease
              |
              v
Perception facts -> model proposal -> per-action Runtime authorization
              |
              v
Owned Chrome execution -> verified receipt/evidence
              |
              v
One Rove surface: chip <-> expanded <-> full
```

The production implementation is defined by
`docs/adr/ADR-contextual-authority-workspaces-unified-surface.md`.

