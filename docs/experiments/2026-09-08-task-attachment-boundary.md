# Task-scoped attachment authority

Date: 2026-09-08

Status: implementation candidate for independent review

## Problem

Rove browser upload already accepts only opaque session-scoped file evidence.
Existing local files, however, can enter that model only through an
agent-triggered native picker. The product composer cannot pre-authorize a
file, and an active task blocks synchronously inside the picker without a
durable, visible file-attention state.

Mentioning `/tmp/foo` in a task is data, not authority. The product must never
turn prompt text, automation heuristics, or approval policy into permission to
read a local path.

## Decision

Rove uses one immutable user-selected attachment model for both pre-launch and
mid-task selection:

1. Only the trusted native host opens the operating-system picker, following
   an explicit renderer action or a visible mid-task Select files action.
2. The host reads and snapshots selected regular-file bytes once. It stores
   those bytes in a private product attachment vault, never the source path.
3. Renderer and persisted task state contain only a safe leaf filename, MIME
   type, byte length, SHA-256 digest, lifecycle status, and opaque attachment
   ID. Source paths never reach the renderer, prompt, App Server conversation,
   telemetry, or error strings. At initial submission, immutable snapshots are
   projected into the protected per-task workspace and included as first-class
   App Server user inputs, matching the Codex Desktop composer contract.
4. Launch binds all selected drafts to the host-created task ID and Runtime
   session, materializes session-scoped `user_file_grant` evidence, and injects
   the resulting evidence IDs plus safe metadata into trusted developer
   instructions. Browser upload continues to accept only those evidence IDs;
   the App Server input projection does not replace or widen browser authority.
5. `evidence.request_file_grant` creates durable file attention. The product
   foregrounds the unified surface, shows the reason and cardinality, and waits
   for Select files or Cancel. Selection/cancellation resolves the exact
   request once and the blocked tool call resumes the same turn; no synthetic
   user message is sent.

The bounded aggregate limit is 128 MiB per task, in addition to 100 files and
64 MiB per file. Duplicate safe names are rejected because a chip or later
instruction could not identify them unambiguously. Duplicate contents with
different safe names are allowed and retain distinct authority IDs.

## Persistence and recovery

The private vault stores immutable bytes under opaque IDs with mode `0600` and
an atomic versioned manifest containing only safe metadata and bindings. A
draft survives a renderer or Desktop restart. Once bound, it is usable only by
the exact task and Runtime session. Startup verifies every byte length and
digest. Missing, corrupt, legacy, or partially bound bytes fail closed and are
projected as requiring removal/reselection; Rove never saves a source path and
never rereads a changed source file.

Launch failure removes newly bound Runtime evidence and unneeded vault bytes
through session cleanup; Finish, Archive, cancellation, and terminal recovery
release task-bound vault entries without touching the user's source file.
Concurrent launch and selection use exact operation/request IDs and serialized
state transitions. Stale task/session/request identities, duplicate or late
selection, and repeated continuation are rejected.

## MIME and names

Safe leaf-name normalization removes control characters, trims and bounds the
name, and never exposes directories. MIME starts with bounded content sniffing
for common binary signatures and UTF-8 text; an extension mapping is only a
fallback and is never trusted over a recognized signature. Exact byte length
and SHA-256 are always computed from the immutable snapshot.

## UX

The new-task composer exposes an accessible **Attach files** button and
attachment chips with filename, bounded size/status, **Remove** and **Replace**
actions. Heuristics may display a suggestion when prompt text resembles a local
path, but cannot open the picker or grant authority.

Mid-task file attention is distinct from browser Take Over/Return Control.
Compact view may summarize it; expanded and full views show the visible reason,
requested cardinality, **Select files**, and **Cancel**. The existing unified
scroll container remains authoritative; there is no attachment window.

## Rejected alternatives

- **Raw prompt path:** rejected because text is not consent and would create an
  unrestricted local-read/exfiltration primitive.
- **Persistent unrestricted directory access:** rejected because it broadens
  authority beyond the exact immutable selection and makes revocation unclear.
- **Hidden automatic selection:** rejected because heuristics are UX hints, not
  user consent.
- **Direct Runtime injection:** rejected because it bypasses the native product
  decision and task lifecycle.
