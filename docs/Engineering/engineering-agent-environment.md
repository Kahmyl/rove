# Engineering Agent Environment

**Role:** Repository-owned operating guidance for Codex while developing Rove. This environment does not define the agents or capabilities Rove exposes to end users.

## Purpose and boundaries

Codex can receive an engineering objective directly, recover the relevant repository context, investigate current technical facts, choose and implement a proportionate design, verify and review it, and leave useful continuation evidence. ChatGPT, subagents, bulk terminal work, and human review remain optional collaborators rather than mandatory lifecycle stages.

Canonical product and engineering documents remain authoritative. Active documents under `docs/Planning/` may sequence implementation after those contracts are settled, but they are subordinate to them and cannot silently redefine target behavior or implementation status. The environment does not add a planner, task database, agent manager, or separate memory system. It does not turn old task transcripts or generated continuation notes into product requirements.

## Checked-in layers

| Layer                                                          | Responsibility                                                                                                       |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `AGENTS.md`                                                    | Short instructions that must be present in every repository task.                                                    |
| `docs/README.md` and responsible product/engineering contracts | Product authority, target behavior, architecture, and verification policy.                                           |
| `docs/Planning/README.md` and applicable active plan          | Subordinate execution sequence, evidence gaps, dependencies, and completion conditions for approved work.           |
| `.agents/skills/rove-engineering`                              | Progressive workflow for context recovery, research, design, implementation, verification, review, and continuation. |
| `.codex/config.toml`                                           | Trusted-project safety defaults and stable feature enablement.                                                       |
| `.codex/rules/rove.rules`                                      | Approval boundaries for repository integration, destructive development cleanup, and opt-in live checks.             |
| `pnpm codex:context`                                           | Read-only snapshot of Git identity, worktree state, authority order, and standard checks.                            |
| `pnpm codex:environment:check`                                 | Bounded structural, discovery, configuration, and execpolicy checks against the installed client.                    |

The root instructions stay compact because Codex loads them into every task. Detailed procedure and routing live in the skill and are loaded when Rove engineering work triggers it. Domain truth stays in the canonical documents rather than being copied into agent prompts.

## Compatibility evidence

This environment was inspected against local Codex CLI `0.154.0-alpha.6.2` on 12 September 2026. That client supports repository skills under `.agents/skills`, layered `AGENTS.md`, trusted project `.codex/config.toml`, project rules, lifecycle hooks, local memories, managed worktrees, and subagents.

The coding-client version is separate from Rove's packaged Codex App Server compatibility baseline documented in [Technology Stack](technology-stack.md). Updating one does not qualify the other.

Project configuration loads only when the user trusts the repository. The checked-in configuration selects `workspace-write` sandboxing and on-request approvals, disables lifecycle hooks, and enables optional subagents; organization policy and the host sandbox can remain more restrictive. Rules prompt for local commits, integration, context-changing or destructive Git operations, removal of branches/worktrees, destructive development cleanup, and opt-in live checks. Routine read-only Git and deterministic checks have no repository rule match and remain governed by the sandbox and host policy.

Hooks are supported by the client, but this repository installs and enables no lifecycle hook. Automatic context injection or end-of-turn mutation would create another trusted execution path without a current requirement. Add a hook only when a deterministic enforcement need cannot be met by instructions, rules, tests, or existing repository checks.

Local Codex memories are personal generated state and are off by default in the inspected client. They are supplemental: source, current worktree state, tests, canonical documentation, and authorized checkpoints remain authoritative. Rove requirements and continuation state must not depend on memory.

Codex may independently use bounded subagents when parallel research, read-only exploration, disjoint analysis, or independent review materially improves speed or confidence. The root agent remains responsible for design selection, integration, and final verification. Parallel writers use separate branches/worktrees and isolate ports, application homes, databases, browser profiles, Runtime/session homes, artifacts, and mutable test accounts as applicable; a Git worktree alone does not isolate these resources.

## Architecture and authority

Within an approved product objective, Codex owns normal technical architecture: internal schemas and storage representation, additive non-destructive migrations, transaction and process boundaries, persistence abstractions, concurrency and recovery mechanisms, contract implementation, internal APIs, refactoring, and proportionate dependency choices. Material cross-cutting changes use the skill's design-judgment procedure; trivial local fixes do not require invented alternatives.

