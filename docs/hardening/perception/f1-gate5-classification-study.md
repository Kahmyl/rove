# F1 Gate 5 Classification and Visual Study

## Status

Research-only strategy tournament. No production classifier, acquisition,
protocol, runtime policy, frozen corpus, risk model, Gate-3 baseline, or Gate-4
result was changed.

## Stable deterministic tournament

| Strategy | Primary accuracy | Macro F1 | Mean risk loss | High-confidence error | Critical violations | Proposition coverage | Proposition accuracy | Mean total ms | Mean evidence bytes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `s0-frozen-baseline` | 72.73% | 0.866146 | 36.818 | 30.00% | 5 | 0.00% | 0.00% | 0.030 | n/a |
| `s1-presentation-gated-current` | 95.45% | 0.959184 | 2.727 | 6.67% | 0 | 0.00% | 0.00% | 0.021 | n/a |
| `s2-proposition-first-structural` | 95.45% | 0.850932 | 4.364 | 0.00% | 0 | 100.00% | 99.35% | 16.440 | 2502.2 |
| `s3-proposition-first-accessibility` | 100.00% | 1.000000 | 0.000 | 0.00% | 0 | 100.00% | 100.00% | 16.435 | 2502.2 |
| `s4-proposition-first-stabilized` | 100.00% | 1.000000 | 0.000 | 0.00% | 0 | 100.00% | 100.00% | 16.435 | 2502.2 |
| `s5-structural-visual-escalation` | 100.00% | 1.000000 | 0.000 | 0.00% | 0 | 100.00% | 100.00% | 16.918 | 2502.2 |

The proposition-first strategies evaluate all seven propositions before deriving
the compatibility state. Presentation geometry is necessary evidence for framed
verification, but provider/frame/network presence is never verification by
itself. Accessibility is corroboration, not a visibility oracle.

### Ablation conclusions

- S1 isolates the provider-presence defect: it removes the five critical false
  handoffs, but cannot repair verification-over-restriction precedence.
- S2 fixes precedence and produces all seven propositions, but correctly refuses
  to call an empty painted canvas an interstitial from structure alone.
- S3 adds a bounded transient accessibility-shaped semantic label and resolves
  the deterministic canvas case. Raw accessible text is not persisted.
- S4 has the same stable-case classifier as S3 and adds conditional bounded
  reassessment for temporal/unstable observations; stable pages do not pay the
  temporal wait shown below.
- S5 demonstrates pixel occupancy as an escalation measurement. Its perfect
  corpus score is not architecture-eligible because the visual subset cannot
  establish that painted pixels mean an interstitial.

## Visual experiment

The bounded browser-side pixel probe compared `ready-blank` with
`unknown-canvas-interstitial`. It retained only occupancy facts and costs; no
screenshot or raw pixels are committed. The painted canvas is visually distinct,
but the corpus has only one positive canvas interstitial and no legitimate painted
canvas controls. Therefore visual occupancy does **not** defensibly establish
interstitial semantics and is not selected for the Gate-6 candidate. No OCR
dependency was present or added.

The probe escalated 1/22 stable cases. It read 614,400 synthetic pixel bytes in
memory for the canvas case and persisted only a roughly 100-byte feature record.
Navigation and pixel-acquisition latency are reported separately in JSON.

## Temporal experiment

The bounded DOM-quiet policy reached the declared later state in
3/3
temporal scenarios. This proves the tested fixtures, not a universal timeout.
Gate 6 must validate varied delay and irrelevant-mutation conditions before
freezing an observation policy.

## Winner

`s4-proposition-first-stabilized` is the Gate-5 architecture candidate: proposition-first
structural inference with bounded semantic/accessibility corroboration and a
bounded stabilization/reassessment envelope. Visual/OCR escalation is not part
of the candidate because its semantic incremental value was not established.

Gate 6 must validate held-out semantic variants, varied temporal delays,
channel-unavailability behavior, confidence calibration, relevant-region versus
whole-document quiet, and production latency/payload before freezing the ADR and
implementation runbook.

## Review findings incorporated

Pass 1 removed label-bearing benchmark metadata from inference behavior,
separated transient semantic analysis from persisted evidence, enforced
proposition-first precedence, prevented provider presence and missing visual
evidence from becoming blockers, preserved overlap propositions, and separated
pixel acquisition from navigation cost.

Pass 2 rejected the visually perfect S5 score as semantically underpowered,
made stable versus conditional-stabilization timing explicit, recorded source
hashes and experiment limitations, verified complete proposition output, and
checked that conclusions are derived from JSON rather than expected labels.

## Privacy

The artifact contains assessments, proposition truth values, bounded support
codes, counts, timings, hashes, sanitized Gate-4 origin facts, and bounded pixel
statistics. It contains no raw HTML/text/accessibility snapshot, screenshot,
raw pixels, request/response content or headers, credentials, storage, form
values, or unsanitized URLs.
