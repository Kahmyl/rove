# Conversation and Task Experience

**Status:** Active implementation plan

**Authority:** [Product Direction](../Products/product-direction.md), [Product Operating Model](../Products/product-operating-model.md), and the responsible Engineering contracts

**Implementation status:** [Conversation and Task interaction/presentation](../Engineering/implementation-status.md)

This plan sequences an approved product and engineering correction. It is not evidence that the target behavior is implemented, and it does not replace the canonical contracts.

## 1. Why this work exists

Private-beta use exposed a structural coupling between execution lifecycle, execution permission, customer interaction, and renderer presentation:

- A new conversation can show **Starting this task.** or **Waiting for Codex activity.** before the user's own message materializes.
- One task showed **Working** for more than 188 minutes while exact state was actually uncertain and being recovered.
- `recoveryRequired` currently forces `recovering` with `allowedActions: []`; because the composer owns the visible Stop control, recovery can remove Stop.
- Internal copy such as **Codex external truth requires authoritative reconciliation.** can reach the customer surface.
- Stop semantics drift: TaskEngine and LocalProductApi submit `interrupt`, ProductTaskPort removes `finish`, and React requires `finish` to render Stop. Renderer fixtures often inject `finish`, masking the production mismatch.
- Active work expands automatically but terminal work does not automatically compact. Duration is wall-clock time derived from item timestamps and a provider turn status.
- React maps raw tool names to activity copy and can expose implementation mechanisms rather than customer work.
- An active-turn `task.message` becomes `turn/steer`; there is no durable customer follow-up queue.
- Runtime and the compact follower support voluntary Companion takeover while the main Task only projects requested handoff takeover.
- Task history includes mode and lifecycle noise such as **Working · Agent**; the Browser inspector exposes **Observations** and **Evidence** counters.
- `lifecycle.phase`, `allowedActions`, Runtime state, `conversation.turnStatus`, and attention independently drive different pieces of UI.

These are not isolated strings. The correction separates durable truth, customer interaction capability, and customer presentation so the renderer can present a coherent conversation without weakening lifecycle, ownership, approval, or effect safety.

## 2. Authority and non-goals

### Preserved authority

- TaskEngine remains the durable lifecycle reducer and SQLite remains local Task authority.
- Codex App Server remains the execution engine behind the qualified adapter.
- Exact Task/thread/App Server session/Runtime session/handoff/generation identity remains required.
- Live App Server observations and exact `thread/read` history continue to reconcile Codex truth without authorizing new work.
- Runtime retains browser ownership, freshness, consequence/effect, single-dispatch, and replay-fence authority.
- Workflow context, Output/Result identity, approval material, attachments, and action outcomes retain their existing boundaries.
- The completed adaptive-browser execution architecture remains in force; its bounded capability gaps are not reopened here.

### Non-goals

This work does not replace TaskEngine or SQLite, introduce another lifecycle engine or generic event framework, add a distributed task-sync or cloud execution system, reopen browser perception/reconciliation architecture, weaken effect or replay fences, replace Workflow/Output models, or expose a whole-Task Pause. Runtime may retain its browser-mutation pause primitive. A future whole-Task Pause requires a separate product contract.

## 3. Reference-product findings

Reference products inform interaction patterns, not Rove authority. Current official OpenAI documentation describes a desktop workspace that keeps parallel and long-running work visible while users move between chats, and long-running work that remains in one chat, exposes progress, accepts follow-up steering, pauses for decisions, and keeps independent chats isolated. Those patterns support immediate conversation continuity, visible bounded progress, explicit intervention, and independent Tasks; they do not establish Rove's safety or persistence rules. See [ChatGPT desktop app](https://learn.chatgpt.com/docs/app) and [Long-running work](https://learn.chatgpt.com/docs/long-running-work).

The adopted direction is therefore narrow: conversational acknowledgement, compact but inspectable work history, stable Stop, distinct queue and steer, genuine user attention, browser ownership separate from conversational execution, and independently usable Tasks. Canonical Rove contracts stand on their own.

## 4. Settled interaction contract

### Accepted input and delivery

1. Send validates pre-acceptance model availability and input.
2. Durable local acceptance creates the Task if needed and creates exactly one accepted user conversation item immediately in its final transcript position. That item is the accepted instruction and owns its stable operation/client identity and delivery state; there is no separate pre-delivery accepted-instruction record.
3. Bootstrap and delivery proceed asynchronously.
4. Exact App Server `userMessage` materialization with matching client/operation identity corroborates the local item and advances delivery evidence without duplication.
5. Rejection before durable acceptance creates no running Task and preserves the draft.
6. Definite post-acceptance non-submission retains the user item and shows a safe failure/not-sent disposition. Retry is offered only when exact replay semantics allow it.
7. Possible submission retains the item, fences blind replay, and reconciles existing delivery truth.
8. New Task plus first instruction is one customer action; bootstrap and thread association are not separate customer steps.

### Startup and active work

- Ordinary startup mechanisms are hidden. Qualify a short anti-flicker delay, initially around 200–300 ms, before showing explicit Working.
- While useful execution is active, its work block is forced expanded and not manually collapsible. Long work scrolls inside a bounded viewport.
- Assistant commentary explains direction; activity rows describe concrete work. They use different hierarchy.
- Activity arrives from a typed customer-semantic projection using a bounded vocabulary such as read, search, navigate, inspect, change, create, run, transfer, capture, verify, and compare.
- Activity preserves tense and consequence truth: started, dispatched, checking, confirmed, failed, and unresolved are not interchangeable.
- Safe repeated reads may coalesce only when the summary is supported. Consequential actions, failure, approval, transfer, material change, uncertainty, and necessary evidence remain explicit.
- At the bottom, new activity auto-follows. Scrolling upward preserves position and shows **Latest**; returning to bottom resumes follow.

