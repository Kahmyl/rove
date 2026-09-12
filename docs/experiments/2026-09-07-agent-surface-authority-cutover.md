# Agent-surface authority cutover

Date: 2026-09-07

Status: implemented; automated and contextual-authority live gates passed

## Live finding

A fresh Codex task successfully reused durable workspace
`wrk_6592ba60-fe03-4982-90c7-c8e7d179f1fb`, created generated file evidence
`ev_603a060375b14a69b606f3d3e23b1ee8`, and uploaded it to Google Drive with
applied receipt `rcpt_e6bdb8ae5164468f9677637466ff0f5e`.

The next observation, `bobs_457f8465b8a240b395e5829275d51e7b`, described
Drive's ordinary Rename dialog as `unknown_interstitial`. Although Runtime's
contextual action policy could authorize a freshly grounded rename, MCP still
returned the legacy page-wide `PagePolicyDecision` with `disposition: stop` and
`mutationAllowed: false`. The calling model obeyed that contradictory verdict
and stopped before proposing the action.

## Diagnosis

This was not a missing Drive classifier rule. It was an incomplete authority
migration:

- `browser.interact` used contextual per-action authorization;
- `browser.inspect` still exposed obsolete global authority;
- `browser.click`, `browser.type`, and `browser.press` still advertised the old
  page-wide authorization path.

Adding Rename vocabulary to perception would preserve the conflict and restart
the classifier patch loop.

## Production decision

- Keep page state and propositions observational.
- Retain `PagePolicyDecision` inside Runtime only for orchestration and adapter
  compatibility.
- Project MCP inspection without `metadata.pagePolicy` and include a compact
  `metadata.actionAuthority` declaration instead.
- Make `browser.interact` the only agent-facing target mutation tool.
- Keep authentication, human verification, credentials, access restriction,
  instability, explicit confirmation, freshness, target identity, action
  budgets, consequential replay fencing, and outcome verification as hard
  Runtime invariants.

This completes the production boundary already accepted in the contextual
authority ADR instead of extending site- or dialog-specific perception policy.

## Resumed live authority gate

Fresh task session `ses_f1f94ca3d92444daaf0238c7a9f11d15` confirmed that
the public catalog contains `browser.interact` but not the three legacy target
mutation tools. Inspection returned `contextual_per_action` authority without
`pagePolicy`. The task successfully opened Drive's ordinary Rename modal,
filled the new name, and committed the rename through the contextual path.

Receipt `rcpt_6176189a0196497c96939af3f4b0da32` initially reported
`not_applied` because the caller combined correct new-name presence with a
page-wide `text_absent` assertion for the old name. Read-only observation
`bobs_78f9b9441fe54fc6906cce3de439a577` proved the Item List row was renamed;
the old text remained only in Drive Activity as historical evidence. The
verification contract now explicitly directs entity renames/removals to exact
target or scoped effects rather than page-wide text absence.

The resumed Drive move exposed the same distinction at transaction scale. A
remote folder is not necessarily a visible destination scope in the final
observation, so semantic transactions now distinguish `within_scope` from
`destination_observation`. The latter requires the exact moved target plus an
independent destination-context effect. This keeps verification semantic and
generic without adding Drive-specific container assumptions.

## Automated verification

- MCP contract and contextual authorization tests: 19 passed.
- Real MCP process journey: stdio and authenticated Streamable HTTP both passed.
- Typecheck, lint, formatting, and production build passed.
- The unconstrained full suite passed 743 tests but overloaded parallel local
  Chromium workers, producing 11 unrelated timing failures. Every affected file
  was rerun serially: 6 files and 119 tests passed.
- After the remote-destination follow-on, the complete serial suite passed all
  124 files and all 755 tests.
