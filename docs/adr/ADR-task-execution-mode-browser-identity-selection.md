# ADR: task execution mode and browser identity selection

Date: 2026-09-07

Status: proposed for Phase 5 contract lock

## Context

Rove already has two independent runtime concepts:

1. session mode: `agent`, `companion`, or `capture`;
2. browser identity: a named durable `BrowserWorkspace` or an isolated
   `temporary` profile.

Today an external MCP caller supplies the session mode. Browser identity
defaults to the workspace selected in the Rove app unless the caller supplies
an existing workspace id or explicitly asks for a temporary identity. These
runtime contracts are sound, but allowing the agent to make both decisions is
not a sufficient customer product model.

Session mode changes who may control the browser. Browser identity changes
which accounts, cookies, local storage, and browsing context are available.
Both decisions materially affect user expectations. They cannot be hidden in
an agent-authored `session.start` call.

## Decision

Rove presents session mode and browser identity as two orthogonal task-launch
choices. The product resolves and freezes both before browser execution begins.

```text
TaskLaunchIntent
  +-- executionMode: agent | companion | capture
  `-- browserIdentity: workspace(workspaceId) | temporary
                            |
                            v
ResolvedTaskLaunch (immutable for one Rove session)
```

The user owns these choices. Rove may apply visible remembered defaults, and an
agent may recommend a different choice before launch, but neither the model nor
the MCP adapter may silently select or change them for a native Rove task.

## Customer-facing execution modes

| Product choice    | Runtime mode | Initial controller | Human behavior                                           | Intended use                                                                  |
| ----------------- | ------------ | ------------------ | -------------------------------------------------------- | ----------------------------------------------------------------------------- |
| **Automate**      | `agent`      | agent              | Rove asks for a specific handoff when required           | Complete an outcome with minimal involvement                                  |
| **Work together** | `companion`  | agent              | The user may take over at any time and return control    | Collaborate, inspect, or make judgment calls during execution                 |
| **Capture**       | `capture`    | human              | The user drives; agent browser mutation remains disabled | Demonstrate or record a browser journey for later review or workflow creation |

The implementation names remain visible as secondary labels—for example,
"Automate · Agent mode"—so documentation, support, and diagnostics use one
unambiguous vocabulary.

Capture is not merely a less autonomous Agent task. Selecting Capture changes
the composer to a capture-oriented start experience. Rove may ask what the user
is demonstrating, but it does not start an agent-driven browser turn. Any later
agent analysis or automation begins as a new, explicitly linked task or
session.

## Customer-facing browser identity

| Product choice              | Runtime identity         | Persistence                                                              | Intended use                                                                          |
| --------------------------- | ------------------------ | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| **Named browser workspace** | `workspace(workspaceId)` | Cookies and ordinary browser storage survive sessions and clean restarts | Signed-in work using an explicit Personal, Work, Client, or other Rove-owned identity |
| **Temporary browser**       | `temporary`              | Isolated profile directory is removed when the owned browser closes      | Signed-out, one-off, privacy-sensitive, or clean-state work                           |

"Temporary" must not promise that remote services forget activity or that a
download disappears. It means the local browser profile is isolated and not
retained. Downloads and evidence continue to follow their own explicit Rove
retention contracts.

A named workspace is not ordinary Chrome's default profile and is not the
user's ChatGPT/Codex login. Rove displays these identities separately.

## Task composer behavior

The normal composer shows two compact, always-visible selectors beside the
primary task action:

```text
[ Automate ⌄ ]   [ Personal workspace ⌄ ]

Describe what you want Rove to do…                     [ Start ]
```

The selectors open explanatory menus; Rove does not show a mandatory setup
dialog before every task. The start action includes a plain-language summary,
such as "Rove will automate this task using your Personal browser workspace."

Defaults are:

- execution mode: `agent` / Automate;
- browser identity: the app-selected named workspace;
- if no workspace exists: Start is blocked until the user creates/selects a
  workspace or explicitly chooses Temporary;
- a one-time override does not silently change the remembered default;
- preferences may expose "remember as my default" as a separate explicit
  action.

The product may recommend Companion or Capture from the user's wording, but a
recommendation changes only explanatory UI. The user must confirm the mode
before launch. Rove never changes browser identity from prompt interpretation.

## Authority and lifecycle rules

The native task coordinator persists:

```text
executionMode
browserIdentityMode
resolvedWorkspaceId (workspace only)
selectionSource: user_selected | remembered_default | workflow_policy
selectedAt
```

It resolves the selected workspace before the first Codex turn and binds the
resolved values into the task-scoped Rove capability. A native Codex thread may
start a Rove browser session only with those values. A mismatched
`session.start` request is rejected rather than treated as a new preference.

Execution mode and browser identity are immutable for an active session:

- Agent mode can enter and leave an explicit requested handoff without
  becoming Companion mode.
- Companion mode can transfer control voluntarily without changing mode.
- Capture remains human-owned for its entire session.
- Switching from persistent to temporary, or between workspaces, requires a
  new browser session.
- A product flow may preserve the Codex conversation across a deliberate new
  browser session, but it records the identity boundary and never carries old
  target references across it.

External MCP clients retain the explicit `mode` and `browser` inputs for
backward compatibility. They do not acquire authority to alter the launch
configuration of a task already created by the native Rove product.

## Failure and attention behavior

Rove must stop before launch and ask the user when:

- no persistent workspace is selected;
- the chosen workspace no longer exists;
- the workspace is leased by another active task;
- the selected mode conflicts with the requested product operation;
- a workflow references an unavailable workspace policy.

Rove may offer safe choices such as Wait, choose another existing workspace,
or use Temporary. It must not silently switch identity to make the task start.

Choosing Temporary for a task that appears to require an authenticated account
may produce a warning that sign-in could be required, but the warning does not
authorize a switch to a persistent workspace. Choosing a named workspace does
not guarantee that any particular website session remains valid.

## Reuse by workflows

The later workflow product reuses the same two-axis contract. A workflow may
pin a mode and a browser-identity policy or require selection at run time. It
does not invent a parallel workflow-only browser mode.

Long-lived workflow definitions should prefer a logical workspace reference or
"choose at run" policy over embedding secrets or filesystem paths. Exact
workflow binding rules remain a later-phase decision.

## Acceptance gates

- Both selectors are visible before every native task starts.
- Automate plus the selected named workspace is the default without a modal.
- Each of the six mode/identity combinations launches with the expected
  controller and profile behavior.
- The model cannot silently change either choice.
- Agent, Companion, and Capture control transitions retain their existing
  runtime invariants.
- Named workspace authentication survives clean browser, Runtime, and Desktop
  restart; Temporary starts clean and removes its local profile on close.
- Workspace lease contention fails visibly and never falls back to another
  identity.
- Mode, workspace display name, and Temporary status remain visible during the
  task and in its evidence summary.
- Changing the presentation between compact, expanded, and full never changes
  the resolved task launch.
- External MCP clients retain their current explicit launch contract.

## Consequences

The common path remains fast: most users see Automate and their selected
workspace already chosen and can type a task immediately. The choices are still
visible, understandable, and auditable when they matter.

The agent loses an inappropriate degree of freedom. This is intentional. The
agent reasons about how to complete the task inside the selected authority and
identity boundary; it does not decide which human-control contract or signed-in
browser identity the user meant to expose.