- **Agent-created file substitution:** rejected because
  `evidence.create_file` authorizes supplied content, not an existing user file.
- **Drive-specific handling:** rejected because attachments are a product
  authority independent of the destination website.

## Acceptance boundary

Deterministic adapters may return fixture bytes directly to the host boundary,
but production composition always uses Electron's native picker. Test injection
must not be selectable by a production command, environment variable, prompt,
or renderer IPC. Automated integration proves product/task/evidence plumbing,
not real OS-picker consent. Release acceptance still requires one manual
**Attach files** → native picker selection.

## Operator model and verification

The attachment vault lives under the Desktop product home at
`task-attachments/`; it is product-private state, not a user-managed folder.
Operators should diagnose it only through the projected chip/attention status.
They must not copy files into the vault or edit its manifest. A corrupt or
unsupported manifest is a startup failure; a missing/corrupt blob becomes an
unavailable chip that the user can Remove or Replace. Closing or archiving a
task removes its bound vault entries. A picker cancellation creates no grant.

The deterministic component-integration harness is:

```sh
pnpm phase5:attachments
```

It uses a constructor-injected picker adapter, sends an exact 74-byte fixture
through the real attachment authority and Runtime client upload request,
checks opaque task/session/evidence binding and path privacy, then verifies
cleanup. It also builds and launches the source Electron renderer, selects the
semantic **Attach files**, **Replace**, and **Remove** controls, and verifies the
74-byte chip without a path. The qualification entry point is excluded from
desktop packaging. This is explicitly **not** an OS-picker acceptance result.
Production exposes no renderer command, prompt field, or environment variable
for selecting the adapter; its packaged composition always constructs the
Electron native picker.

This harness does not prove a signed-in product task launch, Runtime session
binding, harmless managed-browser upload, and Finish/Archive cleanup as one
continuous product journey. That full source-product gate remains pending and
must not be inferred from the renderer and component results.

The manual release gate is prepared but intentionally not self-accepted:

1. Launch the production Desktop composition with a clean product home.
2. In the new-task composer, choose **Attach files**.
3. Confirm the operating-system picker appears only after that click.
4. Select a known 74-byte fixture and confirm a safe filename/size chip appears
   with **Replace** and **Remove**, without any directory path.
5. Launch an Agent task that uploads it; confirm the task receives an opaque
   evidence ID and the destination receives the exact fixture bytes.
6. Trigger a mid-task `evidence.request_file_grant`; confirm the product shows
   separate file attention with **Select files** and **Cancel**, and no browser
   takeover state change.
7. Exercise Cancel, wrong/stale response, repeated response, and picker failure;
   confirm one bounded result and no duplicated turn or upload.
8. Finish and archive the task, restart Desktop, and confirm no task-bound chip,
   attention item, vault bytes, or recoverable grant remains.

This manual gate remains pending for the Master/release reviewer because it
requires real native OS-picker consent.

## Automated acceptance record

Run on 2026-09-08 after implementation and the final crash-window audit:

- Attachment source-renderer and component harness: 70/70 passed, including the deterministic
  74-byte picker fixture, Runtime request, evidence binding, privacy, and
  cleanup.
- P5.6/P5.7 product, IPC, recovery, preload, and renderer regressions: 180/180
  passed.
- P5.9 L0 lifecycle oracle: 55 fixture cases, 8,640 exhaustive states, and
  56,243 assertions passed.
- P5.9 L2 production-equivalent recovery: all eight scenarios passed with zero
  stale child processes, listening ports, profile locks, attached browsers,
  nonterminal Runtime sessions, or cleanup-required product tasks.
- P5.0 fixture suite: 75/75 passed.
- MCP source suite: 40/40 passed.
- Browser capability atlas: 9/9 passed. The sandboxed attempt was invalid
  because macOS denied Chromium's rendezvous service; the exact suite passed
  when rerun with browser-process permission.
- Final full repository suite: 1003/1003 passed. Full typecheck, build, lint,
  targeted Prettier check, and diff check passed.

The package-local MCP test script initially resolved the root Vitest include
glob from `apps/mcp`, producing “No test files found.” Its root/filter routing
was corrected; `pnpm test:mcp` now runs the same 40-test source suite.
