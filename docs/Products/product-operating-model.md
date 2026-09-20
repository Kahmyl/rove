# Product Operating Model

**Role:** Target user experience implementing the [Product Direction](product-direction.md). Supporting contracts live in the engineering documents.

## Entry and account connection

The user accesses a Rove profile independently of the connected ChatGPT/Codex account. The profile restores portable workflow setup. Local task history belongs to the profile on this device and is not downloaded from another device.

Connecting Codex enables model-assisted work. Disconnecting it does not hide previous results. The application must identify unavailable model access at submission, preserve the user's text if submission fails, and never leave a known-impossible request spinning as though it were running. A connection error and an exhausted allowance are distinguishable messages, with existing work still accessible.

If the local Codex host cannot start, Rove offers one application-level **Restart Rove** recovery through the trusted desktop boundary. Restart enters the normal managed shutdown path before Electron relaunches; the UI must not imply a task started or claim an in-memory draft will survive application restart unless that persistence is implemented.

A temporary workflow-sync outage does not disable already cached local tasks or approved guidance. Explicit Rove sign-out locks the profile's cached data; it is not equivalent to an incidental loss of connectivity. Reauthentication must not execute old requests.

## Main work surface

The user can find standalone tasks and tasks grouped by workflow, start new work, open results, and see which tasks need attention. Selecting a task changes the view only. Streaming output and requests continue to update the task that owns them, not the currently visible conversation.

Each task presents a conversation, compact acknowledgements for useful work saved to Outputs, active work status, and controls appropriate to its state. The composer remains a conversation entry point rather than a permanently expanded configuration form. Attachments, Commands, participation mode, approval policy, combined model and reasoning effort, and the send action remain quietly glanceable; less frequent Workflow, browser, recording, and other implemented task choices use the same progressive command disclosure. Exact Output context is optional input to the next request and appears as a `Using:` chip rather than Result-selection terminology.

When the selected task cannot continue without conversational input, its exact request temporarily replaces the ordinary composer with one response surface. Bounded choices remain optional rather than automatic, and a freeform alternative is available where the request permits it. A successful response returns the ordinary composer through the existing attention-response contract. Browser handoff and consequential approval retain their distinct controls and full truthful scope. Attention owned by another task is named **Needs input** on that exact task until the user opens and answers it; it cannot replace the selected task's composer.

| User action or condition                           | Required response                                                                                                                           |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Send a model request with known unavailable access | Explain the missing connection/allowance before accepting execution.                                                                        |
| Start non-browser work                             | Do not open or demand a browser.                                                                                                            |
| Open Browser explicitly                            | Attach or reveal the task's browser resources, without restarting the conversation.                                                         |
| No browser is attached                             | Say **No browser attached**; do not show a Guest or named profile identity until exact task attachment.                                     |
| Switch tasks                                       | Preserve both tasks, drafts, results, and routing.                                                                                          |
| Stop                                               | Prevent further dispatch; retain the conversation, partial work, and known/unknown action outcomes.                                         |
| Send after stopping or completion                  | Continue the same task with the new request; do not demand a new task.                                                                      |
| Change subject                                     | Follow the new request, using workflow guidance only where relevant.                                                                        |
| Browser becomes unavailable                        | Report affected operations; keep other capabilities and the conversation usable.                                                            |
| Archive                                            | Remove from ordinary navigation while retaining history in **Settings → Archived tasks**; do not confuse archiving with permanent deletion. |

The implementation may bound simultaneous execution for memory or account limits. It must identify the affected resource and must not make all other tasks inaccessible. A user request rejected because of model unavailability is not a draft task queued for later dispatch.

### Conversation acceptance and startup

Submitting a new task or follow-up is one conversation action. After durable local acceptance, the user's instruction appears immediately in its final transcript position while bootstrap and provider delivery continue asynchronously. A later exactly correlated provider `userMessage` corroborates that item rather than duplicating it. Rejection before durable acceptance preserves the draft and creates no false running task. Definite dispatch failure retains the accepted message with a customer-safe not-sent or failed state; uncertain delivery retains it while Rove reconciles existing delivery truth and never blindly redispatches.

