# Product Operating Model

**Role:** Target user experience implementing the [Product Direction](product-direction.md). Supporting contracts live in the engineering documents.

## Entry and account connection

The user accesses a Rove profile independently of the connected ChatGPT/Codex account. The profile restores portable workflow setup. Local task history belongs to the profile on this device and is not downloaded from another device.

Connecting Codex enables model-assisted work. Disconnecting it does not hide previous results. The application must identify unavailable model access at submission, preserve the user's text if submission fails, and never leave a known-impossible request spinning as though it were running. A connection error and an exhausted allowance are distinguishable messages, with existing work still accessible.

A temporary workflow-sync outage does not disable already cached local tasks or approved guidance. Explicit Rove sign-out locks the profile's cached data; it is not equivalent to an incidental loss of connectivity. Reauthentication must not execute old requests.

## Main work surface

The user can find standalone tasks and tasks grouped by workflow, start new work, open results, and see which tasks need attention. Selecting a task changes the view only. Streaming output and requests continue to update the task that owns them, not the currently visible conversation.

Each task presents a conversation, useful results, active work status, and controls appropriate to its state. The composer remains a conversation entry point rather than a form restricted to predetermined follow-ups. Result selections are optional input to the next request.

| User action or condition                           | Required response                                                                                          |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Send a model request with known unavailable access | Explain the missing connection/allowance before accepting execution.                                       |
| Start non-browser work                             | Do not open or demand a browser.                                                                           |
| Open Browser explicitly                            | Attach or reveal the task's browser resources, without restarting the conversation.                        |
| Switch tasks                                       | Preserve both tasks, drafts, results, and routing.                                                         |
| Stop                                               | Prevent further dispatch; retain the conversation, partial work, and known/unknown action outcomes.        |
| Send after stopping or completion                  | Continue the same task with the new request; do not demand a new task.                                     |
| Change subject                                     | Follow the new request, using workflow guidance only where relevant.                                       |
| Browser becomes unavailable                        | Report affected operations; keep other capabilities and the conversation usable.                           |
| Archive                                            | Remove from ordinary navigation while retaining history; do not confuse archiving with permanent deletion. |

The implementation may bound simultaneous execution for memory or account limits. It must identify the affected resource and must not make all other tasks inaccessible. A user request rejected because of model unavailability is not a draft task queued for later dispatch.

## Workflow workspace and progressive context

Creating a workflow asks only for a name, then immediately enters its Home. A sparse workflow is useful and valid: the user can start an ordinary associated task without first defining purpose, scope, preferences, criteria, procedures, resources, knowledge, or result presentation.

Workflow Home is the everyday entrance. It makes the workflow identity clear, keeps the task composer visually primary, shows a bounded recent/continue list for exact associated tasks, surfaces a small set of structured results from those tasks, and shows unresolved attention only when it genuinely exists. Selecting a task, result, or attention item opens the exact owning task and record. Home is a projection of existing task, Result, and attention truth, not another project-management system or lifecycle authority.

Outputs are a first-class workspace view of stable structured results produced by associated tasks. It shows useful kind, title, state, and source-task context and opens the existing result behavior. It is not a folder tree or generic file manager, and it does not infer outputs from rendered conversation text.

Context and settings are secondary. They allow deliberate editing of purpose, background, priorities, exclusions, procedure, result presentation, descriptive resources, and explicitly approved reusable knowledge. Rove may later ask adaptive questions or propose context learned from work, but every durable proposal requires approval and no such assistance is implied before it functions.

A Job Search environment might begin with only its name, then immediately contain a task asking for today's opportunities. Later approved context can retain backend role preferences and outreach style without promising access to a particular website or the presence of a résumé on every device.

Workflow edits are deliberate. The user can approve a suggested improvement or use Save to workflow on selected reusable information. Current task instructions are not automatically promoted. An already running turn uses its recorded guidance snapshot; changes take effect at an explicit subsequent boundary.

## Delegated and collaborative work

In Agent Mode, Rove executes within the request and available authorization. Necessary input produces a task-specific attention request with a reason, sufficient context, and explicit controls. A pending request in one task does not prevent work in another.

In Companion Mode, the user can take control, inspect or change the browser, and return it. New conflicting agent actions must stop before the UI represents control as transferred. Already dispatched actions are reconciled rather than assumed cancelled. Returning control refreshes the affected page state and continues the same conversation.

Capture Mode records meaningful human activity within the chosen task scope. The user can stop capture without deleting its record and ask for a summary when model access is available. Native recording/capture operations must not be represented as model inference when no inference is taking place.

## Requested video

Recording is a separate control available in every mode. The user selects or confirms the recording scope, sees an active indicator, stops recording, and receives a local playable artifact. Explain page-versus-window coverage and any excluded windows or dialogs. Recording starts now, not retrospectively. Failure to finalize must be visible and must not be described as a saved video.

## Findings through follow-up

A discovery task returns reviewable findings with source references, observation context, fit explanations, and uncertainty where relevant. The user selects findings, requests drafts, revises them, selects an authorized file, and authorizes an action or concrete batch. Follow-up uses the selected saved records, not text reconstructed from the rendered page.

The result distinguishes prepared, authorized, dispatched, confirmed, failed, and unresolved work. An uncertain send prevents blind repetition of that send, not all future conversation. The user can ask an unrelated question at any point.

## A second device

Signing into the same Rove profile makes the workflow environment available. The user reconnects services and reselects missing files, then starts new local tasks. Previous-device conversations, screenshots, and recordings are not represented as synchronized. The interface communicates this boundary before the user relies on portability as backup.

## Behavior that must be demonstrated

A complete experience requires independent tasks; no unconditional browser launch; meaningful workflow-guided outcomes; correct event routing during view changes; stop-and-resume conversation; actual human takeover and continuation; scoped capture; requested video; source-backed follow-up; and the exact portability boundary. Existing regression tests support parts of this behavior, but passing them does not certify the entire target experience.
