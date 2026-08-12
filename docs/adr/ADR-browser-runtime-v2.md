# ADR: Browser Runtime V2

## Status

Accepted for F4 implementation.

## Context

F4 defines Rove's browser runtime fidelity and compatibility contract. The runtime must launch Chromium-family browsers deliberately, isolate temporary sessions, preserve Rove-managed persistent profiles, avoid silent permission elevation, keep downloads inside managed directories, and expose compatibility facts through deterministic diagnostics.

The protocol includes an `existing` profile mode, but ordinary Chrome user profiles carry browser-owned locks, credential stores, extension state, and user data that Rove must not copy, mutate, or bypass.

## Decision

Rove Browser Runtime V2 supports:

- temporary Chromium-family sessions;
- Rove-managed persistent profiles;
- deliberate Chrome or bundled Chromium selection;
- Rove-level persistent profile locking;
- managed downloads;
- default browser permission behavior;
- deterministic compatibility reporting.

Ordinary existing Chrome profiles remain unsupported for production use. Rove will not attach to, copy, mutate, or bypass locks for a user's normal Chrome profile. A future explicit-import or dedicated-profile workflow can be designed separately if product requirements justify it.

## Consequences

- `profile.mode: "existing"` continues to fail fast with a structured unsupported-path error.
- Users who need persistence should use Rove-managed persistent profiles.
- Compatibility reports can distinguish supported behavior from runtime limitations.
- Future work can add origin-scoped permission grants and richer crash recovery without changing this ownership boundary.
