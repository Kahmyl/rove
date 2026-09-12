# Verification routing

Run the narrowest meaningful checks first, then expand according to risk.

| Change                               | Minimum focused evidence               | Broader evidence when applicable                                                   |
| ------------------------------------ | -------------------------------------- | ---------------------------------------------------------------------------------- |
| Documentation or repository guidance | `pnpm check:repository`                | `pnpm codex:environment:check` for Codex environment changes                       |
| TypeScript behavior                  | Targeted Vitest file(s)                | `pnpm typecheck`, `pnpm build`, `pnpm test`                                        |
| Task/Codex lifecycle                 | Focused companion or protocol tests    | recovery contract/process checks; schema/component checks if compatibility changed |
| Browser capability                   | Focused package/runtime/MCP tests      | semantic transactions, capability integration, matching Playwright browser checks  |
| SQLite or migration                  | Store tests using temporary homes      | restart, atomicity, compatibility, backup/recovery evidence                        |
| Packaging/native dependency          | source build and focused package tests | packaged desktop and installed component-set qualification                         |
| Experiment harness                   | matching Node test and fixture run     | `pnpm test:experiments`                                                            |

The standard full local sequence is:

```bash
pnpm install --frozen-lockfile
pnpm check:repository
pnpm typecheck
pnpm build
pnpm test
pnpm test:experiments
```

Do not run `agent:live`, source-product live checks, profile authentication, browser tests against real accounts, or third-party actions without explicit authorization. A real browser check may also require the matching Playwright browser and a headed desktop or virtual display.