Ordinary internal startup is hidden. Brief starts should not flash a separate lifecycle row; an anti-flicker delay around 200–300 ms is a reasonable value to qualify, not execution authority. Customer surfaces do not narrate bootstrap, Runtime or thread binding, capability issuance, dispatch intent, database commits, or reconciliation mechanics.

### Active and historical work

While Rove is genuinely working, the current work group is expanded and cannot be collapsed. It separates assistant commentary about intention from semantic activity describing concrete work. Long activity uses a bounded internal scroll area. When the user remains at its bottom, new activity follows; if the user scrolls upward, position is preserved and a subtle **Latest** affordance returns them to auto-follow.

Activity uses a small customer vocabulary such as read, search, navigate, inspect, change, create, run, transfer, capture, verify, and compare, with a meaningful target or detail. The projection preserves outcome truth: an action may be started, dispatched, checking, confirmed, failed, or unresolved, and is not phrased as completed before authoritative evidence supports that claim. Repeated safe reads may coalesce when the summary remains truthful; consequential operations, failures, approvals, transfers, state changes, uncertainty, and evidence needed to understand an outcome do not disappear into a summary.

After a turn completes, stops, or fails, its work group automatically compacts to a summary such as **Worked for 1m 18s** or **Stopped after 52s** and becomes manually expandable. A user's decision to reopen historical work is retained for the current rendered session; a fresh render may default terminal work to collapsed. Compaction preserves the final answer's scroll anchor.

Displayed duration is accumulated Rove-active working time. It pauses while waiting for the user or approval, while the human owns the browser, during return-control page checking, during internal state checking, and while stopping or stopped. A provider `in_progress` value alone cannot keep the timer running.

Ordinary completion adds no generic completion banner: final activity settles, the final assistant answer appears, historical work compacts, and the composer remains ready. Confirmed failure, uncertain consequential outcome, model unavailability, and inability to establish current state remain distinct. Generic retry is unavailable when it could duplicate a consequential effect.

### Queue, steer, and keyboard behavior

During active work, the default submit action adds a durable, ordered follow-up to that exact task. Queued instructions appear immediately above the composer, survive ordinary restart, and may be edited or removed; reordering should be supported where practical. They are not delivered transcript messages and are not automatically dispatched after restart. A queued instruction becomes a real user message only when its execution begins.

**Send now** explicitly steers active work at the next safe Codex boundary and immediately creates a real user conversation message. Customer work grouping follows meaningful interventions rather than assuming one group for every provider turn identifier. Target keyboard behavior is Enter for the state-default action, Command/Ctrl+Enter for Send now while active, and Shift+Enter for a newline, subject to platform and accessibility qualification.

### Stop and interaction capabilities

**Stop** always means interrupt current work. It remains a separate, stable hit target before a provider turn identifier exists, during active model work, and during waiting or safe checking states where accepted work remains nonterminal. Internally this may cancel pre-dispatch work, interrupt an exact turn, or prevent future work while preserving uncertainty around an operation that may already have dispatched.

On activation, the label becomes **Stopping…**, the control disables immediately, and duplicate stop intent is refused. Once authoritative interruption arrives, the work group becomes **Stopped**, the ordinary composer returns, and queued instructions remain queued. Stopping does not unexpectedly take browser ownership from a human.

Customer interaction capabilities are projected separately: submitting, queueing, steering, stopping, responding, taking control, returning to Rove, retrying a safe operation, and archiving must not be inferred as one interchangeable `allowedActions` list. A blocked composer does not imply Stop is unavailable.

### Attention, approval, and browser collaboration

Attention exists only when the customer must answer, approve or deny, select something, complete secure input, or take browser control. Automatic checking and recovery are not attention. Request presentation names the decision—such as **Allow this command?**, **Review proposed file changes**, or **Which account should I use?**—and keeps the exact material and scope visible. Actions use matching verbs such as Allow/Deny, Approve/Decline, Send, Open secure page, or Cancel. Internal request statuses are translated to their customer consequence.

