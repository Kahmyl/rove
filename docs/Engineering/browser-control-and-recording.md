# Browser Control and Recording

**Status:** Target capability contract. The bounded task-owned page-group behavior described as implemented below has executable evidence in the current Playwright/Runtime path. Requested video and the broader shared-state qualification matrix remain unfinished.

## Browser ownership

A browser is acquired when an authorized task operation needs it or the user explicitly opens it. A task can exist and continue without a browser. Releasing or closing a browser attachment does not delete or permanently close its conversation.

Use a managed host for each Rove-owned browser identity. Several tasks may own separate page groups in that host. The group is an application ownership map; a visual tab-group label alone is not access control. Navigation, inspection, mutation, tab switching, and closing must resolve the exact task/page association.

Associate newly created tabs and popups with the originating task. When ownership cannot be established, do not assign a page to whichever task is selected in the UI. Reconcile or ask the user. A cross-task page transfer is explicit, not an accidental focus change.

Pages in one context share identity/state. [Playwright BrowserContext](https://playwright.dev/docs/api/class-browsercontext) documents context-level resources; page groups are not separate cookie jars. Separate browser identities are required when actual account isolation is needed. Never run multiple writable hosts against one profile merely to achieve task concurrency.

### Implemented ownership boundary

Runtime keeps the existing exact task-to-session capability association and attaches browser resources lazily. For a persistent workspace, BrowserService owns one physical browser host and profile lease, then returns a session-scoped page-group view to each browser-using task. Temporary browser sessions retain distinct hosts. The view filters page inventory, requires owned page identifiers for page-specific commands, rewrites physical host results to the owning Runtime session, and routes browser activity by the page ownership map. A popup inherits its opener's group; a newly requested page is assigned to the requesting group before it is exposed.

The logical active page belongs to the task group and is independent of the physically focused browser tab. Physical focus changes therefore cannot redirect another task's command. Human takeover presents the requesting group's logical page before control is reported; presentation failure aborts takeover. Ending one Runtime session first closes attribution to that group, drains its owned pages, and removes only that group; late opener activity remains unowned rather than resurrecting released ownership. The shared browser and profile lease remain until the last group detaches. Existing nonblank pages whose ownership cannot be proven after host recovery remain unassigned, and a recovering task receives a fresh owned page instead of inheriting whichever page happens to be focused.

Persistent host release is complete only after the owned browser process is positively observed dead. An incomplete CDP/termination attempt leaves the host closing and retains its persistent-host metadata and profile lease so cleanup can retry; it is not converted into successful release.

This adapter boundary is deliberately smaller than either a context-per-task design or a host-wide task mutex. Separate contexts would turn the group into an authentication/isolation boundary and no longer model one shared browser identity; a task-lifetime mutex would discard safe page-level concurrency. Session-scoped views over one host retain the existing BrowserSession contract while allowing coordination to widen only for the operation that touches shared context or physical focus.

## Coordination scope

Independent task-owned page operations may proceed concurrently when supported safely. The implemented host coordinator admits page-targeted work concurrently, serializes focus-dependent operations, and blocks conflicting mutations across the host during human takeover. Credential entry and consequential interaction dispatch use a browser-context admission boundary: they wait for admitted page mutations to drain, prevent another group's mutation from overlapping that one operation, and invalidate pre-change target authority on the context's other pages. Human return likewise invalidates target and in-flight grounding authority on every owned page before host mutation admission reopens. Observational reads of another owned group remain available during takeover and context-scoped dispatch and must still pass that task's freshness checks before later mutation.

These implemented classifications do not claim exhaustive detection of every shared-state change. In particular, ordinary navigation that changes authentication through cookies and multi-step clipboard interference remain qualification scenarios unless source evidence assigns them a broader operation scope. Coordinate additional page mutations or broaden the boundary only for a proven shared resource such as browser settings, clipboard, or a transaction spanning shared resources.

Admission waits identify the resource and preserve other task operations. Do not hold a global or host lock for an entire task lifetime. Bound queues and clean up ownership after verified process death. Unknown processes are not killed to free a profile.

Human takeover prevents new conflicting mutations before showing control as acquired. If safe isolation cannot be established within a shared host, pause that host's conflicting actions while keeping unrelated tasks/capabilities usable. On return, inspect actual state and discard stale target references.

## Observation and action

Observations provide bounded meaningful content, semantic structure, current page identity/revision, target provenance, and visual context when useful. Icon-only controls, menus revealed by hover, dynamic lists, dialogs, frames, editors, and popups are ordinary test families, not reasons for website-specific architecture.

Use screenshots promptly when structure is insufficient. The same task model can interpret them; do not add a paid perception service by default. Screenshot capture binds current viewport/page evidence so a visual target is not reused after navigation or material change.

An action checks current ownership, target freshness, visibility/actionability, grant/approval scope, and applicable resource coordination. Then dispatch once and inspect the resulting state. Distinguish dispatched input from a verified outcome. Recoverable stale observations can be refreshed; uncertain consequential actions cannot be blindly retried.

Multi-step consequential work retains a single consequence identity with an explicit commit boundary and outcome evidence. Preparation does not authorize another destination or mechanism after an uncertain commit. This preserves useful existing Rove semantics without making all navigation globally restrictive.

## Files, dialogs, and diagnostics

Uploads reference explicitly granted local files or managed artifacts, not arbitrary paths from agent text. Downloads have a task association, expected effect, managed destination, and integrity metadata. A new download event from unrelated activity is not proof of the current action's result.

Handle JavaScript dialogs, permissions, authentication, and human verification through explicit policies. Do not automatically accept browser permission prompts or fill credentials from workflow text. Optional page UI should not cause unnecessary handoff after the requested outcome has already been established.

Console/network evidence is opt-in and task-scoped. Bound retained events and redact sensitive values. Failed analytics or optional subresources are not automatically a task failure; determine whether the required outcome is affected. Do not build a general observability platform as a prerequisite.

## Capture Mode

Record meaningful human navigation, page changes, selected interactions, and explicitly requested evidence within the intended scope. Avoid raw cursor logging, secret form contents, or unrelated tabs by default. Runtime assigns actor/control context; agent actions must not be mislabeled as the human's captured journey.

A useful output identifies where the user went and what they inspected or selected. Generating a model summary requires model access; collecting a native recording is not itself an inference call. Stop capture and finish a summary without deleting the local task.

## Recording on request

Video is available on explicit request in Agent, Companion, and Capture modes. Start/stop controls and the active scope remain visible. Stopping video does not stop the task. Recording starts when requested, not retrospectively.

For page video, qualify [Playwright Screencast](https://playwright.dev/docs/api/class-screencast). For a selected browser-window recording, qualify [Electron desktop capture](https://www.electronjs.org/docs/latest/api/desktop-capturer). Their scope differs: a single page must not be advertised as covering browser chrome, every tab, new windows, or native dialogs. OS permission and platform limitations must be handled explicitly.

Use recording states such as requested, recording, finalizing, available, and failed. Publish a playable local artifact only after successful finalization. Preserve a recoverable partial file where supported, but label it honestly. Disk exhaustion, renderer failure, browser exit, and permission revocation are required tests.

Sensitive-data handling is independent of screenshot masking. Test pause/exclusion around protected interactions, or explain/refuse unsupported private capture. Never silently include unrelated windows. Retain video locally under the agreed persistence boundary; interactive DOM replay and cloud storage are unnecessary for this capability.

## Qualification

Test several tasks in one profile, task changes during browser events, popup ownership, human control, stale targets, shared account changes, clipboard/focus conflicts, profile-host restart, downloads, and recording scope. Compare alternatives on these same scenarios before replacing useful custom behavior. The capability inventory in `tests/fixtures/capabilities` is supporting coverage data, not a claim that every listed capability is implemented.
