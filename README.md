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

## Browser verification

Rove supports real Playwright browser sessions with temporary profiles, stable page IDs, active-page lifecycle, semantic inspection, revision-scoped target references, stale-target protection, browser actions, popup discovery, history navigation, and PNG screenshots with sensitive-field masking.

Manual verification commands:

```bash
pnpm browser:demo
pnpm browser:inspect
pnpm browser:actions
pnpm runtime:demo
```

`browser:actions` runs the headed target-reference action and stale-target demonstration. `runtime:demo` exercises the real private HTTP API and persists a completed session, observations, screenshot evidence, and structured record under `.rove-demo/`.

The private runtime API starts and closes real browser sessions, serializes agent mutations per session, enforces control ownership, and persists minimized observations and evidence. It is unauthenticated only for loopback development when no runtime token is configured; non-loopback binding requires `ROVE_RUNTIME_TOKEN`.

## Docker Compose

Start the local runtime in Docker:

```bash
pnpm docker:up
```

The runtime is available only on the host loopback interface at
`http://127.0.0.1:47820`; its health endpoint is
`http://127.0.0.1:47820/health`. Session data is retained in the named
`rove-data` volume.

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

The current container runs the runtime API only. The Electron companion and
Playwright browser execution currently run on the host. Browser integration
with the runtime container is deferred. The MCP HTTP service is likewise
deferred until its Streamable HTTP adapter exists; exposing a placeholder
service that immediately exits would make `docker:up --wait` misleading.

The repository includes the domain and persistence foundation, complete core Playwright browser actions, and runtime/browser/persistence integration. No public selector or arbitrary JavaScript fallback is present.

See [docs/architecture.md](docs/architecture.md) for boundaries and the next implementation slices.