### Duration and terminal history

- Displayed duration accumulates only during customer-semantic active work intervals.
- It freezes for Waiting for you, approval/input waiting, human browser ownership, Checking the page, Checking task state, Stopping, and Stopped.
- A stale provider `in_progress` status cannot extend the timer by itself.
- Terminal work auto-compacts, preserves the final answer's scroll anchor, and becomes manually expandable.
- A manual reopen remains for the current rendered session; a fresh render may default terminal work to collapsed.
- Ordinary completion adds no generic completion banner or transient Ready flash between queued turns.

### Queue and steer

- During active work, ordinary submit means Queue.
- A queued follow-up is bounded, durable, exact-Task-owned, ordered, restart-safe, editable/removable, and reorderable where practical.
- It appears above the composer but is not provider input or a delivered conversation message.
- Restart never dispatches it merely because it exists.
- Promotion atomically turns that exact queued instruction into the single accepted user conversation item only when execution begins; it does not create an intermediate accepted-message entity.
- **Send now** explicitly calls qualified `turn/steer` at the next safe boundary and immediately creates the single accepted user conversation item for that intervention.
- Work segmentation follows meaningful customer intervention rather than requiring a one-to-one mapping with provider turn IDs.
- Target keyboard behavior: Enter performs the state default; Command/Ctrl+Enter steers while active; Shift+Enter inserts a newline. Final shortcuts require platform/accessibility qualification.

### Stop

- Stop means interrupt current accepted work, never Finish, close, archive, delete, or finish a browser session.
- It remains independently available before a provider turn ID, during active work, and during safe waiting/checking states while work remains nonterminal.
- Pre-dispatch Stop cancels pending work safely. Active-turn Stop interrupts the exact turn. At a possible-dispatch boundary, it prevents future work and preserves reconciliation of the uncertain effect.
- Stop owns a stable hit target. Activation immediately becomes **Stopping…**, disables duplicate intent, and remains spatially stable around attention changes.
- Authoritative interruption becomes **Stopped after …**, returns the ordinary composer, and retains queued follow-ups without running them.
- Stopping does not steal browser ownership from a human.

### Interaction capabilities

The Product projection separately represents `canSubmit`, `canQueue`, `canSteer`, `canStop`, `canRespond`, `canTakeControl`, `canReturnToRove`, `canRetry`, and `canArchive` or equivalent typed names. A generic engine action list is not renderer layout state. Each capability remains derived from exact authority and never from selected UI state.

### Attention and browser collaboration

- Attention exists only when the customer must answer, approve/deny, select, complete secure input, or take control. Automatic recovery is not attention.
- Request-family presentation names the decision and uses matching actions. Exact recipients, content, files, commands, grants, or scope remain visible.
- Conversational input may replace only the owning selected Task's composer. Approvals generally sit above the composer without suppressing Stop.
- A response surface stays in place while committing; controls show submitting/checking rather than disappearing under the pointer.
- Agent ordinary work offers no voluntary takeover. Agent requested handoff offers one-step **Take Over**.
- Companion agent-owned browser offers voluntary **Take Over**; a requested handoff emphasizes it.
- Requested handoff is **Waiting for you**, with neutral collaboration styling and duration frozen.
- Human ownership is **You're in control**, with **Return to Rove** and Stop available.
- Return transfers the exact resource, then shows **Checking the page…** while grounding is invalidated and fresh inspection occurs. Failure keeps ownership human and offers a safe retry.
- Capture is human-controlled by definition.
- The main Task and compact follower consume the same customer browser-control projection.

### Recovery, completion, and failure

- Internal recovery projects as neutral **Checking task state…**, not attention or warning by default.
- Safe controls remain available. Internal diagnostics never become lifecycle copy.
- Reconciliation transitions to Working, compact terminal work, Stopped, or **Rove couldn't confirm the latest task activity.**
- Confirmed execution failure, uncertain consequential outcome, model/provider unavailability, and inability to establish state remain distinct.
- The conversation remains readable and usable where safe. Generic Retry is absent when it could duplicate an effect.

## 5. Settled presentation contract

The Task hierarchy is: user messages and final assistant answers; genuine actionable requests; current work state; assistant commentary; semantic activity; technical detail. Implementation detail never dominates the conversation.

Active work is forced open; terminal work auto-compacts. Commentary is prose without completion iconography. Activity rows show semantic action and truthful state. Customer-visible duration is accumulated active time. Active work owns bounded internal scrolling and respectful auto-follow. Completion preserves anchoring.

Critical controls keep stable geometry through active, approval, stopping, and response-submission transitions. Focus returns deliberately, hover cannot be required for discovery, disabled states explain their consequence, keyboard behavior is platform-correct, and animation respects reduced motion. Narrow layouts retain recognizable Queue/Send now/Stop/Take Over/Return controls. Long text, titles, attachments, and many activities wrap or scroll without displacing them.

Task-history titles are dominant. A second line appears only for Working, Needs input, You're in control, Checking state, Stopping, Stopped, Capturing, or genuinely useful Couldn't continue. Ready/completed has no permanent label. Mode suffixes and raw lifecycle phases are removed. Working is neutral, checking subdued, stopped muted, attention accented, and danger reserved for genuine failure.

The follower uses the same state and controls as the main Task, with less detail. The Browser inspector shows attached identity, owner/state, safe site/page label, Open/View Browser, Take Over, Return to Rove, and recording. Observation/evidence counters and handoff bookkeeping are developer diagnostics. A full handoff card is not duplicated in transcript and inspector.

## 6. Customer-state matrix