Conversational input may temporarily replace the owning selected task's composer. Approvals generally sit immediately above it while the conversation and Stop remain usable. A request remains spatially stable while a response is committed; controls may show submitting or checking instead of disappearing under the pointer. Background attention labels only its owning task and never replaces another task's composer.

An Agent-requested browser handoff is **Waiting for you**, not an error. It explains the exact step, directs credentials to the browser rather than chat, freezes working duration, and offers one **Take Over** action that both presents the exact task-owned browser and safely transfers ownership. Agent work does not otherwise offer voluntary takeover. Companion work offers **Take Over** while the agent owns its browser, and emphasizes it for a requested handoff. Capture Mode is human-controlled by definition.

While the human owns the browser, the Task says **You're in control** and the primary action is **Return to Rove**. Stop remains available. Return begins **Checking the page…** without active-work timing, invalidates stale grounding, and performs fresh inspection before returning to Working or a terminal/ready state. If return fails, Rove says it could not take back browser control, offers a safe retry, and keeps ownership truthfully human.

Runtime may retain a browser-mutation pause primitive, but the main Task has no generic whole-Task Pause. The customer concepts are Stop, Take Over, and Return to Rove. A future whole-Task Pause requires a separate contract.

### Checking state, task history, and shared surfaces

Internal recovery projects as the subdued state **Checking task state…**, with safe controls retained and no attention styling unless the user must act. It transitions to Working, terminal work, Stopped, or the bounded message **Rove couldn't confirm the latest task activity.** Internal terminology such as Runtime, TaskEngine, bootstrap, thread/read, authoritative reconciliation, generation, continuation, dispatch intent, recovery flags, or source positions does not appear in ordinary customer copy.

Task-history rows emphasize the task title. A second line appears only for useful live state using a bounded vocabulary: Working, Needs input, You're in control, Checking state, Stopping, Stopped, Capturing, or Couldn't continue when genuinely useful. Ready and completed conversations need no permanent label. Mode suffixes are configuration, not default history status. Working and checking are neutral, Stopped is muted, Needs input uses the attention accent, and danger is reserved for genuine failure.

Each task remains selectable according to its own authority while other tasks work or need input. Background state never steals selection. The compact browser follower is a smaller presentation of the same task-control projection, not an independent lifecycle. It distinguishes Working, Your turn, and You're in control with the same Take Over and Return to Rove semantics as the main Task.

The customer Browser panel focuses on the actual attached identity, current owner/state, a safe site or page label, View/Open Browser, Take Over, Return to Rove, and recording. Engineering counters such as observation or evidence counts belong in developer diagnostics, not the normal panel. A large handoff card is not duplicated across the transcript and inspector.

Across normal and narrow windows, control placement and hit targets remain stable; long task titles, long messages, attachments, and many activities do not displace critical controls. Focus, hover, disabled and submitting states, keyboard behavior, transitions, reduced motion, scroll anchoring, and accessible labels are part of acceptance rather than polish after backend completion.

## Workflow workspace and progressive context

Creating a workflow asks only for a name, then immediately enters its Home. A sparse workflow is useful and valid: the user can start an ordinary associated task without first defining purpose, scope, preferences, criteria, procedures, resources, knowledge, or result presentation.

Workflow Home is the everyday entrance. It makes the workflow identity clear, keeps the task composer visually primary, shows a bounded recent/continue list for exact associated tasks, surfaces a small set of Outputs from those tasks, and shows unresolved attention only when it genuinely exists. Selecting a task opens its exact conversation. Selecting an Output opens its durable-work detail inside the Workflow, with clickable provenance back to the source task. Home is a projection of existing task, internal Result, and attention truth, not another project-management system or lifecycle authority.

