# Rove

Rove is a local-first, headed-browser task runtime shared by an external MCP agent and a human. Rove owns browser execution, session state, control handoff, observations, and evidence; it intentionally contains no built-in planner or LLM.

## Workspace

- `apps/runtime` — NestJS composition root and private runtime API
- `apps/mcp` — MCP transport and tool adapter boundary
- `apps/companion` — Electron + React companion client
- `packages/protocol` — shared schemas, contracts, and structured errors
- `packages/browser` — Playwright browser lifecycle, semantic inspection, and target registry
- `packages/storage` — atomic filesystem and JSONL persistence
- `packages/config` — configuration precedence and validation

## Getting started

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

Development entry points:

```bash
pnpm dev:runtime
pnpm dev:mcp
pnpm dev:companion
```

The runtime, MCP, and Companion development commands load the repository-root `.env` when
it exists. Environment variables already set by the invoking shell take
precedence, so the same commands work from POSIX shells, PowerShell, and
Command Prompt without shell-specific environment syntax.

## Browser verification

Rove supports real Playwright browser sessions with temporary profiles, stable page IDs, active-page lifecycle, semantic inspection, revision-scoped target references, stale-target protection, browser actions, popup discovery, history navigation, and PNG screenshots with sensitive-field masking.

Manual verification commands:

```bash
pnpm browser:demo
pnpm browser:inspect
pnpm browser:actions
pnpm runtime:demo
pnpm control:demo
```

`browser:actions` runs the headed target-reference action and stale-target demonstration. `runtime:demo` exercises the real private HTTP API and persists a completed session, observations, screenshot evidence, and structured record under `.rove-demo/`.

`control:demo` exercises requested Agent handoff and voluntary Companion takeover without Electron. It verifies exclusive ownership, wait notifications, mutation blocking, human-to-agent return, and stale target references after handback. Set `ROVE_CONTROL_DEMO_WAIT=1` to pause both flows for manual interaction in the headed browser.

## Electron Companion

Start the runtime and desktop Companion with:

```bash
pnpm dev:runtime
pnpm dev:companion
```

For an active Companion Mode session, the desktop interface displays the session ID, mode, controller, status, observation count, and evidence count. `Take Control` transfers exclusive browser ownership to the human, `Return Control` hands ownership back to the agent and invalidates previous target references, and `Finish Session` completes the session.

When the agent requests human assistance, the Companion displays the handoff reason and provides `Take Control`. The Electron main process communicates directly with the private runtime API; the isolated renderer receives only the narrow preload bridge and has no unrestricted Node access.

## Capture Mode

Capture Mode starts human-owned and records a minimized browser journey without raw cursor recording or sensitive form values.

Rove captures navigation, URL and title changes, meaningful clicks, safe form submission metadata, fixed scroll milestones, selections, opened tabs, and real human tab switches.

Human tab selection is reconciled from Chromium's browser-level tab state and mapped back to Rove's stable page IDs. Agent browser mutations remain blocked while the human owns a Capture session, while read-only MCP session, observation, and evidence operations remain available.

The Companion discovers active Capture sessions, displays their observation and evidence counts, keeps takeover and handback controls unavailable, and allows the human to finish the session.

See [docs/implementation/m9-human-activity-observation-capture-mode.md](docs/implementation/m9-human-activity-observation-capture-mode.md) for the observation model, privacy rules, and manual verification.


The private runtime API starts and closes real browser sessions, serializes agent mutations per session, enforces the Agent, Companion, and Capture control state machines, and persists minimized observations and evidence. Its private control routes support status, requested handoff, human take/return, and lost-wakeup-safe event waits. Human-to-agent handback invalidates all page target references before restoring agent ownership. The API is unauthenticated only for loopback development when no runtime token is configured; non-loopback binding requires `ROVE_RUNTIME_TOKEN`.

## Docker Compose

Start the local runtime in Docker:

```bash
pnpm docker:up
```

The runtime is available only on the host loopback interface at
`http://127.0.0.1:47820`; its health endpoint is
`http://127.0.0.1:47820/health`. Streamable HTTP MCP is available at
`http://127.0.0.1:47821/mcp`, with health at `http://127.0.0.1:47821/health`.
Session data is retained in the named
`rove-data` volume. Compose installs the lockfile-matched Playwright Chromium
browser and runs browser sessions headlessly inside the runtime container.

Session routes require the Compose runtime bearer token. Local development uses
`rove-local-compose-token-change-me` unless `ROVE_RUNTIME_TOKEN` is set; health
remains unauthenticated. Override the token for any shared environment:

```bash
ROVE_RUNTIME_TOKEN=a-long-random-development-token pnpm docker:up
```

For Compose Watch development:

```bash
pnpm docker:dev
```

Operational commands:

```bash
pnpm docker:logs
pnpm docker:down
pnpm docker:reset # destructive: removes persisted local Rove session data
```

Compose runs the runtime API, its headless Playwright browser, and the authenticated
Streamable HTTP MCP service. The Electron companion remains host-side. Override
`ROVE_MCP_TOKEN` alongside `ROVE_RUNTIME_TOKEN` outside local development.

The repository includes the domain and persistence foundation, complete core Playwright browser actions, runtime/browser/persistence integration, private runtime human-handoff operations, the Electron Companion, human activity observation and Capture Mode, and MCP over stdio and Streamable HTTP. MCP exposes only the agent-facing control tools `control.status`, `control.request_human`, and `control.wait`; human take/return remain private runtime operations. No public selector or arbitrary JavaScript fallback is present.

See [docs/architecture.md](docs/architecture.md) for boundaries and the next implementation slices.