| State                            | Main transcript and work block                            | Composer                                                | Controls                                                                 | Sidebar                                 | Browser/follower                                                     | Active duration              | Copy constraints                                               |
| -------------------------------- | --------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------ | --------------------------------------- | -------------------------------------------------------------------- | ---------------------------- | -------------------------------------------------------------- |
| New Task                         | Empty conversation; no fake lifecycle item                | New-task input                                          | Send when valid                                                          | No row until accepted                   | No browser unless selected explicitly                                | No                           | Preserve draft on pre-acceptance rejection                     |
| Just submitted                   | User message immediately in final position                | Clears after acceptance; restores on rejection          | Stop if accepted work is nonterminal                                     | Task title; no startup phase            | No attachment implied                                                | Not until useful work begins | No separate create/bootstrap step                              |
| Internal startup                 | Usually hidden by anti-flicker                            | Ordinary Task composer state                            | Stop remains possible after acceptance                                   | No bootstrap label                      | No Runtime language                                                  | No                           | No Starting task, binding, or dispatch-intent copy             |
| Active work                      | Forced-open Working block with commentary/activity        | Default submit queues                                   | Queue, Send now, Stop                                                    | Working                                 | Agent working; Companion may Take Over                               | Yes                          | Only customer-semantic progress                                |
| Tool work                        | Semantic activity with truthful tense/outcome             | Same as active                                          | Same as active plus exact approval if needed                             | Working unless attention supersedes     | Relevant safe page/site state                                        | Yes unless waiting/checking  | No raw tool or infrastructure names                            |
| Queued follow-up                 | Queue chips above composer; not transcript                | Edit/add queue                                          | Remove, edit, reorder where available; Send now remains explicit         | Existing live state                     | Unchanged                                                            | Follows owning work          | Never imply delivered/sent                                     |
| Steer                            | Real user message appears and segments customer work      | Continues active defaults                               | Stop remains; steer deduplicated by operation/turn                       | Working                                 | Unchanged unless command changes it                                  | Yes                          | Say sent/steered only after acceptance                         |
| Stopping                         | Current work remains visible; header says Stopping…       | Does not auto-run queue                                 | Stop disabled in stable target                                           | Stopping                                | Human ownership remains if present                                   | No                           | No duplicate intent                                            |
| Stopped                          | Terminal block auto-compacts to Stopped after…            | Ordinary Send returns; queue remains                    | Send, queue management, archive where safe                               | Stopped                                 | Browser ownership shown truthfully                                   | No                           | Stop is not finish/archive                                     |
| Conversational user input        | Exact question/request visible in conversation            | Exact response surface replaces owning composer         | Send/Cancel as contract allows; Stop separate                            | Needs input                             | No generic browser takeover unless required                          | No                           | Freeform alternative where allowed                             |
| Approval                         | Scoped material directly above composer                   | Ordinary draft preserved                                | Family-specific Allow/Deny, Approve/Decline, Send, Cancel; Stop separate | Needs input                             | Exact task only                                                      | No                           | No raw request status                                          |
| Requested browser handoff        | Waiting for you with reason and prior work                | Conversation stays readable                             | Take Over, Stop                                                          | Needs input                             | Your turn; one action opens and transfers exact browser              | No                           | Neutral collaboration, credentials in browser                  |
| Voluntary Companion takeover     | Working remains truthful until transfer                   | Queue remains available                                 | Take Over, Stop                                                          | Working                                 | Companion follower offers Take Over                                  | Yes until transfer           | Not offered for ordinary Agent work                            |
| Human browser ownership          | You're in control; work block remains open but paused     | Conversation input safe per capability                  | Return to Rove, Stop                                                     | You're in control                       | Same owner and action across surfaces                                | No                           | Prefer Return to Rove                                          |
| Return to Rove                   | Checking the page…                                        | Safe input only                                         | Retry only on failed return; Stop where meaningful                       | Checking state                          | Ownership transition exact; then fresh inspection                    | No                           | No resumed Working until grounding is fresh                    |
| Checking page                    | Current history visible; checking row/state               | Safe controls retained                                  | Stop and safe retry as projected                                         | Checking state                          | Agent not shown working yet                                          | No                           | Customer consequence, no grounding jargon                      |
| Internal checking/recovery       | Checking task state…; no fake attention card              | Safe submission/queue according to projection           | Stop independent; only safe exact retry                                  | Checking state                          | Preserve exact owner                                                 | No                           | No Runtime, TaskEngine, thread/read, generation, recovery flag |
| Completed                        | Final answer; work auto-compacts                          | Ordinary Send; next queued promotion avoids Ready flash | Send, archive                                                            | No status line                          | Ready/open as applicable                                             | No                           | No Task completed banner                                       |
| Confirmed failure                | Failure attached to affected work; conversation readable  | Safe follow-up if allowed                               | Exact safe retry only                                                    | Couldn't continue when useful           | Resource-specific failure                                            | No                           | Distinguish execution failure from uncertainty                 |
| Uncertain consequential outcome  | Checking outcome or Outcome unclear bound to exact effect | Unrelated conversation remains safe                     | Read-only reconcile; no blind mutation retry                             | Checking state or Couldn't continue     | Exact resource/effect state                                          | No                           | Explain what is unknown and what must not repeat               |
| Model unavailable                | Existing history readable; new rejected draft stays draft | Draft preserved                                         | Sign in/retry availability only as truthful                              | No false Working                        | Browser unaffected unless separately unavailable                     | No                           | Distinguish account, allowance, and startup failure            |
| Capture Mode                     | Human activity record; no model-work fiction              | Capture controls                                        | Stop/finish capture per capture contract                                 | Capturing                               | Human-controlled                                                     | No agent timer               | Native capture is not model inference                          |
| Another Task running/needs input | Selected Task remains unchanged                           | Selected Task's own composer                            | Each Task's own capabilities                                             | Owning rows show Working or Needs input | Follower selects exact task-bound browser without changing authority | Per Task                     | Background attention never steals selection                    |

