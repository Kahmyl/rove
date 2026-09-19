# Technology Stack

**Role:** Implementation choices and evidence required for changes. Rove has no production product edition; dependency and protocol versions below are compatibility metadata.

## Retained foundation

| Responsibility                 | Direction                                                                                  | Reason                                                                                                         |
| ------------------------------ | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Application language/workspace | TypeScript and the existing pnpm monorepo                                                  | Reuse working code and contracts; avoid a language rewrite unrelated to product behavior.                      |
| Desktop interface              | Electron, React, Vite                                                                      | Existing shell and secure host/renderer boundary; a shell change does not remove browser or model supervision. |
| Agent execution                | Qualified local Codex App Server through a narrow stdio adapter                            | Reuse conversation/turn machinery rather than adding another planner.                                          |
| Browser capability             | Playwright-backed adaptive execution/reconciliation capability, retaining useful Rove authority and recovery behavior | Existing generic browser primitives, structured and visual perception, and task-aware control; alternatives require comparative evidence. |
| Local structured data          | SQLite, better-sqlite3, Kysely where appropriate                                           | Local durable work with explicit transactions; no full database synchronization.                               |
| Local browser API              | Existing Runtime composition where it remains useful                                       | Keep private execution authority without making its session model the product domain.                          |
| Contracts/validation           | Existing TypeScript and Zod boundary schemas                                               | Validate caller intent, engine messages, and capability results at authority boundaries.                       |
| UI rendering                   | Existing components first; selective accessible component libraries                        | A UI library must not own a competing execution queue or approval state.                                       |
| Verification                   | Vitest, Node's test runner for retained experiment tests, browser fixtures, package checks | Deterministic checks first; live model/service checks remain explicitly opt-in.                                |

## Reviewed dependency baseline

The inspected `pnpm-lock.yaml` resolves Playwright `1.62.1`, Electron `37.10.3`, React `19.2.8`, Supabase JavaScript `2.111.0`, Kysely `0.29.5`, better-sqlite3 `13.0.3`, Vite `7.3.6`, and Vitest `3.2.7`. The workspace requests pnpm `10.29.3`. The repository-owned Codex component manifest currently selects App Server `0.154.0-alpha.6.2` on macOS arm64 and records the exact executable, companion helper, generated schema, and qualification identity.

These are observations of the reviewed repository, not claims that they are the newest releases or that every combination is already supported on every platform. Install with the lockfile frozen. Update the binary, generated contracts, lockfile, native-module packaging, and verification evidence as one compatible change. Do not infer installed versions from a package range alone.

Required package `version` fields and generated upstream filenames remain technical metadata. Do not turn them into product branding, versioned design documents, or claims of a shipped Rove release.

## Codex component ownership

Rove development and packaged builds consume a Rove-managed Codex component selected by the repository-owned approved-component manifest. A mutable binary inside ChatGPT, an editor extension, or `PATH` is discovery evidence only; it is never the implicit runtime or packaging source. Normal development resolves the exact approved component from Rove's managed component store and fails with an actionable engineering error when it is absent or changed. A packaged application resolves only the exact component staged inside its application resources.

Candidate inspection and qualification are separate from installation and promotion. Qualification uses an explicitly named external executable, generates schemas through the upstream App Server commands, compares the capabilities Rove actually consumes, and records an immutable receipt binding exact executable/helper/schema identities to the required lifecycle and MCP compatibility evidence. Installation copies that receipt and already-qualified set into the managed store after re-verifying its identity; an exact existing install is idempotent and a conflict is never replaced. Reinstalling after requalification may durably upgrade only a missing receipt or the preceding exact component/digest receipt format when the existing executable/helper bytes and new external qualification receipt both match, without deleting or replacing the immutable binaries. Promotion durably changes one repository selection only after the target and every retained-qualified rollback component pass managed executable/helper, receipt, checked-in schema-file, generated aggregate, and compiled Runtime binding verification; development resolution and package staging cannot select independently. Retain a previous qualified executable/helper/schema/validator set until the replacement has passed runtime and package preparation checks so rollback changes the whole selection rather than compatibility policy.

## Optional account and workflow-sync candidate

A personal Supabase Auth identity plus Postgres/RLS is integrated as the bounded candidate for cross-device approved Workflow setup, but is not registered during normal startup without explicit configuration and is not production-qualified. The desktop adapter uses `@supabase/supabase-js` with a publishable key and user session only. A narrowly scoped database function deletes only the authenticated subject, so no service-role authority is shipped or added as another hosted runtime.

This choice does not move tasks or artifacts to hosted Postgres. Do not add PowerSync, general-purpose row replication, organizations, or another application service solely to move the approved configuration documents.

Before selecting a provider, record actual free limits, inactivity behavior, email/social sign-in requirements, data region, export/deletion support, and operator cost. A free tier does not guarantee unlimited users, permanent availability, or zero future operating expense. No provider should receive Codex credentials or browser cookies through workflow configuration.

## Browser and recording choices

Compare the existing browser adapter against a maintained stock adapter only on representative Rove tasks: correct targets, dynamic content, ownership, human takeover, recovery, files, and model usage. Retain whichever meets the requirements with less maintenance; do not ship competing default browser engines.

For requested page video, qualify Playwright's [Screencast API](https://playwright.dev/docs/api/class-screencast), documented as introduced in `1.59`. For selected-window capture, qualify Electron's [desktop capture API](https://www.electronjs.org/docs/latest/api/desktop-capturer), including platform permissions. API availability is not evidence that recording, privacy, and playable-artifact handling are already implemented.

The current model should interpret screenshots where useful. An additional paid perception model is not a default dependency. Interactive DOM replay is not required merely to produce a requested video.

## Tools not required by the MVP

Do not add a second agent framework, distributed job/workflow engine, visual DAG builder, vector database, broad plugin marketplace, full task-sync platform, or hosted browser fleet without a demonstrated requirement. Keep abstractions small enough to replace an adapter without rebuilding the application around it.

Skills may use the [Agent Skills format](https://agentskills.io/specification), but procedural content remains subordinate to Rove's permission and context rules. A skills format is not a security sandbox or an account system.

## Dependency acceptance

A proposed replacement must demonstrate a concrete benefit and retain required behavior. Record license terms for the exact edition, local/native packaging implications, security maintenance, offline behavior where applicable, hidden paid services, and recovery characteristics. Preserve the current implementation until the replacement passes the relevant tests; sunk cost is not an acceptance criterion.

The official [Codex App Server documentation](https://developers.openai.com/codex/app-server/) is the integration reference. Pin and verify supported features rather than assuming every current upstream field is available in the repository's selected binary. This documentation package changes no dependency versions.
