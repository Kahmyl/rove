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
8. HTTP defaults bind to loopback and require a bearer token.
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
- explicit target invalidation for the active page;
- deterministic local fixture tests and headed manual verification.

Inspection does not increment the page revision. For the current browser slice, revisions change on main-frame navigation/document change or explicit `invalidateTargets()`.

Browser actions beyond navigation remain deferred and return structured `NOT_IMPLEMENTED` errors.

## Implementation slices

- Phase 1 browser lifecycle and semantic inspection are implemented.
- Phase 2: connect runtime commands to browser instances, persist every lifecycle transition, and expose the authenticated private API.
- Phase 3: register protocol schemas as MCP tools over stdio.
- Phase 4: add Streamable HTTP transport with centralized bearer/host validation.
- Phase 5+: human observation instrumentation, Electron control workflow, then Capture mode.