## 7. Current implementation inventory

The inventory below describes source at the plan's starting point, `4b6ede4400d595482c6ce0f9aba706e1f5415679`. Target contracts above remain authoritative.

| Area/field                                                                                   | Current authority                                                                  | Current customer use                                                                            | Problem                                                                                                                                                             | Planned disposition                                                                   |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `TaskAggregate`                                                                              | `packages/protocol/src/task-engine.ts`; SQLite aggregate JSON                      | Indirect source of Task projection                                                              | Mixes durable execution facts with fields later presented almost directly                                                                                           | keep as authority                                                                     |
| `conversation.items` / `TaskConversationItem`                                                | Task aggregate acceptance plus exact Codex item reconciliation                     | Transcript and work rows                                                                        | Accepted user items now exist immediately with stable local identity and optional later provider turn/item correlation; activity still lacks customer-semantic type | keep as transcript authority; project later activity semantics through customer layer |
| Accepted `task_launch_requested` / `task_message_requested` / explicit customer continuation | TaskEngine event ledger                                                            | Acceptance, immediate transcript input, and dispatch intent                                     | Accepted or retained-for-convergence operations atomically create one local item; rejected operations create none                                                   | implemented for Slice A                                                               |
| `messageDeliveries`                                                                          | Task aggregate, operation/client correlation                                       | Recovery/dispatch truth plus bounded pending/materialized/not-sent/uncertain message projection | Exact evidence remains separate from message-content completeness; richer recovery UX remains later work                                                            | keep as authority                                                                     |
| `requestedOperation`                                                                         | Native lifecycle input                                                             | Drives reducer and recovery                                                                     | One engine operation is overloaded as UI capability source                                                                                                          | keep internal                                                                         |
| `lifecycle.phase` / `allowedActions`                                                         | Native lifecycle reducer                                                           | Status copy, composer gate, Stop/return/archive layout                                          | Engine state is treated as presentation and action layout                                                                                                           | project through customer layer                                                        |
| `recoveryRequired`                                                                           | Task aggregate and typed `codexRecoveryBlockers`                                   | `recovering`, empty actions, warning/attention text                                             | Diagnostic suppresses safe controls and leaks internal language                                                                                                     | keep internal                                                                         |
| `codexRecoveryBlockers`                                                                      | Exact authority-class/correlation records                                          | No direct useful customer semantics                                                             | Correct safety evidence needs consequence-level presentation                                                                                                        | keep as authority                                                                     |
| `codex.turn` / `turnId`                                                                      | Qualified App Server observations/history                                          | `conversation.turnStatus`, active work and duration                                             | Stale `in_progress` can masquerade as Working; provider turn IDs do not equal customer segments                                                                     | keep as authority                                                                     |
| `continuation` / attentions                                                                  | TaskEngine plus attention store                                                    | handoff response, return control, Needs input                                                   | Genuine attention and recovery can be conflated; request-family copy is generic                                                                                     | project through customer layer                                                        |
| Runtime truth                                                                                | Runtime session/control/effect authorities                                         | Browser state, ownership, follower                                                              | Must remain exact; main and follower interpret it differently                                                                                                       | keep as authority                                                                     |
| Launch/initial operation                                                                     | Durable launch config and bootstrap stages                                         | Empty/start state and first dispatch                                                            | Customer can see bootstrap as separate lifecycle                                                                                                                    | keep internal                                                                         |
| `interrupt` versus `finish`                                                                  | Native reducer distinguishes turn interrupt from resource cleanup/legacy close     | LocalProductApi Stop uses interrupt; renderer Stop checks finish                                | Production projection removes finish while fixtures inject it                                                                                                       | replace                                                                               |
| `reduceLifecycleInventory`                                                                   | Generated native contract                                                          | New Task admission                                                                              | Blocks launch when any nonterminal task exists, contradicting independent Tasks                                                                                     | investigate before change                                                             |
| `ProductTaskSnapshot`                                                                        | `task-coordinator.ts`, ProductTaskPort/LocalProductApi projection                  | Main renderer contract                                                                          | Exposes lifecycle/actions/runtime but no typed interaction or presentation state                                                                                    | replace                                                                               |
| `productLifecycleReason`                                                                     | `product-task-port.ts`                                                             | Empty state, warnings, sidebar/detail copy                                                      | Emits Starting/Waiting/Codex/internal recovery language                                                                                                             | replace                                                                               |
| `executionActions` filtering                                                                 | ProductTaskPort removes finish/archive/resume then recombines organization actions | Composer and task controls                                                                      | Makes Stop drift invisible; retains generic action model                                                                                                            | replace                                                                               |
| `availableActions`                                                                           | Product snapshot                                                                   | Direct React layout condition                                                                   | Does not separate submit/queue/steer/stop/respond/control                                                                                                           | replace                                                                               |
| `conversation.turnStatus`                                                                    | Codex turn mapped in ProductTaskPort                                               | Working, elapsed timer, Stop gate                                                               | Insufficient customer active-work truth                                                                                                                             | project through customer layer                                                        |
| Browser/attention projection                                                                 | ProductTaskPort and LocalProductApi                                                | Inspector, composer replacement, requested takeover                                             | Voluntary Companion takeover not represented consistently                                                                                                           | replace                                                                               |
| `task.start` boundary                                                                        | LocalProductApi → ProductTaskPort launch                                           | Creates Task and starts first work                                                              | First message waits for later App Server item                                                                                                                       | replace                                                                               |
| `task.message` boundary                                                                      | LocalProductApi → message intent                                                   | Follow-up; active dispatch selects `turn/steer`                                                 | No durable Queue; ordinary submit steers                                                                                                                            | replace                                                                               |
| `task.stop` boundary                                                                         | LocalProductApi checks `interrupt` then submits interrupt                          | Stop command                                                                                    | Renderer often cannot reach it because it checks finish                                                                                                             | keep as authority                                                                     |
| `clientUserMessageId`                                                                        | App Server `turn/start`/`turn/steer` operation identity                            | Message correlation                                                                             | Correct basis for deduplication but not used to create local item at acceptance                                                                                     | keep as authority                                                                     |
| Thread-history reconstruction                                                                | `codex-thread-truth-reconciler.ts`, normalizers, TaskEngine fold                   | Restart/reconnect convergence                                                                   | Must reconcile local accepted items rather than append provider copies                                                                                              | keep as authority                                                                     |
| `product-surface-state`                                                                      | React-side derived state                                                           | selection, Task control and history helpers                                                     | `taskControlProjection` allows Take Over only for actionable requested handoff; active/terminal still phase-driven                                                  | replace                                                                               |
| `ProductSurface` timeline segmentation                                                       | React groups items around user messages/provider turns                             | Conversation layout                                                                             | Provider items determine segmentation; queued/promoted/steered distinctions absent                                                                                  | replace                                                                               |
| `activityCopy`                                                                               | React raw `title` and tool-name mapping                                            | Activity text                                                                                   | Renderer owns semantics and exposes unbounded tool identifiers                                                                                                      | replace                                                                               |
| `openWorkTurnIds`                                                                            | React session state                                                                | Expand/collapse                                                                                 | Active groups are opened but terminal transition never removes them automatically                                                                                   | keep as presentation state                                                            |
| Elapsed calculation                                                                          | React min/max timestamps plus `Date.now()` while `in_progress`                     | Worked/Working duration                                                                         | Counts wall time through waiting, human control, and recovery                                                                                                       | replace                                                                               |
| Composer rendering gate                                                                      | React `availableActions` and attention                                             | Send/Stop/return controls                                                                       | Stop shares composer and depends on finish; blocked message hides other capabilities                                                                                | replace                                                                               |
| Attention rendering                                                                          | React generic `attentionCopy` and forms                                            | Approval/input UI                                                                               | Raw statuses and Codex/mechanism wording leak; geometry can shift                                                                                                   | replace                                                                               |
| Browser inspector                                                                            | React ProductSurface                                                               | Browser identity/control and metrics                                                            | Exposes Observations/Evidence and can duplicate handoff presentation                                                                                                | remove from customer surface                                                          |
| Task sidebar                                                                                 | React ProductSurface                                                               | Title plus workflow/phase/mode line                                                             | Shows Completed, raw phases, Standalone, and mode noise                                                                                                             | replace                                                                               |
| `unified-session-state` / follower                                                           | Runtime session presentation model                                                 | Compact follower Take Over/Return/Pause/Stop                                                    | Has voluntary Companion takeover but browser-session concepts and Pause differ from main Task                                                                       | project through customer layer                                                        |
| `pauseAgentControl`                                                                          | Runtime API                                                                        | Follower Pause                                                                                  | Pauses browser mutation, not whole Task execution                                                                                                                   | keep internal                                                                         |
| Return-control transition                                                                    | TaskEngine/Runtime exact handoff and fresh inspection                              | Resume automation/Return Control                                                                | Copy differs; checking page is not a shared customer state                                                                                                          | keep as authority                                                                     |
| Renderer fixtures with `finish`                                                              | `product-surface*.test*`, state tests and LocalProductApi fixtures                 | Make Stop/ready cases render                                                                    | Synthetic action combinations do not match ProductTaskPort production output                                                                                        | replace                                                                               |
| Fake working/ready phases                                                                    | Renderer unit fixtures                                                             | Visual state coverage                                                                           | Can pass while production projection has different semantics                                                                                                        | replace                                                                               |
| Independent follower fixtures                                                                | `unified-session-state` and `follower-state` tests                                 | Browser follower coverage                                                                       | Do not prove main/follower parity from one production Task projection                                                                                               | replace                                                                               |

