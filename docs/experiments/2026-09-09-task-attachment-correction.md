# Task attachment correction record

Date: 2026-09-09  
Status: ready for independent Master review; one external product gate and one
manual consent gate remain pending

## Finding-by-finding disposition

1. **Bootstrap and cleanup were not durable — corrected.** Attachment binding,
   MCP verification, known-safe rollback, Runtime evidence cleanup, Runtime
   shutdown, vault cleanup, and terminal attachment settlement now have durable
   stages. Restart resumes the recorded stage. The L2 close matrix includes the
   `attachments_settled` process cut.
2. **Local vault mutations were not transactional — corrected.** Blob writes
   use temporary files and atomic rename; manifest replacement is atomic;
   remove, cleanup, replacement, cancellation, and failed materialization keep
   their prior in-memory and durable claims when persistence fails. Startup
   removes unreferenced blobs and temporary files.
3. **Multi-file Runtime materialization lacked compensation — corrected.** One
   opaque grant identifies the batch. Any rejected or mismatched response
   invokes the authenticated, session-scoped Runtime grant-delete endpoint and
   then settles the local binding claim. Runtime deletion is idempotent and
   removes payloads before metadata.
4. **Runtime acknowledgements could be duplicated after a process cut —
   corrected.** The manifest records `binding` plus the grant before upload.
   Recovery lists Runtime evidence, validates exact session/type/name/MIME/
   length/SHA-256/source/grant metadata, adopts exact matches, and uploads only
   missing evidence.
5. **Restore validation and unavailable-file recovery were incomplete —
   corrected.** Manifest schema 2 strictly validates identities, duplicate
   names, cardinality, aggregate size, state relationships, and attention
   uniqueness. Schema 1 is rejected pending explicit migration. Missing or
   changed bytes become visible `unavailable` task attachments and can only be
   replaced through the explicit **Reselect** action.
6. **Host-path privacy could leak through errors — corrected at this boundary.**
   Picker and attachment failures containing path-shaped text are replaced by
   bounded product messages. Renderer/task projections contain only safe leaf
   name, MIME, byte length, digest, status, and opaque identities.
7. **Automated provenance was overstated — corrected.** The qualification now
   builds and launches the real source Electron renderer and drives semantic
   **Attach files**, **Replace**, and **Remove** controls with an exact 74-byte
   constructor-composed picker. The qualification entry is pruned from desktop
   staging and excluded from packaging. The harness reports
   `sourceProduct: false`: it does not claim the full signed-in task journey.
8. **Mid-task selection disappeared before Runtime settlement — corrected.** A
   selected grant remains a durable, visible operation with exact request,
   task, session, grant, and attachment identities. Runtime success removes it
   atomically with binding; uncertain upload, cleanup, or manifest settlement
   becomes `reconciliation_required` with Retry/Cancel/Finish paths. Startup
   reconciles exact Runtime evidence and adopts an existing upload without a
   duplicate upload or tool turn.
9. **Unavailable-file reselection retired the old grant too early —
   corrected.** Reselection now snapshots every still-valid peer in the old
   grant, persists a replacement operation, materializes and validates the
   complete new grant while the old grant remains valid, then atomically
   switches the task. Old-grant cleanup is a recoverable `cleanup_required`
   stage. A two-file failure/restart test proves that cleanup begins only after
   both replacement-grant uploads and converges after restart.

## Verified limits

- 100 files per task.
- 64 MiB per user-granted file.
- 128 MiB aggregate task attachment bytes.
- Source paths are never authority and are not persisted or projected.

## Reproduction

```sh
pnpm phase5:attachments
pnpm phase5:attachments:source-product
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm phase5:p59:l0
pnpm phase5:p59:l2
git diff --check
```

Observed results:

- Attachment source-renderer/component harness: 70/70 tests passed; semantic
  renderer check passed with `fixtureBytes: 74` and `nativeOsPicker: false`.
- Full repository: 145 files, 1003/1003 tests passed.
- L0 lifecycle oracle: 55 fixture cases, 8,640 exhaustive states, and 56,243
  assertions passed.
- L2 recovery: all eight scenarios passed, including five close-stage cuts;
  zero stale child processes, ports, profile locks, attached browsers,
  nonterminal Runtime sessions, or cleanup-required tasks remained.
- Earlier desktop package preparation and smoke verification passed; packaging
  was not rerun during this correction review.
- Typecheck, lint, build, Prettier checks, and `git diff --check` passed.

## Gates intentionally still pending

1. The full continuous source-product driver now exists and reaches the real
   source renderer, selects the composition-only 74-byte file, chooses a
   Temporary browser, and prepares the normal task launch. The product then
   disables **Start task** with the exact gate `Sign in to Rove with ChatGPT
before starting.` The isolated qualification home has no authenticated App
   Server account. Supplying, copying, or automating user credentials would
   cross the external authentication boundary, so no Runtime session, browser
   upload, Finish, or Archive claim is made. Reproduce with
   `pnpm phase5:attachments:source-product`; the driver reports the complete
   visible product gate and never drives the task browser.
   A separate canonical-home command,
   `pnpm phase5:attachments:source-product-live`, preserves the qualification
   picker as source-only composition while using the existing signed-in product
   session without copying or exposing credentials. Its first probe passed the
   account gate and invoked **Start task**, but the driver followed the mutable
   `currentTaskId`; that identity cleared before its completion read, so the
   probe stopped without claiming Runtime evidence, upload, Finish, Archive, or
   restart cleanup. The driver now captures the newly created immutable task
   ID, preflights/converges visible unfinished work, returns from terminal task
   history through the semantic **Back to new task** control, and fails closed
   unless the **Desired outcome** composer is visibly restored. The corrected
   canonical rerun was blocked by the execution approval boundary because it
   can finish pre-existing canonical tasks and creates and archives a real
   account-backed task; explicit user authorization is still required. The
   isolated attachment/component qualification was rerun after this correction
   and passed 70/70 with the exact 74-byte fixture.
2. A human release reviewer must click **Attach files** and complete the real
   operating-system picker consent flow. The automated picker is deliberately
   not accepted as OS-picker evidence.

No external Drive mutation, staging, commit, package publication, or release
acceptance was performed.
