# Phase 5 P5.0 isolated experiments

This directory contains disposable, dependency-free experiment harnesses for
the P5.0 contract gate. Nothing here is imported by a production package.

Run the deterministic contract campaign:

```bash
pnpm phase5:p50:fixtures
```

Regenerate and verify the installed Codex App Server schema evidence:

```bash
pnpm phase5:p50:schema
```

Run the installed App Server read-only lifecycle probe:

```bash
pnpm phase5:p50:live
```

Run the P5.9 L0 native lifecycle convergence oracle:

```bash
pnpm phase5:p59:l0
```

The checked-in transition fixture is
`fixtures/native-lifecycle-l0.json`. To refresh the bounded campaign result
after an accepted fixture or reducer change, add `-- --write-evidence`.

Run the isolated standard-required-MCP boundary probe:

```bash
node experiments/phase5-app-server/live-app-server.mjs --mcp-boundary
```

The live probe deliberately avoids returning account identifiers, tokens, or
raw transcript content. Use `--lifecycle` to create one named P5.0 thread,
exercise a streamed turn, read/list/resume, archive/unarchive, interruption,
process loss, and recovery. The created thread is archived at the end.

```bash
node experiments/phase5-app-server/live-app-server.mjs --lifecycle
```

Probe legacy thread start and zero-message restart behavior without sending a
turn:

```bash
node experiments/phase5-app-server/thread-start-history-matrix.mjs
```

RPC failure evidence records `dataPresent` and sorted `rpcErrorKeys`; it never
normalizes an omitted `data` member to `null`. Pinned App Server `0.153.4` was
observed emitting the relevant `-32600` errors with exactly `code` and
`message`. Production also recognizes the semantically equivalent explicit
`data: null` form, but rejects non-null data and every other RPC shape. Presence
therefore matters for evidence fidelity, while omission versus explicit null
does not change the narrowly pinned compatibility result.

The dependency-free schema checker is deliberately an audited subset covering
only the keywords in the checked-in contracts; unsupported keywords and
formats fail closed, and its stricter RFC 3339 date-time profile rejects leap
seconds. The fixture campaign proves the proposed state-machine
invariants. The live
probe proves only behavior actually observed from the installed executable.
Unimplemented Desktop integration scenarios remain explicitly unverified in
the dated report.
