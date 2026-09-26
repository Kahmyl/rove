# ROVE-STAB-13 — Cross-cutting interaction and accessibility qualification

**Sprint:** Rove Market-Readiness Stabilization  
**Status:** Blocked on repaired product tickets  
**Dependencies:** STAB-02 through STAB-11 as applicable  
**Baseline:** `f26f2f1e7ff3bf3ff4f674ebeb234daf5fedbd2d`

This ticket is part of one stabilization sprint. It is not a separate sprint or release phase. Work must stay within this ticket's invariant, receive ticket-level verification, and be checkpointed before the next ticket begins.

## Objective

Prove that individually repaired authorities compose into one coherent product.

## Owns

MR-016, MR-025 downstream qualification, and any integration defect discovered only when repaired features coexist.

## Qualification matrix

Exercise at minimum:

- Working + Queue + Steer;
- Needs Input on background Task;
- recovery on a different Task;
- browser attached / requested takeover / human control / return checking;
- normal completion and failure/uncertainty distinctions;
- long conversation and long queued message;
- 1180×780 and 820×700;
- keyboard-only navigation and focus visibility;
- reduced motion;
- main/follower parity;
- auto-follow/Latest and reading-position preservation;
- multiple Tasks without selection theft.

## Rule for new defects

Do not silently fix defects inside this qualification ticket. Add a new MR finding, assign it to the owning existing ticket or split a new ticket if authority is genuinely independent, then return after correction.

## Verification

Deterministic Electron projection tests plus development-app human-visible runs. Cross-process/browser claims require real Runtime/App Server paths.
