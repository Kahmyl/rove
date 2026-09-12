# Rove

Rove is a task and workflow assistant for getting digital work done. Users can delegate work, collaborate with the assistant, or perform work while Rove captures a useful record. Browser control is a capability acquired when needed, not the product's identity.

**Rove is under development.** The agreed product model is documented; the existing implementation does not yet establish every intended behavior. Start with the [documentation index](docs/README.md), [Product Brief](docs/Products/product-brief.md), and [Product Direction](docs/Products/product-direction.md).

## Direction

Tasks are durable local conversations with many turns and freedom to change direction. Workflows supply reusable approved context. Workflow setup can follow a Rove profile across devices; task history, artifacts, credentials, and live browser state remain local. The ChatGPT/Codex connection supplies model access independently of Rove identity.

Several tasks should be able to use task-owned browser page groups with coordination only for conflicting resources. Agent, Companion, and Capture modes support different kinds of participation. Recording is available on request rather than always running. These are target requirements, not claims that this documentation cleanup implements them.

## Repository

| Location                      | Responsibility                                                             |
| ----------------------------- | -------------------------------------------------------------------------- |
| `apps/companion`              | Electron/React interface, local product service, and Codex integration.    |
| `apps/runtime`                | Existing private browser/session execution composition.                    |
| `apps/mcp`                    | MCP adapter and tools.                                                     |
| `apps/control-plane`          | Existing relay development code; not a mandatory local-product dependency. |
| `packages`                    | Shared contracts, browser capability, configuration, and storage.          |
| `docs`                        | Current product and engineering contracts.                                 |
| `tests/fixtures`              | Retained regression input data and manual test pages.                      |
| `experiments/agent-execution` | Executable model-interface and recovery investigations.                    |
| `artifacts`                   | Ignored generated evidence and packaging output.                           |

## Development

Use the package manager declared in `package.json` and a supported Node environment:

```bash
pnpm install --frozen-lockfile
node scripts/check-repository.mjs
pnpm typecheck
pnpm test
pnpm build
pnpm dev:desktop
```

Browser tests require the matching Playwright browser; native database modules must match the executing runtime. See [Testing and Operations](docs/Engineering/testing-and-operations.md) for fixture/process checks, installed-package qualification, and live-test boundaries. Current development commands may expose older behavior while implementation is reconciled with the target design.

Rove is intended to be free beyond eligible user-supplied model access, without mandatory extra paid inference or browser services. Hosted workflow configuration and distribution still need realistic operational limits. No stealth or access-control bypass is part of the product.

See [Contributing](CONTRIBUTING.md) for semantic naming and migration rules. Product edition labels and implementation milestone names are not used for documents, source files, or tests. Required dependency, package, protocol, and applied-database identifiers remain technical compatibility metadata.