### Stale assumptions requiring correction

1. `reduceLifecycleInventory` considers every nonterminal task a global launch blocker, despite Product Direction requiring resource-scoped concurrency.
2. `currentTaskId` and active-task helpers still risk conflating current execution with selected presentation.
3. `allowedActions` is treated as both engine permission and renderer composition.
4. `finish` survives in synthetic projections as a Stop proxy even though production filtering removes it.
5. A provider active turn is treated as sufficient evidence for Working and duration.
6. Runtime browser session presentation is treated as a whole-Task control model in the follower.

## 8. Architectural correction

```text
durable execution truth
  TaskEngine + SQLite + App Server reconciliation + Runtime/effect authority
        |
        v
customer interaction-capability projection
  submit | queue | steer | stop | respond | take | return | retry | archive
        |
        v
customer presentation projection
  accepted user conversation item | working | waiting | checking | stopped | failure
  semantic activity | duration intervals | browser collaboration | sidebar
        |
        v
renderer
  layout, focus, animation, scroll, expansion preference, responsive behavior
```

The capability projection is derived from authority and is not another lifecycle engine. The presentation projection translates consequences and semantic work; it cannot authorize commands, clear blockers, move browser ownership, or settle effects. The renderer consumes typed customer state and sends explicit intents. It retains only ephemeral presentation preferences.

## 9. Implementation slices

### Slice A — immediate durable conversation input (implemented source boundary)

The Task ledger now commits the accepted local user item and product intent in one SQLite transaction. `user:<operationId>` is the stable local item identity; `itemOrder` preserves transcript position before a provider turn exists, and later exact live/history correlation attaches provider turn/item metadata without changing the local key or customer-authored text. Existing aggregates normalize missing `itemOrder` from their retained items, so no SQL migration is required. Focused production-store, reconciliation, restart, delivery-state, attachment, and renderer tests cover this boundary. The overall plan remains active because Slices B–G are not implemented by this evidence.

