# Browser Control and Recording

**Status:** Implemented for bounded task-owned page groups and explicitly requested page video. Browser-window video and the broader shared-state qualification matrix remain unfinished and are refused rather than approximated.

## Browser ownership

A browser is acquired when an authorized task operation needs it or the user explicitly opens it. A task can exist and continue without a browser. Releasing or closing a browser attachment does not delete or permanently close its conversation.

Use a managed host for each Rove-owned browser identity. Several tasks may own separate page groups in that host. The group is an application ownership map; a visual tab-group label alone is not access control. Navigation, inspection, mutation, tab switching, and closing must resolve the exact task/page association.

Associate newly created tabs and popups with the originating task. When ownership cannot be established, do not assign a page to whichever task is selected in the UI. Reconcile or ask the user. A cross-task page transfer is explicit, not an accidental focus change.

Pages in one context share identity/state. [Playwright BrowserContext](https://playwright.dev/docs/api/class-browsercontext) documents context-level resources; page groups are not separate cookie jars. Separate browser identities are required when actual account isolation is needed. Never run multiple writable hosts against one profile merely to achieve task concurrency.

### Implemented ownership boundary

Runtime keeps the existing exact task-to-session capability association and attaches browser resources lazily. For a persistent workspace, BrowserService owns one physical browser host and profile lease, then returns a session-scoped page-group view to each browser-using task. Temporary browser sessions retain distinct hosts. The view filters page inventory, requires owned page identifiers for page-specific commands, rewrites physical host results to the owning Runtime session, and routes browser activity by the page ownership map. A popup inherits its opener's group; a newly requested page is assigned to the requesting group before it is exposed.

The logical active page belongs to the task group and is independent of the physically focused browser tab. Physical focus changes therefore cannot redirect another task's command. Human takeover presents the requesting group's logical page before control is reported; presentation failure aborts takeover. Ending one Runtime session first closes attribution to that group, drains its owned pages, and removes only that group; late opener activity remains unowned rather than resurrecting released ownership. The shared browser and profile lease remain until the last group detaches. Existing nonblank pages whose ownership cannot be proven after host recovery remain unassigned, and a recovering task receives a fresh owned page instead of inheriting whichever page happens to be focused.

The desktop control path preserves the same ownership boundary. Take Over, Pause, Return Control, and browser presentation start from the exact Task acted on, resolve its durable Runtime association in the host, and address that session explicitly. Take/return operations additionally preserve the exact live handoff identity and generation; every ownership mutation carries the expected ownership generation into Runtime and fails before transition when it is stale. The selected Task, physically focused page, or most recently updated Runtime session is presentation evidence only. Task-specific recording commands and playback likewise resolve their stored Task/session association and cannot fall through to another task's page group.

Persistent host release is complete only after the owned browser process is positively observed dead. An incomplete CDP/termination attempt leaves the host closing and retains its persistent-host metadata and profile lease so cleanup can retry; it is not converted into successful release.

This adapter boundary is deliberately smaller than either a context-per-task design or a host-wide task mutex. Separate contexts would turn the group into an authentication/isolation boundary and no longer model one shared browser identity; a task-lifetime mutex would discard safe page-level concurrency. Session-scoped views over one host retain the existing BrowserSession contract while allowing coordination to widen only for the operation that touches shared context or physical focus.

## Coordination scope

Independent task-owned page operations may proceed concurrently when supported safely. The implemented host coordinator admits page-targeted work concurrently, serializes focus-dependent operations, and blocks conflicting mutations across the host during human takeover. Credential entry and consequential interaction dispatch use a browser-context admission boundary: they wait for admitted page mutations to drain, prevent another group's mutation from overlapping that one operation, and invalidate pre-change target authority on the context's other pages. Human return likewise invalidates target and in-flight grounding authority on every owned page before host mutation admission reopens. Observational reads of another owned group remain available during takeover and context-scoped dispatch and must still pass that task's freshness checks before later mutation.

These implemented classifications do not claim exhaustive detection of every shared-state change. In particular, ordinary navigation that changes authentication through cookies and multi-step clipboard interference remain qualification scenarios unless source evidence assigns them a broader operation scope. Coordinate additional page mutations or broaden the boundary only for a proven shared resource such as browser settings, clipboard, or a transaction spanning shared resources.

Admission waits identify the resource and preserve other task operations. Do not hold a global or host lock for an entire task lifetime. Bound queues and clean up ownership after verified process death. Unknown processes are not killed to free a profile.

Human takeover prevents new conflicting mutations before showing control as acquired. If safe isolation cannot be established within a shared host, pause that host's conflicting actions while keeping unrelated tasks/capabilities usable. On return, inspect actual state and discard stale target references.

## Adaptive observation, action, and reconciliation

Observations provide bounded meaningful content, semantic structure, current page identity/revision, target provenance, coverage/truncation metadata, and visual context when useful. Icon-only controls, menus revealed by hover, dynamic and virtualized lists, dialogs, frames, editors, and popups are ordinary capability families, not reasons for website-specific architecture.

The browser capability treats observation limits as control input. When text is truncated, target exposure is bounded, structure is ambiguous, state is still converging, or the required proposition is not represented in the current view, Rove should change how it observes rather than silently ask Codex to prove an outcome from incomplete evidence. Progressive observation can include targeted/scoped inspection, differently bounded capture, scroll/search, waiting for convergence, another read-only application view, or a screenshot.

Use screenshots promptly when structure is insufficient or the important control/state is primarily visual. The same task model can interpret them; do not add a paid perception service by default. Screenshot capture binds current viewport/page evidence so a visual target or conclusion is not reused after navigation or material change. Visual evidence complements semantic structure rather than replacing freshness, ownership, or authorization.

Codex should reason primarily in terms of the user's intended browser outcome and current grounded state. The browser capability may translate that intent into Runtime expected effects, target/scope predicates, correlation strategies, or other verification mechanisms internally. Those primitives remain valuable safety/evidence mechanisms but are not themselves the user outcome, and Codex should not need detailed knowledge of Rove's truncation or verifier implementation to choose a safe proof strategy.

An action checks current ownership, target freshness, visibility/actionability, grant/approval scope, and applicable resource coordination. Then the consequential mutation is dispatched at most once under its stable consequence identity. Immediate successor inspection may establish the effect; a completed click or input alone does not.

If dispatch occurred but immediate evidence is insufficient, preserve the operation as dispatched/unverified and enter bounded read-only reconciliation. Reconciliation may fresh-inspect, wait for asynchronous convergence, inspect a target or semantic scope, search the application, navigate to an authoritative read surface, use screenshot/visual evidence, or correlate durable Runtime/browser evidence. It remains tied to the existing operation and consequence identity. It cannot repeat the mutation, change approved material, switch transport to evade the fence, or treat unrelated/pre-existing state as causal proof.

Only after permitted reconciliation cannot establish the effect should the operation become genuinely unresolved or require human reconciliation. An unknown outcome therefore fences mutation replay without making the browser incapable of learning more about what already happened.

Multi-step consequential work may retain specialized transaction identity where a transfer or other operation spans several resources/locations. Specialized semantic transactions should reuse the same meanings for observation, dispatch, reconciliation, evidence, and unresolved outcome rather than becoming a separate browser truth model.

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

### Implemented page-video boundary

Runtime records an explicitly selected task-owned page through Playwright Screencast in Agent, Companion, and Capture modes. The immutable record binds the task, Runtime session, participation mode, original page, truthful coverage and exclusions, and the explicit `user_confirmed_visible_content` policy. The UI renders requested as a disabled **Starting page recording…** state, exposes Stop only for recording, keeps task ownership and active/finalizing state visible, and leaves the task, browser, and Runtime session active when recording stops.

The recording store persists requested, recording, finalizing, available, and failed transitions beneath the local session boundary. A video becomes available only after Screencast stops, the staging file has a WebM EBML signature and minimum size, SHA-256 and byte length are computed, and an atomic rename succeeds. Interrupted active records become failed during recovery; an unverified partial is never advertised as playable. Renderer playback supplies only task and recording identifiers, which the host revalidates before deriving and opening the local path.

Continuous video does not inherit screenshot masking. Start therefore requires explicit acknowledgement, known sensitive input scopes are refused, and an agent type into a recognized sensitive control first stops that page's recording. The user-facing contract still requires the human to stop before manually revealing secrets because arbitrary future page content cannot be preclassified reliably.

Browser-window recording currently returns `RECORDING_SCOPE_UNAVAILABLE`. One physical browser window may contain manually selected or task-owned pages from several tasks, so Electron window capture would include browser chrome or another task's visible tab without preserving page-group ownership. Linux PipeWire source selection adds a further exact-source qualification gap. Do not enable window recording until the captured window is isolated to one task or an equivalently strong ownership and exclusion boundary is implemented and qualified.

## Qualification

Test several tasks in one profile, task changes during browser events, popup ownership, human control, stale targets, shared account changes, clipboard/focus conflicts, profile-host restart, downloads, and recording scope. Compare alternatives on these same scenarios before replacing useful custom behavior. The capability inventory in `tests/fixtures/capabilities` is supporting coverage data, not a claim that every listed capability is implemented.