Outputs are a first-class workspace view of stable structured work produced by associated tasks. It shows a useful title, preview, kind where helpful, customer-meaningful action state, and source-task context. A detail view presents the content and actions: **Continue in task**, **Edit** for editable Outputs, and **Add to Context** through explicit approval. A first Markdown heading that merely repeats the Output title is suppressed in presentation without passively rewriting the stored body. Internal Result names, revision numbers, and generic prepared states do not appear on ordinary documents. It is not a folder tree or generic file manager, and it does not infer Outputs silently from rendered conversation text.

Context and settings are a full secondary workspace surface rather than a modal setup form. It is read-first: approved goal, preferred help, success expectations, knowledge, and resources are understandable before any field becomes editable. Editing focuses one section at a time and returns to the readable surface after save or cancel. Advanced configuration remains reachable through progressive disclosure. Rove may later ask adaptive questions or propose context learned from work, but every durable proposal requires approval and no such assistance is implied before it functions.

A Job Search environment might begin with only its name, then immediately contain a task asking for today's opportunities. Later approved context can retain backend role preferences and outreach style without promising access to a particular website or the presence of a résumé on every device.

Workflow edits are deliberate. The user can approve a suggested improvement or use Add to Context on selected reusable information. Inside a Workflow, Add to Context treats that Workflow as the destination, keeps the retained material editable, and leaves optional topic scope under Advanced rather than asking for internal classification. Current task instructions and saved Outputs are not automatically promoted. An already running turn uses its recorded guidance snapshot; changes take effect at an explicit subsequent boundary.

## Delegated and collaborative work

In Agent Mode, Rove executes within the request and available authorization. Necessary input produces a task-specific attention request with a reason, sufficient context, and explicit controls. A pending request in one task does not prevent work in another.

In Companion Mode, the user can take control, inspect or change the browser, and return it. New conflicting agent actions must stop before the UI represents control as transferred. Already dispatched actions are reconciled rather than assumed cancelled. Returning control refreshes the affected page state and continues the same conversation.

Capture Mode records meaningful human activity within the chosen task scope. The user can stop capture without deleting its record and ask for a summary when model access is available. Native recording/capture operations must not be represented as model inference when no inference is taking place.

## Requested video

Recording is a separate control available in every mode. The user selects or confirms the recording scope, sees a disabled **Starting page recording…** state while the request is pending, sees an active indicator only after recording begins, stops an active recording, and receives a local playable artifact. Explain page-versus-window coverage and any excluded windows or dialogs. Recording starts now, not retrospectively. Failure to finalize must be visible and must not be described as a saved video.

## Findings through follow-up

A discovery task returns reviewable findings with source references, observation context, fit explanations, and uncertainty where relevant. The user selects findings, requests drafts, revises them, selects an authorized file, and authorizes an action or concrete batch. Follow-up uses the selected saved records, not text reconstructed from the rendered page.

Action Outputs distinguish Ready for approval, Approved, Checking outcome, Sent/Completed, Couldn't complete, and Outcome unclear while preserving the internal prepared, authorized, dispatched, confirmed, failed, and unresolved states. The customer reviews exact consequence and material; browser-control grounding and low-level verification predicates stay internal. **Checking outcome** may remain active while Rove performs bounded read-only reconciliation such as fresh inspection, waiting for convergence, searching an authoritative view, or correlating durable evidence. **Outcome unclear** is used when the effect still cannot be established without repeating the consequential action or crossing another hard boundary. An uncertain send warns against blind repetition of that send, not read-only reconciliation or all future conversation. The user can ask an unrelated question at any point.

## A second device

Signing into the same Rove profile makes the workflow environment available. The user reconnects services and reselects missing files, then starts new local tasks. Previous-device conversations, screenshots, and recordings are not represented as synchronized. The interface communicates this boundary before the user relies on portability as backup.

## Behavior that must be demonstrated

A complete experience requires independent tasks; no unconditional browser launch; meaningful workflow-guided outcomes; correct event routing during view changes; stop-and-resume conversation; actual human takeover and continuation; scoped capture; requested video; source-backed follow-up; and the exact portability boundary. Existing regression tests support parts of this behavior, but passing them does not certify the entire target experience.