- Extend and use the Task's existing `TaskConversationItem` user-item representation as the accepted user conversation item, with stable operation/client identity, delivery state, attachments, and timestamps. Do not introduce a parallel accepted-message collection unless repository investigation proves the existing representation cannot safely carry that metadata.
- Atomically commit `task_launch_requested` or `task_message_requested` acceptance and exactly one durable user conversation item; that item is immediately renderable in its final transcript position before asynchronous provider dispatch.
- Reconcile exact live/history App Server `userMessage` materialization into that same item without replacement or duplication.
- Project definite non-submission and unresolved delivery safely.
- Cover first Task message, follow-up, restart, duplicate and reordered materialization.

### Slice B — customer interaction/control projection (implemented source boundary)

The production TaskEngine → LedgerProductTaskPort → LocalProductApi → ProductSurface path now projects typed customer capabilities independently of lifecycle actions. ProductSurface consumes that projection for Submit, Stop, Codex response, Take Over, Return to Rove, safe Retry, and Archive presentation and invocation; missing legacy capability fields fail closed. Archive restoration and bounded legacy-effect acknowledgement remain intentionally separate internal/organization actions. At this slice boundary Queue and Steer remained false pending their explicit Slice C operations. Stop derives from nonterminal accepted work, remains available before provider turn identity and through safe waiting/recovery, submits the existing interrupt intent, and renders independently of both ordinary composer availability and `finish`. Recovery keeps typed blockers authoritative while projecting bounded checking copy rather than attention or internal diagnostics. The retained coordinator path emits the same capability shape. Lifecycle inventory no longer serializes unrelated Task launch; Runtime/profile/page and effect authorities continue to reject their exact conflicts.

Focused ledger, product-port, LocalProductApi, renderer-state, production-component, lifecycle-contract, restart, and Slice A conversation-materialization tests cover this boundary. Internal Finish and cleanup operations remain available for real closure/resource cleanup. This evidence does not itself implement later slices; the sections below record their current boundaries.

### Slice C — durable Queue and explicit Steer (implemented source boundary)

The Task aggregate now owns a durable ordered queue with a 16-entry bound, stable entry identity, a 16,000-character message bound, attachment/workflow/result context, and exact add/edit/remove/reorder events. Sixteen entries keeps customer follow-up management practical while bounding retained aggregate size and replay cost; the per-message limit matches the accepted Task-message safety boundary. Legacy aggregates normalize to an empty queue. Queue changes do not dispatch work, Stop retains entries, and restart alone cannot promote one. An exact terminal observation for the current active turn atomically removes and promotes only the first entry into the single `user:<operationId>` accepted conversation item; the existing command, outbox, delivery, and reconciliation path then owns delivery. Duplicate or stale terminal evidence cannot promote another entry. Explicit Steer requires the exact current active-turn identity, creates one accepted intervention item, and rejects stale authority independently of projected capabilities.

The LocalProductApi exposes explicit Queue and Steer intents, validates exact lifecycle/turn authority, and treats ordinary send during active work as Queue rather than an implicit steer. ProductSurface renders persistent queue controls, makes Queue the default active-work action, reserves Send now for the explicit steer path, and applies the Enter / Shift+Enter / Cmd-or-Ctrl+Enter keyboard contract. Focused aggregate, SQLite restart, port, API, and renderer tests cover bounds, idempotency, restart, Stop retention, ordered promotion, duplicate terminal observations, stale turn rejection, and contradictory capability projections.

- Add a bounded Task-owned ordered queue with edit/remove and practical reorder operations.
- Normalize legacy aggregates without queue state to an empty queue.
- Recover queue across restart without dispatch.
- At a committed execution boundary, atomically promote exactly one queued entry into the single accepted user conversation item, then deliver and reconcile that item through the normal path; create no intermediate accepted-message entity.
- Add explicit Steer with exact active-turn identity and keyboard contract.
- Preserve queued entries after Stop.

### Slice D — customer execution/activity presentation (implemented source boundary)

The production port now emits a typed customer execution projection outside React. Accepted initial messages, follow-ups, and interventions define customer segments; queued entries remain outside the transcript until promotion. A bounded semantic activity vocabulary replaces renderer interpretation of raw provider/tool names, commentary remains separate from final answers, and mixed work order is retained without exposing internal mechanism identifiers. Task-owned open/closed active intervals accumulate semantic customer-working duration across restart while waiting, human ownership, stopping, recovery checking, and terminal states freeze the counter.

ProductSurface consumes this projection for state, segment, activity, outcome, and duration presentation. Working waits 250 ms before appearing, active work is forced open, terminal work auto-collapses while remaining reopenable, long activity is bounded, and scroll follow/Latest behavior preserves the reader's position. These are presentation consequences only: capabilities and exact command handlers remain the mutation authority. Focused projection and production-component tests cover accepted interventions, queued-entry exclusion, safe semantic labels, active-duration accumulation, state freezing, anti-flicker structure, bounded active work, keyboard behavior, and scroll-follow helpers. Slice G remains outstanding, so this plan remains active.

- Introduce typed customer Task state and active-duration interval projection.
- Move semantic activity mapping/coalescing out of React.
- Preserve truthful outcome tense and effect uncertainty.
- Drive customer segments from accepted user conversation items and interventions, not raw provider turns alone.
- Implement anti-flicker Working, forced-open active work, terminal auto-collapse, bounded scrolling, **Latest**, and scroll anchoring.

### Slice E — attention and browser collaboration (implemented source boundary)