Human/product authority is required when a proposal materially changes product scope or settled behavior, what user data is retained, local-versus-remote persistence policy, destructive user-data consequences, product permissions or user control, security/privacy/legal/compliance boundaries, mandatory paid/hosted commitments, consequential live effects, or unauthorized publication/integration/release. Such escalation presents a decision, recommendation, alternatives, consequences, and evidence instead of vaguely asking whether persistence may change.

Ordinary feature and bug work must not modify `AGENTS.md`, `.agents/**`, `.codex/**`, or this governance document. Those surfaces change only when the engineering environment is explicitly in scope, or repeated concrete evidence identifies a recurring environment failure and its correction is explicitly authorized. Normal work may update the product/engineering contract that owns its behavior, implementation status, tests, and code documentation; it may not weaken its own operating policy to bypass friction.

## Normal engineering flow

1. Start in the intended checkout and run `pnpm codex:context`.
2. Load the `rove-engineering` skill and follow its document routing.
3. Read the responsible canonical Product/Engineering contracts, then any applicable active document under `docs/Planning/`; resolve conflicts in favor of the canonical contract and update it before following a contradictory plan.
4. Inspect implementation and verification truth before proposing edits.
5. Research current or unfamiliar behavior from primary sources when local help and pinned source are insufficient.
6. Use deeper design judgment only when ownership, persistence, contracts, concurrency, recovery, security, or another material boundary warrants it.
7. Implement the smallest coherent change and test the behavior at its owning boundary and against the active plan's stop condition.
8. Review the complete diff, update the responsible canonical documentation and Implementation Status from actual evidence, and revise/advance the active plan without claiming unfinished work is complete.
9. For a frozen candidate, use a separate read-only Codex task/subagent for independent review when requested or proportionate. Findings distinguish confirmed defects, evidence gaps, and unproven risks; remediation remains a root/human decision.
10. Use an authorized Git commit as a durable checkpoint. If interrupted before a coherent commit, leave the existing ignored continuation note defined by the skill.

Independent review is read-only by default and is not mandatory for trivial work. It begins from requirements and non-goals, freezes branch/HEAD/status, inspects the actual diff plus relevant unchanged source and assertions, and reports severity, scenario, consequence, evidence, and the smallest correction without unrelated redesign. Codex can perform this review; ChatGPT is not a required stage.

## Validation scope

### Automatically checked

`pnpm codex:environment:check` validates required files, skill frontmatter and size, reference routing, absence of redundant top-level skills, protected-governance wording, configuration defaults, package entry points, and representative rule decisions. With an installed client it uses an isolated temporary Codex home to verify trusted project configuration (`hooks = false`), repository `AGENTS.md`, and the repository skill catalog without model execution or personal configuration. It executes actual `execpolicy` evaluation and requires prompt decisions for representative consequential commands and no repository rule match for safe read-only Git and deterministic tests.

### Structurally checked

The repository test suite verifies that `codex:context` invokes Git with optional locking disabled, leaves the Git index and repository file set unchanged in a temporary repository, avoids credential/global-state output, and creates no continuation file. It also checks the single-skill layout, progressive references, continuation ignore policy, and documentation categories. These checks establish file structure and bounded helper behavior, not the quality of future engineering decisions.

### Manually inspected

The installed client's version/help and current official Codex documentation establish the available surfaces and their documented discovery model. The isolated prompt-input diagnostic demonstrates that Codex discovers the root guidance and skill catalog, but it does not prove that implicit skill activation improves a real task.

### Intentionally deferred

Native memory behavior, hook runtime behavior, subagent usefulness, architecture-decision quality, and independent-review effectiveness require evidence from real engineering tasks. Hooks remain absent and disabled; memory remains supplemental and non-authoritative. No live model, real account, private browser profile, or third-party mutation is part of environment validation.

## Maintenance

Run `pnpm codex:environment:check` after changing repository Codex configuration, rules, or skills. Run the standard repository checks for all changes. Re-inspect current official Codex documentation and the installed client's help before adopting a new surface; documented availability alone is not a reason to add it. Judge the deferred behaviors after 3–5 substantial engineering tasks before adding hooks, memory infrastructure, standing agent roles, or broader orchestration.

Official behavior references: [AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md), [skills](https://learn.chatgpt.com/docs/build-skills), [project configuration](https://learn.chatgpt.com/docs/config-file/config-advanced), [rules](https://learn.chatgpt.com/docs/agent-configuration/rules), [hooks](https://learn.chatgpt.com/docs/hooks), [memories](https://learn.chatgpt.com/docs/customization/memories), [worktrees](https://learn.chatgpt.com/docs/codex-app/worktrees), and [subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents).
