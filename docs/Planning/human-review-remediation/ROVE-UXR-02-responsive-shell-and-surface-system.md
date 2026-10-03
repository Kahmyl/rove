# ROVE-UXR-02 — Responsive shell and surface-system foundation

**Program:** [Rove Human-Review Remediation Program](README.md)

**Status:** Foundation candidate implemented and machine-qualified — manager review pending

**Program start:** `2ff214b8f8624859c1a55bb50a16997302614560`

## Purpose

Establish layout and visual primitives that make the remediation possible.

## Context

MR-038 and the compact three-column shell expose a shared foundation problem; composer or inspector patches cannot establish a coherent hierarchy.

## Owned invariant

The primary conversation remains readable and intentionally designed at normal and 820×700 boundaries. Navigation and inspector progressively collapse into accessible drawers/overlays before they damage it.

## Findings owned

Primary: MR-038. Supports MR-034 and MR-037 through shell allocation; UXR-07 owns later integrated verification, not a duplicate primary fix.

## Dependencies

[ROVE-UXR-01](ROVE-UXR-01-evidence-and-interaction-contract.md)

## Explicit non-goals

Dock orchestration, decision-family behavior, browser ownership redesign, notification authority, wholesale component-library replacement and removal of functional controls.

## Continuity entry contract

First consume the MR-029 qualification exit in both continuity ledgers and STAB-14, including complete source head `433a490caaccf44bd1c7901eee9e0eed704fd963`, registered MR-040/MR-041/MR-042 corrections, unchanged-gate evidence and remote PR #38 review disposition. The user handoff accepts remote technical review at `4f44a2c33406fe5f1c3e40dae56eeb1094d554df` and completed read-only/design reconciliation, and explicitly authorizes this bounded implementation. Earlier remote-pending wording is historical; qualification alone is still not authorization.

Consume completed UXR-01 contracts and exact checkpoint; inspect current shell/CSS, tokens, overlays and focus behavior. Reconcile source against current branch before choosing breakpoints or primitives.

## Investigation requirements

Measure conversation, nav and inspector allocations at 1180×780 and 820×700 plus intermediate resize boundaries. Inventory competing radius, elevation, shadow, spacing/density, typography, semantic color and focus rules. Map existing modal/drawer behavior, focus trapping/restoration and theme tokens; select the smallest architecture that satisfies the whole invariant.

## Implementation responsibility

This candidate implements the responsive application shell; nav/inspector collapse behavior; primary conversation width; shared surface/elevation, radius, shadow, spacing/density, typography, semantic colors and focus treatment with light/dark parity. Document measured breakpoints and responsibilities in owning contracts rather than naming runtime code after this ticket.

## Acceptance criteria

- At 820×700 the conversation, dock region and important labels are readable and recognizably composed; no squeezed permanent three-column shell remains. No-overflow alone is insufficient.
- Secondary surfaces have deliberate open/close, backdrop, Escape, keyboard navigation and focus-return behavior without changing Task selection or execution authority.
- One coherent surface scale distinguishes ordinary conversation/interaction, secondary resource content and true overlays; normal interaction does not resemble overlapping modal cards.
- Long titles/text and theme changes retain hierarchy, contrast and visible focus. Existing capabilities remain accessible through bounded progressive disclosure.

## Focused verification expectations

Shell/token/renderer tests at resize transitions; drawer focus and keyboard assertions; contrast and reduced-motion inspection; `pnpm check:repository`, typecheck/build and touched renderer suites when implementation occurs.

## Affected-area verification

Exercise New Task, selected Task, Workflow entry, inspector, profile modal and follower boundaries affected by shared primitives. Verify collapse does not steal selection, dispatch work or change exact browser ownership.

## Visual, responsive and accessibility evidence

Retain normal and 820×700 light/dark captures with nav/inspector open and closed; pointer/keyboard and reduced-motion evidence at collapse boundaries. Record dimensions and rationale for approved readable allocation.

## Continuity exit contract

Before completion, update [continuity-ledger.md](continuity-ledger.md) with exact start/end commit and branch, evidence-backed MR dispositions, root cause and disproved hypotheses, contract/source boundaries changed, compatibility/migration/fixture consequences, exact commands/results, evidence modes/paths/hashes, failures and unqualified boundaries, preserved reproductions, residual blockers and the next gate. Record no schema or persistence change when none occurred. Update every directly downstream entry contract if evidence changes its assumptions; new evidence can revise scope only through the ledger and responsible canonical authority.

Keep product/runtime/test names descriptive; ticket IDs remain bounded planning metadata. Existing authority/security invariants and negative regression assertions cannot be weakened for layout. Live model/external-service checks require explicit authorization and temporary test homes.

## Downstream handoff

UXR-03 inherits shell allocation, approved surface primitives, focus rules, and explicit responsive boundaries. Do not begin dock implementation until this foundation is qualified.

## Candidate exit

See the [continuity ledger](continuity-ledger.md) for exact source/evidence and failed-candidate classification. The 960px navigation hypothesis was rejected by rendered usable-width assertions and replaced with 968px. A 240px navigation / 280px inspector / 24px central-gutter foundation now preserves conversation at the required sizes. Drawer and nested-overlay focus is owned by the shared shell helper; Task authority, drafts, queue and conversation remain with their existing owners. No dock orchestration, schema or persistence-format change occurred.

Stop for independent manager review of this checkpoint. UXR-03 remains unstarted and requires acceptance plus an explicit continuation message in the same implementation chat. The user continuation instruction chooses focused/directly affected verification per item; full integrated campaigns belong to UXR-08. This checkpoint does not close MR-038's integrated/human boundary or any release gate.