The production TaskEngine → LedgerProductTaskPort → LocalProductApi path now composes a typed, Task-scoped customer collaboration projection before React. It deterministically prioritizes exact active Codex requests, preserves task/request/thread/turn/item/generation identity, supplies request-family-specific actions and customer copy, keeps response submission and unresolved confirmation visible, and excludes resolved, cancelled, stale, recovery-only, and cross-Task requests from actionability. ProductSurface consumes that projection in one primary collaboration area beside the ordinary composer and independent Stop control; exact command handlers still revalidate authoritative attention state and supported decisions before mutation.

The same projection composes browser collaboration from exact Runtime and continuation truth. Requested Agent handoff requires the exact actionable Task handoff generation, Companion mode may offer voluntary takeover only for its exact active attached browser, human ownership offers Return to Rove only while authoritative return capability remains current, and return checking remains distinct from work resumption. `resume_after_control_return` may continue through the existing authoritative continuation process, while `explicit_user_response` continues to require a separate ordinary Task response after control returns. The Browser inspector no longer duplicates the handoff card; it retains only the compact ownership/control summary pending the broader Slice F inspector cleanup.

Secret user-input values remain exact-request-keyed ephemeral renderer state, are discarded when that identity ceases to be current, and are not included in transcript, customer execution, activity labels, or the customer collaboration projection. MCP URL elicitation stays on the trusted HTTPS external-intent path and unsupported forms remain non-submittable. The selected App Server protocol still requires secret `user_input` answers to be returned inline; when no suitable browser or trusted external surface exists, the masked renderer field and normal durable response-dispatch path remain a bounded protocol-correct limitation rather than a credential vault or a claim of stronger secret isolation.

Focused projection, TaskEngine/port, LocalProductApi, renderer, Runtime ownership, continuation, restart, and production-composition tests cover deterministic priority, exact identity, decision families, stale/cross-Task rejection, ephemeral response isolation, takeover/return authority, continuation policy, and Stop/composer coexistence. Slice G remains outstanding.

- Project attention families and exact action labels/material.
- Create one browser-control projection shared by main Task and follower.
- Support Agent requested handoff and Companion voluntary takeover without expanding Runtime authority.
- Present Take Over, human ownership, Return to Rove, return failure, and fresh-page checking.
- Remove generic whole-Task Pause from customer surfaces while retaining required Runtime primitive.

### Slice F — recovery, completion, failure, and sidebar (implemented source boundary)

LocalProductApi now composes a typed customer Task presentation from the existing execution, collaboration, capability, delivery, and recording projections. It distinguishes neutral checking, Working, Needs input, human control, Stopping, Stopped, confirmed failure, and unresolved outcome without granting commands or interpreting internal diagnostic text. Exact cleanup retry presentation exists only when the capability projection authorizes that operation. Ordinary readiness/completion has no conversation banner or sidebar label, while final answers and compact terminal work remain intact. The existing account/model projection continues to reject known sign-in, allowance, stale-model, and startup unavailability before Task acceptance and preserves the draft.

ProductSurface consumes the typed presentation for conversation status, terminal-work summary, Workflow recent tasks, and Task History. Task rows keep the title dominant and use only the bounded useful second-line vocabulary; Workflow/Standalone prefixes, permanent Completed, mode suffixes, and raw lifecycle phases are absent. An explicit selected Task remains selected while another Task changes execution, attention, recovery, completion, or browser-control state. Browser observation/evidence counters are removed, while attached identity, ownership, Open/View Browser, Take Over, Return to Rove, and recording remain.

The request-human production trace now waits for the exact correlated external `turn/start` observation it asserts. Durable Task acceptance can precede the independent process action-log write, so waiting only for the accepted conversation projection observed an earlier boundary. The correction retains exact correlation and exactly-once assertions for both initial and continuation turns; the complete production-trace file and process cut/restart suites pass without a timeout increase, retrying dispatch, or weakening convergence guarantees.

- Project checking-state consequences without diagnostic leakage or false attention.
- Reconcile ordinary completion, Stop, confirmed failure, uncertain effects, and model unavailability.
- Apply the bounded sidebar vocabulary and multi-Task isolation.
- Remove customer Browser inspector counters and duplicate handoff UI.
- Remove stale phase/mode labels and ensure background changes never steal selection.

### Slice G — rendered experience qualification

- Add production-composition Electron journeys through the preload bridge.
- Cover normal/narrow widths, long titles and content, attachments, many activities, multiple Tasks, keyboard/focus, hover/disabled/submitting states, reduced motion, stable geometry, auto-follow, anchoring, queue/steer/stop, attention, handoff, return/checking, recovery, failure, and uncertainty.
- Retain DOM/state assertions alongside screenshots and manual development acceptance.

The source qualification now uses the built production customer execution, capability, collaboration, presentation, and follower projections in a deterministic Electron journey. It records DOM/state assertions, 22 customer-visible screenshots, an ordered contact sheet, a Playwright trace, and a machine-readable manifest under ignored `artifacts/customer-journeys/conversation-task-rendered-qualification/`. The journey includes the 16,000-character accepted-input boundary, timing bounds, stable Stop geometry, request-family material, exact handoff generation, main/follower projection parity, narrow/reduced-motion rendering, and multi-Task selection. The older private-beta and ProductSurface visual harnesses were reconciled with current A–F semantics rather than preserving `finish`, diagnostic counters, generic return copy, phase/mode suffixes, or stale request priority. Manual development-app acceptance remains required before this plan is complete.

## 10. Migration and compatibility

The likely persistence path is additive metadata on the existing Task conversation-item representation plus normalization to an empty queue and accepted user-item metadata defaults. Confirm this against all SQLite aggregate readers, projections, backup/export, process-cut recovery, legacy imports, and fixtures before choosing it. Prefer normalization over destructive SQL migration when it preserves existing local work.

