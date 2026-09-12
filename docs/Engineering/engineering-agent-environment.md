# Engineering Agent Environment

**Role:** Repository-owned operating guidance for Codex while developing Rove. This environment does not define the agents or capabilities Rove exposes to end users.

## Purpose and boundaries

Codex can receive an engineering objective directly, recover the relevant repository context, investigate current technical facts, choose and implement a proportionate design, verify and review it, and leave useful continuation evidence. ChatGPT, subagents, bulk terminal work, and human review remain optional collaborators rather than mandatory lifecycle stages.

Canonical product and engineering documents remain authoritative. The environment does not add a planner, task database, agent manager, or separate memory system. It does not turn old task transcripts or generated continuation notes into product requirements.

## Checked-in layers

| Layer                                                          | Responsibility                                                                                                       |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `AGENTS.md`                                                    | Short instructions that must be present in every repository task.                                                    |
| `docs/README.md` and responsible product/engineering contracts | Product authority, target behavior, architecture, and verification policy.                                           |
| `.agents/skills/rove-engineering`                              | Progressive workflow for context recovery, research, design, implementation, verification, review, and continuation. |
| `.codex/config.toml`                                           | Trusted-project safety defaults and stable feature enablement.                                                       |
| `.codex/rules/rove.rules`                                      | Approval boundaries for repository integration, destructive development cleanup, and opt-in live checks.             |
| `pnpm codex:context`                                           | Read-only snapshot of Git identity, worktree state, authority order, and standard checks.                            |
| `pnpm codex:environment:check`                                 | Validation of repository surfaces plus the installed Codex client's required command support.                        |

The root instructions stay compact because Codex loads them into every task. Detailed procedure and routing live in the skill and are loaded when Rove engineering work triggers it. Domain truth stays in the canonical documents rather than being copied into agent prompts.

## Compatibility evidence

This environment was inspected against local Codex CLI `0.154.0-alpha.6.2` on 12 September 2026. That client supports repository skills under `.agents/skills`, layered `AGENTS.md`, trusted project `.codex/config.toml`, project rules, lifecycle hooks, local memories, managed worktrees, and subagents.

The coding-client version is separate from Rove's packaged Codex App Server compatibility baseline documented in [Technology Stack](technology-stack.md). Updating one does not qualify the other.

Project configuration loads only when the user trusts the repository. The checked-in configuration selects `workspace-write` sandboxing and on-request approvals; organization policy and the host sandbox can remain more restrictive. Rules prompt for a small set of commands that can integrate branches, discard development state, remove local containers/volumes, or exercise real accounts and services.

Hooks are supported by the client, but this repository installs and enables no lifecycle hook. Automatic context injection or end-of-turn mutation would create another trusted execution path without a current requirement. Add a hook only when a deterministic enforcement need cannot be met by instructions, rules, tests, or existing repository checks.

Local Codex memories are personal generated state and are off by default in the inspected client. Rove requirements and continuation state must not depend on them. Subagents are available but optional; repository guidance restricts their use to explicit user or applicable instruction requests and keeps authoritative decisions in the primary task.

## Normal engineering flow

1. Start in the intended checkout and run `pnpm codex:context`.
2. Load the `rove-engineering` skill and follow its document routing.
3. Inspect implementation and verification truth before proposing edits.
4. Research current or unfamiliar behavior from primary sources when local help and pinned source are insufficient.
5. Implement the smallest coherent change and test the behavior at its owning boundary.
6. Review the complete diff, update the responsible canonical documentation, and record exact verification.
7. Use an authorized Git commit as a durable checkpoint. If interrupted before a coherent commit, leave the local continuation note defined by the skill.

Human/product authority remains necessary for product-scope or permission changes, destructive compatibility decisions, new paid or hosted commitments, credentials and real external effects, and unresolved tradeoffs that materially change the requested outcome. Routine engineering choices inside an approved objective belong to Codex.

## Maintenance

Run `pnpm codex:environment:check` after changing repository Codex configuration, rules, or skills. Run the standard repository checks for all changes. Re-inspect current official Codex documentation and the installed client's help before adopting a new surface; documented availability alone is not a reason to add it.

Official behavior references: [AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md), [skills](https://learn.chatgpt.com/docs/build-skills), [project configuration](https://learn.chatgpt.com/docs/config-file/config-advanced), [rules](https://learn.chatgpt.com/docs/agent-configuration/rules), [hooks](https://learn.chatgpt.com/docs/hooks), [memories](https://learn.chatgpt.com/docs/customization/memories), [worktrees](https://learn.chatgpt.com/docs/codex-app/worktrees), and [subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents).
