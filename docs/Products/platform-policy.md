# Platform Policy

**Role:** Product rules derived from the [Product Direction](product-direction.md). These rules describe intended behavior, not an assertion that every rule is implemented.

## Work and user control

Rove assists with digital tasks. Browser execution, model access, and deployment topology are supporting mechanisms. A standalone task does not require a workflow. A task may contain many turns and changes of direction; its initial objective does not limit later conversation.

Stopping cancels further execution where possible, not the existence of the task. Completed, stopped, or failed work remains readable and can receive another request. Archiving is an organizational action; permanent deletion is a separate, explicit operation. Switching the selected task never redirects another task's events or execution.

Capabilities are acquired on demand. Browser creation is not an unconditional task-launch step. A missing capability blocks only operations that require it. Resource coordination must not become a global application lock.

## Model access and honest state

Rove profile identity and ChatGPT/Codex model access are distinct. Changing a model account must not replace the Rove profile or delete local work. A disconnected or exhausted model leaves existing data accessible after the user has unlocked the correct Rove profile.

When model unavailability is known, do not accept a request as running or place it in an implicit future-execution queue. Preserve unsent text on unexpected submission failure. Distinguish rejected, accepted, dispatched, completed, and unresolved operations. Reconnection is not authorization to execute previously unsuccessful submissions.

Human takeover is normal participation. Prevent new conflicting mutations before handing over; an already dispatched action can still finish. Return to the actual resulting state, not an assumed pre-handoff state. Do not replay an uncertain external action simply because the user returned control.

## Persistence boundary

Workflow configuration follows the user across devices. Tasks, conversations, results, reports, attachments, screenshots, recordings, browser processes, and execution history remain device-local. The portable allowlist includes workflow purpose, approved preferences and guidance, skills, deliberately saved reusable knowledge, and non-secret connection/resource requirements.

Passwords, access tokens, browser cookies, model credentials, local filesystem paths, and live page references do not enter workflow synchronization. A resource requirement does not establish availability of a file on another device. Reconnection and file reselection must be explicit and understandable.

Save to workflow presents the exact reusable information being promoted. It does not implicitly upload the conversation, external content, or attachments. A task-specific request or model inference does not silently rewrite approved guidance. Local storage must support deliberate backup/export; synchronization of setup is not a backup of task history.

## Capabilities, authorization, and outcomes

Rove may use authorized browser, file, API, plugin, integration, or CLI capabilities. Instructions supplied by websites, files, or skills are not authority to grant access. Application-level checks enforce task identity, grants, external destinations, and consequential-action scope.

Routine reversible navigation should not require repetitive approvals. Sending, submitting, deleting, sharing, or otherwise committing consequential changes must be within an explicit user authorization. That authorization may cover a concrete batch, but not unknown recipients or materially changed content. An alternative adapter cannot bypass a refusal or repeat an unresolved action through another transport.

A generated draft is not a sent message. Dispatched input is not necessarily a verified result. Rove preserves uncertainty when evidence is insufficient and allows unrelated conversation to continue while the uncertain action is reconciled.

## Capture, recording, and privacy

Capture observes the intended task scope, not unrelated browsing. Recording is requested explicitly, is available in all participation modes, and has visible start/stop controls. Explain whether it covers a page or a browser window. Do not imply retroactive video or automatically masked continuous recording. Store recordings locally and show failures to finalize a playable file.

Local execution does not mean local inference: disclose when content or screenshots are sent to the model. Do not retain raw credentials, sensitive form values, or full network payloads by default. Diagnostic capture is bounded, opt-in, and tied to the task.

## Scope and change policy

The application is intended to be free beyond the user's eligible model access. Do not add mandatory paid inference, hosted browsers, unrestricted cloud artifact storage, or a workflow platform without an explicit product decision. Hosted workflow setup must have realistic limits and account isolation.

No stealth, access-control bypass, or prohibited automation is part of the product. Service restrictions are evaluated for the actual operation and route; absence of a CAPTCHA or use of a visible browser does not imply permission.

Required product behavior takes precedence over legacy architectural assumptions. Changes to scope, synchronization boundaries, authority, or user control update the product documents before technical contracts are changed. Dependency upgrades require compatibility evidence. Technical wire/database format identifiers remain necessary where readers and writers must agree; they are not product release names.