Existing conversation items may lack local acceptance/delivery metadata and must remain readable. Provider-materialized `user_message` items with `clientId` remain authoritative correlation evidence. Legacy items without client IDs cannot be inferred to have local acceptance metadata; retain them as historical transcript items.

Queue promotion needs an atomic marker that distinguishes queued, promotion accepted, dispatch not started, possible dispatch, materialized, failed, and unresolved. Restart may resume truth reconciliation but must not promote another entry or redispatch possible work. Bound queue count and payload size consistently with Task input and attachment limits.

App Server client IDs and current operation IDs are compatibility identifiers. Preserve exact `turn/start`, `turn/steer`, and `turn/interrupt` wire behavior. Generated App Server schemas and installed migrations are not renamed cosmetically.

Old fixtures and snapshots that inject `finish`, ready/working phases, or Runtime-only control semantics must be replaced with production projection builders. Retain negative cases; do not weaken assertions. Backup/export must include new local queue and accepted user conversation-item state but never turn either into portable Workflow data.

## 11. Qualification matrix

| Journey                  | Underlying truth evidence                                                                 | Rendered customer evidence                                                               |
| ------------------------ | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Immediate Send           | Acceptance and local item commit are atomic; exact materialization deduplicates           | Message appears immediately in final position; no startup item flash                     |
| Start timing             | Active projection begins only from authoritative facts; anti-flicker is presentation-only | Fast start does not flicker; sustained work becomes Working                              |
| Work history             | Active/terminal customer state and duration intervals are correct                         | Active forced open; terminal auto-collapsed; manual reopen retained; anchor stable       |
| Activity                 | Semantic kinds and outcome states derive from authoritative events/effects                | Commentary hierarchy differs; no raw tool/Runtime strings; coalescing truthful           |
| Queue                    | Ordered state persists, edits safely, and restart dispatches nothing                      | Queue chips render/edit/remove/reorder; no transcript copy before promotion              |
| Steer                    | Exact active turn and client operation reach `turn/steer` once                            | Send now is explicit; message appears and customer segment changes                       |
| Stop                     | Pre-turn cancel, exact interrupt, and uncertain boundary preserve truth; queue retained   | Stable Stop → Stopping → Stopped; composer returns; no Finish semantics                  |
| Attention                | Exact request generation/material and response state remain authoritative                 | Family-specific copy/actions; stable response surface; Stop remains                      |
| Browser handoff          | Exact session/handoff/ownership generations transition once                               | Waiting for you → Take Over → You're in control                                          |
| Companion takeover       | Runtime accepts voluntary exact-task takeover only in Companion                           | Main and follower both offer Take Over with same state                                   |
| Return                   | Exact return plus fresh inspection before continuation                                    | Return to Rove → Checking page → Working/ready; truthful retry on failure                |
| Recovery                 | Typed blocker families clear only from matching authority                                 | Checking state, no false Needs input, internal diagnostics absent, safe controls present |
| Failure/uncertainty      | Definite failure and unresolved effect remain distinct; replay fence retained             | Distinct copy and actions; no unsafe generic Retry                                       |
| Multi-Task               | Events, queue, attention, control, and selection remain exact-Task-bound                  | A Working, B Needs input, C ready remain selectable; no selection theft                  |
| Responsive/accessibility | Same capability projection at all widths and input modes                                  | Stable controls, focus, labels, keyboard, reduced motion, long-content behavior          |
| Main/follower parity     | Both consume one browser-control/customer-state projection                                | Same owner, handoff, Take Over, Return, Stop consequence and copy family                 |

Synthetic unit tests remain useful for isolated presentation behavior, but every critical row needs at least one production projection path. Screenshots are review evidence, not a substitute for state and DOM assertions.

## 12. Manual acceptance

After implementation, exercise the development application through:

```text
Send
  -> immediate message
  -> Working
  -> semantic activity
  -> Queue
  -> Steer
  -> Stop
  -> follow-up after Stop
  -> approval
  -> Agent browser handoff
  -> Take Over
  -> Return to Rove
  -> checking/recovery
  -> completion
  -> multi-Task switching
```

Repeat relevant states at normal and narrow widths, with long text/titles, attachments, many activities, keyboard-only use, reduced motion, and background Task attention. Use fixture accounts and safe local/browser fixtures. Do not package until this full private-beta journey is satisfactory. Live external-account acceptance remains separately authorized.

Run `pnpm customer-journey:conversation-task` first, then use the generated `manual-acceptance.md` as the concise development-app checklist. It covers Send, Working, semantic activity, Queue, Steer, Stop and follow-up, attention families, requested and voluntary browser takeover, Return to Rove and fresh checking, recovery/outcomes, completion, multi-Task switching, normal/narrow widths, keyboard-only operation, reduced motion, long content, and background attention. The generated checklist is preparation evidence, not a record that a human completed it.

## 13. Completion conditions

This plan becomes complete only when:

- accepted user messages appear immediately and exact App Server materialization never duplicates them;
- no ordinary startup or recovery mechanism language leaks into customer UI;
- Queue is durable and distinct from transcript/delivery, and Steer is explicit;
- Stop is reliable, independent, stable, and never Finish/archive;
- active work is truthful and forced open, terminal work auto-compacts, and scrolling/anchoring respect the user;
- activity is customer-semantic and preserves outcome truth;
- attention means genuine user action with request-specific presentation;
- main Task and follower share browser collaboration semantics, including Companion takeover and Return checking;
- recovery does not masquerade as attention and retains safe controls;
- active duration excludes waiting, human ownership, checking, stopping, and stopped time;
- sidebar and multi-Task presentation are coherent and do not expose mode/lifecycle noise;
- important journeys pass through production projections with functional, interaction, visual, responsive, accessibility, and recovery evidence; and
- manual development-app acceptance is satisfactory.
