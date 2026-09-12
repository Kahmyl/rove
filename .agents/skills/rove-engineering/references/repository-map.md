# Repository context map

Use this map for routing. The current repository remains authoritative if paths change.

## Authority

- `docs/README.md`: documentation order and implementation-status caveats.
- `docs/Products/product-brief.md`: product purpose and concepts.
- `docs/Products/product-direction.md`: settled scope and acceptance outcomes.
- `docs/Products/platform-policy.md`: permissions, persistence, and user-control invariants.
- `docs/Products/product-operating-model.md`: intended user journeys and task behavior.
- `docs/Engineering/`: domain, architecture, storage, security, capability, browser, portability, event, technology, testing, and operations contracts.
- `CONTRIBUTING.md`: naming, fixtures, migrations, evidence, and standard checks.

## Implementation

- `apps/companion`: Electron host, renderer, local product state, and Codex adapter.
- `apps/runtime`: supervised browser/runtime authority.
- `apps/mcp`: task-scoped capabilities exposed to Codex.
- `apps/control-plane`: retained development infrastructure, not a product prerequisite.
- `packages/protocol`: shared contracts and generated upstream compatibility types.
- `packages/storage`: local persistence helpers.
- `packages/browser`: Playwright-backed browser behavior and qualification work.
- `packages/config`: configuration boundaries.

## Evidence and tooling

- `tests/fixtures` and package fixture directories: minimized reusable inputs.
- `experiments/agent-execution`: executable investigations and retained process checks.
- `scripts/check-repository.mjs`: maintained document, naming, and import checks.
- `artifacts/`: ignored generated reports, recordings, installers, and temporary continuation notes.
- `pnpm-lock.yaml`: resolved dependency truth.

Search before assuming a path still exists. Read only the contracts and code relevant to the objective, expanding when evidence crosses a boundary.
