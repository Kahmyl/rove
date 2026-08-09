# Rove

Rove is a local-first, headed-browser task runtime shared by an external MCP agent and a human. Rove owns browser execution, session state, control handoff, observations, and evidence; it intentionally contains no built-in planner or LLM.

## Workspace

- `apps/runtime` — NestJS composition root and private runtime API
- `apps/mcp` — MCP transport and tool adapter boundary
- `apps/companion` — Electron + React companion client
- `packages/protocol` — shared schemas, contracts, and structured errors
- `packages/browser` — browser-engine boundary (Playwright implementation follows in Phase 1)
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

The current container runs the runtime API only. The Electron companion must
run on the host, and browser execution will be added to Compose when the real
Playwright engine is implemented. The MCP HTTP service is likewise deferred
until its Streamable HTTP adapter exists; exposing a placeholder service that
immediately exits would make `docker:up --wait` misleading.

The current scaffold implements the Phase 0 domain and persistence foundation. Browser and MCP adapters deliberately expose typed seams and explicit `NOT_IMPLEMENTED` failures until their Phase 1/3 implementations land; no unsafe selector or arbitrary JavaScript fallback is present.

See [docs/architecture.md](docs/architecture.md) for boundaries and the next implementation slices.
