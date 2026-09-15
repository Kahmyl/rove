# Security and Authentication

**Status:** Target security contract. Controls require implementation and negative tests; documentation does not establish compliance certification.

## Identity boundaries

Rove identity owns approved portable workflow configuration and the local profile partition. The connected ChatGPT/Codex account supplies model access. Integration accounts grant access to their services. Browser profiles contain site identity. These identities must not be treated as interchangeable.

Changing Codex accounts preserves Rove data but invalidates assumptions about the previous engine connection and its permissions. Settle or stop affected work before replacing the connection. Reuse of an old thread under another account requires supported evidence, not copying credentials or private history files.

Model disconnection leaves local history readable. Rove accounts are optional and authorize only cross-device portable Workflow synchronization; sign-out clears cloud session authority but does not lock or delete device-local tasks, results, recordings, artifacts, or Workflows. Temporary network loss likewise leaves local work usable. Supabase Auth is the selected identity provider, independently of Codex/ChatGPT identity.

Use the official [Codex authentication flow](https://developers.openai.com/codex/auth/). Do not collect ChatGPT passwords, silently introduce API billing, or assume a subscription connection grants access to every connected app.

## Trust boundaries

The renderer, external webpages, model output, imported documents/skills, integration responses, local subprocesses, and remote configuration service cross distinct boundaries. The application host validates commands, determines profile ownership, and resolves opaque resource IDs. An external document cannot authorize a shell, share a local file, or change the synchronization allowlist.

For Electron, follow the [security guidance](https://www.electronjs.org/docs/latest/tutorial/security): isolate renderer context, disable unrestricted Node integration, expose a narrow preload API, validate senders and input schemas, constrain navigation/window creation, and apply an appropriate content security policy. Untrusted HTML is not rendered as privileged application content.

Local Runtime/CDP interfaces must remain private and authenticated where applicable. Verify managed process identity before attachment or termination. A stored PID or reachable loopback port is not sufficient proof of ownership. Do not publish development control-plane tokens or reuse them in a shared environment.

## Credentials and account storage

Store credentials through supported local credential mechanisms with restrictive file permissions and redacted logging. Workflow configuration never contains access/refresh tokens, passwords, cookies, authorization headers, or model credential files. Restore connection requirements on another device and request a fresh authorized connection there.

Electron [safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage) has platform-dependent behavior, including a Linux `basic_text` fallback. Detect the selected backend and do not label unprotected fallback storage as secure encryption. Choose an explicit supported fallback policy or require reconnection rather than silently persisting secrets insecurely.

Credential storage protects secrets at rest under its assumptions; it is not protection against arbitrary code already executing with the user's privileges. Browser profiles and recordings may still contain sensitive information. Document local protection and deletion behavior without claiming total device compromise resistance.

## Capability grants and untrusted instructions

Authorize capabilities independently of prompt text. A grant identifies resource, owner, operations, scope, and revocation/expiry. Resolve real file paths within the selected grant, prevent path traversal and symlink escape, and do not accept filesystem paths invented by the model as proof of permission.

Consequential actions require scope-compatible authorization. Bind approval to the intended recipient/target, content, attachments, and operation. Reject stale generations and changed scopes. Human control and action approval are separate checks: an approved action cannot run while a human owns its conflicting resource.

Treat web/file content as untrusted evidence even when it appears to be an instruction for Rove. Separate that content from system/workflow authority. Defense requires runtime permissions and scoped tools, not only a prompt saying to ignore malicious instructions. Refusals and unresolved actions remain binding across alternate tools.

For HTTP MCP connections, implement the supported [authorization specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization), including destination/token boundaries. Do not pass through unrelated bearer tokens. Launch stdio tools with an intentionally bounded environment; a plugin name is not evidence that a subprocess is trustworthy.

## Portable setup service

Authenticate the Rove owner on every read/write/delete. Test owner isolation both through normal APIs and any synchronization mechanism. A permissive server credential is not embedded in the desktop app. Conditional revisions prevent silent overwrite; deletion rules prevent stale-client resurrection.

Use an explicit allowlisted portable schema. Free text can still contain a secret, so promotion/editing requires clear disclosure and validation; keyword filtering alone is not a guarantee. Do not derive sync payloads by serializing entire internal objects or task snapshots.

## Data disclosure and retention

Local storage and browser execution do not make model inference local. Identify when page content, screenshots, or selected file data are sent to the model or a connected service. Minimize what is sent and retained while preserving useful task outcomes.

Capture only the intended task scope. Network diagnostics are opt-in and bounded; avoid full headers/bodies by default. Screen recordings show a visible indicator and scope. Screenshot masking does not automatically mask video; sensitive transitions require a tested pause/exclusion policy or clear refusal to record an unsupported private scope.

Backups exclude credentials by default and state that task artifacts may contain sensitive content. Imports validate paths, archive entries, checksums, and profile ownership before restoring. Logging and telemetry are bounded and opt-in where they disclose task content; error messages must not leak tokens or raw private payloads.

## Service rules and negative tests

Do not build stealth, credential interception, CAPTCHA solving, or access-control bypass into Rove. An authorized browser profile does not override a site's restrictions. Support permitted alternatives or human participation without claiming that slower/visible automation establishes legality.

Test cross-task and cross-profile access, revoked grants, stale approvals, malicious page instructions, forged tool results, unexpected external URLs, loopback spoofing, recording-scope leakage, sync secret injection, and cross-account engine reuse. Record actual outcomes; passing unit tests is not a compliance certificate.
