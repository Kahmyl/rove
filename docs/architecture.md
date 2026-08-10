# Architecture baseline

```text
External MCP client ──> apps/mcp ──> RoveRuntime interface
                                      │
Electron companion ──> private API ───┤
                                      ▼
                              apps/runtime
                               │    │    │
                               ▼    ▼    ▼
                          browser storage protocol
```

## Invariants encoded by the skeleton

1. Runtime state is authoritative; neither MCP nor Electron owns it.
2. A session has at most one controller.
3. Capture mode begins under human control; agent and companion modes begin under agent control.
4. Agent mutation is rejected unless the agent owns control.
5. Observations are append-only and use a monotonic per-session sequence.
6. Human-to-agent handback invalidates browser references through a revision change.
7. Protocol, browser, storage, and config packages import no application adapter.
8. HTTP defaults bind to loopback; configured tokens protect all session routes, and non-loopback binding requires a token.
9. Evidence paths are generated below the Rove home directory.
10. Sensitive typed values are represented only by redacted metadata.

## Browser implementation

The browser package currently implements:

- a real Playwright Chromium/Chrome browser lifecycle with temporary profiles;
- one BrowserContext per BrowserSession;
- stable `page_01`, `page_02`, ... page identities and active-page management;
- navigation with material page revision updates;
- semantic inspection using visible body text and one-pass DOM target discovery;
- deterministic accessible-name approximation and target classification;
- sensitivity detection through the existing `isSensitiveTarget()` contract;
- revision-scoped `tN` target references backed by one current TargetRegistry per page;
- centralized action-time target resolution with page/revision, marker, semantic identity, visibility, enabled, and interactivity validation;
- material DOM mutation tracking that preserves safe references across unrelated changes and invalidates missing/replaced targets;
- `click`, replacement-style `type`, targeted/page `press`, viewport `scroll`, `back`, and `forward`;
- viewport, full-page, and target PNG screenshots with temporary sensitive-field masking;
- popup discovery and shared post-action page/revision synchronization;
- deterministic local fixture tests and headed manual verification.

Inspection does not increment the page revision. Revisions change on main-frame navigation/document change, explicit invalidation, and material action results.

## Runtime integration

The runtime owns the `ses_*` identity and maps each active session to one browser session. Startup persists `starting` before launch and transitions to `active` or `failed`; shutdown closes the browser before persisting `completed`. Browser-changing operations pass through the per-session command coordinator and agent-control guard. Runtime action results expose the Rove session ID, observations never persist raw typed values, and screenshot bytes are converted to filesystem evidence.

The private NestJS API exposes session, browser, page, observation, and evidence routes. A centralized bearer guard protects session routes when configured, non-loopback startup without a token is rejected, and structured Rove errors are mapped to stable HTTP responses.

Control state is persisted on the session and validated centrally for Agent, Companion, and Capture modes. Requested handoff removes agent ownership before a human takes control; Companion may also take control voluntarily. Returning control synchronizes the active page and invalidates every page target registry before restoring agent ownership. Durable control-transition observations drive an in-process, lost-wakeup-safe wait service using query, waiter registration, and a second query rather than polling. Human take and return remain private runtime operations consumed by the Electron Companion.

## Electron companion

The Electron main process owns runtime connectivity and authentication. It discovers the current active Companion Mode session through the private runtime API and retrieves session state, observations, and evidence without routing through MCP.

The renderer runs with `contextIsolation=true`, `nodeIntegration=false`, and sandboxing enabled. A CommonJS preload exposes only the narrow `window.rove` API for snapshot retrieval, Take Control, Return Control, and Finish Session.

The renderer presents session, mode, controller, status, observation count, and evidence count. Requested human handoffs surface their persisted reason in the desktop UI. Human-to-agent return continues to use the runtime control state machine, including all-page target invalidation before agent ownership is restored.

## Implementation slices

- Phase 1 browser lifecycle, semantic inspection, safe actions, and stale-target protection are implemented.
- Phase 2 runtime/browser integration, lifecycle persistence, evidence, observations, and the private HTTP API are implemented.
- Phase 3/4 MCP tools, stdio, authenticated Streamable HTTP, and runtime HTTP adaptation are implemented.
- Phase 7 runtime control protocol, exclusive-control state machine, private HTTP operations, durable waits, stale-target handback, and the agent-facing MCP tools `control.status`, `control.request_human`, and `control.wait` are implemented. Human take/return are not exposed through MCP.
- Phase 8 Electron Companion, secure preload bridge, runtime session discovery, control UI, handoff presentation, and session completion are implemented.
- Phase 9+: human activity observation instrumentation and Capture Mode.
