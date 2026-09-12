# Parallel execution isolation

Use parallel agents only for bounded work that can be integrated and verified by the root agent. Read-only investigation may share a checkout when it cannot mutate repository or runtime state.

Allow only one writing agent per worktree. Parallel writers require separate branches and separate Git worktrees. A Git worktree isolates checked-out files and index state; it does not isolate mutable execution resources.

When parallel work can mutate them, assign separate:

- ports;
- `ROVE_HOME` and application-data directories;
- SQLite and test-database paths;
- browser profiles and user-data directories;
- Runtime, session, and process homes;
- temporary artifact directories; and
- external fixture or test accounts.

Parallel agents must not share a real user browser profile, destructive test database, mutable application home, or externally mutable account when their operations can conflict. Do not build a scheduler or worktree manager for this policy. If isolation cannot be established cheaply and verified, serialize the affected work.
