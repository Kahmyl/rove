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

To run the local desktop Hub model from source:

```bash
pnpm dev:desktop
```

This development command builds and starts the Companion plus the local Runtime.
It does not start the MCP service; run `pnpm dev:mcp` separately when exercising
the current development adapter.

When testing from Codex, register the running MCP endpoint with Codex before
starting the agent. A prompt that says "use the Rove MCP connector" does not
mount tools by itself. If the Rove tools are not already exposed in the Codex
session, the agent should stop and report that Rove MCP is not connected rather
than probing `.env`, localhost ports, or calling the MCP HTTP endpoint from a
shell script.

## Local Hub/control-plane development

The production-shaped local path keeps the Runtime private and routes MCP calls
through a separate control plane. Copy the relay values from `.env.example` into
`.env`, then run these in separate terminals:

```bash
pnpm dev:control-plane
pnpm dev:desktop
pnpm dev:mcp
```

When `ROVE_CONTROL_PLANE_URL` is configured, Desktop starts an outbound Hub
connector and MCP uses the control-plane Runtime adapter. Without that variable,
MCP retains its explicit direct-to-Runtime development mode.

The local control plane currently uses an in-memory command queue, development
pre-shared tokens, and one process. It validates the intended network boundary;
it is not production infrastructure and does not yet provide durable delivery,
device enrollment, accounts, horizontal scaling, or key rotation.

## Desktop packaging

> Packaging is deferred. The commands and staged service layout in this section
> are experimental and are not the supported development or production topology.

Build the installer for the current platform with:

```bash
pnpm package:desktop
```

The packaging pipeline builds every workspace package, stages production-only
Desktop, Runtime, and MCP dependency trees, installs the matching Playwright
Chromium fallback, and writes platform artifacts under `release/artifacts/`.
Use `pnpm package:desktop:dir` for an unpacked application during development.

Verify an unpacked package—including its embedded Node runtime, Runtime and MCP
health, and a real session using the shipped Chromium—with:

```bash
pnpm test:desktop:package
```

macOS release distribution still requires a valid Developer ID certificate and
notarization credentials. Local unsigned builds remain suitable for packaging
and smoke verification.

The runtime, MCP, and Companion development commands load the repository-root `.env` when
it exists. Environment variables already set by the invoking shell take
precedence, so the same commands work from POSIX shells, PowerShell, and
Command Prompt without shell-specific environment syntax.

## Browser verification

Rove supports real headed Playwright browser sessions with Rove-managed persistent or explicitly requested temporary profiles, stable page IDs, active-page lifecycle, semantic inspection, revision-scoped target references, stale-target protection, browser actions, popup discovery, history navigation, and PNG screenshots with sensitive-field masking. MCP sessions default to the managed persistent `default` profile so user-authorized cookies and ordinary browser preferences survive restarts. Ordinary/default Chrome profiles are intentionally unsupported.

### Responsible browsing boundary

Rove is designed as a user-directed assistant, not an anti-detection system. In headed mode it uses normal system Chrome with JavaScript enabled, applies a configurable minimum interval between agent actions, and emits sequential keyboard events for normal-sized text input. Explicit site restriction or human-verification pages pause the session, remove agent control, persist a `site_access_restricted` observation, and surface a human handoff.

These safeguards reduce accidental rapid automation and disposable-session behavior, but they do not guarantee access to any site. Rove does not spoof browser fingerprints, hide automation or developer tooling, rotate proxies, solve CAPTCHAs, or bypass a site's access controls. A site's restriction remains authoritative and must be handled by the user or site operator.

Local pacing can be configured with `ROVE_BROWSER_MIN_ACTION_INTERVAL_MS` and `ROVE_BROWSER_TYPING_DELAY_MS`. Setting either to `0` disables that delay; headed development defaults to `3000` ms between actions and `35` ms between key events. Rove removes Playwright's `--no-sandbox` and `--disable-setuid-sandbox` defaults, then reports observed sandbox status from runtime evidence as `enabled`, `disabled`, or `unknown`.

Manual verification commands:

```bash
pnpm browser:doctor
pnpm browser:compat
pnpm browser:soak
pnpm browser:demo
pnpm browser:inspect
pnpm browser:actions
pnpm runtime:demo
pnpm control:demo
```

`browser:doctor` reports requested browser settings, resolved launch configuration, and observed runtime state. `browser:compat` runs deterministic browser-platform and Rove-runtime compatibility checks. `browser:soak` runs the long browser stability check. `browser:actions` runs the headed target-reference action and stale-target demonstration. `runtime:demo` exercises the real private HTTP API and persists a completed session, observations, screenshot evidence, and structured record under `.rove-demo/`.

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

Start the server-side control plane and MCP in Docker:

```bash
pnpm docker:up
```

Compose starts only the deployable server boundary. The control plane is
published on host loopback at `http://127.0.0.1:47830`, and Streamable HTTP MCP
is published at `http://127.0.0.1:47821/mcp`. MCP liveness is available at
`http://127.0.0.1:47821/live`; `/health` additionally reports whether the target
Hub and its Runtime are reachable.

Runtime, Companion, Playwright, browser profiles, and browser windows are not
containerized. Start them on the host so the browser remains headed:

```bash
pnpm dev:desktop
```

The host Hub connects outbound to the published control-plane port using
`ROVE_CONTROL_PLANE_URL`, `ROVE_HUB_DEVICE_ID`, and `ROVE_HUB_TOKEN` from `.env`.
The Compose defaults match `.env.example` for local development only. Replace
the Hub, control-plane service, and MCP tokens anywhere shared with other users.

For Compose Watch development:

```bash
pnpm docker:dev
```

Operational commands:

```bash
pnpm docker:logs
pnpm docker:down
pnpm docker:reset # removes Compose containers and any future named volumes
```

Compose never starts a Runtime or browser. Stopping or rebuilding server
containers therefore does not close the host-owned headed browser directly,
although active MCP commands will fail while the control plane is unavailable.

The repository includes the domain and persistence foundation, complete core Playwright browser actions, runtime/browser/persistence integration, private runtime human-handoff operations, the Electron Companion, human activity observation and Capture Mode, and MCP over stdio and Streamable HTTP. MCP exposes only the agent-facing control tools `control.status`, `control.request_human`, and `control.wait`; human take/return remain private runtime operations. No public selector or arbitrary JavaScript fallback is present.

See [docs/architecture.md](docs/architecture.md) for boundaries and the next implementation slices.
